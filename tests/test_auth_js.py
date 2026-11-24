"""Lógica pura de login e migração do painel (bloco <auth-puras> de docs/radar-app.js), executada no node."""
import json
import os
import re
import shutil
import subprocess

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RAIZ, "docs", "radar-app.js")
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(not NODE, reason="node não instalado")


def codigo():
    src = open(APP, encoding="utf-8").read()
    linhas = [re.search(rf"^\s*const {n}=.*$", src, re.M).group(0) for n in ("semAcento", "slug", "SEM_SESSAO")]
    blocos = [re.search(rf"// <{b}>.*?// </{b}>", src, re.S).group(0) for b in ("triagem-puras", "auth-puras")]
    return "\n".join(linhas + blocos)


def rodar(js):
    script = codigo() + "\nconst __r=(()=>{" + js + "})();\nprocess.stdout.write(JSON.stringify(__r));"
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_site_url_de_producao():
    r = rodar("""return [
      siteUrlDe({origin:'https://egoncalvess.github.io',pathname:'/painel-vagas/'}),
      siteUrlDe({origin:'https://egoncalvess.github.io',pathname:'/painel-vagas/index.html'}),
      siteUrlDe({origin:'http://localhost:8000',pathname:'/'})];""")
    assert r == ["https://egoncalvess.github.io/painel-vagas/", "https://egoncalvess.github.io/painel-vagas/", "http://localhost:8000/"]


def test_email_valido():
    r = rodar("return ['erick','a@b','voce@gmail.com',' voce@gmail.com ','a b@c.d'].map(emailValido);")
    assert r == [False, False, True, True, False]


def test_mensagens_de_erro_do_supabase():
    r = rodar("""return [
      mensagemErroAuth({code:'invalid_credentials',message:'Invalid login credentials',status:400}),
      mensagemErroAuth({message:'Invalid login credentials',status:400}),
      mensagemErroAuth({code:'email_not_confirmed',message:'Email not confirmed'}),
      mensagemErroAuth({code:'over_request_rate_limit',status:429}),
      mensagemErroAuth({status:429,message:'x'}),
      mensagemErroAuth({code:'qualquer',message:'Algo deu errado'})].map(m=>[m.codigo,m.texto]);""")
    assert r[0] == ["invalid_credentials", "E-mail ou senha incorretos."]
    assert r[1][0] == "invalid_credentials"
    assert r[2] == ["email_not_confirmed", "Confirme seu e-mail pelo link que enviamos."]
    assert r[3] == r[4] == ["rate_limit", "Muitas tentativas. Aguarde alguns minutos."]
    assert r[5] == ["qualquer", "Algo deu errado"]


def test_regras_de_senha():
    r = rodar("""return [regrasSenha('curta1','a@b.c').ok, regrasSenha('somenteletras','a@b.c').ok,
      regrasSenha('fulano123','fulano@gmail.com').ok, regrasSenha('Planeja2026!','fulano@gmail.com')];""")
    assert r[:3] == [False, False, False]
    assert r[3]["ok"] is True and r[3]["score"] == 4


def test_hash_de_recuperacao_e_de_erro():
    r = rodar("""return [lerHashAuth('#access_token=x&refresh_token=y&type=recovery'),
      lerHashAuth('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
      lerHashAuth('#login'), lerHashAuth('')];""")
    assert r[0] == {"tipo": "recovery"}
    assert r[1]["tipo"] == "erro" and r[1]["erro"] == "Email link is invalid or has expired"
    assert r[2] == {"tipo": None} and r[3] == {"tipo": None}


UID = "3f1c2b4a-1111-4222-8333-944455556666"


def test_candidatos_migracao():
    r = rodar(f"""return candidatosMigracao({{
      registro:{{'fulano@gmail.com':{{userId:'user-fulano-gmail-com',email:'fulano@gmail.com'}},
                 'erick':{{userId:'erick',username:'erick',email:'erick@radar.local'}},
                 'outro':{{userId:'outra-pessoa',username:'outra'}}}},
      idsComDados:['erick','user-fulano-gmail-com','{UID}','9a9a9a9a-0000-4000-8000-000000000000','guest','__sem_sessao__','sem-registro','ja-migrado'],
      email:'Fulano@gmail.com', uid:'{UID}',
      migrados:{{'ja-migrado':{{para:'x'}},'sem-registro':{{recusado_por:['{UID}']}}}}
    }});""")
    assert r == [{"id": "user-fulano-gmail-com", "correspondente": True}]


