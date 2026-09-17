const app=document.getElementById('admin-app');
const login=document.getElementById('admin-login');
const loginForm=document.getElementById('admin-login-form');
const loginEmail=document.getElementById('admin-email');
const loginPassword=document.getElementById('admin-password');
const loginError=document.getElementById('admin-login-error');
const loginSubmit=document.getElementById('admin-login-submit');
const sessionStatus=document.getElementById('admin-session-status');
const sessionRetry=document.getElementById('admin-session-retry');
let snapshot=null;
let readiness=null;
let tab='overview';
let days=30;
let editing=null;
let pageEditing=null;
let mediaEditing=null;
let csrfToken='';
let adminEmail='';
let authGeneration=0;
let sandboxError='';
let sandboxLoading=false;
let readinessLoading=false;
let readinessError='';
let blogQuery='';
let blogStatus='all';
let blogSort='updated';
const formDrafts=new Map();
const actionDrafts=new Map();
let actionDialog=null;
let actionState=null;
let lastTrigger=null;
let sessionStarted=false;
let sessionChecking=false;
let loginInFlight=false;
let signoutInFlight=false;
let pendingLoginEmail='';
let sandboxRequestSeq=0;
let readinessRequestSeq=0;

const NAV_GROUPS=[
  {label:'Live engagement',items:[
    {key:'overview',label:'Overview',icon:'grid'},
    {key:'traffic',label:'Traffic',icon:'trend'},
    {key:'chat',label:'Visitor chat',icon:'chat'}
  ]},
  {label:'Sandbox',sandbox:true,items:[
    {key:'listings',label:'Listings',icon:'box'},
    {key:'reports',label:'Reports',icon:'flag'},
    {key:'support',label:'Support',icon:'life'},
    {key:'agreements',label:'Agreements',icon:'doc'},
    {key:'readiness',label:'Readiness',icon:'check'}
  ]},
  {label:'Content',items:[
    {key:'pages',label:'Pages',icon:'doc'},
    {key:'media',label:'Media',icon:'image'},
    {key:'blog',label:'Blog',icon:'pen'}
  ]},
  {label:'Workspace',items:[
    {key:'settings',label:'Settings',icon:'gear'},
    {key:'audit',label:'Audit',icon:'list'},
    {key:'export',label:'Export',icon:'down'}
  ]}
];

const TAB_TITLES={
  overview:'Overview',
  traffic:'Traffic',
  chat:'Visitor chat',
  listings:'Listings',
  reports:'Reports',
  support:'Support',
  agreements:'Agreements',
  readiness:'Readiness',
  blog:'Blog',
  pages:'Pages',
  media:'Media',
  settings:'Settings',
  audit:'Audit',
  export:'Export'
};

const SANDBOX_TABS=new Set(['listings','reports','support','agreements','readiness']);

tab=normalizeHash(location.hash);

function normalizeHash(hash){
  const raw=String(hash||'').replace(/^#/,'').trim().toLowerCase();
  if(!raw)return 'overview';
  const known=Object.keys(TAB_TITLES);
  return known.includes(raw)?raw:'overview';
}

function esc(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function fmtDate(value){
  if(!value)return '—';
  const d=new Date(value);
  if(isNaN(d.getTime()))return '—';
  return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function fmtUnits(value){
  if(value==null||value==='')return '—';
  let micro;
  try{micro=BigInt(value);}
  catch(_){return '—';}
  const n=Number(micro)/1e6;
  if(!isFinite(n))return '—';
  return n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});
}

function icon(name){
  const paths={
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    trend:'<path d="M3 17l5-6 4 3 6-8"/><path d="M15 6h4v4"/>',
    chat:'<path d="M4 5h16v11H8l-4 4z"/>',
    box:'<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    flag:'<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
    life:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M4 17l5-5 3 3 2-2 6 5"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    pen:'<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/>',
    gear:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>',
    list:'<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
    down:'<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    refresh:'<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
    out:'<path d="M15 4h4v16h-4"/><path d="M10 12H3"/><path d="M7 8l-4 4 4 4"/>',
    alert:'<path d="M12 3l9 16H3z"/><path d="M12 9v5"/><circle cx="12" cy="17" r="0.8"/>'
  };
  const body=paths[name]||paths.grid;
  return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+body+'</svg>';
}

function kpi(label,value,foot){
  return '<div class="kpi"><p class="kpi-label">'+esc(label)+'</p><p class="kpi-value">'+esc(value)+'</p>'+(foot?'<p class="kpi-foot">'+esc(foot)+'</p>':'')+'</div>';
}

let toastTimer=null;
function toast(message,error=false){
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=String(message||'');
  el.classList.toggle('error',!!error);
  el.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.classList.remove('show');},error?6000:3200);
}

async function api(path,options={}){
  const opts=Object.assign({},options);
  const headers=Object.assign({'Accept':'application/json'},opts.headers||{});
  const method=(opts.method||'GET').toUpperCase();
  if(opts.body!=null&&typeof opts.body!=='string'&&!(opts.body instanceof FormData)){
    headers['Content-Type']='application/json';
    opts.body=JSON.stringify(opts.body);
  }else if(opts.body!=null&&typeof opts.body==='string'&&!headers['Content-Type']){
    headers['Content-Type']='application/json';
  }
  if(method==='POST'&&csrfToken)headers['X-CSRF-Token']=csrfToken;
  const gen=authGeneration;
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(),15000);
  let res=null;
  let data=null;
  try{
    try{
      res=await fetch(path,{
        method,
        headers,
        body:opts.body,
        credentials:'same-origin',
        cache:'no-store',
        signal:controller.signal
      });
    }catch(err){
      const aborted=err&&err.name==='AbortError';
      const e=new Error(aborted?'Request timed out. Check your connection and try again.':'Network request failed. Check your connection and try again.');
      e.code=aborted?'timeout':'network';
      throw e;
    }
    const text=await res.text();
    if(text){
      try{data=JSON.parse(text);}
      catch(_){data=null;}
    }
    if(res.status===401){
      if(path==='/api/admin/login'){
        const e=new Error('Invalid email or password.');
        e.code='LOGIN_FAILED';
        e.status=401;
        throw e;
      }
      if(path==='/api/admin/session'){
        const e=new Error('Sign in to continue.');
        e.code='unauthorized';
        e.status=401;
        throw e;
      }
      if(gen===authGeneration){
        authGeneration++;
        handleUnauthorized();
      }
      const e=new Error('Session expired.');
      e.code='unauthorized';
      e.status=401;
      throw e;
    }
    if(!res.ok){
      const msg=(data&&data.error)||('Request failed ('+res.status+').');
      const e=new Error(msg);
      e.code=(data&&data.code)||'http_'+res.status;
      e.status=res.status;
      throw e;
    }
    if(data===null){
      const e=new Error('Malformed response from server.');
      e.code='malformed';
      throw e;
    }
    return data;
  }finally{
    clearTimeout(deadline);
  }
}

async function command(commandName,payload){
  const gen=authGeneration;
  const out=await api('/api/admin/command',{method:'POST',body:{actorId:'reviewer',command:commandName,payload:payload||{}}});
  if(gen!==authGeneration){
    const e=new Error('Session changed. Sign in again to retry.');
    e.code='stale_auth';
    throw e;
  }
  return out;
}

function captureForms(){
  const blog=document.getElementById('blog-form');
  if(blog){
    const key='#blog-form:'+(blog.getAttribute('data-id')||'new');
    const values={};
    blog.querySelectorAll('input,textarea,select').forEach(el=>{
      if(!el.name)return;
      if(el.type==='checkbox')values[el.name]=el.checked;
      else values[el.name]=el.value;
    });
    const err=blog.querySelector('.form-error');
    formDrafts.set(key,{values,error:err?err.textContent:''});
  }
  const settings=document.getElementById('settings-form');
  if(settings){
    const values={};
    settings.querySelectorAll('input,textarea,select').forEach(el=>{
      if(!el.name)return;
      if(el.type==='checkbox')values[el.name]=el.checked;
      else values[el.name]=el.value;
    });
    const err=settings.querySelector('.form-error');
    formDrafts.set('#settings-form',{values,error:err?err.textContent:''});
  }
  ['page-form','media-form'].forEach(id=>{
    const form=document.getElementById(id);if(!form)return;
    const values={};form.querySelectorAll('input,textarea,select').forEach(el=>{if(el.name)values[el.name]=el.type==='checkbox'?el.checked:el.value});
    const err=form.querySelector('.form-error');formDrafts.set(`#${id}:${form.dataset.id||'new'}`,{values,error:err?err.textContent:''});
  });
}

function restoreForms(){
  const blog=document.getElementById('blog-form');
  if(blog){
    const key='#blog-form:'+(blog.getAttribute('data-id')||'new');
    const draft=formDrafts.get(key);
    if(draft){
      blog.querySelectorAll('input,textarea,select').forEach(el=>{
        if(!el.name)return;
        if(!(el.name in draft.values))return;
        if(el.type==='checkbox')el.checked=!!draft.values[el.name];
        else el.value=draft.values[el.name];
      });
      const err=blog.querySelector('.form-error');
      if(err&&draft.error){err.textContent=draft.error;err.hidden=false;}
    }
  }
  const settings=document.getElementById('settings-form');
  if(settings){
    const draft=formDrafts.get('#settings-form');
    if(draft){
      settings.querySelectorAll('input,textarea,select').forEach(el=>{
        if(!el.name)return;
        if(!(el.name in draft.values))return;
        if(el.type==='checkbox')el.checked=!!draft.values[el.name];
        else el.value=draft.values[el.name];
      });
      const err=settings.querySelector('.form-error');
      if(err&&draft.error){err.textContent=draft.error;err.hidden=false;}
    }
  }
  ['page-form','media-form'].forEach(id=>{
    const form=document.getElementById(id);if(!form)return;const draft=formDrafts.get(`#${id}:${form.dataset.id||'new'}`);if(!draft)return;
    form.querySelectorAll('input,textarea,select').forEach(el=>{if(!el.name||!(el.name in draft.values))return;if(el.type==='checkbox')el.checked=!!draft.values[el.name];else el.value=draft.values[el.name]});
    const err=form.querySelector('.form-error');if(err&&draft.error){err.textContent=draft.error;err.hidden=false;}
  });
}

function clearFormDraft(key){
  if(key)formDrafts.delete(key);
}

function resetAllCaches(){
  snapshot=null;
  readiness=null;
  sandboxError='';
  sandboxLoading=false;
  readinessLoading=false;
  readinessError='';
  editing=null;
  pageEditing=null;
  mediaEditing=null;
  sandboxRequestSeq++;
  readinessRequestSeq++;
  formDrafts.clear();
  actionDrafts.clear();
  if(app)app.innerHTML='';
  if(typeof stopChatPolling==='function')try{stopChatPolling();}catch(_){}
  if(typeof resetChatState==='function')try{resetChatState();}catch(_){}
  if(typeof resetTrafficState==='function')try{resetTrafficState();}catch(_){}
}

function handleUnauthorized(){
  captureForms();
  if(typeof captureChatDraft==='function')try{captureChatDraft();}catch(_){}
  if(actionState){
    const values=readDialogValues();
    actionDrafts.set(actionState.key,{values,error:'Session expired. Sign in again to retry.'});
    const resolve=actionState.resolve;
    actionState.pending=false;
    setDialogPending(false);
    actionState=null;
    closeActionDialog(true);
    if(resolve)resolve(null);
  }
  if(typeof stopChatPolling==='function')try{stopChatPolling();}catch(_){}
  csrfToken='';
  showLogin('Your session expired. Sign in again to continue.');
}

function showLogin(message){
  if(app)app.hidden=true;
  if(login)login.hidden=false;
  if(loginError){
    if(message){loginError.textContent=message;loginError.hidden=false;}
    else{loginError.textContent='';loginError.hidden=true;}
  }
  if(loginPassword)loginPassword.value='';
  if(loginEmail&&!loginEmail.value&&adminEmail)loginEmail.value=adminEmail;
  if(loginEmail)try{loginEmail.focus();}catch(_){}
}

function showApp(){
  if(login)login.hidden=true;
  if(app)app.hidden=false;
}

function navHtml(){
  let html='';
  NAV_GROUPS.forEach(group=>{
    html+='<div class="nav-group'+(group.sandbox?' sandbox':'')+'">';
    html+='<p class="nav-label">'+esc(group.label)+(group.sandbox?'<span class="sandbox-tag">not real financial activity</span>':'')+'</p>';
    html+='<ul class="nav-list">';
    group.items.forEach(item=>{
      const active=item.key===tab;
      html+='<li><a href="#'+esc(item.key)+'" data-tab="'+esc(item.key)+'" class="nav-link'+(active?' active':'')+'"'+(active?' aria-current="page"':'')+'>'+icon(item.icon)+'<span>'+esc(item.label)+'</span></a></li>';
    });
    html+='</ul></div>';
  });
  return html;
}

function shellHtml(){
  const title=TAB_TITLES[tab]||'Overview';
  const sandbox=SANDBOX_TABS.has(tab);
  const email=adminEmail?'<p class="top-email">'+esc(adminEmail)+'</p>':'';
  return ''+
    '<div class="admin-shell">'+
      '<aside class="admin-side" aria-label="Admin navigation">'+
        '<div class="side-brand"><span class="brand-mark">E</span><span class="side-brand-text">Escrow Global</span></div>'+
        '<div class="mobile-nav">'+
          '<label class="mobile-nav-label" for="admin-mobile-section">Admin section</label>'+
          '<select id="admin-mobile-section" class="mobile-nav-select" aria-label="Admin section">'+
            NAV_GROUPS.map(function(g){
              return '<optgroup label="'+esc(g.sandbox?'Sandbox (test data)':g.label)+'">'+
                g.items.map(function(it){
                  return '<option value="'+esc(it.key)+'"'+(it.key===tab?' selected':'')+'>'+esc(it.label)+'</option>';
                }).join('')+
              '</optgroup>';
            }).join('')+
          '</select>'+
        '</div>'+
        '<nav class="side-nav">'+navHtml()+'</nav>'+
        '<div class="side-foot">'+
          '<a class="side-link" href="https://www.escrowglobal.io/" rel="noreferrer">Marketplace</a>'+
          '<a class="side-link" href="https://www.escrowglobal.io/blog" rel="noreferrer">Public blog</a>'+
          '<button type="button" class="btn ghost signout" id="admin-signout">'+icon('out')+'<span>Sign out</span></button>'+
        '</div>'+
      '</aside>'+
      '<div class="admin-body">'+
        '<header class="admin-top">'+
          '<div class="top-titles">'+
            '<p class="eyebrow">'+(sandbox?'Sandbox workspace':(tab==='blog'?'Public journal':'Live engagement'))+'</p>'+
            '<h1 id="admin-title">'+esc(title)+'</h1>'+
            '<p class="top-note">'+(sandbox?'Sandbox data — not real financial activity.':(tab==='blog'?'Public journal content.':'Real first-party traffic and visitor chat from this site.'))+'</p>'+
            email+
          '</div>'+
          '<div class="top-actions">'+
            '<button type="button" class="btn ghost" id="admin-refresh">'+icon('refresh')+'<span>Refresh</span></button>'+
            '<button type="button" class="btn ghost signout-mobile" id="admin-signout-mobile">'+icon('out')+'<span>Sign out</span></button>'+
          '</div>'+
        '</header>'+
        '<main id="admin-main" tabindex="-1"><div id="admin-content"></div></main>'+
      '</div>'+
    '</div>';
}

function render(){
  if(!app)return;
  captureForms();
  if(typeof captureChatDraft==='function')try{captureChatDraft();}catch(_){}
  app.innerHTML=shellHtml();
  const content=document.getElementById('admin-content');
  if(!content)return;
  content.innerHTML=viewHtml();
  restoreForms();
  bindShell();
  bindView();
}

function loadingHtml(label){
  return '<div class="panel loading-panel" role="status" aria-live="polite"><p class="muted">'+esc(label||'Loading…')+'</p></div>';
}

function viewHtml(){
  if(tab==='overview'||tab==='traffic'){
    if(typeof trafficView==='function')return trafficView();
    return '<div class="panel"><p class="muted">Traffic module unavailable.</p></div>';
  }
  if(tab==='chat'){
    if(typeof chatView==='function')return chatView();
    return '<div class="panel"><p class="muted">Chat module unavailable.</p></div>';
  }
  if(SANDBOX_TABS.has(tab)||tab==='blog'||tab==='pages'||tab==='media'||tab==='settings'||tab==='audit'||tab==='export'){
    if(!snapshot){
      if(sandboxLoading)return loadingHtml('Loading sandbox data…');
      if(sandboxError){
        return '<div class="panel error-panel"><p role="alert">'+esc(sandboxError)+'</p><button type="button" class="btn primary" id="sandbox-retry">Retry</button></div>';
      }
      return '<div class="panel"><p class="muted">Sandbox data not loaded.</p></div>';
    }
    const stale=sandboxError?'<div class="panel warn-panel"><p role="status">Showing cached sandbox data. Last refresh failed: '+esc(sandboxError)+'</p></div>':'';
    let inner='';
    if(tab==='readiness'){
      if(readinessLoading&&!readiness)inner=loadingHtml('Loading readiness…');
      else if(readinessError&&!readiness)inner='<div class="panel error-panel"><p role="alert">'+esc(readinessError)+'</p><button type="button" class="btn primary" id="readiness-retry">Retry</button></div>';
      else if(typeof readinessView==='function')inner=readinessView();
      else inner='<div class="panel"><p class="muted">Readiness view unavailable.</p></div>';
      if(readinessError&&readiness)inner='<div class="panel warn-panel"><p role="status">Showing cached readiness data. Last refresh failed: '+esc(readinessError)+'</p></div>'+inner;
    }
    else if(tab==='listings'&&typeof listings==='function')inner=listings();
    else if(tab==='reports'&&typeof reports==='function')inner=reports();
    else if(tab==='support'&&typeof support==='function')inner=support();
    else if(tab==='agreements'&&typeof agreements==='function')inner=agreements();
    else if(tab==='blog'&&typeof blog==='function')inner=blog();
    else if(tab==='pages'&&typeof pages==='function')inner=pages();
    else if(tab==='media'&&typeof media==='function')inner=media();
    else if(tab==='settings'&&typeof settings==='function')inner=settings();
    else if(tab==='audit'&&typeof audit==='function')inner=audit();
    else if(tab==='export'&&typeof exportView==='function')inner=exportView();
    else inner='<div class="panel"><p class="muted">View unavailable.</p></div>';
    return stale+inner;
  }
  return '<div class="panel"><p class="muted">Unknown view.</p></div>';
}

function bindShell(){
  const signout=document.getElementById('admin-signout');
  if(signout)signout.addEventListener('click',signOut);
  const signoutM=document.getElementById('admin-signout-mobile');
  if(signoutM)signoutM.addEventListener('click',signOut);
  const mobileSection=document.getElementById('admin-mobile-section');
  if(mobileSection)mobileSection.addEventListener('change',ev=>{
    const v=ev.target&&ev.target.value;
    if(v&&!navigateTo(v))ev.target.value=tab;
  });
  const refresh=document.getElementById('admin-refresh');
  if(refresh)refresh.addEventListener('click',()=>refreshTab());
  const retry=document.getElementById('sandbox-retry');
  if(retry)retry.addEventListener('click',()=>loadTab());
  const rretry=document.getElementById('readiness-retry');
  if(rretry)rretry.addEventListener('click',()=>loadTab());
  if(app&&!app.dataset.navDelegated){
    app.dataset.navDelegated='1';
    app.addEventListener('click',ev=>{
      const el=ev.target&&ev.target.closest?ev.target.closest('[data-tab]'):null;
      if(!el||!app.contains(el))return;
      const key=el.getAttribute('data-tab');
      if(!key)return;
      ev.preventDefault();
      navigateTo(key);
    });
  }
}

