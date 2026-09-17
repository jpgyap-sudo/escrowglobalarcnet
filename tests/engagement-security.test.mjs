import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EngagementDatabase } from '../src/engagement/database.mjs';
import { ChatService } from '../src/engagement/chat.mjs';
import { AnalyticsService } from '../src/engagement/analytics.mjs';
import { DAY, loadEngagementConfig, requirePublicOrigin, trustedRequest, sanitizePath, sanitizeReferrer, countryName, shouldIgnoreAnalytics, validateToken, safeEqual, singleHeader, isKnownSource } from '../src/engagement/security.mjs';

const initial = Date.UTC(2026, 8, 13, 12);
function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-security-'));
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
  const file = path.join(dir, 'engagement.sqlite'), clock = { now: initial };
  const db = new EngagementDatabase({ file, now: () => clock.now, ...opts });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, clock, file };
}
const event = () => ({ sessionId: randomUUID(), eventId: randomUUID(), path: '/#/orders/PRIVATE?token=PRIVATE', referrer: '', device: 'tablet' });
const request = (peer = '127.0.0.1', headers = {}) => ({ socket: { remoteAddress: peer }, headers });
const is429 = e => e.status === 429 && Number(e.retryAfter) > 0;

test('security: exact allowlisted origins, aliases, no wildcard/path/userinfo and conflicting flags fail', () => {
  const config = loadEngagementConfig({ PUBLIC_ORIGINS: 'https://www.escrowglobal.io,https://escrowglobal.io' }, 4173);
  assert.equal(config.trustProxy, false); assert.equal(config.geoReady, false);
  assert.equal(requirePublicOrigin(request('127.0.0.1', { origin: 'https://www.escrowglobal.io' }), config), 'https://www.escrowglobal.io');
  for (const origin of [undefined, 'null', '*', 'https://www.escrowglobal.io/', 'https://www.escrowglobal.io.evil.test', 'https://admin.escrowglobal.io']) assert.throws(() => requirePublicOrigin(request('127.0.0.1', { origin }), config));
  for (const value of ['https://*.example.test', 'https://example.test/path', 'https://example.test/', 'https://x@example.test', 'http://example.test', 'https://example.test?q=1']) assert.throws(() => loadEngagementConfig({ ENGAGEMENT_PUBLIC_ORIGINS: value }, 4173));
  assert.equal(loadEngagementConfig({ TRUST_PROXY: 'true', GEO_READY: 'true' }, 4173).geoReady, true);
  assert.equal(loadEngagementConfig({ TRUST_ENGAGEMENT_PROXY: 'true', ENGAGEMENT_GEO_READY: 'true' }, 4173).geoReady, true);
  for (const env of [{ TRUST_ENGAGEMENT_PROXY: 'true', TRUST_PROXY: 'false' }, { ENGAGEMENT_GEO_READY: 'true', GEO_READY: 'false' }, { TRUST_PROXY: 'yes' }, { ENGAGEMENT_GEO_READY: 'true' }]) assert.throws(() => loadEngagementConfig(env, 4173));
  assert.throws(() => singleHeader({ headers: { origin: 'https://www.escrowglobal.io' }, rawHeaders: ['Origin', 'https://www.escrowglobal.io', 'Origin', 'https://evil.test'] }, 'origin'));
});

