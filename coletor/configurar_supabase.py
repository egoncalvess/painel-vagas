"""Configura o projeto Supabase do painel: tabelas, login multiusuário e o arquivo docs/supabase-config.js.

Roda no workflow "Configurar Supabase". Precisa dos secrets SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
e opcionalmente GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.
"""
import json
import os
import sys

import supa

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.environ.get("GITHUB_REPOSITORY", "egoncalvess/painel-vagas")
dono, nome = REPO.split("/")
SITE = f"https://{dono.lower()}.github.io/{nome}/"


def configurar():
    if not supa.ativo:
        sys.exit("Faltam os secrets SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN.")

    print("Criando tabelas e políticas multiusuário (vagas, fila_erros_vagas, perfis_usuarios, clientes_leads, publicacoes_posts)")
    supa.sql(open(os.path.join(RAIZ, "supabase", "schema.sql"), encoding="utf-8").read())

    print("Configurando login multiusuário")
    auth = {
        "site_url": SITE,
        "uri_allow_list": f"{SITE}**,http://localhost:8000/**,http://127.0.0.1:8000/**",
        "disable_signup": False,
        "external_email_enabled": True,
        "mailer_autoconfirm": True,
    }
    gid, gsec = os.environ.get("GOOGLE_CLIENT_ID", "").strip(), os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    if gid and gsec:
        auth.update(external_google_enabled=True, external_google_client_id=gid, external_google_secret=gsec)
    else:
        print("Sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET: login por e-mail/senha ativo; Google fica opcional.")
    supa.gerencia("PATCH", "/config/auth", auth)

    anon, servico = supa.chaves()
    print("Copiando as vagas atuais e a fila de erros para o banco")
    painel = json.load(open(os.path.join(RAIZ, "docs", "vagas.json"), encoding="utf-8"))
    rest = supa.Rest(servico)
    campos = ["id", "data", "titulo", "empresa", "local", "modalidade", "score", "motivo", "fonte", "area", "link",
              "publicada", "prazo", "curriculo", "retorno", "tambem_em", "visto_em", "sumiu", "requisitos"]
    rest.upsert("vagas", [{c: v.get(c) for c in campos} for v in painel.get("vagas", [])])
    rest.upsert("buscas", [{"id": 1, "atualizado_em": painel.get("atualizado_em"), "fontes": painel.get("fontes", {})}])

    arq_fila = os.path.join(RAIZ, "dados", "fila_erros_vagas.json")
    fila = painel.get("fila_erros", [])
    if os.path.exists(arq_fila):
        try:
            fila_disco = json.load(open(arq_fila, encoding="utf-8"))
            if isinstance(fila_disco, list):
                fila = fila_disco
        except (OSError, ValueError):
            pass
    if fila:
        campos_fila = ["id", "fonte", "tipo", "termo", "titulo", "empresa", "local", "link", "erro",
                       "codigo_http", "tentativas", "primeira_falha_em", "ultima_tentativa_em", "status_fila"]
        rest.upsert("fila_erros_vagas", [{c: item.get(c) for c in campos_fila} for item in fila if item.get("id")])

    # A chave anon é pública por natureza; quem protege os dados são as regras (RLS) do schema.sql
    with open(os.path.join(RAIZ, "docs", "supabase-config.js"), "w", encoding="utf-8") as f:
        f.write(f"window.SUPABASE = {json.dumps({'url': supa.URL, 'anon': anon})};\n")
    print(f"Pronto. Callback para o Google: {supa.URL}/auth/v1/callback")


if __name__ == "__main__":
    configurar()