function bindView(){
  if(tab==='overview'||tab==='traffic'){
    if(typeof bindTraffic==='function')bindTraffic();
  }else if(tab==='chat'){
    if(typeof bindChat==='function')bindChat();
    if(typeof startChatPolling==='function')try{startChatPolling();}catch(_){}
  }else if(SANDBOX_TABS.has(tab)||tab==='blog'||tab==='pages'||tab==='media'||tab==='settings'||tab==='audit'||tab==='export'){
    if(typeof bindLegacy==='function')bindLegacy();
  }
}

function isSandboxSnapshot(data){
  if(!data||typeof data!=='object')return false;
  const arrays=['listings','orders','reports','users','blog','pages','media','supportTickets'];
  for(const key of arrays){
    if(!Array.isArray(data[key]))return false;
  }
  if(!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))return false;
  if(!data.analytics||typeof data.analytics!=='object'||Array.isArray(data.analytics))return false;
  return true;
}

async function loadSandbox(){
  const gen=authGeneration;
  const seq=++sandboxRequestSeq;
  sandboxLoading=true;
  try{
    const data=await api('/api/admin/overview?days='+encodeURIComponent(days));
    if(seq!==sandboxRequestSeq||gen!==authGeneration)return;
    if(!isSandboxSnapshot(data)){
      const e=new Error('Malformed sandbox data from server.');
      e.code='malformed';
      throw e;
    }
    snapshot=data;
    sandboxError='';
  }catch(err){
    if(seq!==sandboxRequestSeq||gen!==authGeneration)return;
    sandboxError=err&&err.message?err.message:'Failed to load sandbox data.';
    if(!snapshot)throw err;
  }finally{
    if(seq===sandboxRequestSeq&&gen===authGeneration)sandboxLoading=false;
  }
}

async function loadReadiness(){
  const gen=authGeneration;
  const seq=++readinessRequestSeq;
  readinessLoading=true;
  try{
    const data=await api('/api/custody/readiness');
    if(seq!==readinessRequestSeq||gen!==authGeneration)return;
    if(!data||typeof data!=='object'||!Array.isArray(data.gates)){
      const e=new Error('Malformed readiness data from server.');
      e.code='malformed';
      throw e;
    }
    readiness=data;
    readinessError='';
  }catch(err){
    if(seq!==readinessRequestSeq||gen!==authGeneration)return;
    readinessError=err&&err.message?err.message:'Failed to load readiness.';
    if(!readiness)throw err;
  }finally{
    if(seq===readinessRequestSeq&&gen===authGeneration)readinessLoading=false;
  }
}

async function loadTab({silent=false}={}){
  const gen=authGeneration;
  const current=tab;
  if(current==='chat'){
    const chatRoot=document.querySelector('.chat-view');
    if(!chatRoot&&!silent){
      const content=document.getElementById('admin-content');
      if(content)content.innerHTML=loadingHtml('Loading chat…');
    }
    try{
      if(typeof loadChat==='function')await loadChat({silent});
    }catch(err){
      if(!silent)toast(err&&err.message?err.message:'Failed to load chat.',true);
    }
    if(gen!==authGeneration)return;
    if(tab!==current)return;
    if(app&&app.hidden)return;
    if(typeof bindChat==='function')bindChat();
    if(typeof startChatPolling==='function')try{startChatPolling();}catch(_){}
    return;
  }
  if(current==='overview'||current==='traffic'){
    if(!silent){
      const content=document.getElementById('admin-content');
      if(content&&typeof trafficView==='function')content.innerHTML=loadingHtml('Loading traffic…');
    }
    try{
      if(typeof loadTraffic==='function')await loadTraffic({silent});
    }catch(err){
      if(!silent)toast(err&&err.message?err.message:'Failed to load traffic.',true);
    }
    if(gen!==authGeneration)return;
    if(tab!==current)return;
    if(app&&app.hidden)return;
    const content=document.getElementById('admin-content');
    if(content&&typeof trafficView==='function'){
      content.innerHTML=trafficView();
      if(typeof bindTraffic==='function')bindTraffic();
    }
    return;
  }
  if(SANDBOX_TABS.has(current)||current==='blog'||current==='pages'||current==='media'||current==='settings'||current==='audit'||current==='export'){
    if(!silent&&!snapshot){
      const content=document.getElementById('admin-content');
      if(content)content.innerHTML=loadingHtml('Loading sandbox data…');
    }
    try{
      await loadSandbox();
      if(current==='readiness'){
        try{await loadReadiness();}catch(_){}
      }
    }catch(err){
      if(!silent)toast(err&&err.message?err.message:'Failed to load data.',true);
    }
    if(gen!==authGeneration)return;
    if(tab!==current)return;
    if(app&&app.hidden)return;
    render();
    return;
  }
}

async function refreshTab(){
  const gen=authGeneration;
  try{
    await loadTab({silent:false});
  }catch(err){
    if(gen===authGeneration)toast(err&&err.message?err.message:'Refresh failed.',true);
  }
}

async function afterSandboxSave(message='Saved to the sandbox.'){
  toast(message,false);
  try{
    await loadTab({silent:true});
  }catch(err){
    toast('Saved, but refresh failed: '+(err&&err.message?err.message:'unknown error'),true);
  }
}

async function signOut(){
  if(signoutInFlight)return;
  signoutInFlight=true;
  try{
    await api('/api/admin/logout',{method:'POST',body:{}});
  }catch(err){
    signoutInFlight=false;
    if(err&&err.code==='unauthorized')return;
    toast('Sign out failed: '+(err&&err.message?err.message:'unknown error')+'. You are still signed in.',true);
    return;
  }
  signoutInFlight=false;
  closeActionDialog(true);
  resetAllCaches();
  csrfToken='';
  adminEmail='';
  authGeneration++;
  showLogin('');
}

function openActionDialog(config){
  const cfg=config||{};
  if(!actionDialog){
    actionDialog=document.getElementById('admin-action-dialog');
  }
  if(!actionDialog)return Promise.resolve(null);
  lastTrigger=document.activeElement;
  const fields=Array.isArray(cfg.fields)?cfg.fields:[];
  const key=cfg.key||('action:'+Date.now());
  const draft=actionDrafts.get(key);
  const values=Object.assign({},draft?draft.values:{});
  fields.forEach(f=>{
    if(!(f.name in values)&&f.value!=null)values[f.name]=f.value;
  });
  actionState={key,fields,values,error:draft?draft.error:'',onSubmit:cfg.onSubmit,pending:false,resolve:null};
  const body=actionDialog.querySelector('#admin-action-body');
  const titleEl=actionDialog.querySelector('#admin-action-title');
  const descEl=actionDialog.querySelector('#admin-action-desc');
  const submit=actionDialog.querySelector('#admin-action-submit');
  const errEl=actionDialog.querySelector('#admin-action-error');
  if(titleEl)titleEl.textContent=cfg.title||'Action';
  if(descEl)descEl.textContent=cfg.description||'';
  if(submit)submit.textContent=cfg.submitLabel||'Save changes';
  if(submit)submit.classList.toggle('danger',!!cfg.danger);
  if(errEl){errEl.textContent=actionState.error||'';errEl.hidden=!actionState.error;}
  if(body)body.innerHTML=fieldsHtml(fields,values);
  setDialogPending(false);
  actionDialog.returnValue='';
  if(typeof actionDialog.showModal==='function')actionDialog.showModal();
  else actionDialog.setAttribute('open','');
  const first=actionDialog.querySelector('#admin-action-body input,#admin-action-body textarea,#admin-action-body select');
  if(first)try{first.focus();}catch(_){}
  else{
    const cancel=actionDialog.querySelector('#admin-action-cancel');
    if(cancel)try{cancel.focus();}catch(_){}
  }
  return new Promise(resolve=>{
    if(actionState)actionState.resolve=resolve;
  });
}

function fieldsHtml(fields,values){
  let html='';
  fields.forEach((f,idx)=>{
    const id='admin-action-field-'+idx;
    const val=values[f.name];
    const req=f.required?' required':'';
    const max=f.maxLength?' maxlength="'+Number(f.maxLength)+'"':'';
    html+='<div class="field">';
    if(f.type==='checkbox'){
      html+='<label class="check" for="'+id+'"><input type="checkbox" id="'+id+'" name="'+esc(f.name)+'"'+(val?' checked':'')+'> <span>'+esc(f.label)+'</span></label>';
    }else{
      html+='<label for="'+id+'">'+esc(f.label)+'</label>';
      if(f.type==='textarea'){
        html+='<textarea id="'+id+'" name="'+esc(f.name)+'"'+req+max+'>'+esc(val==null?'':val)+'</textarea>';
      }else if(f.type==='select'){
        html+='<select id="'+id+'" name="'+esc(f.name)+'"'+req+'>';
        (f.options||[]).forEach(opt=>{
          const ov=typeof opt==='string'?opt:opt.value;
          const ol=typeof opt==='string'?opt:opt.label;
          html+='<option value="'+esc(ov)+'"'+(String(val)===String(ov)?' selected':'')+'>'+esc(ol)+'</option>';
        });
        html+='</select>';
      }else{
        html+='<input type="text" id="'+id+'" name="'+esc(f.name)+'" value="'+esc(val==null?'':val)+'"'+req+max+'>';
      }
    }
    html+='</div>';
  });
  return html;
}

function readDialogValues(){
  const out={};
  if(!actionDialog||!actionState)return out;
  const body=actionDialog.querySelector('#admin-action-body');
  if(!body)return out;
  actionState.fields.forEach(f=>{
    const el=body.querySelector('[name="'+cssEscape(f.name)+'"]');
    if(!el)return;
    if(f.type==='checkbox')out[f.name]=!!el.checked;
    else out[f.name]=el.value;
  });
  return out;
}

function cssEscape(value){
  if(window.CSS&&typeof window.CSS.escape==='function')return window.CSS.escape(value);
  return String(value).replace(/["\\]/g,'\\$&');
}

function closeActionDialog(force){
  if(!actionDialog)return;
  if(actionState&&actionState.pending&&!force)return;
  if(typeof actionDialog.close==='function'&&actionDialog.open)actionDialog.close();
  else actionDialog.removeAttribute('open');
  const trigger=lastTrigger;
  lastTrigger=null;
  if(trigger&&trigger.isConnected&&typeof trigger.focus==='function')try{trigger.focus();}catch(_){}
  else{
    const main=document.getElementById('admin-main');
    if(main&&!main.hidden)try{main.focus();}catch(_){}
    else if(login&&!login.hidden&&loginEmail)try{loginEmail.focus();}catch(_){}
  }
}

function setDialogPending(pending){
  if(!actionDialog)return;
  actionDialog.classList.toggle('pending',!!pending);
  const submit=actionDialog.querySelector('#admin-action-submit');
  const cancel=actionDialog.querySelector('#admin-action-cancel');
  if(submit)submit.disabled=!!pending;
  if(cancel)cancel.disabled=!!pending;
  actionDialog.querySelectorAll('#admin-action-body input,#admin-action-body textarea,#admin-action-body select').forEach(el=>{
    el.disabled=!!pending;
  });
}

async function submitActionDialog(){
  if(!actionState||actionState.pending)return;
  const state=actionState;
  const values=readDialogValues();
  state.values=values;
  const errEl=actionDialog.querySelector('#admin-action-error');
  const missing=state.fields.filter(f=>f.required&&f.type!=='checkbox'&&String(values[f.name]||'').trim()==='');
  if(missing.length){
    state.error='Please fill in: '+missing.map(f=>f.label).join(', ')+'.';
    if(errEl){errEl.textContent=state.error;errEl.hidden=false;}
    return;
  }
  state.pending=true;
  setDialogPending(true);
  if(errEl){errEl.textContent='';errEl.hidden=true;}
  try{
    if(typeof state.onSubmit==='function')await state.onSubmit(values);
    actionDrafts.delete(state.key);
    state.pending=false;
    setDialogPending(false);
    if(actionState===state){
      const resolve=state.resolve;
      actionState=null;
      closeActionDialog(true);
      if(resolve)resolve(values);
    }
  }catch(err){
    if(actionState!==state)return;
    state.pending=false;
    setDialogPending(false);
    state.error=err&&err.message?err.message:'Action failed.';
    if(errEl){errEl.textContent=state.error;errEl.hidden=false;}
    actionDrafts.set(state.key,{values:state.values,error:state.error});
  }
}

function cancelActionDialog(){
  if(!actionState)return;
  if(actionState.pending)return;
  const values=readDialogValues();
  actionDrafts.set(actionState.key,{values,error:actionState.error||''});
  const resolve=actionState.resolve;
  actionState=null;
  closeActionDialog(true);
  if(resolve)resolve(null);
}

function bindActionDialog(){
  actionDialog=document.getElementById('admin-action-dialog');
  if(!actionDialog)return;
  const form=actionDialog.querySelector('#admin-action-form');
  if(form)form.addEventListener('submit',ev=>{ev.preventDefault();submitActionDialog();});
  const cancel=actionDialog.querySelector('#admin-action-cancel');
  if(cancel)cancel.addEventListener('click',ev=>{ev.preventDefault();cancelActionDialog();});
  actionDialog.addEventListener('cancel',ev=>{
    ev.preventDefault();
    if(actionState&&actionState.pending)return;
    cancelActionDialog();
  });
  actionDialog.addEventListener('close',()=>{
    if(actionState&&!actionState.pending){
      const values=readDialogValues();
      actionDrafts.set(actionState.key,{values,error:actionState.error||''});
      const resolve=actionState.resolve;
      actionState=null;
      if(resolve)resolve(null);
    }
  });
}

async function startSession(){
  if(sessionStarted)return;
  sessionStarted=true;
  sessionChecking=true;
  if(loginSubmit)loginSubmit.disabled=true;
  if(sessionStatus){sessionStatus.textContent='Checking existing session…';sessionStatus.hidden=false;}
  if(sessionRetry)sessionRetry.hidden=true;
  if(loginError){loginError.textContent='';loginError.hidden=true;}
  showLogin('');
  const gen=authGeneration;
  try{
    const data=await api('/api/admin/session');
    if(gen!==authGeneration)return;
    const token=data&&typeof data.csrfToken==='string'?data.csrfToken:'';
    const email=data&&typeof data.email==='string'?data.email:'';
    if(!token||!email){
      const e=new Error('Malformed authentication response.');
      e.code='malformed';
      throw e;
    }
    const previous=adminEmail;
    if(previous&&previous.toLowerCase()!==email.toLowerCase())resetAllCaches();
    csrfToken=token;
    adminEmail=email;
    authGeneration++;
    if(sessionStatus){sessionStatus.textContent='';sessionStatus.hidden=true;}
    showApp();
    render();
    await loadTab();
  }catch(err){
    if(gen!==authGeneration)return;
    if(err&&err.code==='unauthorized'){
      if(sessionStatus){sessionStatus.textContent='';sessionStatus.hidden=true;}
      showLogin('');
      return;
    }
    if(sessionStatus){sessionStatus.textContent='';sessionStatus.hidden=true;}
    showLogin(err&&err.message?err.message:'Unable to reach the admin service. Try again.');
    if(sessionRetry)sessionRetry.hidden=false;
  }finally{
    sessionChecking=false;
    if(loginSubmit)loginSubmit.disabled=false;
  }
}

function retrySession(){
  sessionStarted=false;
  if(sessionRetry)sessionRetry.hidden=true;
  startSession();
}

function bindLogin(){
  if(!loginForm)return;
  loginForm.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(loginInFlight)return;
    if(sessionChecking)return;
    if(loginError){loginError.textContent='';loginError.hidden=true;}
    const email=loginEmail?loginEmail.value.trim():'';
    const password=loginPassword?loginPassword.value:'';
    if(!email||!password){
      if(loginError){loginError.textContent='Enter your email and password.';loginError.hidden=false;}
      return;
    }
    pendingLoginEmail=email;
    loginInFlight=true;
    if(loginSubmit)loginSubmit.disabled=true;
    const gen=authGeneration;
    try{
      const data=await api('/api/admin/login',{method:'POST',body:{email,password}});
      if(gen!==authGeneration)return;
      const token=data&&typeof data.csrfToken==='string'?data.csrfToken:'';
      const confirmed=data&&typeof data.email==='string'&&data.email?data.email:email;
      if(!token||!confirmed){
        const e=new Error('Malformed authentication response.');
        e.code='malformed';
        throw e;
      }
      const previous=adminEmail;
      if(previous&&previous.toLowerCase()!==confirmed.toLowerCase())resetAllCaches();
      csrfToken=token;
      adminEmail=confirmed;
      if(loginPassword)loginPassword.value='';
      if(sessionStatus){sessionStatus.textContent='';sessionStatus.hidden=true;}
      if(sessionRetry)sessionRetry.hidden=true;
      authGeneration++;
      showApp();
      render();
      await loadTab();
    }catch(err){
      if(gen!==authGeneration)return;
      if(loginError){
        if(err&&err.code==='LOGIN_FAILED')loginError.textContent='Invalid email or password.';
        else loginError.textContent=err&&err.message?err.message:'Sign in failed. Try again.';
        loginError.hidden=false;
      }
    }finally{
      loginInFlight=false;
      if(loginSubmit)loginSubmit.disabled=false;
    }
  });
  if(sessionRetry)sessionRetry.addEventListener('click',retrySession);
}

function navigateTo(key){
  const next=normalizeHash('#'+key);
  if(next===tab){
    if(location.hash!=='#'+next)location.hash='#'+next;
    return true;
  }
  if(!confirmBlogDiscard())return false;
  if(tab==='chat'&&typeof stopChatPolling==='function')try{stopChatPolling();}catch(_){}
  captureForms();
  if(typeof captureChatDraft==='function')try{captureChatDraft();}catch(_){}
  tab=next;
  if(location.hash!=='#'+next)location.hash='#'+next;
  render();
  loadTab();
  return true;
}

function bindHash(){
  window.addEventListener('hashchange',()=>{
    if(!app||app.hidden)return;
    const next=normalizeHash(location.hash);
    if(next===tab)return;
    if(!confirmBlogDiscard()){
      history.replaceState(null,'','#'+tab);
      return;
    }
    if(tab==='chat'&&typeof stopChatPolling==='function')try{stopChatPolling();}catch(_){}
    captureForms();
    if(typeof captureChatDraft==='function')try{captureChatDraft();}catch(_){}
    tab=next;
    render();
    loadTab();
  });
}

function bootstrap(){
  bindLogin();
  bindHash();
  bindActionDialog();
  window.addEventListener('beforeunload',warnBeforeUnload);
  showLogin('');
  if(sessionStatus){sessionStatus.textContent='Checking existing session…';sessionStatus.hidden=false;}
  if(sessionRetry)sessionRetry.hidden=true;
  startSession();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',bootstrap,{once:true});
}else{
  queueMicrotask(bootstrap);
}

/* ============================================================
   TRAFFIC CHUNK — public/admin.mjs
   Owns: trafficView(), loadTraffic(), bindTraffic(), resetTrafficState()
   Only traffic-prefixed helpers/globals.
   ============================================================ */

var trafficState = {
  data: null,
  loading: false,
  error: null,
  requestedDays: null,
  loadedDays: null,
  generatedAt: null,
  stale: false,
  inbox: null,
  inboxError: null,
  inboxLoading: false,
  seq: 0
};

function resetTrafficState() {
  trafficState.seq++;
  trafficState.data = null;
  trafficState.loading = false;
  trafficState.error = null;
  trafficState.requestedDays = null;
  trafficState.loadedDays = null;
  trafficState.generatedAt = null;
  trafficState.stale = false;
  trafficState.inbox = null;
  trafficState.inboxError = null;
  trafficState.inboxLoading = false;
}

function trafficFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function trafficNonNegInt(v) {
  var n = trafficFiniteNumber(v);
  if (n === null || n < 0) return null;
  return Math.floor(n);
}