def test_migracao_nunca_oferece_conta_de_outra_pessoa():
    """QA: logado como U, o painel ofereceu os dados de 'maria'. Só contas que batem com o e-mail logado aparecem."""
    r = rodar(f"""const base={{
      registro:{{'maria':{{userId:'maria',username:'maria',email:'maria@radar.local'}},
                 'erick':{{userId:'erick',username:'erick',email:'erick@radar.local'}},
                 'pessoa@example.com':{{userId:'legado-pessoa',email:'pessoa@example.com'}}}},
      idsComDados:['maria','erick','legado-pessoa','user-pessoa','user-joao-example-com'],
      uid:'{UID}',migrados:{{}}}};
      return {{
        pessoa: candidatosMigracao({{...base,email:'pessoa@example.com'}}).map(c=>c.id),
        erick: candidatosMigracao({{...base,email:'erick@example.com'}}).map(c=>c.id),
        joao: candidatosMigracao({{...base,email:'joao@example.com'}}).map(c=>c.id),
        ninguem: candidatosMigracao({{...base,email:'outra@example.com'}}).map(c=>c.id)
      }};""")
    assert r["pessoa"] == ["legado-pessoa", "user-pessoa"]  # e-mail igual no registro + id user-<slug do usuário>
    assert r["erick"] == ["erick"]  # usuário legado igual à parte antes do @
    assert r["joao"] == ["user-joao-example-com"]  # id user-<slug do e-mail>
    assert r["ninguem"] == []
    assert all("maria" not in v for v in r.values())


def test_contato_do_perfil_vem_da_sessao_e_nunca_e_herdado():
    r = rodar("""return [
      perfilComContato({name:'A',contact:''},'Nova@Example.com'),
      perfilComContato({name:'A'},'nova@example.com'),
      perfilComContato({name:'A',contact:'meu@example.com'},'nova@example.com'),
      perfilComContato({name:'A',contact:''},undefined)];""")
    assert [p.get("contact") for p in r] == ["nova@example.com", "nova@example.com", "meu@example.com", ""]


def test_presets_sem_email_fixo():
    src = open(APP, encoding="utf-8").read()
    for nome in ("PRESET_DEFAULT_PROFILE", "PRESET_BLANK_PROFILE"):
        bloco = re.search(rf"const {nome}=\{{.*?\n  \}};", src, re.S).group(0)
        assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", bloco), f"{nome} tem e-mail fixo"
        assert 'contact:""' in bloco
    assert "profile=perfilComContato(profile,usuario?.email);" in src


def test_mesclar_dados_sem_perder_nada():
    r = rodar("""
      const antigo={profiles:{name:'Erick',skills:'SAP',phone:'1',_atualizadoEm:'2026-11-01T00:00:00Z'},
        progress:{candidatei:{a:'2026-11-01'},salvas:{s:'x'},descartadas:['d1'],
          candidaturas:{a:{status:'em_fila',atualizado_em:'2026-11-01'},b:{status:'em_fila',atualizado_em:'2026-11-01'},c:{status:'pulada',atualizado_em:'2026-11-01'}}},
        posts:[{id:1,t:'velho'},{id:2,t:'dois'}]};
      const atual={profiles:{name:'Erick G',skills:'',city:'Salvador',_atualizadoEm:'2026-11-24T00:00:00Z'},
        progress:{candidatei:{z:'2026-11-24'},descartadas:['d2'],candidaturas:{d:{status:'em_fila',atualizado_em:'2026-11-24'}}},
        posts:[{id:1,t:'novo'}]};
      const m=mesclarDadosConta(antigo,atual);
      return {m, antigoIntacto: antigo.posts.length===2 && antigo.profiles.name==='Erick', resumo: resumoDadosConta(antigo), texto: textoMigracao('erick',resumoDadosConta(antigo))};""")
    m = r["m"]
    assert m["profiles"]["name"] == "Erick G" and m["profiles"]["skills"] == "SAP" and m["profiles"]["phone"] == "1" and m["profiles"]["city"] == "Salvador"
    assert set(m["progress"]["candidatei"]) == {"a", "z"} and m["progress"]["salvas"] == {"s": "x"}
    assert sorted(m["progress"]["descartadas"]) == ["d1", "d2"]
    assert sorted(m["progress"]["candidaturas"]) == ["a", "b", "c", "d"]
    assert m["posts"] == [{"id": 1, "t": "novo"}, {"id": 2, "t": "dois"}]
    assert "stories" not in m
    assert r["antigoIntacto"] is True
    assert r["resumo"] == {"perfil": True, "vagas": 4, "posts": 2}
    assert r["texto"] == "Encontramos dados de 'erick' neste navegador (perfil, 4 vagas marcadas, 2 posts). Trazer para sua conta?"


