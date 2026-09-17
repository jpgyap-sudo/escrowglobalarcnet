import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'MANIFEST.sha256');
const sensitivePath = /(^|\/)(?:\.env(?!\.example$)|.*(?:secret|private|keypair|credentials).*)$|\.(?:key|pem|p12|jks|keystore)$/i;

export function isSensitiveReleasePath(relativePath) {
  return sensitivePath.test(relativePath);
}

function canonicalBytes(raw) {
  return raw.includes(0) || !raw.includes(Buffer.from('\r\n'))
    ? raw
    : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function releaseFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'buffer',
  });
  return output.toString('utf8').split('\0').filter(Boolean)
    .map(relativePath => relativePath.replaceAll('\\', '/'))
    .filter(relativePath => relativePath !== 'MANIFEST.sha256')
    .sort();
}

export function generateManifest() {
  const files = releaseFiles();
  const sensitive = files.filter(isSensitiveReleasePath);
  if (sensitive.length) throw new Error(`Refusing to include sensitive release paths: ${sensitive.join(', ')}`);
  const lines = files.map(relativePath => {
    const absolute = path.resolve(ROOT, relativePath);
    if (!absolute.startsWith(`${ROOT}${path.sep}`) || !fs.lstatSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`Cannot hash release path: ${relativePath}`);
    return `${sha256(canonicalBytes(fs.readFileSync(absolute)))}  ${relativePath}`;
  });
  fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  return { output: OUTPUT, count: lines.length };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  try {
    const result = generateManifest();
    console.log(`Generated ${result.count} release manifest hashes.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
