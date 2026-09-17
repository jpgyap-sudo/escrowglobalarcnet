import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const programRoot = path.join(root, 'packages', 'custody-contracts', 'program');
const sourcePath = path.join(programRoot, 'programs', 'escrow-global', 'src', 'lib.rs');
const anchorTomlPath = path.join(programRoot, 'Anchor.toml');
const idlPath = path.join(programRoot, 'target', 'idl', 'escrow_global.json');
const typePath = path.join(programRoot, 'target', 'types', 'escrow_global.ts');
const soPath = path.join(programRoot, 'target', 'deploy', 'escrow_global.so');
const sourceOnly = process.argv.includes('--source-only');
// Anchor's starter key must never become a production deployment identity.
// Keep the source ID configurable for local fixtures, but make the release
// verification gate fail until a controlled program keypair is selected.
const ANCHOR_STARTER_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgP3v2a5R4u';

function read(pathname, label) {
  try { return fs.readFileSync(pathname, 'utf8'); }
  catch (error) { throw new Error(`${label} is missing or unreadable: ${pathname} (${error.code || error.message})`); }
}

function mtime(pathname, label) {
  try { return fs.statSync(pathname).mtimeMs; }
  catch (error) { throw new Error(`${label} is missing: ${pathname} (${error.code || error.message})`); }
}

const source = read(sourcePath, 'Rust source');
const anchorToml = read(anchorTomlPath, 'Anchor.toml');
const idl = JSON.parse(read(idlPath, 'Anchor IDL'));
const sourceActions = [...source.matchAll(/pub fn ([a-z0-9_]+)\s*\(/g)].map(match => match[1]).sort();
const idlActions = (idl.instructions || []).map(instruction => instruction.name).sort();
const missing = sourceActions.filter(action => !idlActions.includes(action));
const extra = idlActions.filter(action => !sourceActions.includes(action));
const errors = [];

if (missing.length || extra.length) {
  if (missing.length) errors.push(`IDL is missing Rust instructions: ${missing.join(', ')}`);
  if (extra.length) errors.push(`IDL contains instructions absent from Rust source: ${extra.join(', ')}`);
}
const declareId = source.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
if (!declareId) errors.push('Rust source does not contain a parseable declare_id.');
if (declareId === ANCHOR_STARTER_PROGRAM_ID) errors.push('Rust source still uses Anchor starter program ID; generate and review a controlled deployment keypair before release.');
if (declareId && idl.address !== declareId) errors.push(`IDL address ${idl.address} does not match declare_id ${declareId}.`);
const anchorProgramIds = [...anchorToml.matchAll(/^\s*escrow_global\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*$/gm)].map(match => match[1]);
if (anchorProgramIds.length === 0) errors.push('Anchor.toml has no escrow_global program mapping.');
if (declareId && anchorProgramIds.some(value => value !== declareId)) errors.push('Anchor.toml escrow_global program mapping does not match Rust declare_id.');

const sourceTime = mtime(sourcePath, 'Rust source');
const generatedFiles = [[idlPath, 'IDL'], [typePath, 'generated TypeScript']];
if (!sourceOnly) generatedFiles.push([soPath, 'SBF artifact']);
for (const [pathname, label] of generatedFiles) {
  if (mtime(pathname, label) < sourceTime) errors.push(`${label} is stale; rebuild it after the current Rust source.`);
}

if (errors.length) {
  console.error('Custody ABI verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Custody ABI is fresh: ${sourceActions.length} instructions, IDL address ${idl.address}.`);
}
