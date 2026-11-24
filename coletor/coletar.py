"""Coleta vagas em vários sites, filtra, pontua e grava docs/vagas.json.

Roda no GitHub Actions todo dia (ver .github/workflows/coletar.yml).
Também roda no PC: python coletor/coletar.py
"""
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata

import requests
from bs4 import BeautifulSoup

try:
    import supa
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import supa

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(RAIZ, "config.json"), encoding="utf-8"))
ARQ_VAGAS = os.path.join(RAIZ, "docs", "vagas.json")
ARQ_ESTADO = os.path.join(RAIZ, "docs", "estado.json")
ARQ_HIST = os.path.join(RAIZ, "dados", "historico.json")
ARQ_FILA_ERROS = os.path.join(RAIZ, "dados", "fila_erros_vagas.json")
ARQ_PERFIS = os.path.join(RAIZ, "dados", "perfis_usuarios.json")
ARQ_CATALOGO = os.path.join(RAIZ, "docs", "catalogo.json")

HOJE = dt.date.today()
# Sites que entregam a lista inteira de vagas abertas: se uma vaga deles some, provavelmente foi encerrada
FONTES_COMPLETAS = {"Gupy", "Sólides"}
ERROS = []  # falhas da fonte que está rodando agora (vão para o diagnóstico do painel)
AVISOS = []  # coisas a arrumar no config.json que não são falha do site
FILA_ERROS_VAGAS = []  # fila persistente de erros do Vagas.com.br (dados/fila_erros_vagas.json)
PERFIS_USUARIOS = []  # perfis adicionais de usuários (multiusuário)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9"}
S = requests.Session()
S.headers.update(UA)


def log(*a):
    print(*a, flush=True)


def falha(*a):
    """Registra que uma consulta da fonte falhou: o painel mostra a fonte como Falhou ou Parcial, não como zero vagas."""
    ERROS.append(" ".join(str(x) for x in a)[:160])
    log("  falhou:", *a)


def cod(r):
    return f"HTTP {r.status_code}" if r is not None else "sem resposta"


def codigo_http_de(r):
    return int(r.status_code) if r is not None and getattr(r, "status_code", None) is not None else None


def agora_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sem_acento(t):
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").lower()


def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", sem_acento(t)).strip("-")[:80]


def chave(titulo, empresa):
    return slug(titulo) + "|" + slug(empresa)


def get(url, **kw):
    for tentativa in range(3):
        try:
            r = S.get(url, timeout=30, **kw)
            if r.status_code == 429:
                time.sleep(10 * (tentativa + 1))
                continue
            return r
        except requests.RequestException as e:
            log("  erro", url, e)
            time.sleep(3)
    return None


# ---------------------------------------------------------------- fila de erros Vagas.com.br

MAX_TENTATIVAS_FILA = 5
MAX_REPROCESSAR_FILA = 30
BACKOFF_HORAS_FILA = {1: 0, 2: 0, 3: 2, 4: 6, 5: 12}


