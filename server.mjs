/** Loopback sandbox: identities are simulated and there is no real custody.
 * Internet exposure is limited to the reviewed Nginx route allowlist.
 * Never expose this whole server directly; visitor chat may contain personal content. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { WalletProofs } from './src/integrations/wallet-auth.mjs';
import { WalletAccountSessions } from './src/integrations/account-auth.mjs';
import { buildMoonPayURL,moonPayPublicConfig } from './src/integrations/moonpay.mjs';
import { applyCommand, createSeedState, assertInvariants } from './src/universal-domain.mjs';
import { migrateState } from './src/state-migrations.mjs';
import { ensureAdminState, adminSnapshot, getAdminAnalytics, auditRows, exportRows, applyAdminCommand } from './src/admin.mjs';
import { createTicket, findTicket, publicTicket, addPublicReply, adminTicketSummary } from './src/support.mjs';
import { OperationJournal, stateHash } from './src/operations/journal.mjs';
import { custodyReadiness } from './src/custody/readiness.mjs';
import { executeDueAutopay } from './src/payroll-scheduler.mjs';
import { payrollSummary } from './src/payroll-state.mjs';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_CSRF_COOKIE,
  loadAdminConfig,
  verifyPassword,
  constantTimeEqual,
  isLoginRateLimited,
  recordLoginFailure,
  clearLoginFailures,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  sessionCookie,
  csrfCookie,
  clearAuthCookies,
  csrfValid
} from './src/admin-auth.mjs';
import { loadEngagementConfig, trustedRequest } from './src/engagement/security.mjs';
import { createEngagement, isPublicEngagementPath, isEngagementPath } from './src/engagement/http.mjs';
import { renderManagedPage } from './src/content.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
// Minimal .env loader: values only, never shell evaluation; existing process env wins.
const envPath=path.join(root,'.env');
if(fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(match&&process.env[match[1]]===undefined){let v=match[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[match[1]]=v;}}
const port=Number(process.env.PORT || 4173);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be an integer from 1024 to 65535.');
if(process.env.ESCROW_MODE && process.env.ESCROW_MODE!=='sandbox') throw new Error('This build supports SANDBOX ONLY. No live-money adapter exists.');
let activeAdminVerifications=0;
const adminConfig=loadAdminConfig(process.env);
const adminOrigin=process.env.ADMIN_ORIGIN || '';
if(!adminConfig)console.warn('[admin] ADMIN_EMAIL or ADMIN_PASSWORD_HASH is missing/invalid; admin login is disabled.');
const dataFile=process.env.DATA_FILE || path.join(root,'data','universal-sandbox.json');
const journalFile=process.env.JOURNAL_FILE || `${dataFile}.journal.jsonl`;
const engagementConfig=loadEngagementConfig(process.env,port);
const engagementDbFile=process.env.ENGAGEMENT_DB_FILE || path.join(path.dirname(dataFile),'engagement.sqlite');
if(path.resolve(engagementDbFile)===path.resolve(dataFile)||path.resolve(engagementDbFile)===path.resolve(journalFile))throw new Error('ENGAGEMENT_DB_FILE must not equal DATA_FILE or JOURNAL_FILE.');
const engagement=createEngagement({file:engagementDbFile,env:process.env,port,config:engagementConfig});
const journal=new OperationJournal(journalFile);
const journalAtStartup=journal.verify();
if(!journalAtStartup.valid) throw new Error(`Operation journal ${journalFile} failed integrity verification: ${journalAtStartup.error}`);
fs.mkdirSync(path.dirname(dataFile),{recursive:true});
function readDataFileBytes(){
  if(!fs.existsSync(dataFile))return null;
  return fs.readFileSync(dataFile);
}
function decodeUtf8(bytes){
  let text=bytes.toString('utf8');
  if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
  return text;
}
function atomicWriteJson(target,obj){
  const dir=path.dirname(target);
  const tmp=path.join(dir,`.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(obj,null,2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,target);
    try{const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch{}
  }catch(err){
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
    throw err;
  }
}

let state;
{
  const originalBytes=readDataFileBytes();
  if(originalBytes===null){
    const seed=createSeedState();
    ensureAdminState(seed);
    assertInvariants(seed);
    atomicWriteJson(dataFile,seed);
    state=seed;
  }else{
    let parsed;
    try{
      parsed=JSON.parse(decodeUtf8(originalBytes));
    }catch(err){
      throw new Error(`Data file ${dataFile} is not valid JSON; refusing to start. Original file left untouched.`);
    }
    const isLegacy=!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.schemaVersion===undefined;
    let migrated;
    try{
      migrated=migrateState(parsed);
    }catch(err){
      throw new Error(`State migration failed for ${dataFile}: ${err.message}. Original file left untouched.`);
    }
    const adminChanged=ensureAdminState(migrated);
    assertInvariants(migrated);
    if(isLegacy){
      const currentBytes=readDataFileBytes();
      if(currentBytes===null||!currentBytes.equals(originalBytes)){
        throw new Error(`Data file ${dataFile} changed during startup migration; aborting to avoid overwriting concurrent writes.`);
      }
      const ts=new Date().toISOString().replace(/[:.]/g,'-');
      const backupPath=`${dataFile}.pre-escrow-global-v3-${ts}-${randomUUID()}.json`;
      let bfd;
      try{
        bfd=fs.openSync(backupPath,'wx',0o600);
        fs.writeFileSync(bfd,originalBytes);
        fs.fsyncSync(bfd);
        fs.closeSync(bfd);bfd=undefined;
      }catch(err){
        if(bfd!==undefined){try{fs.closeSync(bfd);}catch{}}
        throw new Error(`Failed to create pre-migration backup at ${backupPath}: ${err.message}. Aborting; original file left untouched.`);
      }
      console.warn(`[migration] Legacy state detected. Backup written adjacent to data file: ${backupPath}`);
      const verifyBytes=readDataFileBytes();
      if(verifyBytes===null||!verifyBytes.equals(originalBytes)){
        throw new Error(`Data file ${dataFile} changed before migration write; aborting.`);
      }
      atomicWriteJson(dataFile,migrated);
    }else if(adminChanged){
      atomicWriteJson(dataFile,migrated);
    }
    state=migrated;
  }
}

function persist(next,metadata={}){
  assertInvariants(next);
  const dir=path.dirname(dataFile);
  const tmp=path.join(dir,`.${path.basename(dataFile)}.${process.pid}.${randomUUID()}.tmp`);
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(next,null,2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,dataFile);
    try{const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch{}
    journal.append({
      ...metadata,
      stateVersion:next.version,
      stateHash:stateHash(next)
    });
    state=next;
  }catch(err){
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
    throw err;
  }
}

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const files=new Map([
  ['/','public/index.html'],['/index.html','public/index.html'],['/app.mjs','public/app.mjs'],
  ['/admin','public/admin.html'],['/admin/','public/admin.html'],['/admin.html','public/admin.html'],['/admin.mjs','public/admin.mjs'],['/admin.css','public/admin.css'],
  ['/blog','public/blog.html'],['/blog/','public/blog.html'],['/blog.mjs','public/blog.mjs'],['/blog.css','public/blog.css'],
  ['/about','public/about.html'],['/about/','public/about.html'],['/about.css','public/about.css'],
  ['/disclaimer','public/disclaimer.html'],['/disclaimer/','public/disclaimer.html'],['/disclaimer.css','public/disclaimer.css'],['/disclaimer.mjs','public/disclaimer.mjs'],
  ['/support','public/support.html'],['/support/','public/support.html'],['/support.mjs','public/support.mjs'],['/support.css','public/support.css'],
  ['/styles.css','public/styles.css'],['/universal.css','public/universal.css'],['/domain.mjs','src/domain.mjs'],['/universal-domain.mjs','src/universal-domain.mjs'],['/payroll-state.mjs','src/payroll-state.mjs'],['/agreement.mjs','src/agreement.mjs'],['/catalog.mjs','src/catalog.mjs'],['/payments.mjs','src/payments.mjs'],['/payroll-domain.mjs','src/payroll-domain.mjs'],['/favicon.svg','public/favicon.svg'],
 ...['universal-ui.mjs','learn.mjs','tutorial-visuals.mjs','qr.mjs','wallet.mjs','jupiter.mjs','manifest.webmanifest','sw.js'].map(x=>['/'+x,'public/'+x]),
 ['/settlement-simulator.mjs','src/settlement-simulator.mjs'],
  ...['icon-192.png','icon-512.png'].map(x=>['/icons/'+x,'public/icons/'+x]),
  ['/brand-tokens.css','public/brand-tokens.css'],
  ['/content-page.css','public/content-page.css'],
  ['/agreement-readiness.mjs','src/agreement-readiness.mjs'],
  ['/action-center.mjs','src/action-center.mjs'],
  ['/images/escrow-global/hero-global-settlement.webp','public/images/escrow-global/hero-global-settlement.webp'],
  ['/images/escrow-global/agreement-milestones.webp','public/images/escrow-global/agreement-milestones.webp'],
  ['/settlement-assets.mjs','src/settlement-assets.mjs'],
  ['/state-migrations.mjs','src/state-migrations.mjs'],
  ['/money.mjs','public/money.mjs'],
  ['/brand.mjs','src/brand.mjs'],
  ['/visitor-tools.mjs','public/visitor-tools.mjs'],
  ['/visitor-tools.css','public/visitor-tools.css']
]);
function localCustodyArtifactStatus(){
  const source=path.join(root,'packages','custody-contracts','program','programs','escrow-global','src','lib.rs');
  const artifact=path.join(root,'packages','custody-contracts','program','target','deploy','escrow_global.so');
  const idl=path.join(root,'packages','custody-contracts','program','target','idl','escrow_global.json');
  try{
    const sourceMtime=fs.statSync(source).mtimeMs;
    const artifactMtime=fs.statSync(artifact).mtimeMs;
    const idlMtime=fs.statSync(idl).mtimeMs;
    return {localArtifact:true,localArtifactFresh:artifactMtime>=sourceMtime&&idlMtime>=sourceMtime};
  }catch{return {localArtifact:false,localArtifactFresh:false};}
}

function runPayrollScheduler(){
  const now=Date.now();
  const out=executeDueAutopay(state,now);
  if(out.failures.length)for(const failure of out.failures)console.warn(`[payroll] sandbox scheduler skipped ${failure.actorId}/${failure.planId}/${failure.period}: ${failure.error}`);
  if(!out.executed.length)return 0;
  persist(out.state,{kind:'payroll.scheduler',executed:out.executed.length,periods:out.executed});
  return out.executed.length;
}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function clientState(actorId){
  const view=structuredClone(state);
  delete view.supportTickets;
  if(view.payrollByUser){const own=view.payrollByUser[actorId];view.payrollByUser=own?{[actorId]:own}:{};}
  return view;
}
async function body(req,maxBytes=65536){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('Use Content-Type: application/json.');
  let text='';for await(const chunk of req){text+=chunk; if(Buffer.byteLength(text)>maxBytes){const error=new Error(`Request exceeds ${Math.round(maxBytes/1024/1024*10)/10} MB.`);error.code='PAYLOAD_TOO_LARGE';throw error;}}
  return JSON.parse(text);
}
const moonpay={environment:process.env.MOONPAY_ENV||'sandbox',allowLive:process.env.ALLOW_LIVE_ONRAMP==='true',publicKey:process.env.MOONPAY_PUBLIC_KEY||'',secretKey:process.env.MOONPAY_SECRET_KEY||'',currencyCodes:{USDC:process.env.MOONPAY_SOLANA_USDC_CODE||'',USDT:process.env.MOONPAY_SOLANA_USDT_CODE||''},returnURL:process.env.MOONPAY_RETURN_URL||''};
const proofs=new Map(['127.0.0.1','localhost'].map(host=>[host,new WalletProofs({origin:`http://${host}:${port}`})]));
const accountSessions=new Map(['127.0.0.1','localhost'].map(host=>[host,new WalletAccountSessions({origin:`http://${host}:${port}`})]));
const rate=new Map();
function limit(req){const key=req.socket.remoteAddress||'unknown',now=Date.now(),old=rate.get(key);if(!old||now>old.until){rate.set(key,{n:1,until:now+60000});return;}if(++old.n>60)throw new Error('Too many payment requests. Retry in a minute.');}
const supportRate=new Map();
function supportLimit(req){const key=req.socket.remoteAddress||'unknown',now=Date.now(),old=supportRate.get(key);if(!old||now>old.until){supportRate.set(key,{n:1,until:now+60000});return;}if(++old.n>10){const error=new Error('Too many support submissions. Try again in a minute.');error.code='RATE_LIMITED';throw error;}}
function exact(data,keys){if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Object payload required.');for(const k of Object.keys(data))if(!keys.includes(k))throw new Error(`Unsupported input: ${k}`);}
function cookie(req,name){return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.slice(name.length+1)||null;}
function htmlEscape(value){return String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
function blogArticle(value){return String(value??'').split(/\r?\n\r?\n/).map(p=>`<p>${htmlEscape(p).replace(/\r?\n/g,'<br>')}</p>`).join('');}
function blogHtml(post){
  const title=post?.seo?.title||post?.title||state.settings.seo.defaultTitle;
  const description=post?.seo?.description||post?.excerpt||state.settings.seo.defaultDescription;
  const canonical=post?.seo?.canonical||`/blog/${post?.slug||''}`;
  const image=post?.seo?.ogImage?`<meta property="og:image" content="${htmlEscape(post.seo.ogImage)}">`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><meta name="description" content="${htmlEscape(description)}"><meta name="robots" content="${htmlEscape(state.settings.seo.robots)}"><link rel="canonical" href="${htmlEscape(canonical)}"><meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${htmlEscape(description)}">${image}<link rel="stylesheet" href="/blog.css"><link rel="stylesheet" href="/visitor-tools.css" data-escrow-engagement><script type="module" src="/visitor-tools.mjs" data-escrow-engagement data-analytics-endpoint="https://www.escrowglobal.io:9443/api/analytics/event"></script></head><body><main class="blog-shell"><a href="/blog">← All stories</a><article><p class="eyebrow">ESCROW GLOBAL JOURNAL</p><h1>${htmlEscape(post.title)}</h1><p class="excerpt">${htmlEscape(post.excerpt)}</p><p class="byline">${htmlEscape(post.author)} · ${new Date(post.publishedAt||post.updatedAt).toLocaleDateString('en-US',{dateStyle:'long'})}</p><div class="blog-body">${blogArticle(post.body)}</div></article></main></body></html>`;
}
function csvCell(value){const raw=Array.isArray(value)?value.join(' | '):value&&typeof value==='object'?JSON.stringify(value):String(value??'');return /[,"\n\r]/.test(raw)?`"${raw.replaceAll('"','""')}"`:raw;}
function csvRows(rows){
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row||{})))];
  return [keys.map(csvCell).join(','),...rows.map(row=>keys.map(key=>csvCell(row?.[key])).join(','))].join('\r\n')+'\r\n';
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Sandbox-Notice','sandbox; admin-session-required; no-real-custody');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://plugin.jup.ag blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-src https:; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(res,403,{error:'Only localhost is permitted.',code:'FORBIDDEN'});
  let url;
  try{url=new URL(req.url,`http://127.0.0.1:${port}`);}catch{return send(res,400,{error:'Malformed request URL.',code:'BAD_REQUEST'});}
  const origin=req.headers.origin;
  const isPublicEngagement=isPublicEngagementPath(url.pathname);
  const allowedOrigins=isPublicEngagement
    ? engagementConfig.publicOrigins
    : [`http://127.0.0.1:${port}`,`http://localhost:${port}`,...(adminOrigin?[adminOrigin]:[])];
  if(origin && !allowedOrigins.includes(origin))return send(res,403,{error:'Cross-origin access is not allowed.',code:'FORBIDDEN'});
  try{
    const requestCookies=parseCookies(req.headers.cookie);
    const requestSession=()=>getSession(requestCookies[ADMIN_SESSION_COOKIE]);
    const requireAdmin=()=>{
      const session=requestSession();
      if(!session){send(res,401,{error:'Admin sign-in required.',code:'ADMIN_UNAUTHORIZED'});return null;}
      return session;
    };
    const requireAdminMutation=()=>{
      const session=requireAdmin();
      if(!session)return null;
      const csrfHeader=Array.isArray(req.headers['x-csrf-token'])?req.headers['x-csrf-token'][0]:req.headers['x-csrf-token'];
      if(!csrfValid(session,csrfHeader,requestCookies[ADMIN_CSRF_COOKIE])){send(res,403,{error:'A valid CSRF token is required.',code:'ADMIN_CSRF_INVALID'});return null;}
      return session;
    };

    if(req.method==='GET'&&url.pathname==='/api/admin/session'){
      const session=requestSession();
      if(!session)return send(res,401,{error:'Admin sign-in required.',code:'ADMIN_UNAUTHORIZED'});
      return send(res,200,{email:session.email,csrfToken:session.csrf});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/login'){
      if(!adminConfig)return send(res,503,{error:'Admin authentication is not configured.',code:'ADMIN_AUTH_NOT_CONFIGURED'});
      const data=await body(req,16384);exact(data,['email','password']);
      if(typeof data.email!=='string'||data.email.length>254||typeof data.password!=='string'||data.password.length<1||data.password.length>1024)return send(res,400,{error:'Invalid email or password.',code:'ADMIN_INVALID_INPUT'});
      const email=data.email.trim().toLowerCase();
      const ip=trustedRequest(req,engagementConfig).source;
      if(isLoginRateLimited(ip,email)){res.setHeader('Retry-After','900');return send(res,429,{error:'Too many sign-in attempts. Try again later.',code:'ADMIN_LOGIN_RATE_LIMITED'});}
      if(activeAdminVerifications>=2){res.setHeader('Retry-After','1');return send(res,429,{error:'Sign-in is busy. Try again shortly.',code:'ADMIN_LOGIN_BUSY'});}
      const emailOk=constantTimeEqual(email,adminConfig.email);
      activeAdminVerifications++;
      let passwordOk;
      try{passwordOk=await verifyPassword(data.password,adminConfig.passwordHash);}finally{activeAdminVerifications--;}
      if(!emailOk||!passwordOk){recordLoginFailure(ip,email);return send(res,401,{error:'Invalid email or password.',code:'ADMIN_INVALID_CREDENTIALS'});}
      clearLoginFailures(ip,email);
      if(requestCookies[ADMIN_SESSION_COOKIE])destroySession(requestCookies[ADMIN_SESSION_COOKIE]);
      const session=createSession(adminConfig.email);
      res.setHeader('Set-Cookie',[sessionCookie(session.sid),csrfCookie(session.csrf)]);
      return send(res,200,{email:session.email,csrfToken:session.csrf});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){
      const session=requireAdminMutation();
      if(!session)return;
      destroySession(session.sid);
      res.setHeader('Set-Cookie',clearAuthCookies());
      return send(res,200,{ok:true});
    }

    const isAdminRequest=url.pathname.startsWith('/api/admin/')||url.pathname==='/api/custody/readiness';
    const adminSession=isAdminRequest?requireAdmin():null;
    if(isAdminRequest&&!adminSession)return;
    if(isAdminRequest&&req.method==='POST'&&!requireAdminMutation())return;

    if(isEngagementPath(url.pathname)){
      const handled=await engagement.handle(req,res,url,adminSession);
      if(handled)return;
    }

    if(req.method==='GET'&&url.pathname==='/api/admin/overview')return send(res,200,adminSnapshot(state,Math.min(Math.max(Number(url.searchParams.get('days'))||30,7),90)));
    if(req.method==='GET'&&url.pathname==='/api/admin/analytics')return send(res,200,getAdminAnalytics(state,Math.min(Math.max(Number(url.searchParams.get('days'))||30,7),90)));
    if(req.method==='GET'&&url.pathname==='/api/admin/audit')return send(res,200,{rows:auditRows(state,url.searchParams.get('limit'))});
    if(req.method==='GET'&&url.pathname==='/api/admin/journal')return send(res,200,(()=>{const page=journal.page(url.searchParams.get('limit'),url.searchParams.get('before'));return {journal:{...journal.verify(),file:journal.file},...page};})());
    if(req.method==='GET'&&url.pathname==='/api/admin/reconciliation'){
      const health=journal.verify(),latest=health.valid&&journal.rows(1)[0];
      return send(res,200,{stateVersion:state.version,stateHash:stateHash(state),journal:health,lastJournalStateVersion:latest?.stateVersion??null,lastJournalStateHash:latest?.stateHash??null,inSync:Boolean(health.valid&&latest&&latest.stateVersion===state.version&&latest.stateHash===stateHash(state))});
    }
    if(req.method==='GET'&&url.pathname==='/api/custody/readiness')return send(res,200,custodyReadiness({program:false,...localCustodyArtifactStatus()}));
    if(req.method==='GET'&&url.pathname==='/api/admin/support/tickets'){
      const q=(url.searchParams.get('q')||'').toLowerCase(),status=url.searchParams.get('status'),category=url.searchParams.get('category'),severity=url.searchParams.get('severity');
      const tickets=state.supportTickets.map(adminTicketSummary).filter(ticket=>(!q||`${ticket.subject} ${ticket.description} ${ticket.id}`.toLowerCase().includes(q))&&(!status||ticket.status===status)&&(!category||ticket.category===category)&&(!severity||ticket.severity===severity));return send(res,200,{tickets,analytics:getAdminAnalytics(state).support});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/admin/support/tickets/')&&url.pathname.includes('/attachments/')){
      const match=url.pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)\/attachments\/([^/]+)$/);if(!match)return send(res,404,{error:'Attachment not found.'});
      const ticket=findTicket(state,decodeURIComponent(match[1])),attachment=ticket.attachments.find(x=>x.id===decodeURIComponent(match[2]));if(!attachment)return send(res,404,{error:'Attachment not found.'});res.writeHead(200,{'Content-Type':attachment.mime,'Content-Length':String(attachment.size),'Content-Disposition':`inline; filename="${attachment.filename.replace(/[^A-Za-z0-9._-]/g,'_')}"`,'Cache-Control':'no-store'});return res.end(Buffer.from(attachment.dataB64,'base64'));
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/admin/support/tickets/')){const ticket=findTicket(state,decodeURIComponent(url.pathname.slice('/api/admin/support/tickets/'.length)));return send(res,200,{ticket:{...ticket,attachments:ticket.attachments.map(({dataB64,...meta})=>meta)}});}
    if(req.method==='GET'&&url.pathname==='/api/admin/export'){
      const kind=url.searchParams.get('kind')||'listings',format=url.searchParams.get('format')||'json',rows=exportRows(state,kind);
      if(!['json','csv'].includes(format))throw new Error('Unsupported export format.');
      const stamp=new Date().toISOString().slice(0,10),body=format==='csv'?csvRows(rows):JSON.stringify(rows,null,2);
      res.writeHead(200,{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="escrow-global-${kind}-${stamp}.${format}"`,'Cache-Control':'no-store'});return res.end(body);
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/command'){
      const data=await body(req);exact(data,['actorId','command','payload']);
      if(data.actorId!=='reviewer')return send(res,403,{error:'The authenticated admin session cannot impersonate another actor.',code:'ADMIN_ACTOR_MISMATCH'});
      const actorId=data.actorId;
      const next=applyAdminCommand(state,actorId,data.command,data.payload);
      persist(next.state,{kind:'admin.command',actorId,command:data.command,result:next.result});return send(res,200,next);
    }
    if(req.method==='POST'&&url.pathname==='/api/support/tickets'){
      supportLimit(req);const data=await body(req,8*1024*1024),next=structuredClone(state);const ticket=createTicket(next,data);next.version+=1;persist(next,{kind:'support.ticket.create',result:ticket.id});return send(res,201,{id:ticket.id,status:ticket.status,createdAt:ticket.createdAt,notice:'Keep this ticket ID to check replies. This local sandbox does not verify identity or store contact details.'});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/support/tickets/')){const ticket=findTicket(state,decodeURIComponent(url.pathname.slice('/api/support/tickets/'.length)));return send(res,200,{ticket:publicTicket(ticket)});}
    if(req.method==='POST'&&url.pathname.startsWith('/api/support/tickets/')&&url.pathname.endsWith('/replies')){supportLimit(req);const ticketId=decodeURIComponent(url.pathname.slice('/api/support/tickets/'.length,-'/replies'.length));const data=await body(req);exact(data,['body']);const next=structuredClone(state),ticket=findTicket(next,ticketId);if(['resolved','closed'].includes(ticket.status)){const error=new Error('Reopen the ticket before replying.');error.code='CONFLICT';throw error;}const reply=addPublicReply(ticket,data.body);next.version+=1;persist(next,{kind:'support.ticket.reply',result:ticketId});return send(res,201,{reply:{id:reply.id,createdAt:reply.createdAt,author:reply.author,body:reply.body},ticket:publicTicket(ticket)});}
    if(req.method==='GET'&&url.pathname==='/api/blog'){
      const posts=state.blog.filter(post=>post.status==='published').sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0));return send(res,200,{settings:{siteName:state.settings.siteName,tagline:state.settings.tagline,seo:state.settings.seo},posts});
    }
    // About is content-only today. Keep the disclaimer's interactive risk
    // acknowledgement on its original source file until that behavior is
    // represented as a first-class block.
    if(req.method==='GET'&&url.pathname==='/about'){
      const page=state.pages?.find(item=>item.path===url.pathname&&item.status==='published');
      if(page){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(renderManagedPage(page,state.settings,state.media));}
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/blog/')){
      const slug=decodeURIComponent(url.pathname.slice('/api/blog/'.length)),post=state.blog.find(item=>item.slug===slug&&item.status==='published');if(!post)return send(res,404,{error:'Blog post not found.'});return send(res,200,{post});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/blog/')&&url.pathname!=='/blog/'){
      const slug=decodeURIComponent(url.pathname.slice('/blog/'.length)),post=state.blog.find(item=>item.slug===slug&&item.status==='published');if(!post)return send(res,404,{error:'Blog post not found.'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(blogHtml(post));
    }
    if(req.method==='GET'&&url.pathname==='/api/payments/config')return send(res,200,{escrow:{mode:'sandbox',liveCustody:false},accountAuth:{available:true,authorizesEscrow:false,purpose:'account-session-only'},featureFlags:{accountCreation:state.settings?.featureFlags?.accountCreation===true,walletSignIn:state.settings?.featureFlags?.walletSignIn===true},moonpay:moonPayPublicConfig(moonpay),jupiter:{pluginURL:'https://plugin.jup.ag/plugin-v1.js',network:'mainnet-beta',optIn:true},jupiterSpend:{merchantAPIConfigured:false,guideOnly:true},nativeLiveEnabled:false});
    if(req.method==='POST'&&url.pathname.startsWith('/api/wallet/')){
      limit(req);const data=await body(req),proof=proofs.get(host.split(':')[0]);
      if(url.pathname==='/api/wallet/challenge'){exact(data,['address']);return send(res,200,proof.challenge(data.address));}
      if(url.pathname==='/api/wallet/verify'){exact(data,['id','signature']);const verified=proof.verify(data);res.setHeader('Set-Cookie',`pact_wallet=${verified.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300`);return send(res,200,{address:verified.address,purpose:'onramp-prefill-only',expiresIn:300});}
    }
    if((req.method==='POST'&&url.pathname.startsWith('/api/auth/'))||(req.method==='GET'&&url.pathname==='/api/auth/session')){
      limit(req);const auth=accountSessions.get(host.split(':')[0]);
      if(req.method==='POST'&&url.pathname==='/api/auth/challenge'){const data=await body(req);exact(data,['address']);return send(res,200,auth.challenge(data.address));}
      if(req.method==='POST'&&url.pathname==='/api/auth/verify'){const data=await body(req);exact(data,['id','signature']);const verified=auth.verify(data);res.setHeader('Set-Cookie',`pact_account_session=${verified.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300`);return send(res,200,{address:verified.address,accountId:verified.accountId,scopes:verified.scopes,purpose:'account-session-only',expiresIn:Math.max(0,Math.floor((verified.expires-Date.now())/1000))});}
      if(req.method==='GET'&&url.pathname==='/api/auth/session'){const active=auth.session(cookie(req,'pact_account_session'));if(!active)return send(res,401,{error:'No active account session.'});return send(res,200,{address:active.address,accountId:active.accountId,scopes:active.scopes,purpose:'account-session-only',expiresIn:Math.max(0,Math.floor((active.expires-Date.now())/1000))});}
      if(req.method==='POST'&&url.pathname==='/api/auth/logout'){auth.revoke(cookie(req,'pact_account_session'));res.setHeader('Set-Cookie','pact_account_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');return send(res,200,{ok:true});}
    }
    if(req.method==='POST'&&url.pathname==='/api/onramp/moonpay/session'){
      limit(req);const data=await body(req);exact(data,['token','amount','fiat','method']);
      const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('pact_wallet='))?.slice('pact_wallet='.length);
      const session=proofs.get(host.split(':')[0]).session(token);if(!session)return send(res,401,{error:'Verify ownership of your receiving wallet first.'});
      // This local server NEVER trusts forwarded headers. Live MoonPay therefore remains blocked on loopback.
      const checkout=buildMoonPayURL({...data,address:session.address},moonpay,{publicIp:req.socket.remoteAddress,requestId:randomUUID()});
      return send(res,200,{url:checkout,destination:'user-wallet-not-escrow',environment:moonpay.environment});
    }
    if(url.pathname==='/api/payments/escrow-transaction')return send(res,501,{error:'Live custody is not implemented. Deploy and audit a restricted-payout escrow program and reconciliation service before enabling funding.',code:'LIVE_CUSTODY_UNAVAILABLE'});
    if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,mode:'sandbox',realFunds:false});
    if(req.method==='GET'&&url.pathname==='/api/state'){const publicState=structuredClone(state);delete publicState.supportTickets;delete publicState.payrollByUser;return send(res,200,{state:publicState,mode:'sandbox',warning:'All demo identities and evidence are local and switchable. Payroll records are account-scoped and omitted from this public sandbox snapshot. Not authentication; no blockchain.'});}
    if(req.method==='GET'&&url.pathname==='/api/payroll'){
      limit(req);
      const actorId=url.searchParams.get('actorId')||'';
      if(typeof actorId!=='string'||actorId.length>80||!state.users.some(user=>user.id===actorId))return send(res,403,{error:'Unknown sandbox account.',code:'FORBIDDEN'});
      const payroll=structuredClone(state.payrollByUser?.[actorId]||{version:1,staff:[],plans:[],runs:[]});
      return send(res,200,{payroll,summary:payrollSummary(state,actorId),actorId,mode:'sandbox',warning:'Sandbox account payroll snapshot. This endpoint is not authentication and never authorizes live payouts.'});
    }
    if(req.method==='POST'&&url.pathname==='/api/command'){
      const data=await body(req);
      for(const key of Object.keys(data))if(!['actorId','command','payload','idempotencyKey'].includes(key))throw new Error(`Unsupported envelope field: ${key}`);
      if(typeof data.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(data.idempotencyKey))throw new Error('A valid idempotency key is required.');
      const signature=createHash('sha256').update(JSON.stringify([data.actorId,data.command,data.payload])).digest('hex');
      const previous=(state.processedCommands||[]).find(x=>x.key===data.idempotencyKey);
      if(previous){
        if(previous.signature!==signature)return send(res,409,{error:'Idempotency key already used for another command.'});
        return send(res,200,{state:clientState(data.actorId),result:previous.result,replayed:true});
      }
      // No await between apply + synchronous atomic file replacement: one process, serial commits.
      const out=applyCommand(state,data.actorId,data.command,data.payload);
      // Keep the sandbox's idempotency journal durable in the persisted state.
      // Trimming this list can re-execute an old command after a later retry,
      // which is especially dangerous when a command creates an agreement.
      out.state.processedCommands=[...(state.processedCommands||[]),{key:data.idempotencyKey,signature,result:out.result,processedAt:Date.now()}];
      persist(out.state,{kind:'domain.command',actorId:data.actorId,command:data.command,idempotencyKey:data.idempotencyKey,result:out.result});return send(res,200,{state:clientState(data.actorId),result:out.result});
    }
    if(req.method==='GET'&&files.has(url.pathname)){
      const file=path.join(root,files.get(url.pathname));
      if(!fs.existsSync(file))return send(res,404,{error:'Not found.'});
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});return fs.createReadStream(file).pipe(res);
    }
    send(res,404,{error:'Not found.'});
  }catch(error){const status=error.code==='FORBIDDEN'?403:error.code==='STALE_VERSION'||error.code==='CONFLICT'?409:error.code==='PAYLOAD_TOO_LARGE'?413:error.code==='UNSUPPORTED_MEDIA_TYPE'?415:error.code==='RATE_LIMITED'?429:error.code==='SERVICE_UNAVAILABLE'?503:400;send(res,status,{error:error.message,code:error.code||'BAD_REQUEST'});}
});
server.on('close',()=>engagement.close());
const payrollScheduler=setInterval(runPayrollScheduler,60000);payrollScheduler.unref?.();
// Catch up an already-due sandbox schedule after a clean process restart
// instead of waiting for the first interval tick. The same clone-and-persist
// safety boundary is used as for periodic ticks.
const payrollStartupTick=setTimeout(runPayrollScheduler,0);payrollStartupTick.unref?.();
server.on('close',()=>clearInterval(payrollScheduler));
server.on('close',()=>clearTimeout(payrollStartupTick));
server.listen(port,'127.0.0.1',()=>console.log(`\nESCROW GLOBAL LOCAL SANDBOX\nOpen http://127.0.0.1:${port}\nNo real funds. No blockchain. Do not expose this server publicly.\nData: ${dataFile}\nEngagement DB: ${engagementDbFile}\n`));
