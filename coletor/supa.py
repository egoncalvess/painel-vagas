"""Acesso ao Supabase pela API de gerenciamento e pela API REST (só biblioteca padrão)."""
import json
import os
import urllib.error
import urllib.request

REF = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
URL = f"https://{REF}.supabase.co" if REF else ""
ativo = bool(REF and TOKEN)


def pedir(metodo, url, corpo=None, headers=None):
    h = {"User-Agent": "painel-vagas", "Content-Type": "application/json", **(headers or {})}
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt.strip() else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{metodo} {url} -> {e.code}: {e.read().decode()[:400]}") from None


def gerencia(metodo, caminho, corpo=None):
    return pedir(metodo, f"https://api.supabase.com/v1/projects/{REF}{caminho}", corpo, {"Authorization": "Bearer " + TOKEN})


def chaves():
    ks = {k["name"]: k["api_key"] for k in gerencia("GET", "/api-keys?reveal=true") if k.get("api_key")}
    return ks["anon"], ks["service_role"]


def sql(consulta):
    return gerencia("POST", "/database/query", {"query": consulta})


class Rest:
    def __init__(self, chave):
        self.h = {"apikey": chave, "Authorization": "Bearer " + chave}

    def get(self, tabela, filtro=""):
        return pedir("GET", f"{URL}/rest/v1/{tabela}?{filtro}", headers=self.h)

    def upsert(self, tabela, linhas):
        for i in range(0, len(linhas), 500):
            pedir("POST", f"{URL}/rest/v1/{tabela}", linhas[i:i + 500],
                  {**self.h, "Prefer": "resolution=merge-duplicates,return=minimal"})