def _parse_iso_utc(txt):
    if not txt or not isinstance(txt, str):
        return None
    try:
        d = dt.datetime.fromisoformat(txt.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d
    except ValueError:
        return None


def _horas_backoff_fila(tentativas):
    t = max(1, int(tentativas or 1))
    if t in BACKOFF_HORAS_FILA:
        return BACKOFF_HORAS_FILA[t]
    return 12


def _item_fila_elegivel(item, agora=None):
    if item.get("status_fila") != "pendente":
        return False
    if int(item.get("tentativas") or 1) >= MAX_TENTATIVAS_FILA:
        return False
    horas = _horas_backoff_fila(item.get("tentativas"))
    if horas <= 0:
        return True
    ultima = _parse_iso_utc(item.get("ultima_tentativa_em"))
    if ultima is None:
        return True
    ref = agora or dt.datetime.now(dt.timezone.utc)
    return (ref - ultima) >= dt.timedelta(hours=horas)


def id_erro_vaga(tipo, link="", termo="", titulo="", empresa=""):
    tipo_norm = "busca" if tipo == "busca" else "vaga"
    alvo = (link or "").strip()
    if alvo:
        alvo = re.sub(r"^https?://(www\.)?vagas\.com\.br/?", "", alvo)
        s = slug(alvo)
    else:
        s = slug(f"{termo}-{titulo}-{empresa}")
    return f"erro-vagas-{tipo_norm}-{s or 'item'}"[:96]


def _normalizar_item_fila(item):
    if not isinstance(item, dict):
        return None
    tipo = "busca" if item.get("tipo") == "busca" else "vaga"
    termo = (item.get("termo") or "").strip()
    titulo = (item.get("titulo") or "").strip()
    empresa = (item.get("empresa") or "").strip()
    local = (item.get("local") or "").strip()
    link = (item.get("link") or "").strip()
    eid = (item.get("id") or "").strip() or id_erro_vaga(tipo, link=link, termo=termo, titulo=titulo, empresa=empresa)
    if not eid.startswith("erro-vagas-"):
        eid = f"erro-vagas-{slug(eid)}"[:96]
    agora = agora_iso()
    cod_http = item.get("codigo_http")
    if isinstance(cod_http, str) and cod_http.isdigit():
        cod_http = int(cod_http)
    elif not isinstance(cod_http, int) or isinstance(cod_http, bool):
        cod_http = None
    status_fila = item.get("status_fila")
    if status_fila not in ("pendente", "resolvida", "descartada", "esgotada", "removida"):
        status_fila = "pendente"
    return {
        "id": eid,
        "fonte": "Vagas.com.br",
        "tipo": tipo,
        "termo": termo,
        "titulo": titulo,
        "empresa": empresa,
        "local": local,
        "link": link,
        "erro": str(item.get("erro") or "")[:300],
        "codigo_http": cod_http,
        "tentativas": max(1, int(item.get("tentativas") or 1)),
        "primeira_falha_em": item.get("primeira_falha_em") or agora,
        "ultima_tentativa_em": item.get("ultima_tentativa_em") or item.get("primeira_falha_em") or agora,
        "status_fila": status_fila,
    }


def carregar_fila_erros(caminho=None):
    arq = caminho or ARQ_FILA_ERROS
    dados = []
    if os.path.exists(arq):
        try:
            with open(arq, encoding="utf-8") as f:
                bruto = json.load(f)
            if isinstance(bruto, list):
                dados = bruto
            elif isinstance(bruto, dict):
                dados = bruto.get("fila_erros") or bruto.get("itens") or []
        except (OSError, ValueError):
            dados = []
    normalizados = []
    por_id = {}
    for raw in dados:
        norm = _normalizar_item_fila(raw)
        if not norm:
            continue
        por_id[norm["id"]] = norm
    normalizados = list(por_id.values())
    if caminho is None:
        FILA_ERROS_VAGAS[:] = normalizados
        return FILA_ERROS_VAGAS
    return normalizados


def salvar_fila_erros(fila=None, caminho=None):
    arq = caminho or ARQ_FILA_ERROS
    alvo = FILA_ERROS_VAGAS if fila is None else fila
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    with open(arq, "w", encoding="utf-8") as f:
        json.dump(alvo, f, ensure_ascii=False, indent=1)
    return alvo


def fila_erros_pendentes(fila=None):
    alvo = FILA_ERROS_VAGAS if fila is None else fila
    return [x for x in alvo if x.get("status_fila") == "pendente"]


def fila_erros_reprocessaveis(fila=None, agora=None, limite=MAX_REPROCESSAR_FILA):
    ref = agora or dt.datetime.now(dt.timezone.utc)
    elegiveis = [x for x in fila_erros_pendentes(fila) if _item_fila_elegivel(x, agora=ref)]
    elegiveis.sort(key=lambda x: (int(x.get("tentativas") or 1), x.get("ultima_tentativa_em") or ""))
    return elegiveis[:max(0, int(limite))]


def registrar_erro_vaga(tipo, erro, codigo_http=None, termo="", titulo="", empresa="", local="", link="", fila=None):
    alvo = FILA_ERROS_VAGAS if fila is None else fila
    tipo_norm = "busca" if tipo == "busca" else "vaga"
    link_limpo = (link or "").strip()
    eid = id_erro_vaga(tipo_norm, link=link_limpo, termo=termo, titulo=titulo, empresa=empresa)
    agora = agora_iso()
    cod_int = int(codigo_http) if isinstance(codigo_http, int) and not isinstance(codigo_http, bool) else None

    existente = None
    for item in alvo:
        if item.get("id") == eid or (link_limpo and item.get("link") == link_limpo and item.get("tipo") == tipo_norm):
            existente = item
            break

    if existente is not None:
        tentativas = int(existente.get("tentativas") or 0) + 1
        existente["tentativas"] = tentativas
        existente["ultima_tentativa_em"] = agora
        existente["erro"] = str(erro)[:300]
        existente["codigo_http"] = cod_int
        for campo, valor in (("termo", termo), ("titulo", titulo), ("empresa", empresa), ("local", local), ("link", link_limpo)):
            if valor:
                existente[campo] = valor.strip()
        if existente.get("status_fila") not in ("descartada", "removida"):
            if cod_int != 404 and tentativas >= MAX_TENTATIVAS_FILA:
                existente["status_fila"] = "esgotada"
            else:
                existente["status_fila"] = "pendente"
        return existente

    novo = {
        "id": eid,
        "fonte": "Vagas.com.br",
        "tipo": tipo_norm,
        "termo": (termo or "").strip(),
        "titulo": (titulo or "").strip(),
        "empresa": (empresa or "").strip(),
        "local": (local or "").strip(),
        "link": link_limpo,
        "erro": str(erro)[:300],
        "codigo_http": cod_int,
        "tentativas": 1,
        "primeira_falha_em": agora,
        "ultima_tentativa_em": agora,
        "status_fila": "pendente",
    }
    alvo.append(novo)
    return novo


def resolver_erro_vaga(id_ou_link, tipo=None, codigo_http=200, fila=None):
    alvo = FILA_ERROS_VAGAS if fila is None else fila
    agora = agora_iso()
    resolvidos = []
    for item in alvo:
        if item.get("id") == id_ou_link or (id_ou_link and item.get("link") == id_ou_link):
            if tipo and item.get("tipo") != tipo:
                continue
            item["status_fila"] = "resolvida"
            item["ultima_tentativa_em"] = agora
            item["codigo_http"] = codigo_http
            item["erro"] = ""
            resolvidos.append(item)
    return resolvidos


# ---------------------------------------------------------------- suporte multiusuário (perfis)

def _normalizar_perfil_usuario(p):
    if not isinstance(p, dict):
        return None
    cfg_extra = p.get("config") if isinstance(p.get("config"), dict) else {}
    cidades = []
    if p.get("cidade"):
        cidades.append(str(p["cidade"]).strip().lower())
    for c in (p.get("cidades_proximas") or cfg_extra.get("cidades_rms") or []):
        if isinstance(c, str) and c.strip():
            cidades.append(c.strip().lower())
    areas_raw = p.get("areas") or cfg_extra.get("areas") or []
    areas = []
    for item in areas_raw:
        if isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[1], list):
            areas.append([str(item[0]), [str(x) for x in item[1]]])
        elif isinstance(item, dict) and item.get("nome") and isinstance(item.get("chaves"), list):
            areas.append([str(item["nome"]), [str(x) for x in item["chaves"]]])
        elif isinstance(item, str) and item.strip():
            areas.append([item.strip(), [item.strip().lower()]])
    cargo = (p.get("cargo_objetivo") or "").strip()
    if cargo and not areas:
        areas.append([cargo, [cargo.lower()]])
    termos = []
    if cargo:
        termos.append(cargo)
    termos_cfg = cfg_extra.get("termos")
    if isinstance(termos_cfg, dict):
        for lista in termos_cfg.values():
            if isinstance(lista, list):
                termos.extend(str(t).strip() for t in lista if str(t).strip())
    elif isinstance(termos_cfg, list):
        termos.extend(str(t).strip() for t in termos_cfg if str(t).strip())
    modalidades = [sem_acento(str(m)) for m in (p.get("modalidades") or ["remoto", "hibrido"]) if str(m).strip()]
    competencias = [str(c).strip() for c in (p.get("competencias") or cfg_extra.get("meu_perfil") or []) if str(c).strip()]
    return {
        "user_id": p.get("user_id") or p.get("id") or p.get("email") or "usuario",
        "email": p.get("email") or "",
        "nome": p.get("nome") or "",
        "cargo_objetivo": cargo,
        "cidades_rms": cidades or list(CFG.get("cidades_rms", [])),
        "areas": areas or list(CFG.get("areas", [])),
        "fora_da_area": cfg_extra.get("fora_da_area") if isinstance(cfg_extra.get("fora_da_area"), list) else list(CFG.get("fora_da_area", [])),
        "formacao_excluida": cfg_extra.get("formacao_excluida") if isinstance(cfg_extra.get("formacao_excluida"), list) else list(CFG.get("formacao_excluida", [])),
        "mobilidade": cfg_extra.get("mobilidade") if isinstance(cfg_extra.get("mobilidade"), list) else list(CFG.get("mobilidade", [])),
        "max_dias": int(p.get("max_dias") or cfg_extra.get("max_dias") or CFG.get("max_dias", 30)),
        "modalidades": modalidades,
        "meu_perfil": competencias or list(CFG.get("meu_perfil", [])),
        "termos": termos,
    }


def carregar_perfis_usuarios(rest=None, caminho=None):
    perfis = []
    for p in (CFG.get("perfis") or CFG.get("usuarios") or []):
        norm = _normalizar_perfil_usuario(p)
        if norm:
            perfis.append(norm)
    arq = caminho or ARQ_PERFIS
    if os.path.exists(arq):
        try:
            with open(arq, encoding="utf-8") as f:
                bruto = json.load(f)
            lista = bruto if isinstance(bruto, list) else (bruto.get("perfis") or []) if isinstance(bruto, dict) else []
            for p in lista:
                norm = _normalizar_perfil_usuario(p)
                if norm:
                    perfis.append(norm)
        except (OSError, ValueError):
            pass
    if rest is not None:
        try:
            remotos = rest.get("perfis_usuarios", "select=*") or []
            for p in remotos:
                norm = _normalizar_perfil_usuario(p)
                if norm:
                    perfis.append(norm)
        except Exception as e:  # noqa: BLE001
            log("Supabase perfis_usuarios indisponível:", e)
    PERFIS_USUARIOS[:] = perfis
    return PERFIS_USUARIOS


