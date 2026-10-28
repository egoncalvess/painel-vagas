"""Configura o projeto Supabase do painel: tabelas, login com Google e o arquivo docs/supabase-config.js.

Roda no workflow "Configurar Supabase". Precisa dos secrets SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.
"""
import json
import os
import sys

import supa

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.environ.get("GITHUB_REPOSITORY", "egoncalvess/painel-vagas")
dono, nome = REPO.split("/")
SITE = f"https://{dono.lower()}.github.io/{nome}/"

if not supa.ativo:
    sys.exit("Faltam os secrets SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN.")

print("Criando tabelas")
supa.sql(open(os.path.join(RAIZ, "supabase", "schema.sql"), encoding="utf-8").read())

print("Configurando login")
auth = {"site_url": SITE, "uri_allow_list": f"{SITE}**,http://localhost:8000/**", "disable_signup": False}
gid, gsec = os.environ.get("GOOGLE_CLIENT_ID", "").strip(), os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
if gid and gsec:
    auth.update(external_google_enabled=True, external_google_client_id=gid, external_google_secret=gsec)
else:
    print("Sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET: login com Google fica desligado por enquanto.")
supa.gerencia("PATCH", "/config/auth", auth)

anon, servico = supa.chaves()
print("Copiando as vagas atuais para o banco")
painel = json.load(open(os.path.join(RAIZ, "docs", "vagas.json"), encoding="utf-8"))
rest = supa.Rest(servico)
campos = ["id", "data", "titulo", "empresa", "local", "modalidade", "score", "motivo", "fonte", "area", "link",
          "publicada", "prazo", "curriculo", "retorno"]
rest.upsert("vagas", [{c: v.get(c) for c in campos} for v in painel["vagas"]])
rest.upsert("buscas", [{"id": 1, "atualizado_em": painel.get("atualizado_em"), "fontes": painel.get("fontes", {})}])

# A chave anon é pública por natureza; quem protege os dados são as regras (RLS) do schema.sql
with open(os.path.join(RAIZ, "docs", "supabase-config.js"), "w", encoding="utf-8") as f:
    f.write(f"window.SUPABASE = {json.dumps({'url': supa.URL, 'anon': anon})};\n")
print(f"Pronto. Callback para o Google: {supa.URL}/auth/v1/callback")
