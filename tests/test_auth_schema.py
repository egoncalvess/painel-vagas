"""T-20261124-008: checagens estáticas do SQL de autenticação, do script de configuração e do painel.
Sem rede e sem Supabase real."""
import json
import os
import re
import shutil
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "coletor"))


def ler(*partes):
    with open(os.path.join(RAIZ, *partes), encoding="utf-8") as f:
        return f.read()


SQLS = [("supabase", "schema.sql"), ("supabase", "migracao_20261124_008_auth.sql")]


def corpo_funcao(sql, nome):
    m = re.search(rf"create or replace function public\.{nome}\(.*?\$\$(.*?)\$\$", sql, re.S | re.I)
    assert m, f"função {nome} não encontrada"
    return m.group(1)


def politica(sql, nome):
    m = re.search(rf'create policy "{re.escape(nome)}".*?;', sql, re.S | re.I)
    assert m, f"política {nome} não encontrada"
    return m.group(0)


@pytest.mark.parametrize("arq", SQLS)
def test_sql_sem_email_fixo(arq):
    sql = ler(*arq)
    assert "@gmail.com" not in sql.lower()
    assert not re.search(r"'[^'\s]+@[^'\s]+\.[a-z]{2,}'", sql), "e-mail literal no SQL"


@pytest.mark.parametrize("arq", SQLS)
def test_gatilho_de_papel_nunca_olha_email_da_linha(arq):
    sql = ler(*arq)
    corpo = corpo_funcao(sql, "impedir_autopromocao_role")
    linhas_role = [l for l in corpo.splitlines() if "role" in l.lower()]
    assert not any("new.email" in l.lower() for l in linhas_role)
    assert "if auth.uid() is null then" in corpo  # SQL Editor / dono do projeto
    assert re.search(r"tg_op = 'INSERT' then\s+new\.role := 'user'", corpo)
    assert re.search(r"new\.role is distinct from old\.role and not public\.eh_admin\(\) then\s+new\.role := old\.role", corpo)
    assert "auth.jwt() ->> 'email'" in corpo  # e-mail da própria linha vem do token


@pytest.mark.parametrize("arq", SQLS)
def test_eh_admin_so_pelo_papel_em_perfis(arq):
    corpo = corpo_funcao(ler(*arq), "eh_admin")
    assert "email" not in corpo.lower()
    assert "role = 'admin'" in corpo


@pytest.mark.parametrize("arq", SQLS)
def test_politica_inserir_perfil_sem_clausula_de_email(arq):
    p = politica(ler(*arq), "inserir proprio perfil")
    assert "with check (id = auth.uid())" in p
    assert "email" not in p.lower()


@pytest.mark.parametrize("arq", SQLS)
def test_progresso_contas_role_copiado_de_perfis(arq):
    sql = ler(*arq)
    corpo = corpo_funcao(sql, "progresso_contas_role")
    assert "from public.perfis" in corpo and "new.user_id" in corpo
    assert "execute function public.progresso_contas_role()" in sql


@pytest.mark.parametrize("arq", SQLS)
def test_rpc_reivindicar_exige_email_igual_e_confirmado(arq):
    sql = ler(*arq)
    corpo = corpo_funcao(sql, "reivindicar_conta_antiga")
    assert "email_confirmed_at is not null" in corpo
    assert "email_antiga is null or email_antiga <> email_jwt" in corpo
    assert "p.user_id is null" in corpo
    assert "public.mesclar_conta_antiga(chave, uid, email_jwt)" in corpo
    assert "grant execute on function public.reivindicar_conta_antiga(text) to authenticated" in sql
    assert "revoke all on function public.reivindicar_conta_antiga(text) from public, anon" in sql


@pytest.mark.parametrize("arq", SQLS)
def test_fusao_interna_nao_apaga_e_nao_e_chamavel_pelo_navegador(arq):
    sql = ler(*arq)
    corpo = corpo_funcao(sql, "mesclar_conta_antiga")
    assert "delete" not in corpo.lower()
    assert "migrada_para" in corpo and "user_id is null" in corpo
    assert "revoke all on function public.mesclar_conta_antiga(text, uuid, text) from public, anon, authenticated" in sql
    assert "grant execute on function public.mesclar_conta_antiga" not in sql


def test_snippet_reatribuir_conta_antiga():
    sql = ler("supabase", "reatribuir_conta_antiga.sql")
    assert "'<CHAVE_ANTIGA>'" in sql and "'<SEU_EMAIL>'" in sql
    codigo_sql = re.sub(r"--[^\n]*", "", sql)
    assert not re.search(r"'[^'\n]*@[^'\n]*'", codigo_sql)  # nenhum e-mail real em valor SQL
    assert "gmail" not in sql.lower()
    assert "email_confirmed_at is not null" in sql
    assert "public.mesclar_conta_antiga(chave_antiga, uid, email_destino)" in sql
    assert "user_id is null" in sql
    assert not re.search(r"\b(delete|drop|truncate)\b", sql, re.I)
    assert "reatribuir_conta_antiga" not in ler("supabase", "schema.sql").replace("supabase/reatribuir_conta_antiga.sql", "")