# ---------------------------------------------------------------- conta antiga NÃO correspondente (prova por senha)

REGISTRO_ANTIGO = """{
  erick:{userId:'erick',username:'erick',email:'erick@radar.local',passwordHash:H_ERICK},
  maria:{userId:'maria',username:'maria',passwordHash:H_MARIA},
  semhash:{userId:'sem-hash',username:'semhash'},
  nuvem:{userId:'9a9a9a9a-0000-4000-8000-000000000000',username:'nuvem',passwordHash:H_ERICK}
}"""


def verificar(chamadas, max_=5):
    """Roda uma sequência [usuario, senha] no mesmo verificador (mesmo limite de tentativas)."""
    return rodar_async(f"""
      const H_ERICK=await sha256Hex('SenhaAntiga1'), H_MARIA=await sha256Hex('DaMaria9');
      const v=criarVerificadorContaAntiga({{registro:{REGISTRO_ANTIGO},uid:'{UID}',max:{max_}}});
      const out=[];
      for(const [u,s] of {json.dumps(chamadas)}){{const r=await v(u,s);out.push({{...r,msg:mensagemVerificacao(r).texto}})}}
      return out;""")


def rodar_async(js):
    script = codigo() + "\n(async()=>{const __r=await (async()=>{" + js + "})();process.stdout.write(JSON.stringify(__r));})();"
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_hash_igual_ao_do_login_local_antigo():
    # SHA-256 hexadecimal, como o login local antigo gravava em passwordHash
    r = rodar_async("return await sha256Hex('abc');")
    assert r == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_senha_antiga_certa_libera_a_conta():
    r = verificar([["erick", "SenhaAntiga1"]])
    assert r[0]["status"] == "ok" and r[0]["id"] == "erick"
    r = verificar([["ERICK@radar.local", "SenhaAntiga1"]])
    assert r[0]["status"] == "ok" and r[0]["id"] == "erick"


def test_senha_errada_nao_libera_e_nao_revela_se_a_conta_existe():
    r = verificar([["erick", "errada"], ["ninguem", "errada"], ["erick", ""],
                   ["nuvem", "SenhaAntiga1"]])  # conta do Supabase (uuid) nunca é migrada por aqui
    assert [x["status"] for x in r] == ["invalida"] * 4
    assert all("id" not in x for x in r)
    assert r[0]["msg"].split(".")[0] == r[1]["msg"].split(".")[0] == "Usuário ou senha antigos não conferem"
    assert all("SenhaAntiga1" not in x["msg"] and "errada" not in x["msg"] for x in r)


def test_maria_sem_prova_nunca_e_liberada():
    r = verificar([["maria", "SenhaAntiga1"], ["maria", "chute"]])
    assert [x["status"] for x in r] == ["invalida", "invalida"]
    r = verificar([["maria", "DaMaria9"]])
    assert r[0]["status"] == "ok"  # só com a senha dela


def test_conta_sem_hash_orienta_passo_manual():
    r = verificar([["semhash", "qualquer"]])
    assert r[0]["status"] == "sem_hash" and r[0]["id"] == "sem-hash"
    assert "reatribuir_conta_antiga.sql" in r[0]["msg"] and "sem-hash" in r[0]["msg"]


def test_limite_de_tentativas():
    r = verificar([["erick", "x1"], ["erick", "x2"], ["erick", "x3"], ["erick", "SenhaAntiga1"]], max_=3)
    assert [x["status"] for x in r] == ["invalida", "invalida", "invalida", "bloqueado"]
    assert [x["restantes"] for x in r] == [2, 1, 0, 0]
    assert "Recarregue" in r[3]["msg"]


def test_fluxo_manual_no_painel_nao_guarda_senha():
    src = open(APP, encoding="utf-8").read()
    i = src.index("function perguntarMigracaoManual(){")
    trecho = src[i:src.index("let verificadorSessao=null;", i)]
    assert 'campoSenha.value=""' in trecho and '$("auth-migrar-senha").value=""' in trecho
    assert "localStorage" not in trecho and "gravarGlobal" not in trecho and "console." not in trecho
    assert "sb." not in trecho  # a senha antiga não vai para o servidor
