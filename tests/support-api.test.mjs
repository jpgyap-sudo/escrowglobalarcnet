import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { scryptSync } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'admin-test-password';
const ADMIN_SALT = Buffer.from('escrow-global-test-salt');
const ADMIN_HASH = `scrypt$16384$8$1$${ADMIN_SALT.toString('base64')}$${scryptSync(ADMIN_PASSWORD, ADMIN_SALT, 32, { N: 16384, r: 8, p: 1 }).toString('base64')}`;

test('support intake accepts safe screenshots and keeps public ticket data private', async () => {
  const port = await freePort(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pact-support-')), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_FILE: path.join(temp, 'state.json'), ESCROW_MODE: 'sandbox', ADMIN_EMAIL, ADMIN_PASSWORD_HASH: ADMIN_HASH }, stdio: 'ignore' });
  let cookie = '', csrfToken = '';
  const adminHeaders = () => ({ ...(cookie ? { cookie } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) });
  const post = (route, data, admin = false) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? adminHeaders() : {}) }, body: JSON.stringify(data) });
  const command = (command, payload) => post('/api/admin/command', { actorId: 'reviewer', command, payload }, true);
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(url + '/api/health')).ok) break; } catch {} await delay(25); }
    const login = await fetch(url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const setCookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie') || ''];
    cookie = setCookies.filter(Boolean).map(value => value.split(';', 1)[0]).join('; ');
    csrfToken = decodeURIComponent((cookie.match(/(?:^|; )eg_admin_csrf=([^;]+)/) || [])[1] || '');
    assert.equal((await fetch(url + '/support')).status, 200);
    const state = await (await fetch(url + '/api/state')).json();
    const listingId = state.state.listings[0].id;
    const png = 'iVBORw0KGgo=';
    const createdResponse = await post('/api/support/tickets', { category: 'bug', severity: 'high', subject: 'Checkout button does not respond', description: 'Clicking the checkout button does not open the agreement form on the marketplace page.', pageUrl: '/market', reporterHandle: 'tester', related: { listingId }, environment: { userAgent: 'test browser', viewport: '800x600', locale: 'en-US', appVersion: 'test' }, attachments: [{ filename: '../checkout.png', mime: 'image/png', dataB64: png }] });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.id, /^tkt_/);
    const publicResponse = await fetch(url + `/api/support/tickets/${created.id}`), publicData = await publicResponse.json();
    assert.equal(publicResponse.status, 200);
    assert.equal(publicData.ticket.attachments[0].filename, '._checkout.png');
    assert.ok(!JSON.stringify(publicData).includes('dataB64'));
    assert.equal(publicData.ticket.replies.length, 0);
    const attachmentId = publicData.ticket.attachments[0].id;
    const attachmentResponse = await fetch(url + `/api/admin/support/tickets/${created.id}/attachments/${attachmentId}`, { headers: adminHeaders() });
    assert.equal(attachmentResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await attachmentResponse.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
    const publicState = await (await fetch(url + '/api/state')).json();
    assert.equal(Object.hasOwn(publicState.state, 'supportTickets'), false);

    const reply = await post(`/api/support/tickets/${created.id}/replies`, { body: 'I can reproduce this in the demo browser.' });
    assert.equal(reply.status, 201);
    assert.equal((await reply.json()).ticket.replies.length, 1);
    assert.equal((await command('support_update_ticket', { ticketId: created.id, status: 'in_progress', assignee: 'reviewer' })).status, 200);
    assert.equal((await command('support_reply', { ticketId: created.id, body: 'Internal reproduction note.', visibility: 'internal' })).status, 200);
    const after = await (await fetch(url + '/api/admin/overview', { headers: adminHeaders() })).json();
    assert.equal(after.supportTickets[0].status, 'in_progress');
    assert.equal(after.analytics.support.open, 1);
    const publicAfter = await (await fetch(url + `/api/support/tickets/${created.id}`)).json();
    assert.equal(publicAfter.ticket.replies.length, 1);
    assert.ok(!JSON.stringify(publicAfter).includes('Internal reproduction note'));

    const invalid = await post('/api/support/tickets', { category: 'bug', severity: 'low', subject: 'Bad attachment', description: 'This should be rejected because the bytes are not a PNG.', attachments: [{ filename: 'bad.png', mime: 'image/png', dataB64: Buffer.from('not a png').toString('base64') }] });
    assert.equal(invalid.status, 415);
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
