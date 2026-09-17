from pathlib import Path
import json,os,subprocess,socket,time,tempfile,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[1];w=r/'docs/rebrand/escrow-global/evidence';w.mkdir(parents=True,exist_ok=True);url=(r/'escrow-global-preview.html').as_uri();old='pact-universal-sandbox-v2';new='escrow-global-sandbox-v3';checks=[]
fixture=json.loads((r/'tests/fixtures/legacy-universal.json').read_text(encoding='utf-8-sig'))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 def page_with(data):
  ctx=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True);pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
  pg.add_init_script('''(data=>{if(!localStorage.getItem('qa-initialized')){localStorage.clear();for(const [k,v]of Object.entries(data))localStorage.setItem(k,v);localStorage.setItem('qa-initialized','1')}})('''+json.dumps(data)+')')
  pg.goto(url);return ctx,pg,errors
 ctx,pg,errors=page_with({old:json.dumps(fixture),old+'-actor':'maya'});pg.locator('#asset-picker').wait_for();state=pg.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',new)
 assert pg.locator('#identity-picker').input_value()=='maya';assert state['schemaVersion']==3 and state['initialFundsByAsset']['USDT']=='0';assert json.loads(pg.evaluate('(key)=>localStorage.getItem(key)',old))==fixture
 assert state['orders'][0]['snapshot']==fixture['orders'][0]['snapshot'];checks.append('Legacy browser migration: USDC only, no USDT minted, old bytes retained')
 pg.select_option('#asset-picker','USDT');pg.evaluate("location.hash='#/product/goods-chair'");pg.wait_for_timeout(80);assert 'Not offered in USDT.' in pg.locator('main').inner_text();assert pg.locator('[data-u=buy-product]').count()==0;checks.append('Unquoted USDT product cannot be checked out')
 pg.reload();pg.locator('#asset-picker').wait_for();assert pg.locator('#asset-picker').input_value()=='USDT';assert not errors;ctx.close()
 for bad,label in [('{broken json','invalid JSON'),(json.dumps({'schemaVersion':999}),'future schema')]:
  ctx,pg,errors=page_with({new:bad,old:json.dumps(fixture)});pg.get_by_role('heading',name='Saved sandbox data needs attention.').wait_for();assert pg.evaluate('(k)=>localStorage.getItem(k)',new)==bad
  assert pg.locator('#asset-picker').count()==0;checks.append(label+': no silent reseed or legacy fallback')
  if label=='invalid JSON':
   with pg.expect_download() as d:pg.get_by_role('button',name='Export saved data').click()
   target=w/'recovery-export-test.json';d.value.save_as(target);assert target.read_text(encoding='utf8')==bad
   pg.on('dialog',lambda d:d.accept());pg.get_by_role('button',name='Reset demo',exact=True).click();pg.locator('#asset-picker').wait_for();fresh=pg.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',new);assert fresh['initialFundsByAsset']['USDT']=='200000000000';assert pg.evaluate('(k)=>localStorage.getItem(k)',old)==json.dumps(fixture)
   backups=pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('escrow-global-sandbox-v3-recovery-')).map(k=>localStorage.getItem(k))");assert bad in backups;checks.append('Explicit reset makes a backup first; exact raw export and legacy key preserved')
  assert not errors;ctx.close()
 # Two live tabs: command after a peer write must fail rather than overwrite.
 ctx,pg,errors=page_with({});pg.locator('#asset-picker').wait_for();before=pg.evaluate('(k)=>localStorage.getItem(k)',new)
 peer=ctx.new_page();peer.goto(url);peer.locator('#asset-picker').wait_for();peer.evaluate('(k)=>{let s=JSON.parse(localStorage.getItem(k));s.version++;localStorage.setItem(k,JSON.stringify(s));}',new)
 changed=pg.evaluate('(k)=>localStorage.getItem(k)',new);assert changed!=before
 pg.evaluate("location.hash='#/briefs'");pg.wait_for_timeout(80);pg.locator('[data-action=post-brief]').click();pg.locator('[name=title]').fill('Concurrent write must not be lost');pg.locator('[name=budget]').fill('100');pg.locator('dialog [name=description]').fill('This is a test brief for concurrent storage protection and it must not overwrite the peer.');pg.locator('dialog button[type=submit]').click();pg.wait_for_timeout(80)
 assert 'Another tab changed' in pg.locator('.form-error').inner_text();assert pg.evaluate('(k)=>localStorage.getItem(k)',new)==changed;checks.append('Stale browser command rejected without overwriting peer data');ctx.close();browser.close()
# Isolated HTTP migration and static asset checks.
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def launch(file):
 pp=port();env=os.environ.copy();env.update(PORT=str(pp),DATA_FILE=str(file),ESCROW_MODE='sandbox');proc=subprocess.Popen(['node','server.mjs'],cwd=r,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));return proc,'http://127.0.0.1:'+str(pp)
def stop(proc):
 if proc.poll() is None:proc.terminate()
 proc.communicate(timeout=10)
with tempfile.TemporaryDirectory(prefix='escrow-global-qa-') as td:
 d=Path(td);f=d/'state.json';raw=json.dumps(fixture,ensure_ascii=False).encode();f.write_bytes(raw);proc,base=launch(f)
 try:
  for i in range(80):
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1) as rr:assert json.loads(rr.read())['realFunds']==False
    break
   except Exception:
    if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
    time.sleep(.05)
  else:raise AssertionError('HTTP startup timeout')
  state=json.loads(f.read_text(encoding="utf8"));assert state['schemaVersion']==3 and state['initialFundsByAsset']['USDT']=='0';backups=list(d.glob('*.pre-escrow-global-v3-*.json'));assert len(backups)==1 and backups[0].read_bytes()==raw;checks.append('HTTP migration validates then preserves byte-exact adjacent backup')
  for path,mime in [('/brand-tokens.css','text/css'),('/settlement-assets.mjs','text/javascript'),('/state-migrations.mjs','text/javascript'),('/agreement.mjs','text/javascript'),('/images/escrow-global/hero-global-settlement.webp','image/webp'),('/images/escrow-global/agreement-milestones.webp','image/webp')]:
   with urllib.request.urlopen(base+path) as rr:assert rr.status==200 and rr.headers['Content-Type'].startswith(mime)
  checks.append('New static modules, tokens and both WebP assets explicitly served with correct MIME')
  for path,expected in [('/api/payments/escrow-transaction',501),('/server.mjs',404),('/.env',404),('/data/universal-sandbox.json',404)]:
   try:urllib.request.urlopen(base+path);raise AssertionError(path)
   except urllib.error.HTTPError as e:assert e.code==expected
  checks.append('Live custody still returns 501; private server/config/data remain unserved')
 finally:stop(proc)
 f=d/'corrupt.json';raw=b'{invalid json';f.write_bytes(raw);proc,base=launch(f);proc.wait(timeout=8);assert proc.returncode!=0 and f.read_bytes()==raw and not list(d.glob('corrupt.json.pre-*'));stop(proc);checks.append('Invalid HTTP saved state stops startup and leaves original bytes untouched')
print('\n'.join('PASS '+c for c in checks));(w/'s6-persistence-qa.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2),encoding='utf8')