def todos_termos():
    vistos = set()
    for prio, lista in CFG["termos"].items():
        for t in lista:
            chave_t = sem_acento(t).strip()
            if chave_t and chave_t not in vistos:
                vistos.add(chave_t)
                yield prio, t
    for p in PERFIS_USUARIOS:
        for t in p.get("termos", []):
            chave_t = sem_acento(t).strip()
            if chave_t and chave_t not in vistos:
                vistos.add(chave_t)
                yield "usuario", t


# ---------------------------------------------------------------- fontes
# Cada fonte devolve dicts: titulo, empresa, local, modalidade (remoto|hibrido|presencial|?), data (AAAA-MM-DD ou None), link, fonte

GUPY_APIS = ["https://portal.api.gupy.io/api/job", "https://employability-portal.gupy.io/api/v1/jobs", "https://portal.api.gupy.io/api/v1/jobs"]


def _gupy_item(j, empresa=""):
    wp = j.get("workplace") if isinstance(j.get("workplace"), dict) else {}
    end = wp.get("address") or j.get("address") or {}
    wt = (wp.get("workplaceType") or j.get("workplaceType") or "").lower()
    mod = "remoto" if wt == "remote" or j.get("isRemoteWork") else "hibrido" if wt == "hybrid" else "presencial" if wt in ("on-site", "onsite") else "?"
    cidade = j.get("city") or end.get("city") or j.get("addressCity") or ""
    estado = j.get("state") or end.get("stateShortName") or end.get("state") or j.get("addressState") or ""
    return dict(titulo=(j.get("name") or j.get("title") or "").strip(), empresa=j.get("careerPageName") or empresa,
                local=", ".join(x for x in [cidade, estado] if x) or ("Brasil" if mod == "remoto" else ""), modalidade=mod,
                data=(j.get("publishedDate") or j.get("publishedAt") or "")[:10] or None,
                link=j.get("jobUrl") or j.get("url") or "", fonte="Gupy",
                prazo=(j.get("applicationDeadline") or "")[:10] or None,
                banco=("talent_pool" in (j.get("type") or "")))


def _achar_vagas(no, saida):
    """Procura listas de vagas dentro do JSON da página da empresa."""
    if isinstance(no, dict):
        if ("name" in no or "title" in no) and "id" in no and any(k in no for k in ("workplaceType", "jobUrl", "publishedDate", "addressCity", "workplace", "department", "type")):
            saida.append(no)
        for v in no.values():
            _achar_vagas(v, saida)
    elif isinstance(no, list):
        for v in no:
            _achar_vagas(v, saida)


UF_DE = {"acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA", "ceara": "CE", "distrito federal": "DF",
         "espirito santo": "ES", "goias": "GO", "maranhao": "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
         "minas gerais": "MG", "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE", "piaui": "PI",
         "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", "rondonia": "RO", "roraima": "RR",
         "santa catarina": "SC", "sao paulo": "SP", "sergipe": "SE", "tocantins": "TO"}


def _uf(estado):
    return UF_DE.get(sem_acento(estado).strip(), (estado or "").strip())


def _gupy_busca(params, maximo):
    """Busca pública do candidato no portal da Gupy (a mesma que o site portal.gupy.io usa). Traz a data de publicação."""
    linhas, offset = [], 0
    while len(linhas) < maximo:
        r = get("https://portal.gupy.io/api/job-search/jobs", params={**params, "limit": 50, "offset": offset},
                headers={"Referer": "https://portal.gupy.io/"})
        if not r or r.status_code != 200:
            falha("Gupy busca", params, cod(r))
            break
        try:
            pagina = r.json()["data"]
        except (ValueError, KeyError, TypeError):
            falha("Gupy busca: resposta em formato inesperado", params)
            break
        linhas += pagina
        offset += len(pagina)
        # O total informado pela Gupy não é confiável: segue até vir uma página incompleta
        if len(pagina) < 50:
            break
        time.sleep(0.3)
    return linhas


def fonte_gupy():
    vistos = set()
    # 1) Busca pública: todas as vagas das cidades da RMS (sem depender do termo) e as remotas de cada termo
    consultas = [({"city": c, "state": "Bahia"}, 3000) for c in CFG.get("gupy_cidades", ["Salvador"])]
    consultas += [({"jobName": t, "workplaceType": "remote"}, 200) for _, t in todos_termos()]
    for params, maximo in consultas:
        for j in _gupy_busca(params, maximo):
            if "talent_pool" in (j.get("type") or ""):
                continue  # banco de talentos não é vaga aberta
            v = _gupy_item(j)
            v.pop("banco")
            v["texto"] = _limpo(j.get("description"))[:4000]
            cidade, uf = j.get("city") or "", _uf(j.get("state"))
            lugar = ", ".join(x for x in [cidade, uf] if x)
            v["local"] = (f"Brasil, remoto (empresa em {lugar})" if lugar else "Brasil, remoto") if v["modalidade"] == "remoto" else lugar
            if v["link"] and v["link"].split("?")[0] not in vistos:
                vistos.add(v["link"].split("?")[0])
                yield v
        time.sleep(0.3)
    # 2) Portais das empresas (lista em config.json)
    for portal in CFG.get("gupy_portais", []):
        r = get(portal)
        if r is not None and r.status_code == 404:
            AVISOS.append(portal)  # a empresa saiu da Gupy ou mudou o endereço
            log("  portal não existe mais:", portal)
            continue
        if not r or r.status_code != 200:
            falha("portal", portal, cod(r))
            continue
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            falha("portal sem dados", portal)
            continue
        achadas = []
        nd = json.loads(m.group(1))
        _achar_vagas(nd, achadas)
        cp = nd.get("props", {}).get("pageProps", {}).get("careerPage") or {}
        empresa = cp.get("name") or re.sub(r"https?://|\.gupy\.io/?", "", portal)
        for j in achadas:
            v = _gupy_item(j, empresa)
            if v.pop("banco"):
                continue  # banco de talentos não é vaga aberta
            if isinstance(j.get("id"), int) and j["id"] < CFG.get("gupy_id_minimo", 12300000):
                continue  # a Gupy não mostra a data; id baixo = anúncio antigo
            if not v["link"] and j.get("id"):
                v["link"] = portal.rstrip("/") + "/jobs/" + str(j["id"])
            if v["link"] not in vistos:
                vistos.add(v["link"])
                yield v
        time.sleep(0.5)


