"""Fontes novas (Indeed, Catho, Trabalhe Conosco), bloqueio, robots.txt, escrita atômica e salário.
Sem rede: todas as respostas vêm de tests/fixtures/ ou de respostas falsas."""
import email
import json
import os
import sys
import time

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(RAIZ, "tests", "fixtures")
sys.path.insert(0, os.path.join(RAIZ, "coletor"))

import coletar  # noqa: E402


def fixture(nome):
    with open(os.path.join(FIX, nome), encoding="utf-8") as f:
        return f.read()


class Resp:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text
        self.content = text.encode("utf-8")

    def json(self):
        return json.loads(self.text)


@pytest.fixture(autouse=True)
def isolar(monkeypatch):
    monkeypatch.setattr(coletar, "ERROS", [])
    monkeypatch.setattr(coletar, "AVISOS", [])
    monkeypatch.setattr(coletar, "BLOQUEIOS", [])
    monkeypatch.setattr(coletar, "_ROBOTS", {})
    monkeypatch.setattr(coletar, "_REQ_DOMINIO", {})
    monkeypatch.setattr(coletar.time, "sleep", lambda *_: None)
    monkeypatch.delenv("GMAIL_USER", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)


def get_por_url(mapa, chamadas=None):
    """get() falso: a 1ª chave contida na URL decide a resposta; robots.txt ausente = 404 (liberado)."""
    def fake(url, retry_429=True, **kw):
        if chamadas is not None:
            chamadas.append((url, retry_429))
        for trecho, resp in mapa.items():
            if trecho in url:
                return resp
        return Resp(404, "")
    return fake


# ---------------------------------------------------------------- salário

def test_extrair_salario_casos_do_plano():
    s = coletar.extrair_salario("R$ 5.000,00 a R$ 7.000,00")
    assert (s["min"], s["max"], s["periodo"]) == (5000, 7000, "mes")
    h = coletar.extrair_salario("R$ 30/hora")
    assert h["periodo"] == "hora" and h["min"] == 6600
    assert coletar.extrair_salario("A combinar") is None
    assert coletar.extrair_salario("Salário não informado") is None
    j = coletar.extrair_salario("", {"currency": "BRL", "value": {"minValue": 120000, "unitText": "YEAR"}})
    assert j["periodo"] == "ano" and 9000 <= j["min"] <= 9010


# ---------------------------------------------------------------- Catho

def test_catho_cards_do_html(monkeypatch):
    monkeypatch.setattr(coletar, "todos_termos", lambda: [("1", "engenheiro de planejamento")])
    monkeypatch.setitem(coletar.CFG, "catho", {"cidades": ["salvador-ba"], "paginas": 1, "remoto": False})
    chamadas = []
    monkeypatch.setattr(coletar, "get", get_por_url({"/vagas/": Resp(200, fixture("catho_busca.html"))}, chamadas))
    vagas = list(coletar.fonte_catho())
    assert [v["titulo"] for v in vagas] == ["Engenheiro(a) de Planejamento e Custo", "Analista de Processos"]
    assert vagas[0]["empresa"] == "SANEAMENTO EXEMPLO" and vagas[0]["local"] == "Salvador"
    assert vagas[0]["link"] == "https://www.catho.com.br/vagas/engenheiro-de-planejamento-e-custo/38419678"
    assert "salario" not in vagas[0]  # "A Combinar"
    assert vagas[1]["salario"]["min"] == 4000
    assert all(not r for u, r in chamadas if "/vagas/" in u)  # fontes novas não esperam em 429


def test_catho_jsonld_tem_prioridade_sobre_cards():
    html = fixture("jsonld.html")
    vagas = coletar.parse_catho(html, "https://www.catho.com.br/vagas/x/")
    assert vagas[0]["titulo"] == "Coordenador de Projetos" and vagas[0]["fonte"] == "Catho"
    assert vagas[0]["salario"]["min"] == 12000


# ---------------------------------------------------------------- Indeed (Gmail)

def test_indeed_email_de_alerta():
    msg = email.message_from_string(fixture("indeed_alerta.eml"))
    vagas = coletar.parse_email_indeed(coletar._html_do_email(msg))
    assert len(vagas) == 2
    assert vagas[0]["link"] == "https://br.indeed.com/viewjob?jk=0123456789abcdef"
    assert vagas[0]["empresa"] == "Construtora Exemplo" and vagas[0]["local"] == "Salvador, BA"
    assert vagas[0]["salario"]["min"] == 8000
    assert vagas[1]["link"].endswith("jk=fedcba9876543210") and vagas[1]["modalidade"] == "remoto"
    assert all("indeed.com" in v["link"] and v["fonte"] == "Indeed" for v in vagas)


