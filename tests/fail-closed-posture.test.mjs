import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCapabilities } from '../scripts/render-capabilities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');

test('documented live-custody capability remains fail-closed in the server', () => {
  const live = loadCapabilities().entries.find(entry => entry.id === 'live-custody-api');
  assert.equal(live.status, 'intentionally-disabled');
  assert.match(serverSource, /url\.pathname==='\/api\/payments\/escrow-transaction'.*send\(res,501/);
  assert.match(serverSource, /ESCROW_MODE.*sandbox/);
  assert.match(serverSource, /No real funds\. No blockchain/);
});

test('deployment authority remains an explicit artifact gate', () => {
  const authority = loadCapabilities().entries.find(entry => entry.id === 'deployment-authority');
  assert.equal(authority.status, 'intentionally-disabled');
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'verify-custody-deployment-manifest.mjs'), 'utf8'), /manifest could not be read|loadAndVerifyCustodyDeploymentManifest/);
  assert.equal(fs.existsSync(path.join(root, 'custody-deployment-manifest.json')), false);
});