def fonte_linkedin():
    buscas = []
    for _, termo in todos_termos():
        buscas.append((termo, "Brasil", "2"))                      # remoto
        buscas.append((termo, "Salvador, Bahia, Brasil", "3"))      # híbrido
    mod_de = {"1": "presencial", "2": "remoto", "3": "?"}
    vistos = set()
    for termo, local, wt in buscas:
        r = get("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
                params={"keywords": termo, "location": local, "f_WT": wt, "f_TPR": "r2592000", "start": 0})
        if not r or r.status_code != 200:
            falha("LinkedIn", termo, wt, cod(r))
            time.sleep(5)
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        for card in soup.select("div.base-card, li"):
            t = card.select_one(".base-search-card__title")
            if not t:
                continue
            a = card.select_one("a.base-card__full-link") or card.select_one("a")
            link = (a.get("href") if a else "").split("?")[0]
            if not link or link in vistos:
                continue
            vistos.add(link)
            emp = card.select_one(".base-search-card__subtitle")
            loc = card.select_one(".job-search-card__location")
            tm = card.select_one("time")
            yield dict(titulo=t.get_text(strip=True), empresa=emp.get_text(strip=True) if emp else "",
                       local=loc.get_text(strip=True) if loc else local, modalidade=mod_de[wt],
                       data=tm.get("datetime") if tm else None, link=link, fonte="LinkedIn")
        time.sleep(2)


def _data_vagas(txt):
    txt = sem_acento(txt)
    if "hoje" in txt:
        return HOJE.isoformat()
    if "ontem" in txt:
        return (HOJE - dt.timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)\s+dias?", txt)
    if m:
        return (HOJE - dt.timedelta(days=int(m.group(1)))).isoformat()
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", txt)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def _extrair_detalhe_vagas_com_br(html, parcial=None):
    """Extrai dados enriquecidos da página de detalhe do Vagas.com.br, preservando os campos parciais."""
    parcial = dict(parcial or {})
    soup = BeautifulSoup(html or "", "html.parser")
    if soup.select_one(".erro-vaga, .pagina-erro"):
        raise RuntimeError("Página de detalhe da vaga retornou estrutura de erro")

    h1 = soup.select_one("h1.job-shortdescription__title, .nome-vaga, article h1, h1")
    titulo = (parcial.get("titulo") or (h1.get_text(" ", strip=True) if h1 else "")).strip()
    if not titulo:
        raise ValueError("Detalhe da vaga sem título válido")

    emp_el = soup.select_one(".job-shortdescription__company, .nome-empresa, .emprVaga")
    empresa = (parcial.get("empresa") or (emp_el.get_text(" ", strip=True) if emp_el else "")).strip()

    loc_el = soup.select_one(".info-localizacao, .job-local, .vaga-local")
    local_bruto = parcial.get("local") or (loc_el.get_text(" ", strip=True) if loc_el else "")
    local = re.split(r"A empresa aceita", re.sub(r"\s+", " ", local_bruto))[0].strip()

    dtp_el = soup.select_one(".data-publicacao, .job-hierarchical-list__item")
    data_pub = parcial.get("data") or (_data_vagas(dtp_el.get_text(" ", strip=True)) if dtp_el else None)

    corpo_el = soup.select_one(".job-tab-content, .texto-vaga, .infoVaga, .job-description__text, article")
    texto_det = _limpo(str(corpo_el))[:4000] if corpo_el else (parcial.get("texto") or "")

    mod = parcial.get("modalidade") or "?"
    lsa = sem_acento(f"{local} {texto_det[:600]}")
    if "home office" in lsa or "100% remot" in lsa or "trabalho remoto" in lsa or "modelo remoto" in lsa or ("remot" in sem_acento(local)):
        mod = "remoto"
    elif mod == "?" and ("hibrid" in lsa or "modelo hibrido" in lsa):
        mod = "hibrido"
    elif mod == "?" and ("100% presencial" in lsa or "modelo presencial" in lsa):
        mod = "presencial"

    out = dict(
        titulo=titulo,
        empresa=empresa,
        local=local,
        modalidade=mod,
        data=data_pub,
        link=parcial.get("link") or "",
        fonte="Vagas.com.br",
    )
    if texto_det:
        out["texto"] = texto_det
    return out


def _processar_pagina_busca_vagas(html, termo, vistos, consultar_detalhes=None):
    """Lê os cards `li.vaga` de uma página de busca do Vagas.com.br, enfileirando falhas sem perder vagas."""
    soup = BeautifulSoup(html or "", "html.parser")
    cards = soup.select("li.vaga")
    for li in cards:
        titulo = ""
        empresa = ""
        local = ""
        link = ""
        try:
            a = li.select_one("h2 a") or li.select_one("a.link-detalhes-vaga") or li.select_one("a[href*='/vagas/']")
            emp = li.select_one(".emprVaga")
            loc = li.select_one(".vaga-local")
            dtp = li.select_one(".data-publicacao")
            det = li.select_one(".detalhes")

            empresa = emp.get_text(" ", strip=True) if emp else ""
            local = re.sub(r"\s+", " ", loc.get_text(" ", strip=True)) if loc else ""
            local = re.split(r"A empresa aceita", local)[0].strip()

            href = (a.get("href") or "").strip() if a else (li.get("data-url") or li.get("data-link") or "").strip()
            if href:
                link = href if href.startswith("http") else "https://www.vagas.com.br/" + href.lstrip("/")

            titulo = ((a.get("title") or a.get_text(" ", strip=True)) if a else "").strip()
            if not titulo:
                h2 = li.select_one("h2")
                titulo = h2.get_text(" ", strip=True) if h2 else ""

            if li.get("data-erro") or li.select_one(".erro-vaga"):
                raise RuntimeError(li.get("data-erro") or "Card da vaga retornou erro na listagem")
            if not a or not link or not titulo:
                raise ValueError("Card de vaga incompleto: sem título ou link válido")

            if link in vistos:
                continue
            vistos.add(link)

            lsa = sem_acento(local)
            mod = "remoto" if "home office" in lsa or "remot" in lsa else "hibrido" if "hibrid" in lsa else "?"
            texto_card = _limpo(str(det))[:4000] if det else ""
            parcial = dict(
                titulo=titulo,
                empresa=empresa,
                local=local,
                modalidade=mod,
                data=_data_vagas(dtp.get_text(" ", strip=True)) if dtp else None,
                link=link,
                fonte="Vagas.com.br",
            )
            if texto_card:
                parcial["texto"] = texto_card

            deve_detalhar = consultar_detalhes if consultar_detalhes is not None else (
                bool(area_de_qualquer(titulo)) or len(cards) <= 5 or bool(CFG.get("vagas_detalhar_sempre"))
            )
            if deve_detalhar:
                rd = get(link)
                if not rd or rd.status_code != 200:
                    cod_http = codigo_http_de(rd)
                    motivo_err = f"Falha ao consultar detalhe da vaga ({cod(rd)})"
                    falha("Vagas.com.br vaga", link, cod(rd))
                    registrar_erro_vaga(
                        "vaga",
                        motivo_err,
                        codigo_http=cod_http,
                        termo=termo,
                        titulo=titulo,
                        empresa=empresa,
                        local=local,
                        link=link,
                    )
                    continue
                vaga_enriquecida = _extrair_detalhe_vagas_com_br(rd.text, parcial)
                resolver_erro_vaga(link, tipo="vaga", codigo_http=200)
                yield vaga_enriquecida
            else:
                resolver_erro_vaga(link, tipo="vaga", codigo_http=200)
                yield parcial
        except Exception as e:  # noqa: BLE001
            falha("Vagas.com.br vaga", link or titulo or termo, e)
            registrar_erro_vaga(
                "vaga",
                str(e),
                codigo_http=None,
                termo=termo,
                titulo=titulo,
                empresa=empresa,
                local=local,
                link=link,
            )