test('security: overwritten source/ISO country trusted ONLY with explicit flags and loopback peer', () => {
  const trusted = loadEngagementConfig({ TRUST_ENGAGEMENT_PROXY: 'true', ENGAGEMENT_GEO_READY: 'true' }, 4173);
  const untrusted = loadEngagementConfig({}, 4173);
  const headers = { 'x-escrow-client-ip': '198.51.100.25', 'x-escrow-country': 'SG', 'x-forwarded-for': '203.0.113.99' };
  assert.deepEqual(trustedRequest(request('127.0.0.1', headers), trusted), { source: '198.51.100.25', country: 'SG' });
  assert.deepEqual(trustedRequest(request('127.0.0.1', headers), untrusted), { source: '127.0.0.1', country: 'ZZ' });
  assert.deepEqual(trustedRequest(request('203.0.113.1', headers), trusted), { source: '203.0.113.1', country: 'ZZ' });
  assert.deepEqual(trustedRequest(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.99' }), trusted), { source: '127.0.0.1', country: 'ZZ' });
  assert.equal(trustedRequest(request('::ffff:127.0.0.1', headers), trusted).country, 'SG');
  for (const country of ['AA', 'XX', 'SG, US', 'SG<script>', 'ZZ', '123']) assert.equal(trustedRequest(request('127.0.0.1', { ...headers, 'x-escrow-country': country }), trusted).country, 'ZZ');
  assert.equal(trustedRequest(request('127.0.0.1', { 'x-escrow-client-ip': '1.1.1.1,2.2.2.2' }), trusted).source, '127.0.0.1');
  for (const source of ['127.0.0.1', '127.9.8.7', '::1', '::ffff:127.0.0.1', 'unknown', '0.0.0.0', '::']) assert.equal(isKnownSource(source), false);
  assert.equal(countryName('SG'), 'Singapore'); assert.equal(countryName('AA'), 'Unknown');
});

test('security: IPv4/IPv6 literals and userinfo referrers never persisted; paths drop identities', () => {
  for (const ref of ['http://[2001:db8::1]/private', 'https://[::1]:9443/foo', 'https://198.51.100.1/', 'http://2130706433/', 'https://operator:private@example.org/', 'https://operator@example.org/', 'data:text/plain,private', 'not a URL']) assert.equal(sanitizeReferrer(ref), 'Direct');
  assert.equal(sanitizeReferrer('https://WWW.Example.org:9443/private?secret=x#private'), 'www.example.org');
  for (const p of ['/#/orders/private?seed=SECRET', '/orders/PRIVATE?token=SECRET#hash']) assert.equal(sanitizePath(p), '/orders');
  assert.equal(sanitizePath('/not-a-known-group/private'), '/other');
  assert.equal(sanitizePath('https://example.org/private'), '/other');
  assert.equal(validateToken('a'.repeat(129)), false); assert.equal(validateToken(randomBytes(32).toString('base64url')), true);
  assert.equal(safeEqual('a'.repeat(129), 'a'.repeat(129)), false);
  assert.equal(shouldIgnoreAnalytics({ headers: { 'user-agent': 'bot' + 'x'.repeat(2000) } }), true);
});

test('privacy: consent signals ignore events; daily IDs are pseudonymous; invalid input fails', t => {
  const { db } = setup(t), a = new AnalyticsService(db, { geoReady: false }), e = event();
  for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }, { 'user-agent': 'Crawler' }]) assert.equal(a.collect(e, { headers }, { source: '198.51.100.2', country: 'SG' }).status, 202);
  assert.equal(a.traffic().totalViews, 0);
  for (const data of [{ ...e, eventId: 'bad' }, { ...e, sessionId: 'bad' }, { ...e, device: 'television' }, { ...e, country: 'US' }]) assert.throws(() => a.collect(data, {}, {}), e => e.status === 400);
  a.collect(e, {}, { source: '198.51.100.2', country: 'SG' });
  const rows = JSON.stringify(db.stmt('SELECT * FROM events').all()) + JSON.stringify(db.stmt('SELECT * FROM rate_limits').all());
  for (const secret of [e.sessionId, e.eventId, '198.51.100.2', 'PRIVATE']) assert.equal(rows.includes(secret), false);
  assert.equal(a.traffic().countries[0].code, 'ZZ'); assert.equal(a.traffic().geo.unknownViews, 1);
});

