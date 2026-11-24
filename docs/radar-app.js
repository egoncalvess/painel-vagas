/* Radar Multi-User Application (docs/radar-app.js)
 * 1. Sincronização multiusuário com Supabase + cache local por conta.
 * 2. Autenticação com usuário/e-mail e senha (admin vs user) + acesso de convidado.
 * 3. Responsividade para desktop e celular com Gaveta Mobile de Detalhes e Filtros recolhíveis.
 */
(function(){
  "use strict";

  const MESES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const STATUS=[
    ["todas","Todas"],
    ["novas","Novas"],
    ["pendentes","Para me candidatar"],
    ["salvas","Salvas ★"],
    ["feitas","Me candidatei"],
    ["retorno","Com retorno"],
    ["erros","Fila de erros (vagas.com.br)"]
  ];

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

  const CAMPOS_TEXTO_PERFIL=[
    "name","city","regionCities","headline","roles","maxDays","contact","skills","summary",
    "targetRole","seniority","phone","linkedinUrl","linkedinHeadline","linkedinAbout",
    "experiencesText","educationText","certifications","languages"
  ];

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
    contact:"engerickgoncalves@gmail.com",
    skills:"MS Project, Power BI, SAP, Excel avançado, Orçamento e custos, Curva S / valor agregado, PCM / Manutenção, CREA ativo, NR-10",
    summary:"Engenharia e planejamento com foco em controle de obras, cronogramas físico-financeiros (MS Project / Curva S), indicadores em Power BI, SAP PM/MM e gestão de manutenção e contratos.",
    targetRole:"",seniority:"",phone:"",linkedinUrl:"",linkedinHeadline:"",linkedinAbout:"",
    experiencesText:"",educationText:"",certifications:"",languages:""
  };

  const PRESET_BLANK_PROFILE={
    name:"Novo Usuário",
    city:"Salvador, BA",
    regionCities:"salvador, lauro de freitas, camaçari, candeias, simões filho",
    headline:"Painel personalizado de vagas, currículo e publicações LinkedIn.",
    roles:"Gestão de projetos, Planejamento e controle, Manutenção, Dados e BI, Operações",
    acceptRemote:true,
    acceptHybrid:true,
    acceptOnsite:true,
    maxDays:14,
    contact:"",
    skills:"Excel avançado, Power BI, MS Project, Inglês",
    summary:"Profissional com foco em organização de processos, indicadores e acompanhamento de projetos.",
    targetRole:"",seniority:"",phone:"",linkedinUrl:"",linkedinHeadline:"",linkedinAbout:"",
    experiencesText:"",educationText:"",certifications:"",languages:""
  };

  const $=id=>document.getElementById(id);
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const isMobileViewport=()=>window.matchMedia("(max-width: 960px)").matches;
  const hoje=()=>new Date().toISOString().slice(0,10);
  const dataLonga=d=>{if(!d||!/^\d{4}-\d{2}-\d{2}/.test(d))return d||"Recentes";const[a,m,dd]=d.slice(0,10).split("-");return `${+dd} de ${MESES[(+m||1)-1]} de ${a}`};
  const dataCurta=d=>{if(!d)return "";const p=String(d).slice(0,10).split("-");return p.length===3?`${p[2]}/${p[1]}`:d};
  const semAcento=t=>String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const slug=t=>semAcento(t).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
  const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}

  const REPO=(()=>{
    const h=location.hostname.match(/^([^.]+)\.github\.io$/);
    const r=location.pathname.split("/").filter(Boolean)[0];
    return h&&r?`${h[1]}/${r}`:"egoncalvess/painel-vagas";
  })();
  const API_ESTADO=`https://api.github.com/repos/${REPO}/contents/docs/estado.json`;

  // ==================== 1. MOTOR DE BASE DE DADOS DINÂMICA POR PESSOA (RadarDynamicDB) ====================
  // Armazena em IndexedDB + espelho síncrono em localStorage por usuário, zero dependência de Token GitHub.
  const RadarDynamicDB={
    db:null,
    dbName:"RadarDynamicDB",
    version:1,
    stores:["users","progress","profiles","posts","stories","error_queue"],
    init(){
      return new Promise(resolve=>{
        if(!window.indexedDB){resolve(null);return}
        try{
          const req=indexedDB.open(this.dbName,this.version);
          req.onupgradeneeded=e=>{
            const db=e.target.result;
            for(const st of this.stores){
              if(!db.objectStoreNames.contains(st))db.createObjectStore(st,{keyPath:"userKey"});
            }
          };
          req.onsuccess=e=>{this.db=e.target.result;resolve(this.db)};
          req.onerror=()=>resolve(null);
        }catch(e){resolve(null)}
      });
    },
    put(storeName,userKey,data){
      try{localStorage.setItem(`radar_db:${storeName}:${userKey}`,JSON.stringify(data))}catch(e){}
      return new Promise(resolve=>{
        if(!this.db||!this.db.objectStoreNames.contains(storeName)){resolve(true);return}
        try{
          const tx=this.db.transaction(storeName,"readwrite");
          tx.objectStore(storeName).put({userKey,data,updatedAt:new Date().toISOString()});
          tx.oncomplete=()=>resolve(true);
          tx.onerror=()=>resolve(false);
        }catch(e){resolve(false)}
      });
    },
    get(storeName,userKey,fallback){
      try{
        const raw=localStorage.getItem(`radar_db:${storeName}:${userKey}`);
        if(raw!=null)return JSON.parse(raw);
      }catch(e){}
      return fallback;
    },
    async hydrateUserToLocal(userKey){
      if(!this.db)return;
      for(const st of this.stores){
        await new Promise(res=>{
          try{
            const req=this.db.transaction(st,"readonly").objectStore(st).get(userKey);
            req.onsuccess=()=>{
              if(req.result&&req.result.data!==undefined){
                try{localStorage.setItem(`radar_db:${st}:${userKey}`,JSON.stringify(req.result.data))}catch(e){}
              }
              res();
            };
            req.onerror=()=>res();
          }catch(e){res()}
        });
      }
    }
  };
  window.RadarDynamicDB=RadarDynamicDB;

  async function sha256Hex(texto){
    if(window.crypto&&window.crypto.subtle){
      const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(texto)));
      return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
    }
    let h=0;
    const s=String(texto);
    for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;
    return "fallback-"+Math.abs(h).toString(16);
  }

  // Estado Global e Sessão Ativa por Pessoa
  let sb=null, usuario=null, activeNamespace="guest";
  let activeView="overview";
  let todas=[], vagasManuais=[], filaErrosRemota=[], filaErrosLocal=[], meta={};
  let estado={candidatei:{},salvas:{},descartadas:[]}, sha=null;
  let token=lerGlobal("token","");
  let profile=null;
  let f={status:"todas",ordem:"data",fonte:"",area:"",mod:"",score:"0"};
  let busca="";
  let selectedJobId=null, selectedErrId=null, selectedPostId=null;
  let postFilter="Todos";
  let stories=[], posts=[];
  let lastModalTrigger=null, toastTimer=null;

  function lerGlobal(k,p){try{const v=localStorage.getItem(k);return v==null?p:JSON.parse(v)}catch(e){return p}}
  function gravarGlobal(k,v){try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v))}catch(e){}}

  const DB_MISS=Symbol("db_miss");
  function userKey(k){return `radar:${activeNamespace}:${k}`}
  function lerUser(k,p){
    const fromDb=RadarDynamicDB.get(k,activeNamespace,DB_MISS);
    if(fromDb!==DB_MISS&&fromDb!==undefined&&fromDb!==null)return fromDb;
    try{
      const v=localStorage.getItem(userKey(k));
      if(v!=null){
        const parsed=JSON.parse(v);
        if(parsed!==undefined&&parsed!==null)return parsed;
      }
    }catch(e){}
    return p;
  }
  function gravarUser(k,v){
    try{localStorage.setItem(userKey(k),JSON.stringify(v))}catch(e){}
    if(RadarDynamicDB.stores.includes(k))RadarDynamicDB.put(k,activeNamespace,v);
    else RadarDynamicDB.put("progress",`${activeNamespace}:${k}`,v);
    sincronizarProgressoContasSupabase();
    sinalizarSincronizacaoBase();
    atualizarOnboardingBanner();
  }

  let syncSupaTimer=null;
  function sincronizarProgressoContasSupabase(){
    if(!sb||!activeNamespace||activeNamespace==="guest")return;
    clearTimeout(syncSupaTimer);
    syncSupaTimer=setTimeout(async()=>{
      try{
        await sb.from("progresso_contas").upsert({
          account_key:activeNamespace,
          user_id:usuario?.isSupabase?usuario.id:null,
          email:usuario?.email||profile?.contact||null,
          nome:profile?.name||usuario?.name||activeNamespace,
          provider:usuario?.provider||"local",
          role:usuario?.role||"user",
          perfil:profile||{},
          estado:estado||{candidatei:{},salvas:{},descartadas:[]},
          posts:posts||[],
          stories:stories||[],
          vagas_manuais:vagasManuais||[],
          fila_erros:filaErrosLocal||[],
          atualizado_em:new Date().toISOString()
        });
      }catch(e){}
    },250);
  }

  function sinalizarSincronizacaoBase(){
    const pill=$("db-sync-pill"), st=$("robot-status");
    if(pill)pill.textContent=`Sincronizado (${profile?.name?.split(" ")[0]||activeNamespace})`;
    if(st&&meta.atualizado_em){
      const d=new Date(meta.atualizado_em);
      st.textContent=`Atualizado em ${d.toLocaleDateString("pt-BR")}`;
    }
  }

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

  async function copiarTexto(texto,rotulo="Texto"){
    let copiou=false;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(texto);
        copiou=true;
      }
    }catch(_){}
    if(!copiou){
      try{
        const ta=document.createElement("textarea");
        ta.value=texto;
        ta.setAttribute("readonly","");
        ta.style.position="fixed";
        ta.style.opacity="0";
        document.body.appendChild(ta);
        ta.select();
        copiou=document.execCommand("copy");
        ta.remove();
      }catch(_){}
    }
    if(copiou){
      showToast(`${rotulo} copiado para a área de transferência!`);
      anunciarAcao(`${rotulo} copiado.`);
    }else{
      showToast("Não foi possível copiar automaticamente.");
    }
    return copiou;
  }

  // ==================== TEMA CLARO / ESCURO ====================
  function aplicarTema(tema){
    const t=tema==="dark"?"dark":"light";
    document.documentElement.dataset.theme=t;
    const mc=qs('meta[name="color-scheme"]');if(mc)mc.content=t;
    const mt=qs('meta[name="theme-color"]');if(mt)mt.content=t==="dark"?"#0b1412":"#112926";
    const useEl=qs("#theme-icon use");
    if(useEl)useEl.setAttribute("href",t==="dark"?"#i-sun":"#i-moon");
    qsa("[data-theme-choice]").forEach(b=>{
      const on=b.dataset.themeChoice===t;
      b.classList.toggle("active",on);
      b.setAttribute("aria-pressed",String(on));
    });
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

  // ==================== CONTAS DE USUÁRIOS E SESSÃO ATIVA ====================
  function listarContasLocais(){
    const map=lerGlobal("radar-accounts-registry",{});
    return map&&typeof map==="object"&&!Array.isArray(map)?map:{};
  }

  function registrarContaNoAparelho(acc){
    const map=listarContasLocais();
    const key=(acc.email||acc.username||acc.userId).toLowerCase();
    map[key]={...(map[key]||{}),...acc,updatedAt:new Date().toISOString()};
    gravarGlobal("radar-accounts-registry",map);
    RadarDynamicDB.put("users",key,map[key]);
    return map[key];
  }

  function ehContaDoErick(){
    const id=semAcento(activeNamespace);
    const em=semAcento(usuario?.email||"");
    const nm=semAcento(profile?.name||"");
    return id==="erick"||id==="user-engerickgoncalves-gmail-com"||em==="engerickgoncalves@gmail.com"||nm==="erick goncalves";
  }

  // ==================== PERFIL MULTIUSUÁRIO & AVALIAÇÃO DINÂMICA ====================
  function carregarPerfilUsuario(){
    const salvo=lerUser("profiles",null)||lerUser("perfil",null);
    if(salvo&&typeof salvo==="object"&&salvo.name){
      profile={...PRESET_BLANK_PROFILE,...salvo};
    }else if(usuario&&(semAcento(usuario.email)==="engerickgoncalves@gmail.com"||semAcento(usuario.userId)==="erick")){
      profile={...PRESET_DEFAULT_PROFILE};
    }else if(usuario&&usuario.name){
      profile={...PRESET_BLANK_PROFILE,name:usuario.name,contact:usuario.email||""};
    }else{
      profile={...PRESET_BLANK_PROFILE};
    }
    const filtrosSalvos=lerUser("filtros",{});
    f=Object.assign({status:"todas",ordem:"data",fonte:"",area:"",mod:"",score:"0"},filtrosSalvos&&typeof filtrosSalvos==="object"?filtrosSalvos:{});
    const vm=lerUser("vagas-manuais",[]);
    vagasManuais=Array.isArray(vm)?vm:[];
    const fe=lerUser("error_queue",null)||lerUser("fila-erros-local",[]);
    filaErrosLocal=Array.isArray(fe)?fe:[];
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
    if($("topbar-avatar"))$("topbar-avatar").textContent=ini;
    if($("sidebar-name"))$("sidebar-name").textContent=profile.name;
    if($("sidebar-role"))$("sidebar-role").textContent=profile.city||"Perfil configurado";
    if($("greeting-name"))$("greeting-name").textContent=pNome;
    if($("quem")){
      const resumo=profile.headline||`Vagas avaliadas para ${profile.name} (${profile.city||"Remoto"}).`;
      $("quem").textContent=resumo;
    }
    if($("profile-card-avatar"))$("profile-card-avatar").textContent=ini;
    if($("profile-card-name"))$("profile-card-name").textContent=profile.name;
    if($("profile-card-line"))$("profile-card-line").textContent=`${profile.city} · ${profile.roles}`;
    if($("profile-card-contact"))$("profile-card-contact").textContent=profile.contact||(usuario?.email||"Conta ativa");
    if($("profile-summary")){
      const skCount=listaSkillsPerfil().length;
      $("profile-summary").textContent=`Perfil ativo de ${profile.name} (${profile.city}) com ${skCount} competências mapeadas no currículo.`;
    }
    sinalizarSincronizacaoBase();
    atualizarOnboardingBanner();
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

  const KW_STOPWORDS=new Set([
    "a","o","as","os","um","uma","uns","umas","de","da","do","das","dos","em","na","no","nas","nos",
    "por","para","pra","com","sem","sob","sobre","entre","ate","apos","desde","contra","perante",
    "e","ou","mas","nem","que","se","como","quando","onde","quem","qual","quais","cujo","cuja",
    "ao","aos","a","as","pelo","pela","pelos","pelas","num","numa","nuns","numas","dum","duma",
    "este","esta","estes","estas","esse","essa","esses","essas","aquele","aquela","isto","isso","aquilo",
    "meu","minha","seu","sua","seus","suas","nosso","nossa","nossos","nossas","dele","dela",
    "ser","estar","ter","haver","fazer","poder","dever","ir","vir","ver","dar","atuar","trabalhar",
    "sao","foi","era","sera","seja","tem","tinha","terao","pode","podem","deve","devem","esta","estao",
    "mais","menos","muito","muita","muitos","muitas","pouco","pouca","todo","toda","todos","todas",
    "outro","outra","outros","outras","mesmo","mesma","cada","algum","alguma","nenhum","nenhuma",
    "bem","mal","ja","ainda","sempre","nunca","tambem","apenas","somente","inclusive","atraves",
    "vaga","vagas","empresa","empresas","oportunidade","oportunidades","area","areas","cargo","funcao",
    "atividade","atividades","requisito","requisitos","desejavel","diferencial","diferenciais",
    "beneficio","beneficios","salario","remuneracao","contrato","regime","clt","pj","estagio",
    "remoto","hibrido","presencial","candidatura","candidatar","curriculo","perfil","profissional",
    "experiencia","experiencias","conhecimento","conhecimentos","habilidade","habilidades",
    "formacao","superior","completo","completa","cursando","ensino","medio","tecnico","nivel",
    "responsavel","responsabilidades","qualificacao","qualificacoes","atribuicoes","descricao",
    "time","equipe","equipes","cliente","clientes","mercado","negocio","negocios","trabalho",
    "dia","dias","semana","mes","meses","ano","anos","hora","horas","turno","escala",
    "salvador","bahia","brasil","sao","paulo","rio","janeiro","belo","horizonte","curitiba",
    "the","and","for","with","from","that","this","your","our","you","are","will","have","has",
    "not","but","all","any","can","into","about","more","other","such","than","then","them",
    "they","were","been","being","what","when","where","which","who","how","why","each","most",
    "job","jobs","work","working","role","team","teams","company","position","opportunity",
    "experience","skills","skill","requirements","requirement","preferred","required","plus",
    "years","year","knowledge","ability","strong","good","great","new","using","used","use"
  ]);
  const KW_CURTAS_VALIDAS=new Set(["bi","qa","ti","rh","ux","ui","ai","ia","c#","go","r"]);

  function gerarResumoPalavrasChave(v,req){
    const titulo=String(v?.titulo||"");
    const area=String(v?.area||"");
    const motivo=String(v?.motivo||"");
    const texto=String(v?.texto||"");
    const corpoNorm=semAcento([titulo,area,motivo,texto].filter(Boolean).join(" "));
    const tituloAreaNorm=semAcento([titulo,area].filter(Boolean).join(" "));

    const noPerfil=[];
    const vistos=new Set();
    const addPerfil=termo=>{
      const limpo=String(termo||"").trim();
      const norm=semAcento(limpo);
      if(!limpo||!norm||vistos.has(norm))return;
      vistos.add(norm);
      noPerfil.push(limpo);
    };

    for(const item of (req?.tenho||[]))addPerfil(item);
    for(const sk of listaSkillsPerfil()){
      const skNorm=semAcento(sk);
      if(!skNorm)continue;
      const escaped=skNorm.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const rx=new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,"i");
      if(rx.test(corpoNorm))addPerfil(sk);
    }

    const daVaga=[];
    const addVaga=termo=>{
      const limpo=String(termo||"").trim();
      const norm=semAcento(limpo);
      if(!limpo||!norm||vistos.has(norm))return false;
      vistos.add(norm);
      daVaga.push(limpo);
      return true;
    };

    for(const item of (req?.conferir||[])){
      if(daVaga.length>=12)break;
      addVaga(item);
    }

    const freq=new Map();
    const origLabel=new Map();
    const coletarTokens=(str,peso)=>{
      const matches=String(str||"").match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9+#.\-/]{1,28}/g)||[];
      for(const raw of matches){
        const limpo=raw.replace(/^[.\-/]+|[.\-/,;:!?()]+$/g,"");
        if(!limpo)continue;
        const norm=semAcento(limpo).replace(/^[.\-/]+|[.\-/]+$/g,"");
        if(!norm||/^\d+$/.test(norm))continue;
        if(norm.length<3&&!KW_CURTAS_VALIDAS.has(norm))continue;
        if(KW_STOPWORDS.has(norm)||vistos.has(norm))continue;
        freq.set(norm,(freq.get(norm)||0)+peso);
        if(!origLabel.has(norm)){
          const temMaiuscula=/[A-Z]/.test(limpo);
          origLabel.set(norm,temMaiuscula?limpo:limpo.toLowerCase());
        }
      }
    };

    coletarTokens(titulo,4);
    coletarTokens(area,3);
    coletarTokens(motivo,2);
    coletarTokens(texto,1);

    const ordenados=[...freq.entries()]
      .sort((a,b)=>{
        if(b[1]!==a[1])return b[1]-a[1];
        const aInTit=tituloAreaNorm.includes(a[0])?1:0;
        const bInTit=tituloAreaNorm.includes(b[0])?1:0;
        if(bInTit!==aInTit)return bInTit-aInTit;
        return a[0].localeCompare(b[0]);
      });

    for(const [norm] of ordenados){
      if(daVaga.length>=12)break;
      addVaga(origLabel.get(norm)||norm);
    }

    const todas=[...noPerfil,...daVaga];
    const textoCopia=`Vaga: ${titulo||"Vaga sem título"} (${v?.empresa||"Empresa não informada"})\nPalavras-chave principais: ${todas.length?todas.join(", "):"Nenhuma palavra-chave identificada"}`;
    return {noPerfil,daVaga,textoCopia};
  }

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
        candidatei_em:estado.candidatei[v.id]||null,
        salva:!!estado.salvas[v.id],
        salva_em:estado.salvas[v.id]||null
      });
    }
    return [...mapa.values()];
  }

  const visiveis=()=>todasCombinadas().filter(v=>!estado.descartadas.includes(v.id));

  // ==================== FILA SEPARADA DE ERROS VAGAS.COM.BR ====================
  function construirFilaErrosPadrao(dadosVagas){
    const lista=[];
    if(Array.isArray(dadosVagas?.fila_erros)){
      for(const item of dadosVagas.fila_erros){
        if(item&&item.id)lista.push({...item,fonte:item.fonte||"Vagas.com.br",status_fila:item.status_fila||"pendente"});
      }
    }
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
    const rawMap=lerUser("fila-erros-status",{});
    const statusMap=rawMap&&typeof rawMap==="object"&&!Array.isArray(rawMap)?rawMap:{};
    const loc=Array.isArray(filaErrosLocal)?filaErrosLocal:[];
    const rem=Array.isArray(filaErrosRemota)?filaErrosRemota:[];
    const map=new Map();
    for(const item of [...loc,...rem]){
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
    gravarUser("error_queue",filaErrosLocal);
    if(sb&&usuario){
      const payload={status_fila:novoStatus,ultima_tentativa_em:new Date().toISOString()};
      if(extra.tentativas!=null)payload.tentativas=extra.tentativas;
      sb.from("fila_erros_vagas").update(payload).eq("id",id).then(()=>{}).catch(()=>{});
    }
  }

  // ==================== PERSISTÊNCIA DINÂMICA DE MARCAÇÕES (SEM PRECISAR DE TOKEN GITHUB) ====================
  const regras={
    todas:()=>true,
    novas:v=>v.data===diaBusca(),
    pendentes:v=>!v.candidatei&&sc(v)>=70,
    salvas:v=>v.salva,
    feitas:v=>v.candidatei,
    retorno:v=>!!v.retorno,
    erros:()=>false
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
    const e={candidatei:{},salvas:{},descartadas:[]};
    for(const m of (data||[])){
      if(m.candidatei_em)e.candidatei[m.vaga_id]=m.candidatei_em;
      if(m.descartada)e.descartadas.push(m.vaga_id);
    }
    const local=lerUser("progress",null);
    if(local){
      Object.assign(e.candidatei,local.candidatei||{});
      e.descartadas=[...new Set([...e.descartadas,...(local.descartadas||[])])];
    }
    return e;
  }

  // Salva imediatamente no RadarDynamicDB do usuário logado (e sincroniza com Supabase/GitHub em background se ativo, sem falhar por falta de token)
  async function mudar(msg,fn,vid){
    fn(estado);
    gravarUser("progress",estado);
    if(sb&&usuario&&usuario.isSupabase&&vid){
      try{await sb.from("marcacoes").upsert(linhaMarca(vid))}catch(e){}
    }
    if(token&&ehContaDoErick()){
      try{
        const r=await fetch(API_ESTADO,{
          method:"PUT",
          headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},
          body:JSON.stringify({message:msg,content:b64(JSON.stringify(estado,null,1)),sha,branch:"main"})
        });
        if(r.ok)sha=(await r.json()).content.sha;
      }catch(e){}
    }
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

    const pendentesCount=vs.filter(v=>!v.candidatei&&sc(v)>=70).length;
    if($("nav-jobs"))$("nav-jobs").textContent=pendentesCount||vs.length;
    if($("nav-errors")){
      $("nav-errors").textContent=`${errosAtivos.length} erro${errosAtivos.length===1?"":"s"}`;
      $("nav-errors").hidden=errosAtivos.length===0;
    }

    desenharFontes();
    if($("limpar"))$("limpar").hidden=!(f.fonte||f.area||f.mod||f.score!=="0"||f.status!=="todas"||busca);
    if($("btn-clear-busca"))$("btn-clear-busca").hidden=!busca;
    const qfMap={
      "qf-score80":f.score==="80",
      "qf-remoto":f.mod==="Remoto",
      "qf-salvas":f.status==="salvas",
      "qf-novas":f.status==="novas"
    };
    for(const[qid,on]of Object.entries(qfMap)){
      const qb=$(qid);
      if(qb){qb.classList.toggle("active",on);qb.setAttribute("aria-pressed",String(on))}
    }
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
      if(nextId){selectedJobId=nextId;desenharDetalheVaga(false)}
      const bt=proxCard.querySelector(classeAlvo)||proxCard;
      bt?.focus();
    }else{
      render();
      ($("filtros").querySelector(`button[aria-pressed="true"]`)||$("filtros").querySelector("button"))?.focus();
    }
  }

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
          if(selectedJobId===v.id)desenharDetalheVaga(false);
          bc.focus();
        }else{
          removerCardComFoco(art,".cand");
        }
        showToast(marcar?"Salvo na sua base dinâmica: Me candidatei!":"Candidatura desmarcada.");
        anunciarAcao(marcar?`Candidatura marcada em ${v.titulo}.`:`Candidatura desmarcada em ${v.titulo}.`);
      }catch(err){
        estado=JSON.parse(copia);bc.disabled=false;bc.textContent=txtCand(v);
      }
    };

    const txtSalva=cv=>cv.salva?"★ Salva":"☆ Salvar";
    const bs=el("button","save-btn",txtSalva(v));
    bs.type="button";
    bs.title="Salvar ou remover dos favoritos (atalho S)";
    bs.setAttribute("aria-pressed",String(!!v.salva));
    bs.onclick=async e=>{
      e.stopPropagation();
      bs.disabled=true;
      const copia=JSON.stringify(estado),salvar=!v.salva;
      try{
        await mudar((salvar?"Salvar vaga: ":"Remover salva: ")+v.titulo,est=>{
          if(!est.salvas||typeof est.salvas!=="object")est.salvas={};
          if(salvar)est.salvas[v.id]=hoje();else delete est.salvas[v.id];
        },v.id);
        v.salva=salvar;v.salva_em=estado.salvas[v.id]||null;
        const vs=visiveis();
        atualizarResumoControles(vs);
        desenharVisaoGeral(vs);
        if(passa(v,false)){
          bs.setAttribute("aria-pressed",String(!!v.salva));
          bs.textContent=txtSalva(v);
          bs.disabled=false;
          if(selectedJobId===v.id)desenharDetalheVaga(false);
        }else{
          removerCardComFoco(art,".save-btn");
        }
        showToast(salvar?"Vaga salva nos seus favoritos!":"Removida das vagas salvas.");
        anunciarAcao(salvar?`Vaga salva: ${v.titulo}.`:`Vaga removida das salvas: ${v.titulo}.`);
      }catch(err){
        estado=JSON.parse(copia);bs.disabled=false;bs.textContent=txtSalva(v);
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
        showToast("Vaga descartada da sua base dinâmica.");
        anunciarAcao(`Vaga descartada: ${v.titulo}.`);
      }catch(err){
        estado=JSON.parse(copia);armado=false;bd.classList.remove("armado");bd.disabled=false;bd.textContent="Descartar";
      }
    };

    ac.append(bc,bs,bd);
    art.append(ac,msgAcao);

    art.addEventListener("click",e=>{
      if(e.target.closest("button, a[href]"))return;
      selecionarVaga(v.id,true);
    });
    return art;
  }

  function selecionarVaga(id,fromUserClick=false){
    selectedJobId=id;
    qsa("#lista article.vaga").forEach(el=>{
      const ativo=el.dataset.id===id;
      el.classList.toggle("selected",ativo);
      el.setAttribute("aria-selected",ativo?"true":"false");
    });
    desenharDetalheVaga(fromUserClick&&isMobileViewport());
  }

  // ==================== GAVETA MOBILE DE DETALHES & SPLIT-VIEW ====================
  function abrirGavetaMobileDoPainel(detailEl,aoMontar){
    if(!detailEl)return;
    abrirModalHtml(`
      <div class="mobile-drawer-bar">
        <button class="button button-secondary button-sm" type="button" onclick="window.closeModal()">← Voltar para a lista</button>
        <span class="muted small">Detalhes</span>
      </div>
      <div id="mobile-drawer-body">${detailEl.innerHTML}</div>
    `,false);
    const body=$("mobile-drawer-body");
    if(body&&typeof aoMontar==="function")aoMontar(body);
  }

  function desenharDetalheVaga(openMobileDrawer=false){
    const D=$("job-detail");if(!D)return;
    if(f.status==="erros"){
      desenharDetalheErro(openMobileDrawer);
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
    const kwResumo=gerarResumoPalavrasChave(v,req);

    D.innerHTML=`
      <header class="d-head">
        <p class="d-co">${escapeHtml(v.empresa||"Empresa não informada")} · ${escapeHtml(v.local||"Local a confirmar")}</p>
        <h2 id="modal-title">${escapeHtml(v.titulo)}</h2>
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
          <button class="button button-secondary" type="button" data-detail-cand="${escapeHtml(v.id)}" aria-pressed="${v.candidatei}">
            ${v.candidatei?`Me candidatei${v.candidatei_em?" ("+dataCurta(v.candidatei_em)+")":""}`:"Marcar que me candidatei"}
          </button>
          <button class="button button-secondary" type="button" data-detail-save="${escapeHtml(v.id)}" aria-pressed="${!!v.salva}">
            ${v.salva?"★ Salva":"☆ Salvar vaga"}
          </button>
          <button class="button button-secondary" type="button" data-detail-ats="${escapeHtml(v.id)}">Gerar currículo ATS</button>
          <button class="button button-ghost danger" type="button" data-detail-desc="${escapeHtml(v.id)}">Descartar vaga</button>
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

      <section class="d-section">
        <div class="kw-head">
          <h3>Resumo de palavras-chave para candidatura</h3>
          <button class="button button-secondary button-sm" type="button" data-copy-kw="${escapeHtml(v.id)}">Copiar palavras-chave</button>
        </div>
        ${(kwResumo.noPerfil.length||kwResumo.daVaga.length)
          ?`<div class="kw-list">
              ${kwResumo.noPerfil.map(k=>`<span class="kw-chip match" title="Já consta no seu perfil">✓ ${escapeHtml(k)}</span>`).join("")}
              ${kwResumo.daVaga.map(k=>`<span class="kw-chip" title="Termo-chave da vaga">${escapeHtml(k)}</span>`).join("")}
            </div>`
          :`<p class="muted">Nenhuma palavra-chave relevante extraída para esta vaga.</p>`}
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
        <div><dt>Currículo / Base</dt><dd>${escapeHtml(v.curriculo||`Base dinâmica (${profile?.name?.split(" ")[0]||"ativa"})`)}</dd></div>
      </dl>
    `;

    const bindDetailActions=root=>{
      qs("[data-detail-cand]",root)?.addEventListener("click",()=>{
        const cardBtn=qs(`#lista article.vaga[data-id="${CSS.escape(v.id)}"] .cand`);
        if(cardBtn)cardBtn.click();
        if(root.id==="mobile-drawer-body")closeModal();
      });
      qs("[data-detail-save]",root)?.addEventListener("click",()=>{
        const cardBtn=qs(`#lista article.vaga[data-id="${CSS.escape(v.id)}"] .save-btn`);
        if(cardBtn)cardBtn.click();
        if(root.id==="mobile-drawer-body"){
          const btn=qs("[data-detail-save]",root);
          const prox=!v.salva;
          if(btn){btn.setAttribute("aria-pressed",String(prox));btn.textContent=prox?"★ Salva":"☆ Salvar vaga"}
        }
      });
      qs("[data-detail-desc]",root)?.addEventListener("click",()=>{
        const cardBtn=qs(`#lista article.vaga[data-id="${CSS.escape(v.id)}"] .desc`);
        if(cardBtn)cardBtn.click();
        if(root.id==="mobile-drawer-body")closeModal();
      });
      qs("[data-detail-ats]",root)?.addEventListener("click",()=>{
        if(root.id==="mobile-drawer-body")closeModal();
        abrirModalCurriculoATS(v);
      });
      qs("[data-copy-kw]",root)?.addEventListener("click",()=>{
        copiarTexto(kwResumo.textoCopia,`Palavras-chave da vaga ${v.titulo}`);
      });
    };
    bindDetailActions(D);

    if(openMobileDrawer&&isMobileViewport()){
      abrirGavetaMobileDoPainel(D,bindDetailActions);
    }
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
      desenharDetalheErro(isMobileViewport());
    });
    return art;
  }

  function desenharDetalheErro(openMobileDrawer=false){
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
        <h2 id="modal-title">${escapeHtml(er.titulo||"Falha na coleta Vagas.com.br")}</h2>
        <div class="d-fit">
          <span class="selo erro">${escapeHtml(er.codigo_http||"Erro de leitura")}</span>
          <span class="selo">${er.tentativas||1} tentativas registradas</span>
          <span class="selo sumiu">Status: ${escapeHtml(er.status_fila||"pendente")}</span>
        </div>
        <div class="d-actions">
          <a class="button" href="${escapeHtml(er.link||"https://www.vagas.com.br")}" target="_blank" rel="noopener noreferrer">
            Abrir link no Vagas.com.br <svg class="i" aria-hidden="true"><use href="#i-external"/></svg>
          </a>
          <button class="button button-secondary" type="button" data-err-retry="${escapeHtml(er.id)}">Tentar novamente / Reprocessar</button>
          <button class="button button-secondary" type="button" data-err-approve="${escapeHtml(er.id)}">Aprovar / Mover para o painel</button>
          <button class="button button-ghost danger" type="button" data-err-discard="${escapeHtml(er.id)}">Descartar da fila</button>
        </div>
      </header>
      <section class="d-section">
        <h3>Motivo técnico da falha</h3>
        <p>${escapeHtml(er.erro||"A página do Vagas.com.br não respondeu dentro do tempo limite ou omitiu a modalidade do anúncio.")}</p>
      </section>
      <section class="d-section">
        <h3>Aprovação rápida com escolha de modalidade</h3>
        <p class="muted small">Confirme a modalidade abaixo para mover a vaga imediatamente para o seu painel de vagas com score calculado:</p>
        <form data-err-quick-form="${escapeHtml(er.id)}" class="form-grid" style="margin-top:10px">
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

    const bindErrActions=root=>{
      qs("[data-err-retry]",root)?.addEventListener("click",()=>reprocessarErroVagasCom(er));
      qs("[data-err-approve]",root)?.addEventListener("click",()=>abrirModalAprovarErro(er));
      qs("[data-err-discard]",root)?.addEventListener("click",()=>{
        atualizarStatusErro(er.id,"descartado");
        closeModal();
        showToast("Erro descartado da fila.");
        render();
      });
      qs("[data-err-quick-form]",root)?.addEventListener("submit",e=>{
        e.preventDefault();
        const fd=new FormData(e.target);
        aprovarErroParaPainel(er,{
          titulo:fd.get("titulo"),
          empresa:fd.get("empresa"),
          local:fd.get("local"),
          modalidade:fd.get("modalidade")
        });
      });
    };
    bindErrActions(D);

    if(openMobileDrawer&&isMobileViewport()){
      abrirGavetaMobileDoPainel(D,bindErrActions);
    }
  }

  function reprocessarErroVagasCom(er){
    const novasTentativas=(er.tentativas||1)+1;
    const agora=new Date().toISOString();
    atualizarStatusErro(er.id,"pendente",{
      tentativas:novasTentativas,
      ultima_tentativa_em:agora,
      codigo_http:"Reprocessado · Aguardando confirmação"
    });
    anunciarAcao(`Tentativa #${novasTentativas} registrada para ${er.titulo}.`);
    showToast(`Tentativa #${novasTentativas} atualizada para ${er.titulo}.`);
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
    showToast(`Vaga "${novaVaga.titulo}" movida para o seu painel de vagas!`);
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

  // ==================== RENDER PRINCIPAL ====================
  function render(){
    const vs=visiveis();
    atualizarResumoControles(vs);
    desenharVisaoGeral(vs);

    const L=$("lista");if(!L)return;
    L.textContent="";

    if(f.status==="erros"){
      const fila=obterFilaErrosAtiva();
      if($("jobs-count"))$("jobs-count").textContent=`${fila.length} ${fila.length===1?"item na fila de erros":"itens na fila de erros"}`;
      if(!fila.length){
        L.append(el("p","aviso","Nenhum erro pendente na fila do Vagas.com.br."));
        desenharDetalheErro(false);
        return;
      }
      if(!fila.some(x=>x.id===selectedErrId))selectedErrId=fila[0].id;
      for(const er of fila)L.append(cardErroFila(er));
      desenharDetalheErro(false);
      return;
    }

    let lista=vs.filter(v=>passa(v,false));
    lista.sort(f.ordem==="score"?(a,b)=>sc(b)-sc(a)||(b.data||"").localeCompare(a.data||""):(a,b)=>(b.data||"").localeCompare(a.data||"")||sc(b)-sc(a));
    if($("jobs-count"))$("jobs-count").textContent=`${lista.length} ${lista.length===1?"vaga exibida":"vagas exibidas"}`;

    if(!lista.length){
      L.append(el("p","aviso",!vs.length?"Ainda não há vagas carregadas."
        :"Nenhuma vaga com esses filtros. Use Limpar filtros ativos para ver todas."));
      desenharDetalheVaga(false);
      return;
    }
    if(!lista.some(v=>v.id===selectedJobId))selectedJobId=lista[0].id;
    let dia="";
    for(const v of lista){
      if(f.ordem==="data"&&v.data!==dia){
        dia=v.data;
        L.append(el("div","job-date-group",dataLonga(dia)));
      }
      L.append(linha(v));
    }
    desenharDetalheVaga(false);
  }

  // ==================== VISÃO GERAL (OVERVIEW) ====================
  function desenharVisaoGeral(vs){
    const M=$("modules");
    const boas=vs.filter(v=>!v.candidatei&&sc(v)>=70);
    const feitas=vs.filter(v=>v.candidatei);
    const erros=obterFilaErrosAtiva();
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
      `).join(""):`<div class="empty"><strong>Nenhuma vaga carregada</strong><span>Clique em Atualizar vagas na aba Vagas.</span></div>`;
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

    const SG=$("summary-grid");
    if(SG){
      const fs=Object.entries(meta.fontes||{});
      const lidas=fs.reduce((a,[,x])=>a+(x.lidas||0),0);
      const novas=fs.reduce((a,[,x])=>a+(x.novas||0),0);
      SG.innerHTML=`
        <div><dt>Conta ativa</dt><dd>${escapeHtml(profile?.name?.split(" ")[0]||"Convidado")}</dd></div>
        <div><dt>Anúncios lidos na busca</dt><dd>${lidas||"—"}</dd></div>
        <div><dt>Novas na última coleta</dt><dd>${novas}</dd></div>
        <div><dt>No painel ativo</dt><dd>${vs.length}</dd></div>
        <div><dt>Fila de erros Vagas.com.br</dt><dd>${erros.length}</dd></div>
      `;
    }
  }

  // ==================== MÓDULO PUBLICAÇÕES LINKEDIN ====================
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
    const loadedStories=lerUser("stories",defStories);
    stories=Array.isArray(loadedStories)?loadedStories:defStories;

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
    const loadedPosts=lerUser("posts",defPosts);
    posts=Array.isArray(loadedPosts)?loadedPosts:defPosts;
    desenharPublicacoes(false);
    desenharHistoriasNoPerfil();
  }

  async function salvarPosts(){
    gravarUser("stories",stories);
    gravarUser("posts",posts);
    if(sb&&usuario&&usuario.isSupabase){
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
    desenharPublicacoes(false);
    desenharVisaoGeral(visiveis());
    showToast("Nova pauta gerada com base nos fatos reais do seu perfil!");
  }

  function desenharPublicacoes(openMobileDrawer=false){
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
        L.innerHTML=`<div class="empty"><strong>Nenhuma publicação neste status</strong><span>Clique em "Gerar pauta do meu perfil" acima.</span></div>`;
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
    desenharDetalhePost(openMobileDrawer);
  }

  function desenharDetalhePost(openMobileDrawer=false){
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
        <h2 id="modal-title">${escapeHtml(p.title)}</h2>
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
        <textarea data-post-text-input class="msg-box" rows="10">${escapeHtml(p.text||"")}</textarea>
        <div class="row-actions">
          <button class="button button-secondary" type="button" data-save-post-text>Salvar alterações</button>
          <button class="button button-secondary" type="button" data-copy-post-text><svg class="i" aria-hidden="true"><use href="#i-copy"/></svg> Copiar texto</button>
        </div>
      </section>
    `;

    const bindPostActions=root=>{
      qsa("[data-post-set-status]",root).forEach(btn=>{
        btn.addEventListener("click",()=>{
          p.status=btn.dataset.postSetStatus;
          salvarPosts();
          desenharPublicacoes(false);
          desenharVisaoGeral(visiveis());
          if(root.id==="mobile-drawer-body")closeModal();
          showToast(`Publicação salva como "${p.status}".`);
        });
      });
      qs("[data-save-post-text]",root)?.addEventListener("click",()=>{
        const ta=qs("[data-post-text-input]",root);
        if(ta)p.text=ta.value;
        salvarPosts();
        desenharPublicacoes(false);
        showToast("Texto da publicação salvo na base dinâmica.");
      });
      qs("[data-copy-post-text]",root)?.addEventListener("click",()=>{
        const txt=qs("[data-post-text-input]",root)?.value||"";
        navigator.clipboard?.writeText(txt).then(()=>showToast("Texto copiado!"));
      });
    };
    bindPostActions(D);

    if(openMobileDrawer&&isMobileViewport()){
      abrirGavetaMobileDoPainel(D,bindPostActions);
    }
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
    for(const k of CAMPOS_TEXTO_PERFIL){
      if(form.elements[k])form.elements[k].value=profile[k]??"";
    }
    if(form.elements.acceptRemote)form.elements.acceptRemote.checked=!!profile.acceptRemote;
    if(form.elements.acceptHybrid)form.elements.acceptHybrid.checked=!!profile.acceptHybrid;
    if(form.elements.acceptOnsite)form.elements.acceptOnsite.checked=!!profile.acceptOnsite;
  }

  function atualizarImpactoPerfil(vs){
    const box=$("profile-impact-box");
    if(box){
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
    desenharOtimizadorLinkedIn(vs);
  }

  // ==================== OTIMIZADOR DO LINKEDIN & CURRÍCULO ATS ====================
  const LI_BUZZWORDS=[
    "proativo","proativa","dinamico","dinamica","apaixonado","apaixonada",
    "focado em resultados","sinergia","pensar fora da caixa","visionario","visionaria",
    "ninja","guru","rockstar","passionate","motivated","team player",
    "results-driven","self-starter","hardworking","detail-oriented","go-getter","synergy"
  ];
  const LI_METRIC_RE=/(\d+(?:[.,]\d+)?\s*(?:%|r\$|mil|k|m\b|horas?|dias?|meses?|anos?|pessoas?|projetos?|obras?|contratos?|unidades?|mw|kw|kva)|\br\$\s*\d+)/i;
  const SENIORITY_LABELS={junior:"Júnior",pleno:"Pleno",senior:"Sênior",coordenacao:"Coordenação",gerencia:"Gerência"};

  function parseExperiencias(txt){
    try{
      const blocos=String(txt||"").trim().split(/\r?\n\s*\r?\n+/).filter(Boolean);
      const saida=[];
      for(const bloco of blocos){
        const linhas=bloco.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        if(!linhas.length)continue;
        let exp=null;
        for(const linha of linhas){
          const ehBullet=/^[-*•]\s*/.test(linha);
          if(!ehBullet&&!exp&&linha.includes("|")){
            const partes=linha.split("|").map(s=>s.trim());
            exp={titulo:partes[0]||"Experiência",empresa:partes[1]||"",periodo:partes[2]||"",bullets:[]};
          }else{
            if(!exp){
              exp={titulo:ehBullet?"Experiência profissional":linha,empresa:"",periodo:"",bullets:[]};
              if(!ehBullet)continue;
            }
            const limpo=linha.replace(/^[-*•]\s*/,"").trim();
            if(limpo)exp.bullets.push(limpo);
          }
        }
        if(exp)saida.push(exp);
      }
      return saida;
    }catch(_){
      return [];
    }
  }

  function parseFormacao(txt){
    try{
      return String(txt||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(linha=>{
        const partes=linha.split("|").map(s=>s.trim());
        return{curso:partes[0]||linha,instituicao:partes[1]||"",ano:partes[2]||""};
      });
    }catch(_){
      return [];
    }
  }

  function obterVagasTopAderencia(n=10){
    const base=(typeof visiveis==="function"?visiveis():[]).filter(v=>!estado?.descartadas?.includes(v.id));
    const ordenadas=[...base].sort((a,b)=>sc(b)-sc(a));
    const top70=ordenadas.filter(v=>sc(v)>=70);
    return (top70.length>=3?top70:ordenadas).slice(0,n);
  }

  function extrairKeywordsMercado(vagas){
    const mapa=new Map();
    const skillsNorm=listaSkillsPerfil().map(s=>semAcento(s)).filter(Boolean);
    for(const v of (vagas||[])){
      const req=v._req||calcularRequisitosDinamicos(v);
      const kw=gerarResumoPalavrasChave(v,req);
      const pesoVaga=Math.max(0.1,(sc(v)||50)/100);
      const vistosVaga=new Set();
      for(const termo of [...(kw.noPerfil||[]),...(kw.daVaga||[])]){
        const limpo=String(termo||"").trim();
        const norm=semAcento(limpo);
        if(!limpo||!norm||vistosVaga.has(norm))continue;
        vistosVaga.add(norm);
        const atual=mapa.get(norm)||{termo:limpo,peso:0,noPerfil:false};
        atual.peso+=pesoVaga;
        if(skillsNorm.some(sk=>sk===norm||sk.includes(norm)||norm.includes(sk))){
          atual.noPerfil=true;
        }
        mapa.set(norm,atual);
      }
    }
    return [...mapa.values()]
      .sort((a,b)=>b.peso-a.peso)
      .slice(0,20)
      .map(x=>({termo:x.termo,peso:Number(x.peso.toFixed(2)),noPerfil:x.noPerfil}));
  }

  function truncarHeadlineNoPonto(str,max=220){
    const txt=String(str||"").trim();
    if(txt.length<=max)return txt;
    const corte=txt.slice(0,max);
    const ultPonto=corte.lastIndexOf("·");
    if(ultPonto>40)return corte.slice(0,ultPonto).trim();
    const ultPipe=corte.lastIndexOf("|");
    if(ultPipe>40)return corte.slice(0,ultPipe).trim();
    return corte.trim();
  }

  function sugerirHeadlines(p,kws){
    const roles=listaAreasPerfil();
    const skills=listaSkillsPerfil();
    const sen=SENIORITY_LABELS[p?.seniority]||"";
    const cargoBase=(p?.targetRole||"").trim()||roles[0]||"Profissional";
    const cargo=sen&&!semAcento(cargoBase).includes(semAcento(sen))?`${cargoBase} ${sen}`:cargoBase;
    const areas2=roles.slice(0,2).join(" & ")||"Projetos & Operações";

    const kwsNorm=new Map((kws||[]).map(k=>[semAcento(k.termo),k.peso]));
    const skillsOrdenadas=[...skills].sort((a,b)=>(kwsNorm.get(semAcento(b))||0)-(kwsNorm.get(semAcento(a))||0));
    const skillsMatch=skillsOrdenadas.filter(s=>kwsNorm.has(semAcento(s)));
    const blocoFerramentas=(skillsMatch.length?skillsMatch:skillsOrdenadas).slice(0,5).join(" · ")||"Gestão · Indicadores";

    const modLista=[p?.acceptRemote&&"Remoto",p?.acceptHybrid&&"Híbrido",p?.acceptOnsite&&"Presencial"].filter(Boolean);
    const contexto=[modLista.slice(0,2).join("/"),(p?.city||"").trim()].filter(Boolean).join(" · ")||"Disponível para projetos";

    const a=truncarHeadlineNoPonto(`${cargo} | ${areas2} | ${blocoFerramentas}`,220);
    const b=truncarHeadlineNoPonto(`${cargo} | Especialista em ${skillsOrdenadas.slice(0,4).join(" · ")||blocoFerramentas} | ${roles[0]||"Resultados"}`,220);
    const c=truncarHeadlineNoPonto(`${cargo} | ${areas2} | ${contexto}`,220);
    return [a,b,c];
  }

  function sugerirSobre(p,kws){
    const roles=listaAreasPerfil();
    const skills=listaSkillsPerfil();
    const sen=SENIORITY_LABELS[p?.seniority]||"";
    const cargoBase=(p?.targetRole||"").trim()||roles[0]||"Profissional";
    const cargo=sen&&!semAcento(cargoBase).includes(semAcento(sen))?`${cargoBase} ${sen}`:cargoBase;
    const kwsNorm=new Map((kws||[]).map(k=>[semAcento(k.termo),k.peso]));
    const skillsOrdenadas=[...skills].sort((a,b)=>(kwsNorm.get(semAcento(b))||0)-(kwsNorm.get(semAcento(a))||0));

    const exps=parseExperiencias(p?.experiencesText);
    const fatosStories=(Array.isArray(stories)?stories:[]).flatMap(s=>Array.isArray(s?.facts)?s.facts:[]);
    const bulletsExp=exps.flatMap(e=>e.bullets||[]);
    const candidatosMetricas=[...fatosStories,...bulletsExp];
    const comMetrica=candidatosMetricas.filter(t=>LI_METRIC_RE.test(String(t||"")));
    const temMetricaNoResumo=LI_METRIC_RE.test(String(p?.summary||""));

    const partes=[];
    partes.push(`${cargo}${p?.city?` (${p.city})`:""}. ${String(p?.summary||"").trim()}`.trim());
    if(comMetrica.length){
      partes.push("Resultados e entregas de destaque:\n"+comMetrica.slice(0,3).map(f=>`• ${f}`).join("\n"));
    }else if(!temMetricaNoResumo){
      partes.push("Resultados e entregas: [inclua um resultado com número]");
    }
    if(roles.length)partes.push(`Áreas de atuação: ${roles.join(", ")}.`);
    if(skillsOrdenadas.length)partes.push(`Competências: ${skillsOrdenadas.slice(0,12).join(" · ")}.`);

    return partes.join("\n\n").slice(0,2600).trim();
  }

  function auditarPerfilLinkedIn(p,vagasTop){
    const kwsAll=extrairKeywordsMercado(vagasTop);
    const kws=kwsAll.slice(0,10);
    const hl=String(p?.linkedinHeadline||"").trim();
    const hlNorm=semAcento(hl);
    const about=String(p?.linkedinAbout||"").trim();
    const aboutNorm=semAcento(about);
    const skills=listaSkillsPerfil();
    const exps=parseExperiencias(p?.experiencesText);

    const kwsNaHeadline=kws.filter(k=>hlNorm.includes(semAcento(k.termo)));
    const kwsNoSobre=kws.filter(k=>aboutNorm.includes(semAcento(k.termo)));
    const buzzEncontradas=LI_BUZZWORDS.filter(bw=>hlNorm.includes(semAcento(bw)));
    const blocosHl=hl.split("|").map(s=>s.trim()).filter(s=>s.length>=5);
    const temExpComMetrica=exps.some(e=>(e.bullets||[]).some(b=>LI_METRIC_RE.test(b)));
    const cobertas=kws.filter(k=>k.noPerfil);

    const checks=[
      {
        id:"headline_presente",area:"headline",peso:10,
        passou:Boolean(hl),
        mensagem:hl?"Headline do LinkedIn preenchida.":"Headline do LinkedIn está vazia.",
        sugestao:"Preencha sua headline atual para auditoria completa."
      },
      {
        id:"headline_3_blocos",area:"headline",peso:10,
        passou:blocosHl.length===3,
        mensagem:blocosHl.length===3?"Headline estruturada em 3 blocos separados por '|'.":"Headline fora da estrutura de 3 blocos (Posição | Áreas | Ferramentas).",
        sugestao:"Use 3 blocos claros com '|' e pelo menos 5 caracteres em cada."
      },
      {
        id:"headline_tamanho",area:"headline",peso:5,
        passou:hl.length>=40&&hl.length<=220,
        mensagem:hl.length>=40&&hl.length<=220?`Tamanho adequado (${hl.length}/220 caracteres).`:`Tamanho fora do ideal (${hl.length} caracteres; recomendado 40–220).`,
        sugestao:"Ajuste a headline para ficar entre 40 e 220 caracteres."
      },
      {
        id:"headline_keywords",area:"headline",peso:10,
        passou:kws.length>0&&kwsNaHeadline.length>=2,
        mensagem:kws.length===0?"Carregue vagas para validar palavras-chave de mercado na headline.":(kwsNaHeadline.length>=2?`${kwsNaHeadline.length} palavras-chave do mercado presentes na headline.`:`Apenas ${kwsNaHeadline.length} palavra-chave do mercado na headline (meta: ≥2).`),
        sugestao:"Inclua termos-chave das vagas de maior aderência na headline."
      },
      {
        id:"headline_sem_buzzword",area:"headline",peso:5,
        passou:buzzEncontradas.length===0,
        mensagem:buzzEncontradas.length===0?"Sem buzzwords genéricas na headline.":`Termos genéricos encontrados na headline: ${buzzEncontradas.join(", ")}.`,
        sugestao:"Troque adjetivos genéricos por cargos, áreas e ferramentas concretas."
      },
      {
        id:"sobre_tamanho",area:"sobre",peso:10,
        passou:about.length>=300,
        mensagem:about.length>=300?`Seção Sobre com bom corpo (${about.length} caracteres).`:`Seção Sobre curta (${about.length}/300 caracteres mínimos).`,
        sugestao:"Desenvolva um resumo de pelo menos 300 caracteres com contexto e entregas."
      },
      {
        id:"sobre_metricas",area:"sobre",peso:10,
        passou:LI_METRIC_RE.test(about),
        mensagem:LI_METRIC_RE.test(about)?"Seção Sobre contém resultados com números/métricas.":"Seção Sobre sem métricas ou números de impacto.",
        sugestao:"Adicione números reais (%, R$, prazos, volume de obras/projetos)."
      },
      {
        id:"sobre_keywords",area:"sobre",peso:10,
        passou:kws.length>0&&kwsNoSobre.length>=3,
        mensagem:kws.length===0?"Carregue vagas para validar palavras-chave no Sobre.":(kwsNoSobre.length>=3?`${kwsNoSobre.length} palavras-chave do mercado encontradas no Sobre.`:`Poucas palavras-chave no Sobre (${kwsNoSobre.length}; meta: ≥3).`),
        sugestao:"Incorpore termos técnicos das vagas que você domina no texto do Sobre."
      },
      {
        id:"competencias_qtd",area:"competencias",peso:5,
        passou:skills.length>=5,
        mensagem:skills.length>=5?`${skills.length} competências mapeadas no perfil.`:`Poucas competências no perfil (${skills.length}; meta: ≥5).`,
        sugestao:"Liste ao menos 5 competências técnicas reais no campo de competências."
      },
      {
        id:"competencias_cobertura",area:"competencias",peso:10,
        passou:kws.length>0&&(cobertas.length/kws.length)>=0.5,
        mensagem:kws.length===0?"Carregue vagas para medir cobertura de competências.":`Cobertura de ${cobertas.length}/${kws.length} termos principais das vagas.`,
        sugestao:"Verifique se faltou cadastrar alguma ferramenta que você já domina."
      },
      {
        id:"experiencia_quantificada",area:"experiencia",peso:5,
        passou:temExpComMetrica,
        mensagem:temExpComMetrica?"Experiências incluem pelo menos 1 entrega quantificada.":"Nenhuma experiência com métrica/resultado numérico detectada.",
        sugestao:"Inclua números reais nos bullets de experiência (ex.: redução de prazo, % de economia)."
      },
      {
        id:"contato_completo",area:"extras",peso:5,
        passou:Boolean((p?.linkedinUrl||"").trim()&&(p?.city||"").trim()),
        mensagem:(p?.linkedinUrl||"").trim()&&(p?.city||"").trim()?"URL do LinkedIn e cidade preenchidas.":"Preencha URL do LinkedIn e cidade para contato completo.",
        sugestao:"Informe a URL do seu perfil LinkedIn e sua cidade."
      },
      {
        id:"extras",area:"extras",peso:5,
        passou:Boolean((p?.certifications||"").trim()||(p?.languages||"").trim()),
        mensagem:(p?.certifications||"").trim()||(p?.languages||"").trim()?"Certificações ou idiomas informados.":"Sem certificações nem idiomas informados.",
        sugestao:"Adicione certificações relevantes ou idiomas no perfil."
      }
    ].map(c=>({...c,severidade:c.passou?"ok":(c.peso>=10?"critico":"atencao")}));

    const score=checks.reduce((s,c)=>s+(c.passou?c.peso:0),0);
    const nivel=score<40?"fraco":score<65?"medio":score<85?"bom":"forte";
    const skillsFixar=[...skills].sort((a,b)=>{
      const pa=kwsAll.find(k=>semAcento(k.termo)===semAcento(a))?.peso||0;
      const pb=kwsAll.find(k=>semAcento(k.termo)===semAcento(b))?.peso||0;
      return pb-pa;
    }).slice(0,5);

    return{
      score,
      nivel,
      checks,
      sugestoes:{
        headlines:sugerirHeadlines(p,kws),
        sobre:sugerirSobre(p,kws),
        competencias:{
          fixarTop5:skillsFixar,
          adicionar:kwsAll.filter(k=>!k.noPerfil).map(k=>k.termo).slice(0,10),
          jaCobertas:kwsAll.filter(k=>k.noPerfil).map(k=>k.termo)
        },
        keywordsRecrutador:kwsAll.map(k=>k.termo).slice(0,15)
      },
      base:{
        totalVagas:(vagasTop||[]).length,
        idsVagas:(vagasTop||[]).map(v=>v.id),
        geradoEm:new Date().toISOString()
      }
    };
  }

  let liOptimizerDelegated=false;
  function desenharOtimizadorLinkedIn(vs){
    const panel=$("li-optimizer-panel");
    if(!panel)return;
    if(!liOptimizerDelegated){
      liOptimizerDelegated=true;
      panel.addEventListener("click",e=>{
        const btn=e.target.closest("[data-li-copy]");
        if(!btn)return;
        const pre=btn.closest(".li-suggest")?.querySelector(".li-copy-text");
        if(pre)copiarTexto(pre.textContent||"","Sugestão do LinkedIn");
      });
    }

    const vagasLista=Array.isArray(vs)&&vs.length?vs:(typeof visiveis==="function"?visiveis():[]);
    const vagasTop=vagasLista.length?obterVagasTopAderencia(10):[];
    const res=auditarPerfilLinkedIn(profile||{},vagasTop);
    const clsNota=res.score>=85?"boa":res.score>=65?"possivel":"";

    const baseEl=$("li-optimizer-base");
    if(baseEl){
      baseEl.textContent=vagasTop.length
        ?`Comparado com ${vagasTop.length} vagas de maior aderência do painel.`
        :"Carregue vagas para comparar com o mercado (auditoria básica ativa).";
    }

    const scoreEl=$("li-optimizer-score");
    if(scoreEl){
      scoreEl.innerHTML=`
        <div class="regua-box" aria-label="Nota do perfil LinkedIn">
          <div class="regua-num ${clsNota}">${res.score}<small>/100</small></div>
          <div style="flex:1">
            <div class="regua-bar ${clsNota}"><i style="width:${res.score}%"></i></div>
            <p class="muted small" style="margin-top:6px">Nível atual: <strong>${escapeHtml(res.nivel)}</strong></p>
          </div>
        </div>
      `;
    }

    const checklistEl=$("li-optimizer-checklist");
    if(checklistEl){
      checklistEl.innerHTML=res.checks.map(c=>`
        <li class="li-check" data-sev="${escapeHtml(c.severidade)}">
          <svg class="i" aria-hidden="true"><use href="#${c.passou?"i-check":"i-alert"}"/></svg>
          <div>
            <strong>${escapeHtml(c.mensagem)}</strong>
            ${c.passou?"":`<div class="muted small">${escapeHtml(c.sugestao)}</div>`}
          </div>
        </li>
      `).join("");
    }

    const hlEl=$("li-optimizer-headline");
    if(hlEl){
      hlEl.innerHTML=`<h3>Sugestões de Headline (3 opções)</h3>`+res.sugestoes.headlines.map((h,idx)=>`
        <div class="li-suggest">
          <pre class="li-copy-text">${escapeHtml(h)}</pre>
          <div class="li-suggest-foot">
            <span class="li-count">${h.length}/220 caracteres</span>
            <button class="button button-secondary button-sm" type="button" data-li-copy="hl-${idx}">Copiar headline ${idx+1}</button>
          </div>
        </div>
      `).join("");
    }

    const aboutEl=$("li-optimizer-about");
    if(aboutEl){
      const s=res.sugestoes.sobre;
      aboutEl.innerHTML=`
        <h3>Sugestão de Sobre</h3>
        <div class="li-suggest">
          <pre class="li-copy-text">${escapeHtml(s)}</pre>
          <div class="li-suggest-foot">
            <span class="li-count">${s.length}/2600 caracteres</span>
            <button class="button button-secondary button-sm" type="button" data-li-copy="about">Copiar Sobre</button>
          </div>
        </div>
      `;
    }

    const skillsEl=$("li-optimizer-skills");
    if(skillsEl){
      const {fixarTop5,adicionar}=res.sugestoes.competencias;
      skillsEl.innerHTML=`
        <h3>Competências estratégicas</h3>
        ${fixarTop5.length?`<p class="muted small">Fixar no topo: ${fixarTop5.map(s=>`<span class="kw-chip match">${escapeHtml(s)}</span>`).join(" ")}</p>`:""}
        ${adicionar.length?`<p class="muted small">Aparecem nas vagas (adicione só se você tem): ${adicionar.map(s=>`<span class="kw-chip">${escapeHtml(s)}</span>`).join(" ")}</p>`:""}
      `;
    }

    const kwEl=$("li-optimizer-keywords");
    if(kwEl){
      const kwsRec=res.sugestoes.keywordsRecrutador;
      kwEl.innerHTML=kwsRec.length
        ?`<h3>Termos mais buscados por recrutadores</h3><div class="kw-list">${kwsRec.map(k=>`<span class="kw-chip">${escapeHtml(k)}</span>`).join("")}</div>`
        :"";
    }
  }

  function montarCurriculoATS(p,vaga){
    const req=vaga?._req||calcularRequisitosDinamicos(vaga||{});
    const kwResumo=gerarResumoPalavrasChave(vaga||{},req);
    const usadas=kwResumo.noPerfil||[];
    const ausentes=kwResumo.daVaga||[];
    const termosVagaNorm=[...usadas,...ausentes].map(t=>semAcento(t));

    const nome=(p?.name||"").trim()||"Profissional";
    const contato=[p?.city,p?.contact,p?.phone,p?.linkedinUrl].map(x=>String(x||"").trim()).filter(Boolean);
    const roles=listaAreasPerfil();
    const cargoBase=(p?.targetRole||"").trim()||roles[0]||"";
    const sen=SENIORITY_LABELS[p?.seniority]||"";
    const titulo=[cargoBase,sen&&!semAcento(cargoBase).includes(semAcento(sen))?sen:""].filter(Boolean).join(" · ");

    let resumo=String(p?.summary||"").trim();
    const resumoNorm=semAcento(resumo);
    const extrasResumo=usadas.filter(u=>!resumoNorm.includes(semAcento(u))).slice(0,4);
    if(extrasResumo.length){
      resumo=(resumo?resumo+" ":"")+`Domínio em ${extrasResumo.join(", ")}.`;
    }

    const skills=listaSkillsPerfil();
    const usadasNorm=new Set(usadas.map(u=>semAcento(u)));
    const competencias=[...skills].sort((a,b)=>(usadasNorm.has(semAcento(b))?1:0)-(usadasNorm.has(semAcento(a))?1:0)).slice(0,14);

    const experiencias=parseExperiencias(p?.experiencesText).map(exp=>{
      const bulletsOrd=[...(exp.bullets||[])].sort((a,b)=>{
        const na=semAcento(a),nb=semAcento(b);
        const ma=termosVagaNorm.filter(t=>na.includes(t)).length;
        const mb=termosVagaNorm.filter(t=>nb.includes(t)).length;
        return mb-ma;
      });
      return{...exp,bullets:bulletsOrd};
    });

    const formacao=parseFormacao(p?.educationText);
    const certificacoes=String(p?.certifications||"").split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
    const idiomas=String(p?.languages||"").split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);

    return{
      nome,
      contato,
      titulo,
      resumo,
      competencias,
      experiencias,
      formacao,
      certificacoes,
      idiomas,
      keywordsVaga:{usadas,ausentes}
    };
  }

  function renderCurriculoATSHtml(dados,densidade="normal"){
    const expsHtml=(dados.experiencias||[]).map(exp=>`
      <div class="ats-exp">
        <h3>${escapeHtml(exp.titulo)}${exp.empresa?` — ${escapeHtml(exp.empresa)}`:""}</h3>
        ${exp.periodo?`<p class="ats-meta">${escapeHtml(exp.periodo)}</p>`:""}
        ${exp.bullets?.length?`<ul>${exp.bullets.map(b=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>`:""}
      </div>
    `).join("");

    const formHtml=(dados.formacao||[]).map(f=>`
      <p>${escapeHtml([f.curso,f.instituicao,f.ano].filter(Boolean).join(" · "))}</p>
    `).join("");

    const extras=[];
    if(dados.certificacoes?.length)extras.push(`Certificações: ${dados.certificacoes.join(", ")}`);
    if(dados.idiomas?.length)extras.push(`Idiomas: ${dados.idiomas.join(", ")}`);

    return`<article id="ats-sheet" class="ats-sheet" data-densidade="${escapeHtml(densidade)}">
      <h1>${escapeHtml(dados.nome)}</h1>
      ${dados.titulo?`<p class="ats-titulo">${escapeHtml(dados.titulo)}</p>`:""}
      ${dados.contato?.length?`<p class="ats-contato">${dados.contato.map(escapeHtml).join(" | ")}</p>`:""}
      ${dados.resumo?`<section><h2>Resumo</h2><p>${escapeHtml(dados.resumo)}</p></section>`:""}
      ${dados.competencias?.length?`<section><h2>Competências</h2><p>${dados.competencias.map(escapeHtml).join(" · ")}</p></section>`:""}
      ${dados.experiencias?.length?`<section><h2>Experiência</h2>${expsHtml}</section>`:""}
      ${dados.formacao?.length?`<section><h2>Formação</h2>${formHtml}</section>`:""}
      ${extras.length?`<section><h2>Certificações e Idiomas</h2><p>${escapeHtml(extras.join(" | "))}</p></section>`:""}
    </article>`;
  }

  function _substituirSheetDOM(sheet,dados,densidade){
    const tmp=document.createElement("div");
    tmp.innerHTML=renderCurriculoATSHtml(dados,densidade);
    const novo=tmp.firstElementChild;
    sheet.dataset.densidade=densidade;
    sheet.innerHTML=novo?novo.innerHTML:"";
  }

  function ajustarParaUmaPagina(sheet,dados,modoDensidade="auto"){
    const limitePx=Math.floor(273*96/25.4*0.98);
    const clone=JSON.parse(JSON.stringify(dados));
    let densidade=modoDensidade==="auto"?"normal":modoDensidade;
    const cortes=[];
    _substituirSheetDOM(sheet,clone,densidade);

    let maxBullets=99;
    let passo=0;
    for(let iter=0;iter<15;iter++){
      const altura=sheet.scrollHeight;
      if(altura<=limitePx){
        return{densidade,cortes,alturaPx:altura,limitePx,cabe:true,dadosAjustados:clone};
      }
      if(modoDensidade==="auto"&&densidade==="normal"){
        densidade="compacta";
        _substituirSheetDOM(sheet,clone,densidade);
        continue;
      }
      if(modoDensidade==="auto"&&densidade==="compacta"){
        densidade="minima";
        _substituirSheetDOM(sheet,clone,densidade);
        continue;
      }

      if(passo===0){
        maxBullets=4;
        let cortou=false;
        for(let i=clone.experiencias.length-1;i>=0;i--){
          if(clone.experiencias[i].bullets.length>maxBullets){
            clone.experiencias[i].bullets=clone.experiencias[i].bullets.slice(0,maxBullets);
            cortou=true;
          }
        }
        passo=1;
        if(cortou){cortes.push("Bullets limitados a 4 por experiência");_substituirSheetDOM(sheet,clone,densidade);continue}
      }
      if(passo===1){
        maxBullets=3;
        let cortou=false;
        for(let i=clone.experiencias.length-1;i>=0;i--){
          if(clone.experiencias[i].bullets.length>maxBullets){
            clone.experiencias[i].bullets=clone.experiencias[i].bullets.slice(0,maxBullets);
            cortou=true;
          }
        }
        passo=2;
        if(cortou){cortes.push("Bullets limitados a 3 por experiência");_substituirSheetDOM(sheet,clone,densidade);continue}
      }
      if(passo===2){
        maxBullets=2;
        let cortou=false;
        for(let i=clone.experiencias.length-1;i>=0;i--){
          if(clone.experiencias[i].bullets.length>maxBullets){
            clone.experiencias[i].bullets=clone.experiencias[i].bullets.slice(0,maxBullets);
            cortou=true;
          }
        }
        passo=3;
        if(cortou){cortes.push("Bullets limitados a 2 por experiência");_substituirSheetDOM(sheet,clone,densidade);continue}
      }
      if(passo===3){
        passo=4;
        if(clone.experiencias.length>4){
          const rem=clone.experiencias.slice(4).map(e=>e.titulo).join(", ");
          clone.experiencias=clone.experiencias.slice(0,4);
          cortes.push(`Removidas experiências mais antigas (${rem})`);
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===4){
        passo=5;
        if(clone.experiencias.length>3){
          const rem=clone.experiencias.slice(3).map(e=>e.titulo).join(", ");
          clone.experiencias=clone.experiencias.slice(0,3);
          cortes.push(`Experiências reduzidas para 3 (${rem} removida)`);
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===5){
        passo=6;
        if(clone.competencias.length>10){
          clone.competencias=clone.competencias.slice(0,10);
          cortes.push("Competências reduzidas para 10");
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===6){
        passo=7;
        if(clone.competencias.length>8){
          clone.competencias=clone.competencias.slice(0,8);
          cortes.push("Competências reduzidas para 8");
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===7){
        passo=8;
        const frases=String(clone.resumo||"").split(/(?<=[.!?])\s+/).filter(Boolean);
        if(frases.length>2){
          clone.resumo=frases.slice(0,2).join(" ");
          cortes.push("Resumo encurtado para 2 frases");
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===8){
        passo=9;
        if(clone.formacao.length>1){
          clone.formacao=clone.formacao.slice(0,1);
          cortes.push("Formação limitada ao curso mais recente");
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      if(passo===9){
        passo=10;
        let encurtou=false;
        for(const exp of clone.experiencias){
          exp.bullets=exp.bullets.map(b=>{
            if(b.length<=180)return b;
            encurtou=true;
            const c=b.slice(0,180);
            const sp=c.lastIndexOf(" ");
            return (sp>100?c.slice(0,sp):c).trim()+"…";
          });
        }
        if(encurtou){
          cortes.push("Bullets longos (>180 chars) abreviados");
          _substituirSheetDOM(sheet,clone,densidade);
          continue;
        }
      }
      break;
    }

    const alturaFinal=sheet.scrollHeight;
    return{densidade,cortes,alturaPx:alturaFinal,limitePx,cabe:alturaFinal<=limitePx,dadosAjustados:clone};
  }

  function copiarCurriculoTextoPuro(dados){
    const linhas=[];
    linhas.push(dados.nome||"Profissional");
    if(dados.titulo)linhas.push(dados.titulo);
    if(dados.contato?.length)linhas.push(dados.contato.join(" | "));
    if(dados.resumo){linhas.push("","RESUMO",dados.resumo)}
    if(dados.competencias?.length){linhas.push("","COMPETÊNCIAS",dados.competencias.join(" · "))}
    if(dados.experiencias?.length){
      linhas.push("","EXPERIÊNCIA");
      for(const exp of dados.experiencias){
        linhas.push(`${exp.titulo}${exp.empresa?` — ${exp.empresa}`:""}${exp.periodo?` (${exp.periodo})`:""}`);
        for(const b of (exp.bullets||[]))linhas.push(`- ${b}`);
      }
    }
    if(dados.formacao?.length){
      linhas.push("","FORMAÇÃO");
      for(const f of dados.formacao)linhas.push([f.curso,f.instituicao,f.ano].filter(Boolean).join(" · "));
    }
    const extras=[];
    if(dados.certificacoes?.length)extras.push(`Certificações: ${dados.certificacoes.join(", ")}`);
    if(dados.idiomas?.length)extras.push(`Idiomas: ${dados.idiomas.join(", ")}`);
    if(extras.length){linhas.push("","CERTIFICAÇÕES E IDIOMAS",extras.join(" | "))}
    return linhas.join("\n");
  }

  function imprimirCurriculoATS(vaga,dados,modoDensidade="auto",sheetEl=null){
    const sheet=sheetEl||$("ats-sheet");
    if(!sheet)return;
    ajustarParaUmaPagina(sheet,dados,modoDensidade);

    let root=$("ats-print-root");
    if(!root){
      root=document.createElement("div");
      root.id="ats-print-root";
      root.setAttribute("aria-hidden","true");
      document.body.appendChild(root);
    }
    root.innerHTML="";
    root.appendChild(sheet.cloneNode(true));

    const tituloOriginal=document.title;
    const nomeLimpo=String(dados.nome||"Profissional").replace(/[\\/:*?"<>|]/g,"").trim();
    const vagaLimpa=String(vaga?.titulo||"Geral").replace(/[\\/:*?"<>|]/g,"").trim().slice(0,50);
    document.title=`Curriculo - ${nomeLimpo} - ${vagaLimpa}`;
    document.body.classList.add("printing-ats");

    let limpo=false;
    const limpar=()=>{
      if(limpo)return;
      limpo=true;
      document.title=tituloOriginal;
      document.body.classList.remove("printing-ats");
      root.innerHTML="";
      window.removeEventListener("afterprint",limpar);
    };
    window.addEventListener("afterprint",limpar);
    try{
      window.print();
    }finally{
      setTimeout(limpar,1200);
    }
  }

  async function renderizarCurriculoATSEm(vaga,alvos={}){
    const sheet=alvos.sheetEl;
    if(!sheet)return null;
    sheet.classList.add("ats-sheet");

    const prefs=lerUser("ats_prefs",{densidade:"auto"});
    const modoInicial=prefs?.densidade||"auto";
    const dados=montarCurriculoATS(profile||{},vaga||{});
    const ausentes=dados.keywordsVaga?.ausentes||[];

    if(alvos.densitySelect)alvos.densitySelect.value=modoInicial;

    if(alvos.gapsEl){
      if(ausentes.length){
        alvos.gapsEl.hidden=false;
        alvos.gapsEl.innerHTML=`<strong>Termos da vaga ausentes no seu perfil (não incluídos no currículo):</strong> <span>${ausentes.map(escapeHtml).join(", ")}</span>`;
      }else{
        alvos.gapsEl.innerHTML="";
        alvos.gapsEl.hidden=true;
      }
    }

    if(document.fonts?.ready){
      try{await document.fonts.ready}catch(_){}
    }

    let ultimoAjuste=null;
    const atualizarEscalaMobile=()=>{
      const preview=alvos.previewEl||sheet.closest(".ats-preview");
      const paper=alvos.paperEl||sheet.closest(".ats-paper");
      if(!preview||!paper)return;
      if(isMobileViewport()){
        const w=preview.clientWidth||window.innerWidth-32;
        const escala=Math.min(1,Math.max(0.32,(w-16)/793.7));
        paper.style.transform=`scale(${escala.toFixed(3)})`;
        paper.style.transformOrigin="top left";
      }else{
        paper.style.transform="";
        paper.style.transformOrigin="";
      }
    };

    const recalcular=modo=>{
      ultimoAjuste=ajustarParaUmaPagina(sheet,dados,modo);
      const pct=Math.min(100,Math.round((ultimoAjuste.alturaPx/ultimoAjuste.limitePx)*100));
      if(alvos.statusEl){
        const baseMsg=ultimoAjuste.cabe
          ?`Cabe em 1 página · ${pct}% da altura (densidade ${ultimoAjuste.densidade})`
          :`Excede 1 página (${pct}% da altura)`;
        alvos.statusEl.textContent=ultimoAjuste.cortes.length
          ?`${baseMsg} · Ajustes: ${ultimoAjuste.cortes.join("; ")}`
          :baseMsg;
      }
      atualizarEscalaMobile();
    };

    recalcular(modoInicial);

    if(alvos.densitySelect){
      alvos.densitySelect.onchange=e=>{
        const modo=e.target.value||"auto";
        gravarUser("ats_prefs",{densidade:modo});
        recalcular(modo);
      };
    }
    if(alvos.printBtn){
      alvos.printBtn.onclick=()=>{
        const modo=alvos.densitySelect?.value||"auto";
        imprimirCurriculoATS(vaga,dados,modo,sheet);
      };
    }
    if(alvos.copyBtn){
      alvos.copyBtn.onclick=()=>{
        const fonte=ultimoAjuste?.dadosAjustados||dados;
        copiarTexto(copiarCurriculoTextoPuro(fonte),"Currículo em texto puro");
      };
    }
    return ultimoAjuste;
  }

  let selectedResumeJobId=null;
  function desenharViewCurriculoATS(){
    const selectEl=$("resume-job-select");
    const topEl=$("resume-top-jobs");
    const sheetEl=$("resume-ats-sheet");
    if(!selectEl&&!topEl&&!sheetEl)return;

    const vagasTop=obterVagasTopAderencia(15);
    if(!selectedResumeJobId||!vagasTop.some(v=>v.id===selectedResumeJobId)){
      selectedResumeJobId=(selectedJobId&&vagasTop.some(v=>v.id===selectedJobId))?selectedJobId:(vagasTop[0]?.id||"");
    }

    if(selectEl){
      const opts=vagasTop.map(v=>`<option value="${escapeHtml(v.id)}"${v.id===selectedResumeJobId?" selected":""}>${escapeHtml(v.titulo)} — ${escapeHtml(v.empresa||"Empresa")} (${sc(v)} pts)</option>`);
      opts.push(`<option value=""${selectedResumeJobId===""?" selected":""}>Currículo base do perfil (sem vaga)</option>`);
      selectEl.innerHTML=opts.join("");
      selectEl.onchange=e=>{
        selectedResumeJobId=e.target.value||"";
        desenharViewCurriculoATS();
      };
    }

    if(topEl){
      topEl.innerHTML=vagasTop.length
        ?vagasTop.slice(0,6).map(v=>`<button type="button" class="chip${v.id===selectedResumeJobId?" active":""}" data-resume-job="${escapeHtml(v.id)}" aria-pressed="${v.id===selectedResumeJobId}">${escapeHtml(v.titulo)} · ${sc(v)} pts</button>`).join("")
        :`<span class="muted small">Nenhuma vaga carregada ainda; exibindo currículo base do perfil.</span>`;
      topEl.onclick=e=>{
        const btn=e.target.closest("[data-resume-job]");
        if(!btn)return;
        selectedResumeJobId=btn.dataset.resumeJob||"";
        desenharViewCurriculoATS();
      };
    }

    const vagaSel=vagasTop.find(v=>v.id===selectedResumeJobId)||null;
    if(sheetEl){
      renderizarCurriculoATSEm(vagaSel,{
        sheetEl,
        densitySelect:$("resume-ats-density"),
        printBtn:$("resume-ats-print"),
        copyBtn:$("resume-ats-copy-text"),
        statusEl:$("resume-ats-fit-status"),
        gapsEl:$("resume-ats-gaps")
      });
    }
  }

  async function abrirModalCurriculoATS(vaga){
    const prefs=lerUser("ats_prefs",{densidade:"auto"});
    const modoInicial=prefs?.densidade||"auto";

    abrirModalHtml(`
      <div class="ats-modal">
        <h2 id="modal-title">Currículo ATS (1 página A4) — ${escapeHtml(vaga?.titulo||"Vaga")}</h2>
        <div class="ats-toolbar">
          <label class="muted small" for="ats-density">Densidade
            <select id="ats-density">
              <option value="auto"${modoInicial==="auto"?" selected":""}>Automática</option>
              <option value="normal"${modoInicial==="normal"?" selected":""}>Normal (10.5pt)</option>
              <option value="compacta"${modoInicial==="compacta"?" selected":""}>Compacta (10pt)</option>
              <option value="minima"${modoInicial==="minima"?" selected":""}>Mínima (9.5pt)</option>
            </select>
          </label>
          <button class="button" type="button" id="ats-print">Imprimir / Salvar PDF</button>
          <button class="button button-secondary" type="button" id="ats-copy-text">Copiar texto puro</button>
          <p id="ats-fit-status" role="status" class="muted small"></p>
        </div>
        <div class="ats-preview">
          <div class="ats-paper">
            <article id="ats-sheet" class="ats-sheet" data-densidade="${escapeHtml(modoInicial==="auto"?"normal":modoInicial)}"></article>
          </div>
        </div>
        <div id="ats-gaps" class="ats-gaps" hidden></div>
      </div>
    `,true);

    const back=$("modal-backdrop");
    qs(".modal",back)?.classList.add("modal-wide");

    await renderizarCurriculoATSEm(vaga,{
      sheetEl:$("ats-sheet"),
      paperEl:qs(".ats-paper",back),
      previewEl:qs(".ats-preview",back),
      densitySelect:$("ats-density"),
      printBtn:$("ats-print"),
      copyBtn:$("ats-copy-text"),
      statusEl:$("ats-fit-status"),
      gapsEl:$("ats-gaps")
    });
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

  // ==================== MODAIS ACESSÍVEIS: CONVIDAR AMIGOS, CÓDIGO DE SINCRONIZAÇÃO E SELETOR GOOGLE ====================
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
    back.classList.remove("modal-wide");
    qs(".modal",back)?.classList.remove("modal-wide");
    document.body.classList.remove("modal-open");
    if(lastModalTrigger&&lastModalTrigger.isConnected){
      const toFocus=lastModalTrigger;
      lastModalTrigger=null;
      setTimeout(()=>toFocus.focus(),0);
    }
  }
  window.openModal=abrirModalHtml;
  window.closeModal=closeModal;

  function abrirModalManualUso(){
    abrirModalHtml(`
      <h2 id="modal-title">Manual de uso do Radar</h2>
      <p class="muted" style="margin-top:6px">Guia rápido para configurar seu currículo, filtrar vagas e salvar seu progresso.</p>
      <ol class="steps" style="margin-top:16px">
        <li><strong>1. Configure seu currículo (Meu perfil):</strong> Informe sua cidade, modalidades aceitas (Remoto, Híbrido, Presencial) e suas competências. Todas as vagas são recalculadas na hora.</li>
        <li><strong>2. Busque e use filtros rápidos:</strong> Na aba <strong>Vagas</strong>, use a busca ou os atalhos <em>Score 80+</em>, <em>Remoto</em>, <em>Salvas ★</em> e <em>Novas hoje</em>. Clique em <strong>☆ Salvar</strong> para favoritar vagas importantes.</li>
        <li><strong>3. Atalhos de teclado (PC):</strong> Pressione <kbd>/</kbd> para focar a busca, <kbd>↑</kbd>/<kbd>↓</kbd> ou <kbd>J</kbd>/<kbd>K</kbd> para navegar na lista, <kbd>S</kbd> para salvar a vaga selecionada e <kbd>Esc</kbd> para fechar janelas.</li>
        <li><strong>4. Marque candidaturas e descarte:</strong> Use <em>Marcar que me candidatei</em> para acompanhar seu funil ou <em>Descartar</em> (duplo clique de confirmação) para limpar a lista.</li>
        <li><strong>5. Sincronize Celular ↔ PC:</strong> A sincronização é automática ao entrar com sua conta (e-mail e senha) em qualquer aparelho. Em <strong>Configurações</strong>, você também pode baixar uma cópia em <code>.json</code>.</li>
      </ol>
      <div class="form-actions" style="margin-top:16px">
        <button class="button" type="button" onclick="window.closeModal()">Entendi</button>
      </div>
    `,true);
  }

  function abrirModalConvidarAmigos(){
    const urlCompartilhar=location.origin+location.pathname;
    abrirModalHtml(`
      <h2 id="modal-title">Convidar e Compartilhar com Amigos</h2>
      <p class="muted" style="margin-top:6px">Cada pessoa pode criar seu acesso gratuito e manter seu próprio histórico separado.</p>
      <ol class="steps" style="margin-top:16px">
        <li><strong>Login individual:</strong> Seu amigo clica em <em>Criar acesso</em>. O sistema cria uma conta exclusiva para ele na nuvem.</li>
        <li><strong>Currículo e Cidade:</strong> Na aba <strong>Meu perfil</strong>, ele preenche o próprio Nome, Cidade/UF, Áreas e Competências.</li>
        <li><strong>Zero mistura de dados:</strong> As candidaturas, vagas salvas, descartes e publicações ficam 100% isolados na conta dele.</li>
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
      const msg=`Olha esse painel gratuito para acompanhar vagas (com score pelo currículo) e posts do LinkedIn: ${urlCompartilhar} — Crie seu acesso e configure seus cargos e currículo em "Meu perfil"!`;
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
    qsa(".view").forEach(v=>{
      const on=v.id===view||v.id===`view-${view}`;
      v.classList.toggle("active",on);
      v.hidden=!on;
    });
    qsa(".nav-item").forEach(b=>{
      const on=b.dataset.view===view;
      b.classList.toggle("active",on);
      if(on)b.setAttribute("aria-current","page");
      else b.removeAttribute("aria-current");
    });
    qs(".profile-chip")?.classList.toggle("active",view==="profile");
    if(view==="linkedin")desenharOtimizadorLinkedIn(visiveis());
    if(view==="resume")desenharViewCurriculoATS();
    window.scrollTo({top:0,behavior:"instant"});
  }
  const mostrar=setView;

  function salvarFiltros(){
    gravarUser("filtros",{status:f.status,ordem:f.ordem,fonte:f.fonte,area:f.area,mod:f.mod,score:f.score});
  }

  // ==================== CARREGAMENTO DE VAGAS (JSON / SUPABASE) ====================
  async function carregarVagas(){
    let dados=null;
    let usouCache=false;
    let erroRede=null;

    if(sb&&usuario&&usuario.isSupabase){
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
      }catch(e){erroRede=e;}
    }

    if(!dados){
      const ctrl=typeof AbortController!=="undefined"?new AbortController():null;
      const timer=ctrl?setTimeout(()=>ctrl.abort(),12000):null;
      try{
        const r=await fetch("vagas.json?t="+Date.now(),{
          cache:"no-store",
          ...(ctrl?{signal:ctrl.signal}:{})
        });
        if(!r.ok)throw new Error("HTTP "+r.status);
        dados=await r.json();
      }catch(e){
        erroRede=e;
      }finally{
        if(timer)clearTimeout(timer);
      }
    }

    if(dados&&Array.isArray(dados.vagas)){
      gravarGlobal("radar-vagas-cache",dados);
    }else{
      const cacheLocal=lerGlobal("radar-vagas-cache",null);
      if(cacheLocal&&Array.isArray(cacheLocal.vagas)){
        dados=cacheLocal;
        usouCache=true;
      }else if(Array.isArray(todas)&&todas.length){
        dados=meta&&Array.isArray(meta.vagas)?meta:{...(meta||{}),vagas:todas};
        usouCache=true;
      }else{
        throw erroRede||new Error("Falha ao carregar vagas");
      }
    }

    todas=dados.vagas||[];
    meta=dados;
    filaErrosRemota=construirFilaErrosPadrao(dados);

    if(dados.atualizado_em){
      const d=new Date(dados.atualizado_em);
      const fontesTxt=Object.entries(dados.fontes||{}).map(([n,x])=>`${n}: ${x.novas||0} novas (${x.lidas||0} lidas)`).join(" · ");
      const avisoCache=usouCache?" [cache local — sem conexão]":"";
      const msgResumo=`Última coleta em ${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.${fontesTxt?` ${fontesTxt}.`:""}${avisoCache}`;
      if($("atual"))$("atual").textContent=msgResumo;
      if($("last-run-home"))$("last-run-home").textContent=msgResumo;

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
    }else if(usouCache){
      const msgCache="Exibindo vagas do cache local (sem conexão com a rede).";
      if($("atual"))$("atual").textContent=msgCache;
      if($("last-run-home"))$("last-run-home").textContent=msgCache;
    }
    sinalizarSincronizacaoBase();
    return {atualizado_em:dados.atualizado_em,usouCache};
  }

  // ==================== AUTENTICAÇÃO E SESSÃO DINÂMICA POR PESSOA ====================
  function carregarScript(src,checkFn){
    return new Promise((ok,erro)=>{
      if(typeof checkFn==="function"?checkFn():window.supabase)return ok();
      const existing=document.querySelector(`script[src="${src}"]`);
      if(existing){existing.addEventListener("load",ok,{once:true});existing.addEventListener("error",erro,{once:true});return}
      const s=document.createElement("script");
      s.src=src;s.async=true;s.defer=true;s.onload=ok;s.onerror=erro;
      document.head.append(s);
    });
  }

  function resolverPapelUsuario(dados){
    const em=semAcento(dados?.email||"");
    const uid=semAcento(dados?.userId||dados?.id||"");
    if(em==="engerickgoncalves@gmail.com"||uid==="erick"||uid==="user-engerickgoncalves-gmail-com")return "admin";
    return dados?.role==="admin"?"admin":"user";
  }

  function atualizarOnboardingBanner(){
    const precisa=!profile||!String(profile.skills||"").trim()||profile.name==="Novo Usuário"||profile.name==="Visitante";
    if($("onboarding-banner"))$("onboarding-banner").hidden=!precisa;
    if($("onboarding-banner-jobs"))$("onboarding-banner-jobs").hidden=!precisa;
  }

  async function carregarUsuariosAdmin(){
    const box=$("admin-users-list");
    if(!box||usuario?.role!=="admin")return;
    const mapa=new Map();
    for(const [k,c] of Object.entries(listarContasLocais())){
      const role=resolverPapelUsuario(c);
      mapa.set((c.email||c.userId||k).toLowerCase(),{
        name:c.name||c.username||k,
        email:c.email||k,
        provider:c.provider||"local",
        role
      });
    }
    if(sb){
      try{
        const{data:perfis}=await sb.from("perfis").select("id,email,nome,role,atualizado_em");
        if(Array.isArray(perfis)){
          for(const p of perfis){
            const key=(p.email||p.id||"").toLowerCase();
            if(!key)continue;
            mapa.set(key,{
              name:p.nome||p.email||p.id,
              email:p.email||p.id,
              provider:"supabase",
              role:p.role==="admin"?"admin":"user"
            });
          }
        }
      }catch(e){}
      try{
        const{data:contas}=await sb.from("progresso_contas").select("account_key,email,nome,provider,role");
        if(Array.isArray(contas)){
          for(const c of contas){
            const key=(c.email||c.account_key||"").toLowerCase();
            if(!key||mapa.has(key))continue;
            mapa.set(key,{
              name:c.nome||c.account_key,
              email:c.email||c.account_key,
              provider:c.provider||"local",
              role:c.role==="admin"?"admin":"user"
            });
          }
        }
      }catch(e){}
    }
    const lista=[...mapa.values()];
    if(!lista.length){
      box.innerHTML='<p class="muted small">Nenhum usuário cadastrado ainda.</p>';
      return;
    }
    box.innerHTML=lista.map(u=>`
      <div class="admin-user-row">
        <div class="admin-user-main">
          <strong>${escapeHtml(u.name)}</strong>
          <span>${escapeHtml(u.email)} · ${escapeHtml(u.provider)}</span>
        </div>
        <span class="role-badge ${u.role==="admin"?"is-admin":""}">${u.role==="admin"?"Admin":"Usuário"}</span>
      </div>
    `).join("");
  }

  function aplicarVisibilidadePorPapel(){
    const isAdmin=usuario?.role==="admin";
    for(const id of ["sidebar-role-badge","topbar-role-badge"]){
      const elBadge=$(id);
      if(!elBadge)continue;
      elBadge.textContent=isAdmin?"Admin":"Usuário";
      elBadge.classList.toggle("is-admin",isAdmin);
    }
    if($("admin-settings-group"))$("admin-settings-group").hidden=!isAdmin;
    if(isAdmin)carregarUsuariosAdmin();
  }

  function atualizarUIAutenticacao(){
    const emailEl=$("email"), authLbl=$("sidebar-auth-label");
    if(usuario){
      const pNome=profile?.name?.split(" ")[0]||usuario.name||usuario.email;
      if(emailEl)emailEl.textContent=pNome;
      if(authLbl)authLbl.textContent="Trocar conta";
    }else{
      if(emailEl)emailEl.textContent="Convidado";
      if(authLbl)authLbl.textContent="Entrar / Conta";
    }
    aplicarVisibilidadePorPapel();
    atualizarOnboardingBanner();
  }

  async function autenticarSessaoPessoa(dadosSessao,remember=true){
    const roleInicial=resolverPapelUsuario(dadosSessao);
    usuario={
      id:dadosSessao.userId||dadosSessao.id||`user-${slug(dadosSessao.email||dadosSessao.name||"ativo")}`,
      userId:dadosSessao.userId||dadosSessao.id||`user-${slug(dadosSessao.email||dadosSessao.name||"ativo")}`,
      email:dadosSessao.email||"",
      name:dadosSessao.name||dadosSessao.username||"Usuário",
      provider:dadosSessao.provider||"password",
      role:roleInicial,
      isSupabase:!!dadosSessao.isSupabase
    };
    activeNamespace=usuario.userId;

    if(sb&&usuario.isSupabase&&usuario.id){
      try{
        const{data:perfilDb}=await sb.from("perfis").select("role").eq("id",usuario.id).maybeSingle();
        if(perfilDb?.role){
          usuario.role=perfilDb.role==="admin"||ehContaDoErick()?"admin":"user";
        }else{
          await sb.from("perfis").upsert({
            id:usuario.id,
            email:usuario.email||null,
            nome:usuario.name,
            role:usuario.role,
            atualizado_em:new Date().toISOString()
          });
        }
      }catch(e){}
    }

    const sessaoSalva={...usuario,loggedInAt:new Date().toISOString(),remember};
    gravarGlobal("radar-active-session",sessaoSalva);

    await RadarDynamicDB.hydrateUserToLocal(activeNamespace);
    if(sb&&activeNamespace&&activeNamespace!=="guest"){
      try{
        const{data:remotoConta}=await sb.from("progresso_contas").select("*").eq("account_key",activeNamespace).maybeSingle();
        if(remotoConta){
          if(remotoConta.perfil&&Object.keys(remotoConta.perfil).length&&!lerUser("profiles",null))RadarDynamicDB.put("profiles",activeNamespace,remotoConta.perfil);
          if(remotoConta.estado&&!lerUser("progress",null))RadarDynamicDB.put("progress",activeNamespace,remotoConta.estado);
          if(Array.isArray(remotoConta.posts)&&remotoConta.posts.length&&!lerUser("posts",null))RadarDynamicDB.put("posts",activeNamespace,remotoConta.posts);
          if(Array.isArray(remotoConta.stories)&&remotoConta.stories.length&&!lerUser("stories",null))RadarDynamicDB.put("stories",activeNamespace,remotoConta.stories);
        }
      }catch(e){}
    }
    carregarPerfilUsuario();

    // Carrega o progresso isolado desta pessoa do RadarDynamicDB
    const progressoSalvo=lerUser("progress",null);
    if(progressoSalvo&&typeof progressoSalvo==="object"){
      estado={
        candidatei:progressoSalvo.candidatei||{},
        salvas:progressoSalvo.salvas||{},
        descartadas:Array.isArray(progressoSalvo.descartadas)?progressoSalvo.descartadas:[]
      };
    }else if(ehContaDoErick()){
      // Somente para a conta do Erick: importa docs/estado.json na primeira vez como seed
      try{
        const r2=await fetch("estado.json?t="+Date.now());
        if(r2.ok){
          const estRemoto=await r2.json();
          estado={candidatei:estRemoto.candidatei||{},salvas:{},descartadas:estRemoto.descartadas||[]};
          gravarUser("progress",estado);
        }
      }catch(e){estado={candidatei:{},salvas:{},descartadas:[]}}
    }else{
      // Qualquer outra pessoa começa com o próprio painel limpo, nunca misturando com estado.json do Erick
      estado={candidatei:{},salvas:{},descartadas:[]};
      gravarUser("progress",estado);
    }

    if($("login"))$("login").hidden=true;
    if(location.hash==="#login")history.replaceState(null,"",location.pathname+location.search);

    atualizarUIAutenticacao();
    carregarPostsUsuario();
    render();
    showToast(`Bem-vindo(a), ${profile?.name||usuario.name}!`);
  }

  async function inicializarSessaoEPainel(){
    await RadarDynamicDB.init();
    listarContasLocais();

    const customSupa=lerGlobal("supabase-custom",null);
    const cfgSupa=(customSupa&&customSupa.url&&customSupa.anon)?customSupa:(window.SUPABASE&&window.SUPABASE.url?window.SUPABASE:null);

    if(cfgSupa&&cfgSupa.url&&cfgSupa.anon){
      try{
        await carregarScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js");
        sb=window.supabase.createClient(cfgSupa.url,cfgSupa.anon);
        const{data:{session}}=await sb.auth.getSession();
        if(session&&session.user){
          const u=session.user;
          try{await carregarVagas()}catch(e){
            const msgFalha="Não foi possível carregar as vagas da rede agora.";
            if($("atual"))$("atual").textContent=msgFalha;
            if($("last-run-home"))$("last-run-home").textContent=msgFalha;
          }
          await autenticarSessaoPessoa({
            userId:u.id,
            email:u.email,
            name:u.user_metadata?.full_name||u.user_metadata?.name||u.email?.split("@")[0],
            provider:"password",
            isSupabase:true
          },true);
          try{estado=await lerEstadoSupabase();gravarUser("progress",estado);render()}catch(e){}
          return;
        }
      }catch(e){sb=null}
    }

    try{await carregarVagas()}catch(e){
      const msgFalha="Não foi possível carregar as vagas da rede agora.";
      if($("atual"))$("atual").textContent=msgFalha;
      if($("last-run-home"))$("last-run-home").textContent=msgFalha;
    }
    mostrarContaGitHub();

    const sessaoAnterior=lerGlobal("radar-active-session",null);
    if(sessaoAnterior&&sessaoAnterior.userId&&location.hash!=="#login"){
      await autenticarSessaoPessoa(sessaoAnterior,true);
    }else{
      // Sem sessão ativa ou hash #login: mostra a Tela de Login como porta de entrada
      activeNamespace="guest";
      carregarPerfilUsuario();
      carregarPostsUsuario();
      atualizarUIAutenticacao();
      render();
      if($("login"))$("login").hidden=false;
    }
    const supaStatus=$("admin-supa-status");
    if(supaStatus&&cfgSupa?.url){
      try{
        const host=new URL(cfgSupa.url).host;
        supaStatus.textContent=`Conexão Supabase ativa (${host})`;
      }catch(e){}
    }
  }

  function mostrarContaGitHub(){
    const ec=$("estado-conta");
    if(ec)ec.textContent=token?`Token de administrador configurado (${REPO}).`:"Nenhum token configurado.";
  }

  // ==================== EVENTOS DA TELA DE LOGIN (FIEL AO ENTRAR.HTML) ====================
  function exibirMsgLogin(texto,tipo="bad"){
    const box=$("login-msg");if(!box)return;
    if(!texto){box.className="auth-msg";box.textContent="";return}
    box.className=`auth-msg ${tipo} show`;
    box.textContent=texto;
  }

  // Alternar abas Entrar / Criar acesso
  function alternarAbaAuth(mode){
    qsa("[data-auth-tab], #tab-signin, #tab-signup").forEach(b=>{
      const tabMode=b.dataset.authTab||(b.id==="tab-signup"?"signup":"signin");
      const on=tabMode===mode;
      b.classList.toggle("active",on);
      b.setAttribute("aria-selected",String(on));
    });
    if($("auth-email-form"))$("auth-email-form").hidden=mode!=="signin";
    if($("form-setup"))$("form-setup").hidden=mode!=="signup";
  }
  qsa("[data-auth-tab]").forEach(tab=>{
    tab.addEventListener("click",()=>{
      alternarAbaAuth(tab.dataset.authTab||(tab.id==="tab-signup"?"signup":"signin"));
      exibirMsgLogin("");
    });
  });

  // Botão Olhinho (.eye) para mostrar/esconder senha + Detecção Caps Lock
  document.addEventListener("click",e=>{
    const eye=e.target.closest("[data-eye]");
    if(eye){
      const input=$(eye.dataset.eye)||eye.parentElement.querySelector("input");
      if(input){
        const mostrar=input.type==="password";
        input.type=mostrar?"text":"password";
        eye.setAttribute("aria-label",mostrar?"Esconder senha":"Mostrar senha");
        input.focus();
      }
    }
  });
  document.addEventListener("keyup",e=>{
    if(e.target&&e.target.id==="auth-pass"&&e.getModifierState){
      $("caps-signin")?.classList.toggle("show",e.getModifierState("CapsLock"));
    }
  });

  // Medidor de força da senha (.meter) e 3 regras (.rules) idênticos ao radar-main/entrar.html
  function validarRegrasSenha(){
    const p=$("setup-pass")?.value||"";
    const u=($("setup-username")?.value||"").trim().toLowerCase();
    const r={
      len:p.length>=8,
      mix:/[a-zA-Z]/.test(p)&&/[^a-zA-Z]/.test(p),
      user:!!p&&(!u||!p.toLowerCase().includes(u.split("@")[0]))
    };
    for(const [k,ok] of Object.entries(r)){
      qs(`[data-rule="${k}"]`)?.classList.toggle("ok",ok);
    }
    const score=(r.len?1:0)+(r.mix?1:0)+(p.length>=12?1:0)+(/[^a-zA-Z0-9]/.test(p)?1:0);
    const m=$("meter");
    if(m){
      m.style.width=`${Math.max(p?14:0,score*25)}%`;
      m.style.background=score<=1?"var(--bad)":score===2?"var(--maybe)":"var(--good)";
    }
    return r.len&&r.mix&&r.user;
  }
  $("form-setup")?.addEventListener("input",validarRegrasSenha);

  // Formulário "Entrar" (#auth-email-form) com controle de bloqueio após 5 tentativas erradas
  $("auth-email-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    exibirMsgLogin("");
    const lockUntil=lerGlobal("radar-login-lock-until",0);
    if(lockUntil>Date.now()){
      const min=Math.ceil((lockUntil-Date.now())/60000);
      exibirMsgLogin(`Muitas tentativas incorretas. Aguarde ${min} min.`,"warn");
      return;
    }

    const rawUser=String($("auth-email")?.value||"").trim().toLowerCase();
    const pass=String($("auth-pass")?.value||"");
    const remember=$("auth-remember")?$("auth-remember").checked:true;
    if(!rawUser||!pass){
      exibirMsgLogin("Preencha seu usuário/e-mail e senha.");
      return;
    }

    if(sb){
      const emailLogin=rawUser.includes("@")?rawUser:`${rawUser}@radar.local`;
      const{data,error}=await sb.auth.signInWithPassword({email:emailLogin,password:pass});
      if(!error&&data?.user){
        await autenticarSessaoPessoa({
          userId:data.user.id,
          email:data.user.email,
          name:data.user.user_metadata?.full_name||rawUser.split("@")[0],
          provider:"password",
          isSupabase:true
        },remember);
        return;
      }
      if(error&&rawUser.includes("@")){
        exibirMsgLogin(error.message||"E-mail ou senha inválidos.","bad");
        return;
      }
    }

    const contas=listarContasLocais();
    const conta=contas[rawUser]||Object.values(contas).find(c=>semAcento(c.username)===semAcento(rawUser)||semAcento(c.email)===semAcento(rawUser));
    const passHash=await sha256Hex(pass);

    if(conta&&conta.passwordHash&&conta.passwordHash!==passHash){
      const falhas=(lerGlobal("radar-login-fails",0)||0)+1;
      gravarGlobal("radar-login-fails",falhas);
      if(falhas>=5){
        gravarGlobal("radar-login-lock-until",Date.now()+5*60000);
        gravarGlobal("radar-login-fails",0);
        exibirMsgLogin("5 tentativas incorretas. Acesso pausado por 5 minutos.","warn");
      }else{
        exibirMsgLogin(`Senha incorreta (${falhas}/5 tentativas).`);
      }
      return;
    }

    gravarGlobal("radar-login-fails",0);
    const ehErick=rawUser==="erick"||rawUser==="engerickgoncalves@gmail.com";
    const userId=conta?.userId||(ehErick?"erick":`user-${slug(rawUser)}`);
    const nomeFinal=conta?.name||(ehErick?"Erick Gonçalves":rawUser.split("@")[0]);
    const contaFinal=registrarContaNoAparelho({
      userId,
      username:rawUser.split("@")[0],
      email:rawUser.includes("@")?rawUser:`${rawUser}@radar.local`,
      name:nomeFinal,
      passwordHash:conta?.passwordHash||passHash,
      provider:"password"
    });
    await autenticarSessaoPessoa(contaFinal,remember);
  });

  // Formulário "Criar acesso" (#form-setup)
  $("form-setup")?.addEventListener("submit",async e=>{
    e.preventDefault();
    exibirMsgLogin("");
    const nome=String($("auth-name")?.value||"").trim();
    const rawUser=String($("setup-username")?.value||"").trim().toLowerCase();
    const pass=String($("setup-pass")?.value||"");
    const confirm=String($("setup-confirm")?.value||"");

    if(!nome||rawUser.length<3){
      exibirMsgLogin("Informe seu nome e um usuário ou e-mail válido.");
      return;
    }
    if(!validarRegrasSenha()){
      exibirMsgLogin("A senha precisa atender às 3 regras indicadas abaixo.");
      return;
    }
    if(pass!==confirm){
      exibirMsgLogin("As duas senhas não coincidem.");
      return;
    }

    const passHash=await sha256Hex(pass);
    const emailSignup=rawUser.includes("@")?rawUser:`${rawUser}@radar.local`;
    const ehErickSignup=rawUser==="erick"||rawUser==="engerickgoncalves@gmail.com";
    let supaUser=null;
    if(sb){
      try{
        const{data,error}=await sb.auth.signUp({
          email:emailSignup,
          password:pass,
          options:{data:{full_name:nome}}
        });
        if(error){
          exibirMsgLogin(error.message||"Não foi possível criar a conta no Supabase.","bad");
          return;
        }
        supaUser=data?.user||null;
      }catch(err){}
    }

    const userId=supaUser?.id||(ehErickSignup?"erick":`user-${slug(rawUser)}`);
    const novaConta=registrarContaNoAparelho({
      userId,
      username:rawUser.split("@")[0],
      email:rawUser.includes("@")?rawUser:"",
      name:nome,
      passwordHash:passHash,
      provider:"password",
      role:ehErickSignup?"admin":"user",
      isSupabase:!!supaUser
    });

    // Cria perfil inicial para a nova pessoa
    const novoPerfil={...PRESET_BLANK_PROFILE,name:nome,contact:rawUser.includes("@")?rawUser:""};
    RadarDynamicDB.put("profiles",userId,novoPerfil);

    await autenticarSessaoPessoa(novaConta,true);
    setView("profile");
  });

  // Botão "Continuar como convidado"
  $("auth-guest-btn")?.addEventListener("click",async()=>{
    await autenticarSessaoPessoa({
      userId:"guest",
      email:"",
      name:"Visitante",
      provider:"guest"
    },false);
  });

  // ==================== EVENTOS GERAIS E DELEGAÇÃO ====================
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

  // Toggle de Filtros e Funil no Celular
  $("btn-toggle-mobile-filters")?.addEventListener("click",()=>{
    const box=$("collapsible-filters-box");
    if(!box)return;
    const aberto=box.classList.toggle("open");
    $("btn-toggle-mobile-filters").setAttribute("aria-expanded",String(aberto));
  });

  document.addEventListener("click",e=>{
    const viewBtn=e.target.closest("[data-view]");
    if(viewBtn){
      e.preventDefault();
      if(e.target.closest("#modal-backdrop"))closeModal();
      setView(viewBtn.dataset.view);
      return;
    }
    const openJob=e.target.closest("[data-open-job]");
    if(openJob){
      f.status="todas";salvarFiltros();
      selectedJobId=openJob.dataset.openJob;
      setView("jobs");render();
      if(isMobileViewport())desenharDetalheVaga(true);
      return;
    }
    const openErr=e.target.closest("[data-open-err]");
    if(openErr){
      f.status="erros";salvarFiltros();
      selectedErrId=openErr.dataset.openErr;
      setView("jobs");render();
      if(isMobileViewport())desenharDetalheErro(true);
      return;
    }
    const openPost=e.target.closest("[data-open-post]");
    if(openPost){
      selectedPostId=openPost.dataset.openPost;
      setView("content");desenharPublicacoes(isMobileViewport());
      return;
    }
    const postCard=e.target.closest("[data-post-id]");
    if(postCard){
      selectedPostId=postCard.dataset.postId;
      desenharPublicacoes(isMobileViewport());
      return;
    }
    const postSt=e.target.closest("[data-post-st]");
    if(postSt){
      postFilter=postSt.dataset.postSt;
      desenharPublicacoes(false);
      return;
    }
  });

  $("overview-open-errors")?.addEventListener("click",()=>{
    f.status="erros";salvarFiltros();setView("jobs");render();
  });

  $("btn-open-manual")?.addEventListener("click",abrirModalManualUso);
  for(const id of ["btn-invite-sidebar","btn-invite-top","btn-invite-card"]){
    $(id)?.addEventListener("click",abrirModalConvidarAmigos);
  }

  $("btn-clear-busca")?.addEventListener("click",()=>{
    busca="";
    if($("busca")){$("busca").value="";$("busca").focus()}
    render();
  });
  $("qf-score80")?.addEventListener("click",()=>{
    f.score=f.score==="80"?"0":"80";
    salvarFiltros();render();
  });
  $("qf-remoto")?.addEventListener("click",()=>{
    f.mod=f.mod==="Remoto"?"":"Remoto";
    salvarFiltros();render();
  });
  $("qf-salvas")?.addEventListener("click",()=>{
    f.status=f.status==="salvas"?"todas":"salvas";
    salvarFiltros();render();
  });
  $("qf-novas")?.addEventListener("click",()=>{
    f.status=f.status==="novas"?"todas":"novas";
    salvarFiltros();render();
  });

  $("modal-close")?.addEventListener("click",closeModal);
  $("modal-backdrop")?.addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal()});

  // Navegação por Teclado
  document.addEventListener("keydown",e=>{
    const backdrop=$("modal-backdrop");
    const modalOpen=backdrop&&!backdrop.classList.contains("hidden");
    const loginOpen=$("login")&&!$("login").hidden;
    const isTyping=!!e.target.closest?.("input,textarea,select,[contenteditable='true']");

    if(e.key==="Escape"){
      if(modalOpen){closeModal();return}
      if(document.activeElement===$("busca")){
        if(busca){busca="";$("busca").value="";render()}
        else $("busca").blur();
        return;
      }
    }
    if(e.key==="Tab"&&modalOpen){
      const focusables=[...backdrop.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
      if(focusables.length){
        const first=focusables[0],last=focusables[focusables.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();return}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();return}
      }
    }

    if(!modalOpen&&!loginOpen&&!isTyping){
      if(e.key==="/"){
        e.preventDefault();
        if(activeView!=="jobs")setView("jobs");
        $("busca")?.focus();
        $("busca")?.select();
        return;
      }
      if(activeView==="jobs"&&(e.key==="s"||e.key==="S")&&f.status!=="erros"&&selectedJobId){
        const saveBtn=qs(`#lista article.vaga[data-id="${CSS.escape(selectedJobId)}"] .save-btn`);
        if(saveBtn){e.preventDefault();saveBtn.click()}
        return;
      }
      if(activeView==="jobs"&&(e.key==="j"||e.key==="J"||e.key==="k"||e.key==="K")){
        const items=[...qsa("#lista .job-item")];
        if(items.length){
          e.preventDefault();
          const curIdx=items.findIndex(x=>x.dataset.id===selectedJobId||x.dataset.id===selectedErrId);
          const dir=(e.key==="j"||e.key==="J")?1:-1;
          const nextIdx=curIdx<0?0:Math.max(0,Math.min(items.length-1,curIdx+dir));
          const next=items[nextIdx];
          if(next){
            if(f.status==="erros"){selectedErrId=next.dataset.id;desenharDetalheErro(false)}
            else{selectedJobId=next.dataset.id;selecionarVaga(next.dataset.id,false)}
            next.focus();
          }
        }
        return;
      }
    }

    const item=e.target.closest?.(".job-item");
    if(!item)return;
    const listEl=item.closest(".job-list");
    if((e.key==="ArrowDown"||e.key==="ArrowUp"||e.key==="j"||e.key==="J"||e.key==="k"||e.key==="K")&&listEl&&!isTyping){
      e.preventDefault();
      const items=[...listEl.querySelectorAll(".job-item")];
      const idx=items.indexOf(item);
      if(idx<0)return;
      const dir=(e.key==="ArrowDown"||e.key==="j"||e.key==="J")?1:-1;
      const next=items[Math.max(0,Math.min(items.length-1,idx+dir))];
      if(next&&next!==item){
        const nextId=next.dataset.id||next.dataset.postId;
        if(next.dataset.id){selectedJobId=nextId;desenharDetalheVaga(false)}
        else if(next.dataset.postId){selectedPostId=nextId;desenharPublicacoes(false)}
        next.focus();
      }
      return;
    }
    if(e.key==="Enter"||e.key===" "){
      if(e.target.closest("a[href],button,input,select,textarea"))return;
      e.preventDefault();
      item.click();
      if(!isMobileViewport()){
        const split=item.closest(".split");
        const detail=split?.querySelector(".detail-col");
        if(detail){
          const firstAction=detail.querySelector("a.button, button.button, button, a[href]");
          (firstAction||detail).focus();
        }
      }
    }
  });

  // Filtros de Vagas
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
    showToast(`Vaga "${titulo}" salva na sua base dinâmica!`);
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
    gravarUser("error_queue",filaErrosLocal);
    e.target.reset();
    e.target.hidden=true;
    selectedErrId=novoErro.id;
    render();
    showToast("Item salvo na fila de erros do Vagas.com.br.");
  });

  // Prova de Cobertura (#conf-bt)
  $("conf-bt")?.addEventListener("click",async()=>{
    const S=$("conf-saida"),linhas=$("conf-texto").value.split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,60);
    S.textContent="";
    if(!linhas.length){S.append(el("p","conf-resumo","Cole pelo menos um link ou um cargo com a empresa."));return}
    let cat;
    try{cat=await carregarCatalogo()}catch(e){cat=[];S.append(el("p","muted small","Comparando diretamente com as vagas ativas do painel."))}
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

  // Botão "Atualizar e recalcular vagas" (#atualizar) — NUNCA exige Token do GitHub!
  $("atualizar")?.addEventListener("click",async()=>{
    const b=$("atualizar"),m=$("msg-atual");
    if(!b||!m)return;
    b.disabled=true;
    m.hidden=false;
    m.textContent="Buscando vagas mais recentes e recalculando para o seu currículo…";
    try{
      if(token){
        try{
          await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/coletar.yml/dispatches`,{
            method:"POST",
            headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},
            body:JSON.stringify({ref:"main"})
          });
        }catch(e){}
      }
      catalogo=null;
      let res=null;
      try{
        res=await carregarVagas();
      }catch(errCarga){
        console.error("[Radar] Falha em carregarVagas:",errCarga);
        m.textContent="Não foi possível recarregar agora e não há cache local disponível. Tente novamente em instantes.";
        return;
      }
      render();
      if(res&&res.usouCache){
        m.textContent=`Falha de rede ao buscar novas vagas; recálculo executado com dados do cache local (${visiveis().length} vagas avaliadas).`;
        showToast("Recálculo concluído usando cache local.");
      }else{
        m.textContent=`Painel atualizado e recalculado para o perfil de ${profile?.name||"você"} (${visiveis().length} vagas avaliadas).`;
        showToast("Vagas atualizadas e recalculadas para o seu perfil!");
      }
    }catch(e){
      console.error("[Radar] Erro ao recalcular painel:",e);
      m.textContent=`Erro ao recalcular painel: ${e?.message||"tente novamente."}`;
    }finally{
      b.disabled=false;
    }
  });

  // Eventos de Publicações
  $("new-story-btn")?.addEventListener("click",()=>{const fm=$("story-form");if(fm)fm.hidden=!fm.hidden});
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
    desenharPublicacoes(false);
    desenharVisaoGeral(visiveis());
    showToast("Fato salvo e rascunho de publicação gerado!");
  });
  $("plan-posts")?.addEventListener("click",gerarNovaPautaDoPerfil);

  // Eventos de Meu Perfil
  $("profile-form")?.addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const camposDoForm={};
    for(const k of CAMPOS_TEXTO_PERFIL){
      if(!e.target.elements[k])continue;
      if(k==="maxDays")camposDoForm[k]=Number(fd.get(k)||14);
      else if(k==="name")camposDoForm[k]=String(fd.get(k)||"Usuário").trim()||"Usuário";
      else if(k==="city")camposDoForm[k]=String(fd.get(k)||"Salvador, BA").trim()||"Salvador, BA";
      else camposDoForm[k]=String(fd.get(k)||"").trim();
    }
    camposDoForm.acceptRemote=fd.get("acceptRemote")==="on";
    camposDoForm.acceptHybrid=fd.get("acceptHybrid")==="on";
    camposDoForm.acceptOnsite=fd.get("acceptOnsite")==="on";
    profile={...profile,...camposDoForm};
    gravarUser("profiles",profile);
    if(sb&&usuario&&usuario.isSupabase){
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
      $("profile-saved").textContent="Salvo na sua base dinâmica! Scores e requisitos recalculados.";
      setTimeout(()=>{if($("profile-saved"))$("profile-saved").textContent=""},4000);
    }
    showToast(`Perfil de ${profile.name} salvo e vagas recalculadas!`);
  });

  $("btn-preset-erick")?.addEventListener("click",()=>{
    profile=ehContaDoErick()?{...PRESET_DEFAULT_PROFILE}:{
      ...PRESET_BLANK_PROFILE,
      name:"Profissional de Engenharia",
      headline:"Planejamento, Projetos e Manutenção",
      roles:"Planejamento e controle, Gestão de projetos, Manutenção, Engenharia elétrica",
      skills:"MS Project, Power BI, SAP, Excel avançado, Orçamento e custos, PCM / Manutenção",
      summary:"Experiência em planejamento e controle de obras, cronogramas físico-financeiros, indicadores em Power BI e gestão de manutenção."
    };
    gravarUser("profiles",profile);
    preencherFormularioPerfil();
    sincronizarCabecalhoPerfil();
    render();
    showToast("Exemplo de currículo preenchido.");
  });

  $("btn-preset-blank")?.addEventListener("click",()=>{
    profile={...PRESET_BLANK_PROFILE};
    preencherFormularioPerfil();
    sincronizarCabecalhoPerfil();
    render();
    qs('#profile-form input[name="name"]')?.focus();
    showToast("Campos prontos para personalizar seu perfil!");
  });

  // Eventos de Configurações
  $("form-token")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const t=$("token").value.trim();if(!t)return;
    token=t;
    gravarGlobal("token",t);
    $("token").value="";
    mostrarContaGitHub();
    showToast("Token de administrador salvo.");
  });
  $("tirar-token")?.addEventListener("click",()=>{
    token="";gravarGlobal("token","");mostrarContaGitHub();showToast("Token removido.");
  });

  $("btn-refresh-admin-users")?.addEventListener("click",()=>{
    carregarUsuariosAdmin();
    showToast("Lista de usuários atualizada.");
  });

  $("btn-export-data")?.addEventListener("click",()=>{
    const payload={
      exportedAt:new Date().toISOString(),
      user:usuario,
      profile,
      estado,
      vagasManuais,
      filaErrosLocal,
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
      if(data.profile){profile=data.profile;gravarUser("profiles",profile)}
      if(data.estado){estado=data.estado;gravarUser("progress",estado)}
      if(Array.isArray(data.vagasManuais)){vagasManuais=data.vagasManuais;gravarUser("vagas-manuais",vagasManuais)}
      if(Array.isArray(data.posts)){posts=data.posts;gravarUser("posts",posts)}
      if(Array.isArray(data.stories)){stories=data.stories;gravarUser("stories",stories)}
      preencherFormularioPerfil();
      sincronizarCabecalhoPerfil();
      desenharPublicacoes(false);
      render();
      showToast("Backup importado com sucesso para sua base dinâmica!");
    }catch(err){
      showToast("Arquivo JSON inválido.");
    }
  });

  function abrirTelaLogin(){
    if($("login")){
      $("login").hidden=false;
      $("auth-email")?.focus();
    }
  }
  $("btn-switch-user")?.addEventListener("click",abrirTelaLogin);
  $("btn-open-auth-settings")?.addEventListener("click",abrirTelaLogin);
  $("btn-mobile-logout")?.addEventListener("click",abrirTelaLogin);

  $("sair")?.addEventListener("click",async()=>{
    if(sb){try{await sb.auth.signOut()}catch(e){}}
    gravarGlobal("radar-active-session",null);
    usuario=null;
    activeNamespace="guest";
    abrirTelaLogin();
    atualizarUIAutenticacao();
    showToast("Sessão encerrada. Entre com outra conta quando quiser.");
  });

  // Inicialização
  inicializarSessaoEPainel();
})();