def fonte_vagas_com_br():
    vistos = set()
    urls_busca_reprocessadas = set()
    carregar_fila_erros()
    try:
        # 1) Reprocessar itens pendentes elegíveis da fila de erros do Vagas.com.br (com backoff e limite por execução)
        pendentes = fila_erros_reprocessaveis()
        for item in pendentes:
            tipo = item.get("tipo") or "vaga"
            link = (item.get("link") or "").strip()
            termo = (item.get("termo") or "").strip()
            if tipo == "busca":
                if not link:
                    registrar_erro_vaga("busca", "Busca sem URL para reprocessamento", termo=termo)
                    continue
                urls_busca_reprocessadas.add(link)
                r = get(link, params={"ordenar_por": "mais_recentes"})
                if r is not None and r.status_code == 404:
                    item["status_fila"] = "descartada"
                    item["codigo_http"] = 404
                    item["ultima_tentativa_em"] = agora_iso()
                    continue
                if not r or r.status_code != 200:
                    falha("Vagas.com.br", link, cod(r))
                    registrar_erro_vaga(
                        "busca",
                        f"Falha na busca ({cod(r)})",
                        codigo_http=codigo_http_de(r),
                        termo=termo,
                        link=link,
                    )
                    continue
                resolver_erro_vaga(link, tipo="busca", codigo_http=200)
                yield from _processar_pagina_busca_vagas(r.text, termo, vistos)
            else:
                if not link:
                    registrar_erro_vaga(
                        "vaga",
                        item.get("erro") or "Vaga sem link válido para reprocessamento",
                        termo=termo,
                        titulo=item.get("titulo", ""),
                        empresa=item.get("empresa", ""),
                        local=item.get("local", ""),
                    )
                    continue
                rd = get(link)
                vistos.add(link)
                if rd is not None and rd.status_code == 404:
                    item["status_fila"] = "descartada"
                    item["codigo_http"] = 404
                    item["ultima_tentativa_em"] = agora_iso()
                    continue
                if not rd or rd.status_code != 200:
                    falha("Vagas.com.br vaga", link, cod(rd))
                    registrar_erro_vaga(
                        "vaga",
                        f"Falha ao consultar detalhe da vaga ({cod(rd)})",
                        codigo_http=codigo_http_de(rd),
                        termo=termo,
                        titulo=item.get("titulo", ""),
                        empresa=item.get("empresa", ""),
                        local=item.get("local", ""),
                        link=link,
                    )
                    continue
                try:
                    vaga = _extrair_detalhe_vagas_com_br(rd.text, item)
                    resolver_erro_vaga(link, tipo="vaga", codigo_http=200)
                    vistos.add(link)
                    yield vaga
                except Exception as e:  # noqa: BLE001
                    falha("Vagas.com.br vaga", link, e)
                    registrar_erro_vaga(
                        "vaga",
                        str(e),
                        codigo_http=200,
                        termo=termo,
                        titulo=item.get("titulo", ""),
                        empresa=item.get("empresa", ""),
                        local=item.get("local", ""),
                        link=link,
                    )

        # 2) Coleta normal por termos de busca
        for _, termo in todos_termos():
            base = "https://www.vagas.com.br/vagas-de-" + slug(termo)
            for url in (base + "-em-salvador", base):
                if url in urls_busca_reprocessadas:
                    continue
                r = get(url, params={"ordenar_por": "mais_recentes"})
                if r is not None and r.status_code == 404:
                    continue  # termo sem página no site
                if not r or r.status_code != 200:
                    falha("Vagas.com.br", url, cod(r))
                    registrar_erro_vaga(
                        "busca",
                        f"Falha na busca ({cod(r)})",
                        codigo_http=codigo_http_de(r),
                        termo=termo,
                        link=url,
                    )
                    continue
                resolver_erro_vaga(url, tipo="busca", codigo_http=200)
                yield from _processar_pagina_busca_vagas(r.text, termo, vistos)
                time.sleep(1)
    finally:
        salvar_fila_erros()


def _limpo(html):
    return re.sub(r"\s+", " ", BeautifulSoup(html or "", "html.parser").get_text(" ")).strip()


def _solides_item(j):
    cidade = (j.get("city") or {}).get("name") or ((j.get("address") or {}).get("city") or {}).get("name") or ""
    uf = (j.get("state") or {}).get("code") or ""
    tipo = sem_acento(j.get("jobType") or "")
    mod = "remoto" if "remot" in tipo or j.get("homeOffice") else "hibrido" if "hibrid" in tipo else "presencial" if "presencial" in tipo else "?"
    lugar = ", ".join(x for x in [cidade, uf] if x)
    slug_emp = j.get("slug") or ""
    link = (f"https://{slug_emp}.vagas.solides.com.br/vaga/{j['id']}" if re.fullmatch(r"[a-z0-9-]+", slug_emp, re.I)
            else "https://vagas.solides.com.br/vagas/todos/" + requests.utils.quote(j.get("title") or ""))
    return dict(titulo=re.sub(r"\s*\|\s*[^|]*-\s*[A-Z]{2}\s*$", "", (j.get("title") or "").strip()),
                empresa=(j.get("companyName") or "").strip(), local=("Brasil, remoto" if mod == "remoto" else lugar), modalidade=mod,
                data=(j.get("createdAt") or "")[:10] or None, link=link, fonte="Sólides",
                prazo=((j.get("date") or {}).get("due") or "")[:10] or None, so_pcd=bool(j.get("pcdOnly")), texto=_limpo(j.get("description"))[:4000])


def fonte_solides():
    """Portal público da Sólides: 20 vagas por página, das mais novas para as mais antigas."""
    limite = (HOJE - dt.timedelta(days=CFG["max_dias"] + 1)).isoformat()
    consultas = [({"title": "", "locations": c}, 40) for c in CFG.get("solides_cidades", ["Salvador - BA"])]
    consultas += [({"title": t, "jobsType": "remoto"}, 5) for _, t in todos_termos()]
    vistos = set()
    for params, paginas in consultas:
        for pagina in range(1, paginas + 1):
            r = get("https://vagas.solides.com.br/api/vacancies", params={"page": pagina, "take": 20, **params},
                    headers={"Referer": "https://vagas.solides.com.br/"})
            if not r or r.status_code != 200:
                falha("Sólides", params, cod(r))
                break
            try:
                dados = r.json()
                lista = dados["data"]
            except (ValueError, KeyError, TypeError):
                falha("Sólides: resposta em formato inesperado", params)
                break
            for j in lista:
                if j.get("id") in vistos:
                    continue
                vistos.add(j.get("id"))
                yield _solides_item(j)
            if not lista or pagina >= int(dados.get("totalPages") or 0) or (lista[-1].get("createdAt") or "9") < limite:
                break
            time.sleep(0.3)


_NUXT_EMBRULHOS = {"ShallowReactive", "Reactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError"}


