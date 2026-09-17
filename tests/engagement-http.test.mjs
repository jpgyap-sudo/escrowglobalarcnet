import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(r => setTimeout(r, ms));
const publicOrigin = 'https://www.escrowglobal.io';
const adminOrigin = 'https://admin.escrowglobal.io';
async function fixture(t, extra = {}) {
  const listener = net.createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-http-'));
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
  const email = 'operator@example.test', password = randomBytes(24).toString('hex'), salt = randomBytes(16);
  const hash = `scrypt$65536$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString('base64')}`;
  const dataFile = path.join(dir, 'state.json'), file = path.join(dir, 'engagement.sqlite');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, JOURNAL_FILE: path.join(dir, 'journal.jsonl'),
      ESCROW_MODE: 'sandbox', ADMIN_EMAIL: email, ADMIN_PASSWORD_HASH: hash, ADMIN_ORIGIN: adminOrigin,
      ENGAGEMENT_DB_FILE: '', ENGAGEMENT_SECRET: '', ENGAGEMENT_PUBLIC_ORIGINS: '', PUBLIC_ORIGINS: '',
      TRUST_ENGAGEMENT_PROXY: 'false', ENGAGEMENT_GEO_READY: 'false', TRUST_PROXY: '', GEO_READY: '',
      ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(url + '/api/health')).ok) { ready = true; break; } } catch {}
    await pause(30);
  }
  assert.ok(ready, 'isolated server startup: ' + logs);
  assert.ok(fs.existsSync(file), 'default DB is adjacent to isolated DATA_FILE');
  const call = async (route, { method = 'GET', data, headers = {}, raw } = {}) => {
    const h = Object.fromEntries(Object.entries({ ...(method === 'POST' ? { 'content-type': 'application/json', origin: url } : {}), ...headers }).filter(([, v]) => v !== undefined));
    const r = await fetch(url + route, { method, headers: h, body: raw ?? (data === undefined ? undefined : JSON.stringify(data)), signal: AbortSignal.timeout(15000) });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(r.headers.get('x-sandbox-notice') || '', /no-PII/i);
    return { r, data: await r.json() };
  };
  const login = async () => {
    const { r, data } = await call('/api/admin/login', { method: 'POST', data: { email, password }, headers: { origin: adminOrigin } });
    assert.equal(r.status, 200);
    return { cookie: r.headers.getSetCookie().map(s => s.split(';')[0]).join('; '), 'x-csrf-token': data.csrfToken, origin: adminOrigin };
  };
  const session = async () => {
    const { r, data } = await call('/api/chat/session'); assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /^__Host-eg_chat=.*HttpOnly.*SameSite=Strict/);
    assert.match(r.headers.get('set-cookie'), /Secure/); assert.match(r.headers.get('set-cookie'), /Max-Age=7776000/);
    return { data, headers: { cookie: r.headers.getSetCookie()[0].split(';')[0], 'x-csrf-token': data.csrfToken } };
  };
  return { call, login, session, url, port, file, dataFile, email, password };
}
const event = () => ({ sessionId: randomUUID(), eventId: randomUUID(), path: '/#/orders/private?secret=hidden', referrer: 'https://example.org/article?q=private', device: 'mobile' });

