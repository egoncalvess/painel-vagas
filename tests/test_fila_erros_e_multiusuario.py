import json
import os
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "coletor"))

import coletar  # noqa: E402


class FakeResponse:
    def __init__(self, status_code=200, text="", json_data=None):
        self.status_code = status_code
        self.text = text
        self._json = json_data

    def json(self):
        if self._json is None:
            raise ValueError("No JSON")
        return self._json


CAMPOS_CONTRATO_FILA = {
    "id",
    "fonte",
    "tipo",
    "termo",
    "titulo",
    "empresa",
    "local",
    "link",
    "erro",
    "codigo_http",
    "tentativas",
    "primeira_falha_em",
    "ultima_tentativa_em",
    "status_fila",
}


def test_fila_erros_vagas_entrada_e_reprocessamento(tmp_path, monkeypatch):
    arq_fila = tmp_path / "fila_erros_vagas.json"
    monkeypatch.setattr(coletar, "ARQ_FILA_ERROS", str(arq_fila))
    monkeypatch.setattr(coletar, "FILA_ERROS_VAGAS", [])
    monkeypatch.setattr(coletar, "PERFIS_USUARIOS", [])
    monkeypatch.setattr(coletar.time, "sleep", lambda *_: None)
    monkeypatch.setattr(coletar, "todos_termos", lambda: [("1", "analista de planejamento")])

    url_salvador = "https://www.vagas.com.br/vagas-de-analista-de-planejamento-em-salvador"
    url_nacional = "https://www.vagas.com.br/vagas-de-analista-de-planejamento"
    url_vaga_1 = "https://www.vagas.com.br/vagas/v111111/analista-de-planejamento-pleno"
    url_vaga_2 = "https://www.vagas.com.br/vagas/v222222/engenheiro-de-planejamento"

    html_listagem_salvador = """
    <ul>
      <li class="vaga">
        <h2><a class="link-detalhes-vaga" href="/vagas/v111111/analista-de-planejamento-pleno" title="Analista de Planejamento Pleno">Analista de Planejamento Pleno</a></h2>
        <span class="emprVaga">Construtora Bahia</span>
        <span class="vaga-local">Salvador / BA</span>
        <span class="data-publicacao">Hoje</span>
      </li>
      <li class="vaga">
        <h2><a></a></h2>
        <span class="emprVaga">Empresa Incompleta</span>
        <span class="vaga-local">Salvador / BA</span>
      </li>
    </ul>
    """

    html_listagem_nacional = """
    <ul>
      <li class="vaga">
        <h2><a class="link-detalhes-vaga" href="/vagas/v222222/engenheiro-de-planejamento" title="Engenheiro de Planejamento">Engenheiro de Planejamento</a></h2>
        <span class="emprVaga">Energia Brasil</span>
        <span class="vaga-local">Home Office</span>
        <span class="data-publicacao">Hoje</span>
      </li>
    </ul>
    """

    html_detalhe_vaga_1 = """
    <html>
      <body>
        <h1 class="job-shortdescription__title">Analista de Planejamento Pleno</h1>
        <div class="job-tab-content">Atuação em modelo híbrido em Salvador com MS Project, Power BI e SAP.</div>
      </body>
    </html>
    """

    html_detalhe_vaga_2 = """
    <html>
      <body>
        <h1 class="job-shortdescription__title">Engenheiro de Planejamento</h1>
        <div class="job-tab-content">Vaga 100% remoto com Primavera P6 e Curva S.</div>
      </body>
    </html>
    """

    # 1ª Execução:
    # - Busca em Salvador responde 200, mas o detalhe da vaga v111111 falha com HTTP 502 e o 2º card não tem link/título
    # - Busca nacional falha com HTTP 503
    def fake_get_exec_1(url, **kw):
        if url == url_salvador:
            return FakeResponse(200, html_listagem_salvador)
        if url == url_nacional:
            return FakeResponse(503, "Service Unavailable")
        if url == url_vaga_1:
            return FakeResponse(502, "Bad Gateway")
        return None

    monkeypatch.setattr(coletar, "get", fake_get_exec_1)
    vagas_lidas_1 = list(coletar.fonte_vagas_com_br())
    assert vagas_lidas_1 == []

    fila_salva_1 = json.loads(arq_fila.read_text(encoding="utf-8"))
    assert len(fila_salva_1) == 3
    for item in fila_salva_1:
        assert set(item.keys()) == CAMPOS_CONTRATO_FILA
        assert item["id"].startswith("erro-vagas-")
        assert item["fonte"] == "Vagas.com.br"
        assert item["status_fila"] == "pendente"
        assert item["tentativas"] == 1

    por_link = {x["link"]: x for x in fila_salva_1 if x["link"]}
    assert por_link[url_nacional]["tipo"] == "busca"
    assert por_link[url_nacional]["codigo_http"] == 503
    assert por_link[url_vaga_1]["tipo"] == "vaga"
    assert por_link[url_vaga_1]["titulo"] == "Analista de Planejamento Pleno"
    assert por_link[url_vaga_1]["empresa"] == "Construtora Bahia"
    assert por_link[url_vaga_1]["local"] == "Salvador / BA"
    assert por_link[url_vaga_1]["codigo_http"] == 502

    # 2ª Execução: falha novamente para validar incremento de tentativas
    monkeypatch.setattr(coletar, "get", fake_get_exec_1)
    vagas_lidas_2 = list(coletar.fonte_vagas_com_br())
    assert vagas_lidas_2 == []
    fila_salva_2 = json.loads(arq_fila.read_text(encoding="utf-8"))
    por_link_2 = {x["link"]: x for x in fila_salva_2 if x["link"]}
    assert por_link_2[url_nacional]["tentativas"] == 2
    assert por_link_2[url_nacional]["status_fila"] == "pendente"
    assert por_link_2[url_vaga_1]["tentativas"] == 2
    assert por_link_2[url_vaga_1]["status_fila"] == "pendente"

    # Remove o item sem link (card inválido de teste) ou descarta para focar na resolução dos que têm link
    for x in coletar.FILA_ERROS_VAGAS:
        if not x["link"]:
            x["status_fila"] = "descartada"
    coletar.salvar_fila_erros()

    # 3ª Execução: servidores do Vagas.com.br respondem 200 OK no reprocessamento
    def fake_get_exec_3(url, **kw):
        if url == url_salvador:
            return FakeResponse(200, html_listagem_salvador)
        if url == url_nacional:
            return FakeResponse(200, html_listagem_nacional)
        if url == url_vaga_1:
            return FakeResponse(200, html_detalhe_vaga_1)
        if url == url_vaga_2:
            return FakeResponse(200, html_detalhe_vaga_2)
        return FakeResponse(404, "")

    # Na 3ª execução, mantemos apenas os itens com link válido na listagem para provar que saem de pendente -> resolvida
    html_listagem_salvador_limpa = html_listagem_salvador.split('<li class="vaga">', 2)[0] + '<li class="vaga">' + html_listagem_salvador.split('<li class="vaga">', 2)[1] + "</ul>"
    monkeypatch.setattr(
        coletar,
        "get",
        lambda url, **kw: FakeResponse(200, html_listagem_salvador_limpa) if url == url_salvador else fake_get_exec_3(url, **kw),
    )

    vagas_recuperadas = list(coletar.fonte_vagas_com_br())
    links_recuperados = {v["link"] for v in vagas_recuperadas}
    assert url_vaga_1 in links_recuperados
    assert url_vaga_2 in links_recuperados

    v1 = next(v for v in vagas_recuperadas if v["link"] == url_vaga_1)
    assert v1["modalidade"] == "hibrido"
    assert "MS Project" in v1.get("texto", "")

    # Todos os itens reprocessados com sucesso saíram da fila de pendentes
    assert coletar.fila_erros_pendentes() == []
    fila_salva_3 = json.loads(arq_fila.read_text(encoding="utf-8"))
    por_link_3 = {x["link"]: x for x in fila_salva_3 if x["link"]}
    assert por_link_3[url_nacional]["status_fila"] == "resolvida"
    assert por_link_3[url_vaga_1]["status_fila"] == "resolvida"