def test_migracao_tem_o_mesmo_sql_do_schema():
    schema = ler("supabase", "schema.sql")
    migracao = ler("supabase", "migracao_20261124_008_auth.sql")
    assert migracao.endswith(schema)


def test_snippet_primeiro_admin_separado_e_sem_email_real():
    sql = ler("supabase", "primeiro_admin.sql")
    assert "<SEU_EMAIL>" in sql and "role = 'admin'" in sql
    assert "@" not in sql.replace("<SEU_EMAIL>", "")
    assert "primeiro_admin" not in ler("supabase", "schema.sql").replace("supabase/primeiro_admin.sql", "")


# ---------------------------------------------------------------- configurar_supabase.py

@pytest.fixture
def configurar(tmp_path, monkeypatch):
    import configurar_supabase as cs
    (tmp_path / "supabase").mkdir()
    (tmp_path / "docs").mkdir()
    shutil.copy(os.path.join(RAIZ, "supabase", "schema.sql"), tmp_path / "supabase" / "schema.sql")
    (tmp_path / "docs" / "vagas.json").write_text(json.dumps({"vagas": []}), encoding="utf-8")
    chamadas = []

    class FakeRest:
        def __init__(self, chave):
            pass

        def upsert(self, tabela, linhas):
            chamadas.append(("upsert", tabela))

    monkeypatch.setattr(cs, "RAIZ", str(tmp_path))
    monkeypatch.setattr(cs.supa, "ativo", True)
    monkeypatch.setattr(cs.supa, "URL", "https://exemplo.supabase.co")
    monkeypatch.setattr(cs.supa, "sql", lambda q: chamadas.append(("sql", len(q))))
    monkeypatch.setattr(cs.supa, "gerencia", lambda metodo, caminho, corpo=None: chamadas.append(("gerencia", metodo, caminho, corpo)))
    monkeypatch.setattr(cs.supa, "chaves", lambda: ("anon", "servico"))
    monkeypatch.setattr(cs.supa, "Rest", FakeRest)
    monkeypatch.delenv("APLICAR_CONFIG_AUTH", raising=False)
    return cs, chamadas


def test_configurar_sem_flag_nao_mexe_no_auth(configurar):
    cs, chamadas = configurar
    cs.configurar()
    assert not [c for c in chamadas if c[0] == "gerencia"]
    assert ("sql",) == chamadas[0][:1]


def test_configurar_com_flag_liga_confirmacao_de_email(configurar, monkeypatch):
    cs, chamadas = configurar
    monkeypatch.setenv("APLICAR_CONFIG_AUTH", "1")
    cs.configurar()
    patch = [c for c in chamadas if c[0] == "gerencia"]
    assert len(patch) == 1 and patch[0][1:3] == ("PATCH", "/config/auth")
    assert patch[0][3]["mailer_autoconfirm"] is False


def test_script_nao_grava_autoconfirm_true():
    src = ler("coletor", "configurar_supabase.py")
    assert not re.search(r'"mailer_autoconfirm"\s*:\s*True', src)


# ---------------------------------------------------------------- painel

def test_painel_sem_convidado_sem_radar_local_e_sem_papel_por_email():
    js = ler("docs", "radar-app.js")
    html = ler("docs", "index.html")
    assert "radar.local" not in js
    assert "auth-guest-btn" not in js and "auth-guest-btn" not in html
    assert "resolverPapelUsuario" not in js
    assert 'activeNamespace="guest"' not in js and 'activeNamespace==="guest"' not in js
    # o papel não é decidido por e-mail em nenhuma comparação
    assert not re.search(r'===\s*"[^"]+@[^"]+"', js)
    # o cliente não envia role nos upserts de perfis e progresso_contas
    for tabela in ("perfis", "progresso_contas"):
        for m in re.finditer(rf'from\("{tabela}"\)\.upsert\((\{{.*?\}})\)', js, re.S):
            assert "role" not in m.group(1), f"upsert de {tabela} envia role"


def test_login_so_supabase_sem_conta_local():
    js = ler("docs", "radar-app.js")
    assert "registrarContaNoAparelho" not in js
    assert 'gravarGlobal("radar-accounts-registry"' not in js and "passwordHash:" not in js  # registro local só é lido
    assert js.count("sha256Hex(") == 1 and "hash=sha256Hex" in js  # só o verificador da conta antiga usa o hash
    assert "resetPasswordForEmail(email,{redirectTo:SITE_URL})" in js
    assert 'resend({type:"signup",email,options:{emailRedirectTo:SITE_URL}})' in js
    assert "updateUser({password:pass})" in js
    i_cria, i_get = js.index("createClient("), js.index("auth.getSession()")
    i_evt = js.index("onAuthStateChange(")
    assert i_cria < i_evt < i_get  # evento de recuperação registrado antes de getSession


def test_versoes_dos_arquivos_20261124_008():
    js = ler("docs", "radar-app.js")
    html = ler("docs", "index.html")
    assert 'const ASSET_VERSION="20261124-008";' in js
    versoes = re.findall(r'\?v=(\d{8}-\d{3})', html)
    assert len(versoes) >= 3 and set(versoes) == {"20261124-008"}
