"""Targeted offline, keyboard, reflow, palette and packaging QA. No external payments."""
from pathlib import Path
import json, re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/rebrand/escrow-global/evidence'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
html = (ROOT / 'escrow-global-preview.html').read_bytes()
assert html == (ROOT / 'pact-preview.html').read_bytes()
assert len(html) < 1572864
checks.append('Primary and legacy-filename previews byte-identical; standalone bundle below 1.5 MiB')
for file in ['mobile/android/app/src/main/assets/index.html', 'mobile/ios/Pact/assets/index.html']:
    data = (ROOT / file).read_bytes()
    assert data.count(b'window.PACT_NATIVE=true;') == 1
    assert data.replace(b'window.PACT_NATIVE=true;', b'') == html
checks.append('Both native HTML bundles match the primary build except for exactly one payment-disable flag')
css = '\n'.join((ROOT / 'public' / f).read_text(encoding='utf8') for f in ['brand-tokens.css', 'styles.css', 'universal.css'])
defined = set(re.findall(r'(--[\w-]+)\s*:', css))
used = set(re.findall(r'var\((--[\w-]+)', css))
assert not (used - defined), used - defined
checks.append('Every referenced CSS custom property is defined')
def lum(h):
    values = [int(h[i:i+2], 16) / 255 for i in [1, 3, 5]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(a*b for a,b in zip(rgb, [.2126, .7152, .0722]))
ratios = {}
for name, fg, bg, minimum in [
    ('body on white', '#243b53', '#ffffff', 4.5),
    ('secondary on page', '#52677a', '#f7fafc', 4.5),
    ('teal links on white', '#087f8c', '#ffffff', 4.5),
    ('navy on mint', '#102a43', '#ddf4f2', 4.5),
    ('warning text', '#8a5a12', '#fdf3e0', 4.5),
    ('danger text', '#a02b2b', '#fbeaea', 4.5),
    ('control border', '#7b91a6', '#ffffff', 3),
    ('focus ring', '#0a5f6a', '#ffffff', 3),
]:
    x,y = sorted([lum(fg),lum(bg)]);ratio=(y+.05)/(x+.05)
    ratios[name]=round(ratio,2);assert ratio >= minimum, (name,ratio)
checks.append('Eight primary text/control/focus palette pairs meet their targeted contrast thresholds')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width,scale in [(1440,1),(390,1),(640,2)]:
        ctx=browser.new_context(viewport={'width':width,'height':900},device_scale_factor=scale,reduced_motion='reduce',offline=True,accept_downloads=True)
        page=ctx.new_page();errors=[];network=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda req:network.append(req.url) if req.url.startswith(('http:','https:')) else None)
        page.goto((ROOT/'escrow-global-preview.html').as_uri());page.locator('#asset-picker').wait_for()
        page.keyboard.press('Tab');assert page.evaluate('document.activeElement.classList.contains("skip-link")')
        assert page.locator('.skip-link').is_visible();page.keyboard.press('Enter')
        assert page.evaluate('document.activeElement.id')=='main'
        page.locator('#asset-picker').focus();style=page.locator('#asset-picker').evaluate('(e)=>({outline:getComputedStyle(e).outlineStyle,width:getComputedStyle(e).outlineWidth})')
        assert style['outline']!='none' and float(style['width'].replace('px',''))>=2
        page.evaluate("location.hash='#/service/web'");page.wait_for_timeout(100);page.locator('[data-action=checkout]').click()
        assert page.locator('dialog').is_visible();page.keyboard.press('Escape');assert not page.locator('dialog').is_visible()
        page.evaluate("location.hash='#/market'");page.wait_for_timeout(100)
        page.evaluate("Promise.race([Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})})),new Promise(r=>setTimeout(r,2000))])")
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert page.locator('img[src^="data:image/webp"]').count()>0
        assert page.locator('img[src^="data:image/webp"]').evaluate_all('(es)=>es.every(e=>e.complete&&e.naturalWidth>0)')
        page.screenshot(path=str(OUT/f'viewport-{width}-scale-{scale}.png'))
        assert not errors,errors;assert not network,network
        ctx.close()
    checks.append('Network-blocked offline pages render art; keyboard skip/focus/Escape verified at 1440,390 and 640 CSS px (2x scale)')
    for failure in ['read','write']:
        ctx=browser.new_context(viewport={'width':390,'height':844})
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        method='getItem' if failure=='read' else 'setItem'
        page.add_init_script(f'Storage.prototype.{method}=function(){{throw new DOMException("QA storage unavailable","SecurityError")}}')
        page.goto((ROOT/'escrow-global-preview.html').as_uri());page.locator('#asset-picker').wait_for()
        page.wait_for_timeout(4400)
        assert page.locator('[role=status]').filter(has_text='Memory-only session.').is_visible()
        assert page.get_by_role('button',name='Export session',exact=True).is_visible()
        assert not errors,errors;ctx.close()
    checks.append('Storage read and write failures retain an explicit usable memory-only demo')
    browser.close()
result={'passed':len(checks),'checks':checks,'bundleBytes':len(html),'contrastRatios':ratios,'limitations':'Targeted checks, not a full WCAG audit or native device/SDK build; 640 CSS px at 2x scale is reflow emulation.'}
(OUT/'packaging-qa.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
