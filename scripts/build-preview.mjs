/** Dependency-free ES-module bundler for these known source modules. No eval. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Base module table: always present.
const baseSources={
  '/domain.mjs':'src/domain.mjs',
  '/universal-domain.mjs':'src/universal-domain.mjs',
  '/agreement.mjs':'src/agreement.mjs',
  '/agreement-readiness.mjs':'src/agreement-readiness.mjs',
  '/action-center.mjs':'src/action-center.mjs',
  '/catalog.mjs':'src/catalog.mjs',
  '/payments.mjs':'src/payments.mjs',
  ...Object.fromEntries(['qr','learn','wallet','jupiter','universal-ui','app'].map(x=>['/'+x+'.mjs','public/'+x+'.mjs'])),
  '/settlement-simulator.mjs':'src/settlement-simulator.mjs',
  '/payroll-domain.mjs':'src/payroll-domain.mjs',
  '/payroll-state.mjs':'src/payroll-state.mjs',
  '/tutorial-visuals.mjs':'public/tutorial-visuals.mjs'
};

// Optional known modules: included only when the file exists on disk.
// Unknown dynamic files are never allowed.
const optionalSources={
  '/settlement-assets.mjs':'src/settlement-assets.mjs',
  '/state-migrations.mjs':'src/state-migrations.mjs',
  '/money.mjs':'public/money.mjs',
  '/brand.mjs':'src/brand.mjs'
};

const sources={...baseSources};
for(const [id,file] of Object.entries(optionalSources)){
  if(fs.existsSync(path.join(root,file))) sources[id]=file;
}

// Optional responsive image variants: only when an explicit table is provided.
// Format: { '<original-path>': { '<variant-key>': '<variant-path>' } }
// Left empty by default; no implicit discovery.
const responsiveVariants={};

function resolve(spec,id){return spec.startsWith('/')?spec:path.posix.resolve(path.posix.dirname(id),spec);}

// Inline the two known brand images as data URIs so the offline bundle
// has no network dependency on /images/*.
const INLINE_IMAGES=[
  '/images/escrow-global/hero-global-settlement.webp',
  '/images/escrow-global/agreement-milestones.webp'
];
const imageDataURIs={};
for(const p of INLINE_IMAGES){
  const disk=path.join(root,'public',p.replace(/^\//,''));
  if(fs.existsSync(disk)){
    const b64=fs.readFileSync(disk).toString('base64');
    imageDataURIs[p]='data:image/webp;base64,'+b64;
  }
}

function inlineImages(code){
  let out=code;
  for(const [p,uri] of Object.entries(imageDataURIs)){
    // Replace string literals containing the exact path.
    out=out.split(JSON.stringify(p)).join(JSON.stringify(uri));
    out=out.split("'"+p+"'").join(JSON.stringify(uri));
    out=out.split('"'+p+'"').join(JSON.stringify(uri));
    out=out.split('`'+p+'`').join(JSON.stringify(uri));
  }
  return out;
}

let script="window.PACT_EMBEDDED=true;\nconst __modules={},__cache={};function __require(id){if(__cache[id])return __cache[id];if(!__modules[id])throw new Error('Module missing: '+id);const exports={};__cache[id]=exports;__modules[id](exports,__require);return exports;}\n";
for(const[id,file]of Object.entries(sources)){
 let code=fs.readFileSync(path.join(root,file),'utf8');
 code=inlineImages(code);
 const names=[...code.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(x=>x[1]);
 code=code.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm,(_,clause,spec)=>{const r=`__require(${JSON.stringify(resolve(spec,id))})`;if(clause.startsWith('* as '))return `const ${clause.slice(5)}=${r};`;return `const ${clause.replace(/\bas\b/g,':')}=${r};`;});
 code=code.replace(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,(_,list,spec)=>`Object.assign(exports,(({${list}})=>({${list}}))(__require(${JSON.stringify(resolve(spec,id))})));`);
 code=code.replace(/export\s*\{([^}]+)\};?/g,(_,list)=>`Object.assign(exports,{${list}});`);
 code=code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g,'');
 script+=`__modules[${JSON.stringify(id)}]=(exports,__require)=>{\n${code}\nObject.assign(exports,{${names.join(',')}});\n};\n`;
}
script+="__require('/app.mjs');";

// Styles: brand-tokens.css first, then existing sheets.
const cssFiles=['brand-tokens.css','styles.css','universal.css'];
const css=cssFiles
  .map(x=>path.join(root,'public',x))
  .filter(p=>fs.existsSync(p))
  .map(p=>fs.readFileSync(p,'utf8'))
  .join('\n');

// Inline favicon SVG as data URI (no network fetch).
const faviconPath=path.join(root,'public','favicon.svg');
let faviconLink='';
if(fs.existsSync(faviconPath)){
  const svg=fs.readFileSync(faviconPath,'utf8');
  const uri='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  faviconLink=`<link rel="icon" type="image/svg+xml" href="${uri}">`;
}

const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="Escrow Global Settlement — products, services and milestone agreements priced in USDT or USDC. Interactive sandbox; no real custody."><meta property="og:title" content="Escrow Global Settlement"><meta property="og:description" content="Escrow Global Settlement — products, services and milestone agreements priced in USDT or USDC. Interactive sandbox; no real custody."><meta property="og:type" content="website"><meta name="theme-color" content="#102a43"><title>Escrow Global Settlement</title>${faviconLink}<style>${css}</style></head><body><a class="skip-link" href="#main">Skip to content</a><div id="app"><div class="boot">Loading Escrow Global…</div></div><div id="modal-root"></div><div id="toast" role="status" aria-live="polite"></div><script>${script.replaceAll('</script>','<\\/script>')}</script></body></html>`;

// Primary output plus byte-identical compatibility copy.
const primary=path.join(root,'escrow-global-preview.html');
const compat=path.join(root,'pact-preview.html');
fs.writeFileSync(primary,html);
fs.writeFileSync(compat,html);
console.log(`Built offline preview: ${Buffer.byteLength(html)} bytes -> escrow-global-preview.html (+ pact-preview.html). External signing requires npm start.`);
