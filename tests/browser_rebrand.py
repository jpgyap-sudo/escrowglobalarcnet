import json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
w=ROOT/'docs/rebrand/escrow-global/evidence';w.mkdir(parents=True,exist_ok=True)
url=(ROOT/'escrow-global-preview.html').as_uri();rows=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1000})
 page=context.new_page();page.on('pageerror',lambda err:errors.append(str(err)))
 page.goto(url);page.locator('#asset-picker').wait_for();page.evaluate("Promise.race([Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})})),new Promise(r=>setTimeout(r,4000))])")
 for asset in ['USDC','USDT']:
  page.select_option('#asset-picker',asset)
  for width in [1440,1024,768,390,360,320]:
   page.set_viewport_size({'width':width,'height':1000})
   for route in ['market','explore','service/web','product/goods-chair','orders','briefs','resolution','rules','studio','profile/maya','categories','templates','templates/contract','wallet','wallet?tab=receive','wallet?tab=swap','wallet?tab=spend','learn']:
    page.evaluate('(hash)=>location.hash=hash','#/'+route);page.wait_for_timeout(40)
    row=page.evaluate('''()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,oldBrand:/\\bpact\\b/i.test(document.body.innerText),body:document.querySelector('main')?.innerText?.slice(0,80),overflow:[...document.querySelectorAll('main *,header *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='absolute').slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right])})''');row.update(asset=asset,route=route);rows.append(row);(w/'s6-browser-audit.partial.json').write_text(json.dumps({'rows':rows,'errors':errors}),encoding='utf8')
   print('audited',asset,width,flush=True)
   if asset=='USDT' and width in [1440,390]:
    page.evaluate("location.hash='#/market'");page.wait_for_timeout(150);page.evaluate("Promise.race([Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})})),new Promise(r=>setTimeout(r,4000))])");page.screenshot(path=str(w/f's6-market-{width}.png'),full_page=True)
 # own selected asset frozen through service checkout
 page.set_viewport_size({'width':1440,'height':1000});page.evaluate("location.hash='#/service/web'");page.wait_for_timeout(100)
 page.locator('[data-action=checkout]').click();page.locator('[name=requirements]').fill('Use all provided requirements and deliver a responsive website with editable source files.')
 page.locator('[name=consent]').check();page.locator('dialog button[type=submit]').click();page.wait_for_timeout(100)
 s=page.evaluate("JSON.parse(localStorage.getItem('escrow-global-sandbox-v3'))")
 assert s['orders'][0]['asset']=='USDT',s['orders'][0]
 page.select_option('#asset-picker','USDC');page.wait_for_timeout(50);assert 'USDT' in page.locator('main').inner_text()
 # actor swap and funding use original USDT despite USDC preference
 page.select_option('#identity-picker','maya');page.locator('[data-action=accept-order]').click();page.locator('[name=consent]').check();page.locator('dialog button[type=submit]').click();page.wait_for_timeout(80)
 page.select_option('#identity-picker','buyer');page.locator('[data-action=fund-order]').click();assert 'real USDT' in page.locator('dialog').inner_text();page.locator('[name=consent]').check();page.locator('dialog button[type=submit]').click();page.wait_for_timeout(80)
 s=page.evaluate("JSON.parse(localStorage.getItem('escrow-global-sandbox-v3'))");assert s['orders'][0]['fundedAt'];assert s['orders'][0]['asset']=='USDT'
 print('USDT checkout + seller accept + buyer fund with preference switched to USDC: PASS')
 context.close();browser.close()
(w/'s6-browser-audit.json').write_text(json.dumps({'rows':rows,'errors':errors},indent=2),encoding='utf8')
print('route/asset/width checks',len(rows),'page errors',errors)
print('overflow',[(x['asset'],x['width'],x['route'],x['scroll']-x['width']) for x in rows if x['scroll']>x['width']+1])
print('oldbrand',[(x['width'],x['route']) for x in rows if x['oldBrand']])

assert not errors, errors
assert all(x['scroll'] <= x['width'] + 1 for x in rows), 'Horizontal overflow'
assert all(not x['oldBrand'] for x in rows), 'Visible old branding'