def test_multiusuario_avaliar_e_schema_supabase(monkeypatch):
    # Vaga presencial/híbrida em Recife para Analista de Dados (rejeitada pelo perfil padrão de Eng. Elétrica em Salvador)
    vaga_amigo = {
        "titulo": "Analista de Dados Pleno",
        "empresa": "Tech Nordeste",
        "local": "Recife, PE",
        "modalidade": "hibrido",
        "data": coletar.HOJE.isoformat(),
        "link": "https://exemplo.com/vaga/1",
        "fonte": "Gupy",
    }

    monkeypatch.setattr(coletar, "PERFIS_USUARIOS", [])
    status_padrao, score_padrao, _ = coletar.avaliar(dict(vaga_amigo))
    assert status_padrao == "fora da área"
    assert score_padrao is None

    # Adicionando perfil de amigo convidado em Recife na área de Dados
    perfil_amigo = coletar._normalizar_perfil_usuario({
        "user_id": "uuid-amigo-1",
        "nome": "Amigo Recife",
        "cargo_objetivo": "Analista de Dados",
        "cidade": "Recife",
        "uf": "PE",
        "cidades_proximas": ["Olinda", "Jaboatão dos Guararapes"],
        "modalidades": ["remoto", "hibrido"],
        "areas": [["Dados e BI", ["dados", "analytics", "bi"]]],
        "config": {"fora_da_area": ["estágio", "jovem aprendiz"], "formacao_excluida": []},
    })
    monkeypatch.setattr(coletar, "PERFIS_USUARIOS", [perfil_amigo])

    status_multi, score_multi, motivo_multi = coletar.avaliar(dict(vaga_amigo))
    assert status_multi is None
    assert score_multi >= 60
    assert "Dados e BI" in motivo_multi

    termos = [t for _, t in coletar.todos_termos()]
    assert "Analista de Dados" in termos

    # Verifica se o schema.sql declara todas as tabelas e políticas multiusuário exigidas
    schema_path = os.path.join(RAIZ, "supabase", "schema.sql")
    schema_sql = open(schema_path, encoding="utf-8").read()
    for trecho in (
        "public.perfis_usuarios",
        "public.fila_erros_vagas",
        "public.clientes_leads",
        "public.publicacoes_posts",
        "public.permitido()",
        "user_id = auth.uid()",
    ):
        assert trecho in schema_sql