function trafficClamp(n, lo, hi) {
  if (typeof n !== 'number' || !isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function trafficIsoDateOnly(s) {
  if (typeof s !== 'string') return null;
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

function trafficFormatGeneratedAt(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch (e) {
    return '';
  }
}

function trafficValidate(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Response was not an object.' };
  }
  var rangeDays = trafficNonNegInt(raw.rangeDays);
  if (rangeDays === null || (rangeDays !== 7 && rangeDays !== 30 && rangeDays !== 90)) {
    return { ok: false, reason: 'Missing or invalid rangeDays.' };
  }
  var totalViews = trafficNonNegInt(raw.totalViews);
  if (totalViews === null) {
    return { ok: false, reason: 'Missing or invalid totalViews.' };
  }
  var dailyVisitors = trafficNonNegInt(raw.dailyVisitors);
  if (dailyVisitors === null) {
    return { ok: false, reason: 'Missing or invalid dailyVisitors.' };
  }
  var activeNow = trafficNonNegInt(raw.activeNow);
  if (activeNow === null) {
    return { ok: false, reason: 'Missing or invalid activeNow.' };
  }
  if (!Array.isArray(raw.trend)) {
    return { ok: false, reason: 'Missing trend array.' };
  }
  if (!Array.isArray(raw.countries)) {
    return { ok: false, reason: 'Missing countries array.' };
  }
  if (!Array.isArray(raw.pages)) {
    return { ok: false, reason: 'Missing pages array.' };
  }
  if (!Array.isArray(raw.referrers)) {
    return { ok: false, reason: 'Missing referrers array.' };
  }
  if (!Array.isArray(raw.devices)) {
    return { ok: false, reason: 'Missing devices array.' };
  }
  if (!raw.geo || typeof raw.geo !== 'object') {
    return { ok: false, reason: 'Missing geo object.' };
  }
  var geoStatus = raw.geo.status;
  if (geoStatus !== 'ready' && geoStatus !== 'unavailable') {
    return { ok: false, reason: 'Invalid geo.status.' };
  }
  var unknownViews = trafficNonNegInt(raw.geo.unknownViews);
  if (unknownViews === null) {
    return { ok: false, reason: 'Missing geo.unknownViews.' };
  }

  var trend = [];
  for (var i = 0; i < raw.trend.length; i++) {
    var t = raw.trend[i];
    if (!t || typeof t !== 'object') {
      return { ok: false, reason: 'Malformed trend row.' };
    }
    var date = trafficIsoDateOnly(t.date);
    var views = trafficNonNegInt(t.views);
    var visitors = trafficNonNegInt(t.visitors);
    if (!date || views === null || visitors === null) {
      return { ok: false, reason: 'Malformed trend row values.' };
    }
    trend.push({ date: date, views: views, visitors: visitors });
  }

  var countries = [];
  for (var c = 0; c < raw.countries.length; c++) {
    var row = raw.countries[c];
    if (!row || typeof row !== 'object') {
      return { ok: false, reason: 'Malformed country row.' };
    }
    var code = typeof row.code === 'string' ? row.code.toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(code)) code = 'ZZ';
    var name = typeof row.name === 'string' && row.name ? row.name : (code === 'ZZ' ? 'Unknown' : code);
    var cviews = trafficNonNegInt(row.views);
    var cvisitors = trafficNonNegInt(row.visitors);
    if (cviews === null || cvisitors === null) {
      return { ok: false, reason: 'Malformed country counts.' };
    }
    countries.push({ code: code, name: name, views: cviews, visitors: cvisitors });
  }

  var pages = [];
  for (var p = 0; p < raw.pages.length; p++) {
    var pr = raw.pages[p];
    if (!pr || typeof pr !== 'object') {
      return { ok: false, reason: 'Malformed page row.' };
    }
    var path = typeof pr.path === 'string' ? pr.path : '';
    var pviews = trafficNonNegInt(pr.views);
    if (pviews === null) {
      return { ok: false, reason: 'Malformed page views.' };
    }
    pages.push({ path: path, views: pviews });
  }

  var referrers = [];
  for (var r = 0; r < raw.referrers.length; r++) {
    var rr = raw.referrers[r];
    if (!rr || typeof rr !== 'object') {
      return { ok: false, reason: 'Malformed referrer row.' };
    }
    var host = typeof rr.host === 'string' ? rr.host : '';
    var rviews = trafficNonNegInt(rr.views);
    if (rviews === null) {
      return { ok: false, reason: 'Malformed referrer views.' };
    }
    referrers.push({ host: host, views: rviews });
  }

  var devices = [];
  for (var d = 0; d < raw.devices.length; d++) {
    var dr = raw.devices[d];
    if (!dr || typeof dr !== 'object') {
      return { ok: false, reason: 'Malformed device row.' };
    }
    var dname = typeof dr.name === 'string' ? dr.name : '';
    var dviews = trafficNonNegInt(dr.views);
    if (dviews === null) {
      return { ok: false, reason: 'Malformed device views.' };
    }
    devices.push({ name: dname, views: dviews });
  }

  var collectionStartedAt = null;
  if (raw.collectionStartedAt !== null && raw.collectionStartedAt !== undefined) {
    if (typeof raw.collectionStartedAt !== 'string') {
      return { ok: false, reason: 'Invalid collectionStartedAt.' };
    }
    collectionStartedAt = raw.collectionStartedAt;
  }

  var retentionDays = trafficNonNegInt(raw.retentionDays);
  if (retentionDays === null) retentionDays = 90;

  var generatedAt = typeof raw.generatedAt === 'string' ? raw.generatedAt : null;

  return {
    ok: true,
    data: {
      rangeDays: rangeDays,
      generatedAt: generatedAt,
      totalViews: totalViews,
      dailyVisitors: dailyVisitors,
      activeNow: activeNow,
      countries: countries,
      trend: trend,
      pages: pages,
      referrers: referrers,
      devices: devices,
      collectionStartedAt: collectionStartedAt,
      geo: {
        status: geoStatus,
        source: typeof raw.geo.source === 'string' ? raw.geo.source : 'DB-IP Lite',
        unknownViews: unknownViews,
        notice: typeof raw.geo.notice === 'string' ? raw.geo.notice : ''
      },
      retentionDays: retentionDays
    }
  };
}

function trafficValidateInbox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var openCount = trafficNonNegInt(raw.openCount);
  var unreadCount = trafficNonNegInt(raw.unreadCount);
  var total = trafficNonNegInt(raw.total);
  if (openCount === null || unreadCount === null || total === null) return null;
  return { openCount: openCount, unreadCount: unreadCount, total: total };
}

function loadTraffic(opts) {
  opts = opts || {};
  var mySeq = ++trafficState.seq;
  var myGen = authGeneration;
  var requested = (typeof days === 'number' && (days === 7 || days === 30 || days === 90)) ? days : 30;

  trafficState.requestedDays = requested;
  trafficState.loading = true;
  trafficState.error = null;

  if (tab === 'overview' || tab === 'traffic') {
    if (!app.hidden) render();
  }

  var trafficPromise = api('/api/admin/traffic?days=' + requested, { method: 'GET' })
    .then(function (raw) {
      if (mySeq !== trafficState.seq || myGen !== authGeneration) return;
      var v = trafficValidate(raw);
      if (!v.ok) {
        trafficState.loading = false;
        trafficState.error = 'Traffic data could not be read: ' + v.reason;
        if (trafficState.data) {
          trafficState.stale = true;
        }
        return;
      }
      if (v.data.rangeDays !== requested) {
        trafficState.loading = false;
        trafficState.error = 'Traffic data could not be read: Response range did not match the requested range.';
        if (trafficState.data) {
          trafficState.stale = true;
        }
        return;
      }
      trafficState.data = v.data;
      trafficState.loadedDays = v.data.rangeDays;
      trafficState.generatedAt = v.data.generatedAt;
      trafficState.loading = false;
      trafficState.error = null;
      trafficState.stale = false;
    })
    .catch(function (err) {
      if (mySeq !== trafficState.seq || myGen !== authGeneration) return;
      trafficState.loading = false;
      trafficState.error = (err && err.message) ? err.message : 'Traffic request failed.';
      if (trafficState.data) {
        trafficState.stale = true;
      }
    });

  trafficState.inboxLoading = true;
  var inboxPromise = api('/api/admin/chat?status=all&offset=0&limit=1', { method: 'GET' })
    .then(function (raw) {
      if (mySeq !== trafficState.seq || myGen !== authGeneration) return;
      var v = trafficValidateInbox(raw);
      trafficState.inboxLoading = false;
      if (!v) {
        trafficState.inbox = null;
        trafficState.inboxError = 'Inbox workload unavailable.';
      } else {
        trafficState.inbox = v;
        trafficState.inboxError = null;
      }
    })
    .catch(function (err) {
      if (mySeq !== trafficState.seq || myGen !== authGeneration) return;
      trafficState.inboxLoading = false;
      trafficState.inbox = null;
      trafficState.inboxError = (err && err.message) ? err.message : 'Inbox workload unavailable.';
    });

  return Promise.all([trafficPromise, inboxPromise]).then(function () {});
}

function trafficSvgId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

function trafficBuildTrendSvg(data, viewKey) {
  var trend = data.trend;
  var W = 720, H = 220;
  var padL = 44, padR = 16, padT = 16, padB = 34;
  var innerW = W - padL - padR;
  var innerH = H - padT - padB;

  var maxViews = 0, maxVisitors = 0;
  for (var i = 0; i < trend.length; i++) {
    if (trend[i].views > maxViews) maxViews = trend[i].views;
    if (trend[i].visitors > maxVisitors) maxVisitors = trend[i].visitors;
  }
  var maxY = Math.max(maxViews, maxVisitors);
  var flatZero = maxY === 0;
  var yMax = flatZero ? 1 : maxY;

  var n = trend.length;
  function xAt(idx) {
    if (n <= 1) return padL + innerW / 2;
    return padL + (innerW * idx) / (n - 1);
  }
  function yAt(val) {
    var v = trafficClamp(val, 0, yMax);
    return padT + innerH - (innerH * v) / yMax;
  }

  var viewsPts = [];
  var visPts = [];
  for (var j = 0; j < n; j++) {
    viewsPts.push(xAt(j).toFixed(2) + ',' + yAt(trend[j].views).toFixed(2));
    visPts.push(xAt(j).toFixed(2) + ',' + yAt(trend[j].visitors).toFixed(2));
  }

  var firstDate = n ? trend[0].date : '';
  var lastDate = n ? trend[n - 1].date : '';
  var titleId = trafficSvgId('traffic-trend-title-' + viewKey);
  var descId = trafficSvgId('traffic-trend-desc-' + viewKey);

  var titleText = 'Traffic trend for the last ' + data.rangeDays + ' days';
  var descText = 'Line chart of page views and daily sessions from ' + firstDate + ' to ' + lastDate +
    '. Peak value ' + maxY + '. ' + (flatZero ? 'All values are zero.' : 'Y axis scaled to peak.');

  var gridLines = '';
  var gridSteps = 4;
  for (var g = 0; g <= gridSteps; g++) {
    var gy = padT + (innerH * g) / gridSteps;
    var gval = Math.round(yMax * (1 - g / gridSteps));
    gridLines += '<line x1="' + padL + '" y1="' + gy.toFixed(2) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(2) + '" class="traffic-grid-line" />';
    gridLines += '<text x="' + (padL - 6) + '" y="' + (gy + 3).toFixed(2) + '" class="traffic-axis-label" text-anchor="end">' + gval + '</text>';
  }

  var xLabels = '';
  if (n > 0) {
    xLabels += '<text x="' + xAt(0).toFixed(2) + '" y="' + (H - 10) + '" class="traffic-axis-label" text-anchor="start">' + esc(firstDate) + '</text>';
    if (n > 1) {
      xLabels += '<text x="' + xAt(n - 1).toFixed(2) + '" y="' + (H - 10) + '" class="traffic-axis-label" text-anchor="end">' + esc(lastDate) + '</text>';
    }
  }

  var svg = '';
  svg += '<svg class="traffic-trend-svg" role="img" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" aria-labelledby="' + titleId + ' ' + descId + '">';
  svg += '<title id="' + titleId + '">' + esc(titleText) + '</title>';
  svg += '<desc id="' + descId + '">' + esc(descText) + '</desc>';
  svg += gridLines;
  svg += xLabels;
  if (n > 0) {
    svg += '<polyline class="traffic-line traffic-line-views" fill="none" points="' + viewsPts.join(' ') + '" />';
    svg += '<polyline class="traffic-line traffic-line-visitors" fill="none" points="' + visPts.join(' ') + '" />';
  }
  svg += '</svg>';

  var legend = '<div class="traffic-legend">' +
    '<span class="traffic-legend-item"><span class="traffic-swatch traffic-swatch-views"></span>Page views</span>' +
    '<span class="traffic-legend-item"><span class="traffic-swatch traffic-swatch-visitors"></span>Daily sessions</span>' +
    '</div>';

  var tableRows = '';
  if (n === 0) {
    tableRows = '<tr><td colspan="3" class="traffic-empty-cell">No daily data recorded yet.</td></tr>';
  } else {
    for (var k = 0; k < n; k++) {
      tableRows += '<tr><th scope="row">' + esc(trend[k].date) + '</th><td>' + trend[k].views + '</td><td>' + trend[k].visitors + '</td></tr>';
    }
  }

  var table = '<details class="traffic-trend-details"><summary>View daily data</summary>' +
    '<table class="traffic-table traffic-trend-table">' +
    '<caption>Daily page views and daily sessions, UTC</caption>' +
    '<thead><tr><th scope="col">Date (UTC)</th><th scope="col">Page views</th><th scope="col">Daily sessions</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody>' +
    '</table></details>';

  return legend + svg + table;
}

function trafficCountryRows(data) {
  var rows = data.countries.slice();
  rows.sort(function (a, b) { return b.views - a.views; });
  return rows;
}

function trafficRenderCountryTable(data) {
  var rows = trafficCountryRows(data);
  var totalViews = data.totalViews;

  var geoNotice = '';
  if (data.geo.status !== 'ready') {
    geoNotice = '<p class="traffic-geo-notice">Country measurement unavailable. ' +
      (data.geo.notice ? esc(data.geo.notice) : 'Trusted geo lookup is not configured.') +
      ' Country accuracy cannot be claimed.</p>';
  } else if (data.geo.notice) {
    geoNotice = '<p class="traffic-geo-notice">' + esc(data.geo.notice) + '</p>';
  }

  var unknownNotice = '';
  if (data.geo.unknownViews > 0) {
    unknownNotice = '<p class="traffic-geo-notice">' + data.geo.unknownViews +
      ' view' + (data.geo.unknownViews === 1 ? '' : 's') +
      ' could not be attributed to a known country.</p>';
  }

  var body = '';
  if (rows.length === 0) {
    body = '<tr><td colspan="4" class="traffic-empty-cell">No country data recorded yet.</td></tr>';
  } else {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var pct = totalViews > 0 ? (row.views / totalViews) * 100 : 0;
      pct = trafficClamp(pct, 0, 100);
      var label = row.code === 'ZZ' ? 'Unknown' : row.name;
      body += '<tr>' +
        '<th scope="row"><span class="traffic-country-code">' + esc(row.code) + '</span> ' + esc(label) + '</th>' +
        '<td>' + row.views + '</td>' +
        '<td>' + row.visitors + '</td>' +
        '<td><span class="traffic-bar" aria-hidden="true"><span class="traffic-bar-fill" style="width:' + pct.toFixed(2) + '%"></span></span>' +
        '<span class="traffic-bar-percent">' + pct.toFixed(1) + '%</span></td>' +
        '</tr>';
    }
  }

  return geoNotice + unknownNotice +
    '<table class="traffic-table traffic-country-table">' +
    '<caption>Views and daily sessions by country</caption>' +
    '<thead><tr><th scope="col">Country</th><th scope="col">Views</th><th scope="col">Daily sessions</th><th scope="col">Share</th></tr></thead>' +
    '<tbody>' + body + '</tbody>' +
    '</table>';
}

function trafficRenderSimpleList(title, rows, nameKey, emptyText) {
  var body = '';
  if (!rows || rows.length === 0) {
    body = '<li class="traffic-list-empty">' + esc(emptyText) + '</li>';
  } else {
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i][nameKey];
      if (nameKey === 'host' && (!name || name === '')) name = 'Direct';
      if (nameKey === 'path' && (!name || name === '')) name = '(unknown)';
      if (nameKey === 'name' && (!name || name === '')) name = 'Unknown';
      body += '<li class="traffic-list-item"><span class="traffic-list-name">' + esc(String(name)) + '</span>' +
        '<span class="traffic-list-value">' + rows[i].views + '</span></li>';
    }
  }
  return '<div class="traffic-list-block"><h3 class="traffic-list-title">' + esc(title) + '</h3>' +
    '<ul class="traffic-list">' + body + '</ul></div>';
}

function trafficRenderInboxWorkload() {
  if (trafficState.inboxLoading && !trafficState.inbox) {
    return '<div class="traffic-inbox-workload"><h3>Visitor inbox</h3><p class="traffic-muted">Loading workload…</p></div>';
  }
  if (trafficState.inboxError || !trafficState.inbox) {
    return '<div class="traffic-inbox-workload"><h3>Visitor inbox</h3>' +
      '<p class="traffic-muted">Inbox workload unavailable.</p>' +
      '<button type="button" class="btn btn-ghost" data-traffic-retry>Retry</button></div>';
  }
  var inbox = trafficState.inbox;
  return '<div class="traffic-inbox-workload"><h3>Visitor inbox</h3>' +
    '<div class="traffic-inbox-metrics">' +
    '<div class="traffic-inbox-metric"><span class="traffic-inbox-value">' + inbox.openCount + '</span><span class="traffic-inbox-label">Open threads</span></div>' +
    '<div class="traffic-inbox-metric"><span class="traffic-inbox-value">' + inbox.unreadCount + '</span><span class="traffic-inbox-label">Unread messages</span></div>' +
    '</div>' +
    '<button type="button" class="btn btn-primary" data-tab="chat">Open visitor inbox</button>' +
    '</div>';
}

function trafficRenderKpis(data) {
  var measuredSet = {};
  for (var i = 0; i < data.countries.length; i++) {
    var c = data.countries[i];
    if (c.code !== 'ZZ' && c.views > 0) measuredSet[c.code] = true;
  }
  var countriesMeasured = Object.keys(measuredSet).length;
  var countriesValue = data.geo.status === 'ready' ? String(countriesMeasured) : '\u2014';
  var countriesSub = data.geo.status === 'ready'
    ? 'Countries with recorded views'
    : 'Country measurement unavailable';
  var cards = '';
  cards += '<div class="card kpi-card">' +
    '<div class="kpi-label">Page views</div>' +
    '<div class="kpi-value">' + data.totalViews + '</div>' +
    '<div class="kpi-sub">Total views in the last ' + data.rangeDays + ' days</div>' +
    '</div>';
  cards += '<div class="card kpi-card">' +
    '<div class="kpi-label">Daily sessions</div>' +
    '<div class="kpi-value">' + data.dailyVisitors + '</div>' +
    '<div class="kpi-sub">Sum of unique daily sessions, not cross-day people</div>' +
    '</div>';
  cards += '<div class="card kpi-card">' +
    '<div class="kpi-label">Active now</div>' +
    '<div class="kpi-value">' + data.activeNow + '</div>' +
    '<div class="kpi-sub">Sessions with page events in the last 5 minutes — not online presence</div>' +
    '</div>';
  cards += '<div class="card kpi-card">' +
    '<div class="kpi-label">Countries measured</div>' +
    '<div class="kpi-value">' + countriesValue + '</div>' +
    '<div class="kpi-sub">' + esc(countriesSub) + '</div>' +
    '</div>';
  return '<div class="grid grid-kpi">' + cards + '</div>';
}

function trafficRenderStaleBanner() {
  if (!trafficState.stale) return '';
  var range = trafficState.loadedDays ? trafficState.loadedDays + ' days' : 'a previous range';
  var updated = trafficState.generatedAt ? trafficFormatGeneratedAt(trafficState.generatedAt) : '';
  var msg = 'Showing last successful data for ' + range + '.';
  if (updated) msg += ' Last updated ' + updated + '.';
  msg += ' The latest refresh failed.';
  return '<div class="traffic-stale-banner" role="status">' + esc(msg) + '</div>';
}

