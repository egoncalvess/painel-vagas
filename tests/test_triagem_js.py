"""Regras de corte, cidade, salário, elegibilidade e fila do painel (docs/radar-app.js).
Roda o código real do bloco <triagem-puras> no node, sem navegador e sem rede."""
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


def bloco_triagem():
    src = open(APP, encoding="utf-8").read()
    sem_acento = re.search(r"^\s*const semAcento=.*$", src, re.M).group(0)
    m = re.search(r"// <triagem-puras>.*?// </triagem-puras>", src, re.S)
    assert m, "bloco <triagem-puras> não encontrado"
    return sem_acento + "\n" + m.group(0)


def rodar(js):
    script = bloco_triagem() + "\nconst __r=(()=>{" + js + "})();\nprocess.stdout.write(JSON.stringify(__r));"
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


PERFIL = ("{city:'Salvador, BA',regionCities:'lauro de freitas, camaçari',acceptRemote:true,acceptHybrid:true,"
          "acceptOnsite:false,salaryMin:6000,salaryAcceptUnknown:true,scoreCutoff:75}")


def test_corte_padrao_75_e_limites():
    r = rodar("return [corteAtual({}),corteAtual({scoreCutoff:''}),corteAtual({scoreCutoff:60}),corteAtual({scoreCutoff:300}),corteAtual({scoreCutoff:-5})]")
    assert r == [75, 75, 60, 100, 0]


def test_elegivel_respeita_corte_74_75_76():
    r = rodar(f"""const p={PERFIL};
      const ctx=n=>({{perfil:p,estado:{{}},nota:n,hoje:'2026-11-24'}});
      const v=id=>({{id,modalidade:'Remoto',local:'Brasil'}});
      return [74,75,76].map(n=>elegivelCom(v('x'+n),ctx(n)));""")
    assert r == [False, True, True]


def test_cidade_compativel():
    r = rodar(f"""const p={PERFIL};
      return {{
        remoto: cidadeCompativel({{modalidade:'Remoto',local:'São Paulo'}},p),
        remotoSemAceite: cidadeCompativel({{modalidade:'Remoto'}},{{...p,acceptRemote:false}}),
        hibridoFora: cidadeCompativel({{modalidade:'Híbrido',local:'Recife, PE'}},p),
        hibridoDentro: cidadeCompativel({{modalidade:'Híbrido',local:'Camaçari, BA'}},p),
        presencialSemAceite: cidadeCompativel({{modalidade:'presencial',local:'Salvador, BA'}},p),
        presencialComAceite: cidadeCompativel({{modalidade:'presencial',local:'Salvador, BA'}},{{...p,acceptOnsite:true}}),
        aConfirmarDentro: cidadeCompativel({{modalidade:'Modalidade a confirmar',local:'Lauro de Freitas'}},p)
      }};""")
    assert r == {"remoto": True, "remotoSemAceite": False, "hibridoFora": False, "hibridoDentro": True,
                 "presencialSemAceite": False, "presencialComAceite": True, "aConfirmarDentro": True}


def test_salario_compativel():
    r = rodar(f"""const p={PERFIL};
      const v=s=>({{requisitos:s?{{salario:s}}:{{}}}});
      return [
        salarioCompativel(v({{min:5000,max:5500}}),p),
        salarioCompativel(v({{min:5000,max:7000}}),p),
        salarioCompativel(v(null),p),
        salarioCompativel(v(null),{{...p,salaryAcceptUnknown:false}}),
        salarioCompativel(v({{min:3000}}),{{...p,salaryMin:0}})
      ];""")
    assert r == [False, True, True, False, True]


def test_motivos_inelegivel_e_exclusoes():
    r = rodar(f"""const p={PERFIL};
      const est={{descartadas:['d'],candidatei:{{c:'2026-11-01'}}}};
      const m=(v,n)=>motivosInelegivel(v,{{perfil:p,estado:est,nota:n,hoje:'2026-11-24'}});
      const base={{modalidade:'Remoto',local:'Brasil'}};
      return {{
        ok: m({{...base,id:'ok'}},90),
        desc: m({{...base,id:'d'}},90),
        cand: m({{...base,id:'c'}},90),
        sumiu: m({{...base,id:'s',sumiu:true}},90),
        prazo: m({{...base,id:'p',prazo:'2026-11-20'}},90),
        baixo: m({{...base,id:'b'}},68)
      }};""")
    assert r["ok"] == []
    assert r["desc"] == ["descartada"]
    assert r["cand"] == ["você já se candidatou"]
    assert r["sumiu"] == ["sumiu na última busca"]
    assert r["prazo"] == ["prazo vencido"]
    assert r["baixo"] == ["abaixo do corte (68 < 75)"]


