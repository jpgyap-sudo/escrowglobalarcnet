import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'MANIFEST.sha256');

function canonicalBytes(raw) {
  // Release hashes are independent of Windows checkout line endings while
  // binary assets remain byte-for-byte hashes.
  return raw.includes(0) || !raw.includes(Buffer.from('\r\n'))
    ? raw
    : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function verifyManifest(manifestPath = DEFAULT_MANIFEST) {
  const manifest = path.resolve(manifestPath);
  const text = fs.readFileSync(manifest, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const entries = [];
  const seen = new Set();

  for (const line of lines) {
    const match = /^(?<hash>[0-9a-f]{64})  (?<relativePath>.+)$/.exec(line);
    if (!match) throw new Error(`Malformed manifest line: ${line}`);
    const relativePath = match.groups.relativePath;
    if (relativePath.startsWith('/') || relativePath.includes('\\')) {
      throw new Error(`Manifest path must be repository-relative with '/' separators: ${relativePath}`);
    }
    if (seen.has(relativePath)) throw new Error(`Duplicate manifest path: ${relativePath}`);
    seen.add(relativePath);

    const absolutePath = path.resolve(ROOT, relativePath);
    if (absolutePath !== ROOT && !absolutePath.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`Manifest path escapes the repository: ${relativePath}`);
    }
    if (!fs.existsSync(absolutePath) || fs.lstatSync(absolutePath).isSymbolicLink() || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Manifest file is missing: ${relativePath}`);
    }

    const actualHash = sha256(canonicalBytes(fs.readFileSync(absolutePath)));
    if (actualHash !== match.groups.hash) {
      throw new Error(`Manifest hash mismatch for ${relativePath}: expected ${match.groups.hash}, got ${actualHash}`);
    }
    entries.push({ path: relativePath, hash: actualHash });
  }

  return { manifest, entries };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  try {
    const result = verifyManifest(process.argv[2] || DEFAULT_MANIFEST);
    console.log(`Release manifest is valid: ${result.entries.length} canonical file hashes.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