function trafficRenderError() {
  if (!trafficState.error) return '';
  var prefix = trafficState.data ? 'Refresh failed. ' : '';
  return '<div class="traffic-error" role="alert">' +
    '<p>' + esc(prefix + trafficState.error) + '</p>' +
    '<button type="button" class="btn btn-primary" data-traffic-retry>Retry</button>' +
    '</div>';
}

function trafficRenderLoading() {
  return '<div class="traffic-loading" role="status" aria-live="polite">Loading traffic data…</div>';
}

function trafficRenderEmpty() {
  return '<div class="traffic-empty">' +
    '<p>No page views recorded for this period yet.</p>' +
    '<p class="traffic-muted">Collection begins once the analytics endpoint receives its first event.</p>' +
    '</div>';
}

function trafficRenderCollectionNote(data) {
  var parts = [];
  if (data.collectionStartedAt) {
    parts.push('Collection started ' + esc(trafficFormatGeneratedAt(data.collectionStartedAt)) + '.');
  } else {
    parts.push('No collection has started yet.');
  }
  parts.push('Data is retained for ' + data.retentionDays + ' days.');
  return '<p class="traffic-collection-note">' + parts.join(' ') + '</p>';
}

function trafficRenderGeoAttribution(data) {
  var status = data.geo.status === 'ready' ? 'ready' : 'unavailable';
  var provider = data.geo.status === 'ready'
    ? 'Country data provider: <a href="https://db-ip.com" rel="noopener noreferrer" target="_blank">DB-IP Lite</a> (configured).'
    : 'Country data provider: DB-IP Lite (when configured).';
  var unknown = data.geo.unknownViews > 0
    ? ' ' + data.geo.unknownViews + ' view' + (data.geo.unknownViews === 1 ? '' : 's') + ' could not be attributed to a country.'
    : '';
  return '<p class="traffic-geo-attribution">Geo status: ' + esc(status) + '. ' +
    provider + unknown +
    ' Country is derived from a trusted proxy header; no visitor IP is sent to a third-party geolocation API.</p>';
}

function trafficRenderPrivacyNote() {
  return '<p class="traffic-privacy-note">Analytics uses first-party session identifiers only. ' +
    'No cookies, IP addresses, or device fingerprints are stored for traffic measurement. ' +
    'Device and country signals are approximate.</p>';
}

function trafficRenderData(data, viewKey) {
  var html = '';
  html += trafficRenderStaleBanner();
  html += trafficRenderKpis(data);
  html += '<div class="grid grid-traffic-main">';
  html += '<div class="panel traffic-trend-panel">' +
    '<h2 class="panel-title">Trend</h2>' +
    trafficBuildTrendSvg(data, viewKey) +
    '</div>';
  html += '<div class="panel traffic-country-panel">' +
    '<h2 class="panel-title">Countries</h2>' +
    trafficRenderCountryTable(data) +
    '</div>';
  html += '</div>';
  html += '<div class="grid grid-traffic-lists">';
  html += '<div class="panel">' + trafficRenderSimpleList('Top pages', data.pages, 'path', 'No page data recorded yet.') + '</div>';
  html += '<div class="panel">' + trafficRenderSimpleList('Referrers', data.referrers, 'host', 'No referrer data recorded yet.') + '</div>';
  html += '<div class="panel">' + trafficRenderSimpleList('Devices', data.devices, 'name', 'No device data recorded yet.') + '</div>';
  html += '</div>';
  html += '<div class="panel traffic-inbox-panel">' + trafficRenderInboxWorkload() + '</div>';
  html += trafficRenderCollectionNote(data);
  html += trafficRenderGeoAttribution(data);
  html += trafficRenderPrivacyNote();
  return html;
}

function trafficRenderToolbar() {
  var current = trafficState.requestedDays || (typeof days === 'number' ? days : 30);
  function opt(v) {
    return '<option value="' + v + '"' + (current === v ? ' selected' : '') + '>' + v + ' days</option>';
  }
  var generated = trafficState.generatedAt ? trafficFormatGeneratedAt(trafficState.generatedAt) : '';
  var refresh = generated ? '<span class="traffic-generated">Last refresh: ' + esc(generated) + '</span>' : '';
  return '<div class="toolbar traffic-toolbar">' +
    '<label class="traffic-range-label" for="range">Range</label>' +
    '<select id="range" class="traffic-range-select">' + opt(7) + opt(30) + opt(90) + '</select>' +
    '<button type="button" class="btn btn-ghost" data-traffic-retry>Refresh</button>' +
    refresh +
    '</div>';
}

function trafficView() {
  var viewKey = tab === 'traffic' ? 'traffic' : 'overview';
  var html = '';

  if (viewKey === 'overview') {
    html += '<section class="traffic-hero traffic-hero-overview">' +
      '<h1>A clearer view of your visitors.</h1>' +
      '<p>Real first-party engagement measured on this site, separate from the sandbox marketplace data.</p>' +
      '</section>';
    html += '<div class="traffic-quick-actions">' +
      '<button type="button" class="btn btn-primary" data-tab="chat">Open visitor inbox</button>' +
      '<button type="button" class="btn btn-ghost" data-tab="traffic">Traffic details</button>' +
      '<button type="button" class="btn btn-ghost" data-tab="reports">Sandbox review queue</button>' +
      '</div>';
  } else {
    html += '<section class="traffic-hero traffic-hero-details">' +
      '<h2>Traffic details</h2>' +
      '<p>First-party page views, daily sessions, and country signals.</p>' +
      '</section>';
  }

  html += trafficRenderToolbar();

  if (trafficState.loading && !trafficState.data) {
    html += trafficRenderLoading();
  } else if (trafficState.error && !trafficState.data) {
    html += trafficRenderError();
  } else if (!trafficState.data) {
    html += trafficRenderLoading();
  } else {
    html += trafficRenderError();
    html += trafficRenderData(trafficState.data, viewKey);
  }

  return html;
}

function bindTraffic() {
  var rangeEl = document.getElementById('range');
  if (rangeEl && !rangeEl.__trafficBound) {
    rangeEl.__trafficBound = true;
    rangeEl.addEventListener('change', function () {
      var v = parseInt(rangeEl.value, 10);
      if (v === 7 || v === 30 || v === 90) {
        days = v;
        loadTab();
      }
    });
  }

  var retries = document.querySelectorAll('[data-traffic-retry]');
  for (var i = 0; i < retries.length; i++) {
    var btn = retries[i];
    if (btn.__trafficBound) continue;
    btn.__trafficBound = true;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      loadTab();
    });
  }
}

/* chat.raw — admin chat tab implementation
   Depends on core globals: app, tab, authGeneration, adminEmail,
   api(path,{method,body:OBJECT}), esc, fmtDate, icon
   No imports. No own render(). No window APIs beyond standard browser. */

/* ---------- module state ---------- */

const chatState = {
  query: '',
  filter: 'all',
  offset: 0,
  total: 0,
  counts: { unreadCount: 0, openCount: 0 },
  listReady: false,
  listLoading: false,
  listError: '',
  listRevision: 0,
  pollTimer: null,
  listPromise: null,
  listPromiseKey: '',
  visibilityBound: false
};

let chatSelectedId = null;
let chatThreadsCache = new Map();
let chatGlobalGeneration = 0;
let chatAuthGeneration = 0;

const CHAT_PAGE_LIMIT = 40;
const CHAT_POLL_MS = 8000;
const CHAT_MAX_BODY = 2000;

/* ---------- small helpers ---------- */

function chatGen() { return chatGlobalGeneration + ':' + chatAuthGeneration; }

function chatEntry(id) {
  const key = String(id);
  let e = chatThreadsCache.get(key);
  if (!e) {
    e = {
      conversation: null,
      messages: [],
      draft: '',
      pending: null,
      sending: false,
      sendError: '',
      readError: '',
      statusError: '',
      statusBusy: false,
      loading: false,
      loadError: '',
      lastRead: 0,
      readBusy: false,
      requestRevision: 0,
      detailReady: false
    };
    chatThreadsCache.set(key, e);
  }
  return e;
}

function chatSafeId(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v);
  if (typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v)) return v;
  return null;
}

function chatIsInt(v) {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function chatIsDateISO(v) {
  return typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));
}

function chatValidThread(t) {
  if (!t || typeof t !== 'object') return null;
  const id = chatSafeId(t.id);
  if (!id) return null;
  if (t.status !== 'open' && t.status !== 'closed') return null;
  if (!chatIsInt(t.unreadCount) || !chatIsInt(t.messageCount)) return null;
  if (!chatIsDateISO(t.createdAt) || !chatIsDateISO(t.updatedAt)) return null;
  return {
    id,
    displayName: typeof t.displayName === 'string' ? t.displayName : '',
    contactEmail: typeof t.contactEmail === 'string' ? t.contactEmail : '',
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastMessage: typeof t.lastMessage === 'string' ? t.lastMessage : '',
    unreadCount: t.unreadCount,
    messageCount: t.messageCount
  };
}

function chatValidMessage(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.id !== 'number' || !Number.isFinite(m.id) || !Number.isInteger(m.id) || m.id <= 0) return null;
  if (m.sender !== 'visitor' && m.sender !== 'admin') return null;
  if (typeof m.body !== 'string') return null;
  if (!chatIsDateISO(m.createdAt)) return null;
  if (typeof m.clientId !== 'string' || m.clientId.length === 0) return null;
  return {
    id: m.id,
    sender: m.sender,
    body: m.body,
    createdAt: m.createdAt,
    clientId: m.clientId
  };
}

function chatMergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const arr = Array.from(byId.values());
  arr.sort((a, b) => a.id - b.id);
  return arr.slice(-200);
}

function chatUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = [];
      for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
        '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
    }
  } catch (_) { /* fallthrough */ }
  return null;
}

function chatEl(id) {
  return app ? app.querySelector('#' + id) : null;
}