def test_indeed_sem_gmail_zero_lidas_sem_falha(monkeypatch):
    monkeypatch.setitem(coletar.CFG, "indeed", {"modo": "gmail", "html_tentativa": False})
    assert list(coletar.fonte_indeed()) == []
    assert coletar.ERROS == []
    assert any("configure alertas no Gmail" in a for a in coletar.AVISOS)


# ---------------------------------------------------------------- Trabalhe Conosco

def tc(monkeypatch, itens, mapa):
    monkeypatch.setitem(coletar.CFG, "trabalhe_conosco", itens)
    monkeypatch.setattr(coletar, "get", get_por_url(mapa))
    return list(coletar.fonte_trabalhe_conosco())


def test_trabalhe_conosco_greenhouse_e_lever(monkeypatch):
    vagas = tc(monkeypatch,
               [{"empresa": "GH Exemplo", "url": "https://boards.greenhouse.io/exemplo", "tipo": "auto"},
                {"empresa": "Lever Exemplo", "url": "https://jobs.lever.co/exemplo", "tipo": "auto"}],
               {"boards-api.greenhouse.io/v1/boards/exemplo/jobs": Resp(200, fixture("greenhouse.json")),
                "api.lever.co/v0/postings/exemplo": Resp(200, fixture("lever.json"))})
    gh, lv = vagas
    assert gh["empresa"] == "GH Exemplo" and gh["modalidade"] == "remoto" and gh["salario"]["max"] == 12000
    assert lv["empresa"] == "Lever Exemplo" and lv["modalidade"] == "hibrido" and lv["link"].startswith("https://jobs.lever.co/")
    assert {v["fonte"] for v in vagas} == {"Trabalhe Conosco"}


def test_trabalhe_conosco_gupy_reusa_portal(monkeypatch):
    vagas = tc(monkeypatch, [{"empresa": "Minha Empresa", "url": "https://exemplo.gupy.io/", "tipo": "auto"}],
               {"exemplo.gupy.io/robots.txt": Resp(404, ""), "exemplo.gupy.io": Resp(200, fixture("gupy_portal.html"))})
    assert len(vagas) == 1
    assert vagas[0]["titulo"] == "Analista de PCM" and vagas[0]["empresa"] == "Minha Empresa" and vagas[0]["fonte"] == "Trabalhe Conosco"


def test_trabalhe_conosco_jsonld_e_links(monkeypatch):
    vagas = tc(monkeypatch,
               [{"empresa": "JSON Exemplo", "url": "https://empresa-a.com.br/carreiras", "tipo": "auto"},
                {"empresa": "Links Exemplo", "url": "https://empresa-b.com.br/trabalhe-conosco", "tipo": "auto"}],
               {"empresa-a.com.br/robots.txt": Resp(404, ""), "empresa-a.com.br": Resp(200, fixture("jsonld.html")),
                "empresa-b.com.br/robots.txt": Resp(404, ""), "empresa-b.com.br": Resp(200, fixture("links.html"))})
    titulos = [v["titulo"] for v in vagas]
    assert titulos == ["Coordenador de Projetos", "Analista de Planejamento Pleno", "Engenheiro de Custos"]
    assert vagas[0]["link"] == "https://empresa-a.com.br/carreiras/coord-projetos"
    links = vagas[1:]
    assert all(v["empresa"] == "Links Exemplo" and v["nota"].startswith("Fonte genérica") for v in links)
    assert links[1]["salario"]["min"] == 11000


def test_trabalhe_conosco_404_vai_para_avisos(monkeypatch):
    vagas = tc(monkeypatch, [{"empresa": "X", "url": "https://sumiu.com.br/vagas", "tipo": "links"}], {})
    assert vagas == []
    assert coletar.ERROS == []
    assert "https://sumiu.com.br/vagas" in coletar.AVISOS


def test_trabalhe_conosco_bloqueio_de_uma_empresa_nao_para_as_outras(monkeypatch):
    vagas = tc(monkeypatch,
               [{"empresa": "Bloq", "url": "https://bloq.com.br/vagas", "tipo": "links"},
                {"empresa": "Ok", "url": "https://empresa-b.com.br/trabalhe-conosco", "tipo": "links"}],
               {"bloq.com.br/robots.txt": Resp(404, ""), "bloq.com.br": Resp(200, "<html><title>Just a moment...</title></html>"),
                "empresa-b.com.br/robots.txt": Resp(404, ""), "empresa-b.com.br": Resp(200, fixture("links.html"))})
    assert len(vagas) == 2
    assert len(coletar.BLOQUEIOS) == 1 and "just a moment" in coletar.BLOQUEIOS[0]


