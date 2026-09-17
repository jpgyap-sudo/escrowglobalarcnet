// End-to-end deployment smoke test. Creates one clearly labelled QA chat, then
// closes it. No customer data is deleted. Credentials/cookies remain in memory.
// Set EG_QA_EMAIL. Enter the existing operator password on the hidden terminal
// prompt. Optional --pause-for-restart verifies guest persistence across restart.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const publicBase = process.env.EG_QA_PUBLIC || 'https://www.escrowglobal.io';
const adminBase = process.env.EG_QA_ADMIN || 'https://admin.escrowglobal.io';
const collector = process.env.EG_QA_COLLECTOR || 'https://www.escrowglobal.io:9443';
const email = process.env.EG_QA_EMAIL;
if (!email) throw new Error('Set EG_QA_EMAIL; never provide a password in an argument or file.');
for (const base of [publicBase, adminBase, collector]) {
  const u = new URL(base);
  assert.equal(u.origin, base, 'Supply an origin, without path or credentials');
  assert.ok((u.protocol === 'https:' && ['www.escrowglobal.io', 'admin.escrowglobal.io'].includes(u.hostname)) ||
    (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)), 'Unapproved QA destination');
}

async function hiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('An interactive TTY is required; no password files.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = '';
    const finish = (err) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

const check = (label, condition) => { assert.ok(condition, label); console.log('PASS', label); };
async function request(base, path, { jar, method = 'GET', data, origin, csrf, headers = {} } = {}) {
  const h = { 'User-Agent': 'EscrowGlobal-Deployment-QA/1.0', ...headers };
  if (jar?.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (origin) h.Origin = origin;
  if (csrf) h['X-CSRF-Token'] = csrf;
  if (data) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers: h, body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(15000), redirect: 'manual' });
  const setCookies = r.headers.getSetCookie();
  if (jar) for (const cookie of setCookies) {
    const pair = cookie.split(';', 1)[0];
    const split = pair.indexOf('=');
    jar.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, headers: r.headers, json, setCookies };
}

const guest = new Map(), second = new Map(), admin = new Map();
const label = `Deployment QA ${new Date().toISOString()}`;
let password = await hiddenLine('Existing admin password (hidden): ');
let adminCsrf;
async function login() {
  const r = await request(adminBase, '/api/admin/login', { jar: admin, method: 'POST', origin: adminBase, data: { email, password } });
  check('operator login', r.status === 200);
  const session = await request(adminBase, '/api/admin/session', { jar: admin });
  adminCsrf = session.json?.csrfToken;
  check('operator session and CSRF', session.status === 200 && !!adminCsrf);
}
const visitorPost = data => request(publicBase, '/api/chat/messages', { jar: guest, method: 'POST', origin: publicBase, csrf: guestCsrf, data });
const adminPost = (path, data) => request(adminBase, path, { jar: admin, method: 'POST', origin: adminBase, csrf: adminCsrf, data });

check('admin traffic requires authentication', (await request(adminBase, '/api/admin/traffic')).status === 401);
for (const path of ['/api/state', '/api/command', '/api/admin/overview', '/api/wallet/session']) {
  check(`public boundary ${path}`, (await request(publicBase, path)).status === 404);
}
check('collector rejects foreign Origin', (await request(collector, '/api/analytics/event', {
  method: 'OPTIONS', origin: 'https://invalid.example' })).status === 403);
const preflight = await request(collector, '/api/analytics/event', { method: 'OPTIONS', origin: publicBase });
check('first-party collector preflight', preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === publicBase);

