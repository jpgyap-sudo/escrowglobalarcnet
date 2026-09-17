import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CAPABILITIES = path.join(ROOT, 'docs', 'capabilities.json');

const validStatuses = new Set(['proven', 'probe-blocked', 'intentionally-disabled']);

export function loadCapabilities(file = DEFAULT_CAPABILITIES) {
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.entries) || source.entries.length === 0) {
    throw new Error('Capability matrix must have schemaVersion 1 and a non-empty entries array.');
  }
  const ids = new Set();
  for (const entry of source.entries) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id)) throw new Error('Capability IDs must be lowercase kebab-case.');
    if (ids.has(entry.id)) throw new Error(`Duplicate capability ID: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.surface !== 'string' || !entry.surface.trim()) throw new Error(`Capability ${entry.id} has no surface.`);
    if (!validStatuses.has(entry.status)) throw new Error(`Capability ${entry.id} has an unsupported status.`);
    if (!Array.isArray(entry.evidence) || entry.evidence.some(item => typeof item !== 'string' || !item || item.includes('\\') || path.posix.isAbsolute(item) || item.split('/').includes('..'))) {
      throw new Error(`Capability ${entry.id} has invalid evidence paths.`);
    }
    if (typeof entry.notes !== 'string' || !entry.notes.trim()) throw new Error(`Capability ${entry.id} has no notes.`);
  }
  return source;
}

export function renderCapabilities(source) {
  const statusLabel = {
    proven: 'Proven',
    'probe-blocked': 'Probe blocked',
    'intentionally-disabled': 'Intentionally disabled',
  };
  const lines = [
    '# Escrow Global capability matrix',
    '',
    '> Machine-rendered from `docs/capabilities.json`. “Proven” means locally evidenced only; it does not mean deployed, audited, or safe for real funds.',
    '',
    '| Capability | Status | Evidence | Notes |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of source.entries) {
    const evidence = entry.evidence.map(item => `\`${item}\``).join('<br>');
    lines.push(`| ${entry.surface} | **${statusLabel[entry.status]}** | ${evidence} | ${entry.notes} |`);
  }
  lines.push('', 'Generated files are evidence indexes, not a deployment approval or an on-chain attestation.', '');
  return lines.join('\n');
}

function repositoryPath(output) {
  const absolute = path.resolve(ROOT, output);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Capability output must remain inside the repository: ${output}`);
  return absolute;
}

function writeAtomically(output, text) {
  const absolute = repositoryPath(output);
  const temporary = `${absolute}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, absolute);
  return absolute;
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  try {
    const source = loadCapabilities(process.argv[2] || DEFAULT_CAPABILITIES);
    const output = process.argv[3] || path.join(ROOT, 'docs', 'capabilities.md');
    const absolute = writeAtomically(output, renderCapabilities(source));
    console.log(`Rendered capability matrix: ${path.relative(ROOT, absolute).replaceAll(path.sep, '/')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