test('HTTP: durable chat, actor rejection, CSRF/read race, admin Origin and visitor isolation', async t => {
  const f = await fixture(t, { ENGAGEMENT_PUBLIC_ORIGINS: publicOrigin });
  const before = fs.readFileSync(f.dataFile);
  assert.equal((await f.call('/api/admin/chat')).r.status, 401);
  const admin = await f.login(), a = await f.session(), b = await f.session();
  assert.equal(a.data.conversation, null);
  assert.equal((await f.call('/api/admin/chat', { headers: admin })).data.total, 0);
  const msg = { body: 'Hello \uFFFD 😀', clientId: randomUUID(), displayName: 'Visitor A', email: 'visitor@example.test' };
  const send = data => f.call('/api/chat/messages', { method: 'POST', data, headers: { ...a.headers, origin: publicOrigin } });
  assert.equal((await f.call('/api/chat/messages', { method: 'POST', data: msg })).r.status, 401);
  const { email: _email, ...withoutEmail } = msg;
  assert.equal((await send(withoutEmail)).r.status, 400);
  const { displayName: _displayName, ...withoutName } = msg;
  assert.equal((await send(withoutName)).r.status, 400);
  assert.equal((await send({ ...msg, actorId: 'reviewer' })).r.status, 400);
  assert.equal((await f.call('/api/chat/messages', { method: 'POST', data: msg, headers: { ...a.headers, 'x-csrf-token': b.data.csrfToken } })).r.status, 403);
  const first = await send(msg); assert.equal(first.r.status, 200);
  assert.equal(Object.hasOwn(first.data.conversation, 'contactEmail'), false);
  const id = first.data.conversation.id, mid = first.data.messages[0].id, route = `/api/admin/chat/${id}`;
  assert.equal((await send(msg)).data.conversation.messageCount, 1);
  assert.equal((await send({ ...msg, body: 'conflict' })).r.status, 409);
  assert.equal((await f.call('/api/chat/session?conversationId=' + id, { headers: b.headers })).data.conversation, null);
  assert.equal((await f.call(route, { headers: a.headers })).r.status, 401);
  const adminDetail = (await f.call(route, { headers: admin })).data;
  assert.equal(adminDetail.conversation.unreadCount, 1);
  assert.equal(adminDetail.conversation.contactEmail, 'visitor@example.test');
  for (const action of ['read', 'reply', 'status']) {
    const data = action === 'read' ? { throughId: mid } : action === 'reply' ? { body: 'Operator', clientId: randomUUID() } : { status: 'closed' };
    assert.equal((await f.call(route + '/' + action, { method: 'POST', data, headers: { cookie: admin.cookie } })).r.status, 403);
    assert.equal((await f.call(route + '/' + action, { method: 'POST', data, headers: { ...admin, origin: publicOrigin } })).r.status, 403);
    assert.equal((await f.call(route + '/' + action, { method: 'POST', data, headers: { ...admin, origin: undefined } })).r.status, 403);
  }
  await send({ body: 'Arrived after displayed transcript', displayName: 'Visitor', email: 'visitor@example.test', clientId: randomUUID() });
  assert.equal((await f.call(route + '/read', { method: 'POST', data: { throughId: mid }, headers: admin })).r.status, 200);
  assert.equal((await f.call(route, { headers: admin })).data.conversation.unreadCount, 1);
  assert.equal((await f.call(route + '/read', { method: 'POST', data: { throughId: mid + 10000 }, headers: admin })).r.status, 400);
  const reply = { body: 'A real operator reply', clientId: randomUUID() };
  for (let i = 0; i < 2; i++) assert.equal((await f.call(route + '/reply', { method: 'POST', data: reply, headers: admin })).r.status, 200);
  assert.equal((await f.call(route + '/status', { method: 'POST', data: { status: 'closed' }, headers: admin })).r.status, 200);
  assert.equal((await send(msg)).data.conversation.status, 'closed');
  assert.equal((await send({ body: 'Reopen', displayName: 'Visitor', email: 'visitor@example.test', clientId: randomUUID() })).data.conversation.status, 'open');
  const history = (await f.call('/api/chat/session', { headers: a.headers })).data;
  assert.equal(Object.hasOwn(history.conversation, 'contactEmail'), false);
  assert.equal(history.messages.filter(m => m.sender === 'admin').length, 1);
  assert.equal(history.messages.length, 4);
  assert.doesNotMatch(JSON.stringify(history), /token_hash|signature|admin@example/);
  assert.ok(fs.readFileSync(f.dataFile).equals(before), 'chat does not mutate sandbox state');
});