# ---------------------------------------------------------------- bloqueio, robots, atômico

@pytest.mark.parametrize("resp", [Resp(403, "Forbidden"), Resp(429, "Too Many"), Resp(503, "x"),
                                  Resp(200, "<html><title>Just a moment...</title><div id='cf-chl'></div></html>"),
                                  Resp(200, "<html><div class='g-recaptcha'></div></html>")])
def test_bloqueio_detectado(resp):
    assert coletar.bloqueio(resp)


def test_pagina_normal_nao_e_bloqueio():
    assert coletar.bloqueio(Resp(200, fixture("catho_busca.html"))) is None


def test_robots_disallow_pula_url_e_avisa(monkeypatch):
    chamadas = []
    monkeypatch.setattr(coletar, "get", get_por_url(
        {"robots.txt": Resp(200, "User-agent: *\nDisallow: /vagas/\n"), "/vagas/": Resp(200, "nao deveria ler")}, chamadas))
    assert coletar.get_nova("https://site.com.br/vagas/x") is None
    assert [u for u, _ in chamadas] == ["https://site.com.br/robots.txt"]
    assert "robots.txt bloqueia https://site.com.br/vagas/x" in coletar.AVISOS


def test_get_real_nao_espera_em_429_quando_retry_desligado(monkeypatch):
    monkeypatch.setattr(coletar.time, "sleep", time.sleep)  # esperas reais: o teste mede o tempo
    monkeypatch.setattr(coletar.S, "get", lambda url, **kw: Resp(429, "Too Many"))
    t0 = time.monotonic()
    with pytest.raises(coletar.FonteBloqueada):
        coletar.get_nova("https://www.catho.com.br/vagas/x/")
    assert time.monotonic() - t0 < 5


def test_escrita_atomica_preserva_arquivo_anterior(tmp_path, monkeypatch):
    arq = tmp_path / "historico.json"
    arq.write_text(json.dumps({"antigo": 1}), encoding="utf-8")

    def explode(*a, **k):
        raise RuntimeError("caiu no meio")

    monkeypatch.setattr(coletar.json, "dump", explode)
    with pytest.raises(RuntimeError):
        coletar.gravar_json_atomico(str(arq), {"novo": 2})
    assert json.loads(arq.read_text(encoding="utf-8")) == {"antigo": 1}
    assert not (tmp_path / "historico.json.tmp").exists()


# ---------------------------------------------------------------- main(): disjuntor, sumiu, Supabase

class FakeRest:
    def __init__(self):
        self.upserts = {}

    def get(self, *a, **k):
        return []

    def upsert(self, tabela, linhas):
        self.upserts[tabela] = linhas


def preparar_main(tmp_path, monkeypatch, painel_vagas=None):
    arqs = {n: tmp_path / f"{n}.json" for n in ("vagas", "estado", "hist", "fila", "cat")}
    arqs["vagas"].write_text(json.dumps({"vagas": painel_vagas or []}), encoding="utf-8")
    arqs["estado"].write_text(json.dumps({"candidatei": {}, "descartadas": []}), encoding="utf-8")
    arqs["hist"].write_text(json.dumps({"existente|emp": {"titulo": "Existente", "status": "No painel"}}), encoding="utf-8")
    for nome, var in (("vagas", "ARQ_VAGAS"), ("estado", "ARQ_ESTADO"), ("hist", "ARQ_HIST"), ("fila", "ARQ_FILA_ERROS"), ("cat", "ARQ_CATALOGO")):
        monkeypatch.setattr(coletar, var, str(arqs[nome]))
    monkeypatch.setattr(coletar, "PERFIS_USUARIOS", [])
    monkeypatch.setattr(coletar, "carregar_perfis_usuarios", lambda rest=None: [])
    monkeypatch.setattr(coletar, "avaliar", lambda v, perfil=None: (None, 80, "teste"))
    monkeypatch.setattr(coletar, "checar_gmail", lambda vagas: None)
    return arqs


def vaga_ok():
    yield {"titulo": "Engenheiro de Planejamento", "empresa": "Energia BA", "local": "Salvador, BA", "modalidade": "hibrido",
           "data": coletar.HOJE.isoformat(), "link": "https://exemplo.gupy.io/job/1", "fonte": "Gupy",
           "texto": "Salário R$ 8.000 a R$ 9.000"}


