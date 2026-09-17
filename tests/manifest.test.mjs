import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { verifyManifest } from '../scripts/verify-manifest.mjs';

test('release manifest verifies canonical text and binary hashes', () => {
  const result = verifyManifest();
  assert.ok(result.entries.length >= 292);
  assert.ok(result.entries.some(entry => entry.path === 'scripts/verify-manifest.mjs'));
});

test('release manifest rejects repository escape paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-global-manifest-'));
  try {
    const hash = crypto.createHash('sha256').update('not-used').digest('hex');
    const manifest = path.join(directory, 'bad.sha256');
    fs.writeFileSync(manifest, `${hash}  ../outside.txt\n`);
    assert.throws(() => verifyManifest(manifest), /escapes the repository/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