test('HTTP: route-scoped origins, bounded bodies/cookies, trusted geo and cross-collector dedupe', async t => {
  const f = await fixture(t, { ENGAGEMENT_PUBLIC_ORIGINS: publicOrigin, TRUST_ENGAGEMENT_PROXY: 'true', ENGAGEMENT_GEO_READY: 'true' });
  const admin = await f.login(), e = event();
  for (const route of ['/api/state', '/api/admin/traffic', '/api/admin/chat']) assert.equal((await f.call(route, { headers: { ...admin, origin: publicOrigin } })).r.status, 403);
  for (const origin of [undefined, 'null', publicOrigin + '.evil.test', publicOrigin + '/']) assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: e, headers: { origin } })).r.status, 403);
  for (const raw of ['{', 'null', '[]']) assert.equal((await f.call('/api/analytics/event', { method: 'POST', raw })).r.status, 400);
  assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: e, headers: { 'content-type': 'application/json-evil' } })).r.status, 400);
  assert.equal((await f.call('/api/analytics/event', { method: 'POST', raw: 'x'.repeat(17000) })).r.status, 413);
  assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: { ...e, country: 'US' } })).r.status, 400);
  const primary = await f.call('/api/analytics/event', { method: 'POST', data: e, headers: { origin: publicOrigin, 'x-escrow-client-ip': '203.0.113.7', 'x-escrow-country': 'SG' } });
  assert.equal(primary.r.status, 200); assert.equal(primary.r.headers.get('set-cookie'), null);
  assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: e, headers: { origin: publicOrigin, 'x-escrow-client-ip': '127.0.0.1' } })).r.status, 200);
  for (const h of [{ dnt: '1' }, { 'sec-gpc': '1' }, { 'user-agent': 'SearchSpider' }]) assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: event(), headers: h })).r.status, 202);
  const traffic = (await f.call('/api/admin/traffic?days=7', { headers: admin })).data;
  assert.equal(traffic.totalViews, 1); assert.equal(traffic.geo.status, 'ready'); assert.equal(traffic.countries[0].code, 'SG');
  assert.deepEqual(traffic.pages, [{ path: '/orders', views: 1 }]); assert.deepEqual(traffic.referrers, [{ host: 'example.org', views: 1 }]);
  assert.equal((await f.call('/api/admin/traffic?days=8', { headers: admin })).r.status, 400);
  assert.equal((await f.call('/api/admin/chat?limit=999', { headers: admin })).data.limit, 100);
  for (const cookie of ['__Host-eg_chat=' + 'a'.repeat(129), '__Host-eg_chat=bad', '__Host-eg_chat=bad; __Host-eg_chat=bad']) assert.equal((await f.call('/api/chat/session', { headers: { cookie } })).r.status, 400);
  assert.equal((await f.call('/api/chat/unknown')).r.status, 404);
  for (const asset of ['/visitor-tools.mjs', '/visitor-tools.css']) {
    if (fs.existsSync(path.join(root, 'public', asset.slice(1)))) assert.equal((await fetch(f.url + asset)).status, 200);
  }
  // Chunked request: no Content-Length shortcut, still a reliable JSON 413.
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(f.url + '/api/analytics/event', { method: 'POST', headers: { origin: f.url, 'content-type': 'application/json' } }, res => {
      let body = ''; res.on('data', x => body += x); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }); req.on('error', reject); req.write('a'.repeat(10000)); req.end('b'.repeat(10000));
  });
  assert.equal(chunked.status, 413); assert.equal(chunked.body.code, 'PAYLOAD_TOO_LARGE');
});

test('HTTP: SQLite writer contention returns 503 and retry commits exactly once', async t => {
  const f = await fixture(t), e = event(), writer = new DatabaseSync(f.file);
  try {
    writer.exec('BEGIN IMMEDIATE');
    const r = await f.call('/api/analytics/event', { method: 'POST', data: e });
    assert.equal(r.r.status, 503); assert.equal(r.data.code, 'ENGAGEMENT_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(r.data), /sqlite|SELECT|INSERT|[A-Z]:\\/);
    assert.equal(writer.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
    writer.exec('ROLLBACK');
    for (let i = 0; i < 2; i++) assert.equal((await f.call('/api/analytics/event', { method: 'POST', data: e })).r.status, 200);
    assert.equal(writer.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
  } finally { writer.close(); }
});

test('HTTP: bounded concurrent scrypt verification recovers, bounded inputs rejected', async t => {
  const f = await fixture(t);
  for (const data of [{ email: 'x'.repeat(255), password: 'x' }, { email: f.email, password: 'x'.repeat(1025) }]) assert.equal((await f.call('/api/admin/login', { method: 'POST', data })).r.status, 400);
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => f.call('/api/admin/login', { method: 'POST', data: { email: `attempt${i}@example.test`, password: 'not-the-generated-password' } })));
  assert.ok(results.some(x => x.data.code === 'ADMIN_LOGIN_BUSY'));
  assert.ok(results.every(x => [401, 429].includes(x.r.status)));
  assert.ok(results.filter(x => x.r.status === 401).length <= 2);
  assert.ok(results.filter(x => x.data.code === 'ADMIN_LOGIN_BUSY').every(x => x.r.headers.get('retry-after') === '1'));
  await f.login();
});

test('HTTP: spoofed X-Forwarded-For/engagement IP cannot bypass login limits when trust is off', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) {
    const r = await f.call('/api/admin/login', { method: 'POST', data: { email: `failure${i}@example.test`, password: 'incorrect' }, headers: { 'x-forwarded-for': `198.51.100.${i + 1}`, 'x-escrow-client-ip': `203.0.113.${i + 1}` } });
    assert.equal(r.r.status, 401);
  }
  const r = await f.call('/api/admin/login', { method: 'POST', data: { email: f.email, password: f.password }, headers: { 'x-forwarded-for': '192.0.2.99', 'x-escrow-client-ip': '192.0.2.99' } });
  assert.equal(r.r.status, 429); assert.equal(r.data.code, 'ADMIN_LOGIN_RATE_LIMITED');
});
