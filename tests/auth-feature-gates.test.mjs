import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyAdminCommand, defaultAdminSettings, ensureAdminState } from '../src/admin.mjs';
import { createSeedState } from '../src/universal-domain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('account-entry flags default off and can be staged by the local admin', () => {
  const defaults = defaultAdminSettings(Date.UTC(2026, 0, 1));
  assert.equal(defaults.featureFlags.accountCreation, false);
  assert.equal(defaults.featureFlags.walletSignIn, false);

  const state = createSeedState();
  ensureAdminState(state);
  assert.equal(state.settings.featureFlags.accountCreation, false);
  assert.equal(state.settings.featureFlags.walletSignIn, false);

  const updated = applyAdminCommand(state, 'reviewer', 'update_settings', {
    patch: { featureFlags: { accountCreation: true, walletSignIn: true } }
  });
  assert.equal(updated.state.settings.featureFlags.accountCreation, true);
  assert.equal(updated.state.settings.featureFlags.walletSignIn, true);
  assert.throws(() => applyAdminCommand(state, 'reviewer', 'update_settings', {
    patch: { featureFlags: { unsupported: true } }
  }), /Unsupported admin field/);
});

test('frontend account widgets remain visibly disabled even when admin flags are staged', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.mjs'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'public', 'admin.mjs'), 'utf8');
  const widget = app.slice(app.indexOf('function signInWidget()'), app.indexOf('function header()'));
  assert.match(widget, /Connect wallet/);
  assert.match(widget, /Continue with email/);
  assert.match(widget, /Create account/);
  assert.equal((widget.match(/disabled aria-disabled="true"/g) || []).length, 3);
  assert.doesNotMatch(widget, /data-action=/);
  assert.match(admin, /name="accountCreation"/);
  assert.match(admin, /name="walletSignIn"/);
});

test('public capability config exposes staged flags without enabling live custody', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pact-auth-gates-'));
  const statePath = path.join(temp, 'state.json');
  const state = applyAdminCommand(createSeedState(), 'reviewer', 'update_settings', {
    patch: { featureFlags: { accountCreation: true, walletSignIn: true } }
  }).state;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_FILE: statePath, ESCROW_MODE: 'sandbox' },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await done;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
    await delay(50);
  }
  const response = await fetch(`${url}/api/payments/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.deepEqual(config.featureFlags, { accountCreation: true, walletSignIn: true });
  assert.equal(config.escrow.liveCustody, false);
  assert.equal(config.accountAuth.authorizesEscrow, false);
  assert.equal((await fetch(`${url}/api/payments/escrow-transaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 501);
});

async function freePort() {
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