function chatShow(el, show) {
  if (!el) return;
  if (show) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

function chatSetText(el, text) {
  if (!el) return;
  el.textContent = text == null ? '' : String(text);
}

/* ---------- static skeleton ---------- */

function chatView() {
  return `
<div class="chat-view">
  <div class="chat-layout">
    <section class="chat-pane chat-pane-list" aria-label="Conversations">
      <div class="chat-list-controls">
        <label class="chat-field">
          <span class="chat-field-label">Search</span>
          <input id="chat-search" type="search" autocomplete="off" placeholder="Search name or message" />
        </label>
        <label class="chat-field">
          <span class="chat-field-label">Status</span>
          <select id="chat-filter">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <p id="chat-list-meta" class="chat-list-meta">
        <span id="chat-unread-count" class="chat-unread-badge" aria-live="polite">-</span>
        <span id="chat-list-summary">Loading…</span>
      </p>
      <div id="chat-list-error" class="chat-error" hidden>
        <span id="chat-list-error-text"></span>
        <button type="button" id="chat-list-retry" class="chat-btn">Retry</button>
      </div>
      <ul id="chat-thread-list" class="chat-thread-list" aria-label="Threads"></ul>
      <div class="chat-pager">
        <button type="button" id="chat-prev" class="chat-btn" disabled>Previous</button>
        <span id="chat-pager-summary" class="chat-pager-summary">-</span>
        <button type="button" id="chat-next" class="chat-btn" disabled>Next</button>
      </div>
    </section>

    <section class="chat-pane chat-pane-thread" aria-label="Conversation">
      <header id="chat-conversation-header" class="chat-conversation-header">
        <h2 id="chat-conversation-title" class="chat-conversation-title">Select a conversation</h2>
        <div class="chat-conversation-actions">
          <span id="chat-conversation-status" class="chat-status-pill" hidden></span>
          <button type="button" id="chat-status-toggle" class="chat-btn" hidden disabled>Close</button>
        </div>
      </header>

      <div id="chat-thread-error" class="chat-error" hidden>
        <span id="chat-thread-error-text"></span>
        <button type="button" id="chat-thread-retry" class="chat-btn">Retry</button>
      </div>

      <div id="chat-transcript" class="chat-transcript" tabindex="0" aria-live="off" aria-label="Message transcript"></div>
      <div id="chat-announcer" class="chat-announcer" role="status" aria-live="polite"></div>

      <div id="chat-read-error" class="chat-error" hidden>
        <span id="chat-read-error-text"></span>
        <button type="button" id="chat-read-retry" class="chat-btn">Retry read</button>
      </div>

      <div id="chat-status-error" class="chat-error" hidden>
        <span id="chat-status-error-text"></span>
      </div>

      <div id="chat-send-error" class="chat-error" role="alert" hidden>
        <span id="chat-send-error-text"></span>
      </div>

      <form id="chat-reply-form" class="chat-reply-form" novalidate>
        <label for="chat-draft" class="chat-field-label">Reply</label>
        <textarea id="chat-draft" class="chat-draft" maxlength="2000" rows="3" placeholder="Type a reply…" disabled></textarea>
        <div class="chat-reply-actions">
          <button type="submit" id="chat-send" class="chat-btn chat-btn-primary">Send</button>
          <button type="button" id="chat-retry-send" class="chat-btn" hidden>Retry send</button>
        </div>
      </form>

      <p class="chat-note">
        Messages are handled by the support team. No automated or instant reply is promised.
        <a href="#support" data-tab="support">Sandbox support</a>
      </p>
    </section>
  </div>
</div>`;
}

/* ---------- list loading ---------- */

function chatListKey() {
  return chatState.filter + '|' + chatState.query + '|' + chatState.offset + '|' + chatGen();
}

async function loadChat({ silent = false } = {}) {
  const gen = chatGen();
  const key = chatListKey();
  if (chatState.listPromise && chatState.listPromiseKey === key) {
    return chatState.listPromise;
  }
  const rev = ++chatState.listRevision;
  chatState.listLoading = true;
  if (!silent) chatPatchList();

  const params = new URLSearchParams();
  params.set('status', chatState.filter);
  if (chatState.query) params.set('q', chatState.query);
  params.set('offset', String(chatState.offset));
  params.set('limit', String(CHAT_PAGE_LIMIT));

  const p = (async () => {
    try {
      const data = await api('/api/admin/chat?' + params.toString(), { method: 'GET' });
      if (gen !== chatGen() || rev !== chatState.listRevision) return;
      if (!data || typeof data !== 'object' || !Array.isArray(data.threads)) {
        throw new Error('Malformed list response');
      }
      const threads = [];
      for (const t of data.threads) {
        const v = chatValidThread(t);
        if (!v) throw new Error('Malformed thread in list');
        threads.push(v);
      }
      if (!chatIsInt(data.total) || !chatIsInt(data.unreadCount) || !chatIsInt(data.openCount) ||
          !chatIsInt(data.offset) || !chatIsInt(data.limit)) {
        throw new Error('Malformed list counters');
      }
      if (data.limit !== CHAT_PAGE_LIMIT || data.offset !== chatState.offset) {
        throw new Error('List pagination mismatch');
      }
      chatState.total = data.total;
      chatState.counts.unreadCount = data.unreadCount;
      chatState.counts.openCount = data.openCount;
      chatState.offset = data.offset;
      chatState.listReady = true;
      chatState.listError = '';
      chatState.listThreads = threads;

      for (const t of threads) {
        const e = chatEntry(t.id);
        if (!e.conversation) {
          e.conversation = t;
        } else {
          const prev = e.conversation;
          const prevTs = prev.updatedAt ? Date.parse(prev.updatedAt) : 0;
          const nextTs = t.updatedAt ? Date.parse(t.updatedAt) : 0;
          if (nextTs >= prevTs) {
            e.conversation = Object.assign({}, prev, t);
          } else {
            e.conversation = Object.assign({}, t, {
              status: prev.status,
              updatedAt: prev.updatedAt,
              lastMessage: prev.lastMessage,
              unreadCount: prev.unreadCount,
              messageCount: prev.messageCount
            });
          }
        }
      }

      if (chatSelectedId == null && threads.length > 0) {
        chatSelectThread(threads[0].id, { initial: true });
      }
    } catch (err) {
      if (gen !== chatGen() || rev !== chatState.listRevision) return;
      chatState.listError = (err && err.message) ? err.message : 'Failed to load conversations';
    } finally {
      if (gen === chatGen() && rev === chatState.listRevision) {
        chatState.listLoading = false;
        chatPatchList();
      }
    }
  })();

  chatState.listPromise = p;
  chatState.listPromiseKey = key;
  p.finally(() => {
    if (chatState.listPromise === p) {
      chatState.listPromise = null;
      chatState.listPromiseKey = '';
    }
  });
  return p;
}

/* ---------- thread loading ---------- */

async function chatLoadThread(id, { silent = false } = {}) {
  const sid = chatSafeId(id);
  if (!sid) return;
  const e = chatEntry(sid);
  if (e.loading || e.sending || e.statusBusy) return;
  const gen = chatGen();
  const rev = ++e.requestRevision;
  e.loading = true;
  if (!silent) chatPatchThread();

  try {
    const data = await api('/api/admin/chat/' + encodeURIComponent(sid), { method: 'GET' });
    if (gen !== chatGen() || rev !== e.requestRevision) return;
    if (!data || typeof data !== 'object') throw new Error('Malformed thread response');
    const conv = chatValidThread(data.conversation);
    if (!conv || conv.id !== sid) throw new Error('Thread id mismatch');
    if (!Array.isArray(data.messages)) throw new Error('Missing messages');
    const msgs = [];
    for (const m of data.messages) {
      const v = chatValidMessage(m);
      if (!v) throw new Error('Malformed message');
      msgs.push(v);
    }

    const prevConv = e.conversation;
    if (prevConv && prevConv.updatedAt && conv.updatedAt &&
        Date.parse(conv.updatedAt) < Date.parse(prevConv.updatedAt)) {
      conv.status = prevConv.status;
      conv.updatedAt = prevConv.updatedAt;
      conv.lastMessage = prevConv.lastMessage;
      conv.unreadCount = prevConv.unreadCount;
      conv.messageCount = prevConv.messageCount;
    }
    e.conversation = conv;
    e.messages = chatMergeMessages(e.messages, msgs);
    e.loadError = '';
    e.detailReady = true;
    e.loading = false;

    if (e.pending) {
      const p = e.pending;
      const ack = msgs.find(m => m.sender === 'admin' && m.clientId === p.clientId && m.body === p.body);
      if (ack) {
        e.pending = null;
        e.sendError = '';
        if (e.draft === p.body) e.draft = '';
        const ta = chatEl('chat-draft');
        if (ta && ta.dataset.threadId === sid && ta.value === p.body) ta.value = '';
      }
    }

    chatPatchList();
    chatPatchThread();
  } catch (err) {
    if (gen !== chatGen() || rev !== e.requestRevision) return;
    e.loading = false;
    e.loadError = (err && err.message) ? err.message : 'Failed to load conversation';
    chatPatchThread();
  }
}

/* ---------- selection ---------- */

function chatSelectThread(id, { initial = false } = {}) {
  const sid = chatSafeId(id);
  if (!sid) return;
  if (chatSelectedId === sid) return;

  /* capture old draft */
  if (chatSelectedId != null) {
    const old = chatEntry(chatSelectedId);
    if (!old.pending) {
      const ta = chatEl('chat-draft');
      if (ta && ta.dataset.threadId === chatSelectedId) {
        old.draft = ta.value;
      }
    }
  }

  chatSelectedId = sid;
  const e = chatEntry(sid);
  chatPatchList();
  chatPatchThread();
  if (!e.detailReady) {
    chatLoadThread(sid);
  } else if (!initial) {
    chatLoadThread(sid, { silent: true });
  }
}

/* ---------- patch: list ---------- */

function chatPatchList() {
  const listEl = chatEl('chat-thread-list');
  if (!listEl) return;

  const unreadEl = chatEl('chat-unread-count');
  if (unreadEl) {
    if (chatState.listReady) chatSetText(unreadEl, String(chatState.counts.unreadCount));
    else chatSetText(unreadEl, '-');
  }

  const summaryEl = chatEl('chat-list-summary');
  if (summaryEl) {
    if (!chatState.listReady) chatSetText(summaryEl, 'Loading…');
    else if (chatState.listError) chatSetText(summaryEl, 'Error');
    else {
      const from = chatState.total === 0 ? 0 : chatState.offset + 1;
      const to = Math.min(chatState.offset + CHAT_PAGE_LIMIT, chatState.total);
      chatSetText(summaryEl, from + '–' + to + ' of ' + chatState.total);
    }
  }

  const errEl = chatEl('chat-list-error');
  const errText = chatEl('chat-list-error-text');
  if (chatState.listError) {
    chatShow(errEl, true);
    chatSetText(errText, chatState.listError);
  } else {
    chatShow(errEl, false);
  }

  const prev = chatEl('chat-prev');
  const next = chatEl('chat-next');
  const pagerSummary = chatEl('chat-pager-summary');
  if (prev) prev.disabled = chatState.offset <= 0 || chatState.listLoading;
  if (next) next.disabled = (chatState.offset + CHAT_PAGE_LIMIT) >= chatState.total || chatState.listLoading;
  if (pagerSummary) {
    const page = Math.floor(chatState.offset / CHAT_PAGE_LIMIT) + 1;
    const pages = Math.max(1, Math.ceil(chatState.total / CHAT_PAGE_LIMIT));
    chatSetText(pagerSummary, 'Page ' + page + ' / ' + pages);
  }

  const focused = document.activeElement;
  let focusedId = null;
  if (focused && listEl.contains(focused) && focused.matches && focused.matches('.chat-thread-btn') && focused.dataset && focused.dataset.threadId) {
    focusedId = focused.dataset.threadId;
  }

  const threads = chatState.listThreads || [];
  const frag = document.createDocumentFragment();
  for (const t of threads) {
    const li = document.createElement('li');
    li.className = 'chat-thread-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-thread-btn';
    btn.dataset.threadId = t.id;
    if (t.id === chatSelectedId) btn.classList.add('is-selected');
    btn.setAttribute('aria-pressed', t.id === chatSelectedId ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'chat-thread-name';
    name.textContent = t.displayName || 'Visitor';
    btn.appendChild(name);

    const preview = document.createElement('span');
    preview.className = 'chat-thread-preview';
    preview.textContent = t.lastMessage || '';
    btn.appendChild(preview);

    const meta = document.createElement('span');
    meta.className = 'chat-thread-meta';
    meta.textContent = (t.contactEmail ? t.contactEmail + ' · ' : '') + (t.status === 'closed' ? 'Closed · ' : '') + fmtDate(t.updatedAt);
    btn.appendChild(meta);

    if (t.unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'chat-thread-unread';
      badge.textContent = String(t.unreadCount);
      btn.appendChild(badge);
    }

    li.appendChild(btn);
    frag.appendChild(li);
  }
  listEl.textContent = '';
  if (threads.length === 0 && chatState.listReady && !chatState.listError) {
    const empty = document.createElement('li');
    empty.className = 'chat-thread-empty';
    empty.textContent = chatState.query ? 'No results' : 'No conversations';
    listEl.appendChild(empty);
  } else {
    listEl.appendChild(frag);
  }

  if (focusedId) {
    const again = listEl.querySelector('[data-thread-id="' + CSS.escape(focusedId) + '"]');
    if (again && document.activeElement !== again) {
      if (!listEl.contains(document.activeElement)) again.focus();
    }
  }
}

/* ---------- patch: thread ---------- */

function chatPatchThread() {
  const sid = chatSelectedId;
  const e = sid ? chatEntry(sid) : null;

  const titleEl = chatEl('chat-conversation-title');
  const statusPill = chatEl('chat-conversation-status');
  const statusToggle = chatEl('chat-status-toggle');

  if (!e || !e.conversation) {
    chatSetText(titleEl, 'Select a conversation');
    chatShow(statusPill, false);
    chatShow(statusToggle, false);
  } else {
    chatSetText(titleEl, (e.conversation.displayName || 'Visitor') + (e.conversation.contactEmail ? ' · ' + e.conversation.contactEmail : ''));
    chatShow(statusPill, true);
    chatSetText(statusPill, e.conversation.status === 'open' ? 'Open' : 'Closed');
    statusPill.dataset.status = e.conversation.status;
    chatShow(statusToggle, true);
    statusToggle.disabled = e.statusBusy;
    chatSetText(statusToggle, e.conversation.status === 'open' ? 'Close' : 'Reopen');
  }

  const errEl = chatEl('chat-thread-error');
  const errText = chatEl('chat-thread-error-text');
  if (e && e.loadError) {
    chatShow(errEl, true);
    chatSetText(errText, e.loadError);
  } else {
    chatShow(errEl, false);
  }

  const readErr = chatEl('chat-read-error');
  const readErrText = chatEl('chat-read-error-text');
  if (e && e.readError) {
    chatShow(readErr, true);
    chatSetText(readErrText, e.readError);
  } else {
    chatShow(readErr, false);
  }

  const statusErr = chatEl('chat-status-error');
  const statusErrText = chatEl('chat-status-error-text');
  if (e && e.statusError) {
    chatShow(statusErr, true);
    chatSetText(statusErrText, e.statusError);
  } else {
    chatShow(statusErr, false);
  }

  const sendErr = chatEl('chat-send-error');
  const sendErrText = chatEl('chat-send-error-text');
  if (e && e.sendError) {
    chatShow(sendErr, true);
    chatSetText(sendErrText, e.sendError);
  } else {
    chatShow(sendErr, false);
  }

  const draft = chatEl('chat-draft');
  const sendBtn = chatEl('chat-send');
  const retryBtn = chatEl('chat-retry-send');

  const detailOk = !!(e && e.detailReady && !e.loadError);

  if (draft) {
    if (!e || !detailOk) {
      draft.value = '';
      draft.dataset.threadId = '';
      draft.disabled = true;
      draft.readOnly = false;
    } else {
      draft.dataset.threadId = sid;
      if (e.pending) {
        draft.value = e.pending.body;
        draft.readOnly = true;
        draft.disabled = false;
      } else {
        draft.readOnly = false;
        draft.disabled = false;
        if (draft.value !== e.draft) draft.value = e.draft;
      }
    }
  }

  if (sendBtn) {
    sendBtn.disabled = !detailOk || !!e.pending || e.sending || !sid;
  }
  if (retryBtn) {
    const showRetry = !!(detailOk && e.pending && !e.sending);
    chatShow(retryBtn, showRetry);
    retryBtn.disabled = !showRetry;
  }

  chatPatchTranscript();
}

/* ---------- patch: transcript ---------- */

function chatPatchTranscript() {
  const el = chatEl('chat-transcript');
  if (!el) return;
  const sid = chatSelectedId;
  const e = sid ? chatEntry(sid) : null;

  if (!e || !e.conversation) {
    el.textContent = '';
    el.dataset.signature = '';
    el.dataset.threadId = '';
    el.dataset.maxVisitorId = '0';
    if (sid && e && e.loadError) {
      const err = document.createElement('div');
      err.className = 'chat-transcript-empty chat-transcript-error';
      err.textContent = 'Unable to load conversation.';
      el.appendChild(err);
    } else if (sid && e && e.loading) {
      const ld = document.createElement('div');
      ld.className = 'chat-transcript-empty';
      ld.textContent = 'Loading messages…';
      el.appendChild(ld);
    } else if (!sid) {
      const sel = document.createElement('div');
      sel.className = 'chat-transcript-empty';
      sel.textContent = 'Select a conversation';
      el.appendChild(sel);
    }
    return;
  }

  if (e.messages.length === 0) {
    el.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'chat-transcript-empty';
    empty.textContent = 'No messages yet';
    el.appendChild(empty);
    el.dataset.signature = sid + ':empty';
    el.dataset.threadId = sid;
    el.dataset.maxVisitorId = '0';
    return;
  }

  const msgs = e.messages;
  const sig = sid + ':' + msgs.map(m => m.id).join(',');
  if (el.dataset.signature === sig && el.dataset.threadId === sid) {
    /* still ensure maxVisitorId dataset */
    let maxV = 0;
    for (const m of msgs) if (m.sender === 'visitor' && m.id > maxV) maxV = m.id;
    el.dataset.maxVisitorId = String(maxV);
    return;
  }

  const prevScrollTop = el.scrollTop;
  const prevScrollHeight = el.scrollHeight;
  const prevClientHeight = el.clientHeight;
  const wasNearBottom = (prevScrollHeight - prevScrollTop - prevClientHeight) < 40;
  const isNewSelection = el.dataset.threadId !== sid;

  const frag = document.createDocumentFragment();
  let maxVisitorId = 0;
  for (const m of msgs) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg-' + m.sender;
    row.dataset.messageId = String(m.id);
    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';
    meta.textContent = (m.sender === 'admin' ? 'Support' : 'Visitor') + ' · ' + fmtDate(m.createdAt);
    const body = document.createElement('div');
    body.className = 'chat-msg-body';
    body.textContent = m.body;
    row.appendChild(meta);
    row.appendChild(body);
    frag.appendChild(row);
    if (m.sender === 'visitor' && m.id > maxVisitorId) maxVisitorId = m.id;
  }

  el.textContent = '';
  el.appendChild(frag);
  el.dataset.signature = sig;
  el.dataset.threadId = sid;
  el.dataset.maxVisitorId = String(maxVisitorId);

  if (isNewSelection || wasNearBottom || e.forceScrollBottom) {
    el.scrollTop = el.scrollHeight;
    e.forceScrollBottom = false;
  } else {
    el.scrollTop = prevScrollTop;
  }

  const ann = chatEl('chat-announcer');
  if (ann) chatSetText(ann, msgs.length + ' messages');

  chatMaybeMarkRead();
}

/* ---------- read ---------- */

function chatMaybeMarkRead() {
  const sid = chatSelectedId;
  if (!sid) return;
  const e = chatEntry(sid);
  if (!e.conversation) return;
  if (e.readBusy) return;
  if (e.readError) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (typeof app !== 'undefined' && app && app.hidden) return;
  if (typeof tab !== 'undefined' && tab !== 'chat') return;

  const el = chatEl('chat-transcript');
  if (!el) return;
  if (el.dataset.threadId !== sid) return;

  const maxV = parseInt(el.dataset.maxVisitorId || '0', 10);
  if (!maxV || maxV <= e.lastRead) return;

  const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
  if (!nearBottom) return;

  chatMarkRead(sid, maxV);
}

async function chatMarkRead(id, throughId) {
  const sid = chatSafeId(id);
  if (!sid) return;
  const e = chatEntry(sid);
  if (e.readBusy) return;
  const gen = chatGen();
  e.readBusy = true;
  e.readError = '';
  chatPatchThread();
  try {
    const res = await api('/api/admin/chat/' + encodeURIComponent(sid) + '/read', {
      method: 'POST',
      body: { throughId }
    });
    if (gen !== chatGen()) return;
    if (!res || res.ok !== true) throw new Error('Read not confirmed');
    if (throughId > e.lastRead) e.lastRead = throughId;
    e.readError = '';
  } catch (err) {
    if (gen !== chatGen()) return;
    e.readError = (err && err.message) ? err.message : 'Failed to mark read';
  } finally {
    if (gen === chatGen()) {
      e.readBusy = false;
      chatPatchThread();
    }
  }
}

/* ---------- send ---------- */

async function chatSend(id, body, clientId) {
  const sid = chatSafeId(id);
  if (!sid) return;
  const e = chatEntry(sid);
  if (e.sending) return;
  const gen = chatGen();
  const attempt = { body, clientId };
  e.sending = true;
  e.sendError = '';
  e.requestRevision++;
  e.loading = false;
  chatPatchThread();

  try {
    const res = await api('/api/admin/chat/' + encodeURIComponent(sid) + '/reply', {
      method: 'POST',
      body: { body, clientId }
    });
    if (gen !== chatGen()) return;
    if (!e.pending || e.pending.clientId !== attempt.clientId || e.pending.body !== attempt.body) return;
    if (!res || typeof res !== 'object') throw new Error('Malformed reply response');
    const conv = chatValidThread(res.conversation);
    if (!conv || conv.id !== sid) throw new Error('Reply thread mismatch');
    if (!Array.isArray(res.messages)) throw new Error('Reply missing messages');
    const msgs = [];
    for (const m of res.messages) {
      const v = chatValidMessage(m);
      if (!v) throw new Error('Malformed reply message');
      msgs.push(v);
    }
    const delivered = msgs.find(m => m.sender === 'admin' && m.clientId === clientId && m.body === body);
    if (!delivered) throw new Error('Delivery unconfirmed');

    e.conversation = conv;
    e.messages = chatMergeMessages(e.messages, msgs);
    e.pending = null;
    e.sendError = '';
    e.forceScrollBottom = true;
    if (e.draft === body) e.draft = '';
    const ta = chatEl('chat-draft');
    if (ta && ta.dataset.threadId === sid && ta.value === body) ta.value = '';
    chatPatchList();
    chatPatchThread();
  } catch (err) {
    if (gen !== chatGen()) return;
    if (!e.pending || e.pending.clientId !== attempt.clientId || e.pending.body !== attempt.body) return;
    const msg = (err && err.message) ? err.message : '';
    if (err && err.status === 429) {
      e.sendError = 'Rate limited. Please wait before retrying.';
    } else if (err && err.status === 403) {
      e.sendError = 'Not authorized to send.';
    } else {
      e.sendError = 'Delivery unconfirmed. Retry safely.';
    }
  } finally {
    if (gen === chatGen()) {
      e.sending = false;
      chatPatchThread();
    }
  }
}

/* ---------- status ---------- */

async function chatSetStatus(id, status) {
  const sid = chatSafeId(id);
  if (!sid) return;
  const e = chatEntry(sid);
  if (e.statusBusy) return;
  const gen = chatGen();
  e.statusBusy = true;
  e.statusError = '';
  e.requestRevision++;
  e.loading = false;
  chatPatchThread();
  try {
    const res = await api('/api/admin/chat/' + encodeURIComponent(sid) + '/status', {
      method: 'POST',
      body: { status }
    });
    if (gen !== chatGen()) return;
    if (!res || typeof res !== 'object') throw new Error('Malformed status response');
    const conv = chatValidThread(res.conversation);
    if (!conv || conv.id !== sid) throw new Error('Status thread mismatch');
    const prev = e.conversation;
    if (prev && prev.updatedAt && conv.updatedAt && Date.parse(conv.updatedAt) < Date.parse(prev.updatedAt)) {
      conv.updatedAt = prev.updatedAt;
    }
    e.conversation = conv;
    e.statusError = '';
    chatPatchList();
    chatPatchThread();
  } catch (err) {
    if (gen !== chatGen()) return;
    e.statusError = (err && err.message) ? err.message : 'Failed to update status';
  } finally {
    if (gen === chatGen()) {
      e.statusBusy = false;
      chatPatchThread();
    }
  }
}

/* ---------- draft capture ---------- */

function captureChatDraft() {
  const ta = chatEl('chat-draft');
  if (!ta) return;
  const tid = ta.dataset.threadId;
  if (!tid) return;
  const e = chatEntry(tid);
  if (e.pending) return;
  e.draft = ta.value;
}

/* ---------- polling ---------- */

function chatPollTick() {
  if (typeof tab !== 'undefined' && tab !== 'chat') return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (typeof app !== 'undefined' && app && app.hidden) return;

  loadChat({ silent: true });

  const sid = chatSelectedId;
  if (sid) {
    const e = chatEntry(sid);
    if (!e.sending && !e.statusBusy && !e.loading) {
      chatLoadThread(sid, { silent: true });
    }
  }
}

function startChatPolling() {
  if (!chatState.visibilityBound && typeof document !== 'undefined') {
    chatState.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopChatPolling();
      } else if (typeof tab !== 'undefined' && tab === 'chat' && typeof app !== 'undefined' && app && !app.hidden) {
        startChatPolling();
        chatPollTick();
      }
    });
  }
  if (chatState.pollTimer) return;
  if (typeof tab !== 'undefined' && tab !== 'chat') return;
  if (typeof document !== 'undefined' && (document.hidden || document.visibilityState !== 'visible')) return;
  if (typeof app !== 'undefined' && app && app.hidden) return;
  chatState.pollTimer = setInterval(chatPollTick, CHAT_POLL_MS);
}

function stopChatPolling() {
  if (chatState.pollTimer) {
    clearInterval(chatState.pollTimer);
    chatState.pollTimer = null;
  }
  if (chatState.searchTimer) {
    clearTimeout(chatState.searchTimer);
    chatState.searchTimer = null;
  }
  chatState.listRevision++;
  chatState.listPromise = null;
  chatState.listPromiseKey = '';
}

/* ---------- reset ---------- */

function resetChatState() {
  chatGlobalGeneration++;
  chatAuthGeneration++;
  stopChatPolling();
  chatThreadsCache = new Map();
  chatSelectedId = null;
  chatState.query = '';
  chatState.filter = 'all';
  chatState.offset = 0;
  chatState.total = 0;
  chatState.counts = { unreadCount: 0, openCount: 0 };
  chatState.listReady = false;
  chatState.listLoading = false;
  chatState.listError = '';
  chatState.listRevision++;
  chatState.listPromise = null;
  chatState.listPromiseKey = '';
  chatState.listThreads = [];
  if (chatState.searchTimer) {
    clearTimeout(chatState.searchTimer);
    chatState.searchTimer = null;
  }
}

/* ---------- bind ---------- */

function bindChat() {
  if (!app) return;
  if (app.dataset.chatBound === '1') {
    const searchEl = chatEl('chat-search');
    if (searchEl && searchEl.value !== chatState.query) searchEl.value = chatState.query;
    const filterEl = chatEl('chat-filter');
    if (filterEl && filterEl.value !== chatState.filter) filterEl.value = chatState.filter;
    chatPatchAll();
    return;
  }
  app.dataset.chatBound = '1';

  app.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;

    const threadBtn = t.closest('.chat-thread-btn');
    if (threadBtn && app.contains(threadBtn)) {
      const id = threadBtn.dataset.threadId;
      if (id) {
        captureChatDraft();
        chatSelectThread(id);
      }
      return;
    }

    const id = t.id;
    if (id === 'chat-prev') {
      if (chatState.offset > 0) {
        chatState.offset = Math.max(0, chatState.offset - CHAT_PAGE_LIMIT);
        loadChat();
      }
      return;
    }
    if (id === 'chat-next') {
      if ((chatState.offset + CHAT_PAGE_LIMIT) < chatState.total) {
        chatState.offset += CHAT_PAGE_LIMIT;
        loadChat();
      }
      return;
    }
    if (id === 'chat-list-retry') {
      chatState.listError = '';
      loadChat();
      return;
    }
    if (id === 'chat-thread-retry') {
      if (chatSelectedId) chatLoadThread(chatSelectedId);
      return;
    }
    if (id === 'chat-read-retry') {
      const sid = chatSelectedId;
      if (sid) {
        const e = chatEntry(sid);
        e.readError = '';
        chatPatchThread();
        chatMaybeMarkRead();
      }
      return;
    }
    if (id === 'chat-status-toggle') {
      const sid = chatSelectedId;
      if (sid) {
        const e = chatEntry(sid);
        if (e.conversation) {
          const next = e.conversation.status === 'open' ? 'closed' : 'open';
          chatSetStatus(sid, next);
        }
      }
      return;
    }
    if (id === 'chat-retry-send') {
      const sid = chatSelectedId;
      if (sid) {
        const e = chatEntry(sid);
        if (e.pending && !e.sending && e.detailReady && !e.loadError) {
          chatSend(sid, e.pending.body, e.pending.clientId);
        }
      }
      return;
    }
  });

  app.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.id === 'chat-search') {
      chatState.query = t.value.trim().slice(0, 200);
      chatState.offset = 0;
      chatState.listRevision++;
      chatState.listPromise = null;
      chatState.listPromiseKey = '';
      if (chatState.searchTimer) clearTimeout(chatState.searchTimer);
      chatState.searchTimer = setTimeout(() => {
        chatState.searchTimer = null;
        loadChat();
      }, 300);
      return;
    }
    if (t.id === 'chat-draft') {
      const tid = t.dataset.threadId;
      if (!tid) return;
      const e = chatEntry(tid);
      if (e.pending) return;
      e.draft = t.value;
    }
  });

  app.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.id === 'chat-filter') {
      if (t.value !== 'all' && t.value !== 'open' && t.value !== 'closed') return;
      chatState.filter = t.value;
      chatState.offset = 0;
      chatState.listRevision++;
      chatState.listPromise = null;
      chatState.listPromiseKey = '';
      loadChat();
    }
  });

  app.addEventListener('submit', (ev) => {
    const t = ev.target;
    if (!t || t.id !== 'chat-reply-form') return;
    ev.preventDefault();
    const sid = chatSelectedId;
    if (!sid) return;
    const e = chatEntry(sid);
    if (!e.detailReady || e.loadError) return;
    if (e.pending || e.sending) return;
    const ta = chatEl('chat-draft');
    if (!ta) return;
    const body = ta.value.trim();
    if (body.length < 1 || body.length > CHAT_MAX_BODY) {
      e.sendError = 'Message must be 1–2000 characters.';
      chatPatchThread();
      return;
    }
    const clientId = chatUuid();
    if (!clientId) {
      e.sendError = 'Secure random unavailable; cannot send.';
      chatPatchThread();
      return;
    }
    e.pending = { body, clientId };
    e.draft = body;
    e.sendError = '';
    chatPatchThread();
    chatSend(sid, body, clientId);
  });

  app.addEventListener('scroll', (ev) => {
    const t = ev.target;
    if (!t || t.id !== 'chat-transcript') return;
    chatMaybeMarkRead();
  }, true);

  chatPatchAll();
}

