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

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(RAIZ, "config.json"), encoding="utf-8"))
ARQ_VAGAS = os.path.join(RAIZ, "docs", "vagas.json")
ARQ_ESTADO = os.path.join(RAIZ, "docs", "estado.json")
ARQ_HIST = os.path.join(RAIZ, "dados", "historico.json")

HOJE = dt.date.today()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9"}
S = requests.Session()
S.headers.update(UA)


def log(*a):
    print(*a, flush=True)


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


def todos_termos():
    for prio, lista in CFG["termos"].items():
        for t in lista:
            yield prio, t


# ---------------------------------------------------------------- fontes
# Cada fonte devolve dicts: titulo, empresa, local, modalidade (remoto|hibrido|presencial|?), data (AAAA-MM-DD ou None), link, fonte

GUPY_APIS = ["https://portal.api.gupy.io/api/job", "https://employability-portal.gupy.io/api/v1/jobs", "https://portal.api.gupy.io/api/v1/jobs"]


def _gupy_item(j, empresa=""):
    wt = (j.get("workplaceType") or j.get("workplace_type") or "").lower()
    mod = "remoto" if wt == "remote" or j.get("isRemoteWork") else "hibrido" if wt == "hybrid" else "presencial" if wt in ("on-site", "onsite") else "?"
    end = j.get("address") or {}
    cidade = j.get("city") or (end.get("city") if isinstance(end, dict) else "") or j.get("addressCity") or ""
    estado = j.get("state") or (end.get("state") if isinstance(end, dict) else "") or j.get("addressState") or ""
    return dict(titulo=j.get("name") or j.get("title") or "", empresa=j.get("careerPageName") or empresa,
                local=", ".join(x for x in [cidade, estado] if x), modalidade=mod,
                data=(j.get("publishedDate") or j.get("publishedAt") or "")[:10] or None,
                link=j.get("jobUrl") or j.get("url") or "", fonte="Gupy",
                prazo=(j.get("applicationDeadline") or "")[:10] or None)


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


def fonte_gupy():
    vistos = set()
    api_ok = None
    for _, termo in todos_termos():
        for api in ([api_ok] if api_ok else GUPY_APIS):
            r = get(api, params={"name": termo, "jobName": termo, "limit": 100, "offset": 0})
            if not api_ok:
                log("  gupy api", api, r and r.status_code, (r.text[:150] if r else "").replace("\n", " "))
            if r and r.status_code == 200 and "data" in r.text[:200]:
                api_ok = api
                for j in r.json().get("data", []):
                    if j.get("id") not in vistos:
                        vistos.add(j.get("id"))
                        yield _gupy_item(j)
                break
        else:
            log("  gupy api sem resposta para", termo)
        time.sleep(0.5)
    # Portais das empresas (lista em config.json)
    for portal in CFG.get("gupy_portais", []):
        r = get(portal)
        if not r or r.status_code != 200:
            log("  portal falhou", portal, r and r.status_code)
            continue
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            log("  portal sem __NEXT_DATA__", portal, r.text[:120].replace("\n", " "))
            continue
        achadas = []
        nd = json.loads(m.group(1))
        _achar_vagas(nd, achadas)
        if not achadas and not getattr(fonte_gupy, "_mostrou", False):
            fonte_gupy._mostrou = True
            pp = nd.get("props", {}).get("pageProps", {})
            log("  estrutura gupy:", list(pp.keys())[:20], json.dumps(pp, ensure_ascii=False)[:1500])
        log("  portal", portal, len(achadas), "vagas")
        empresa = re.sub(r"https?://|\.gupy\.io/?", "", portal)
        for j in achadas:
            v = _gupy_item(j, empresa)
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
            log("  linkedin falhou", termo, wt, r and r.status_code)
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


def fonte_vagas_com_br():
    vistos = set()
    for _, termo in todos_termos():
        base = "https://www.vagas.com.br/vagas-de-" + slug(termo)
        for url in (base + "-em-salvador", base):
            r = get(url, params={"ordenar_por": "mais_recentes"})
            if not r or r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for li in soup.select("li.vaga"):
                a = li.select_one("h2 a") or li.select_one("a.link-detalhes-vaga")
                if not a:
                    continue
                link = "https://www.vagas.com.br" + a.get("href", "")
                if link in vistos:
                    continue
                vistos.add(link)
                emp = li.select_one(".emprVaga")
                loc = li.select_one(".vaga-local")
                dtp = li.select_one(".data-publicacao")
                local = re.sub(r"\s+", " ", loc.get_text(" ", strip=True)) if loc else ""
                local = re.split(r"A empresa aceita", local)[0].strip()
                lsa = sem_acento(local)
                mod = "remoto" if "home office" in lsa or "remot" in lsa else "?"
                yield dict(titulo=(a.get("title") or a.get_text(strip=True)), empresa=emp.get_text(strip=True) if emp else "",
                           local=local, modalidade=mod, data=_data_vagas(dtp.get_text(" ", strip=True)) if dtp else None,
                           link=link, fonte="Vagas.com.br")
            time.sleep(1)


FONTES = [("Gupy", fonte_gupy), ("LinkedIn", fonte_linkedin), ("Vagas.com.br", fonte_vagas_com_br)]


