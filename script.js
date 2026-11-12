(function(){
  "use strict";
  const SB_URL="https://cbgmhibxavuhnbwptwfm.supabase.co";
  const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiZ21oaWJ4YXZ1aG5id3B0d2ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0OTY4MjUsImV4cCI6MjExMDA3MjgyNX0.-d8iWlfkbkXxPdpP-DSrV5oozVhuCp0tKPlA1bgq0OA";
  const RECIP="carloshenrique@nassau.com.br";
  const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const ST={venc:"Vencido",ren:"Renovar",at:"Até 90 dias",ok:"Válido",sem:"Sem certificado"};
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const pad=n=>String(n).padStart(2,"0");
  const todayISO=()=>{const d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
  const dbr=s=>{if(!s)return "—";const[y,m,d]=String(s).slice(0,10).split("-");return d+"/"+m+"/"+y};
  const utc=s=>{const[y,m,d]=String(s).slice(0,10).split("-").map(Number);return Date.UTC(y,m-1,d)};
  const diasAte=s=>s?Math.round((utc(s)-utc(todayISO()))/864e5):null;
  const addYears=(iso,n)=>{const[y,m,d]=iso.split("-").map(Number);return new Date(Date.UTC(y+n,m-1,d)).toISOString().slice(0,10)};

  /* ---------- sessão e API (Supabase REST) ---------- */
  let sess=null;
  try{sess=JSON.parse(localStorage.getItem("cert-sessao")||"null")}catch(e){}
  const saveSess=s=>{sess=s;try{s?localStorage.setItem("cert-sessao",JSON.stringify(s)):localStorage.removeItem("cert-sessao")}catch(e){}};
  async function authReq(path,body,token){
    const r=await fetch(SB_URL+"/auth/v1/"+path,{method:"POST",headers:{"apikey":SB_KEY,"Content-Type":"application/json",...(token?{"Authorization":"Bearer "+token}:{})},body:JSON.stringify(body||{})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(new Error(j.error_description||j.msg||j.message||"Falha na autenticação"),{status:r.status,code:j.error_code||j.code});
    return j;
  }
  const fromToken=j=>({access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Math.floor(Date.now()/1000)+(j.expires_in||3600),email:(j.user&&j.user.email)||(sess&&sess.email)||""});
  async function token(){
    if(!sess)return null;
    if(sess.expires_at-60>Date.now()/1000)return sess.access_token;
    try{saveSess(fromToken(await authReq("token?grant_type=refresh_token",{refresh_token:sess.refresh_token})));return sess.access_token}
    catch(e){saveSess(null);return null}
  }
  async function api(path,{method="GET",body,prefer}={}){
    const t=await token();
    const r=await fetch(SB_URL+"/rest/v1/"+path,{method,headers:{"apikey":SB_KEY,"Authorization":"Bearer "+(t||SB_KEY),"Content-Type":"application/json",...(prefer?{"Prefer":prefer}:{})},body:body!==undefined?JSON.stringify(body):undefined});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw Object.assign(new Error(j.message||("Erro "+r.status)),{status:r.status})}
    if(r.status===204)return null;
    const tx=await r.text();return tx?JSON.parse(tx):null;
  }

  /* ---------- CNPJ (inclusive alfanumérico) e CPF ---------- */
  const limpa=s=>String(s||"").toUpperCase().replace(/[^0-9A-Z]/g,"");
  function dvCNPJ(s){s=limpa(s);if(!/^[0-9A-Z]{12}\d{2}$/.test(s)||/^(\d)\1{13}$/.test(s))return false;
    const v=c=>c.charCodeAt(0)-48;
    const calc=n=>{const w=n===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];let t=0;for(let i=0;i<n;i++)t+=v(s[i])*w[i];const r=t%11;return r<2?0:11-r};
    return calc(12)===+s[12]&&calc(13)===+s[13]}
  function dvCPF(s){s=String(s||"").replace(/\D/g,"");if(s.length!==11||/^(\d)\1{10}$/.test(s))return false;
    let t=0;for(let i=0;i<9;i++)t+=+s[i]*(10-i);let d=(t*10)%11%10;if(d!==+s[9])return false;
    t=0;for(let i=0;i<10;i++)t+=+s[i]*(11-i);d=(t*10)%11%10;return d===+s[10]}
  function fmtDoc(s){const c=limpa(s);
    if(c.length===14)return c.slice(0,2)+"."+c.slice(2,5)+"."+c.slice(5,8)+"/"+c.slice(8,12)+"-"+c.slice(12);
    if(/^\d{11}$/.test(c))return c.slice(0,3)+"."+c.slice(3,6)+"."+c.slice(6,9)+"-"+c.slice(9);
    return String(s||"").trim()}
  function docStatus(s){const c=limpa(s);if(!c)return null;if(c.length===14)return dvCNPJ(c)?"cnpj":"cnpj-bad";if(c.length===11&&/^\d+$/.test(c))return dvCPF(c)?"cpf":"cpf-bad";return "incompleto"}

  /* ---------- estado ---------- */
  let isAdmin=false,estado="loading",certs=[],pedidos=[];
  const f={tab:"nassau",st:"",mes:"",q:"",mun:"",resp:"",sort:"validade",ped:"pendente"};
  try{const s=JSON.parse(localStorage.getItem("cert-filtro")||"{}");if(s.sort)f.sort=s.sort;if(s.tab)f.tab=s.tab}catch(e){}
  const remember=()=>{try{localStorage.setItem("cert-filtro",JSON.stringify({sort:f.sort,tab:f.tab}))}catch(e){}};
  let editId=null,renewId=null,fromPedido=null;

  const lista=()=>certs.filter(c=>c.grupo===(f.tab==="pessoal"?"pessoal":"nassau"));
  function situ(c){if(!c.tem_cert||!c.validade)return "sem";const d=diasAte(c.validade);if(d<0)return "venc";if(d<=30)return "ren";if(d<=90)return "at";return "ok"}
  function diasTxt(c){if(!c.tem_cert||!c.validade)return "";const d=diasAte(c.validade);
    if(d<0)return "venceu há "+(-d)+(d===-1?" dia":" dias");if(d===0)return "vence hoje";if(d===1)return "vence amanhã";return "faltam "+d+" dias"}
  const toast=m=>{const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2800)};
  async function copiar(txt,el){try{await navigator.clipboard.writeText(txt);toast("Copiado")}catch(e){if(el){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}toast("Selecione o texto e copie")}}
  const mailto=(subj,body)=>"mailto:"+RECIP+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(body);

  /* ---------- carregar ---------- */
  async function carregar(){
    try{
      const [cs,adm]=await Promise.all([api("certificados?select=*&order=validade.asc.nullslast"),sess?api("rpc/is_admin",{method:"POST",body:{}}).catch(()=>false):Promise.resolve(false)]);
      certs=cs||[];isAdmin=!!adm;estado="ok";
      if(isAdmin){pedidos=await api("pedidos?select=*&order=criado_em.desc").catch(()=>[])||[]}else{pedidos=[];if(f.tab!=="nassau")f.tab="nassau"}
    }catch(e){if(estado!=="ok")estado="erro"}
    render();
  }

  /* ---------- abas ---------- */
  function renderTabs(){
    $("tabs").hidden=!isAdmin;
    if(!isAdmin)return;
    const pend=pedidos.filter(p=>p.status==="pendente").length;
    const n=g=>certs.filter(c=>c.grupo===g).length;
    $("tabs").innerHTML=[["nassau","Nassau",n("nassau")],["pessoal","Pessoal",n("pessoal")],["pedidos","Solicitações",pend]]
      .map(([v,l,c])=>'<button data-v="'+v+'" aria-pressed="'+(f.tab===v)+'">'+l+'<span class="n'+(v==="pedidos"&&c?" hot":"")+'">'+c+'</span></button>').join("");
  }

  /* ---------- resumo ---------- */
  function renderStats(){
    const L=lista(),cnt={venc:0,ren:0,at:0,ok:0,sem:0};L.forEach(c=>cnt[situ(c)]++);
    const cards=[["","Total",L.length,"certificados nesta planilha","--accent"],["venc","Vencidos",cnt.venc,"precisam de nova emissão","--s-venc"],["ren","Renovar",cnt.ren,"vencem em até 30 dias","--s-ren"],["at","Até 90 dias",cnt.at,"de 31 a 90 dias","--s-at"],["ok","Válidos",cnt.ok,"mais de 90 dias","--s-ok"],["sem","Sem certificado",cnt.sem,"ainda não emitido","--s-sem"]];
    $("stats").innerHTML=cards.map(([k,l,v,h,c])=>'<button type="button" class="stat" data-st="'+k+'" aria-pressed="'+(f.st===k&&(k!==""||!f.mes))+'" style="--sc:var('+c+')"><span class="k"><i></i>'+l+'</span><span class="v">'+v+'</span><span class="h">'+h+'</span></button>').join("");
  }

  /* ---------- alerta (só da aba aberta) ---------- */
  function alertItems(){return lista().map(c=>({c,s:situ(c),d:diasAte(c.validade)})).filter(i=>i.s==="venc"||i.s==="ren").sort((a,b)=>a.d-b.d)}
  function avisoTexto(items){return "Certificados digitais com vencimento em até 30 dias ("+dbr(todayISO())+"):\n\n"+items.map(it=>"- "+it.c.empresa+" | "+(it.c.doc||"sem documento")+" | vence "+dbr(it.c.validade)+" ("+diasTxt(it.c)+")").join("\n")}
  function renderAlerts(){
    const items=alertItems();
    $("alerts").hidden=!items.length;
    if(!items.length)return;
    const v=items.filter(i=>i.s==="venc").length,r=items.length-v;
    $("alTitle").textContent=[r?(r===1?"1 certificado vence em até 30 dias":r+" certificados vencem em até 30 dias"):"",v?(v===1?"1 vencido":v+" vencidos"):""].filter(Boolean).join(" · ");
    $("mailbox").hidden=!isAdmin;
    $("addrAl").textContent=RECIP;
    $("mailAviso").href=mailto("Certificados digitais a vencer — "+dbr(todayISO()),avisoTexto(items));
    $("alist").innerHTML=items.map(it=>'<div class="al"><span class="pill st-'+it.s+'">'+ST[it.s]+'</span><span class="t"><b>'+esc(it.c.empresa)+'</b><small>'+esc(it.c.doc||"sem documento")+' · '+dbr(it.c.validade)+' · '+diasTxt(it.c)+'</small></span>'
      +(isAdmin?'<span class="acts"><button class="btn small" data-renew="'+esc(it.c.id)+'">Renovei</button></span>':'<span></span>')+'</div>').join("");
  }

  /* ---------- régua por mês ---------- */
  function renderRuler(){
    const L=lista().filter(c=>c.tem_cert&&c.validade);
    const t=new Date(),y0=t.getFullYear(),m0=t.getMonth();
    const buckets=[{k:"venc",lb:"vencidos",n:L.filter(c=>diasAte(c.validade)<0).length,cls:"past"}];
    for(let i=0;i<12;i++){const d=new Date(y0,m0+i,1),ym=d.getFullYear()+"-"+pad(d.getMonth()+1);
      const inM=L.filter(c=>c.validade.slice(0,7)===ym&&diasAte(c.validade)>=0);
      buckets.push({k:ym,lb:MES[d.getMonth()]+"/"+String(d.getFullYear()).slice(2),n:inM.length,cls:inM.some(c=>diasAte(c.validade)<=30)?"soon":""})}
    const lim=new Date(y0,m0+12,1),later=L.filter(c=>utc(c.validade)>=Date.UTC(lim.getFullYear(),lim.getMonth(),1)).length;
    const max=Math.max(1,...buckets.map(b=>b.n));
    $("ruler").innerHTML=buckets.map(b=>'<button type="button" class="mo '+b.cls+(b.n?'':' zero')+'" data-mes="'+b.k+'" aria-pressed="'+(f.mes===b.k)+'" '+(b.n?'':'disabled')+' aria-label="'+b.lb+': '+b.n+'"><span class="col"><i style="--h:'+(b.n?Math.max(6,b.n/max*84):0)+'px">'+(b.n?'<span>'+b.n+'</span>':'')+'</i></span><span class="lb">'+b.lb+'</span></button>').join("");
    $("rulerInfo").textContent=(f.mes?"Mostrando só um mês. Toque de novo para ver todos.":"Toque num mês para ver só os certificados que vencem nele.")+(later?" · "+later+" vencem depois de 12 meses.":"");
  }

  /* ---------- filtros e tabela ---------- */
  function opts(sel,vals,cur){$(sel).innerHTML='<option value="">Todos</option>'+vals.map(v=>'<option'+(v===cur?' selected':'')+'>'+esc(v)+'</option>').join("")}
  function renderFilters(){
    const L=lista(),srt=a=>[...new Set(a.filter(Boolean))].sort((x,y)=>x.localeCompare(y,"pt-BR"));
    const muns=srt(L.map(c=>c.municipio)),resps=srt(L.map(c=>c.resp));
    if(f.mun&&!muns.includes(f.mun))f.mun="";if(f.resp&&!resps.includes(f.resp))f.resp="";
    opts("fmun",muns,f.mun);opts("fresp",resps,f.resp);$("fsort").value=f.sort;
    $("dl-mun").innerHTML=srt(certs.map(c=>c.municipio)).map(v=>'<option value="'+esc(v)+'">').join("");
    $("dl-resp").innerHTML=srt(certs.map(c=>c.resp)).map(v=>'<option value="'+esc(v)+'">').join("");
    $("limpar").hidden=!(f.q||f.mun||f.resp||f.st||f.mes);
  }
  function filtered(){
    const q=norm(f.q),qd=limpa(f.q);
    const L=lista().filter(c=>{
      if(f.st&&situ(c)!==f.st)return false;
      if(f.mes){if(!c.tem_cert||!c.validade)return false;if(f.mes==="venc"){if(diasAte(c.validade)>=0)return false}else if(c.validade.slice(0,7)!==f.mes||diasAte(c.validade)<0)return false}
      if(f.mun&&c.municipio!==f.mun)return false;
      if(f.resp&&c.resp!==f.resp)return false;
      if(q){const hay=norm([c.empresa,c.municipio,c.doc,c.resp,c.obs,c.tipo].join(" "));if(!hay.includes(q)&&!(qd.length>=3&&limpa(c.doc).includes(qd)))return false}
      return true});
    const cmpS=(a,b)=>String(a).localeCompare(String(b),"pt-BR",{sensitivity:"base"});
    return L.sort((a,b)=>{
      if(f.sort==="empresa")return cmpS(a.empresa,b.empresa);
      if(f.sort==="municipio")return cmpS(a.municipio||"~",b.municipio||"~")||cmpS(a.empresa,b.empresa);
      const va=a.tem_cert&&a.validade?a.validade:"9999",vb=b.tem_cert&&b.validade?b.validade:"9999";return va.localeCompare(vb)||cmpS(a.empresa,b.empresa)});
  }
  function renderList(){
    const all=lista(),L=filtered();
    if(estado==="loading"){$("lista").innerHTML='<div class="empty"><b>Carregando certificados…</b></div>';$("fsum").textContent="";return}
    if(estado==="erro"){$("lista").innerHTML='<div class="empty"><b>Não foi possível carregar a lista</b><span>Confira a conexão com a internet e tente de novo.</span><button class="btn" data-act="recarregar">Tentar de novo</button></div>';$("fsum").textContent="";return}
    if(!all.length){$("lista").innerHTML='<div class="empty"><b>Nenhum certificado cadastrado'+(f.tab==="pessoal"?" na planilha pessoal":"")+'</b>'+(isAdmin?'<button class="btn" data-act="novo">+ Certificado</button>':'')+'</div>';$("fsum").textContent="";return}
    $("fsum").textContent=L.length===all.length?all.length+" certificados":L.length+" de "+all.length+" certificados";
    if(!L.length){$("lista").innerHTML='<div class="empty"><b>Nada com esses filtros</b><button class="btn ghost" data-act="limpar">Limpar filtros</button></div>';return}
    const docCount={};all.forEach(c=>{const k=limpa(c.doc);if(k)docCount[k]=(docCount[k]||0)+1});
    $("lista").innerHTML='<div class="tbl"><table><thead><tr><th>Empresa / titular</th><th>CNPJ / CPF</th><th>Município</th><th>Validade</th><th>Situação</th><th>Resp. legal</th>'+(isAdmin?'<th></th>':'')+'</tr></thead><tbody>'
      +L.map(c=>{const s=situ(c),ds=docStatus(c.doc),k=limpa(c.doc);
        const flag=(ds==="cnpj-bad"||ds==="cpf-bad")?'<span class="bad" title="Os dígitos verificadores não conferem">DV inválido</span>':(k&&docCount[k]>1?'<span class="bad" title="Este documento aparece mais de uma vez nesta planilha">duplicado</span>':'');
        return '<tr class="'+(s==="sem"?"dim":"")+'"><td class="emp"><b>'+esc(c.empresa)+'</b>'+(c.tipo||c.obs?'<small>'+esc([c.tipo,c.obs].filter(Boolean).join(" · "))+'</small>':'')+'</td>'
        +'<td class="m">'+(c.doc?esc(c.doc):'<span style="color:var(--muted)">não informado</span>')+flag+'</td>'
        +'<td class="mun">'+esc(c.municipio||"—")+'</td>'
        +'<td class="d">'+(c.tem_cert&&c.validade?dbr(c.validade)+'<small>'+diasTxt(c)+'</small>':'—')+'</td>'
        +'<td><span class="pill st-'+s+'">'+ST[s]+'</span></td>'
        +'<td class="resp">'+esc(c.resp||"—")+'</td>'
        +(isAdmin?'<td class="acts"><button class="btn small" data-renew="'+esc(c.id)+'">Renovar</button><button class="btn ghost small" data-edit="'+esc(c.id)+'">Editar</button><button class="btn ghost small" data-del="'+esc(c.id)+'">Excluir</button></td>':'')+'</tr>'}).join("")
      +'</tbody></table></div>';
  }

  /* ---------- solicitações (admin) ---------- */
  const existente=cnpj=>{const k=limpa(cnpj);if(k.length<14)return null;return certs.find(c=>limpa(c.doc)===k)||null};
  const stPed=s=>({pendente:"Pendente",atendido:"Atendida",recusado:"Recusada"}[s]||s);
  const clsPed=s=>s==="pendente"?"st-ren":s==="atendido"?"st-ok":"st-sem";
  function renderPedidos(){
    const counts={pendente:0,atendido:0,recusado:0};pedidos.forEach(p=>counts[p.status]=(counts[p.status]||0)+1);
    $("fped").innerHTML=[["pendente","Pendentes"],["atendido","Atendidas"],["recusado","Recusadas"],["","Todas"]].map(([v,l])=>'<button data-v="'+v+'" aria-pressed="'+(f.ped===v)+'">'+l+'<span class="n">'+(v?counts[v]||0:pedidos.length)+'</span></button>').join("");
    const L=pedidos.filter(p=>!f.ped||p.status===f.ped);
    if(!L.length){$("reqs").innerHTML='<div class="empty"><b>'+(f.ped==="pendente"?"Nenhuma solicitação pendente":"Nada por aqui")+'</b><span>Pedidos feitos pelo botão <b>Solicitar certificado</b> aparecem aqui.</span></div>';return}
    $("reqs").innerHTML=L.map(p=>{const ex=existente(p.cnpj),dt=p.criado_em?new Date(p.criado_em):null;
      return '<div class="req'+(p.status!=="pendente"?" done":"")+'"><div class="rt"><b>'+esc(p.empresa)+'</b><div class="m">'+esc(p.cnpj)+'</div></div>'
      +'<span class="pill '+clsPed(p.status)+'">'+stPed(p.status)+'</span>'
      +'<div class="meta" style="grid-column:1/-1">'+esc([p.nome,p.contato].filter(Boolean).join(" · ")||"Solicitante não informou nome")+(dt?' · pedido em '+dt.toLocaleDateString("pt-BR")+' às '+dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):'')+(p.obs?'<br>'+esc(p.obs):'')+'</div>'
      +(ex&&p.status==="pendente"?'<div class="exists">Já existe na lista: '+esc(ex.empresa)+(ex.tem_cert&&ex.validade?', válido até '+dbr(ex.validade):', sem certificado')+'.</div>':'')
      +'<div class="acts">'+(p.status==="pendente"?'<button class="btn small" data-p="cad" data-id="'+esc(p.id)+'">Cadastrar certificado</button><button class="btn ghost small" data-p="atendido" data-id="'+esc(p.id)+'">Marcar atendida</button><button class="btn ghost small" data-p="recusado" data-id="'+esc(p.id)+'">Recusar</button>':'<button class="btn ghost small" data-p="pendente" data-id="'+esc(p.id)+'">Reabrir</button>')
      +'<button class="btn ghost small" data-p="del" data-id="'+esc(p.id)+'">Excluir</button></div></div>'}).join("");
  }

  function render(){
    renderTabs();
    const ped=f.tab==="pedidos"&&isAdmin;
    $("vLista").hidden=ped;$("vPedidos").hidden=!ped;
    $("novoCert").hidden=!isAdmin;$("ownerBadge").hidden=!isAdmin;
    $("entrar").hidden=!!sess;$("sair").hidden=!sess;
    $("sub").innerHTML=isAdmin?'Validade dos certificados e-CNPJ e e-CPF (ICP-Brasil). Situação <b>Renovar</b> a partir de 30 dias do vencimento. Só você altera; quem tem o link vê a planilha Nassau e pode pedir certificados novos.':'Validade dos certificados e-CNPJ e e-CPF (ICP-Brasil). Precisa de um certificado para outra empresa? Use <b>Solicitar certificado</b>.';
    if(ped){renderPedidos();return}
    renderStats();renderAlerts();renderRuler();renderFilters();renderList();
  }

  /* ---------- eventos ---------- */
  $("tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-v]");if(!b)return;f.tab=b.dataset.v;f.st="";f.mes="";remember();render()});
  $("stats").addEventListener("click",e=>{const b=e.target.closest("[data-st]");if(!b)return;const k=b.dataset.st;f.st=(f.st===k)?"":k;f.mes="";render()});
  $("ruler").addEventListener("click",e=>{const b=e.target.closest("[data-mes]");if(!b||b.disabled)return;f.mes=f.mes===b.dataset.mes?"":b.dataset.mes;f.st="";render()});
  $("busca").addEventListener("input",e=>{f.q=e.target.value;renderList();$("limpar").hidden=!(f.q||f.mun||f.resp||f.st||f.mes)});
  $("fmun").addEventListener("change",e=>{f.mun=e.target.value;render()});
  $("fresp").addEventListener("change",e=>{f.resp=e.target.value;render()});
  $("fsort").addEventListener("change",e=>{f.sort=e.target.value;remember();renderList()});
  function limparFiltros(){f.q="";f.mun="";f.resp="";f.st="";f.mes="";$("busca").value="";render()}
  $("limpar").addEventListener("click",limparFiltros);
  $("fped").addEventListener("click",e=>{const b=e.target.closest("button[data-v]");if(!b)return;f.ped=b.dataset.v;renderPedidos()});
  $("copiarAviso").addEventListener("click",()=>copiar(avisoTexto(alertItems())));

  let armed=null;
  function arm(btn){if(armed===btn)return true;if(armed){armed.textContent="Excluir";armed.classList.remove("danger")}armed=btn;btn.textContent="Confirmar exclusão";btn.classList.add("danger");setTimeout(()=>{if(armed===btn){btn.textContent="Excluir";btn.classList.remove("danger");armed=null}},4000);return false}
  document.addEventListener("click",async e=>{
    const a=e.target.closest("[data-act]");
    if(a){const k=a.dataset.act;if(k==="novo")openCert(null);if(k==="limpar")limparFiltros();if(k==="recarregar"){estado="loading";render();carregar()}return}
    const r=e.target.closest("[data-renew]");if(r){openRenew(r.dataset.renew);return}
    const ed=e.target.closest("[data-edit]");if(ed){openCert(certs.find(c=>c.id===ed.dataset.edit));return}
    const del=e.target.closest("[data-del]");
    if(del){if(!arm(del))return;armed=null;del.disabled=true;
      try{await api("certificados?id=eq."+del.dataset.del,{method:"DELETE"});toast("Certificado excluído");await carregar()}catch(err){del.disabled=false;toast("Não foi possível excluir. Tente de novo.")}
      return}
    const p=e.target.closest("[data-p]");if(p){await acaoPedido(p.dataset.p,p.dataset.id,p);return}
    if(e.target.closest("[data-close]"))closeSheets();
  });
  document.querySelectorAll(".scrim").forEach(s=>s.addEventListener("click",e=>{if(e.target===s)closeSheets()}));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeSheets()});
  function closeSheets(){document.querySelectorAll(".scrim").forEach(s=>s.hidden=true);fromPedido=null}

  /* ---------- cadastro ---------- */
  function docHint(inp,hint,soCnpj){
    const st=docStatus(inp.value);hint.className="hint";
    if(!st){hint.textContent="";return st}
    if(st==="cnpj"){hint.textContent="CNPJ válido";hint.classList.add("ok")}
    else if(st==="cpf"&&!soCnpj){hint.textContent="CPF válido";hint.classList.add("ok")}
    else if(st==="cpf"&&soCnpj){hint.textContent="Isto é um CPF. Informe o CNPJ da empresa.";hint.classList.add("warn")}
    else if(st==="cnpj-bad"||st==="cpf-bad"){hint.textContent="Os dígitos verificadores não conferem. Confira o número.";hint.classList.add("warn")}
    else hint.textContent=soCnpj?"O CNPJ tem 14 caracteres.":"CNPJ tem 14 caracteres; CPF, 11 dígitos.";
    return st}
  $("cDoc").addEventListener("input",()=>docHint($("cDoc"),$("cDocHint")));
  $("cDoc").addEventListener("blur",()=>{$("cDoc").value=fmtDoc($("cDoc").value);docHint($("cDoc"),$("cDocHint"))});
  $("cTem").addEventListener("change",()=>{$("cValRow").style.opacity=$("cTem").checked?1:.45;$("cVal").disabled=!$("cTem").checked});
  $("novoCert").addEventListener("click",()=>openCert(null));
  function openCert(c,pre){
    editId=c?c.id:null;
    $("cTitle").textContent=c?"Editar certificado":"Novo certificado";
    $("cGrupo").value=c?c.grupo:(f.tab==="pessoal"?"pessoal":"nassau");
    const v=c||pre||{};
    $("cEmpresa").value=v.empresa||"";$("cDoc").value=v.doc||v.cnpj||"";$("cMun").value=v.municipio||"";
    $("cTem").checked=c?!!c.tem_cert:true;$("cVal").value=v.validade||"";$("cTipo").value=v.tipo||"";$("cResp").value=v.resp||"";$("cObs").value=v.obs||"";
    $("cTem").dispatchEvent(new Event("change"));docHint($("cDoc"),$("cDocHint"));$("cErr").textContent="";
    $("scrimC").hidden=false;setTimeout(()=>$("cEmpresa").focus(),30);
  }
  $("formC").addEventListener("submit",async e=>{
    e.preventDefault();
    const empresa=$("cEmpresa").value.trim();
    if(!empresa){$("cErr").textContent="Informe a empresa ou o titular.";return}
    const tem=$("cTem").checked,val=$("cVal").value;
    if(tem&&!val){$("cErr").textContent="Informe a validade, ou desmarque “Já tem certificado emitido”.";return}
    const body={grupo:$("cGrupo").value,empresa,doc:fmtDoc($("cDoc").value),municipio:$("cMun").value.trim(),tem_cert:tem,validade:tem?val:null,tipo:$("cTipo").value,resp:$("cResp").value.trim(),obs:$("cObs").value.trim()};
    try{
      if(editId)await api("certificados?id=eq."+editId,{method:"PATCH",body,prefer:"return=minimal"});
      else await api("certificados",{method:"POST",body,prefer:"return=minimal"});
      if(fromPedido){const id=fromPedido;fromPedido=null;await api("pedidos?id=eq."+id,{method:"PATCH",body:{status:"atendido",tratado_em:new Date().toISOString()},prefer:"return=minimal"})}
      closeSheets();toast(editId?"Alterações salvas":"Certificado cadastrado");await carregar();
    }catch(err){$("cErr").textContent=err.status===401||err.status===403?"Sua sessão expirou. Entre de novo.":"Não foi possível salvar. Confira a conexão e tente de novo."}
  });

  /* ---------- renovação ---------- */
  function openRenew(id){
    const c=certs.find(x=>x.id===id);if(!c)return;renewId=id;
    $("rInfo").textContent=c.empresa+(c.doc?" · "+c.doc:"")+(c.validade?" · validade atual "+dbr(c.validade):"");
    $("rVal").value="";$("rTipo").value=c.tipo||"";$("rErr").textContent="";$("scrimR").hidden=false;setTimeout(()=>$("rVal").focus(),30);
  }
  $("rQuick").addEventListener("click",e=>{const b=e.target.closest("[data-y]");if(!b)return;$("rVal").value=addYears(todayISO(),+b.dataset.y)});
  $("formR").addEventListener("submit",async e=>{
    e.preventDefault();const v=$("rVal").value;
    if(!v){$("rErr").textContent="Informe a nova validade.";return}
    if(diasAte(v)<0){$("rErr").textContent="A nova validade está no passado. Confira a data.";return}
    try{await api("certificados?id=eq."+renewId,{method:"PATCH",body:{validade:v,tem_cert:true,tipo:$("rTipo").value,renovado_em:todayISO()},prefer:"return=minimal"});closeSheets();toast("Renovação registrada: válido até "+dbr(v));await carregar()}
    catch(err){$("rErr").textContent="Não foi possível salvar. Tente de novo."}
  });

  /* ---------- solicitação (qualquer pessoa) ---------- */
  const meusIds=()=>{try{return JSON.parse(localStorage.getItem("cert-meus-pedidos")||"[]")}catch(e){return []}};
  $("pCnpj").addEventListener("input",()=>{docHint($("pCnpj"),$("pCnpjHint"),true);avisoExiste()});
  $("pCnpj").addEventListener("blur",()=>{$("pCnpj").value=fmtDoc($("pCnpj").value);docHint($("pCnpj"),$("pCnpjHint"),true);avisoExiste()});
  function avisoExiste(){const ex=existente($("pCnpj").value);if(ex&&docStatus($("pCnpj").value)==="cnpj"){const h=$("pCnpjHint");h.className="hint warn";h.textContent="Este CNPJ já está na lista: "+ex.empresa+(ex.tem_cert&&ex.validade?", válido até "+dbr(ex.validade)+" ("+diasTxt(ex)+").":", ainda sem certificado.")+" Se for renovação, pode enviar mesmo assim."}}
  $("pedir").addEventListener("click",openPedido);
  $("pOutra").addEventListener("click",()=>{resetPedido();$("pEmpresa").focus()});
  function resetPedido(){["pEmpresa","pCnpj","pObs","pSite"].forEach(id=>$(id).value="");$("pCnpjHint").textContent="";$("pErr").textContent="";$("pCampos").hidden=false;$("pOk").hidden=true;$("pMail").hidden=true;$("pEnviar").disabled=false}
  function openPedido(){
    resetPedido();
    try{const d=JSON.parse(localStorage.getItem("cert-solicitante")||"{}");if(d.nome)$("pNome").value=d.nome;if(d.contato)$("pContato").value=d.contato}catch(e){}
    renderMeus();$("scrimP").hidden=false;setTimeout(()=>$("pEmpresa").focus(),30);
  }
  async function renderMeus(){
    const ids=meusIds();$("pMeus").hidden=true;if(!ids.length)return;
    try{const rows=await api("rpc/situacao_pedidos",{method:"POST",body:{ids:ids.slice(-20)}});
      if(!rows||!rows.length)return;
      $("pMeusList").innerHTML=rows.map(p=>'<div><span>'+esc(p.empresa)+'<br><small class="hint">'+esc(p.cnpj)+'</small></span><span class="pill '+clsPed(p.status)+'">'+stPed(p.status)+'</span></div>').join("");
      $("pMeus").hidden=false}catch(e){}
  }
  $("formP").addEventListener("submit",async e=>{
    e.preventDefault();
    if($("pSite").value)return; // campo-armadilha contra robôs
    const empresa=$("pEmpresa").value.trim(),cnpj=fmtDoc($("pCnpj").value),st=docStatus(cnpj);
    if(empresa.length<2){$("pErr").textContent="Informe a razão social da empresa.";return}
    if(st!=="cnpj"){$("pErr").textContent=st==="cnpj-bad"?"O CNPJ não confere. Revise os números antes de enviar.":"Informe um CNPJ completo, com 14 caracteres.";return}
    $("pErr").textContent="";
    const id=(crypto.randomUUID?crypto.randomUUID():null);
    const item={empresa,cnpj,nome:$("pNome").value.trim(),contato:$("pContato").value.trim(),obs:$("pObs").value.trim()};
    if(id)item.id=id;
    try{localStorage.setItem("cert-solicitante",JSON.stringify({nome:item.nome,contato:item.contato}))}catch(e){}
    $("pEnviar").disabled=true;
    try{
      await api("pedidos",{method:"POST",body:item,prefer:"return=minimal"});
      if(id){try{const ids=meusIds();ids.push(id);localStorage.setItem("cert-meus-pedidos",JSON.stringify(ids.slice(-20)))}catch(e){}}
      $("pCampos").hidden=true;$("pOk").hidden=false;toast("Solicitação enviada");renderMeus();if(isAdmin)carregar();
    }catch(err){
      const txt="Solicitação de certificado digital\n\nEmpresa: "+empresa+"\nCNPJ: "+cnpj+"\nSolicitante: "+(item.nome||"—")+"\nContato: "+(item.contato||"—")+(item.obs?"\nObservação: "+item.obs:"");
      $("addrP").textContent=RECIP;$("pMailText").textContent=txt;$("pMailLink").href=mailto("Solicitação de certificado digital — "+empresa,txt);
      $("pCampos").hidden=true;$("pMail").hidden=false;
    }
  });
  $("pCopiar").addEventListener("click",()=>copiar($("pMailText").textContent,$("pMailText")));

  async function acaoPedido(acao,id,btn){
    const p=pedidos.find(x=>x.id===id);if(!p)return;
    if(acao==="cad"){fromPedido=id;openCert(null,{empresa:p.empresa,cnpj:p.cnpj,obs:p.obs});$("cGrupo").value="nassau";return}
    if(acao==="del"){if(!arm(btn))return;armed=null;
      try{await api("pedidos?id=eq."+id,{method:"DELETE"});toast("Solicitação excluída");await carregar()}catch(e){toast("Não foi possível excluir.")}
      return}
    btn.disabled=true;
    try{await api("pedidos?id=eq."+id,{method:"PATCH",body:{status:acao,tratado_em:acao==="pendente"?null:new Date().toISOString()},prefer:"return=minimal"});
      toast(acao==="atendido"?"Marcada como atendida":acao==="recusado"?"Marcada como recusada":"Reaberta");await carregar()}
    catch(e){btn.disabled=false;toast("Não foi possível salvar.")}
  }

  /* ---------- entrar / sair ---------- */
  $("entrar").addEventListener("click",()=>{$("lErr").textContent="";$("lOk").hidden=true;$("scrimL").hidden=false;setTimeout(()=>$("lEmail").focus(),30)});
  $("sair").addEventListener("click",async()=>{const t=sess&&sess.access_token;saveSess(null);isAdmin=false;f.tab="nassau";render();try{if(t)await authReq("logout",{},t)}catch(e){}carregar();toast("Você saiu")});
  $("formL").addEventListener("submit",async e=>{
    e.preventDefault();
    const email=$("lEmail").value.trim().toLowerCase(),senha=$("lSenha").value;
    if(!email||!senha){$("lErr").textContent="Informe e-mail e senha.";return}
    $("lErr").textContent="";
    try{const j=await authReq("token?grant_type=password",{email,password:senha});saveSess(fromToken(j));$("lSenha").value="";closeSheets();await carregar();toast(isAdmin?"Modo edição ativado":"Você entrou, mas este e-mail não tem permissão para alterar.")}
    catch(err){$("lErr").textContent=/confirm/i.test(err.message)?"Este e-mail ainda não foi confirmado.":"E-mail ou senha incorretos."}
  });
  $("lCriar").addEventListener("click",async()=>{
    const email=$("lEmail").value.trim().toLowerCase(),senha=$("lSenha").value;
    if(!email||senha.length<8){$("lErr").textContent="Para criar o acesso, informe o e-mail e uma senha com pelo menos 8 caracteres.";return}
    $("lErr").textContent="";
    try{const j=await authReq("signup",{email,password:senha});
      if(j.access_token){saveSess(fromToken(j));closeSheets();await carregar();toast("Acesso criado")}
      else{$("lOk").hidden=false;$("lOk").textContent="Acesso criado. Falta confirmar o e-mail: abra a mensagem que o Supabase enviou e toque no link. Depois volte aqui e entre."}}
    catch(err){$("lErr").textContent=/registered|exists/i.test(err.message)?"Este e-mail já tem acesso. Use Entrar.":"Não foi possível criar o acesso: "+err.message}
  });

  /* ---------- tema ---------- */
  (function(){const sw=$("tema");const cur=()=>{const t=document.documentElement.dataset.theme;return t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches};
    let saved=null;try{saved=localStorage.getItem("cert-tema")}catch(e){}
    if(saved==="dark"||saved==="light")document.documentElement.dataset.theme=saved;
    const upd=()=>{sw.setAttribute("aria-checked",String(cur()));const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=getComputedStyle(document.body).backgroundColor};upd();
    sw.addEventListener("click",()=>{const n=cur()?"light":"dark";document.documentElement.dataset.theme=n;try{localStorage.setItem("cert-tema",n)}catch(e){}upd()});
    try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",upd)}catch(e){}
  })();

  /* ---------- início ---------- */
  render();carregar();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")carregar()});
  setInterval(()=>{if(document.visibilityState==="visible")carregar()},120000);
  if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}
})();