def test_main_disjuntor_isola_fonte_bloqueada(tmp_path, monkeypatch):
    arqs = preparar_main(tmp_path, monkeypatch)
    monkeypatch.setattr(coletar.supa, "ativo", False)
    monkeypatch.setattr(coletar, "todos_termos", lambda: [("1", "engenheiro de planejamento")])
    monkeypatch.setitem(coletar.CFG, "catho", {"cidades": ["salvador-ba"], "paginas": 2, "remoto": True})
    chamadas = []
    monkeypatch.setattr(coletar, "get", get_por_url({"catho.com.br/vagas": Resp(429, "Too Many")}, chamadas))
    depois = []

    def fonte_depois():
        depois.append(1)
        yield from vaga_ok()

    monkeypatch.setattr(coletar, "FONTES", [("Catho", coletar.fonte_catho), ("Gupy", fonte_depois)])
    coletar.main()
    painel = json.loads(arqs["vagas"].read_text(encoding="utf-8"))
    assert painel["fontes"]["Catho"]["bloqueada"].endswith("HTTP 429")
    assert painel["fontes"]["Catho"]["falhas"] >= 1
    assert len([u for u, _ in chamadas if "/vagas/" in u]) == 1  # parou na 1ª resposta bloqueada
    assert depois == [1] and painel["fontes"]["Gupy"]["novas"] == 1
    hist = json.loads(arqs["hist"].read_text(encoding="utf-8"))
    assert "existente|emp" in hist and all(h.get("fonte") != "Catho" for h in hist.values())


def test_main_salario_so_em_requisitos_e_colunas_do_upsert_iguais(tmp_path, monkeypatch):
    preparar_main(tmp_path, monkeypatch)
    rest = FakeRest()
    monkeypatch.setattr(coletar.supa, "ativo", True)
    monkeypatch.setattr(coletar.supa, "chaves", lambda: ("url", "chave"))
    monkeypatch.setattr(coletar.supa, "Rest", lambda chave: rest)
    monkeypatch.setattr(coletar.supa, "sql", lambda q: None)
    monkeypatch.setattr(coletar, "FONTES", [("Gupy", vaga_ok)])
    coletar.main()
    linha = rest.upserts["vagas"][0]
    assert set(linha) == {"id", "data", "titulo", "empresa", "local", "modalidade", "score", "motivo", "fonte", "area", "link",
                          "publicada", "prazo", "curriculo", "retorno", "tambem_em", "visto_em", "sumiu", "requisitos"}
    assert linha["requisitos"]["salario"] == {"min": 8000, "max": 9000, "periodo": "mes", "texto": "R$ 8.000 a R$ 9.000"}


def test_fontes_novas_nunca_marcam_sumiu(tmp_path, monkeypatch):
    antiga = {"id": "x1", "titulo": "Analista Antigo", "empresa": "Emp", "fonte": "Catho", "visto_em": "2026-01-01", "data": "2026-01-01"}
    arqs = preparar_main(tmp_path, monkeypatch, [antiga])
    monkeypatch.setattr(coletar.supa, "ativo", False)
    monkeypatch.setattr(coletar, "FONTES_COMPLETAS", coletar.FONTES_COMPLETAS | {"Catho"})  # mesmo se alguém incluir por engano

    def catho_ok():
        yield {"titulo": "Outra", "empresa": "Outra", "local": "Salvador", "modalidade": "?", "data": None,
               "link": "https://www.catho.com.br/vagas/outra/1", "fonte": "Catho"}

    monkeypatch.setattr(coletar, "FONTES", [("Catho", catho_ok)])
    coletar.main()
    painel = json.loads(arqs["vagas"].read_text(encoding="utf-8"))
    assert not any(v.get("sumiu") for v in painel["vagas"])
    assert not (coletar.FONTES_NOVAS & {"Gupy", "Sólides"})


def test_fonte_desligada_em_config_nao_roda(tmp_path, monkeypatch):
    arqs = preparar_main(tmp_path, monkeypatch)
    monkeypatch.setattr(coletar.supa, "ativo", False)
    monkeypatch.setitem(coletar.CFG, "fontes_ativas", {"Catho": False})
    monkeypatch.setattr(coletar, "FONTES", [("Catho", lambda: (_ for _ in ()).throw(AssertionError("rodou"))), ("Gupy", vaga_ok)])
    coletar.main()
    painel = json.loads(arqs["vagas"].read_text(encoding="utf-8"))
    assert "Catho" not in painel["fontes"] and painel["fontes"]["Gupy"]["novas"] == 1