function chatPatchAll() {
  chatPatchList();
  chatPatchThread();
}

/* ---------- auth generation hook ---------- */

function chatSetAuthGeneration(gen) {
  const next = (typeof gen === 'number' && Number.isFinite(gen)) ? gen : 0;
  if (next === chatAuthGeneration) return;
  chatAuthGeneration = next;
  for (const e of chatThreadsCache.values()) {
    e.sending = false;
    e.statusBusy = false;
    e.readBusy = false;
    e.loading = false;
    e.requestRevision++;
  }
  chatState.listRevision++;
  chatState.listPromise = null;
  chatState.listPromiseKey = '';
  chatPatchAll();
}

const legacyFormKey=form=>form.id==='settings-form'?'#settings-form':`#blog-form:${form.dataset.id||'new'}`;
const legacyPending=new Set();
function legacySetFormError(form,message){let error=form.querySelector('.form-error');if(!error){error=document.createElement('div');error.className='form-error';error.setAttribute('role','alert');error.hidden=true;form.prepend(error)}error.textContent=message||'';error.hidden=!message}
function legacyDisableForm(form,disabled){form.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=disabled})}
function legacyFormKeyOf(form){return legacyFormKey(form)}
function legacyIsSaving(form){return legacyPending.has(legacyFormKey(form))}
function legacyPublicBlogUrl(slug){return `https://www.escrowglobal.io/blog/${encodeURIComponent(String(slug||''))}`}
function legacyEmptyRow(cols,message){return `<tr><td colspan="${cols}" class="empty">${esc(message)}</td></tr>`}
function legacyNoMatch(id,message){return `<div class="empty" id="${id}" hidden>${esc(message)}</div>`}

function blogFieldsFromPost(p={}){
  return {
    title:String(p.title||''),
    slug:String(p.slug||''),
    excerpt:String(p.excerpt||''),
    tags:String((p.tags||[]).join(', ')),
    body:String(p.body||''),
    seoTitle:String(p.seo?.title||''),
    seoDescription:String(p.seo?.description||''),
    canonical:String(p.seo?.canonical||''),
    author:String(p.author||'Escrow Global team'),
    ogImage:String(p.seo?.ogImage||'')
  };
}

function blogFormSnapshot(form){
  const values={};
  if(!form)return values;
  form.querySelectorAll('input,textarea,select').forEach(el=>{
    if(el.name)values[el.name]=el.type==='checkbox'?el.checked:el.value;
  });
  return values;
}

function blogFormDirty(form=document.querySelector('#blog-form')){
  if(!form)return false;
  try{return JSON.stringify(blogFormSnapshot(form))!==form.dataset.original;}catch(_){return false;}
}

function confirmBlogDiscard(){
  if(tab!=='blog'||!blogFormDirty())return true;
  return window.confirm('You have unsaved blog changes. Leave this editor and keep the draft for later?');
}

function warnBeforeUnload(event){
  if(tab==='blog'&&blogFormDirty()){event.preventDefault();event.returnValue='';}
}

function blogStatusClass(status){return status==='published'?'green':status==='archived'?'blue':'warn'}
function blogStatusLabel(status){return status==='in_progress'?'In progress':String(status||'draft').replace(/_/g,' ')}
function blogReadTime(body){
  const words=String(body||'').trim().split(/\s+/).filter(Boolean).length;
  return words?`${Math.max(1,Math.ceil(words/220))} min read`:'Not ready to read';
}
function blogDate(post){return post.publishedAt||post.updatedAt||post.createdAt}
function blogTimestamp(value){const numeric=Number(value);if(Number.isFinite(numeric))return numeric;const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?parsed:0}
function blogDatetime(value){const d=new Date(value||Date.now());return isNaN(d.getTime())?'':d.toISOString()}
function blogPreviewBody(body){
  const paragraphs=String(body||'').trim().split(/\r?\n\s*\r?\n/).map(x=>x.trim()).filter(Boolean);
  return paragraphs.length?paragraphs.map(p=>`<p>${esc(p).replace(/\r?\n/g,'<br>')}</p>`).join(''):'<p class="preview-empty">Add article copy to see the preview.</p>';
}

function updateBlogCounts(){
  document.querySelectorAll('[data-count-for]').forEach(counter=>{
    const field=document.getElementById(counter.dataset.countFor);
    if(!field)return;
    const max=Number(counter.dataset.max||0),length=String(field.value||'').length;
    counter.textContent=`${length.toLocaleString()} / ${max.toLocaleString()}`;
    counter.classList.toggle('near-limit',max>0&&length>=max*.85);
  });
}

function filterBlog(){
  const query=(document.querySelector('#blog-search')?.value||blogQuery).trim().toLowerCase();
  const selected=document.querySelector('#blog-status-filter')?.value||blogStatus;
  blogQuery=query;blogStatus=selected;
  let visible=0;
  document.querySelectorAll('.post-item[data-blog-search]').forEach(item=>{
    const match=(!query||item.dataset.blogSearch.includes(query))&&(!selected||selected==='all'||item.dataset.blogStatus===selected);
    item.hidden=!match;if(match)visible++;
  });
  const total=document.querySelectorAll('.post-item[data-blog-search]').length;
  const count=document.querySelector('.blog-result-count');
  if(count)count.textContent=`${visible} of ${total} ${total===1?'post':'posts'}`;
  const empty=document.querySelector('#blog-no-match');
  if(empty)empty.hidden=!(total>0&&visible===0);
}

function previewBlog(){
  const form=document.querySelector('#blog-form'),dialog=document.querySelector('#blog-preview-dialog');
  if(!form||!dialog)return;
  const values=blogFormSnapshot(form);
  const title=document.querySelector('#blog-preview-title');
  const excerpt=document.querySelector('#blog-preview-excerpt');
  const meta=document.querySelector('#blog-preview-meta');
  const body=document.querySelector('#blog-preview-body');
  if(title)title.textContent=values.title||'Untitled story';
  if(excerpt){excerpt.textContent=values.excerpt||'No excerpt added yet.';excerpt.hidden=!values.excerpt;}
  if(meta)meta.textContent=`${values.author||'Escrow Global team'} · ${blogReadTime(values.body)}`;
  if(body)body.innerHTML=blogPreviewBody(values.body);
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}

function listings(){
  const rows=snapshot.listings||[];
  return `<div class="toolbar">
    <label class="field"><span>Search listings</span><input id="listing-search" placeholder="Search listings…"></label>
    <label class="field"><span>Status</span><select id="listing-status"><option value="">All statuses</option>${['published','pending','paused','hidden'].map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
    <span class="sub">${rows.length} total listings</span>
  </div>
  <section class="panel table-wrap">
    <table class="data-table">
      <caption>Marketplace listings in the local sandbox</caption>
      <thead><tr><th scope="col">Listing</th><th scope="col">Seller</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Control</th></tr></thead>
      <tbody id="listing-rows">${rows.map(l=>`<tr data-search="${esc((l.title+' '+(l.category||'')+' '+l.status).toLowerCase())}" data-status="${esc(l.status)}"><td class="title-cell">${esc(l.title)}<div class="sub">${esc(l.category||l.categoryId||'')} · ${esc(l.kind||'listing')}</div></td><td>${esc(snapshot.users.find(u=>u.id===l.sellerId)?.name||l.sellerId)}</td><td><span class="pill ${l.status==='published'?'green':l.status==='hidden'?'red':'warn'}">${esc(l.status)}</span></td><td class="sub">${esc(fmtDate(l.createdAt))}</td><td><button class="btn small" data-moderate="${esc(l.id)}">Change status</button></td></tr>`).join('')||legacyEmptyRow(5,'No listings yet.')}</tbody>
    </table>
    ${legacyNoMatch('listing-no-match','No listings match the current filters.')}
  </section>`;
}

