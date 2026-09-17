/** Bundle a native DEMO. Do not remove this boundary as a shortcut to app-store approval. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

const primary=path.join(root,'escrow-global-preview.html');
if(!fs.existsSync(primary))throw new Error('Missing escrow-global-preview.html. Run scripts/build-preview.mjs first.');
let html=fs.readFileSync(primary,'utf8');

// Inject BOTH required flags exactly once, immediately after the embedded flag.
const embeddedFlag='window.PACT_EMBEDDED=true;';
const nativeFlag='window.PACT_NATIVE=true;';
if(!html.includes(embeddedFlag))throw new Error('Embedded flag not found in preview bundle.');
if(html.includes(nativeFlag))throw new Error('Native flag already present; refusing to double-inject.');
html=html.replace(embeddedFlag, nativeFlag+embeddedFlag);

// Assertions: both flags present exactly once, no unresolved /images references.
const countEmbedded=(html.match(/window\.PACT_EMBEDDED=true;/g)||[]).length;
const countNative=(html.match(/window\.PACT_NATIVE=true;/g)||[]).length;
if(countEmbedded!==1)throw new Error(`Expected exactly one PACT_EMBEDDED flag, found ${countEmbedded}.`);
if(countNative!==1)throw new Error(`Expected exactly one PACT_NATIVE flag, found ${countNative}.`);
if(/["'`]\/images\//.test(html))throw new Error('Unresolved /images reference remains in native bundle.');

for(const out of ['mobile/android/app/src/main/assets/index.html','mobile/ios/Pact/assets/index.html']){
  const dest=path.join(root,out);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,html);
}
console.log('Bundled offline Android/iOS assets from escrow-global-preview.html. No native binary was compiled. Live financial features disabled.');
