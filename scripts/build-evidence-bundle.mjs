import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCapabilities } from './render-capabilities.mjs';
import { verifyManifest } from './verify-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function fileHash(relativePath) {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) && fs.lstatSync(file).isFile() ? sha256(fs.readFileSync(file)) : null;
}

export function buildEvidenceBundle({ generatedAt = new Date().toISOString() } = {}) {
  const capabilities = loadCapabilities();
  const release = readJson('RELEASE.json');
  const browserReport = readJson('docs/BROWSER-TEST-REPORT.json');
  const manifest = verifyManifest();
  const manifestBytes = fs.readFileSync(manifest.manifest);
  const artifact = 'packages/custody-contracts/program/target/deploy/escrow_global.so';
  const body = {
    schemaVersion: 1,
    commit: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain'])),
    toolchain: {
      node: process.version,
      rustc: commandVersion('rustc', ['--version']),
      cargo: commandVersion('cargo', ['--version']),
      cargoBuildSbf: commandVersion('cargo-build-sbf', ['--version']),
      solana: commandVersion('solana', ['--version']),
      anchor: commandVersion('anchor', ['--version']),
    },
    sources: {
      releaseMetadataSha256: fileHash('RELEASE.json'),
      capabilitiesSha256: fileHash('docs/capabilities.json'),
      manifestSha256: sha256(manifestBytes),
      releaseArtifactSha256: fileHash(artifact),
      releaseArtifactPath: fs.existsSync(path.join(ROOT, artifact)) ? artifact : null,
    },
    tests: {
      node: release.nodeTests,
      browser: { passed: browserReport.passed, failed: browserReport.failed },
      custody: release.custodyVerification,
    },
    capabilities: capabilities.entries.map(({ id, status }) => ({ id, status })),
    knownLimitations: capabilities.entries.filter(entry => entry.status !== 'proven').map(entry => ({ id: entry.id, status: entry.status, notes: entry.notes })),
  };
  const bodyText = canonicalJson(body);
  return {
    schemaVersion: 1,
    body,
    bodySha256: sha256(bodyText),
    bodyCanonicalization: 'sorted-object-json-v1',
    envelope: { generatedAt },
  };
}

export function writeEvidenceBundle(output, options) {
  const absolute = path.resolve(ROOT, output);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Evidence output must remain inside the repository: ${output}`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const bundle = buildEvidenceBundle(options);
  fs.writeFileSync(absolute, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return { absolute, bundle };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  try {
    const commit = git(['rev-parse', '--short=12', 'HEAD']) || 'unknown';
    const requested = process.argv.indexOf('--out');
    const output = requested >= 0 ? process.argv[requested + 1] : `dist/evidence/${commit}.json`;
    if (!output || output.startsWith('--')) throw new Error('--out requires a file path.');
    const result = writeEvidenceBundle(output);
    console.log(`Evidence bundle: ${path.relative(ROOT, result.absolute).replaceAll(path.sep, '/')}`);
    console.log(`Evidence body SHA-256: ${result.bundle.bodySha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