# ---------------------------------------------------------------- avaliação

def tem(txt, lista):
    t = sem_acento(txt)
    return any(sem_acento(x) in t for x in lista)


def area_de(titulo):
    for nome, chaves in CFG["areas"]:
        if tem(titulo, chaves):
            return nome
    return None


def na_rms(local):
    return tem(local, CFG["cidades_rms"])


UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split()


def no_brasil(local):
    if tem(local, ["brasil", "brazil"]):
        return True
    m = re.search(r"[,/-]\s*([A-Z]{2})\b", local or "")
    return bool(m and m.group(1) in UFS)


def avaliar(v):
    """Devolve (status, score, motivo). status None = vaga entra no painel."""
    titulo, local = v["titulo"], v.get("local", "")
    area = area_de(titulo)
    if not area or tem(" " + titulo + " ", CFG["fora_da_area"]):
        return "fora da área", None, ""
    if tem(titulo, CFG["formacao_excluida"]):
        return "Descartada (formação)", None, "Formação exigida não aceita Eng. Elétrica"
    if v.get("data"):
        try:
            idade = (HOJE - dt.date.fromisoformat(v["data"][:10])).days
            if idade > CFG["max_dias"]:
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
    rms = na_rms(local)
    if local and not no_brasil(local) and not rms:
        return "Descartada (fora do Brasil)", None, "Vaga fora do Brasil"
    if mod == "presencial" or (mod == "hibrido" and not rms):
        return "Descartada (modalidade)", None, "Presencial ou híbrido fora de Salvador/RMS"
    if mod == "?" and not rms:
        return "Descartada (modalidade)", None, "Fora de Salvador/RMS e sem indicação de remoto"

    pontos, motivos = 25, []
    pontos += {"Planejamento e controle": 35, "Gestão de projetos": 28, "Manutenção": 22, "Trainee": 28, "Engenharia elétrica": 18}[area]
    motivos.append(area)
    if mod == "remoto":
        pontos += 15; motivos.append("remoto")
    elif mod == "hibrido":
        pontos += 15; motivos.append("híbrido em Salvador/RMS")
    else:
        pontos += 6; motivos.append("Salvador/RMS, modalidade a confirmar")
    if tem(titulo, ["elétric", "eletric", "eletrotécn"]):
        pontos += 5; motivos.append("elétrica")
    if tem(titulo + " " + v.get("empresa", ""), CFG["mobilidade"]):
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

def ler(caminho, padrao):
    try:
        return json.load(open(caminho, encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def main():
    painel = ler(ARQ_VAGAS, {"vagas": []})
    estado = ler(ARQ_ESTADO, {"candidatei": {}, "descartadas": []})
    hist = ler(ARQ_HIST, {})
    fora = set(estado.get("descartadas", []))
    vagas = [v for v in painel["vagas"] if v["id"] not in fora]
    ids = {v["id"] for v in vagas}
    chaves = {chave(v["titulo"], v["empresa"]) for v in vagas}
    resumo = {}

    for nome, fn in FONTES:
        n_lidas = n_novas = 0
        try:
            for v in fn():
                n_lidas += 1
                k = chave(v["titulo"], v["empresa"])
                if k in chaves or k in hist:
                    continue
                status, score, motivo = avaliar(v)
                hist[k] = {"titulo": v["titulo"], "empresa": v["empresa"], "fonte": v["fonte"],
                           "status": status or "No painel", "score": score, "visto_em": HOJE.isoformat(), "link": v["link"]}
                if status:
                    continue
                vid = f"{HOJE.isoformat()}-{slug(v['empresa'])[:30]}-{slug(v['titulo'])[:40]}"
                if vid in ids or vid in fora:
                    continue
                chaves.add(k); ids.add(vid); n_novas += 1
                mod = {"remoto": "Remoto", "hibrido": "Híbrido", "?": "Modalidade a confirmar"}.get(v["modalidade"], v["modalidade"])
                vagas.append(dict(id=vid, data=HOJE.isoformat(), titulo=v["titulo"], empresa=v["empresa"], local=v.get("local", ""),
                                  modalidade=mod, score=score, motivo=motivo, fonte=v["fonte"], area=area_de(v["titulo"]),
                                  link=v["link"], publicada=v.get("data"), prazo=v.get("prazo")))
        except Exception as e:  # noqa: BLE001
            log(f"fonte {nome} quebrou:", e)
        resumo[nome] = {"lidas": n_lidas, "novas": n_novas}
        log(f"{nome}: {n_lidas} lidas, {n_novas} novas")

    for v in vagas:
        v.setdefault("area", area_de(v["titulo"]) or "Outras")
    checar_gmail(vagas)
    os.makedirs(os.path.dirname(ARQ_HIST), exist_ok=True)
    json.dump({"atualizado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"), "fontes": resumo, "vagas": vagas},
              open(ARQ_VAGAS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(hist, open(ARQ_HIST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    if not os.path.exists(ARQ_ESTADO):
        json.dump(estado, open(ARQ_ESTADO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if sum(r["lidas"] for r in resumo.values()) == 0:
        log("Nenhuma fonte respondeu.")
        sys.exit(1)


if __name__ == "__main__":
    main()