def test_main_expoe_fila_erros_em_docs_vagas_json(tmp_path, monkeypatch):
    arq_vagas = tmp_path / "vagas.json"
    arq_estado = tmp_path / "estado.json"
    arq_hist = tmp_path / "historico.json"
    arq_fila = tmp_path / "fila_erros_vagas.json"
    arq_cat = tmp_path / "catalogo.json"

    arq_vagas.write_text(json.dumps({"vagas": []}), encoding="utf-8")
    arq_estado.write_text(json.dumps({"candidatei": {}, "descartadas": []}), encoding="utf-8")
    arq_hist.write_text(json.dumps({}), encoding="utf-8")

    monkeypatch.setattr(coletar, "ARQ_VAGAS", str(arq_vagas))
    monkeypatch.setattr(coletar, "ARQ_ESTADO", str(arq_estado))
    monkeypatch.setattr(coletar, "ARQ_HIST", str(arq_hist))
    monkeypatch.setattr(coletar, "ARQ_FILA_ERROS", str(arq_fila))
    monkeypatch.setattr(coletar, "ARQ_CATALOGO", str(arq_cat))
    monkeypatch.setattr(coletar, "FILA_ERROS_VAGAS", [])
    monkeypatch.setattr(coletar, "PERFIS_USUARIOS", [])
    monkeypatch.setattr(coletar.supa, "ativo", False)
    monkeypatch.setattr(coletar.time, "sleep", lambda *_: None)
    monkeypatch.setattr(coletar, "todos_termos", lambda: [("1", "analista de planejamento")])

    url_salvador = "https://www.vagas.com.br/vagas-de-analista-de-planejamento-em-salvador"
    url_nacional = "https://www.vagas.com.br/vagas-de-analista-de-planejamento"
    url_vaga = "https://www.vagas.com.br/vagas/v999999/analista-de-planejamento"

    html_busca = """
    <ul>
      <li class="vaga">
        <h2><a class="link-detalhes-vaga" href="/vagas/v999999/analista-de-planejamento" title="Analista de Planejamento">Analista de Planejamento</a></h2>
        <span class="emprVaga">Obras S.A.</span>
        <span class="vaga-local">Salvador / BA</span>
        <span class="data-publicacao">Hoje</span>
      </li>
    </ul>
    """
    html_detalhe = """
    <html><body>
      <h1 class="job-shortdescription__title">Analista de Planejamento</h1>
      <div class="job-tab-content">Modelo híbrido em Salvador. Requisitos: MS Project e Power BI.</div>
    </body></html>
    """

    def fonte_gupy_falsa():
        yield {
            "titulo": "Engenheiro de Planejamento Jr",
            "empresa": "Energia BA",
            "local": "Salvador, BA",
            "modalidade": "hibrido",
            "data": coletar.HOJE.isoformat(),
            "link": "https://gupy.io/job/1",
            "fonte": "Gupy",
        }

    monkeypatch.setattr(coletar, "FONTES", [("Gupy", fonte_gupy_falsa), ("Vagas.com.br", coletar.fonte_vagas_com_br)])

    # 1ª rodada do main(): detalhe da vaga do Vagas.com.br falha (HTTP 500)
    monkeypatch.setattr(
        coletar,
        "get",
        lambda url, **kw: FakeResponse(200, html_busca) if url == url_salvador else FakeResponse(404, "") if url == url_nacional else FakeResponse(500, "Erro"),
    )
    coletar.main()

    painel_1 = json.loads(arq_vagas.read_text(encoding="utf-8"))
    assert "fila_erros" in painel_1
    assert len(painel_1["fila_erros"]) == 1
    assert painel_1["fila_erros"][0]["link"] == url_vaga
    assert painel_1["fila_erros"][0]["status_fila"] == "pendente"
    assert len(painel_1["vagas"]) == 1

    # 2ª rodada do main(): detalhe da vaga responde 200 OK -> sai de fila_erros e entra em vagas
    monkeypatch.setattr(
        coletar,
        "get",
        lambda url, **kw: FakeResponse(200, html_busca) if url == url_salvador else FakeResponse(404, "") if url == url_nacional else FakeResponse(200, html_detalhe),
    )
    coletar.main()

    painel_2 = json.loads(arq_vagas.read_text(encoding="utf-8"))
    assert painel_2["fila_erros"] == []
    assert len(painel_2["vagas"]) == 2
    fontes_no_painel = {v["fonte"] for v in painel_2["vagas"]}
    assert "Vagas.com.br" in fontes_no_painel