def _desachatar_nuxt(arr):
    """O Empregos.com.br entrega os dados da página no formato "achatado" do Nuxt; isto remonta o objeto."""
    memo = {}

    def res(i, prof=0):
        if not isinstance(i, int) or isinstance(i, bool) or prof > 60:
            return i
        if i in memo:
            return memo[i]
        x = arr[i]
        if isinstance(x, list):
            if x and x[0] == "Date":
                out = x[1]
            elif x and x[0] == "Set":
                out = [res(k, prof + 1) for k in x[1:]]
            elif x and isinstance(x[0], str) and x[0] in _NUXT_EMBRULHOS:
                out = res(x[1], prof + 1)
            else:
                out = memo[i] = []
                out.extend(res(k, prof + 1) for k in x)
                return out
        elif isinstance(x, dict):
            out = memo[i] = {}
            for k, v in x.items():
                out[k] = res(v, prof + 1)
            return out
        else:
            out = x
        memo[i] = out
        return out

    return res(0)


def _empregos_item(j):
    loc = (j.get("location") or [{}])[0] or {}
    tipo = sem_acento(j.get("workplaceTypes") or "")
    mod = "remoto" if "remot" in tipo or "home" in tipo else "hibrido" if "hibrid" in tipo else "presencial" if "presencial" in tipo else "?"
    cidade, uf = loc.get("city") or "", loc.get("stateAbbreviation") or loc.get("state") or ""
    titulo = (j.get("title") or "").strip()
    return dict(titulo=titulo, empresa=((j.get("company") or {}).get("name") or "").strip(),
                local=("Brasil, remoto" if mod == "remoto" else ", ".join(x for x in [cidade, uf] if x)), modalidade=mod,
                data=(j.get("createdAt") or "")[:10] or None, fonte="Empregos.com.br", texto=_limpo(j.get("description"))[:4000],
                link=f"https://www.empregos.com.br/vaga/{j.get('referenceId')}/{slug(titulo)}-em-{slug(cidade)}-{slug(uf)}")


def fonte_empregos():
    """Páginas públicas de busca do Empregos.com.br: cada termo em Salvador e, no Brasil todo, só as remotas."""
    vistos = set()
    for _, termo in todos_termos():
        for url, so_remoto, paginas in ((f"https://www.empregos.com.br/vagas/{slug(termo)}-em-salvador-ba", False, 3),
                                        (f"https://www.empregos.com.br/vagas/{slug(termo)}", True, 1)):
            for pagina in range(1, paginas + 1):
                r = get(url if pagina == 1 else f"{url}/{pagina}")
                if not r or r.status_code != 200:
                    falha("Empregos.com.br", url, cod(r))
                    break
                m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
                try:
                    lista = _desachatar_nuxt(json.loads(m.group(1)))["data"]["fetch-jobs"]["jobCollection"]
                except (AttributeError, ValueError, KeyError, TypeError, IndexError):
                    falha("Empregos.com.br: formato da página mudou", url)
                    break
                for j in lista:
                    v = _empregos_item(j)
                    if (so_remoto and v["modalidade"] != "remoto") or j.get("referenceId") in vistos:
                        continue
                    vistos.add(j.get("referenceId"))
                    yield v
                if len(lista) < 20:
                    break
                time.sleep(0.5)


# Sites de origem primeiro: quando a mesma vaga aparece em outro site depois, ela vira "Também em"
FONTES = [("Gupy", fonte_gupy), ("Sólides", fonte_solides), ("Empregos.com.br", fonte_empregos),
          ("Vagas.com.br", fonte_vagas_com_br), ("LinkedIn", fonte_linkedin)]


# ---------------------------------------------------------------- avaliação

def tem(txt, lista):
    t = sem_acento(txt)
    return any(sem_acento(x) in t for x in lista)


def area_de(titulo, areas=None):
    for nome, chaves in (areas if areas is not None else CFG["areas"]):
        if tem(titulo, chaves):
            return nome
    return None


def area_de_qualquer(titulo):
    area = area_de(titulo)
    if area:
        return area
    for p in PERFIS_USUARIOS:
        area_p = area_de(titulo, p.get("areas"))
        if area_p:
            return area_p
    return None


def na_rms(local, cidades=None):
    return tem(local, cidades if cidades is not None else CFG["cidades_rms"])


UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split()


def no_brasil(local):
    if tem(local, ["brasil", "brazil"]):
        return True
    m = re.search(r"[,/-]\s*([A-Z]{2})\b", local or "")
    return bool(m and m.group(1) in UFS)


def _avaliar_com_cfg(v, cfg_alvo):
    """Avalia uma vaga contra um perfil/config específico."""
    titulo, local = v["titulo"], v.get("local", "")
    areas_cfg = cfg_alvo.get("areas", CFG["areas"])
    fora_cfg = cfg_alvo.get("fora_da_area", CFG["fora_da_area"])
    formacao_cfg = cfg_alvo.get("formacao_excluida", CFG["formacao_excluida"])
    cidades_cfg = cfg_alvo.get("cidades_rms", CFG["cidades_rms"])
    mobilidade_cfg = cfg_alvo.get("mobilidade", CFG["mobilidade"])
    max_dias_cfg = int(cfg_alvo.get("max_dias") or CFG["max_dias"])
    modalidades_aceitas = cfg_alvo.get("modalidades")

    area = area_de(titulo, areas_cfg)
    if not area or tem(" " + titulo + " ", fora_cfg):
        return "fora da área", None, ""
    if tem(titulo, formacao_cfg):
        return "Descartada (formação)", None, "Formação exigida não aceita Eng. Elétrica"
    if v.get("so_pcd"):
        return "Descartada (exclusiva PcD)", None, "Vaga exclusiva para pessoas com deficiência"
    if v.get("data"):
        try:
            idade = (HOJE - dt.date.fromisoformat(v["data"][:10])).days
            if idade > max_dias_cfg:
                return "Descartada (anúncio antigo)", None, f"Publicada há {idade} dias"
        except ValueError:
            pass
    if v.get("prazo") and v["prazo"] < HOJE.isoformat():
        return "Descartada (encerrada)", None, "Prazo de inscrição encerrado"
    mod = v.get("modalidade", "?")
    if tem(titulo, ["presencial"]):
        mod = "presencial"
    elif tem(titulo, ["home office", "remoto", "remota", "100% remoto"]):
        mod = "remoto"
    elif tem(titulo, ["híbrido", "hibrido"]) and mod == "?":
        mod = "hibrido"
    v["modalidade"] = mod
    rms = na_rms(local, cidades_cfg)
    if local and not no_brasil(local) and not rms:
        return "Descartada (fora do Brasil)", None, "Vaga fora do Brasil"

    aceita_presencial = bool(modalidades_aceitas and "presencial" in modalidades_aceitas)
    if (mod == "presencial" and not (aceita_presencial and rms)) or (mod == "hibrido" and not rms):
        return "Descartada (modalidade)", None, "Presencial ou híbrido fora de Salvador/RMS"
    if mod == "?" and not rms:
        return "Descartada (modalidade)", None, "Fora de Salvador/RMS e sem indicação de remoto"

    pontos, motivos = 25, []
    pesos_area = {"Planejamento e controle": 35, "Gestão de projetos": 28, "Manutenção": 22, "Trainee": 28, "Engenharia elétrica": 18}
    pontos += pesos_area.get(area, 25)
    motivos.append(area)
    if mod == "remoto":
        pontos += 15; motivos.append("remoto")
    elif mod == "hibrido":
        pontos += 15; motivos.append("híbrido em Salvador/RMS")
    else:
        pontos += 6; motivos.append("Salvador/RMS, modalidade a confirmar")
    if tem(titulo, ["elétric", "eletric", "eletrotécn"]):
        pontos += 5; motivos.append("elétrica")
    if tem(titulo + " " + v.get("empresa", ""), mobilidade_cfg):
        pontos += 8; motivos.append("mobilidade")
    if re.search(r"\b(j[uú]nior|jr|pleno|pl|i|ii)\b", sem_acento(titulo)):
        pontos += 5
    if re.search(r"\b(senior|sr|especialista|head|diretor|director|gerente|coordenador|coordenadora|coordenacao|supervisor|supervisora|lider)\b", sem_acento(titulo)):
        pontos -= 15; motivos.append("nível acima do perfil")
    if re.search(r"\b(iii|iv)\b", sem_acento(titulo)):
        pontos -= 5
    if re.search(r"\b(tecnico|tecnica|assistente)\b", sem_acento(titulo)):
        pontos -= 10; motivos.append("nível técnico")
    if tem(titulo, ["power bi", "ms project", "sap", "pmo"]):
        pontos += 4
    return None, max(0, min(100, pontos)), ", ".join(motivos)