def test_normalizar_estado_preserva_candidaturas_e_chaves():
    r = rodar("""const e=normalizarEstado({candidatei:{a:'2026-11-01'},salvas:{b:'x'},descartadas:['c','c'],
        candidaturas:{a:{status:'em_fila',atualizado_em:'2026-11-24T10:00:00Z',historico:[{status:'em_fila',em:'2026-11-24'}]},
                      z:{status:'inventado'}},outra:1});
      const vazio=normalizarEstado(null);
      return {e, vazio, recarregado: normalizarEstado(JSON.parse(JSON.stringify(e)))};""")
    assert r["e"]["candidaturas"]["a"]["status"] == "em_fila"
    assert "z" not in r["e"]["candidaturas"]
    assert r["e"]["descartadas"] == ["c"] and r["e"]["salvas"] == {"b": "x"} and r["e"]["outra"] == 1
    assert r["vazio"] == {"candidatei": {}, "salvas": {}, "descartadas": [], "candidaturas": {}}
    assert r["recarregado"] == r["e"]


def test_mesclar_candidaturas_vence_o_mais_recente():
    r = rodar("""return mesclarCandidaturas(
        {a:{status:'em_fila',atualizado_em:'2026-11-24T10:00:00Z'},b:{status:'pulada',atualizado_em:'2026-11-24T12:00:00Z'}},
        {a:{status:'candidatado',atualizado_em:'2026-11-24T11:00:00Z'},b:{status:'em_fila',atualizado_em:'2026-11-24T09:00:00Z'},
         c:{status:'falhou',atualizado_em:'2026-11-24T08:00:00Z'}});""")
    assert {k: v["status"] for k, v in r.items()} == {"a": "candidatado", "b": "pulada", "c": "falhou"}


def test_status_candidatado_tambem_marca_me_candidatei():
    r = rodar("""const e=normalizarEstado({});
      aplicarStatusFila(e,'v1','em_fila',null,'2026-11-24T10:00:00Z');
      aplicarStatusFila(e,'v1','candidatado','enviado','2026-11-25T10:00:00Z');
      let erro=null;try{aplicarStatusFila(e,'v1','xyz',null,'x')}catch(x){erro=x.message}
      return {e,erro,fila:naFilaAtiva(e,'v1')};""")
    assert r["e"]["candidatei"] == {"v1": "2026-11-25"}
    assert [h["status"] for h in r["e"]["candidaturas"]["v1"]["historico"]] == ["em_fila", "candidatado"]
    assert r["erro"] and r["fila"] is False


def test_exportar_fila_sem_dados_sensiveis():
    r = rodar("""const p={name:'Pessoa Teste',city:'Salvador, BA',contact:'pessoa@example.com',phone:'71 99999-0000',
        password:'x',cpf:'000',skills:'Excel, SAP',salaryMin:6000,scoreCutoff:75};
      const est=normalizarEstado({candidaturas:{a:{status:'em_fila',atualizado_em:'t'},b:{status:'candidatado',atualizado_em:'t'}}});
      const vagas=[{id:'a',titulo:'Analista',empresa:'E',link:'https://x',fonte:'Gupy',requisitos:{salario:{min:7000}}},{id:'b',titulo:'B'},{id:'c',titulo:'C'}];
      return montarExportFila(vagas,{perfil:p,estado:est,nota:()=>80,agora:'2026-11-24T00:00:00Z',palavras:()=>['SAP']});""")
    assert r["versao"] == 1 and [i["vaga_id"] for i in r["itens"]] == ["a"]
    item = r["itens"][0]
    assert item["status"] == "em_fila" and item["corte"] == 75 and item["salario"] == {"min": 7000}
    texto = json.dumps(r).lower()
    for proibido in ("password", "cpf", "\"rg\"", "phone", "birth", "99999"):
        assert proibido not in texto
    assert r["perfil"]["skills"] == ["Excel", "SAP"]


def test_importar_resultado_aplica_validos_e_ignora_desconhecidos():
    r = rodar("""const e=normalizarEstado({candidaturas:{a:{status:'em_fila',atualizado_em:'t'}}});
      const res=aplicarResultadoFila(e,{versao:1,itens:[{vaga_id:'a',status:'candidatado',obs:'ok',em:'2026-11-25T10:00:00Z'},
        {vaga_id:'nao-existe',status:'candidatado'},{vaga_id:'a',status:'invalido'}]},new Set(['a']),'2026-11-25T11:00:00Z');
      const antes=JSON.stringify(e);
      let erro=null;try{aplicarResultadoFila(e,{nada:1},new Set(['a']),'x')}catch(x){erro=x.message}
      return {res,e,erro,intacto:antes===JSON.stringify(e)};""")
    assert (r["res"]["aplicados"], r["res"]["ignorados"], r["res"]["invalidos"]) == (1, 1, 1)
    assert r["e"]["candidaturas"]["a"]["status"] == "candidatado" and r["e"]["candidatei"]["a"] == "2026-11-25"
    assert r["erro"] and r["intacto"]
