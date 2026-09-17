"""Offline UI tests via set_content; API tested separately. Never sends real funds.
Requires: pip install playwright; playwright install chromium
PACT_CHROMIUM may specify a system browser binary.
"""
from pathlib import Path
from datetime import date, timedelta
import json, os, re, shutil, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs'/'screenshots'; OUT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'pact-preview.html').read_text(encoding='utf-8')
checks=[]; errors=[]
with sync_playwright() as pw:
    binary=os.environ.get('PACT_CHROMIUM') or shutil.which('chromium')
    browser=pw.chromium.launch(headless=True,**({'executable_path':binary} if binary else {}))
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(HTML,wait_until='load');page.wait_for_selector('.u-market-grid')
    def check(name, condition=True):
        assert condition,name;checks.append(name)
    page.locator('[data-action=custom-escrow]').first.click();page.wait_for_timeout(250);check('Custom agreement opens an advisory preflight panel',page.locator('[data-readiness-panel]').count()==1 and 'agreement preflight' in page.locator('[data-readiness-panel]').inner_text().lower());page.locator('[data-action=close-modal]').click()
    def go(route):
        page.evaluate('(r)=>{location.hash=r}',route);page.wait_for_timeout(65)
    def actor(who):
        page.locator('#identity-picker').select_option(who);page.wait_for_timeout(65)
    def form(values=None,checks_to_tick=()):
        d=page.locator('#pact-dialog');d.wait_for(state='visible')
        for k,v in (values or {}).items():
            node=d.locator(f'[name="{k}"]')
            if node.evaluate('(e)=>e.tagName')=='SELECT':node.select_option(str(v))
            else:node.fill(str(v))
        for name in checks_to_tick:d.locator(f'[name="{name}"]').check()
        d.locator('[type=submit]').click();page.wait_for_timeout(90)
        if d.count() and d.is_visible():
            msg=d.locator('.form-error').inner_text()
            raise AssertionError('Modal not submitted: '+msg+' | invalid='+str(d.locator(':invalid').evaluate_all('(els)=>els.map(e=>({name:e.name,message:e.validationMessage}))')))
    def snap(name):
        if page.locator('#toast.show').count():page.wait_for_timeout(4250)
        page.screenshot(path=str(OUT/name),full_page=True)
    check('Marketplace displays six physical products, eight services, and the domain listing',page.locator('.u-market-grid > *').count()==15)
    check('Marketplace highlights decentralized infrastructure and third-party arbitration','Decentralized settlement. Marketplace infrastructure.' in page.locator('#main').inner_text() and 'third-party arbiter' in page.locator('#main').inner_text())
    snap('marketplace-desktop.png')
    go('#/market?type=goods');check('Products filter shows six items',page.locator('.u-market-grid > *').count()==6)
    go('#/market?type=services');check('Services filter shows eight services',page.locator('.u-market-grid > *').count()==8)
    go('#/market?type=domains');check('Domains filter shows the domain sale listing',page.locator('.u-market-grid > *').count()==1)
    go('#/domain/domain-harboratelier');check('Domain detail shows registrar, expiry and safe handover terms','Transfer terms are visible before payment.' in page.locator('#main').inner_text())
    actor('buyer');go('#/domain/domain-harboratelier');page.locator('[data-u=offer-domain]').click();form({'amount':'600'})
    actor('noa');go('#/domain/domain-harboratelier');check('Seller can review domain offers','Offers to review' in page.locator('#main').inner_text());page.locator('[data-u=respond-domain-offer][data-decision=accept]').click();form()
    actor('buyer');go('#/domain/domain-harboratelier');check('Buyer sees accepted offer price before agreement',page.locator('[data-u=buy-domain]').first.inner_text()=='Buy at accepted offer');page.locator('[data-u=buy-domain]').first.click();form({'requirements':'Transfer the domain to the buyer registrar account and confirm the DNS control challenge after the push.'},['agreeTerms'])
    check('Domain offer creates a protected agreement',page.evaluate('location.hash').startswith('#/deal/'))
    go('#/categories');check('All seventeen categories render',page.locator('.u-category-card').count()==17)
    go('#/templates');check('Eleven agreement templates render including salary disbursement',page.locator('.u-template-card').count()==11)
    go('#/templates/salary_disbursement');check('Salary disbursement template explains budget and autopay','salary' in page.locator('#main').inner_text().lower() and 'autopay' in page.locator('#main').inner_text().lower())
    go('#/account/payroll');check('Salary management account route renders roster and budget','STAFF ROSTER' in page.locator('#main').inner_text() and 'monthly budget' in page.locator('#main').inner_text().lower() and 'demo only' in page.locator('#main').inner_text().lower())
    page.locator('[name="name0"][form="payroll-form"]').fill('Alex Updated');page.locator('[data-u=payroll-save-roster]').click();page.wait_for_timeout(100)
    check('Payroll account saves editable roster changes','staff roster changes saved' in page.locator('#toast').inner_text().lower() and page.locator('[name="name0"][form="payroll-form"]').input_value()=='Alex Updated')
    payroll_form=page.locator('#payroll-form');payroll_form.locator('[name=mode]').select_option('autopay');payroll_form.locator('[name=months]').select_option('3');payroll_form.locator('[name=acknowledge]').check();payroll_form.locator('[type=submit]').click();page.wait_for_timeout(100)
    check('Payroll autopay preview shows the bounded commitment','total commitment' in page.locator('.payroll-preview').inner_text().lower() and '3 months' in page.locator('.payroll-preview').inner_text().lower())
    page.locator('[data-u=payroll-approve]').click();page.wait_for_timeout(150)
    check('One approval records an automated salary schedule','demo payroll approval recorded' in page.locator('#toast').inner_text().lower() and 'automated schedule' in page.locator('.payroll-history').inner_text().lower())
    actor('reviewer');go('#/account/payroll');check('Review team cannot access employer payroll controls','employer account only' in page.locator('#main').inner_text().lower() and page.locator('[data-u=payroll-save-roster]').count()==0)
    actor('buyer')
    go('#/templates/real_estate');page.locator('[data-u=agreement]').click()
    form({'propertyReference':'Project Atlas · Unit B12','purchasePrice':'25000','earnestDeposit':'5000','scope':'Record the earnest deposit while the parties complete due diligence and prepare the fictional closing.','targetClosingDate':(date.today()+timedelta(days=45)).isoformat()},['agreeRealEstate','agreeWireSafety'])
    check('Real-estate template creates an earnest-only agreement',page.evaluate('location.hash').startswith('#/deal/') and 'Cash to close' in page.locator('#main').inner_text())
    go('#/learn');check('Twenty-three tutorials render',page.locator('.u-guide-card').count()==23);check('Guidebook explains safe visual learning','Learn by doing' in page.locator('#main').inner_text());go('#/learn/solana-escrow-simple');check('Simple Solana escrow tutorial explains the user flow','set funds aside' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text() and '<svg role="img"' in page.locator('#main').inner_html());go('#/learn/production-readiness');check('Guidebook starts with a user safety checklist','know the deal' in page.locator('#main').inner_text().lower() and 'live escrow service' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text())
    go('#/learn/first-deal');check('First-deal tutorial renders an accessible visual','<svg role="img"' in page.locator('#main').inner_html() and 'No live custody' in page.locator('#main').inner_text())
    go('#/learn/non-custodial');check('Non-custodial tutorial explains user control','your wallet' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text() and 'clear terms' in page.locator('#main').inner_text().lower());go('#/learn/funding-safely');check('Funding safety tutorial explains the user checklist','wallet' in page.locator('#main').inner_text().lower() and 'wait for the status' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text())
    go('#/learn/rights-deadlines');check('Rights and deadline tutorial explains user actions','action owner' in page.locator('#main').inner_text().lower() and 'ask before a deadline' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text());go('#/learn/fee-sponsorship');check('Fee support tutorial keeps user approval clear','your approval' in page.locator('#main').inner_text().lower() and 'fee support is not enabled' in page.locator('#main').inner_text().lower() and 'No live custody' in page.locator('#main').inner_text());go('#/learn/action-center');check('Action Center tutorial explains role-scoped prompts','role-specific' in page.locator('#main').inner_text().lower() and 'no live custody' in page.locator('#main').inner_text().lower() and '<svg role="img"' in page.locator('#main').inner_html())
    go('#/learn/buy-crypto');check('Crypto tutorial keeps wallet and escrow boundaries clear','Own wallet only' in page.locator('#main').inner_text())
    go('#/learn/fee-breakdown');check('Fee tutorial shows transparent reserve math','1,000 demo USDC' in page.locator('#main').inner_text() and '3% commission reserve' in page.locator('#main').inner_text() and 'No live custody' in page.locator('#main').inner_text());sim=page.locator('[data-settlement-simulator]');check('Fee tutorial includes an interactive settlement chart',sim.count()==1 and '1,030.00' in sim.inner_text());sim.locator('[name=releasePercent]').fill('50');page.wait_for_timeout(50);check('Settlement chart updates without touching the demo ledger','500.00' in sim.inner_text() and '15.00' in sim.inner_text() and '515.00' in sim.inner_text())
    go('#/learn/jupiter-qr');check('Jupiter QR tutorial distinguishes merchant and wallet QR','Merchant QR' in page.locator('#main').inner_text() and 'No escrow funding' in page.locator('#main').inner_text())
    go('#/product/goods-chair');snap('product-desktop.png')
    page.locator('[data-u=buy-product]').click()
    form({'quantity':2,'requirements':'Deliver two chairs in the approved natural wood finish and specified dimensions.','deliveryReference':'BROWSER TEST — FICTIONAL DELIVERY'},['agreeInspection','agreeFees'])
    route=page.evaluate('location.hash');check('Product checkout opens an agreement',route.startswith('#/deal/'));check('Deal room shows a clear four-stage next-step path',page.locator('.deal-readiness-item').count()==4 and 'Your next step is clear.' in page.locator('.deal-readiness').inner_text());go('#/orders');check('Action center gives a role-scoped next step',page.locator('[data-action-center]').count()==1 and ('Fund the agreed plan' in page.locator('[data-action-center]').inner_text() or 'Waiting for seller acceptance' in page.locator('[data-action-center]').inner_text()));go(route);check('Deal room shows rights, deadlines and fallback caveats',page.locator('[data-rights-dashboard]').count()==1 and 'Know who can act next.' in page.locator('[data-rights-dashboard]').inner_text() and 'Important:' in page.locator('[data-rights-dashboard]').inner_text());check('Deal room offers a labelled sandbox protection receipt',page.locator('[data-action=export-receipt]').count()==1 and 'Export sandbox receipt' in page.locator('[data-action=export-receipt]').inner_text());
    with page.expect_download() as receipt_download:
        page.locator('[data-action=export-receipt]').click()
    receipt=json.loads(Path(receipt_download.value.path()).read_text(encoding='utf-8'));check('Exported receipt is machine-labelled non-authoritative',receipt.get('authoritative') is False and receipt.get('verification')=='none' and 'not proof of Solana settlement' in receipt.get('warning',''));page.locator('[data-action=copy-deal-link]').click();page.wait_for_timeout(120);check('Deal room offers a frictionless sandbox link fallback','sandbox-only deal link' in page.locator('#toast').inner_text().lower() or 'address bar' in page.locator('#toast').inner_text().lower())
    check('Physical goods workflow is shown','inspection' in page.locator('#main').inner_text().lower())
    actor('noa');page.locator('[data-action=accept-order]').click();form(checks_to_tick=['consent'])
    actor('buyer');page.locator('[data-action=fund-order]').click();page.wait_for_timeout(150);funding_text=page.locator('#pact-dialog').inner_text().lower();check('Funding modal shows the terms, fixed destinations and review boundary','funding review' in funding_text and 'fixed destinations' in funding_text);form(checks_to_tick=['consent'])
    check('Buyer funds the physical order in simulated credits','695.00' in page.locator('#main').inner_text())
    actor('noa');page.locator('[data-u=ship_goods]').click();form({'carrier':'Demo Carrier','tracking':'QA-123456','evidence':'Fictional packing list and shipment photographs reference.'})
    actor('buyer');page.locator('[data-u=receive_goods]').click();form(checks_to_tick=['acknowledge'])
    check('Receipt starts inspection without automatically releasing funds',page.locator('[data-action=approve]').count()==1)
    snap('deal-room-desktop.png')
    page.locator('[data-action=approve]').click();form(checks_to_tick=['criteriaAccepted'])
    check('Buyer approves main milestone while warranty balance stays held','69.50' in page.locator('#main').inner_text())
    # Exercise the bilateral amendment path so the read-only terms history is covered.
    page.locator('[data-action=terms]').last.click();form({'kind':'amend','amount':'60','scope':'Warranty inspection extends to a documented finish check and the buyer may report defects with photographs.','days':'5'})
    actor('noa');page.locator('[data-action=accept-terms]').last.click();form(checks_to_tick=['consent'])
    page.locator('.terms-history summary').click()
    check('Accepted amendments expose current and previous terms','Terms history' in page.locator('#main').inner_text() and page.locator('.terms-history-entry.current').count()==1 and 'Previous terms' in page.locator('.terms-history').inner_text())
    go('#/templates/development');page.locator('[data-u=agreement]').click()
    form({'sellerId':'maya','title':'QA website with precise acceptance conditions','scope':'Deliver responsive design and working website according to the approved requirements.','requirements':'The buyer supplies brand assets and the approved test acceptance data.','criteria':'Matches approved requirements','scope1':'Create a complete responsive design specification.','criteria1':'Each screen matches the approved visual design','scope2':'Implement and hand over the website and source.','criteria2':'Contact form passes the agreed validation tests'},['agree'])
    check('Custom agreement preserves separate stage criteria','Contact form passes' in page.locator('#main').text_content())
    go('#/service/web');page.locator('[data-action=checkout]').first.click()
    form({'requirements':'Build the website according to the approved brand and detailed acceptance tests.'},['consent'])
    check('Original service checkout still creates a deal',page.evaluate('location.hash').startswith('#/deal/'))
    go('#/product/goods-camera');page.locator('[data-u=report]').click();form({'reason':'Please review the documented product specifications before publication.'})
    check('Listing report is accepted without removing funds','Report recorded' in page.locator('#toast').inner_text())
    actor('reviewer');go('#/resolution');check('Resolution center offers free guidance before a formal dispute',page.locator('a[href="/support?category=payment"]').count()==1 and 'free support guidance' in page.locator('#main').inner_text().lower());page.locator('[data-u=moderate-report]').click();form({'reason':'Reviewer checked the report and temporarily hid the published listing.'})
    check('Reviewer can action a report on a published listing','listing: hidden' in page.locator('#main').inner_text())
    page.locator('[data-u=moderate-report]').click();form({'reason':'The seller clarification was reviewed and the listing is reinstated.'})
    check('Reviewer can reinstate a reported listing','listing: published' in page.locator('#main').inner_text())
    actor('buyer');go('#/product/goods-camera')
    page.locator('[data-u=block]').click();page.wait_for_timeout(75)
    check('Block button becomes reversible','Unblock seller' in page.locator('[data-u=block]').inner_text())
    page.locator('[data-u=block]').click();page.wait_for_timeout(75)
    # set_content() uses an opaque document origin. Install a tiny in-memory
    # storage object at this point so wallet-only tools can pass their explicit
    # risk acknowledgement without navigating away from the offline fixture.
    page.evaluate("""(() => { const data = {'escrow-global.blockchain-risk.v2': JSON.stringify({version:1, acceptedAt:new Date().toISOString()})}; Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: k => Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, clear: () => { for (const k of Object.keys(data)) delete data[k]; } } }); })();""")
    go('#/wallet?tab=receive')
    address='7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgLbw'
    f=page.locator('[data-u-form=receive]');f.locator('[name=address]').fill(address);f.locator('[name=amount]').fill('25');f.locator('[name=acknowledge]').check();f.locator('[type=submit]').click();page.wait_for_timeout(70)
    check('Wallet QR renders an SVG with explicit not-escrow wording',page.locator('#receive-result .u-qr svg').count()==1 and 'NOT ESCROW' in page.locator('#receive-result').inner_text())
    snap('wallet-qr-desktop.png')
    go('#/wallet?tab=buy');f=page.locator('[data-u-form=onramp]');f.locator('[name=amount]').fill('50');f.locator('[name=acknowledge]').check();f.locator('[type=submit]').click();page.wait_for_timeout(65)
    check('Offline MoonPay refuses unsigned checkout','npm start' in f.locator('.u-form-error').inner_text())
    go('#/wallet?tab=swap');page.evaluate("window.Jupiter={init:options=>{window.__jup=options;document.getElementById(options.integratedTargetId).textContent='MOCK Jupiter widget — no real transaction';},close:()=>{}}")
    f=page.locator('[data-u-form=swap]');f.locator('[name=consent]').check();f.locator('[type=submit]').click();page.wait_for_timeout(70)
    check('Jupiter adapter initializes official integrated target (mocked)',page.evaluate("window.__jup.integratedTargetId==='jupiter-plugin'"))
    page.evaluate('window.__jup.onSuccess({})');check('Mocked swap completion never claims escrow funding','No Escrow Global escrow was funded' in page.locator('#swap-status').inner_text())
    go('#/wallet?tab=spend');snap('spend-guide-desktop.png')
    go('#/learn/jupiter-kyc');check('KYC tutorial links to official sources and does not collect documents',page.locator('#main input[type=file]').count()==0 and 'SumSub' in page.locator('#main').inner_text())
    page.evaluate('window.PACT_NATIVE=true');go('#/wallet?tab=receive');f=page.locator('[data-u-form=receive]');f.locator('[name=address]').fill(address);f.locator('[name=acknowledge]').check();f.locator('[type=submit]').click();page.wait_for_timeout(60)
    check('Native review template blocks payment QR creation','disabled' in f.locator('.u-form-error').inner_text());page.evaluate('window.PACT_NATIVE=false')
    for width in [390,360]:
        page.set_viewport_size({'width':width,'height':844})
        for r in ['#/market','#/categories','#/product/goods-chair',route,'#/orders','#/wallet?tab=receive','#/wallet?tab=buy','#/wallet?tab=spend','#/templates','#/learn/jupiter-qr']:
            go(r)
            check(f'No horizontal overflow at {width}px on {r}',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        if width==390:
            go('#/market');snap('marketplace-mobile.png');page.screenshot(path=str(OUT/'marketplace-mobile-viewport.png'))
            go(route);snap('deal-room-mobile.png')
            go('#/wallet?tab=spend');snap('wallet-mobile.png');page.screenshot(path=str(OUT/'wallet-mobile-viewport.png'))
    check('No uncaught browser JavaScript errors',not errors)
    browser.close()
stable_checks=[re.sub(r'#/deal/[A-Za-z0-9_]+','#/deal/<volatile>',name) for name in checks]
report={'checkedAt':date.today().isoformat(),'passed':len(checks),'failed':0,'checks':stable_checks,'uncaughtErrors':errors,'scope':'Standalone bundle via Playwright set_content. Jupiter mocked, on-ramp disabled; no real provider transactions or native device execution.'}
(ROOT/'docs'/'BROWSER-TEST-REPORT.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':len(checks),'failed':0},indent=2))