def avaliar(v, perfil=None):
    """Devolve (status, score, motivo). status None = vaga entra no painel."""
    if perfil is not None:
        norm = _normalizar_perfil_usuario(perfil) or CFG
        return _avaliar_com_cfg(v, norm)
    status, score, motivo = _avaliar_com_cfg(v, CFG)
    if status is None or not PERFIS_USUARIOS:
        return status, score, motivo
    for p in PERFIS_USUARIOS:
        st_p, sc_p, mot_p = _avaliar_com_cfg(v, p)
        if st_p is None:
            return None, sc_p, mot_p
    return status, score, motivo


# ---------------------------------------------------------------- requisitos x perfil

# [nome, padrão no texto da vaga]. Quem tem cada um está em "meu_perfil" no config.json.
REQUISITOS = [
    ("MS Project", r"ms ?project|microsoft project"),
    ("Primavera P6", r"primavera|\bp6\b"),
    ("Power BI", r"power ?bi"),
    ("Excel avançado", r"excel avan[cç]ado|excel intermedi|vba|tabela din[aâ]mica"),
    ("SAP", r"\bsap\b"),
    ("AutoCAD", r"autocad|auto cad"),
    ("BIM / Revit", r"\bbim\b|revit"),
    ("PMP / PMI", r"\bpmp\b|\bpmi\b|pmbok"),
    ("Curva S / valor agregado", r"curva s\b|valor agregado|\bevm\b"),
    ("Orçamento e custos", r"or[cç]amento|custos|\bcapex\b|\bopex\b"),
    ("Lean / Six Sigma", r"lean|six sigma|green belt"),
    ("Inglês", r"ingl[eê]s|english"),
    ("Espanhol", r"espanhol"),
    ("CREA ativo", r"\bcrea\b"),
    ("NR-10", r"nr.?10\b"),
    ("NR-35", r"nr.?35\b"),
    ("Pós-graduação", r"p[oó]s.?gradua|mba|especializa[cç][aã]o em"),
    ("CNH", r"\bcnh\b|carteira de habilita"),
    ("Disponibilidade para viagens", r"disponibilidade (para|de) viag"),
]


def requisitos(texto, perfil=None):
    """O que a vaga cita, separado entre o que consta no seu perfil e o que vale conferir. Ajuda a priorizar; não é chance de contratação."""
    t = sem_acento(texto)
    base_perfil = (perfil.get("meu_perfil") if isinstance(perfil, dict) and perfil.get("meu_perfil") else CFG.get("meu_perfil", []))
    conjunto_perfil = {sem_acento(x) for x in base_perfil}
    tenho, conferir = [], []
    for nome, padrao in REQUISITOS:
        if re.search(sem_acento(padrao), t):
            (tenho if sem_acento(nome) in conjunto_perfil else conferir).append(nome)
    out = {}
    if tenho:
        out["tenho"] = tenho
    if conferir:
        out["conferir"] = conferir
    m = re.search(r"experiencia (?:minima |comprovada )?(?:de )?(\d{1,2})\s*anos?", t)
    if m:
        out["anos"] = int(m.group(1))
    return out


# ---------------------------------------------------------------- Gmail (opcional, só leitura)

def checar_gmail(vagas):
    user, senha = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not senha:
        return
    import email
    import imaplib
    from email.header import decode_header
    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com")
        M.login(user, senha)
        M.select("INBOX", readonly=True)  # só leitura: nada é marcado como lido
        desde = (HOJE - dt.timedelta(days=2)).strftime("%d-%b-%Y")
        _, ids = M.search(None, f'(SINCE "{desde}")')
        for i in ids[0].split()[-200:]:
            _, d = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
            msg = email.message_from_bytes(d[0][1])
            assunto = "".join(p.decode(c or "utf-8", "ignore") if isinstance(p, bytes) else p for p, c in decode_header(msg.get("Subject", "")))
            rem = msg.get("From", "")
            texto = sem_acento(assunto + " " + rem)
            if "indeed" in texto and "match" in texto:
                continue
            if not any(k in texto for k in ["candidatura", "entrevista", "processo seletivo", "application", "recrutamento", "inscricao"]):
                continue
            for v in vagas:
                emp = sem_acento(re.sub(r"\(.*?\)", "", v.get("empresa", ""))).strip()
                if len(emp) >= 4 and emp.split()[0] in texto:
                    v["retorno"] = f"{assunto[:90]} ({HOJE.strftime('%d/%m')})"
        M.logout()
    except Exception as e:  # noqa: BLE001
        log("gmail falhou:", e)


# ---------------------------------------------------------------- principal

COLUNAS_NOVAS = (
    "alter table public.vagas add column if not exists tambem_em jsonb, "
    "add column if not exists visto_em date, add column if not exists sumiu boolean, "
    "add column if not exists requisitos jsonb; "
    "create table if not exists public.fila_erros_vagas ("
    "id text primary key, fonte text, tipo text, termo text, titulo text, empresa text, local text, "
    "link text, erro text, codigo_http int, tentativas int, primeira_falha_em timestamptz, "
    "ultima_tentativa_em timestamptz, status_fila text, extra jsonb default '{}'::jsonb);"
)