def test_fila_erros_teto_esgotada_backoff_e_limite_por_execucao(tmp_path, monkeypatch):
    import datetime as dt

    arq_fila = tmp_path / "fila_erros_vagas.json"
    monkeypatch.setattr(coletar, "ARQ_FILA_ERROS", str(arq_fila))
    monkeypatch.setattr(coletar, "FILA_ERROS_VAGAS", [])
    monkeypatch.setattr(coletar.time, "sleep", lambda *_: None)

    link_vaga = "https://www.vagas.com.br/vagas/v777777/engenheiro-teste"
    for i in range(coletar.MAX_TENTATIVAS_FILA - 1):
        item = coletar.registrar_erro_vaga("vaga", "Falha 502", codigo_http=502, link=link_vaga)
        assert item["tentativas"] == i + 1
        assert item["status_fila"] == "pendente"

    # Ao atingir MAX_TENTATIVAS_FILA (5), marca status_fila = "esgotada"
    item_final = coletar.registrar_erro_vaga("vaga", "Falha 502", codigo_http=502, link=link_vaga)
    assert item_final["tentativas"] == coletar.MAX_TENTATIVAS_FILA
    assert item_final["status_fila"] == "esgotada"

    # fila_erros_pendentes exclui esgotada e removida
    fila_mista = [
        item_final,
        {"id": "erro-vagas-vaga-rem", "tipo": "vaga", "link": "https://www.vagas.com.br/vagas/v888/x", "status_fila": "removida", "tentativas": 1},
        {"id": "erro-vagas-vaga-pend", "tipo": "vaga", "link": "https://www.vagas.com.br/vagas/v999/y", "status_fila": "pendente", "tentativas": 3, "ultima_tentativa_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")},
    ]
    pendentes = coletar.fila_erros_pendentes(fila_mista)
    assert [x["id"] for x in pendentes] == ["erro-vagas-vaga-pend"]

    # Backoff: item com tentativas=3 precisa de >= 2h desde ultima_tentativa_em
    agora = dt.datetime.now(dt.timezone.utc)
    assert coletar.fila_erros_reprocessaveis(fila_mista, agora=agora) == []
    fila_mista[2]["ultima_tentativa_em"] = (agora - dt.timedelta(hours=3)).isoformat(timespec="seconds")
    assert [x["id"] for x in coletar.fila_erros_reprocessaveis(fila_mista, agora=agora)] == ["erro-vagas-vaga-pend"]

    # Limite por execução em fonte_vagas_com_br (MAX_REPROCESSAR_FILA)
    fila_lote = [
        {
            "id": f"erro-vagas-vaga-{i}",
            "fonte": "Vagas.com.br",
            "tipo": "vaga",
            "termo": "engenharia",
            "titulo": f"Vaga {i}",
            "empresa": "Emp",
            "local": "Salvador",
            "link": f"https://www.vagas.com.br/vagas/v{1000+i}/teste",
            "erro": "HTTP 502",
            "codigo_http": 502,
            "tentativas": 1,
            "primeira_falha_em": agora.isoformat(timespec="seconds"),
            "ultima_tentativa_em": agora.isoformat(timespec="seconds"),
            "status_fila": "pendente",
        }
        for i in range(coletar.MAX_REPROCESSAR_FILA + 10)
    ]
    arq_fila.write_text(json.dumps(fila_lote), encoding="utf-8")
    monkeypatch.setattr(coletar, "todos_termos", lambda: [])
    chamadas = []

    def fake_get_lote(url, **kw):
        chamadas.append(url)
        return FakeResponse(500, "Erro")

    monkeypatch.setattr(coletar, "get", fake_get_lote)
    list(coletar.fonte_vagas_com_br())
    assert len(chamadas) == coletar.MAX_REPROCESSAR_FILA