test('limits: unknown loopback sources skip IP pooling but cookie/session/global caps remain', t => {
  const { db } = setup(t), a = new AnalyticsService(db, { limits: { sourceEvents: 1, sessionEvents: 2, globalEvents: 20 } });
  const e = event();
  a.collect(e, {}, { source: '127.0.0.1' });
  a.collect({ ...e, eventId: randomUUID() }, {}, { source: '127.0.0.1' });
  assert.throws(() => a.collect({ ...e, eventId: randomUUID() }, {}, { source: '127.0.0.1' }), is429);
  assert.equal(a.collect(event(), {}, { source: '127.0.0.1' }).status, 200);
  a.collect(event(), {}, { source: '198.51.100.2' });
  assert.throws(() => a.collect(event(), {}, { source: '198.51.100.2' }), is429);
  const chat = new ChatService(db, { limits: { sessionCreates: 1, threadCreates: 1, sourceMessages: 1, sessionReads: 1, visitorMessages: 2 } });
  const one = chat.session(null, '127.0.0.1'), two = chat.session(null, '127.0.0.1');
  for (const s of [one, two]) chat.send(s.token, s.payload.csrfToken, { body: 'Hello', displayName: 'Visitor', email: 'visitor@example.test', clientId: randomUUID() }, '127.0.0.1');
  chat.session(one.token, '127.0.0.1'); chat.session(two.token, '127.0.0.1');
  assert.throws(() => chat.session(one.token, '127.0.0.1'), is429);
  const global = new AnalyticsService(db, { limits: { globalEvents: 4 } });
  assert.throws(() => global.collect(event(), {}, { source: '127.0.0.1' }), is429);
  assert.equal(global.collect(e, {}, { source: '127.0.0.1' }).status, 200, 'replay does not consume quotas');
});

test('retention: sessions/messages/events/rates pruned after 90 days; first collection time retained', t => {
  const { db, clock } = setup(t), chat = new ChatService(db), a = new AnalyticsService(db);
  const s = chat.session(null, '127.0.0.1'); chat.send(s.token, s.payload.csrfToken, { body: 'Retain temporarily', displayName: 'Visitor', email: 'visitor@example.test', clientId: randomUUID() }, '127.0.0.1');
  a.collect(event(), {}, { source: '127.0.0.1' }); const started = a.traffic().collectionStartedAt;
  clock.now += 90 * DAY + 1; db.prune();
  for (const table of ['visitor_sessions', 'threads', 'messages', 'events', 'rate_limits']) assert.equal(db.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal(a.traffic().collectionStartedAt, started); assert.equal(a.traffic().totalViews, 0);
  assert.throws(() => chat.send(s.token, s.payload.csrfToken, { body: 'Expired', displayName: 'Visitor', email: 'visitor@example.test', clientId: randomUUID() }, '127.0.0.1'), e => e.status === 401);
});

test('traffic: UTC ranges zero-filled, midnight active window and future timestamps excluded', t => {
  const { db, clock } = setup(t), a = new AnalyticsService(db, { geoReady: true }), e = event();
  clock.now = Date.UTC(2026, 8, 13, 23, 59, 59); a.collect(e, {}, { source: '127.0.0.1', country: 'SG' });
  clock.now += 2000; a.collect({ ...e, eventId: randomUUID() }, {}, { source: '127.0.0.1', country: 'SG' });
  const r = a.traffic(7); assert.equal(r.dailyVisitors, 2); assert.equal(r.countries[0].visitors, 2); assert.equal(r.activeNow, 2);
  assert.equal(r.trend.at(-1).date, '2026-09-14'); assert.equal(r.trend.at(-1).views, 1);
  for (const days of [7, 30, 90]) assert.equal(a.traffic(days).trend.length, days);
  clock.now += 5 * 60 * 1000 + 1; assert.equal(a.traffic().activeNow, 0);
  clock.now = initial; assert.equal(a.traffic().totalViews, 0); assert.equal(a.traffic().activeNow, 0);
});

test('persistence: supplied secret stays out of sidecar, missing index/secret refuses startup', t => {
  const secret = randomBytes(32).toString('base64url'), { db, file } = setup(t, { secret });
  assert.equal(fs.existsSync(file + '.secret'), false); db.close();
  assert.throws(() => new EngagementDatabase({ file, now: () => initial }));
  const reopened = new EngagementDatabase({ file, secret, now: () => initial }); reopened.close();
  const other = new DatabaseSync(file); other.exec('DROP INDEX idx_messages_thread_id'); other.close();
  const before = fs.readFileSync(file);
  assert.throws(() => new EngagementDatabase({ file, secret, now: () => initial }));
  assert.ok(fs.readFileSync(file).equals(before));
});
