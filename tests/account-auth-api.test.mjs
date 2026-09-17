import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { base58Encode } from '../src/payments.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('HTTP wallet account session is purpose-bound and never authorizes sandbox escrow commands', async () => {
  const port = await freePort(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pact-account-')), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_FILE: path.join(temp, 'state.json'), ESCROW_MODE: 'sandbox' }, stdio: 'ignore' });
  const post = (route, data, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch {} await delay(50); }
    const pair = generateKeyPairSync('ed25519'), address = base58Encode(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
    const challengeResponse = await post('/api/auth/challenge', { address });
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();
    const verifyResponse = await post('/api/auth/verify', { id: challenge.id, signature: sign(null, Buffer.from(challenge.message), pair.privateKey).toString('base64') });
    assert.equal(verifyResponse.status, 200);
    const verified = await verifyResponse.json(), setCookie = verifyResponse.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.equal(verified.address, address);
    assert.equal(verified.purpose, 'account-session-only');
    assert.doesNotMatch(JSON.stringify(verified), /token/);
    const session = await fetch(url + '/api/auth/session', { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).accountId, `wallet:${address}`);
    const config = await (await fetch(url + '/api/payments/config')).json();
    assert.equal(config.accountAuth.authorizesEscrow, false);
    const logout = await post('/api/auth/logout', {}, { Cookie: cookie });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(url + '/api/auth/session', { headers: { Cookie: cookie } })).status, 401);
  } finally {
    if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
