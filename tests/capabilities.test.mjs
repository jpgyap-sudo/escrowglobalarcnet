import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidenceBundle, canonicalJson } from '../scripts/build-evidence-bundle.mjs';
import { isSensitiveReleasePath } from '../scripts/generate-manifest.mjs';
import { loadCapabilities, renderCapabilities } from '../scripts/render-capabilities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('capability matrix is valid, rendered, and references existing evidence', () => {
  const file = path.join(root, 'docs', 'capabilities.json');
  const source = loadCapabilities(file);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'capabilities.md'), 'utf8'), renderCapabilities(source));
  for (const entry of source.entries) {
    for (const relativePath of entry.evidence) {
      const absolute = path.resolve(root, relativePath);
      assert.ok(absolute === root || absolute.startsWith(`${root}${path.sep}`), `${entry.id} evidence escapes repository`);
      assert.equal(fs.existsSync(absolute), true, `${entry.id} evidence is missing: ${relativePath}`);
    }
  }
});

test('release evidence body is deterministic while its envelope can carry generation time', () => {
  const first = buildEvidenceBundle({ generatedAt: '2026-09-14T00:00:00.000Z' });
  const second = buildEvidenceBundle({ generatedAt: '2026-09-14T00:00:00.000Z' });
  assert.deepEqual(first.body, second.body);
  assert.equal(first.bodySha256, second.bodySha256);
  assert.equal(first.envelope.generatedAt, '2026-09-14T00:00:00.000Z');
  assert.match(first.bodySha256, /^[a-f0-9]{64}$/);
  assert.equal(first.bodySha256, crypto.createHash('sha256').update(canonicalJson(first.body)).digest('hex'));
  assert.equal(first.bodyCanonicalization, 'sorted-object-json-v1');
  assert.equal(first.body.capabilities.find(item => item.id === 'sbpf-v3-execution').status, 'probe-blocked');
  assert.ok(first.body.knownLimitations.some(item => item.id === 'live-custody-api'));
});

test('malformed capability matrices fail closed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-capabilities-'));
  const file = path.join(temp, 'capabilities.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: [{ id: 'bad', surface: 'bad', status: 'proven', evidence: ['../secret'], notes: 'bad' }] }));
    assert.throws(() => loadCapabilities(file), /invalid evidence paths|escapes/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('release manifest refuses secret-like paths before hashing', () => {
  assert.equal(isSensitiveReleasePath('.env'), true);
  assert.equal(isSensitiveReleasePath('wallet/keypair.json'), true);
  assert.equal(isSensitiveReleasePath('secrets/deploy.pem'), true);
  assert.equal(isSensitiveReleasePath('.env.example'), false);
  assert.equal(isSensitiveReleasePath('docs/README.md'), false);
});
