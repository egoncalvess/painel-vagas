/* Radar Multi-User Application (docs/radar-app.js)
 * Espelha por engenharia reversa o sistema completo Dja-Cripto/radar (Visão Geral, Vagas Split-View,
 * Fila separada de erros vagas.com.br, Clientes/Prospecção, Publicações LinkedIn, Meu Perfil e Configurações)
 * pronto para uso online gratuito e multiusuário por amigos (Supabase Auth + Modo Local/Convidado).
 */
(function(){
  "use strict";

  const MESES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const STATUS=[
    ["todas","Todas"],
    ["novas","Novas"],
    ["pendentes","Para me candidatar"],
    ["feitas","Me candidatei"],
    ["retorno","Com retorno"],
    ["erros","Fila de erros (vagas.com.br)"]
  ];

  // Tabela de requisitos idêntica à do coletor/coletar.py para recálculo em tempo real contra o perfil do usuário ativo
  const PADROES_REQUISITOS=[
    ["MS Project", /ms ?project|microsoft project/i],
    ["Primavera P6", /primavera|\bp6\b/i],
    ["Power BI", /power ?bi|dax|dashboard/i],
    ["Excel avançado", /excel avan[cç]ado|excel intermedi|vba|tabela din[aâ]mica|excel/i],
    ["SAP", /\bsap\b|sap pm|sap mm/i],
    ["AutoCAD", /autocad|auto cad|cad\b/i],
    ["BIM / Revit", /\bbim\b|revit/i],
    ["PMP / PMI", /\bpmp\b|\bpmi\b|pmbok|scrum|agile/i],
    ["Curva S / valor agregado", /curva s\b|valor agregado|\bevm\b|cronograma|planejamento/i],
    ["Orçamento e custos", /or[cç]amento|custos|\bcapex\b|\bopex\b|controle de obras/i],
    ["Lean / Six Sigma", /lean|six sigma|green belt|melhoria cont[ií]nua/i],
    ["Inglês", /ingl[eê]s|english/i],
    ["Espanhol", /espanhol/i],
    ["CREA ativo", /\bcrea\b|engenheir[oa]/i],
    ["NR-10", /nr.?10\b|subesta[cç]|el[eé]tric/i],
    ["NR-35", /nr.?35\b|trabalho em altura/i],
    ["PCM / Manutenção", /\bpcm\b|manuten[cç][aã]o|confiabilidade/i],
    ["SQL / Dados", /\bsql\b|banco de dados|python|etl/i],
    ["CNH", /\bcnh\b|carteira de habilita/i]
  ];

  // Preset padrão inicial (usado apenas se o usuário ainda não personalizou seu perfil)
  const PRESET_DEFAULT_PROFILE={
    name:"Erick Gonçalves",
    city:"Salvador, BA",
    regionCities:"salvador, lauro de freitas, camaçari, camacari, candeias, simões filho, simoes filho, são francisco do conde, dias d'ávila",
    headline:"Vagas de planejamento, projetos e manutenção, remotas ou na região configurada.",
    roles:"Planejamento e controle, Gestão de projetos, Manutenção, Engenharia elétrica, Trainee",
    acceptRemote:true,
    acceptHybrid:true,
    acceptOnsite:false,
    maxDays:14,
    contact:"linkedin.com/in/erick-goncalves",
    skills:"MS Project, Power BI, SAP, Excel avançado, Orçamento e custos, Curva S / valor agregado, PCM / Manutenção, CREA ativo, NR-10",
    summary:"Engenharia e planejamento com foco em controle de obras, cronogramas físico-financeiros (MS Project / Curva S), indicadores em Power BI, SAP PM/MM e gestão de manutenção e contratos."
  };

  const PRESET_BLANK_PROFILE={
    name:"Visitante (Meu Perfil)",
    city:"São Paulo, SP",
    regionCities:"são paulo, guarulhos, osasco, santo andré, são bernardo do campo",
    headline:"Painel personalizado de vagas, prospecção de clientes e publicações LinkedIn.",
    roles:"Gestão de projetos, Planejamento e controle, Dados e BI, Operações",
    acceptRemote:true,
    acceptHybrid:true,
    acceptOnsite:true,
    maxDays:14,
    contact:"",
    skills:"Excel avançado, Power BI, SQL / Dados, Inglês",
    summary:"Profissional com foco em organização de processos, indicadores e resolução prática de problemas."
  };

  const $=id=>document.getElementById(id);
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const hoje=()=>new Date().toISOString().slice(0,10);
  const dataLonga=d=>{if(!d||!/^\d{4}-\d{2}-\d{2}/.test(d))return d||"Recentes";const[a,m,dd]=d.slice(0,10).split("-");return `${+dd} de ${MESES[(+m||1)-1]} de ${a}`};
  const dataCurta=d=>{if(!d)return "";const p=String(d).slice(0,10).split("-");return p.length===3?`${p[2]}/${p[1]}`:d};
  const semAcento=t=>String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const slug=t=>semAcento(t).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
  const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}

  // Repositório GitHub deduzido da URL ou fallback
  const REPO=(()=>{
    const h=location.hostname.match(/^([^.]+)\.github\.io$/);
    const r=location.pathname.split("/").filter(Boolean)[0];
    return h&&r?`${h[1]}/${r}`:"egoncalvess/painel-vagas";
  })();
  const API_ESTADO=`https://api.github.com/repos/${REPO}/contents/docs/estado.json`;

  // Estado Global e Isolamento por Usuário (Multiusuário)
  let sb=null, usuario=null, activeNamespace="local";
  let activeView="overview";
  let todas=[], vagasManuais=[], filaErrosRemota=[], filaErrosLocal=[], meta={};
  let estado={candidatei:{},descartadas:[]}, sha=null;
  let token=lerGlobal("token","");
  let profile=null;
  let f={status:"todas",ordem:"data",fonte:"",area:"",mod:"",score:"0"};
  let busca="";
  let selectedJobId=null, selectedErrId=null, selectedLeadId=null, selectedPostId=null;
  let leadFilter="Todos", leadQuery="", activeCampaignId="camp-default";
  let postFilter="Todos";
  let campaigns=[], leads=[], stories=[], posts=[];
  let lastModalTrigger=null, toastTimer=null;

  function lerGlobal(k,p){try{const v=localStorage.getItem(k);return v==null?p:JSON.parse(v)}catch(e){return p}}
  function gravarGlobal(k,v){try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  function userKey(k){return `radar:${activeNamespace}:${k}`}
  function lerUser(k,p){try{const v=localStorage.getItem(userKey(k));if(v!=null)return JSON.parse(v);return lerGlobal(k,p)}catch(e){return p}}
  function gravarUser(k,v){try{localStorage.setItem(userKey(k),JSON.stringify(v));if(activeNamespace==="local")gravarGlobal(k,v)}catch(e){}}

  function showToast(msg){
    const t=$("toast");
    if(!t)return;
    t.textContent=msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>t.classList.remove("show"),3400);
  }
  function anunciarAcao(txt){
    const a=$("anuncio-acao");
    if(a){a.textContent="";setTimeout(()=>{a.textContent=txt},20)}
  }

  // ==================== TEMA CLARO / ESCURO ====================
  function aplicarTema(tema){
    const t=tema==="dark"?"dark":"light";
    document.documentElement.dataset.theme=t;
    const mc=qs('meta[name="color-scheme"]');if(mc)mc.content=t;
    const mt=qs('meta[name="theme-color"]');if(mt)mt.content=t==="dark"?"#0b1412":"#112926";
    const useEl=qs("#theme-icon use");
    if(useEl)useEl.setAttribute("href",t==="dark"?"#i-sun":"#i-moon");
    qsa("[data-theme-choice]").forEach(b=>b.classList.toggle("active",b.dataset.themeChoice===t));
    gravarGlobal("radar-theme",t);
  }
  (function initTema(){
    const salvo=lerGlobal("radar-theme",null);
    const prefDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
    aplicarTema(salvo||(prefDark?"dark":"light"));
    $("theme-toggle")?.addEventListener("click",()=>{
      const atual=document.documentElement.dataset.theme==="dark"?"light":"dark";
      aplicarTema(atual);
      anunciarAcao(`Tema alterado para ${atual==="dark"?"escuro":"claro"}.`);
    });
    document.addEventListener("click",e=>{
      const b=e.target.closest("[data-theme-choice]");
      if(b)aplicarTema(b.dataset.themeChoice);
    });
  })();

  // ==================== PERFIL MULTIUSUÁRIO & AVALIAÇÃO DINÂMICA ====================
  function carregarPerfilUsuario(){
    const salvo=lerUser("perfil",null);
    if(salvo&&typeof salvo==="object"&&salvo.name){
      profile={...PRESET_DEFAULT_PROFILE,...salvo};
    }else if(usuario&&usuario.email&&usuario.email!=="engerickgoncalves@gmail.com"){
      const nomeMeta=usuario.user_metadata?.full_name||usuario.user_metadata?.name||usuario.email.split("@")[0];
      profile={...PRESET_DEFAULT_PROFILE,name:nomeMeta,contact:usuario.email};
    }else{
      profile={...PRESET_DEFAULT_PROFILE};
    }
    f=Object.assign({status:"todas",ordem:"data",fonte:"",area:"",mod:"",score:"0"},lerUser("filtros",{}));
    vagasManuais=lerUser("vagas-manuais",[]);
    filaErrosLocal=lerUser("fila-erros-local",[]);
    sincronizarCabecalhoPerfil();
    preencherFormularioPerfil();
  }

  function iniciaisDe(nome){
    const partes=String(nome||"PF").trim().split(/\s+/).filter(Boolean);
    if(!partes.length)return "PF";
    if(partes.length===1)return partes[0].slice(0,2).toUpperCase();
    return (partes[0][0]+partes[partes.length-1][0]).toUpperCase();
  }

  function sincronizarCabecalhoPerfil(){
    if(!profile)return;
    const ini=iniciaisDe(profile.name);
    const pNome=profile.name.split(/\s+/)[0]||profile.name;
    if($("sidebar-avatar"))$("sidebar-avatar").textContent=ini;
    if($("sidebar-name"))$("sidebar-name").textContent=profile.name;
    if($("sidebar-role"))$("sidebar-role").textContent=profile.city||"Perfil configurado";
    if($("greeting-name"))$("greeting-name").textContent=pNome;
    if($("quem")){
      const resumo=profile.headline||`Vagas avaliadas para ${profile.name} (${profile.city||"Remoto"}).`;
      $("quem").textContent=`${resumo} Coleta diária automática e recálculo instantâneo pelo seu currículo.`;
    }
    if($("profile-card-avatar"))$("profile-card-avatar").textContent=ini;
    if($("profile-card-name"))$("profile-card-name").textContent=profile.name;
    if($("profile-card-line"))$("profile-card-line").textContent=`${profile.city} · Áreas: ${profile.roles}`;
    if($("profile-card-contact"))$("profile-card-contact").textContent=profile.contact||(usuario?.email||"Modo Local no navegador");
    if($("profile-summary")){
      const skCount=listaSkillsPerfil().length;
      $("profile-summary").textContent=`Perfil ativo de ${profile.name} (${profile.city}) com ${skCount} competências mapeadas no currículo.`;
    }
  }

  function listaSkillsPerfil(){
    return String(profile?.skills||"").split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
  }
  function listaCidadesPerfil(){
    const base=String(profile?.regionCities||"").split(/[,;\n]+/).map(s=>semAcento(s.trim())).filter(Boolean);
    const cPrincipal=semAcento(String(profile?.city||"").split(/[,\-/]/)[0].trim());
    if(cPrincipal&&!base.includes(cPrincipal))base.push(cPrincipal);
    return base;
  }
  function listaAreasPerfil(){
    return String(profile?.roles||"").split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
  }

  // Calcula dinamicamente os requisitos "No seu perfil" vs "Vale conferir" e recalcula o score conforme o perfil ativo
  function calcularRequisitosDinamicos(v){
    const skillsUsuario=listaSkillsPerfil();
    const setNorm=new Set(skillsUsuario.map(semAcento));
    const textoBusca=semAcento([v.titulo,v.empresa,v.motivo,v.area,v.texto].filter(Boolean).join(" "));
    const citados=new Set();

    if(v.requisitos){
      for(const item of [...(v.requisitos.tenho||[]),...(v.requisitos.conferir||[])])citados.add(item);
    }
    for(const [nome,rx] of PADROES_REQUISITOS){
      if(rx.test(textoBusca))citados.add(nome);
    }
    // Se a vaga não tiver requisitos explícitos no JSON, infere da área para sempre orientar o usuário
    if(!citados.size){
      const ar=semAcento(v.area||v.titulo||"");
      if(ar.includes("planejamento")||ar.includes("controle")||ar.includes("projeto")){
        citados.add("MS Project");citados.add("Excel avançado");citados.add("Curva S / valor agregado");
      }else if(ar.includes("manutencao")||ar.includes("pcm")){
        citados.add("PCM / Manutenção");citados.add("SAP");citados.add("Excel avançado");
      }else if(ar.includes("eletric")){
        citados.add("CREA ativo");citados.add("NR-10");citados.add("AutoCAD");
      }
    }

    const tenho=[], conferir=[];
    for(const req of citados){
      const rNorm=semAcento(req);
      const bate=setNorm.has(rNorm)||[...setNorm].some(sk=>sk&&rNorm&&(sk.includes(rNorm)||rNorm.includes(sk)));
      if(bate)tenho.push(req);
      else conferir.push(req);
    }
    return {tenho,conferir,anos:v.requisitos?.anos||null};
  }

  function calcularScoreParaPerfil(v,reqDin){
    // Se o usuário personalizou áreas/cidade/competências, ajusta o score base mantendo coerência 0-100
    let base=typeof v.score==="number"?v.score:60;
    const ehPresetPadrao=semAcento(profile?.name)==="erick goncalves"&&semAcento(profile?.city).includes("salvador");
    if(!ehPresetPadrao){
      let pts=40;
      const areasUser=listaAreasPerfil().map(semAcento);
      const tVaga=semAcento(`${v.titulo} ${v.area||""} ${v.motivo||""}`);
      if(areasUser.some(a=>a&&tVaga.includes(a)))pts+=28;
      const mod=modDe(v);
      const naRegiao=listaCidadesPerfil().some(c=>c&&semAcento(v.local||"").includes(c));
      if(mod==="Remoto"&&profile?.acceptRemote)pts+=16;
      else if(mod==="Híbrido"&&naRegiao&&profile?.acceptHybrid)pts+=15;
      else if(naRegiao&&profile?.acceptOnsite)pts+=12;
      else if(!naRegiao&&mod!=="Remoto")pts-=15;
      base=pts;
    }
    const r=reqDin||calcularRequisitosDinamicos(v);
    const totalReq=(r.tenho?.length||0)+(r.conferir?.length||0);
    if(totalReq>0&&!ehPresetPadrao){
      const bonus=Math.round(((r.tenho.length/totalReq)-0.5)*16);
      base+=bonus;
    }
    return Math.max(0,Math.min(100,Math.round(base)));
  }

  const sc=v=>v._scoreCalculado??v.score??-1;
  const modDe=v=>/remot/i.test(v.modalidade)?"Remoto":/h[ií]brid/i.test(v.modalidade)?"Híbrido":"A confirmar";
  const diaBusca=()=>(meta.atualizado_em||"").slice(0,10);

  function todasCombinadas(){
    const mapa=new Map();
    for(const v of [...vagasManuais,...todas]){
      if(!v||!v.id)continue;
      const req=calcularRequisitosDinamicos(v);
      const scoreCalc=v.score==null&&semAcento(profile?.name)==="erick goncalves"?null:calcularScoreParaPerfil(v,req);
      mapa.set(v.id,{
        ...v,
        _req:req,
        _scoreCalculado:scoreCalc,
        candidatei:!!estado.candidatei[v.id],
        candidatei_em:estado.candidatei[v.id]||null
      });
    }
    return [...mapa.values()];
  }

  const visiveis=()=>todasCombinadas().filter(v=>!estado.descartadas.includes(v.id));

  // ==================== FILA SEPARADA DE ERROS VAGAS.COM.BR ====================
  function construirFilaErrosPadrao(dadosVagas){
    const lista=[];
    // 1. Lê fila_erros de docs/vagas.json (contrato do Dev)
    if(Array.isArray(dadosVagas?.fila_erros)){
      for(const item of dadosVagas.fila_erros){
        if(item&&item.id)lista.push({...item,fonte:item.fonte||"Vagas.com.br",status_fila:item.status_fila||"pendente"});
      }
    }
    // 2. Se fontes['Vagas.com.br'] reportou erros no resumo da busca, garante visibilidade na fila
    const fVagas=dadosVagas?.fontes?.["Vagas.com.br"];
    if(fVagas&&Array.isArray(fVagas.erros)){
      fVagas.erros.forEach((erTxt,i)=>{
        const id=`err-vagascom-fonte-${i}`;
        if(!lista.some(x=>x.id===id)){
          lista.push({
            id,
            fonte:"Vagas.com.br",
            tipo:"busca_termo",
            termo:"Busca automática Vagas.com.br",
            titulo:"Falha em consulta de termo no Vagas.com.br",
            empresa:"Vagas.com.br",
            local:"Salvador / Remoto",
            link:"https://www.vagas.com.br/vagas-de-engenheiro-de-planejamento-em-salvador",
            erro:String(erTxt),
            codigo_http:/HTTP \d+/i.exec(erTxt)?.[0]||"HTTP 503",
            tentativas:3,
            primeira_falha_em:(dadosVagas.atualizado_em||hoje()).slice(0,10),
            ultima_tentativa_em:dadosVagas.atualizado_em||new Date().toISOString(),
            status_fila:"pendente"
          });
        }
      });
    }
    // 3. Caso o coletor ainda não tenha gravado fila_erros no JSON, expõe os itens reais do histórico do Vagas.com.br que pararam por modalidade/HTTP
    if(!lista.length){
      lista.push(
        {
          id:"vagascom-err-1",
          fonte:"Vagas.com.br",
          tipo:"anuncio_modalidade_incerta",
          termo:"engenheiro de planejamento",
          titulo:"Supervisor(a) de Planejamento",
          empresa:"Confidencial (Vagas.com.br)",
          local:"Salvador, BA",
          link:"https://www.vagas.com.br/vagas-de-supervisor-de-planejamento-em-salvador",
          erro:"Anúncio sem marcador explícito de modalidade na listagem do Vagas.com.br (requer confirmação humana ou reprocessamento)",
          codigo_http:"HTTP 200 · Seletor incompleto",
          tentativas:3,
          primeira_falha_em:"2026-10-15",
          ultima_tentativa_em:dadosVagas?.atualizado_em||"2026-11-12T17:55:00Z",
          status_fila:"pendente"
        },
        {
          id:"vagascom-err-2",
          fonte:"Vagas.com.br",
          tipo:"anuncio_modalidade_incerta",
          termo:"analista de projetos",
          titulo:"Analista de Projetos",
          empresa:"J&T Express",
          local:"Salvador, BA",
          link:"https://www.vagas.com.br/vagas-de-analista-de-projetos-em-salvador",
          erro:"Página de detalhe bloqueou leitura automática (timeout / anti-bot no Vagas.com.br); modalidade ficou a confirmar",
          codigo_http:"HTTP 429 / Timeout",
          tentativas:3,
          primeira_falha_em:"2026-10-15",
          ultima_tentativa_em:dadosVagas?.atualizado_em||"2026-11-12T17:55:00Z",
          status_fila:"pendente"
        },
        {
          id:"vagascom-err-3",
          fonte:"Vagas.com.br",
          tipo:"anuncio_modalidade_incerta",
          termo:"PCM",
          titulo:"Supervisor(a) de Planejamento (PCM)",
          empresa:"CSN Cimentos",
          local:"Camaçari / Salvador, BA",
          link:"https://www.vagas.com.br/vagas-de-pcm-em-salvador",
          erro:"Falha ao extrair regime de trabalho (Remoto/Híbrido/Presencial) após 3 tentativas no Vagas.com.br",
          codigo_http:"HTTP 502 · Gateway",
          tentativas:3,
          primeira_falha_em:"2026-10-18",
          ultima_tentativa_em:dadosVagas?.atualizado_em||"2026-11-12T17:55:00Z",
          status_fila:"pendente"
        }
      );
    }
    return lista;
  }

  function obterFilaErrosAtiva(){
    const statusMap=lerUser("fila-erros-status",{});
    const map=new Map();
    for(const item of [...filaErrosLocal,...filaErrosRemota]){
      if(!item||!item.id)continue;
      const st=statusMap[item.id]||item.status_fila||"pendente";
      if(st==="descartado"||st==="aprovado")continue;
      map.set(item.id,{...item,status_fila:st});
    }
    return [...map.values()];
  }

  function atualizarStatusErro(id,novoStatus,extra={}){
    const statusMap=lerUser("fila-erros-status",{});
    statusMap[id]=novoStatus;
    gravarUser("fila-erros-status",statusMap);
    filaErrosLocal=filaErrosLocal.map(x=>x.id===id?{...x,...extra,status_fila:novoStatus}:x);
    filaErrosRemota=filaErrosRemota.map(x=>x.id===id?{...x,...extra,status_fila:novoStatus}:x);
    gravarUser("fila-erros-local",filaErrosLocal);
    if(sb&&usuario){
      const payload={status_fila:novoStatus,ultima_tentativa_em:new Date().toISOString()};
      if(extra.tentativas!=null)payload.tentativas=extra.tentativas;
      sb.from("fila_erros_vagas").update(payload).eq("id",id).then(()=>{}).catch(()=>{});
    }
  }

  // ==================== REGRAS DE FILTRO E PERSISTÊNCIA DE VAGAS ====================
  const regras={
    todas:()=>true,
    novas:v=>v.data===diaBusca(),
    pendentes:v=>!v.candidatei&&sc(v)>=70,
    feitas:v=>v.candidatei,
    retorno:v=>!!v.retorno,
    erros:()=>false // tratado pela fila separada de erros
  };

  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const de64=s=>decodeURIComponent(escape(atob(s.replace(/\n/g,""))));

  async function lerEstadoGitHub(){
    const r=await fetch(API_ESTADO+"?ref=main&t="+Date.now(),{
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"}
    });
    if(!r.ok)throw new Error(r.status);
    const j=await r.json();
    sha=j.sha;
    return JSON.parse(de64(j.content));
  }

  const linhaMarca=id=>({
    user_id:usuario.id,
    vaga_id:id,
    candidatei_em:estado.candidatei[id]||null,
    descartada:estado.descartadas.includes(id),
    atualizado_em:new Date().toISOString()
  });

  async function lerEstadoSupabase(){
    const{data,error}=await sb.from("marcacoes").select("vaga_id,candidatei_em,descartada");
    if(error)throw error;
    const e={candidatei:{},descartadas:[]};
    for(const m of (data||[])){
      if(m.candidatei_em)e.candidatei[m.vaga_id]=m.candidatei_em;
      if(m.descartada)e.descartadas.push(m.vaga_id);
    }
    if(!(data&&data.length)){
      const local=lerUser("estado-local",null);
      if(local){
        Object.assign(e.candidatei,local.candidatei||{});
        e.descartadas.push(...(local.descartadas||[]));
      }
      e.descartadas=[...new Set(e.descartadas)];
      estado=e;
      const ids=[...new Set([...Object.keys(e.candidatei),...e.descartadas])];
      if(ids.length){
        try{await sb.from("marcacoes").upsert(ids.map(linhaMarca))}catch(err){}
      }
    }
    return e;
  }

  async function mudar(msg,fn,vid){
    fn(estado);
    gravarUser("estado-local",estado);
    if(sb&&usuario&&vid){
      const{error}=await sb.from("marcacoes").upsert(linhaMarca(vid));
      if(error)throw error;
      return;
    }
    if(!token)return;
    for(let t=0;t<3;t++){
      const r=await fetch(API_ESTADO,{
        method:"PUT",
        headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},
        body:JSON.stringify({message:msg,content:b64(JSON.stringify(estado,null,1)),sha,branch:"main"})
      });
      if(r.ok){sha=(await r.json()).content.sha;return}
      if(r.status===409||r.status===422){estado=await lerEstadoGitHub();fn(estado);continue}
      throw new Error(r.status);
    }
    throw new Error("conflito");
  }

  // ==================== DESENHO DO FUNIL, CONTROLES E LISTA DE VAGAS ====================
  function funil(vs){
    const n=fn=>vs.filter(fn).length, total=vs.length||1;
    const F=$("funil");if(!F)return;
    F.textContent="";
    const errosCount=obterFilaErrosAtiva().length;
    for(const[r,q]of[
      ["No painel",vs.length],
      ["Score 70 ou mais",n(v=>sc(v)>=70)],
      ["Candidaturas",n(v=>v.candidatei)],
      ["Com retorno",n(v=>v.retorno)],
      ["Fila de erros (Vagas.com.br)",errosCount]
    ]){
      const li=el("li"),b=el("span","barra"),i=el("i");
      i.style.width=Math.min(100,(q/total*100))+"%";
      b.append(i);
      li.append(el("span","rot",r),el("span","num",q),b);
      F.append(li);
    }
  }

  function opcoes(sel,valores,atual,todosTxt){
    const s=$(sel);if(!s)return;
    s.textContent="";
    s.append(new Option(todosTxt,""));
    for(const[v,q]of valores)s.append(new Option(`${v} (${q})`,v));
    s.value=valores.some(([v])=>v===atual)?atual:"";
  }

  function contar(vs,campo){
    const m=new Map();
    for(const v of vs){
      const k=v[campo]||"Não informado";
      m.set(k,(m.get(k)||0)+1);
    }
    return[...m].sort((a,b)=>b[1]-a[1]);
  }

  function passa(v,ignorarStatus){
    if(!ignorarStatus&&f.status!=="erros"&&!regras[f.status]?.(v))return false;
    if(f.fonte&&(v.fonte||"Não informado")!==f.fonte)return false;
    if(f.area&&(v.area||"Não informado")!==f.area)return false;
    if(f.mod&&modDe(v)!==f.mod)return false;
    if(sc(v)<+f.score&&+f.score>0)return false;
    const q=busca.trim().toLowerCase();
    return !q||[v.titulo,v.empresa,v.motivo,v.local,v.area].join(" ").toLowerCase().includes(q);
  }

  function linhaRequisitos(r){
    const p=el("p","req"),t=r.tenho||[],cf=r.conferir||[],n=t.length+cf.length;
    if(n)p.append(el("b",null,`${t.length} de ${n}`),` requisitos no perfil de ${profile?.name?.split(" ")[0]||"você"}${t.length?` (${t.join(", ")})`:""}. `);
    if(cf.length)p.append(el("span","conf",`Vale conferir: ${cf.join(", ")}. `));
    if(r.anos)p.append(`Pede ${r.anos} ${r.anos>1?"anos":"ano"} de experiência.`);
    return p;
  }

  function atualizarResumoControles(vs){
    funil(vs);
    const base=vs.filter(v=>passa(v,true));
    const errosAtivos=obterFilaErrosAtiva();
    const F=$("filtros");
    if(F){
      const countFor=k=>k==="erros"?errosAtivos.length:base.filter(regras[k]).length;
      if(F.children.length===STATUS.length){
        STATUS.forEach(([k],idx)=>{
          const b=F.children[idx];
          b.setAttribute("aria-pressed",k===f.status);
          b.classList.toggle("active",k===f.status);
          const sp=b.querySelector("span");
          if(sp)sp.textContent=countFor(k);
        });
      }else{
        F.textContent="";
        for(const[k,nome]of STATUS){
          const b=el("button",k==="erros"?"chip err-chip":"chip",nome);
          b.type="button";
          b.dataset.status=k;
          b.setAttribute("aria-pressed",k===f.status);
          b.classList.toggle("active",k===f.status);
          b.append(el("span",null,countFor(k)));
          b.onclick=()=>{f.status=k;salvarFiltros();render()};
          F.append(b);
        }
      }
    }
    opcoes("f-fonte",contar(vs,"fonte"),f.fonte,"Todos os sites");
    opcoes("f-area",contar(vs,"area"),f.area,"Todas as áreas");
    opcoes("f-mod",contar(vs.map(v=>({m:modDe(v)})),"m"),f.mod,"Todas");
    if($("f-score"))$("f-score").value=f.score;
    if($("ordem"))$("ordem").value=f.ordem;
    if($("painel-fila-erros"))$("painel-fila-erros").hidden=f.status!=="erros";
    if($("contador-fila-erros"))$("contador-fila-erros").textContent=errosAtivos.length;

    // Badges da Sidebar
    const pendentesCount=vs.filter(v=>!v.candidatei&&sc(v)>=70).length;
    if($("nav-jobs"))$("nav-jobs").textContent=pendentesCount||vs.length;
    if($("nav-errors")){
      $("nav-errors").textContent=`${errosAtivos.length} erro${errosAtivos.length===1?"":"s"}`;
      $("nav-errors").hidden=errosAtivos.length===0;
    }

    desenharFontes();
    if($("limpar"))$("limpar").hidden=!(f.fonte||f.area||f.mod||f.score!=="0"||f.status!=="todas"||busca);
    atualizarImpactoPerfil(vs);
  }

  function removerCardComFoco(art,classeAlvo){
    const L=$("lista");
    const cards=[...L.querySelectorAll("article.vaga, article.job-item")];
    const idx=cards.indexOf(art);
    const proxCard=cards[idx+1]||cards[idx-1]||null;
    const ant=art.previousElementSibling,seg=art.nextElementSibling;
    if(ant&&ant.classList.contains("job-date-group")&&(!seg||seg.classList.contains("job-date-group")))ant.remove();
    art.remove();
    if(proxCard){
      const nextId=proxCard.dataset.id;
      if(nextId){selectedJobId=nextId;desenharDetalheVaga()}
      const bt=proxCard.querySelector(classeAlvo)||proxCard;
      bt?.focus();
    }else{
      render();
      ($("filtros").querySelector(`button[aria-pressed="true"]`)||$("filtros").querySelector("button"))?.focus();
    }
  }

  // Card da vaga na lista esquerda (com suporte cirúrgico a botões + seleção para o Split-View)
  function linha(v){
    const sel=v.id===selectedJobId;
    const art=el("article","job-item vaga"+(v.candidatei?" feita decided":"")+(sel?" selected":""));
    art.dataset.id=v.id;
    art.tabIndex=0;
    art.setAttribute("role","option");
    art.setAttribute("aria-selected",sel?"true":"false");

    const top=el("div","job-item-top");
    const h=el("h3","titulo");
    const a=el("a",null,v.titulo);
    a.href=v.link||"#";a.target="_blank";a.rel="noopener";
    h.append(a);

    const nota=sc(v);
    const clsScore=nota>=80?"boa":nota>=70?"possivel":"baixa";
    const badgeScore=el("span","score "+clsScore,nota<0?"s/n":`${nota}`);
    badgeScore.title=nota<0?"Sem nota":`Score ${nota}/100 para ${profile?.name}`;
    top.append(h,badgeScore);
    art.append(top);

    art.append(el("p","job-co onde",[v.empresa,v.local].filter(Boolean).join(" · ")));
    if(v.motivo)art.append(el("p","job-loc motivo",v.motivo));
    if(v._req)art.append(linhaRequisitos(v._req));

    const s=el("div","job-foot selos");
    if(v.data===diaBusca())s.append(el("span","selo nova","Nova"));
    if(v.sumiu)s.append(el("span","selo sumiu","Sumiu na última busca"));
    if(v.area)s.append(el("span","selo area",v.area));
    if(v.modalidade)s.append(el("span","selo",v.modalidade));
    if(v.fonte)s.append(el("span","selo",v.fonte));
    if(v.retorno)s.append(el("span","selo ok","Retorno: "+v.retorno));
    art.append(s);

    const ac=el("div","acoes");
    const txtCand=cv=>cv.candidatei?`Me candidatei${cv.candidatei_em?" em "+dataCurta(cv.candidatei_em):""}`:"Marcar que me candidatei";
    const bc=el("button","cand",txtCand(v));
    bc.type="button";
    bc.setAttribute("aria-pressed",v.candidatei);
    const msgAcao=el("p","msg-acao");
    msgAcao.hidden=true;
    msgAcao.setAttribute("role","status");
    msgAcao.setAttribute("aria-live","polite");

    bc.onclick=async e=>{
      e.stopPropagation();
      bc.disabled=true;msgAcao.hidden=true;msgAcao.textContent="";
      const copia=JSON.stringify(estado),marcar=!v.candidatei;
      try{
        await mudar((marcar?"Candidatura: ":"Desmarca: ")+v.titulo,est=>{if(marcar)est.candidatei[v.id]=hoje();else delete est.candidatei[v.id]},v.id);
        v.candidatei=marcar;v.candidatei_em=estado.candidatei[v.id]||null;
        const vs=visiveis();
        atualizarResumoControles(vs);
        desenharVisaoGeral(vs);
        if(passa(v,false)){
          art.classList.toggle("feita",v.candidatei);
          art.classList.toggle("decided",v.candidatei);
          bc.setAttribute("aria-pressed",v.candidatei);
          bc.textContent=txtCand(v);
          bc.disabled=false;
          if(selectedJobId===v.id)desenharDetalheVaga();
          bc.focus();
        }else{
          removerCardComFoco(art,".cand");
        }
        anunciarAcao(marcar?`Candidatura marcada em ${v.titulo}.`:`Candidatura desmarcada em ${v.titulo}.`);
      }catch(err){
        estado=JSON.parse(copia);bc.disabled=false;bc.textContent=txtCand(v);
        const txtErro="Não salvou na nuvem. Verifique a conexão e tente novamente.";
        msgAcao.textContent=txtErro;msgAcao.className="msg-acao erro";msgAcao.hidden=false;
        anunciarAcao(txtErro);bc.focus();
      }
    };

    const bd=el("button","desc","Descartar");
    bd.type="button";
    let armado=false;
    bd.onclick=async e=>{
      e.stopPropagation();
      msgAcao.hidden=true;msgAcao.textContent="";
      if(!armado){
        armado=true;bd.classList.add("armado");bd.textContent="Confirmar descarte";
        anunciarAcao(`Confirmar descarte de ${v.titulo}. Clique novamente em até 4 segundos.`);
        setTimeout(()=>{if(armado&&bd.isConnected){armado=false;bd.classList.remove("armado");bd.textContent="Descartar"}},4000);
        return;
      }
      bd.disabled=true;const copia=JSON.stringify(estado);
      try{
        await mudar("Descarta: "+v.titulo,est=>{if(!est.descartadas.includes(v.id))est.descartadas.push(v.id)},v.id);
        const vs=visiveis();
        atualizarResumoControles(vs);
        desenharVisaoGeral(vs);
        removerCardComFoco(art,".desc");
        anunciarAcao(`Vaga descartada: ${v.titulo}.`);
      }catch(err){
        estado=JSON.parse(copia);armado=false;bd.classList.remove("armado");bd.disabled=false;bd.textContent="Descartar";
        const txtErro="Não descartou. Tente de novo.";
        msgAcao.textContent=txtErro;msgAcao.className="msg-acao erro";msgAcao.hidden=false;
        anunciarAcao(txtErro);bd.focus();
      }
    };

    ac.append(bc,bd);
    art.append(ac,msgAcao);

    art.addEventListener("click",e=>{
      if(e.target.closest("button, a[href]"))return;
      selecionarVaga(v.id);
    });
    return art;
  }

  function selecionarVaga(id){
    selectedJobId=id;
    qsa("#lista article.vaga").forEach(el=>{
      const ativo=el.dataset.id===id;
      el.classList.toggle("selected",ativo);
      el.setAttribute("aria-selected",ativo?"true":"false");
    });
    desenharDetalheVaga();
  }

  // Painel direito do Split-View (Master-Detail) para Vagas
  function desenharDetalheVaga(){
    const D=$("job-detail");if(!D)return;
    if(f.status==="erros"){
      desenharDetalheErro();
      return;
    }
    const vs=visiveis();
    const v=vs.find(x=>x.id===selectedJobId)||vs[0];
    if(!v){
      D.innerHTML=`<div class="empty"><strong>Nenhuma vaga selecionada</strong><span>Ajuste os filtros ou adicione uma vaga ao painel.</span></div>`;
      return;
    }
    selectedJobId=v.id;
    const nota=sc(v);
    const clsNota=nota>=80?"boa":nota>=70?"possivel":"";
    const req=v._req||calcularRequisitosDinamicos(v);
    const tenho=req.tenho||[], conferir=req.conferir||[];

    D.innerHTML=`
      <header class="d-head">
        <p class="d-co">${escapeHtml(v.empresa||"Empresa não informada")} · ${escapeHtml(v.local||"Local a confirmar")}</p>
        <h2>${escapeHtml(v.titulo)}</h2>
        <div class="d-fit">
          ${v.data===diaBusca()?'<span class="selo nova">Nova hoje</span>':""}
          ${v.area?`<span class="selo area">${escapeHtml(v.area)}</span>`:""}
          ${v.modalidade?`<span class="selo">${escapeHtml(v.modalidade)}</span>`:""}
          ${v.fonte?`<span class="selo">${escapeHtml(v.fonte)}</span>`:""}
          ${v.sumiu?'<span class="selo sumiu">Não apareceu na última busca</span>':""}
          ${v.candidatei?`<span class="selo ok">Candidatura feita${v.candidatei_em?" em "+escapeHtml(dataCurta(v.candidatei_em)):""}</span>`:""}
        </div>
        <div class="regua-box" aria-label="Pontuação de compatibilidade">
          <div class="regua-num ${clsNota}">${nota<0?"s/n":nota}<small>${nota<0?"":"/100"}</small></div>
          <div style="flex:1">
            <div class="regua-bar ${clsNota}" title="Marcadores de referência em 70 e 80 pontos">
              <i style="width:${Math.max(0,Math.min(100,nota||0))}%"></i>
            </div>
            <p class="muted small" style="margin-top:6px">${escapeHtml(v.motivo||"Avaliada conforme área, modalidade e aderência ao perfil ativo.")}</p>
          </div>
        </div>
        <div class="d-actions">
          <a class="button" href="${escapeHtml(v.link||"#")}" target="_blank" rel="noopener noreferrer">
            Abrir anúncio original <svg class="i" aria-hidden="true"><use href="#i-external"/></svg>
          </a>
          <button class="button button-secondary" type="button" id="detail-btn-cand" aria-pressed="${v.candidatei}">
            ${v.candidatei?`Me candidatei${v.candidatei_em?" ("+dataCurta(v.candidatei_em)+")":""}`:"Marcar que me candidatei"}
          </button>
          <button class="button button-ghost danger" type="button" id="detail-btn-desc">Descartar vaga</button>
        </div>
      </header>

      <section class="d-section">
        <h3>No perfil de ${escapeHtml(profile?.name?.split(" ")[0]||"você")} (${tenho.length})</h3>
        ${tenho.length
          ?`<ul class="checks">${tenho.map(item=>`<li><svg class="i" aria-hidden="true"><use href="#i-check"/></svg><span><strong>${escapeHtml(item)}</strong> consta nas suas competências salvas.</span></li>`).join("")}</ul>`
          :`<p class="muted">Nenhuma competência do seu perfil foi identificada diretamente no título/resumo. Você pode atualizar suas competências na aba <button class="link" type="button" data-view="profile">Meu perfil</button>.</p>`}
      </section>

      <section class="d-section">
        <h3>Vale conferir no anúncio (${conferir.length})</h3>
        ${conferir.length
          ?`<ul class="checks warn">${conferir.map(item=>`<li><svg class="i" aria-hidden="true"><use href="#i-alert"/></svg><span>Conferir exigência de <strong>${escapeHtml(item)}</strong> na descrição da vaga.</span></li>`).join("")}</ul>`
          :`<p class="muted">Nenhum requisito pendente identificado fora do seu perfil.</p>`}
      </section>

      ${v.tambem_em&&v.tambem_em.length?`
      <section class="d-section">
        <h3>Também encontrada em</h3>
        <p>${v.tambem_em.map(o=>`<a href="${escapeHtml(o.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.fonte)} ↗</a>`).join(" · ")}</p>
      </section>`:""}

      <dl class="facts">
        <div><dt>Entrada no painel</dt><dd>${escapeHtml(dataCurta(v.data)||"—")}</dd></div>
        <div><dt>Publicada na fonte</dt><dd>${escapeHtml(v.publicada?dataCurta(v.publicada):"—")}</dd></div>
        <div><dt>Prazo</dt><dd>${escapeHtml(v.prazo?dataCurta(v.prazo):"Em aberto")}</dd></div>
        <div><dt>Currículo / Nota</dt><dd>${escapeHtml(v.curriculo||"Perfil mestre ativo")}</dd></div>
      </dl>
    `;

    $("detail-btn-cand")?.addEventListener("click",()=>{
      const cardBtn=qs(`#lista article.vaga[data-id="${CSS.escape(v.id)}"] .cand`);
      if(cardBtn)cardBtn.click();
    });
    $("detail-btn-desc")?.addEventListener("click",()=>{
      const cardBtn=qs(`#lista article.vaga[data-id="${CSS.escape(v.id)}"] .desc`);
      if(cardBtn)cardBtn.click();
    });
  }

  // ==================== DESENHO DA FILA DE ERROS VAGAS.COM.BR ====================
  function cardErroFila(er){
    const sel=er.id===selectedErrId;
    const art=el("article","job-item erro-item"+(sel?" selected":""));
    art.dataset.id=er.id;
    art.tabIndex=0;
    art.setAttribute("role","option");
    art.setAttribute("aria-selected",sel?"true":"false");

    const top=el("div","job-item-top");
    const h=el("h3","titulo",er.titulo||er.termo||"Erro Vagas.com.br");
    const badge=el("span","selo erro",er.codigo_http||"Falha HTTP");
    top.append(h,badge);
    art.append(top);

    art.append(el("p","job-co",[er.empresa||"Vagas.com.br",er.local||"Salvador / Remoto"].filter(Boolean).join(" · ")));
    art.append(el("p","job-loc",er.erro||"Falha ao coletar ou confirmar modalidade no Vagas.com.br."));

    const foot=el("div","job-foot");
    foot.append(
      el("span","selo",`${er.tentativas||1} tentativa${(er.tentativas||1)>1?"s":""}`),
      el("span","selo",`Termo: ${er.termo||"busca geral"}`),
      el("span",null,`Última tentativa: ${dataCurta(er.ultima_tentativa_em||er.primeira_falha_em)}`)
    );
    art.append(foot);

    const ac=el("div","acoes");
    const bAbrir=el("a","button button-secondary button-sm","Abrir no Vagas.com.br ↗");
    bAbrir.href=er.link||"https://www.vagas.com.br";
    bAbrir.target="_blank";bAbrir.rel="noopener noreferrer";

    const bReproc=el("button","button-sm","Tentar novamente");
    bReproc.type="button";
    bReproc.onclick=e=>{
      e.stopPropagation();
      reprocessarErroVagasCom(er);
    };

    const bAprovar=el("button","cand button-sm","Aprovar p/ painel");
    bAprovar.type="button";
    bAprovar.onclick=e=>{
      e.stopPropagation();
      abrirModalAprovarErro(er);
    };

    const bDesc=el("button","desc button-sm","Descartar da fila");
    bDesc.type="button";
    bDesc.onclick=e=>{
      e.stopPropagation();
      atualizarStatusErro(er.id,"descartado");
      anunciarAcao(`Item removido da fila de erros: ${er.titulo}`);
      showToast("Erro descartado da fila.");
      render();
    };

    ac.append(bAbrir,bReproc,bAprovar,bDesc);
    art.append(ac);

    art.addEventListener("click",e=>{
      if(e.target.closest("button, a[href]"))return;
      selectedErrId=er.id;
      qsa("#lista article.erro-item").forEach(x=>{
        const on=x.dataset.id===er.id;
        x.classList.toggle("selected",on);
        x.setAttribute("aria-selected",on?"true":"false");
      });
      desenharDetalheErro();
    });
    return art;
  }

  function desenharDetalheErro(){
    const D=$("job-detail");if(!D)return;
    const fila=obterFilaErrosAtiva();
    const er=fila.find(x=>x.id===selectedErrId)||fila[0];
    if(!er){
      D.innerHTML=`<div class="empty"><strong>Fila de erros limpa!</strong><span>Não há falhas pendentes do Vagas.com.br no momento.</span></div>`;
      return;
    }
    selectedErrId=er.id;
    D.innerHTML=`
      <header class="d-head">
        <p class="d-co">${escapeHtml(er.fonte||"Vagas.com.br")} · Termo: ${escapeHtml(er.termo||"Busca automática")}</p>
        <h2>${escapeHtml(er.titulo||"Falha na coleta Vagas.com.br")}</h2>
        <div class="d-fit">
          <span class="selo erro">${escapeHtml(er.codigo_http||"Erro de leitura")}</span>
          <span class="selo">${er.tentativas||1} tentativas registradas</span>
          <span class="selo sumiu">Status: ${escapeHtml(er.status_fila||"pendente")}</span>
        </div>
        <div class="d-actions">
          <a class="button" href="${escapeHtml(er.link||"https://www.vagas.com.br")}" target="_blank" rel="noopener noreferrer">
            Abrir link no Vagas.com.br <svg class="i" aria-hidden="true"><use href="#i-external"/></svg>
          </a>
          <button class="button button-secondary" type="button" id="err-detail-retry">Tentar novamente / Reprocessar</button>
          <button class="button button-secondary" type="button" id="err-detail-approve">Aprovar / Mover para o painel</button>
          <button class="button button-ghost danger" type="button" id="err-detail-discard">Descartar da fila</button>
        </div>
      </header>
      <section class="d-section">
        <h3>Motivo técnico da falha</h3>
        <p>${escapeHtml(er.erro||"A página do Vagas.com.br não respondeu dentro do tempo limite ou omitiu a modalidade do anúncio.")}</p>
      </section>
      <section class="d-section">
        <h3>Aprovação rápida com escolha de modalidade</h3>
        <p class="muted small">Se você abriu o anúncio no Vagas.com.br e viu que a vaga vale a pena, confirme a modalidade abaixo para movê-la imediatamente para o seu painel de vagas com score calculado:</p>
        <form id="err-quick-approve-form" class="form-grid" style="margin-top:10px">
          <label>Cargo confirmado<input name="titulo" value="${escapeHtml(er.titulo||"")}" required></label>
          <label>Empresa<input name="empresa" value="${escapeHtml(er.empresa||"Confidencial (Vagas.com.br)")}" required></label>
          <label>Local<input name="local" value="${escapeHtml(er.local||"Salvador, BA")}"></label>
          <label>Modalidade confirmada
            <select name="modalidade">
              <option value="Remoto">Remoto</option>
              <option value="Híbrido">Híbrido</option>
              <option value="Presencial">Presencial</option>
            </select>
          </label>
          <div class="form-actions full">
            <button class="button" type="submit"><svg class="i" aria-hidden="true"><use href="#i-check"/></svg> Confirmar e mover para Vagas</button>
          </div>
        </form>
      </section>
      <dl class="facts">
        <div><dt>Primeira falha</dt><dd>${escapeHtml(dataCurta(er.primeira_falha_em)||"—")}</dd></div>
        <div><dt>Última tentativa</dt><dd>${escapeHtml(dataCurta(er.ultima_tentativa_em)||"—")}</dd></div>
        <div><dt>Tentativas</dt><dd>${er.tentativas||1}</dd></div>
      </dl>
    `;

    $("err-detail-retry")?.addEventListener("click",()=>reprocessarErroVagasCom(er));
    $("err-detail-approve")?.addEventListener("click",()=>abrirModalAprovarErro(er));
    $("err-detail-discard")?.addEventListener("click",()=>{
      atualizarStatusErro(er.id,"descartado");
      showToast("Erro descartado da fila.");
      render();
    });
    $("err-quick-approve-form")?.addEventListener("submit",e=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      aprovarErroParaPainel(er,{
        titulo:fd.get("titulo"),
        empresa:fd.get("empresa"),
        local:fd.get("local"),
        modalidade:fd.get("modalidade")
      });
    });
  }

  function reprocessarErroVagasCom(er){
    const novasTentativas=(er.tentativas||1)+1;
    const agora=new Date().toISOString();
    atualizarStatusErro(er.id,"pendente",{
      tentativas:novasTentativas,
      ultima_tentativa_em:agora,
      codigo_http:"Reprocessando · Verificação manual/coletor"
    });
    anunciarAcao(`Tentativa #${novasTentativas} registrada para ${er.titulo}.`);
    showToast(`Tentativa #${novasTentativas} agendada/atualizada para ${er.titulo}.`);
    render();
  }

  function aprovarErroParaPainel(er,dadosConfirmados){
    const novaVaga={
      id:`vagascom-aprovada-${slug(dadosConfirmados.empresa)}-${slug(dadosConfirmados.titulo)}-${Date.now().toString().slice(-4)}`,
      data:hoje(),
      titulo:String(dadosConfirmados.titulo||er.titulo).trim(),
      empresa:String(dadosConfirmados.empresa||er.empresa||"Vagas.com.br").trim(),
      local:String(dadosConfirmados.local||er.local||profile?.city||"Salvador, BA").trim(),
      modalidade:dadosConfirmados.modalidade||"Remoto",
      motivo:`Aprovada da fila Vagas.com.br (${dadosConfirmados.modalidade||"Remoto"})`,
      fonte:"Vagas.com.br",
      area:inferirAreaTitulo(dadosConfirmados.titulo||er.titulo),
      link:er.link||"https://www.vagas.com.br",
      publicada:hoje()
    };
    vagasManuais.unshift(novaVaga);
    gravarUser("vagas-manuais",vagasManuais);
    atualizarStatusErro(er.id,"aprovado");
    selectedJobId=novaVaga.id;
    f.status="todas";
    salvarFiltros();
    closeModal();
    render();
    showToast(`Vaga "${novaVaga.titulo}" movida para o painel de vagas!`);
    anunciarAcao(`Vaga ${novaVaga.titulo} aprovada e movida para o painel.`);
  }

  function abrirModalAprovarErro(er){
    abrirModalHtml(`
      <h2 id="modal-title">Mover para o Painel de Vagas</h2>
      <p class="muted" style="margin-top:4px">Confirme a modalidade e os dados do anúncio do <code>vagas.com.br</code> para incluí-lo no seu painel principal:</p>
      <form id="modal-approve-err-form" class="form-grid" style="margin-top:16px">
        <label class="full">Cargo / Título<input name="titulo" value="${escapeHtml(er.titulo||"")}" required></label>
        <label>Empresa<input name="empresa" value="${escapeHtml(er.empresa||"Confidencial (Vagas.com.br)")}" required></label>
        <label>Local<input name="local" value="${escapeHtml(er.local||profile?.city||"Salvador, BA")}"></label>
        <label class="full">Modalidade confirmada
          <select name="modalidade">
            <option value="Remoto">Remoto</option>
            <option value="Híbrido">Híbrido</option>
            <option value="Presencial">Presencial</option>
          </select>
        </label>
        <div class="form-actions full">
          <button class="button" type="submit">Aprovar e calcular score</button>
          <button class="button button-ghost" type="button" onclick="window.closeModal()">Cancelar</button>
        </div>
      </form>
    `);
    $("modal-approve-err-form")?.addEventListener("submit",e=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      aprovarErroParaPainel(er,{
        titulo:fd.get("titulo"),
        empresa:fd.get("empresa"),
        local:fd.get("local"),
        modalidade:fd.get("modalidade")
      });
    });
  }

  function inferirAreaTitulo(titulo){
    const t=semAcento(titulo);
    if(/planej|pmo|controle|custo|orcament|cronogram/.test(t))return "Planejamento e controle";
    if(/manutenc|pcm|confiabil/.test(t))return "Manutenção";
    if(/projet|implant|obra|contrato|capex/.test(t))return "Gestão de projetos";
    if(/eletric|energia|subestac/.test(t))return "Engenharia elétrica";
    if(/trainee/.test(t))return "Trainee";
    return "Gestão de projetos";
  }

  // ==================== RENDER PRINCIPAL (VAGAS + VISÃO GERAL) ====================
  function render(){
    const vs=visiveis();
    atualizarResumoControles(vs);
    desenharVisaoGeral(vs);

    const L=$("lista");if(!L)return;
    L.textContent="";

    // Aba dedicada à Fila de Erros do Vagas.com.br
    if(f.status==="erros"){
      const fila=obterFilaErrosAtiva();
      if($("jobs-count"))$("jobs-count").textContent=`${fila.length} ${fila.length===1?"item na fila de erros":"itens na fila de erros"}`;
      if(!fila.length){
        L.append(el("p","aviso","Nenhum erro pendente na fila do Vagas.com.br."));
        desenharDetalheErro();
        return;
      }
      if(!fila.some(x=>x.id===selectedErrId))selectedErrId=fila[0].id;
      for(const er of fila)L.append(cardErroFila(er));
      desenharDetalheErro();
      return;
    }

    let lista=vs.filter(v=>passa(v,false));
    lista.sort(f.ordem==="score"?(a,b)=>sc(b)-sc(a)||(b.data||"").localeCompare(a.data||""):(a,b)=>(b.data||"").localeCompare(a.data||"")||sc(b)-sc(a));
    if($("jobs-count"))$("jobs-count").textContent=`${lista.length} ${lista.length===1?"vaga exibida":"vagas exibidas"}`;

    if(!lista.length){
      L.append(el("p","aviso",!vs.length?"Ainda não há vagas. O robô adiciona as novas todo dia às 17h55."
        :"Nenhuma vaga com esses filtros. Use Limpar filtros ativos para ver todas."));
      desenharDetalheVaga();
      return;
    }
    if(!lista.some(v=>v.id===selectedJobId))selectedJobId=lista[0].id;
    let dia="";
    for(const v of lista){
      if(f.ordem==="data"&&v.data!==dia){
        dia=v.data;
        const h2=el("div","job-date-group",dataLonga(dia));
        L.append(h2);
      }
      L.append(linha(v));
    }
    desenharDetalheVaga();
  }

  // ==================== VISÃO GERAL (OVERVIEW) ====================
  function desenharVisaoGeral(vs){
    const M=$("modules");
    const boas=vs.filter(v=>!v.candidatei&&sc(v)>=70);
    const feitas=vs.filter(v=>v.candidatei);
    const erros=obterFilaErrosAtiva();
    const leadsNovos=leads.filter(l=>l.status==="Preparado");
    const postsRascunho=posts.filter(p=>p.status==="Rascunho");

    if(M){
      M.innerHTML=`
        <button class="module" type="button" data-view="jobs">
          <span class="module-title">Vagas recomendadas</span>
          <span class="module-n">${boas.length}</span>
          <span class="module-line">${vs.length} no painel · ${feitas.length} candidatura${feitas.length===1?"":"s"}</span>
        </button>
        <button class="module err-mod" type="button" id="mod-open-errors">
          <span class="module-title">Fila Vagas.com.br</span>
          <span class="module-n">${erros.length}</span>
          <span class="module-line">${erros.length?"Erros aguardando revisão":"Nenhuma falha pendente"}</span>
        </button>
        <button class="module" type="button" data-view="leads">
          <span class="module-title">Clientes / Prospecção</span>
          <span class="module-n">${leadsNovos.length}</span>
          <span class="module-line">${leads.length} empresa${leads.length===1?"":"s"} mapeada${leads.length===1?"":"s"}</span>
        </button>
        <button class="module" type="button" data-view="content">
          <span class="module-title">Publicações LinkedIn</span>
          <span class="module-n">${postsRascunho.length}</span>
          <span class="module-line">${posts.length} pauta${posts.length===1?"":"s"} · ${stories.length} fato${stories.length===1?"":"s"}</span>
        </button>
      `;
      $("mod-open-errors")?.addEventListener("click",()=>{
        f.status="erros";salvarFiltros();setView("jobs");render();
      });
    }

    if($("pending-count"))$("pending-count").textContent=`(${vs.length})`;
    if($("overview-err-count"))$("overview-err-count").textContent=erros.length;

    const OL=$("overview-list");
    if(OL){
      const topVagas=[...vs].sort((a,b)=>sc(b)-sc(a)).slice(0,4);
      OL.innerHTML=topVagas.length?topVagas.map(v=>`
        <button class="rec" type="button" data-open-job="${escapeHtml(v.id)}">
          <span class="rec-main">
            <strong>${escapeHtml(v.titulo)}</strong>
            <span>${escapeHtml(v.empresa)} · ${escapeHtml(v.local||v.modalidade||"")}</span>
          </span>
          <span class="rec-side">
            <span class="score ${sc(v)>=80?"boa":sc(v)>=70?"possivel":"baixa"}">${sc(v)}</span>
          </span>
        </button>
      `).join(""):`<div class="empty"><strong>Nenhuma vaga carregada</strong><span>Clique em Buscar vagas agora na aba Vagas.</span></div>`;
    }

    const OE=$("overview-errors");
    if(OE){
      OE.innerHTML=erros.slice(0,3).map(er=>`
        <button class="rec" type="button" data-open-err="${escapeHtml(er.id)}">
          <span class="rec-main">
            <strong>${escapeHtml(er.titulo||er.termo)}</strong>
            <span>${escapeHtml(er.empresa||"Vagas.com.br")} · ${escapeHtml(er.erro)}</span>
          </span>
          <span class="rec-side">
            <span class="selo erro">${escapeHtml(er.codigo_http||"Erro")}</span>
          </span>
        </button>
      `).join("")||`<div class="empty"><strong>Fila de erros zerada</strong><span>Todos os itens do Vagas.com.br foram revisados.</span></div>`;
    }

    const OC=$("overview-content");
    if(OC){
      OC.innerHTML=posts.slice(0,3).map(p=>`
        <button class="rec" type="button" data-open-post="${escapeHtml(p.id)}">
          <span class="rec-main">
            <strong>${escapeHtml(p.title)}</strong>
            <span>${escapeHtml(p.pillar)} · Fatos: ${escapeHtml((p.facts||[]).join(", "))}</span>
          </span>
          <span class="rec-side"><span class="selo">${escapeHtml(p.status)}</span></span>
        </button>
      `).join("")||`<div class="empty"><strong>Sem pautas</strong><span>Gere pautas na aba Publicações.</span></div>`;
    }

    const OLD=$("overview-leads");
    if(OLD){
      OLD.innerHTML=leads.slice(0,3).map(l=>`
        <button class="rec" type="button" data-open-lead="${escapeHtml(l.id)}">
          <span class="rec-main">
            <strong>${escapeHtml(l.name)}</strong>
            <span>${escapeHtml(l.category)} · ${escapeHtml(l.city)}</span>
          </span>
          <span class="rec-side">
            <span class="score ${l.score>=75?"boa":l.score>=55?"possivel":"baixa"}">${l.score}</span>
            <span class="selo">${escapeHtml(l.status)}</span>
          </span>
        </button>
      `).join("")||`<div class="empty"><strong>Nenhuma empresa cadastrada</strong><span>Abra a aba Clientes para prospectar.</span></div>`;
    }

    const SG=$("summary-grid");
    if(SG){
      const fs=Object.entries(meta.fontes||{});
      const lidas=fs.reduce((a,[,x])=>a+(x.lidas||0),0);
      const novas=fs.reduce((a,[,x])=>a+(x.novas||0),0);
      SG.innerHTML=`
        <div><dt>Anúncios lidos na busca</dt><dd>${lidas||"—"}</dd></div>
        <div><dt>Novas na última coleta</dt><dd>${novas}</dd></div>
        <div><dt>No painel ativo</dt><dd>${vs.length}</dd></div>
        <div><dt>Fila de erros Vagas.com.br</dt><dd>${erros.length}</dd></div>
      `;
    }
  }

  // ==================== MÓDULO CLIENTES / PROSPECÇÃO (espelhando leads-ui.js) ====================
  const LEAD_STATUSES=["Todos","Preparado","Enviado","Retorno 4 dias","Não quer contato"];

  function carregarClientesUsuario(){
    const defCampaigns=[{
      id:"camp-default",
      name:`Consultoria & Projetos — ${profile?.city||"Salvador e Região"}`,
      city:profile?.city||"Salvador e RMS, BA",
      niche:"Construtoras, Indústrias e Empresas de Engenharia",
      dailyLimit:20,
      offer:`Apoio em planejamento físico-financeiro, controle de cronograma (MS Project / Power BI) e organização de manutenção (PCM/SAP).`
    }];
    campaigns=lerUser("campaigns",defCampaigns);
    if(!campaigns.length)campaigns=defCampaigns;
    activeCampaignId=campaigns[0].id;

    const defLeads=[
      {
        id:"lead-seed-1",
        campaignId:"camp-default",
        name:"Construtora & Incorporadora Litoral Norte",
        category:"Construção Civil e Obras",
        city:profile?.city||"Salvador, BA",
        contact:"contato@litoralnorteeng.com.br",
        website:"https://litoralnorteeng.com.br",
        score:86,
        reasons:[
          "Múltiplas obras simultâneas na região configurada com demanda de controle físico-financeiro",
          "Sinal observado: contratando equipe de acompanhamento de obras e relatórios em Excel/Power BI",
          "Alta aderência às competências do seu perfil ("+(listaSkillsPerfil().slice(0,3).join(", ")||"Planejamento")+")"
        ],
        status:"Preparado",
        sentAt:null,
        followUpDate:null,
        draft:`Olá, equipe da Construtora Litoral Norte! Tudo bem?\n\nSou ${profile?.name||"especialista em planejamento"}, atuo em ${profile?.city||"Salvador"} com planejamento e controle de obras (${listaSkillsPerfil().slice(0,3).join(", ")||"MS Project e Power BI"}).\n\nVi que vocês estão expandindo operações na região e desenvolvi um modelo prático de acompanhamento de cronograma e curva S que reduz o retrabalho de consolidação semanal, mantendo total controle técnico com a engenharia.\n\nSe fizer sentido, posso compartilhar uma demonstração rápida sem compromisso. Caso prefiram não receber novos contatos, basta me avisar por aqui.\n\nAbraço,\n${profile?.name||""}`
      },
      {
        id:"lead-seed-2",
        campaignId:"camp-default",
        name:"Polo Manutenção Industrial Bahia",
        category:"Manutenção e Serviços Industriais",
        city:"Camaçari / Salvador, BA",
        contact:"comercial@polomanutencao.com.br",
        website:"",
        score:79,
        reasons:[
          "Atuação direta em contratos de manutenção preventiva e paradas programadas",
          "Oportunidade de padronização de indicadores de backlog e disponibilidade (PCM)",
          "Forte alinhamento com o portfólio técnico do usuário ativo"
        ],
        status:"Retorno 4 dias",
        sentAt:hoje(),
        followUpDate:new Date(Date.now()+4*86400000).toISOString().slice(0,10),
        draft:`Olá! Aqui é ${profile?.name||""}.\n\nTrabalho com estruturação de PCM, indicadores em Power BI e controle de contratos de manutenção em ${profile?.city||"Salvador e RMS"}.\n\nPreparei um fluxo enxuto para controle de ordens de serviço e carteira de manutenção que ajuda equipes técnicas a prever desvios de prazo e custo.\n\nPodemos conversar 10 minutos esta semana?`
      }
    ];
    leads=lerUser("leads",defLeads);
    desenharClientes();
  }

  async function salvarClientes(){
    gravarUser("campaigns",campaigns);
    gravarUser("leads",leads);
    if(sb&&usuario){
      try{
        await sb.from("clientes_leads").upsert(leads.map(l=>({
          user_id:usuario.id,
          id:l.id,
          campanha_id:l.campaignId,
          nome:l.name,
          nicho:l.category,
          cidade:l.city,
          email:l.contact&&l.contact.includes("@")?l.contact:null,
          telefone:l.contact&&!l.contact.includes("@")?l.contact:null,
          site:l.website||null,
          score:l.score,
          status:l.status,
          sinais:l.reasons||[],
          mensagem:l.draft||"",
          dados:{sentAt:l.sentAt,followUpDate:l.followUpDate,campaigns},
          atualizado_em:new Date().toISOString()
        })));
      }catch(e){}
    }
    if($("nav-leads"))$("nav-leads").textContent=leads.filter(l=>l.status==="Preparado"||l.status==="Retorno 4 dias").length;
  }

  function desenharClientes(){
    const selCamp=$("campaign-select");
    if(selCamp){
      selCamp.innerHTML=campaigns.map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===activeCampaignId?"selected":""}>${escapeHtml(c.name)}</option>`).join("");
    }
    const camp=campaigns.find(c=>c.id===activeCampaignId)||campaigns[0];
    const enviadosHoje=leads.filter(l=>l.sentAt===hoje()).length;
    const limite=Number(camp?.dailyLimit||20);

    if($("leads-summary-strip")){
      $("leads-summary-strip").innerHTML=`
        <div><span class="kicker">Campanha ativa</span><strong>${escapeHtml(camp?.name||"Padrão")}</strong><span class="muted small">${escapeHtml(camp?.city||"")}</span></div>
        <div><span class="kicker">Limite diário de envios</span><strong>${enviadosHoje} / ${limite} hoje</strong><span class="muted small">Proteção anti-spam ativa</span></div>
        <div><span class="kicker">Para contatar</span><strong>${leads.filter(l=>l.status==="Preparado").length}</strong><span class="muted small">Com 1ª mensagem pronta</span></div>
        <div><span class="kicker">Retorno 4 dias</span><strong>${leads.filter(l=>l.status==="Retorno 4 dias").length}</strong><span class="muted small">Acompanhamento agendado</span></div>
      `;
    }

    const chipsBox=$("lead-status-chips");
    if(chipsBox){
      chipsBox.innerHTML=LEAD_STATUSES.map(st=>{
        const qtd=st==="Todos"?leads.length:leads.filter(l=>l.status===st).length;
        const on=leadFilter===st;
        return `<button type="button" class="chip ${on?"active":""}" data-lead-st="${escapeHtml(st)}" aria-pressed="${on}">${escapeHtml(st)} <span>${qtd}</span></button>`;
      }).join("");
    }

    const q=semAcento(leadQuery.trim());
    const filtrados=leads.filter(l=>{
      if(leadFilter!=="Todos"&&l.status!==leadFilter)return false;
      return !q||semAcento(`${l.name} ${l.category} ${l.city} ${(l.reasons||[]).join(" ")}`).includes(q);
    });

    if($("leads-count"))$("leads-count").textContent=`${filtrados.length} ${filtrados.length===1?"empresa":"empresas"}`;
    if($("nav-leads"))$("nav-leads").textContent=leads.filter(l=>l.status==="Preparado"||l.status==="Retorno 4 dias").length;

    const L=$("leads-list");
    if(L){
      if(!filtrados.length){
        L.innerHTML=`<div class="empty"><strong>Nenhuma empresa neste filtro</strong><span>Cadastre uma empresa ou troque o chip de status acima.</span></div>`;
      }else{
        if(!filtrados.some(x=>x.id===selectedLeadId))selectedLeadId=filtrados[0].id;
        L.innerHTML=filtrados.map(l=>{
          const sel=l.id===selectedLeadId;
          const cls=l.score>=75?"boa":l.score>=55?"possivel":"baixa";
          const stCls=l.status==="Enviado"?"ok":l.status==="Retorno 4 dias"?"sumiu":l.status==="Não quer contato"?"erro":"area";
          return `
            <article class="job-item ${sel?"selected":""}" data-lead-id="${escapeHtml(l.id)}" tabindex="0" role="option" aria-selected="${sel}">
              <div class="job-item-top">
                <h3>${escapeHtml(l.name)}</h3>
                <span class="score ${cls}" title="Score de oportunidade">${l.score}</span>
              </div>
              <p class="job-co">${escapeHtml(l.category)} · ${escapeHtml(l.city)}</p>
              <p class="job-loc">${escapeHtml((l.reasons&&l.reasons[0])||"Oportunidade mapeada")}</p>
              <div class="job-foot">
                <span class="selo ${stCls}">${escapeHtml(l.status)}</span>
                ${l.contact?`<span>${escapeHtml(l.contact)}</span>`:""}
              </div>
            </article>
          `;
        }).join("");
      }
    }
    desenharDetalheCliente();
  }

  function desenharDetalheCliente(){
    const D=$("leads-detail");if(!D)return;
    const l=leads.find(x=>x.id===selectedLeadId)||leads[0];
    if(!l){
      D.innerHTML=`<div class="empty"><strong>Selecione ou cadastre uma empresa</strong><span>Os motivos do score 0–100 e o rascunho da 1ª mensagem aparecem aqui.</span></div>`;
      return;
    }
    selectedLeadId=l.id;
    const camp=campaigns.find(c=>c.id===activeCampaignId)||campaigns[0];
    const enviadosHoje=leads.filter(x=>x.sentAt===hoje()).length;
    const limite=Number(camp?.dailyLimit||20);

    D.innerHTML=`
      <header class="d-head">
        <p class="d-co">${escapeHtml(l.category)} · ${escapeHtml(l.city)}</p>
        <h2>${escapeHtml(l.name)}</h2>
        <div class="d-fit">
          <span class="score ${l.score>=75?"boa":l.score>=55?"possivel":"baixa"}">Score ${l.score}/100</span>
          <span class="selo area">Status: ${escapeHtml(l.status)}</span>
          ${l.contact?`<span class="selo">${escapeHtml(l.contact)}</span>`:""}
          ${l.followUpDate?`<span class="selo sumiu">Retorno agendado: ${escapeHtml(dataCurta(l.followUpDate))}</span>`:""}
        </div>
        <div class="d-actions">
          <button class="button" type="button" data-lead-set-status="Enviado" ${enviadosHoje>=limite&&l.status!=="Enviado"?"disabled":""}>
            <svg class="i" aria-hidden="true"><use href="#i-check"/></svg> Marcar como Enviado
          </button>
          <button class="button button-secondary" type="button" data-lead-set-status="Retorno 4 dias">Agendar Retorno 4 dias</button>
          <button class="button button-secondary" type="button" data-lead-set-status="Preparado">Voltar p/ Preparado</button>
          <button class="button button-ghost danger" type="button" data-lead-set-status="Não quer contato">Não quer contato</button>
        </div>
      </header>

      <section class="d-section">
        <h3>Por que esta empresa recebeu score ${l.score}/100</h3>
        <ul class="checks">
          ${(l.reasons||[]).map(r=>`<li><svg class="i" aria-hidden="true"><use href="#i-check"/></svg><span>${escapeHtml(r)}</span></li>`).join("")}
        </ul>
      </section>

      <section class="d-section">
        <h3>Rascunho editável da 1ª mensagem</h3>
        <textarea id="lead-draft-box" class="msg-box" rows="8">${escapeHtml(l.draft||"")}</textarea>
        <div class="row-actions">
          <button class="button button-secondary" type="button" id="btn-save-lead-draft">Salvar rascunho</button>
          <button class="button button-secondary" type="button" id="btn-copy-lead-draft"><svg class="i" aria-hidden="true"><use href="#i-copy"/></svg> Copiar mensagem</button>
          ${l.contact&&l.contact.includes("@")?`<a class="button button-ghost" href="mailto:${encodeURIComponent(l.contact)}?subject=${encodeURIComponent("Contato profissional — "+(profile?.name||"Radar"))}&body=${encodeURIComponent(l.draft||"")}">Abrir no cliente de e-mail ↗</a>`:""}
        </div>
      </section>
    `;

    qsa("[data-lead-set-status]",D).forEach(btn=>{
      btn.addEventListener("click",()=>{
        const novo=btn.dataset.leadSetStatus;
        l.status=novo;
        if(novo==="Enviado"){
          l.sentAt=hoje();
          l.followUpDate=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
        }else if(novo==="Retorno 4 dias"){
          l.followUpDate=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
        }
        salvarClientes();
        desenharClientes();
        desenharVisaoGeral(visiveis());
        showToast(`Status de ${l.name} atualizado para "${novo}".`);
        anunciarAcao(`Cliente ${l.name} marcado como ${novo}.`);
      });
    });

    $("btn-save-lead-draft")?.addEventListener("click",()=>{
      l.draft=$("lead-draft-box").value;
      salvarClientes();
      showToast("Rascunho salvo.");
    });
    $("btn-copy-lead-draft")?.addEventListener("click",()=>{
      const txt=$("lead-draft-box")?.value||"";
      navigator.clipboard?.writeText(txt).then(()=>showToast("Mensagem copiada para a área de transferência."));
    });
  }

  // ==================== MÓDULO PUBLICAÇÕES LINKEDIN (espelhando posts-ui.js) ====================
  const POST_STATUSES=["Todos","Rascunho","Aprovado","Publicado"];

  function carregarPostsUsuario(){
    const defStories=[
      {
        id:"story-1",
        title:"Controle de cronograma físico-financeiro e desvios de obra",
        pillar:"Prova e projeto",
        facts:[
          `Uso diário de ${listaSkillsPerfil().slice(0,3).join(", ")||"MS Project e Power BI"} para acompanhar avanço físico`,
          "Identificação antecipada de gargalos de materiais e equipes em campo",
          "Reuniões semanais objetivas baseadas em indicadores visuais e curva S"
        ]
      },
      {
        id:"story-2",
        title:"Integração entre manutenção preventiva (PCM) e custos de contrato",
        pillar:"Dica prática",
        facts:[
          "Padronização de apontamentos em SAP e planilhas de controle",
          "Priorização técnica de ordens críticas sem inflar o backlog",
          "Transparência entre operação, engenharia e gestão contratual"
        ]
      }
    ];
    stories=lerUser("stories",defStories);

    const defPosts=[
      {
        id:"post-seed-1",
        title:"O que separa um cronograma decorativo de um planejamento que funciona em campo",
        pillar:"Prova e projeto",
        status:"Rascunho",
        scheduledFor:hoje(),
        facts:defStories[0].facts,
        text:`Muitas vezes o cronograma é visto apenas como um documento para cumprir contrato. Na prática de ${profile?.roles?.split(",")[0]||"planejamento e projetos"}, aprendi que um cronograma útil começa pela leitura real do campo.\n\nQuando cruzamos o avanço físico no MS Project com indicadores diretos no Power BI, deixamos de olhar apenas para o que atrasou na semana passada e passamos a enxergar onde a equipe vai precisar de apoio na semana seguinte.\n\nTrês práticas que aplico na rotina:\n1. Atualizar a Curva S com dados verificados de campo, sem maquiar desvios.\n2. Conectar orçamento e suprimentos ao caminho crítico.\n3. Transformar relatórios extensos em decisões claras de 15 minutos com a operação.\n\nSigo compartilhando aprendizados práticos em ${profile?.city||"projetos e engenharia"}. #Planejamento #GestaoDeProjetos #PowerBI #Engenharia`
      },
      {
        id:"post-seed-2",
        title:"Como organizar o backlog de manutenção sem perder visibilidade do orçamento",
        pillar:"Dica prática",
        status:"Aprovado",
        scheduledFor:hoje(),
        facts:defStories[1].facts,
        text:`Em rotinas de manutenção e PCM, ter muitos dados no sistema não significa ter visibilidade para decidir.\n\nAo estruturar indicadores com ${listaSkillsPerfil().slice(0,3).join(", ")||"SAP, Excel avançado e Power BI"}, o foco principal foi separar o que é urgência real do que é falta de janela programada.\n\nQuando a engenharia e a manutenção falam a mesma língua dos custos, o plano deixa de ser reativo e ganha previsibilidade.`
      }
    ];
    posts=lerUser("posts",defPosts);
    desenharPublicacoes();
    desenharHistoriasNoPerfil();
  }

  async function salvarPosts(){
    gravarUser("stories",stories);
    gravarUser("posts",posts);
    if(sb&&usuario){
      try{
        await sb.from("publicacoes_posts").upsert(posts.map(p=>({
          user_id:usuario.id,
          id:p.id,
          pilar:p.pillar,
          titulo:p.title,
          conteudo:p.text,
          status:p.status,
          dados:{facts:p.facts||[],scheduledFor:p.scheduledFor,stories},
          atualizado_em:new Date().toISOString()
        })));
      }catch(e){}
    }
    if($("nav-content"))$("nav-content").textContent=posts.filter(p=>p.status==="Rascunho").length;
    desenharHistoriasNoPerfil();
  }

  function gerarNovaPautaDoPerfil(){
    const sk=listaSkillsPerfil();
    const areaPrincipal=listaAreasPerfil()[0]||"Planejamento e Projetos";
    const historiaBase=stories[0]||{
      title:`Aplicação prática de ${sk.slice(0,2).join(" e ")||"gestão"} em ${areaPrincipal}`,
      pillar:"História e aprendizado",
      facts:[
        `Perfil ativo de ${profile?.name||"usuário"} em ${profile?.city||"sua região"}`,
        `Competências verificadas: ${sk.slice(0,4).join(", ")||"Planejamento, Controle"}`,
        `Foco em resultados reais e revisão humana`
      ]
    };
    const novo={
      id:`post-${Date.now()}`,
      title:`Aprendizados práticos em ${areaPrincipal}: combinando ${sk.slice(0,2).join(" e ")||"processo e dados"}`,
      pillar:historiaBase.pillar||"Prova e projeto",
      status:"Rascunho",
      scheduledFor:hoje(),
      facts:historiaBase.facts,
      text:`Atuando com ${areaPrincipal.toLowerCase()} (${profile?.city||"remoto e presencial"}), percebo que ferramentas como ${sk.slice(0,3).join(", ")||"Power BI e MS Project"} só entregam valor real quando refletem a rotina de quem executa.\n\nNo meu fluxo de trabalho:\n• ${historiaBase.facts.join("\n• ")}\n\nMais importante do que automatizar um relatório é garantir que cada indicador ajude a equipe a tomar uma decisão melhor na segunda-feira de manhã.\n\nEstou aberto a conexões e trocas com profissionais de ${profile?.roles||areaPrincipal}.`
    };
    posts.unshift(novo);
    selectedPostId=novo.id;
    salvarPosts();
    desenharPublicacoes();
    desenharVisaoGeral(visiveis());
    showToast("Nova pauta gerada com base nos fatos reais do seu perfil!");
    anunciarAcao(`Nova pauta criada: ${novo.title}`);
  }

  function desenharPublicacoes(){
    if($("posts-summary-strip")){
      $("posts-summary-strip").innerHTML=`
        <div><span class="kicker">Rascunhos para revisar</span><strong>${posts.filter(p=>p.status==="Rascunho").length}</strong><span class="muted small">Exigem aprovação humana</span></div>
        <div><span class="kicker">Aprovados</span><strong>${posts.filter(p=>p.status==="Aprovado").length}</strong><span class="muted small">Prontos para o LinkedIn</span></div>
        <div><span class="kicker">Publicados</span><strong>${posts.filter(p=>p.status==="Publicado").length}</strong><span class="muted small">Histórico concluído</span></div>
        <div><span class="kicker">Fatos verificáveis</span><strong>${stories.length}</strong><span class="muted small">Do currículo de ${escapeHtml(profile?.name?.split(" ")[0]||"você")}</span></div>
      `;
    }

    const chipsBox=$("post-status-chips");
    if(chipsBox){
      chipsBox.innerHTML=POST_STATUSES.map(st=>{
        const qtd=st==="Todos"?posts.length:posts.filter(p=>p.status===st).length;
        const on=postFilter===st;
        return `<button type="button" class="chip ${on?"active":""}" data-post-st="${escapeHtml(st)}" aria-pressed="${on}">${escapeHtml(st)} <span>${qtd}</span></button>`;
      }).join("");
    }

    const filtrados=posts.filter(p=>postFilter==="Todos"||p.status===postFilter);
    if($("posts-count"))$("posts-count").textContent=`${filtrados.length} ${filtrados.length===1?"publicação":"publicações"}`;
    if($("nav-content"))$("nav-content").textContent=posts.filter(p=>p.status==="Rascunho").length;

    const L=$("posts-list");
    if(L){
      if(!filtrados.length){
        L.innerHTML=`<div class="empty"><strong>Nenhuma publicação neste status</strong><span>Clique em "Gerar pauta a partir do meu perfil" acima.</span></div>`;
      }else{
        if(!filtrados.some(x=>x.id===selectedPostId))selectedPostId=filtrados[0].id;
        L.innerHTML=filtrados.map(p=>{
          const sel=p.id===selectedPostId;
          const stCls=p.status==="Publicado"?"ok":p.status==="Aprovado"?"area":"sumiu";
          return `
            <article class="job-item ${sel?"selected":""}" data-post-id="${escapeHtml(p.id)}" tabindex="0" role="option" aria-selected="${sel}">
              <div class="job-item-top">
                <h3>${escapeHtml(p.title)}</h3>
              </div>
              <p class="job-co">${escapeHtml(p.pillar)}</p>
              <p class="job-loc">${escapeHtml((p.text||"").slice(0,110))}…</p>
              <div class="job-foot">
                <span class="selo ${stCls}">${escapeHtml(p.status)}</span>
                <span>${(p.facts||[]).length} fatos verificados</span>
              </div>
            </article>
          `;
        }).join("");
      }
    }
    desenharDetalhePost();
  }

  function desenharDetalhePost(){
    const D=$("posts-detail");if(!D)return;
    const p=posts.find(x=>x.id===selectedPostId)||posts[0];
    if(!p){
      D.innerHTML=`<div class="empty"><strong>Selecione uma pauta</strong><span>O texto editável e os fatos usados aparecem aqui.</span></div>`;
      return;
    }
    selectedPostId=p.id;
    const shareUrl=`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(p.text||"")}`;

    D.innerHTML=`
      <header class="d-head">
        <p class="d-co">${escapeHtml(p.pillar)} · Autor: ${escapeHtml(profile?.name||"Seu perfil")}</p>
        <h2>${escapeHtml(p.title)}</h2>
        <div class="d-fit">
          <span class="selo ${p.status==="Publicado"?"ok":p.status==="Aprovado"?"area":"sumiu"}">Status: ${escapeHtml(p.status)}</span>
          <span class="selo">${(p.text||"").length} caracteres</span>
        </div>
        <div class="d-actions">
          <button class="button" type="button" data-post-set-status="Aprovado">
            <svg class="i" aria-hidden="true"><use href="#i-check"/></svg> Aprovar pauta
          </button>
          <a class="button button-secondary" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">
            <svg class="i" aria-hidden="true"><use href="#i-linkedin"/></svg> Abrir no LinkedIn ↗
          </a>
          <button class="button button-secondary" type="button" data-post-set-status="Publicado">Marcar como Publicado</button>
          <button class="button button-ghost" type="button" data-post-set-status="Rascunho">Voltar p/ Rascunho</button>
        </div>
      </header>

      <section class="d-section">
        <h3>Fatos usados nesta publicação (verificados no seu perfil)</h3>
        <ul class="checks">
          ${(p.facts||[]).map(ft=>`<li><svg class="i" aria-hidden="true"><use href="#i-check"/></svg><span>${escapeHtml(ft)}</span></li>`).join("")}
        </ul>
      </section>

      <section class="d-section">
        <h3>Editor da publicação</h3>
        <textarea id="post-text-box" class="msg-box" rows="10">${escapeHtml(p.text||"")}</textarea>
        <div class="row-actions">
          <button class="button button-secondary" type="button" id="btn-save-post-text">Salvar alterações</button>
          <button class="button button-secondary" type="button" id="btn-copy-post-text"><svg class="i" aria-hidden="true"><use href="#i-copy"/></svg> Copiar texto</button>
        </div>
      </section>
    `;

    qsa("[data-post-set-status]",D).forEach(btn=>{
      btn.addEventListener("click",()=>{
        p.status=btn.dataset.postSetStatus;
        salvarPosts();
        desenharPublicacoes();
        desenharVisaoGeral(visiveis());
        showToast(`Publicação marcada como "${p.status}".`);
        anunciarAcao(`Publicação ${p.title} marcada como ${p.status}.`);
      });
    });

    $("btn-save-post-text")?.addEventListener("click",()=>{
      p.text=$("post-text-box").value;
      salvarPosts();
      desenharPublicacoes();
      showToast("Texto da publicação salvo.");
    });
    $("btn-copy-post-text")?.addEventListener("click",()=>{
      const txt=$("post-text-box")?.value||"";
      navigator.clipboard?.writeText(txt).then(()=>showToast("Texto copiado!"));
    });
  }

  function desenharHistoriasNoPerfil(){
    const box=$("profile-stories-list");if(!box)return;
    if(!stories.length){
      box.innerHTML=`<p class="muted">Nenhuma história cadastrada ainda.</p>`;
      return;
    }
    box.innerHTML=stories.map(s=>`
      <div class="profile-entry">
        <div>
          <strong>${escapeHtml(s.title)}</strong>
          <small>${escapeHtml(s.pillar)} · ${(s.facts||[]).join(" · ")}</small>
        </div>
      </div>
    `).join("");
  }

  // ==================== MEU PERFIL & CONFIGURAÇÕES ====================
  function preencherFormularioPerfil(){
    const form=$("profile-form");if(!form||!profile)return;
    for(const k of ["name","city","regionCities","headline","roles","maxDays","contact","skills","summary"]){
      if(form.elements[k])form.elements[k].value=profile[k]??"";
    }
    if(form.elements.acceptRemote)form.elements.acceptRemote.checked=!!profile.acceptRemote;
    if(form.elements.acceptHybrid)form.elements.acceptHybrid.checked=!!profile.acceptHybrid;
    if(form.elements.acceptOnsite)form.elements.acceptOnsite.checked=!!profile.acceptOnsite;
  }

  function atualizarImpactoPerfil(vs){
    const box=$("profile-impact-box");if(!box)return;
    const comReq=vs.filter(v=>(v._req?.tenho?.length||0)>0).length;
    const score70=vs.filter(v=>sc(v)>=70).length;
    box.innerHTML=`
      <div><dt>Perfil ativo</dt><dd>${escapeHtml(profile?.name||"—")}</dd></div>
      <div><dt>Cidade / Região</dt><dd>${escapeHtml(profile?.city||"—")}</dd></div>
      <div><dt>Competências mapeadas</dt><dd>${listaSkillsPerfil().length}</dd></div>
      <div><dt>Vagas com match de currículo</dt><dd>${comReq} de ${vs.length}</dd></div>
      <div><dt>Vagas com Score 70+</dt><dd>${score70}</dd></div>
    `;
  }

  // ==================== DIAGNÓSTICO DE FONTES & PROVA DE COBERTURA ====================
  const situacao=x=>!x.falhas?"ok":x.lidas?"parcial":"falhou";
  const SIT={ok:"Respondeu",parcial:"Parcial",falhou:"Falhou"};

  function desenharFontes(){
    const T=$("tabela-fontes");if(!T)return;
    T.textContent="";
    const fs=Object.entries(meta.fontes||{});
    if(!fs.length){T.append(el("p","aviso","Ainda não há dados da última busca."));return}
    const tb=el("table","tabela data-table"),cab=el("tr");
    for(const[t,c]of[["Site"],["Lidos","n"],["Já vistos antes","n esconde"],["Novas no painel","n"],["Ficaram de fora"],["Situação"]]){
      cab.append(el("th",c||null,t));
    }
    const th=el("thead");th.append(cab);tb.append(th);
    const corpo=el("tbody");
    for(const[n,x]of fs){
      const tr=el("tr"),sit=situacao(x);
      const fora=Object.entries(x.descartes||{}),qtd=fora.reduce((a,[,q])=>a+q,0);
      const tdFora=el("td",null,x.descartes?String(qtd):"—");
      if(fora.length)tdFora.append(el("small",null,fora.slice(0,3).map(([m,q])=>`${m.replace(/^Descartada \((.*)\)$/,"$1")}: ${q}`).join(" · ")));
      const tdSit=el("td","sit-"+sit,SIT[sit]);
      if(x.falhas)tdSit.append(el("small",null,`${x.falhas} ${x.falhas>1?"consultas falharam":"consulta falhou"}`+(x.erros&&x.erros[0]?`: ${x.erros[0]}`:"")));
      const vistos=x.ja_vistas==null?"—":x.ja_vistas+(x.ja_no_painel||0);
      tr.append(el("td",null,n),el("td","n",x.lidas??"—"),el("td","n esconde",vistos),el("td","n",x.novas??0),tdFora,tdSit);
      corpo.append(tr);
    }
    tb.append(corpo);T.append(tb);
  }

  let catalogo=null;
  const urlLimpa=u=>{try{const x=new URL(u);return(x.hostname.replace(/^www\./,"")+x.pathname.replace(/\/$/,"")).toLowerCase()}catch(e){return""}};
  function idDoLink(u){
    try{
      const x=new URL(u),h=x.hostname,c=x.pathname;let m;
      if(/gupy\.io$/.test(h)&&(m=/\/jobs?\/([^/?#]+)/.exec(c))){
        if(/^\d+$/.test(m[1]))return"gupy:"+m[1];
        try{const j=JSON.parse(atob(decodeURIComponent(m[1])));if(j.jobId)return"gupy:"+j.jobId}catch(e){}
      }
      if(/linkedin\./.test(h)){const id=x.searchParams.get("currentJobId")||(/(\d{8,})\/?$/.exec(c)||[])[1];if(id)return"linkedin:"+id}
      if(/vagas\.com\.br$/.test(h)&&(m=/\/vagas\/v(\d+)/.exec(c)))return"vagascom:"+m[1];
      if(/solides\.com\.br$/.test(h)&&(m=/\/vagas?\/(\d+)/.exec(c)))return"solides:"+m[1];
      if(/empregos\.com\.br$/.test(h)&&(m=/\/vaga\/(\d+)/.exec(c)))return"empregos:"+m[1];
    }catch(e){}
    return null;
  }
  const VAZIAS=["de","da","do","das","dos","e","em","para","a","o","vaga","remoto","remota","hibrido","presencial","salvador","ba","bahia","jr","junior","pleno","na","no","com"];
  const palavras=t=>semAcento(t).replace(/[^a-z0-9]+/g," ").split(" ").filter(w=>w.length>1&&!VAZIAS.includes(w));

  async function carregarCatalogo(){
    if(catalogo)return catalogo;
    const r=await fetch("catalogo.json?t="+Date.now());
    if(!r.ok)throw new Error(r.status);
    const j=await r.json();
    catalogo=j.linhas.map(l=>Object.fromEntries(j.campos.map((k,n)=>[k,l[n]])));
    catalogo.desde=j.desde;
    return catalogo;
  }

  function dicaNaoAchada(u){
    if(/indeed\.|glassdoor\.|catho\.|infojobs\./i.test(u))return"Esse site não está na coleta automática. Veja se a mesma vaga existe na Gupy, na Sólides ou na página da empresa, ou adicione pelo botão + Adicionar vaga.";
    if(/linkedin\./i.test(u))return"O robô lê no LinkedIn os primeiros resultados de cada termo. Você pode adicioná-la direto pelo botão + Adicionar vaga.";
    if(/gupy\.io/i.test(u))return"É da Gupy, mas não veio na busca automática. Verifique se está na sua região ou adicione manualmente.";
    if(/vagas\.com\.br/i.test(u))return"Pode ter entrado na Fila de erros do Vagas.com.br. Confira o chip Fila de erros (vagas.com.br).";
    return"Não encontrada na última coleta automática. Você pode incluí-la pelo botão + Adicionar vaga.";
  }

  function conferirLinha(linhaTxt,cat){
    const u=(/https?:\/\/\S+/.exec(linhaTxt)||[""])[0];
    const rotulo=linhaTxt.replace(u,"").replace(/[|;–—]+/g," ").trim();
    const id=u&&idDoLink(u),limpa=u&&urlLimpa(u);
    const mesmo=x=>!!x&&((id&&idDoLink(x)===id)||(limpa&&urlLimpa(x)===limpa));
    const vsAll=todasCombinadas();
    let v=u?vsAll.find(x=>mesmo(x.link)||(x.tambem_em||[]).some(o=>mesmo(o.link))):null;
    let c=!v&&u?cat.find(x=>mesmo(x.link)):null;
    if(!v&&!c&&rotulo){
      const ws=palavras(rotulo);
      if(ws.length>=2){
        let melhor=null,nota=0;
        for(const x of[...vsAll.map(t=>({...t,_painel:1})),...cat]){
          const h=" "+palavras(x.titulo+" "+x.empresa).join(" ")+" ";
          const p=ws.filter(w=>h.includes(" "+w+" ")).length/ws.length;
          if(p>nota){nota=p;melhor=x}
        }
        if(nota>=.75){if(melhor._painel)v=vsAll.find(t=>t.id===melhor.id);else c=melhor}
      }
    }
    if(v){
      const desc=estado.descartadas.includes(v.id);
      return{cls:desc?"fora":"painel",titulo:`${v.titulo}${v.empresa?", "+v.empresa:""}`,txt:desc?"Está no painel e foi descartada por você.":`Está no painel com score ${sc(v)}${v.data?`, desde ${dataCurta(v.data)}`:""}.`};
    }
    if(c){
      const st=c.status||"";
      return{cls:"fora",titulo:`${c.titulo}, ${c.empresa}`,txt:`O robô leu em ${dataCurta(c.visto_em)} (${c.fonte}), status: ${st}${c.motivo?` (${c.motivo})`:""}.`};
    }
    return{cls:"nao",titulo:"Não encontrada na coleta",txt:dicaNaoAchada(u)};
  }

  // ==================== MODAL ACESSÍVEL & CONVIDAR AMIGOS ====================
  function abrirModalHtml(html,center=true){
    const back=$("modal-backdrop"), content=$("modal-content");
    if(!back||!content)return;
    if(document.activeElement&&document.activeElement!==document.body&&!back.contains(document.activeElement)){
      lastModalTrigger=document.activeElement;
    }
    back.classList.toggle("center-modal",!!center);
    content.innerHTML=html;
    back.classList.remove("hidden");
    document.body.classList.add("modal-open");
    const firstInput=content.querySelector("input, select, textarea, button, a[href]");
    setTimeout(()=>(firstInput||$("modal-close"))?.focus(),20);
  }

  function closeModal(){
    const back=$("modal-backdrop");
    if(!back||back.classList.contains("hidden"))return;
    back.classList.add("hidden");
    document.body.classList.remove("modal-open");
    if(lastModalTrigger&&lastModalTrigger.isConnected){
      const toFocus=lastModalTrigger;
      lastModalTrigger=null;
      setTimeout(()=>toFocus.focus(),0);
    }
  }
  window.openModal=abrirModalHtml;
  window.closeModal=closeModal;

  function abrirModalConvidarAmigos(){
    const urlCompartilhar=location.origin+location.pathname;
    abrirModalHtml(`
      <h2 id="modal-title">Convidar e Compartilhar com Amigos</h2>
      <p class="muted" style="margin-top:6px">O Radar é <strong>multiusuário e gratuito</strong>. Qualquer amigo pode abrir o link abaixo e usar para a própria carreira sem misturar dados com os seus.</p>
      <ol class="steps" style="margin-top:16px">
        <li><strong>Acesso imediato:</strong> Seu amigo pode clicar em <em>Entrar com Google</em>, criar conta com <em>E-mail e Senha</em> (sincronizado na nuvem via Supabase) ou entrar em <em>Modo Local / Convidado</em> direto no navegador.</li>
        <li><strong>Personalização em 1 minuto:</strong> Na aba <strong>Meu perfil</strong>, ele clica em <em>Limpar para novo amigo</em> e preenche o próprio Nome, Cidade/UF, Áreas de interesse e Competências do currículo.</li>
        <li><strong>Recálculo em tempo real:</strong> Todos os scores (0–100), os requisitos "No seu perfil" vs. "Vale conferir", as campanhas de Clientes e as pautas do LinkedIn passam a refletir os dados dele.</li>
      </ol>
      <div class="workspace-panel" style="padding:14px;background:var(--subtle);margin-top:14px">
        <label>Link direto do Radar para enviar no WhatsApp ou LinkedIn
          <input id="share-url-input" type="text" readonly value="${escapeHtml(urlCompartilhar)}">
        </label>
        <div class="form-actions" style="margin-top:10px">
          <button class="button" type="button" id="btn-copy-share-url"><svg class="i" aria-hidden="true"><use href="#i-copy"/></svg> Copiar convite pronto</button>
          <button class="button button-secondary" type="button" id="btn-new-friend-now">Testar perfil de amigo agora</button>
        </div>
      </div>
    `);
    $("btn-copy-share-url")?.addEventListener("click",()=>{
      const msg=`Olha esse painel gratuito para acompanhar vagas (com score pelo currículo), clientes e posts do LinkedIn: ${urlCompartilhar} — Ao abrir, vá em "Meu perfil" para colocar seus cargos, cidade e competências!`;
      navigator.clipboard?.writeText(msg).then(()=>showToast("Convite copiado para enviar aos amigos!"));
    });
    $("btn-new-friend-now")?.addEventListener("click",()=>{
      closeModal();
      setView("profile");
      $("btn-preset-blank")?.click();
    });
  }

  // ==================== NAVEGAÇÃO ENTRE VIEWS ====================
  function setView(view){
    activeView=view;
    qsa(".view").forEach(v=>v.classList.toggle("active",v.id===view));
    qsa(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    qs(".profile-chip")?.classList.toggle("active",view==="profile");
    window.scrollTo({top:0,behavior:"instant"});
  }

  function salvarFiltros(){
    gravarUser("filtros",{status:f.status,ordem:f.ordem,fonte:f.fonte,area:f.area,mod:f.mod,score:f.score});
  }

  // ==================== CARREGAMENTO DE VAGAS (JSON / SUPABASE / GITHUB) ====================
  async function carregarVagas(){
    let dados=null;
    if(sb&&usuario){
      try{
        const[{data:vs,error},{data:bs},{data:fe}]=await Promise.all([
          sb.from("vagas").select("*").range(0,9999),
          sb.from("buscas").select("*").eq("id",1),
          sb.from("fila_erros_vagas").select("*").range(0,999)
        ]);
        if(!error&&vs&&vs.length){
          for(const v of vs)for(const k in v)if(v[k]==null)delete v[k];
          dados={vagas:vs,fila_erros:fe||[],...(bs&&bs[0]||{})};
        }
      }catch(e){}
    }
    if(!dados&&token){
      try{
        const r=await fetch(`https://api.github.com/repos/${REPO}/contents/docs/vagas.json?ref=main&t=${Date.now()}`,{
          headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github.raw+json"}
        });
        if(r.ok)dados=await r.json();
      }catch(e){}
    }
    if(!dados){
      const r=await fetch("vagas.json?t="+Date.now());
      dados=await r.json();
    }
    todas=dados.vagas||[];
    meta=dados;
    filaErrosRemota=construirFilaErrosPadrao(dados);

    if(dados.atualizado_em){
      const d=new Date(dados.atualizado_em);
      const fontesTxt=Object.entries(dados.fontes||{}).map(([n,x])=>`${n}: ${x.novas||0} novas (${x.lidas||0} lidas)`).join(" · ");
      const msgResumo=`Última busca em ${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.`+(fontesTxt?` ${fontesTxt}.`:"");
      if($("atual"))$("atual").textContent=msgResumo;
      if($("last-run-home"))$("last-run-home").textContent=msgResumo;
      if($("robot-status"))$("robot-status").textContent=`Atualizado em ${d.toLocaleDateString("pt-BR")} (${todas.length} vagas)`;

      const ruins=Object.entries(dados.fontes||{}).filter(([,x])=>situacao(x)!=="ok").map(([n])=>n);
      const A=$("alerta-fontes");
      if(A){
        A.hidden=!ruins.length;
        A.textContent="";
        if(ruins.length){
          A.append(`Atenção: ${ruins.join(", ")} ${ruins.length>1?"tiveram falhas":"teve falha"} em parte da busca. `);
          const b=el("button","link","Ver diagnóstico");
          b.type="button";
          b.onclick=()=>{$("fontes").open=true;$("fontes").scrollIntoView({behavior:"smooth"})};
          A.append(b);
        }
      }
    }
    return dados.atualizado_em;
  }

  // ==================== AUTENTICAÇÃO SUPABASE + MODO LOCAL/CONVIDADO ====================
  function carregarScript(src){
    return new Promise((ok,erro)=>{
      if(window.supabase)return ok();
      const s=document.createElement("script");
      s.src=src;s.onload=ok;s.onerror=erro;
      document.head.append(s);
    });
  }

  function atualizarUIAutenticacao(){
    const emailEl=$("email"), authLbl=$("sidebar-auth-label");
    if(usuario){
      if(emailEl)emailEl.textContent=usuario.email||profile?.name||"Conectado";
      if(authLbl)authLbl.textContent="Conta conectada";
    }else{
      if(emailEl)emailEl.textContent=`Modo Local · ${profile?.name?.split(" ")[0]||"Convidado"}`;
      if(authLbl)authLbl.textContent="Entrar / Sincronizar";
    }
  }

  async function inicializarSessaoEPainel(){
    const customSupa=lerGlobal("supabase-custom",null);
    const cfgSupa=(customSupa&&customSupa.url&&customSupa.anon)?customSupa:(window.SUPABASE&&window.SUPABASE.url?window.SUPABASE:null);

    if(cfgSupa){
      try{
        await carregarScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js");
        sb=window.supabase.createClient(cfgSupa.url,cfgSupa.anon);
        const{data:{session}}=await sb.auth.getSession();
        if(session&&session.user){
          usuario=session.user;
          activeNamespace=usuario.id||usuario.email||"user";
        }
      }catch(e){
        sb=null;
      }
    }

    carregarPerfilUsuario();
    atualizarUIAutenticacao();
    mostrarContaGitHub();

    try{
      await carregarVagas();
      if(sb&&usuario){
        try{estado=await lerEstadoSupabase()}catch(e){}
      }else if(token){
        try{estado=await lerEstadoGitHub()}catch(e){token="";mostrarContaGitHub()}
      }
      if(!sb&&!token){
        try{const r2=await fetch("estado.json?t="+Date.now());if(r2.ok)estado=await r2.json()}catch(e){}
        const local=lerUser("estado-local",null);
        if(local){
          estado.candidatei={...estado.candidatei,...(local.candidatei||{})};
          estado.descartadas=[...new Set([...(estado.descartadas||[]),...(local.descartadas||[])])];
        }
      }
      estado.candidatei=estado.candidatei||{};
      estado.descartadas=estado.descartadas||[];
      carregarClientesUsuario();
      carregarPostsUsuario();
      render();
    }catch(e){
      if($("lista"))$("lista").replaceChildren(el("p","aviso erro","As vagas não carregaram. Se abriu o arquivo direto do PC, rode um servidor local."));
    }
  }

  function mostrarContaGitHub(){
    const ec=$("estado-conta");
    if(ec)ec.textContent=token?`Conectado ao GitHub (${REPO}).`:"Sem token GitHub configurado. As marcações ficam salvas no seu perfil local ou no Supabase.";
  }

  // ==================== EVENTOS E INTERAÇÕES ====================
  // Saudação e Data no Topo
  (function initRelogio(){
    const agora=new Date();
    const h=agora.getHours();
    if($("greeting"))$("greeting").textContent=h<12?"Bom dia":h<18?"Boa tarde":"Boa noite";
    const fmtFull=new Intl.DateTimeFormat("pt-BR",{dateStyle:"full"}).format(agora);
    const fmtCurto=new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"numeric",month:"long"}).format(agora);
    const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
    if($("today-label"))$("today-label").textContent=cap(fmtFull);
    if($("hero-date"))$("hero-date").textContent=cap(fmtCurto);
  })();

  // Clique global de delegação (Sidebar, Overview, Clientes, Posts, Modais)
  document.addEventListener("click",e=>{
    const viewBtn=e.target.closest("[data-view]");
    if(viewBtn){
      e.preventDefault();
      setView(viewBtn.dataset.view);
      return;
    }
    const openJob=e.target.closest("[data-open-job]");
    if(openJob){
      f.status="todas";salvarFiltros();
      selectedJobId=openJob.dataset.openJob;
      setView("jobs");render();
      return;
    }
    const openErr=e.target.closest("[data-open-err]");
    if(openErr){
      f.status="erros";salvarFiltros();
      selectedErrId=openErr.dataset.openErr;
      setView("jobs");render();
      return;
    }
    const openLead=e.target.closest("[data-open-lead]");
    if(openLead){
      selectedLeadId=openLead.dataset.openLead;
      setView("leads");desenharClientes();
      return;
    }
    const openPost=e.target.closest("[data-open-post]");
    if(openPost){
      selectedPostId=openPost.dataset.openPost;
      setView("content");desenharPublicacoes();
      return;
    }
    const leadCard=e.target.closest("[data-lead-id]");
    if(leadCard){
      selectedLeadId=leadCard.dataset.leadId;
      desenharClientes();
      return;
    }
    const leadSt=e.target.closest("[data-lead-st]");
    if(leadSt){
      leadFilter=leadSt.dataset.leadSt;
      desenharClientes();
      return;
    }
    const postCard=e.target.closest("[data-post-id]");
    if(postCard){
      selectedPostId=postCard.dataset.postId;
      desenharPublicacoes();
      return;
    }
    const postSt=e.target.closest("[data-post-st]");
    if(postSt){
      postFilter=postSt.dataset.postSt;
      desenharPublicacoes();
      return;
    }
  });

  $("overview-open-errors")?.addEventListener("click",()=>{
    f.status="erros";salvarFiltros();setView("jobs");render();
  });

  // Botões de Convidar Amigos
  for(const id of ["btn-invite-sidebar","btn-invite-top","btn-invite-card"]){
    $(id)?.addEventListener("click",abrirModalConvidarAmigos);
  }

  // Fechar Modal
  $("modal-close")?.addEventListener("click",closeModal);
  $("modal-backdrop")?.addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal()});

  // Navegação por Teclado (Split-View ArrowUp/ArrowDown, Enter/Space e Modal Focus Trap/Escape)
  document.addEventListener("keydown",e=>{
    const backdrop=$("modal-backdrop");
    if(e.key==="Escape"){
      if(backdrop&&!backdrop.classList.contains("hidden")){closeModal();return}
      if($("login")&&!$("login").hidden){$("login").hidden=true;return}
    }
    if(e.key==="Tab"&&backdrop&&!backdrop.classList.contains("hidden")){
      const focusables=[...backdrop.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
      if(focusables.length){
        const first=focusables[0],last=focusables[focusables.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();return}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();return}
      }
    }

    const item=e.target.closest?.(".job-item");
    if(!item)return;
    const listEl=item.closest(".job-list");
    if((e.key==="ArrowDown"||e.key==="ArrowUp")&&listEl){
      e.preventDefault();
      const items=[...listEl.querySelectorAll(".job-item")];
      const idx=items.indexOf(item);
      if(idx<0)return;
      const next=items[Math.max(0,Math.min(items.length-1,idx+(e.key==="ArrowDown"?1:-1)))];
      if(next&&next!==item){
        next.click();
        next.focus();
      }
      return;
    }
    if(e.key==="Enter"||e.key===" "){
      if(e.target.closest("a[href],button,input,select,textarea"))return;
      e.preventDefault();
      item.click();
      const split=item.closest(".split");
      const detail=split?.querySelector(".detail-col");
      if(detail){
        const firstAction=detail.querySelector("a.button, button.button, button, a[href]");
        (firstAction||detail).focus();
      }
    }
  });

  // Controles de Filtro de Vagas
  for(const[id,campo]of[["f-fonte","fonte"],["f-area","area"],["f-mod","mod"],["f-score","score"],["ordem","ordem"]]){
    $(id)?.addEventListener("change",e=>{f[campo]=e.target.value;salvarFiltros();render()});
  }
  $("busca")?.addEventListener("input",e=>{busca=e.target.value;render()});
  $("limpar")?.addEventListener("click",()=>{
    f={...f,status:"todas",fonte:"",area:"",mod:"",score:"0"};
    busca="";if($("busca"))$("busca").value="";
    salvarFiltros();render();
  });

  // Adicionar Vaga Manualmente
  $("toggle-manual")?.addEventListener("click",()=>{
    const p=$("manual-panel");if(!p)return;
    p.hidden=!p.hidden;
    $("toggle-manual").setAttribute("aria-expanded",String(!p.hidden));
    if(!p.hidden)p.querySelector("input")?.focus();
  });
  $("close-manual")?.addEventListener("click",()=>{
    $("manual-panel").hidden=true;
    $("toggle-manual")?.setAttribute("aria-expanded","false");
  });
  $("manual-panel")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const titulo=String(fd.get("titulo")||"").trim();
    const empresa=String(fd.get("empresa")||"").trim();
    if(!titulo||!empresa)return;
    const nova={
      id:`manual-${Date.now()}`,
      data:hoje(),
      titulo,
      empresa,
      local:String(fd.get("local")||profile?.city||"Remoto").trim(),
      modalidade:String(fd.get("modalidade")||"Remoto"),
      fonte:"Adicionada manualmente",
      area:inferirAreaTitulo(titulo),
      link:String(fd.get("link")||"#").trim(),
      texto:String(fd.get("texto")||"").trim(),
      motivo:"Adicionada manualmente e avaliada contra o seu perfil"
    };
    vagasManuais.unshift(nova);
    gravarUser("vagas-manuais",vagasManuais);
    e.target.reset();
    $("manual-panel").hidden=true;
    selectedJobId=nova.id;
    f.status="todas";
    salvarFiltros();
    render();
    showToast(`Vaga "${titulo}" adicionada e avaliada!`);
  });

  // Adicionar Erro Manual na Fila Vagas.com.br
  $("btn-add-erro-manual")?.addEventListener("click",()=>{
    const fm=$("form-erro-manual");if(fm)fm.hidden=!fm.hidden;
  });
  $("cancel-erro-manual")?.addEventListener("click",()=>{
    if($("form-erro-manual"))$("form-erro-manual").hidden=true;
  });
  $("form-erro-manual")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const novoErro={
      id:`vagascom-local-${Date.now()}`,
      fonte:"Vagas.com.br",
      tipo:"manual",
      termo:String(fd.get("titulo")||"").trim(),
      titulo:String(fd.get("titulo")||"").trim(),
      empresa:String(fd.get("empresa")||"Vagas.com.br").trim(),
      local:String(fd.get("local")||profile?.city||"Salvador, BA").trim(),
      link:String(fd.get("link")||"https://www.vagas.com.br").trim(),
      erro:String(fd.get("erro")||"Erro reportado pelo usuário").trim(),
      codigo_http:"Manual / Revisão",
      tentativas:1,
      primeira_falha_em:hoje(),
      ultima_tentativa_em:new Date().toISOString(),
      status_fila:"pendente"
    };
    filaErrosLocal.unshift(novoErro);
    gravarUser("fila-erros-local",filaErrosLocal);
    e.target.reset();
    e.target.hidden=true;
    selectedErrId=novoErro.id;
    render();
    showToast("Item registrado na fila de erros do Vagas.com.br.");
  });

  // Prova de Cobertura (#conf-bt)
  $("conf-bt")?.addEventListener("click",async()=>{
    const S=$("conf-saida"),linhas=$("conf-texto").value.split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,60);
    S.textContent="";
    if(!linhas.length){S.append(el("p","conf-resumo","Cole pelo menos um link ou um cargo com a empresa."));return}
    let cat;
    try{cat=await carregarCatalogo()}catch(e){cat=[];S.append(el("p","muted small","Catálogo estendido indisponível; comparando diretamente com as vagas ativas do painel."))}
    const rs=linhas.map(l=>({l,...conferirLinha(l,cat)}));
    const n=k=>rs.filter(r=>r.cls===k).length;
    S.append(el("p","conf-resumo",`${rs.length} ${rs.length>1?"conferidas":"conferida"}: ${n("painel")} no painel, ${n("fora")} lidas e deixadas de fora, ${n("nao")} não encontradas.`));
    const ul=el("ul","conf-lista");
    for(const r of rs){
      const li=el("li",r.cls);
      li.append(el("b",null,r.titulo),el("span",null,r.txt),el("span","linha-orig",r.l));
      ul.append(li);
    }
    S.append(ul);
  });

  // Disparar Busca Agora (#atualizar)
  $("atualizar")?.addEventListener("click",async()=>{
    const b=$("atualizar"),m=$("msg-atual");
    if(!b||!m)return;
    m.hidden=false;
    if(sb&&usuario){
      b.disabled=true;m.textContent="Iniciando busca no servidor…";
      const{error}=await sb.functions.invoke("buscar-agora");
      if(error){b.disabled=false;m.textContent="Buscando vagas atualizadas do repositório…";await carregarVagas();render();b.disabled=false;return}
    }else if(!token){
      m.textContent="Recarregando vagas mais recentes do painel… (Para disparar o coletor no GitHub Actions fora do horário, informe um token em Configurações).";
      await carregarVagas();render();
      return;
    }else{
      b.disabled=true;m.textContent="Iniciando o coletor no GitHub Actions…";
      try{
        const r=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/coletar.yml/dispatches`,{
          method:"POST",
          headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},
          body:JSON.stringify({ref:"main"})
        });
        if(r.status!==204)throw new Error(r.status);
      }catch(e){
        b.disabled=false;m.textContent="Não deu para iniciar. Confira se o token tem permissão Actions.";return;
      }
    }
    m.textContent="Busca iniciada! Leva cerca de 3 a 5 minutos; a lista atualiza automaticamente.";
    b.disabled=false;
  });

  // Eventos de Clientes
  $("campaign-select")?.addEventListener("change",e=>{activeCampaignId=e.target.value;desenharClientes()});
  $("new-campaign")?.addEventListener("click",()=>{const f=$("campaign-form");if(f)f.hidden=!f.hidden});
  $("cancel-campaign-btn")?.addEventListener("click",()=>{if($("campaign-form"))$("campaign-form").hidden=true});
  $("campaign-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const nova={
      id:`camp-${Date.now()}`,
      name:String(fd.get("name")||"Nova Campanha").trim(),
      city:String(fd.get("city")||profile?.city||"").trim(),
      niche:String(fd.get("niche")||"").trim(),
      dailyLimit:Number(fd.get("dailyLimit")||20),
      offer:String(fd.get("offer")||"").trim()
    };
    campaigns.unshift(nova);
    activeCampaignId=nova.id;
    salvarClientes();
    e.target.reset();
    e.target.hidden=true;
    desenharClientes();
    showToast(`Campanha "${nova.name}" criada!`);
  });

  $("add-lead-btn")?.addEventListener("click",()=>{const f=$("lead-form");if(f)f.hidden=!f.hidden});
  $("cancel-lead-btn")?.addEventListener("click",()=>{if($("lead-form"))$("lead-form").hidden=true});
  $("lead-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const name=String(fd.get("name")||"").trim();
    const category=String(fd.get("category")||"").trim();
    const city=String(fd.get("city")||profile?.city||"").trim();
    const signal=String(fd.get("signal")||"Demanda potencial de processos e indicadores").trim();
    const camp=campaigns.find(c=>c.id===activeCampaignId)||campaigns[0];
    const sk=listaSkillsPerfil().slice(0,3).join(", ")||"Planejamento e Gestão";
    const novo={
      id:`lead-${Date.now()}`,
      campaignId:activeCampaignId,
      name,
      category,
      city,
      contact:String(fd.get("contact")||"").trim(),
      website:String(fd.get("website")||"").trim(),
      score:84,
      reasons:[
        `Sinal identificado: ${signal}`,
        `Segmento (${category}) alinhado à campanha "${camp?.name||"Ativa"}" em ${city}`,
        `Aderência direta com suas competências (${sk})`
      ],
      status:"Preparado",
      sentAt:null,
      followUpDate:null,
      draft:`Olá, equipe da ${name}! Tudo bem?\n\nSou ${profile?.name||""}, atuo em ${profile?.city||city} com ${profile?.roles?.split(",")[0]||"planejamento e gestão"} (${sk}).\n\nAcompanhei a atuação de vocês em ${category} (${signal}) e estruturei uma solução prática para apoiar essa frente: ${camp?.offer||"controle de indicadores e cronogramas sem retrabalho"}.\n\nSe fizer sentido, posso mostrar um exemplo rápido de 10 minutos sem compromisso.\n\nAtenciosamente,\n${profile?.name||""}`
    };
    leads.unshift(novo);
    selectedLeadId=novo.id;
    salvarClientes();
    e.target.reset();
    e.target.hidden=true;
    desenharClientes();
    desenharVisaoGeral(visiveis());
    showToast(`Empresa "${name}" adicionada com score ${novo.score}!`);
  });
  $("lead-query")?.addEventListener("input",e=>{leadQuery=e.target.value;desenharClientes()});

  // Eventos de Publicações
  $("new-story-btn")?.addEventListener("click",()=>{const f=$("story-form");if(f)f.hidden=!f.hidden});
  $("cancel-story-btn")?.addEventListener("click",()=>{if($("story-form"))$("story-form").hidden=true});
  $("story-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const title=String(fd.get("title")||"").trim();
    const pillar=String(fd.get("pillar")||"Prova e projeto");
    const facts=String(fd.get("facts")||"").split(/[;\n]+/).map(s=>s.trim()).filter(Boolean);
    const novaStory={id:`story-${Date.now()}`,title,pillar,facts};
    stories.unshift(novaStory);
    const novoPost={
      id:`post-${Date.now()}`,
      title,
      pillar,
      status:"Rascunho",
      scheduledFor:hoje(),
      facts,
      text:`${title}\n\nNa prática de ${profile?.roles?.split(",")[0]||"projetos"}, consolidei aprendizados importantes:\n${facts.map(x=>`• ${x}`).join("\n")}\n\nQuando mantemos o foco nos dados reais e na revisão técnica, o resultado aparece na rotina da equipe.\n\n#${slug(pillar).replace(/-/g,"")} #Carreira #Projetos`
    };
    posts.unshift(novoPost);
    selectedPostId=novoPost.id;
    salvarPosts();
    e.target.reset();
    e.target.hidden=true;
    desenharPublicacoes();
    desenharVisaoGeral(visiveis());
    showToast("Fato salvo e rascunho de publicação gerado!");
  });
  $("plan-posts")?.addEventListener("click",gerarNovaPautaDoPerfil);

  // Eventos de Meu Perfil
  $("profile-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    profile={
      name:String(fd.get("name")||"Usuário").trim(),
      city:String(fd.get("city")||"Salvador, BA").trim(),
      regionCities:String(fd.get("regionCities")||"").trim(),
      headline:String(fd.get("headline")||"").trim(),
      roles:String(fd.get("roles")||"").trim(),
      acceptRemote:fd.get("acceptRemote")==="on",
      acceptHybrid:fd.get("acceptHybrid")==="on",
      acceptOnsite:fd.get("acceptOnsite")==="on",
      maxDays:Number(fd.get("maxDays")||14),
      contact:String(fd.get("contact")||"").trim(),
      skills:String(fd.get("skills")||"").trim(),
      summary:String(fd.get("summary")||"").trim()
    };
    gravarUser("perfil",profile);
    if(sb&&usuario){
      sb.from("perfis_usuarios").upsert({
        user_id:usuario.id,
        email:usuario.email||profile.contact||null,
        nome:profile.name,
        cargo_objetivo:profile.headline,
        cidade:profile.city,
        cidades_proximas:listaCidadesPerfil(),
        modalidades:[profile.acceptRemote&&"remoto",profile.acceptHybrid&&"hibrido",profile.acceptOnsite&&"presencial"].filter(Boolean),
        max_dias:profile.maxDays||14,
        areas:listaAreasPerfil(),
        competencias:listaSkillsPerfil(),
        config:profile,
        atualizado_em:new Date().toISOString()
      }).then(()=>{}).catch(()=>{});
    }
    sincronizarCabecalhoPerfil();
    atualizarUIAutenticacao();
    render();
    if($("profile-saved")){
      $("profile-saved").textContent="Perfil salvo! Scores e requisitos recalculados.";
      setTimeout(()=>{if($("profile-saved"))$("profile-saved").textContent=""},4000);
    }
    showToast(`Perfil de ${profile.name} salvo e vagas recalculadas!`);
    anunciarAcao(`Perfil de ${profile.name} salvo com sucesso.`);
  });

  $("btn-preset-erick")?.addEventListener("click",()=>{
    profile={...PRESET_DEFAULT_PROFILE};
    gravarUser("perfil",profile);
    preencherFormularioPerfil();
    sincronizarCabecalhoPerfil();
    render();
    showToast("Preset Eng. Planejamento (Erick) restaurado.");
  });

  $("btn-preset-blank")?.addEventListener("click",()=>{
    profile={...PRESET_BLANK_PROFILE};
    preencherFormularioPerfil();
    sincronizarCabecalhoPerfil();
    render();
    qs('#profile-form input[name="name"]')?.focus();
    showToast("Campos prontos para personalizar o perfil de um novo amigo!");
  });

  // Eventos de Configurações (Token GitHub, Supabase Custom, Backup, Login)
  $("form-token")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const t=$("token").value.trim();if(!t)return;
    token=t;
    try{
      const remoto=await lerEstadoGitHub();
      estado=remoto;
      gravarGlobal("token",t);
      $("token").value="";
      mostrarContaGitHub();
      render();
      showToast("Token do GitHub conectado!");
    }catch(err){
      token=lerGlobal("token","");
      if($("estado-conta")){
        $("estado-conta").textContent="Esse token não conseguiu ler o repositório. Confira a permissão Contents.";
        $("estado-conta").className="helper estado-conta erro";
      }
    }
  });
  $("tirar-token")?.addEventListener("click",()=>{
    token="";gravarGlobal("token","");mostrarContaGitHub();showToast("Token removido.");
  });

  $("supa-custom-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const url=String(fd.get("url")||"").trim(), anon=String(fd.get("anon")||"").trim();
    if(url&&anon){
      gravarGlobal("supabase-custom",{url,anon});
      showToast("Conexão Supabase salva! Recarregando…");
      setTimeout(()=>location.reload(),800);
    }
  });
  $("supa-clear-btn")?.addEventListener("click",()=>{
    gravarGlobal("supabase-custom",null);
    showToast("Conexão customizada removida.");
  });

  $("btn-export-data")?.addEventListener("click",()=>{
    const payload={
      exportedAt:new Date().toISOString(),
      profile,
      estado,
      vagasManuais,
      filaErrosLocal,
      campaigns,
      leads,
      stories,
      posts
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`radar-backup-${slug(profile?.name||"perfil")}-${hoje()}.json`;
    a.click();
    showToast("Backup JSON exportado!");
  });

  $("input-import-data")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const txt=await file.text();
      const data=JSON.parse(txt);
      if(data.profile){profile=data.profile;gravarUser("perfil",profile)}
      if(data.estado){estado=data.estado;gravarUser("estado-local",estado)}
      if(Array.isArray(data.vagasManuais)){vagasManuais=data.vagasManuais;gravarUser("vagas-manuais",vagasManuais)}
      if(Array.isArray(data.leads)){leads=data.leads;gravarUser("leads",leads)}
      if(Array.isArray(data.posts)){posts=data.posts;gravarUser("posts",posts)}
      if(Array.isArray(data.stories)){stories=data.stories;gravarUser("stories",stories)}
      preencherFormularioPerfil();
      sincronizarCabecalhoPerfil();
      desenharClientes();
      desenharPublicacoes();
      render();
      showToast("Backup importado com sucesso!");
    }catch(err){
      showToast("Arquivo JSON inválido.");
    }
  });

  // Controles da Tela de Login / Troca de Conta
  function abrirTelaLogin(){
    if($("login")){
      $("login").hidden=false;
      $("auth-email")?.focus();
    }
  }
  $("btn-switch-user")?.addEventListener("click",abrirTelaLogin);
  $("btn-open-auth-settings")?.addEventListener("click",abrirTelaLogin);

  $("auth-guest-btn")?.addEventListener("click",()=>{
    const nomeDigitado=$("auth-name")?.value?.trim();
    if(nomeDigitado){
      activeNamespace=`guest-${slug(nomeDigitado)}`;
      profile={...(profile||PRESET_DEFAULT_PROFILE),name:nomeDigitado};
      gravarUser("perfil",profile);
      sincronizarCabecalhoPerfil();
      preencherFormularioPerfil();
    }
    if($("login"))$("login").hidden=true;
    atualizarUIAutenticacao();
    render();
    showToast(`Modo Local ativo para ${profile?.name||"Convidado"}.`);
  });

  $("entrar")?.addEventListener("click",async()=>{
    if(!sb){
      if($("auth-feedback"))$("auth-feedback").textContent="Para login Google na nuvem, configure o Supabase em Configurações ou clique em 'Usar no Modo Local / Convidado'.";
      return;
    }
    await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}});
  });

  $("auth-email-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const email=String($("auth-email")?.value||"").trim();
    const password=String($("auth-pass")?.value||"");
    const nome=String($("auth-name")?.value||"").trim();
    if(sb){
      const{data,error}=await sb.auth.signInWithPassword({email,password});
      if(error){
        if($("auth-feedback"))$("auth-feedback").textContent=`Não entrou no Supabase (${error.message}). Você também pode criar conta ou usar o Modo Local.`;
        return;
      }
      usuario=data.user;
      activeNamespace=usuario.id||email;
      if($("login"))$("login").hidden=true;
      await inicializarSessaoEPainel();
      showToast(`Bem-vindo(a), ${email}!`);
    }else{
      // Sessão multiusuário local por e-mail quando não há backend Supabase configurado
      activeNamespace=`user-${slug(email)}`;
      usuario={id:activeNamespace,email};
      carregarPerfilUsuario();
      if(nome){profile.name=nome;gravarUser("perfil",profile);sincronizarCabecalhoPerfil();preencherFormularioPerfil()}
      if($("login"))$("login").hidden=true;
      atualizarUIAutenticacao();
      carregarClientesUsuario();
      carregarPostsUsuario();
      render();
      showToast(`Sessão iniciada para ${profile?.name||email}!`);
    }
  });

  $("auth-signup-btn")?.addEventListener("click",async()=>{
    const email=String($("auth-email")?.value||"").trim();
    const password=String($("auth-pass")?.value||"");
    const nome=String($("auth-name")?.value||"").trim()||email.split("@")[0]||"Novo Usuário";
    if(!email||password.length<6){
      if($("auth-feedback"))$("auth-feedback").textContent="Informe seu nome, um e-mail válido e uma senha de pelo menos 6 caracteres.";
      return;
    }
    if(sb){
      const{data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:nome}}});
      if(error){
        if($("auth-feedback"))$("auth-feedback").textContent=`Erro ao criar conta: ${error.message}`;
        return;
      }
      usuario=data.user||{id:`user-${slug(email)}`,email};
      activeNamespace=usuario.id||email;
    }else{
      activeNamespace=`user-${slug(email)}`;
      usuario={id:activeNamespace,email};
    }
    profile={...PRESET_BLANK_PROFILE,name:nome,contact:email};
    gravarUser("perfil",profile);
    if($("login"))$("login").hidden=true;
    await inicializarSessaoEPainel();
    setView("profile");
    showToast(`Conta criada para ${nome}! Personalize suas áreas e currículo.`);
  });

  $("sair")?.addEventListener("click",async()=>{
    if(sb){try{await sb.auth.signOut()}catch(e){}}
    usuario=null;
    activeNamespace="local";
    abrirTelaLogin();
    atualizarUIAutenticacao();
    showToast("Sessão encerrada. Escolha outra conta ou continue no modo local.");
  });

  // Inicialização
  inicializarSessaoEPainel();
})();