const session = await request(publicBase, '/api/chat/session', { jar: guest });
check('new visitor has empty private history', session.status === 200 && session.json.conversation === null);
const cookie = session.setCookies.find(c => c.startsWith('__Host-eg_chat=')) || '';
check('secure host-only visitor cookie', /;\s*Secure/i.test(cookie) && /;\s*HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie) && !/Domain=/i.test(cookie));
let guestCsrf = session.json.csrfToken;
const message = { body: `${label}: persistence and reply check; not a customer request.`, displayName: 'Deployment QA', clientId: randomUUID() };
check('visitor CSRF is mandatory', (await request(publicBase, '/api/chat/messages', { jar: guest, method: 'POST', origin: publicBase, data: message })).status === 403);
let sent = await visitorPost(message);
check('visitor message persisted', sent.status === 200 && sent.json.messages.length === 1);
const threadId = sent.json.conversation.id;
sent = await visitorPost(message);
check('visitor retry is idempotent', sent.status === 200 && sent.json.messages.length === 1);
check('conflicting retry rejected', (await visitorPost({ ...message, body: 'Different content' })).status === 409);
const isolated = await request(publicBase, `/api/chat/session?conversationId=${threadId}`, { jar: second });
check('second visitor cannot access first history', isolated.status === 200 && isolated.json.conversation === null && isolated.json.messages.length === 0);

await login();
const inbox = await request(adminBase, '/api/admin/chat?q=Deployment%20QA', { jar: admin });
check('admin inbox sees durable conversation', inbox.status === 200 && inbox.json.threads.some(t => t.id === threadId));
const reply = { body: 'Deployment QA reply: persisted delivery verified. No action needed.', clientId: randomUUID() };
const replied = await adminPost(`/api/admin/chat/${threadId}/reply`, reply);
check('authenticated reply persisted', replied.status === 200 && replied.json.messages.length === 2);
check('operator reply retry is idempotent', (await adminPost(`/api/admin/chat/${threadId}/reply`, reply)).json?.messages.length === 2);
const received = await request(publicBase, '/api/chat/session', { jar: guest });
check('visitor receives operator reply', received.json.messages.some(m => m.sender === 'admin' && m.body === reply.body));

const event = { sessionId: randomUUID(), eventId: randomUUID(), path: '/deal/private-qa-id?secret=not-stored',
  referrer: 'https://example.org/private-qa?not=stored', device: 'desktop' };
const eventResult = await request(collector, '/api/analytics/event', { method: 'POST', origin: publicBase, data: event,
  headers: { 'X-Escrow-Country': 'AQ', 'X-Escrow-Client-IP': '192.0.2.1' } });
check('direct collector accepts valid event', eventResult.status === 200);
check('fallback deduplicates same event', (await request(publicBase, '/api/analytics/event', { method: 'POST', origin: publicBase, data: event })).status === 200);
check('DNT respected', (await request(collector, '/api/analytics/event', { method: 'POST', origin: publicBase,
  headers: { DNT: '1' }, data: { ...event, eventId: randomUUID() } })).status === 202);
const traffic = await request(adminBase, '/api/admin/traffic?days=7', { jar: admin });
check('real traffic, geo readiness and seven-day range', traffic.status === 200 && traffic.json.totalViews > 0 &&
  traffic.json.geo.status === 'ready' && traffic.json.trend.length === 7);
check('private routes are grouped', traffic.json.pages.some(p => p.path === '/deal') &&
  !JSON.stringify(traffic.json).includes('private-qa-id') && !JSON.stringify(traffic.json).includes('not-stored'));
console.log('Country coverage observed:', traffic.json.countries.map(c => `${c.name}: ${c.views}`).join(', '));
console.log('QA thread:', threadId);

if (process.argv.includes('--pause-for-restart')) {
  await hiddenLine('PAUSED: restart only escrow-global-admin, then press Enter to verify persistence. ');
  const after = await request(publicBase, '/api/chat/session', { jar: guest });
  check('same visitor history survives service restart', after.status === 200 && after.json.conversation.id === threadId && after.json.messages.length === 2);
  check('old admin session invalidated by restart', (await request(adminBase, '/api/admin/session', { jar: admin })).status === 401);
  admin.clear();
  await login();
}
check('QA conversation closed', (await adminPost(`/api/admin/chat/${threadId}/status`, { status: 'closed' })).status === 200);
await adminPost(`/api/admin/chat/${threadId}/read`, { throughId: received.json.messages.at(-1).id });
await request(adminBase, '/api/admin/logout', { jar: admin, method: 'POST', origin: adminBase, csrf: adminCsrf, data: {} });
password = '';
console.log('PASS deployment smoke test. One closed, clearly labelled QA chat retained; no customer data deleted.');