def gravar_catalogo(hist):
    """Tudo o que o robô leu nos últimos 45 dias, com o que fez de cada vaga. O painel usa para "Conferir uma vaga"."""
    desde = (HOJE - dt.timedelta(days=45)).isoformat()
    linhas = [[h.get("link") or "", h.get("titulo") or "", h.get("empresa") or "", h.get("fonte") or "", h.get("status") or "",
               h.get("motivo") or "", h.get("visto_em") or ""] for h in hist.values() if (h.get("visto_em") or "") >= desde]
    json.dump({"campos": ["link", "titulo", "empresa", "fonte", "status", "motivo", "visto_em"], "desde": desde, "linhas": linhas},
              open(ARQ_CATALOGO, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def ler(caminho, padrao):
    try:
        return json.load(open(caminho, encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def main():
    painel = ler(ARQ_VAGAS, {"vagas": []})
    estado = ler(ARQ_ESTADO, {"candidatei": {}, "descartadas": []})
    hist = ler(ARQ_HIST, {})
    carregar_fila_erros()
    fora = set(estado.get("descartadas", []))
    rest = None
    if supa.ativo:
        try:
            rest = supa.Rest(supa.chaves()[1])
            fora |= {m["vaga_id"] for m in rest.get("marcacoes", "select=vaga_id&descartada=eq.true")}
        except Exception as e:  # noqa: BLE001
            log("Supabase indisponível:", e)
            rest = None
    carregar_perfis_usuarios(rest=rest)
    vagas = [v for v in painel["vagas"] if v["id"] not in fora]
    ids = {v["id"] for v in vagas}
    por_chave = {chave(v["titulo"], v["empresa"]): v for v in vagas}
    for v in vagas:
        v.setdefault("visto_em", v.get("data"))  # vagas antigas: considera vista no dia em que entrou
    resumo = {}

    for nome, fn in FONTES:
        ERROS.clear()
        AVISOS.clear()
        n = {"lidas": 0, "novas": 0, "ja_no_painel": 0, "ja_vistas": 0}
        descartes = {}
        try:
            for v in fn():
                n["lidas"] += 1
                k = chave(v["titulo"], v["empresa"])
                if k in por_chave:
                    # Mesma vaga (empresa + cargo) que já está no painel: marca que continua aberta e guarda o outro site
                    n["ja_no_painel"] += 1
                    atual = por_chave[k]
                    if atual.get("fonte") == v["fonte"] or not atual.get("fonte"):
                        atual["visto_em"] = HOJE.isoformat()
                    outros = atual.setdefault("tambem_em", [])
                    if v["fonte"] != atual.get("fonte") and v["link"] and all(o["fonte"] != v["fonte"] for o in outros):
                        outros.append({"fonte": v["fonte"], "link": v["link"]})
                    continue
                if k in hist:
                    n["ja_vistas"] += 1
                    continue
                status, score, motivo = avaliar(v)
                hist[k] = {"titulo": v["titulo"], "empresa": v["empresa"], "fonte": v["fonte"],
                           "status": status or "No painel", "score": score, "local": v.get("local", ""), "modalidade": v.get("modalidade"), "visto_em": HOJE.isoformat(), "link": v["link"]}
                if motivo and status:
                    hist[k]["motivo"] = motivo
                if status:
                    descartes[status] = descartes.get(status, 0) + 1
                    continue
                vid = f"{HOJE.isoformat()}-{slug(v['empresa'])[:30]}-{slug(v['titulo'])[:40]}"
                if vid in ids or vid in fora:
                    continue
                ids.add(vid); n["novas"] += 1
                mod = {"remoto": "Remoto", "hibrido": "Híbrido", "?": "Modalidade a confirmar"}.get(v["modalidade"], v["modalidade"])
                nova = dict(id=vid, data=HOJE.isoformat(), titulo=v["titulo"], empresa=v["empresa"], local=v.get("local", ""),
                            modalidade=mod, score=score, motivo=motivo, fonte=v["fonte"], area=area_de_qualquer(v["titulo"]),
                            link=v["link"], publicada=v.get("data"), prazo=v.get("prazo"), visto_em=HOJE.isoformat())
                req = requisitos(v["titulo"] + " " + (v.get("texto") or ""))
                if req:
                    nova["requisitos"] = req
                vagas.append(nova)
                por_chave[k] = nova
        except Exception as e:  # noqa: BLE001
            log(f"fonte {nome} quebrou:", e)
            falha(f"parou no meio: {e}")
        n["descartes"] = dict(sorted(descartes.items(), key=lambda x: -x[1]))
        n["falhas"] = len(ERROS)
        n["erros"] = ERROS[:3]
        if AVISOS:
            n["portais_sumidos"] = list(AVISOS)
        if nome == "Vagas.com.br":
            n["fila_erros_pendentes"] = len(fila_erros_pendentes())
        resumo[nome] = n
        log(f"{nome}: {n['lidas']} lidas, {n['novas']} novas, {n['falhas']} falhas")

    # Sumiu: a vaga é de um site que entrega a lista inteira, o site respondeu sem falhas e ela não apareceu hoje
    for v in vagas:
        r = resumo.get(v.get("fonte") or "")
        if v.get("fonte") in FONTES_COMPLETAS and r and r["lidas"] and not r["falhas"] and (v.get("visto_em") or "") < HOJE.isoformat():
            v["sumiu"] = True
        else:
            v.pop("sumiu", None)
        if not v.get("tambem_em"):
            v.pop("tambem_em", None)
    for v in vagas:
        v.setdefault("area", area_de_qualquer(v["titulo"]) or "Outras")
    checar_gmail(vagas)
    os.makedirs(os.path.dirname(ARQ_HIST), exist_ok=True)
    salvar_fila_erros()
    pendentes_painel = fila_erros_pendentes()
    agora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    json.dump({"atualizado_em": agora, "fontes": resumo, "fila_erros": pendentes_painel, "vagas": vagas},
              open(ARQ_VAGAS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    gravar_catalogo(hist)
    if rest:
        campos = ["id", "data", "titulo", "empresa", "local", "modalidade", "score", "motivo", "fonte", "area", "link",
                  "publicada", "prazo", "curriculo", "retorno"]
        try:
            # Colunas novas (Também em, visto em, sumiu) e tabela fila_erros_vagas; se o banco recusar, grava só as antigas
            supa.sql(COLUNAS_NOVAS)
            campos += ["tambem_em", "visto_em", "sumiu", "requisitos"]
        except Exception as e:  # noqa: BLE001
            log("Supabase: colunas novas não criadas:", e)
        try:
            rest.upsert("vagas", [{c: v.get(c) for c in campos} for v in vagas])
            rest.upsert("buscas", [{"id": 1, "atualizado_em": agora, "fontes": resumo}])
            if FILA_ERROS_VAGAS:
                campos_fila = ["id", "fonte", "tipo", "termo", "titulo", "empresa", "local", "link", "erro",
                               "codigo_http", "tentativas", "primeira_falha_em", "ultima_tentativa_em", "status_fila"]
                rest.upsert("fila_erros_vagas", [{c: x.get(c) for c in campos_fila} for x in FILA_ERROS_VAGAS])
            log(f"Supabase: {len(vagas)} vagas gravadas")
        except Exception as e:  # noqa: BLE001
            log("Supabase não gravou:", e)
    json.dump(hist, open(ARQ_HIST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    if not os.path.exists(ARQ_ESTADO):
        json.dump(estado, open(ARQ_ESTADO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if sum(r["lidas"] for r in resumo.values()) == 0:
        log("Nenhuma fonte respondeu.")
        sys.exit(1)


if __name__ == "__main__":
    main()