function reports(){
  const rows=snapshot.reports||[];
  return `<section class="panel table-wrap">
    <table class="data-table">
      <caption>Listing reports submitted by visitors</caption>
      <thead><tr><th scope="col">Listing report</th><th scope="col">Reason</th><th scope="col">Status</th><th scope="col">Reported</th><th scope="col">Action</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td class="title-cell">${esc(snapshot.listings.find(l=>l.id===r.listingId)?.title||r.listingId)}<div class="sub">${esc(r.id)}</div></td><td>${esc(r.reason)}</td><td><span class="pill ${r.status==='pending'?'warn':r.status==='actioned'?'green':'blue'}">${esc(r.status||'pending')}</span></td><td class="sub">${esc(fmtDate(r.at))}</td><td>${['pending','escalated'].includes(r.status)?`<button class="btn small" data-resolve="${esc(r.id)}">Resolve</button>`:'<span class="sub">Reviewed</span>'}</td></tr>`).join('')||legacyEmptyRow(5,'No reports have been submitted.')}</tbody>
    </table>
  </section>`;
}

function support(){
  const rows=snapshot.supportTickets||[],a=snapshot.analytics.support||{};
  return `<div class="notice" style="margin-bottom:16px"><strong>${esc(a.open||0)} open support ticket(s).</strong> This inbox is local-only and has no verified user identity. Never request passwords, seed phrases or payment secrets in a ticket.</div>
  <div class="toolbar">
    <label class="field"><span>Status</span><select id="support-status"><option value="">All statuses</option>${['open','in_progress','waiting_user','resolved','closed'].map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
    <label class="field"><span>Category</span><select id="support-category"><option value="">All categories</option>${['support','bug','payment','listing','account'].map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
    <label class="field"><span>Search</span><input id="support-search" placeholder="Search ticket ID or subject…"></label>
  </div>
  <section class="panel table-wrap">
    <table class="data-table">
      <caption>Support inbox tickets</caption>
      <thead><tr><th scope="col">Ticket</th><th scope="col">Type / severity</th><th scope="col">Status</th><th scope="col">Files</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead>
      <tbody id="support-rows">${rows.map(t=>`<tr data-support-search="${esc((t.id+' '+t.subject+' '+t.description).toLowerCase())}" data-support-status="${esc(t.status)}" data-support-category="${esc(t.category)}"><td class="title-cell">${esc(t.subject)}<div class="sub">${esc(t.id)} · ${esc(t.reporterHandle||'anonymous')}</div><div class="sub">${esc(t.description.slice(0,120))}${t.description.length>120?'…':''}</div></td><td><span class="pill blue">${esc(t.category)}</span> <span class="pill ${t.severity==='critical'||t.severity==='high'?'red':'warn'}">${esc(t.severity)}</span></td><td><span class="pill ${['resolved','closed'].includes(t.status)?'green':'warn'}">${esc(t.status.replace('_',' '))}</span>${t.assignee?`<div class="sub">Assigned: ${esc(t.assignee)}</div>`:''}</td><td>${t.attachments?.length||0}${t.attachments?.length?`<div>${t.attachments.map(a=>`<a class="sub" href="/api/admin/support/tickets/${encodeURIComponent(t.id)}/attachments/${encodeURIComponent(a.id)}" target="_blank" rel="noreferrer">${esc(a.filename)}</a>`).join('<br>')}</div>`:''}</td><td class="sub">${esc(fmtDate(t.updatedAt))}</td><td><button class="btn small" data-support-update="${esc(t.id)}">Status / assign</button><button class="btn small" data-support-reply="${esc(t.id)}">Reply / note</button></td></tr>`).join('')||legacyEmptyRow(6,'No support tickets yet.')}</tbody>
    </table>
    ${legacyNoMatch('support-no-match','No tickets match the current filters.')}
  </section>`;
}

function agreements(){
  const rows=snapshot.orders||[];
  return `<div class="notice" style="margin-bottom:16px">Use this view for operational triage only. It cannot move funds, change recipients, override milestones, or replace dispute authority. Amounts are simulated.</div>
  <section class="panel table-wrap">
    <table class="data-table">
      <caption>Agreements in the local sandbox</caption>
      <thead><tr><th scope="col">Agreement</th><th scope="col">Parties</th><th scope="col">Status</th><th scope="col">Value</th><th scope="col">Monitoring</th></tr></thead>
      <tbody>${rows.map(o=>`<tr><td class="title-cell">${esc(o.title)}<div class="sub">${esc(o.id)} · v${esc(o.version)}</div></td><td class="sub">${esc(o.buyerId)} ↔ ${esc(o.sellerId)}</td><td><span class="pill ${['completed','refunded'].includes(o.status)?'green':o.adminFlag?'red':'blue'}">${esc(o.adminFlag?'flagged':status(o))}</span></td><td>${esc(fmtUnits(o.milestones.reduce((n,m)=>n+BigInt(m.originalAmount||0),0n).toString()))} ${esc(o.asset)}</td><td><button class="btn small" data-flag="${esc(o.id)}">${o.adminFlag?'Clear flag':'Flag'}</button> <button class="btn small" data-order-note="${esc(o.id)}">Add note</button>${o.adminNotes?.length?`<div class="sub">${o.adminNotes.length} note(s)</div>`:''}</td></tr>`).join('')||legacyEmptyRow(5,'No agreements yet.')}</tbody>
    </table>
  </section>`;
}

function status(o){
  if(!o.acceptedAt)return 'awaiting acceptance';
  if(!o.fundedAt)return 'awaiting funding';
  if(o.milestones.some(m=>m.status==='disputed'))return 'disputed';
  if(o.milestones.every(m=>['released','refunded','settled'].includes(m.status)))return 'completed';
  if(o.milestones.some(m=>m.status==='submitted'))return 'in review';
  return 'in progress';
}

function readinessView(){
  if(!readiness){
    return `<section class="panel readiness-panel">
      <div class="toolbar"><div><h2>Production custody gateboard</h2><p class="sub">A release checklist, not a switch. Every control must be independently evidenced before real custody can be considered.</p></div><span class="pill warn">UNAVAILABLE</span></div>
      <div class="empty">Readiness data is unavailable. <button class="btn small" data-readiness-retry>Retry</button></div>
      <div class="notice"><strong>No live custody is enabled.</strong> This console exposes blockers for planning and audit evidence; it cannot deploy a program, authorize a wallet, move funds or override a dispute. This view is informational only and provides no custody advice.</div>
    </section>`;
  }
  const gates=readiness.gates||[],readyCount=gates.filter(x=>x.ready).length;
  const artifact=readiness.localArtifact?(readiness.localArtifactFresh?'Local Anchor artifact is newer than the source snapshot · deployment still unverified.':'Local Anchor artifact is older than the source snapshot · rebuild required.'):'No local Anchor artifact detected.';
  return `<section class="panel readiness-panel">
    <div class="toolbar"><div><h2>Production custody gateboard</h2><p class="sub">A release checklist, not a switch. Every control must be independently evidenced before real custody can be considered.</p></div><span class="pill ${readiness.ready?'green':'warn'}">${readiness.ready?'READY FOR REVIEW':'BLOCKED'}</span></div>
    <div class="readiness-summary"><strong>${esc(readyCount)}/${esc(gates.length)} controls reported ready</strong><span>${esc(artifact)}</span></div>
    <div class="readiness-gates">${gates.map(g=>`<div class="readiness-gate"><span class="readiness-icon ${g.ready?'ok':'blocked'}">${g.ready?'✓':'!'}</span><div><strong>${esc(g.label)}</strong><p>${esc(g.detail)}</p></div><span class="pill ${g.ready?'green':'red'}">${g.ready?'Ready':'Blocked'}</span></div>`).join('')||'<div class="empty">No readiness data available.</div>'}</div>
    <div class="notice"><strong>No live custody is enabled.</strong> This console exposes blockers for planning and audit evidence; it cannot deploy a program, authorize a wallet, move funds or override a dispute. This view is informational only and provides no custody advice.</div>
  </section>`;
}

function blog(){
  const posts=[...(snapshot.blog||[])].sort((a,b)=>{
    if(blogSort==='title')return String(a.title||'').localeCompare(String(b.title||''));
    if(blogSort==='status')return String(a.status||'').localeCompare(String(b.status||''));
    return blogTimestamp(blogDate(b))-blogTimestamp(blogDate(a));
  });
  const counts=posts.reduce((out,p)=>{out[p.status||'draft']=(out[p.status||'draft']||0)+1;return out},{draft:0,published:0,archived:0});
  const post=editing?posts.find(x=>x.id===editing):null;
  const body=editing&&!post
    ?`<h2>Post unavailable</h2><p class="sub">The saved post is not present in the current snapshot. Refresh to load the editor.</p><div class="empty">Post ID: ${esc(editing)}</div>`
    :(post?editor(post):editor({}));
  return `<section class="blog-hero" aria-labelledby="blog-workspace-title">
    <div><p class="eyebrow">Content operations</p><h2 id="blog-workspace-title">Publish with confidence</h2><p class="sub">Create, review and maintain the public journal without touching marketplace data.</p></div>
    <button class="btn primary" type="button" data-action="new-post">New post</button>
  </section>
  <section class="blog-summary" aria-label="Blog status summary">
    <button type="button" class="blog-stat ${blogStatus==='all'?'active':''}" data-blog-status="all" aria-pressed="${blogStatus==='all'}"><span class="blog-stat-value">${esc(posts.length)}</span><span class="blog-stat-label">All posts</span></button>
    <button type="button" class="blog-stat ${blogStatus==='draft'?'active':''}" data-blog-status="draft" aria-pressed="${blogStatus==='draft'}"><span class="blog-stat-value">${esc(counts.draft)}</span><span class="blog-stat-label">Drafts</span></button>
    <button type="button" class="blog-stat ${blogStatus==='published'?'active':''}" data-blog-status="published" aria-pressed="${blogStatus==='published'}"><span class="blog-stat-value">${esc(counts.published)}</span><span class="blog-stat-label">Published</span></button>
    <button type="button" class="blog-stat ${blogStatus==='archived'?'active':''}" data-blog-status="archived" aria-pressed="${blogStatus==='archived'}"><span class="blog-stat-value">${esc(counts.archived)}</span><span class="blog-stat-label">Archived</span></button>
  </section>
  <div class="blog-layout">
    <section class="panel blog-library" aria-labelledby="blog-library-title">
      <div class="blog-section-head"><div><h2 id="blog-library-title">Posts</h2><p class="sub blog-result-count" aria-live="polite">${posts.length} of ${posts.length} ${posts.length===1?'post':'posts'}</p></div><span class="blog-library-mark">${esc(counts.published)} live</span></div>
      <div class="blog-filters">
        <label class="field"><span>Search posts</span><input id="blog-search" type="search" value="${esc(blogQuery)}" placeholder="Search title, excerpt or tag…" autocomplete="off"></label>
        <div class="blog-filter-row"><label class="field"><span>Status</span><select id="blog-status-filter"><option value="all"${blogStatus==='all'?' selected':''}>All statuses</option><option value="draft"${blogStatus==='draft'?' selected':''}>Drafts</option><option value="published"${blogStatus==='published'?' selected':''}>Published</option><option value="archived"${blogStatus==='archived'?' selected':''}>Archived</option></select></label><label class="field"><span>Sort</span><select id="blog-sort"><option value="updated"${blogSort==='updated'?' selected':''}>Recently updated</option><option value="title"${blogSort==='title'?' selected':''}>Title A–Z</option><option value="status"${blogSort==='status'?' selected':''}>Status</option></select></label></div>
      </div>
      <div class="post-list">${posts.map(p=>{const search=`${p.title||''} ${p.excerpt||''} ${(p.tags||[]).join(' ')}`.toLowerCase();return `<button type="button" class="post-item ${p.id===editing?'selected':''}" data-edit="${esc(p.id)}" data-blog-search="${esc(search)}" data-blog-status="${esc(p.status||'draft')}" aria-current="${p.id===editing?'true':'false'}"><span class="post-item-top"><span class="pill ${blogStatusClass(p.status)}">${esc(blogStatusLabel(p.status))}</span><time datetime="${esc(blogDatetime(blogDate(p)))}">${esc(fmtDate(blogDate(p)))}</time></span><strong>${esc(p.title||'Untitled post')}</strong><small>${esc(p.excerpt||'No excerpt yet.')}</small><span class="post-item-foot"><span>${esc(blogReadTime(p.body))}</span><span>${esc((p.tags||[]).slice(0,2).join(' · ')||'No tags')}</span></span></button>`}).join('')||'<div class="empty blog-empty"><strong>No posts yet</strong><span>Create your first story to start building the public journal.</span></div>'}</div>
      ${legacyNoMatch('blog-no-match','No posts match your search and status filters.')}
    </section>
    <section class="panel blog-editor-panel" aria-labelledby="blog-editor-title">${body}</section>
  </div>`;
}

function editor(p){
  const isNew=!p.id;
  const original=JSON.stringify(blogFieldsFromPost(p));
  return `<div class="blog-editor-head"><div><p class="eyebrow">${isNew?'New story':'Story editor'}</p><h2 id="blog-editor-title">${isNew?'Create a post':'Edit post'}</h2><p class="sub">${isNew?'Start with a clear promise and a useful takeaway.':'Last updated '+esc(fmtDate(p.updatedAt||p.createdAt))}</p></div>${isNew?'<span class="pill blue">Not saved</span>':`<span class="pill ${blogStatusClass(p.status)}">${esc(blogStatusLabel(p.status))}</span>`}</div>
  <form id="blog-form" data-id="${esc(p.id||'')}" data-original="${esc(original)}">
    <div class="form-error" role="alert" hidden></div>
    <div class="form-grid">
      <div class="field"><label for="blog-title">Title <span class="required-mark">Required</span></label><input id="blog-title" name="title" required maxlength="160" value="${esc(p.title)}" aria-describedby="blog-title-help blog-title-count"><div class="field-meta"><span id="blog-title-help">Make the value obvious in one line.</span><span id="blog-title-count" data-count-for="blog-title" data-max="160">0 / 160</span></div></div>
      <div class="field"><label for="blog-slug">URL slug <span class="required-mark">Required</span></label><input id="blog-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="80" value="${esc(p.slug)}" placeholder="clear-escrow-guide" aria-describedby="blog-slug-help"><div class="field-meta"><span id="blog-slug-help">Lowercase letters, numbers and hyphens only.</span></div></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="blog-excerpt">Excerpt</label><textarea id="blog-excerpt" name="excerpt" maxlength="300" aria-describedby="blog-excerpt-help blog-excerpt-count">${esc(p.excerpt)}</textarea><div class="field-meta"><span id="blog-excerpt-help">A concise summary for the journal index.</span><span id="blog-excerpt-count" data-count-for="blog-excerpt" data-max="300">0 / 300</span></div></div>
      <div class="field"><label for="blog-tags">Tags <span class="label-note">Comma separated</span></label><input id="blog-tags" name="tags" value="${esc((p.tags||[]).join(', '))}" placeholder="escrow, marketplaces, safety" aria-describedby="blog-tags-help"><div class="field-meta"><span id="blog-tags-help">Use 2–5 descriptive topics.</span></div></div>
    </div>
    <div class="field"><label for="blog-body">Article body <span class="required-mark">Required</span></label><textarea id="blog-body" name="body" required maxlength="30000" class="blog-body-field" aria-describedby="blog-body-help blog-body-count">${esc(p.body)}</textarea><div class="field-meta"><span id="blog-body-help">Plain text is supported. Use a blank line to separate paragraphs.</span><span id="blog-body-count" data-count-for="blog-body" data-max="30000">0 / 30,000</span></div></div>
    <div class="form-grid three">
      <div class="field"><label for="blog-seo-title">SEO title</label><input id="blog-seo-title" name="seoTitle" maxlength="70" value="${esc(p.seo?.title)}" aria-describedby="blog-seo-title-help blog-seo-title-count"><div class="field-meta"><span id="blog-seo-title-help">Aim for 50–60 characters.</span><span id="blog-seo-title-count" data-count-for="blog-seo-title" data-max="70">0 / 70</span></div></div>
      <div class="field"><label for="blog-seo-description">Meta description</label><input id="blog-seo-description" name="seoDescription" maxlength="170" value="${esc(p.seo?.description)}" aria-describedby="blog-seo-description-help blog-seo-description-count"><div class="field-meta"><span id="blog-seo-description-help">Aim for 140–160 characters.</span><span id="blog-seo-description-count" data-count-for="blog-seo-description" data-max="170">0 / 170</span></div></div>
      <div class="field"><label for="blog-canonical">Canonical path</label><input id="blog-canonical" name="canonical" maxlength="300" value="${esc(p.seo?.canonical||'')}" placeholder="/blog/slug" aria-describedby="blog-canonical-help"><div class="field-meta"><span id="blog-canonical-help">Optional; use the preferred public path.</span></div></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="blog-author">Author</label><input id="blog-author" name="author" maxlength="100" value="${esc(p.author||'Escrow Global team')}"></div>
      <div class="field"><label for="blog-og-image">OG image URL or path</label><input id="blog-og-image" name="ogImage" maxlength="500" value="${esc(p.seo?.ogImage)}"></div>
    </div>
    <details class="seo-guidance"><summary>SEO checklist</summary><ul><li>Keep the title specific and useful to the reader.</li><li>Write an excerpt that stands on its own when shared.</li><li>Preview the story before publishing and verify the slug.</li></ul></details>
    <div class="editor-actions">
      <button class="btn primary" name="save" type="submit">Save draft</button>
      <button class="btn" type="button" data-action="preview-post">Preview</button>
      ${!isNew?`<button class="btn" name="publish" type="submit">${p.status==='published'?'Unpublish':'Publish'}</button><button class="btn danger" name="delete" type="button" data-delete-post="${esc(p.id)}">Delete</button><a class="btn" href="${esc(legacyPublicBlogUrl(p.slug))}" target="_blank" rel="noreferrer">Open public page</a>`:''}
    </div>
  </form>
  <dialog id="blog-preview-dialog" class="blog-preview-dialog" aria-labelledby="blog-preview-title" aria-describedby="blog-preview-excerpt"><article class="blog-preview-card"><header class="blog-preview-head"><div><p class="eyebrow">Escrow Global Journal</p><h2 id="blog-preview-title">Untitled story</h2><p id="blog-preview-meta" class="blog-preview-meta"></p></div><button type="button" class="btn ghost" data-preview-close>Close</button></header><p id="blog-preview-excerpt" class="blog-preview-excerpt"></p><div id="blog-preview-body" class="blog-preview-body"></div></article></dialog>`;
}

function pageUrl(path){
  const value=String(path||'');
  return value==='/'?'https://www.escrowglobal.io/':`https://www.escrowglobal.io${value}`;
}
function pageStatusClass(status){return status==='published'?'green':status==='archived'?'blue':'warn'}
function pages(){
  const rows=snapshot.pages||[], page=pageEditing?rows.find(x=>x.id===pageEditing):null;
  const body=pageEditing&&!page?`<h2>Page unavailable</h2><p class="sub">Refresh to load the current page inventory.</p>`:pageEditor(page||{});
  return `<div class="toolbar"><button class="btn primary" data-action="new-page">New page</button><button class="btn" data-action="sync-pages">Sync from website</button><span class="sub">${rows.length} route templates · structured blocks are safe to edit and reusable.</span></div>
  <div class="content-layout"><section class="panel"><div class="panel-heading"><h2>Website pages</h2><span class="sub">${rows.filter(x=>x.status==='published').length} published</span></div><div class="post-list">${rows.map(p=>`<button class="post-item ${p.id===pageEditing?'selected':''}" data-edit-page="${esc(p.id)}"><strong>${esc(p.title)}</strong><small><span class="pill ${pageStatusClass(p.status)}">${esc(p.status)}</span> ${esc(p.path)} · ${esc(p.template)}</small><small>${p.lastSyncedAt?'Synced '+esc(fmtDate(p.lastSyncedAt)):'Not synced'}</small></button>`).join('')||'<div class="empty">No page records yet. Sync the existing website to create templates.</div>'}</div></section><section class="panel">${body}</section></div>`;
}
function pageEditor(p){
  const isNew=!p.id;
  return `<h2>${isNew?'Create a page':'Edit page'}</h2><p class="sub">${esc(p.syncNote||'Use structured blocks so the content stays portable across the website, mobile and future channels.')}</p>
  <form id="page-form" data-id="${esc(p.id||'')}"><div class="form-error" role="alert" hidden></div>
    <div class="form-grid"><div class="field"><label for="page-title">Page title</label><input id="page-title" name="title" required maxlength="180" value="${esc(p.title)}"></div><div class="field"><label for="page-path">Public path</label><input id="page-path" name="path" required pattern="/[a-zA-Z0-9/_-]*" maxlength="300" value="${esc(p.path)}" placeholder="/about"></div></div>
    <div class="form-grid"><div class="field"><label for="page-template">Template</label><select id="page-template" name="template">${['landing','standard','legal','journal'].map(x=>`<option value="${x}" ${p.template===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label for="page-status">Status</label><select id="page-status" name="status">${['draft','published','archived'].map(x=>`<option value="${x}" ${p.status===x?'selected':''}>${x}</option>`).join('')}</select></div></div>
    <div class="form-grid three"><div class="field"><label for="page-seo-title">SEO title</label><input id="page-seo-title" name="seoTitle" maxlength="70" value="${esc(p.seo?.title)}"></div><div class="field"><label for="page-seo-description">Meta description</label><input id="page-seo-description" name="seoDescription" maxlength="170" value="${esc(p.seo?.description)}"></div><div class="field"><label for="page-canonical">Canonical path</label><input id="page-canonical" name="canonical" maxlength="300" value="${esc(p.seo?.canonical||p.path||'')}"></div></div>
    <div class="field"><label for="page-sections">Structured sections · JSON</label><textarea id="page-sections" name="sections" required maxlength="180000" style="min-height:300px;font-family:var(--brand-font-mono,ui-monospace,monospace)">${esc(JSON.stringify(p.sections||[],null,2))}</textarea><p class="hint">Allowed blocks: <code>hero</code>, <code>rich_text</code>, <code>list</code>, <code>image</code>, <code>cta</code>. Reorder blocks in this list; use media IDs from the Media tab for images.</p></div>
    <div class="editor-actions"><button class="btn primary" name="save">Save draft</button>${!isNew?`<button class="btn" name="publish">${p.status==='published'?'Unpublish':'Publish'}</button><button class="btn danger" type="button" data-delete-page="${esc(p.id)}">Delete</button>`:''}<a class="btn" href="${esc(pageUrl(p.path))}" target="_blank" rel="noreferrer">Open public page</a></div>
  </form>`;
}
function media(){
  const rows=snapshot.media||[], item=mediaEditing?rows.find(x=>x.id===mediaEditing):null;
  const body=mediaEditing&&!item?`<h2>Media unavailable</h2><p class="sub">Refresh to load the current media inventory.</p>`:mediaEditor(item||{});
  return `<div class="toolbar"><button class="btn primary" data-action="new-media">Add media record</button><button class="btn" data-action="sync-pages">Sync website assets</button><label class="field"><span>Search media</span><input id="media-search" placeholder="Search name, tag or path…"></label><span class="sub">${rows.length} tracked assets · metadata only</span></div>
  <div class="content-layout"><section class="panel table-wrap"><table class="data-table media-table"><caption>Reusable website media</caption><thead><tr><th scope="col">Asset</th><th scope="col">Kind</th><th scope="col">Usage</th><th scope="col">Updated</th><th scope="col">Control</th></tr></thead><tbody id="media-rows">${rows.map(m=>{const usage=(snapshot.pages||[]).filter(p=>(p.sections||[]).some(s=>s.data?.mediaId===m.id||s.data?.src===m.path)||p.seo?.ogImage===m.path).length;return `<tr data-media-search="${esc((m.title+' '+m.filename+' '+m.path+' '+(m.tags||[]).join(' ')).toLowerCase())}"><td class="media-cell">${m.mime?.startsWith('image/')?`<img class="media-thumb" src="${esc(m.path)}" alt="${esc(m.alt||m.title)}" loading="lazy">`:'<span class="media-thumb media-file">FILE</span>'}<span><strong>${esc(m.title)}</strong><small>${esc(m.path)}</small></span></td><td><span class="pill blue">${esc(m.kind)}</span><div class="sub">${esc(m.mime||'unknown')}</div></td><td>${usage?`<span class="pill green">${usage} page${usage===1?'':'s'}</span>`:'<span class="sub">Unused</span>'}</td><td class="sub">${esc(fmtDate(m.updatedAt))}</td><td><button class="btn small" data-edit-media="${esc(m.id)}">Edit</button></td></tr>`}).join('')||legacyEmptyRow(5,'No media records yet.')}</tbody></table>${legacyNoMatch('media-no-match','No media matches the current search.')}</section><section class="panel">${body}</section></div>`;
}
function mediaEditor(m){
  const isNew=!m.id;
  return `<h2>${isNew?'Add media record':'Edit media metadata'}</h2><p class="sub">The file stays in the existing public asset folder. This editor changes its reusable metadata and never accepts secrets or arbitrary binary uploads.</p><form id="media-form" data-id="${esc(m.id||'')}"><div class="form-error" role="alert" hidden></div>
    <div class="form-grid"><div class="field"><label for="media-title">Title</label><input id="media-title" name="title" required maxlength="200" value="${esc(m.title)}"></div><div class="field"><label for="media-kind">Kind</label><select id="media-kind" name="kind">${['image','icon','vector','video','other'].map(x=>`<option value="${x}" ${m.kind===x?'selected':''}>${x}</option>`).join('')}</select></div></div>
    <div class="form-grid"><div class="field"><label for="media-path">Public path</label><input id="media-path" name="path" required maxlength="300" value="${esc(m.path)}" placeholder="/images/example.webp"><button class="btn small" type="button" data-copy-media-path="${esc(m.path)}">Copy public path</button></div><div class="field"><label for="media-mime">MIME type</label><input id="media-mime" name="mime" maxlength="120" value="${esc(m.mime)}" placeholder="image/webp"></div></div>
    <div class="form-grid three"><div class="field"><label for="media-width">Width</label><input id="media-width" name="width" type="number" min="0" max="100000" value="${m.width??''}"></div><div class="field"><label for="media-height">Height</label><input id="media-height" name="height" type="number" min="0" max="100000" value="${m.height??''}"></div><div class="field"><label for="media-filename">Filename</label><input id="media-filename" name="filename" maxlength="180" value="${esc(m.filename)}"></div></div>
    <div class="field"><label for="media-alt">Alt text</label><input id="media-alt" name="alt" maxlength="400" value="${esc(m.alt)}"></div><div class="field"><label for="media-tags">Tags · comma separated</label><input id="media-tags" name="tags" value="${esc((m.tags||[]).join(', '))}" placeholder="hero, marketing"></div><div class="editor-actions"><button class="btn primary" name="save">Save metadata</button>${!isNew?`<button class="btn danger" type="button" data-delete-media="${esc(m.id)}">Delete record</button>`:''}</div></form>`;
}

function settings(){
  const s=snapshot.settings;
  return `<section class="panel">
    <h2>Sandbox settings</h2>
    <p class="sub">These controls are persisted in the local sandbox and are safe to change during product exploration. They do NOT control the static www marketplace or deployment. Blog settings affect the API-backed journal only. Maintenance mode is an indicator and does not mean the actual site is down. Account creation and wallet sign-in are roadmap gates only; changing them does not enable authentication, custody, or live payments in this build.</p>
    <form id="settings-form" style="margin-top:18px">
      <div class="form-error" role="alert" hidden></div>
      <div class="form-grid">
        <div class="field"><label for="settings-site-name">Site name</label><input id="settings-site-name" name="siteName" value="${esc(s.siteName)}" maxlength="100"></div>
        <div class="field"><label for="settings-tagline">Tagline</label><input id="settings-tagline" name="tagline" value="${esc(s.tagline)}" maxlength="180"></div>
        <div class="field"><label for="settings-contact-email">Contact email</label><input id="settings-contact-email" name="contactEmail" type="email" value="${esc(s.contactEmail)}" maxlength="254"></div>
        <div class="field"><label for="settings-robots">Default robots policy</label><input id="settings-robots" name="robots" value="${esc(s.seo.robots)}" maxlength="80"></div>
        <div class="field"><label for="settings-default-title">Default SEO title</label><input id="settings-default-title" name="defaultTitle" value="${esc(s.seo.defaultTitle)}" maxlength="70"></div>
        <div class="field"><label for="settings-default-description">Default meta description</label><input id="settings-default-description" name="defaultDescription" value="${esc(s.seo.defaultDescription)}" maxlength="170"></div>
      </div>
      <label class="check"><input type="checkbox" name="maintenanceMode" ${s.maintenanceMode?'checked':''}> Enable maintenance-mode indicator</label>
      <label class="check"><input type="checkbox" name="blog" ${s.featureFlags.blog?'checked':''}> Enable public blog</label>
      <label class="check"><input type="checkbox" name="reports" ${s.featureFlags.reports?'checked':''}> Accept listing reports</label>
      <label class="check"><input type="checkbox" name="domainOffers" ${s.featureFlags.domainOffers?'checked':''}> Enable domain offers</label>
      <label class="check"><input type="checkbox" name="accountCreation" ${s.featureFlags.accountCreation?'checked':''}> Stage email account creation</label>
      <label class="check"><input type="checkbox" name="walletSignIn" ${s.featureFlags.walletSignIn?'checked':''}> Stage wallet sign-in</label>
      <button class="btn primary" type="submit">Save controls</button>
    </form>
  </section>`;
}

function audit(){
  return `<div class="toolbar"><label class="field"><span>Filter event types</span><input id="audit-filter" placeholder="Filter event types…"></label><span class="sub">Newest first · capped at 2,000 events</span></div>
  <section class="panel"><div class="audit-list">${(snapshot.audit||[]).map(x=>`<div class="audit-row" data-audit="${esc((x.type+' '+x.summary).toLowerCase())}"><time>${esc(fmtDate(x.at))}</time><strong>${esc(x.summary)}</strong><div class="sub">${esc(x.type)} · ${esc(x.actorId)} · ${esc(x.target?.kind||'system')}/${esc(x.target?.id||'')}</div></div>`).join('')||'<div class="empty">No admin events yet.</div>'}</div></section>`;
}

function exportView(){
  return `<section class="panel">
    <h2>Export sandbox data</h2>
    <p class="sub">Exports contain test data from the local state file. Treat them as sensitive even though this app is a demo.</p>
    <div class="form-grid" style="max-width:600px;margin-top:18px">
      <div class="field"><label for="export-kind">Dataset</label><select id="export-kind">${['listings','orders','reports','support','blog','pages','media','audit','users'].map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label for="export-format">Format</label><select id="export-format"><option value="csv">csv</option><option value="json">json</option></select></div>
    </div>
    <button class="btn primary" data-action="export">Download export</button>
  </section>`;
}

function bindLegacy(){
  document.querySelector('#listing-search')?.addEventListener('input',filterListings);
  document.querySelector('#listing-status')?.addEventListener('change',filterListings);
  document.querySelectorAll('[data-moderate]').forEach(b=>b.onclick=()=>moderate(b.dataset.moderate));
  document.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=()=>resolveReport(b.dataset.resolve));
  document.querySelectorAll('[data-flag]').forEach(b=>b.onclick=()=>flagOrder(b.dataset.flag));
  document.querySelectorAll('[data-support-update]').forEach(b=>b.onclick=()=>updateSupport(b.dataset.supportUpdate));
  document.querySelectorAll('[data-support-reply]').forEach(b=>b.onclick=()=>replySupport(b.dataset.supportReply));
  ['#support-search','#support-status','#support-category'].forEach(selector=>{const element=document.querySelector(selector);element?.addEventListener('input',filterSupport);element?.addEventListener('change',filterSupport)});
  document.querySelector('[data-action="new-post"]')?.addEventListener('click',()=>{if(!confirmBlogDiscard())return;captureForms();editing=null;render()});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{if(b.dataset.edit===editing)return;if(!confirmBlogDiscard())return;captureForms();editing=b.dataset.edit;render()});
  document.querySelector('#blog-search')?.addEventListener('input',filterBlog);
  document.querySelector('#blog-status-filter')?.addEventListener('change',filterBlog);
  document.querySelector('#blog-sort')?.addEventListener('change',e=>{blogSort=e.target.value||'updated';render()});
  document.querySelectorAll('[data-blog-status]').forEach(b=>b.addEventListener('click',()=>{blogStatus=b.dataset.blogStatus||'all';const select=document.querySelector('#blog-status-filter');if(select)select.value=blogStatus;filterBlog();document.querySelectorAll('[data-blog-status]').forEach(x=>{const active=x.dataset.blogStatus===blogStatus;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active))})}));
  document.querySelector('#blog-form')?.addEventListener('submit',saveBlog);
  document.querySelectorAll('#blog-form input,#blog-form textarea').forEach(field=>field.addEventListener('input',updateBlogCounts));
  document.querySelector('[data-action="preview-post"]')?.addEventListener('click',previewBlog);
  document.querySelector('[data-preview-close]')?.addEventListener('click',()=>document.querySelector('#blog-preview-dialog')?.close());
  document.querySelector('#blog-preview-dialog')?.addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close()});
  document.querySelector('[data-delete-post]')?.addEventListener('click',()=>deleteBlog(document.querySelector('[data-delete-post]').dataset.deletePost));
  document.querySelector('[data-action="new-page"]')?.addEventListener('click',()=>{captureForms();pageEditing=null;render()});
  document.querySelectorAll('[data-edit-page]').forEach(b=>b.onclick=()=>{captureForms();pageEditing=b.dataset.editPage;render()});
  document.querySelector('#page-form')?.addEventListener('submit',savePage);
  document.querySelectorAll('[data-delete-page]').forEach(b=>b.onclick=()=>deletePage(b.dataset.deletePage));
  document.querySelector('[data-action="new-media"]')?.addEventListener('click',()=>{captureForms();mediaEditing=null;render()});
  document.querySelectorAll('[data-edit-media]').forEach(b=>b.onclick=()=>{captureForms();mediaEditing=b.dataset.editMedia;render()});
  document.querySelector('#media-form')?.addEventListener('submit',saveMedia);
  document.querySelectorAll('[data-delete-media]').forEach(b=>b.onclick=()=>deleteMedia(b.dataset.deleteMedia));
  document.querySelectorAll('[data-copy-media-path]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copyMediaPath||'');toast('Public path copied.')}catch(_){toast('Clipboard unavailable; select the path manually.',true)}});
  document.querySelectorAll('[data-action="sync-pages"]').forEach(b=>b.onclick=syncContent);
  document.querySelector('#media-search')?.addEventListener('input',filterMedia);
  document.querySelector('#settings-form')?.addEventListener('submit',saveSettings);
  document.querySelector('#audit-filter')?.addEventListener('input',e=>document.querySelectorAll('[data-audit]').forEach(x=>x.hidden=!x.dataset.audit.includes(e.target.value.toLowerCase())));
  document.querySelector('[data-action="export"]')?.addEventListener('click',()=>{const k=document.querySelector('#export-kind').value,f=document.querySelector('#export-format').value;location.href=`/api/admin/export?kind=${encodeURIComponent(k)}&format=${encodeURIComponent(f)}`});
  document.querySelector('[data-order-note]')?.addEventListener('click',()=>{const id=document.querySelector('[data-order-note]').dataset.orderNote;openActionDialog({key:`order-note:${id}`,title:'Add order note',description:'Append an operator note to the agreement audit trail. This does not change funds or milestones.',fields:[{name:'note',label:'Note',type:'textarea',required:true,maxLength:1500,value:''}],submitLabel:'Add note',onSubmit:async values=>{const note=String(values.note||'').trim();if(note.length<3)throw new Error('Note must be at least 3 characters.');if(note.length>1500)throw new Error('Note must be 1500 characters or fewer.');await addOrderNote(id,note);await afterSandboxSave('Note added.')}})});
  document.querySelector('[data-readiness-retry]')?.addEventListener('click',()=>loadTab().catch(e=>toast(e.message,true)));
  if(tab==='blog'){filterBlog();updateBlogCounts();}
  restoreForms();
  if(tab==='blog'){filterBlog();updateBlogCounts();}
}

function filterListings(){
  const q=(document.querySelector('#listing-search').value||'').toLowerCase(),s=document.querySelector('#listing-status').value;
  let visible=0,total=0;
  document.querySelectorAll('#listing-rows tr[data-search]').forEach(row=>{total++;const hide=Boolean((q&&!row.dataset.search.includes(q))||(s&&row.dataset.status!==s));row.hidden=hide;if(!hide)visible++});
  const notice=document.querySelector('#listing-no-match');if(notice)notice.hidden=!(total>0&&visible===0);
}

function filterSupport(){
  const q=(document.querySelector('#support-search')?.value||'').toLowerCase(),s=document.querySelector('#support-status')?.value,c=document.querySelector('#support-category')?.value;
  let visible=0,total=0;
  document.querySelectorAll('#support-rows tr[data-support-search]').forEach(row=>{total++;const hide=Boolean((q&&!row.dataset.supportSearch.includes(q))||(s&&row.dataset.supportStatus!==s)||(c&&row.dataset.supportCategory!==c));row.hidden=hide;if(!hide)visible++});
  const notice=document.querySelector('#support-no-match');if(notice)notice.hidden=!(total>0&&visible===0);
}

function filterMedia(){
  const q=(document.querySelector('#media-search')?.value||'').toLowerCase();let visible=0,total=0;
  document.querySelectorAll('#media-rows tr[data-media-search]').forEach(row=>{total++;const hide=q&&!row.dataset.mediaSearch.includes(q);row.hidden=hide;if(!hide)visible++});
  const notice=document.querySelector('#media-no-match');if(notice)notice.hidden=!(total>0&&visible===0);
}
function savePage(event){
  event.preventDefault();const form=event.target,key=`#page-form:${form.dataset.id||'new'}`;if(legacyPending.has(key))return;const f=new FormData(form),id=form.dataset.id||'',current=id?snapshot.pages.find(x=>x.id===id):null,gen=authGeneration;let sections;
  try{sections=JSON.parse(String(f.get('sections')||'[]'));}catch(_){legacySetFormError(form,'Sections must be valid JSON.');return;}
  const fields={title:f.get('title'),path:f.get('path'),template:f.get('template'),status:f.get('status'),sections,seo:{title:f.get('seoTitle'),description:f.get('seoDescription'),canonical:f.get('canonical')}};const submit=event.submitter?.name,publish=submit==='publish'?(current?.status!=='published'):undefined;
  legacySetFormError(form,'');legacyPending.add(key);legacyDisableForm(form,true);
  command('save_page',{id:id||undefined,fields,...(publish===undefined?{}:{publish})}).then(async out=>{if(gen!==authGeneration)return;if(!out?.result)throw new Error('Delivery confirmation unavailable.');clearFormDraft(key);pageEditing=out.result;legacyPending.delete(key);await afterSandboxSave('Page saved.');}).catch(error=>{if(gen!==authGeneration)return;legacyPending.delete(key);legacySetFormError(form,error.message);legacyDisableForm(form,false);toast(error.message,true)});
}
function deletePage(id){openActionDialog({key:`delete-page:${id}`,title:'Delete page record',description:'Tracked website pages cannot be deleted; archive them instead. Custom page records can be removed.',fields:[],submitLabel:'Delete page',danger:true,onSubmit:async()=>{await command('delete_page',{id});pageEditing=null;await afterSandboxSave('Page record deleted.')}})}
async function syncContent(){if(!confirm('Sync tracked website routes and assets? Existing editor content will not be overwritten.'))return;try{await command('sync_pages',{});await afterSandboxSave('Website pages and media inventory synced.')}catch(error){toast(error.message,true)}}
function numberOrNull(value){const raw=String(value??'').trim();return raw===''?null:Number(raw)}
function saveMedia(event){
  event.preventDefault();const form=event.target,key=`#media-form:${form.dataset.id||'new'}`;if(legacyPending.has(key))return;const f=new FormData(form),id=form.dataset.id||'',gen=authGeneration;
  const fields={title:f.get('title'),path:f.get('path'),filename:f.get('filename'),kind:f.get('kind'),mime:f.get('mime'),width:numberOrNull(f.get('width')),height:numberOrNull(f.get('height')),alt:f.get('alt'),tags:String(f.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean)};
  legacySetFormError(form,'');legacyPending.add(key);legacyDisableForm(form,true);
  command('save_media',{id:id||undefined,fields}).then(async out=>{if(gen!==authGeneration)return;if(!out?.result)throw new Error('Delivery confirmation unavailable.');clearFormDraft(key);mediaEditing=out.result;legacyPending.delete(key);await afterSandboxSave('Media metadata saved.');}).catch(error=>{if(gen!==authGeneration)return;legacyPending.delete(key);legacySetFormError(form,error.message);legacyDisableForm(form,false);toast(error.message,true)});
}
function deleteMedia(id){openActionDialog({key:`delete-media:${id}`,title:'Delete media record',description:'This removes only the inventory record, not the source file. Media in use by pages cannot be deleted.',fields:[],submitLabel:'Delete record',danger:true,onSubmit:async()=>{await command('delete_media',{id});mediaEditing=null;await afterSandboxSave('Media record deleted.')}})}

function moderate(id){
  const listing=snapshot.listings.find(x=>x.id===id);
  const current=listing?.status==='pending'?'published':(listing?.status||'published');
  openActionDialog({
    key:`moderate:${id}`,
    title:'Change listing status',
    description:`Update the status for “${listing?.title||id}”. Hiding a listing requires a reason.`,
    fields:[
      {name:'decision',label:'New status',type:'select',required:true,value:current,options:['published','paused','hidden']},
      {name:'reason',label:'Operator reason (required for hidden)',type:'textarea',required:false,maxLength:1500,value:''}
    ],
    submitLabel:'Apply status',
    onSubmit:async values=>{
      const decision=values.decision;
      const reason=String(values.reason||'').trim();
      if(decision==='hidden'&&reason.length<15)throw new Error('A reason of at least 15 characters is required to hide a listing.');
      if(reason.length>1500)throw new Error('Reason must be 1500 characters or fewer.');
      await command('moderate_listing',{listingId:id,decision,reason});
      await afterSandboxSave('Listing status updated.');
    }
  });
}

function resolveReport(id){
  openActionDialog({
    key:`resolve:${id}`,
    title:'Resolve report',
    description:'Choose a resolution and optionally add a note for the audit trail.',
    fields:[
      {name:'resolution',label:'Resolution',type:'select',required:true,value:'actioned',options:['dismissed','actioned','escalated']},
      {name:'note',label:'Resolution note',type:'textarea',required:false,maxLength:1500,value:''}
    ],
    submitLabel:'Resolve report',
    onSubmit:async values=>{
      const note=String(values.note||'').trim();
      if(note.length>1500)throw new Error('Note must be 1500 characters or fewer.');
      await command('resolve_report',{reportId:id,resolution:values.resolution,note});
      await afterSandboxSave('Report resolved.');
    }
  });
}

function flagOrder(id){
  const item=snapshot.orders.find(x=>x.id===id);
  if(item?.adminFlag){
    openActionDialog({
      key:`flag-clear:${id}`,
      title:'Clear monitoring flag',
      description:'This removes the monitoring flag from the agreement. It does not change funds, milestones or dispute state.',
      fields:[],
      submitLabel:'Clear flag',
      onSubmit:async()=>{await command('flag_order',{orderId:id,flagged:false,reason:''});await afterSandboxSave('Flag cleared.')}
    });
    return;
  }
  openActionDialog({
    key:`flag-set:${id}`,
    title:'Flag agreement for monitoring',
    description:'Adds an operator monitoring flag. It cannot move funds or override dispute authority.',
    fields:[
      {name:'reason',label:'Reason for monitoring',type:'textarea',required:true,maxLength:1000,value:''}
    ],
    submitLabel:'Flag agreement',
    onSubmit:async values=>{
      const reason=String(values.reason||'').trim();
      if(reason.length<10)throw new Error('Reason must be at least 10 characters.');
      if(reason.length>1000)throw new Error('Reason must be 1000 characters or fewer.');
      await command('flag_order',{orderId:id,flagged:true,reason});
      await afterSandboxSave('Agreement flagged.');
    }
  });
}

async function addOrderNote(orderId,note){
  const trimmed=String(note||'').trim();
  if(trimmed.length<3)throw new Error('Note must be at least 3 characters.');
  if(trimmed.length>1500)throw new Error('Note must be 1500 characters or fewer.');
  await command('add_order_note',{orderId,note:trimmed});
}

function updateSupport(id){
  const item=snapshot.supportTickets.find(x=>x.id===id);
  openActionDialog({
    key:`support-update:${id}`,
    title:'Update ticket status',
    description:'Change the status and assignee for this local-only ticket.',
    fields:[
      {name:'status',label:'Status',type:'select',required:true,value:item?.status||'open',options:['open','in_progress','waiting_user','resolved','closed']},
      {name:'assignee',label:'Assignee handle (blank = unassigned)',type:'text',required:false,maxLength:100,value:item?.assignee||''}
    ],
    submitLabel:'Save ticket',
    onSubmit:async values=>{
      const assignee=String(values.assignee||'').trim();
      await command('support_update_ticket',{ticketId:id,status:values.status,assignee:assignee||null});
      await afterSandboxSave('Ticket updated.');
    }
  });
}

function replySupport(id){
  openActionDialog({
    key:`support-reply:${id}`,
    title:'Reply or internal note',
    description:'Internal notes are the safest default. Public replies are visible ONLY in the separate legacy sandbox support ticket view — not in any real visitor chat inbox, and not tied to a verified identity.',
    fields:[
      {name:'visibility',label:'Visibility',type:'select',required:true,value:'internal',options:[{value:'internal',label:'Internal note (default, safest — admin only)'},{value:'public',label:'Public reply (visible only in the legacy sandbox support ticket)'}]},
      {name:'body',label:'Message',type:'textarea',required:true,maxLength:5000,value:''}
    ],
    submitLabel:'Send',
    onSubmit:async values=>{
      const body=String(values.body||'').trim();
      if(body.length<3)throw new Error('Message must be at least 3 characters.');
      if(body.length>5000)throw new Error('Message must be 5000 characters or fewer.');
      await command('support_reply',{ticketId:id,body,visibility:values.visibility});
      await afterSandboxSave('Reply sent.');
    }
  });
}

async function saveBlog(event){
  event.preventDefault();
  const form=event.target;
  const key=legacyFormKey(form);
  if(legacyPending.has(key))return;
  const gen=authGeneration;
  const submit=event.submitter?.name;
  const f=new FormData(form);
  const fields={
    title:f.get('title'),
    slug:f.get('slug'),
    excerpt:f.get('excerpt'),
    body:f.get('body'),
    tags:String(f.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),
    author:f.get('author'),
    seo:{title:f.get('seoTitle'),description:f.get('seoDescription'),canonical:f.get('canonical'),ogImage:f.get('ogImage')}
  };
  const currentId=form.dataset.id||'';
  const current=currentId?snapshot.blog.find(x=>x.id===currentId):null;
  const publish=submit==='publish'?(current?.status!=='published'):undefined;
  legacySetFormError(form,'');
  legacyPending.add(key);
  legacyDisableForm(form,true);
  try{
    const out=await command('save_blog',{id:currentId||undefined,fields,...(publish===undefined?{}:{publish})});
    if(gen!==authGeneration)return;
    const resultId=typeof out?.result==='string'?out.result:null;
    if(!resultId){
      const e=new Error('Delivery confirmation unavailable. Your changes were not confirmed saved.');
      e.code='no_result';
      throw e;
    }
    clearFormDraft(key);
    editing=resultId;
    if(form.isConnected)form.remove();
    legacyPending.delete(key);
    try{
      await afterSandboxSave('Post saved.');
    }catch(refreshError){
      toast('Post saved; refresh to load editor.',false);
    }
  }catch(error){
    if(gen!==authGeneration)return;
    legacyPending.delete(key);
    const draft=formDrafts.get(key);
    const values=draft?draft.values:null;
    if(values)formDrafts.set(key,{values,error:error.message});
    legacySetFormError(form,error.message);
    legacyDisableForm(form,false);
    toast(error.message,true);
  }
}

function deleteBlog(id){
  openActionDialog({
    key:`delete-post:${id}`,
    title:'Delete post',
    description:'This permanently removes the post from the local sandbox journal.',
    fields:[],
    submitLabel:'Delete post',
    danger:true,
    onSubmit:async()=>{
      await command('delete_blog',{id});
      clearFormDraft('#blog-form:'+id);
      editing=null;
      const stale=document.querySelector('#blog-form');
      if(stale)stale.remove();
      await afterSandboxSave('Post deleted.');
    }
  });
}

async function saveSettings(event){
  event.preventDefault();
  const form=event.target;
  const key=legacyFormKey(form);
  if(legacyPending.has(key))return;
  const gen=authGeneration;
  const f=new FormData(form);
  const patch={
    siteName:f.get('siteName'),
    tagline:f.get('tagline'),
    contactEmail:f.get('contactEmail'),
    maintenanceMode:f.get('maintenanceMode')==='on',
    featureFlags:{blog:f.get('blog')==='on',reports:f.get('reports')==='on',domainOffers:f.get('domainOffers')==='on',accountCreation:f.get('accountCreation')==='on',walletSignIn:f.get('walletSignIn')==='on'},
    seo:{defaultTitle:f.get('defaultTitle'),defaultDescription:f.get('defaultDescription'),robots:f.get('robots')}
  };
  legacySetFormError(form,'');
  legacyPending.add(key);
  legacyDisableForm(form,true);
  try{
    await command('update_settings',{patch});
    if(gen!==authGeneration)return;
    clearFormDraft(key);
    if(form.isConnected)form.remove();
    legacyPending.delete(key);
    await afterSandboxSave('Settings saved.');
  }catch(error){
    if(gen!==authGeneration)return;
    legacyPending.delete(key);
    const draft=formDrafts.get(key);
    const values=draft?draft.values:null;
    if(values)formDrafts.set(key,{values,error:error.message});
    legacySetFormError(form,error.message);
    legacyDisableForm(form,false);
    toast(error.message,true);
  }
}
