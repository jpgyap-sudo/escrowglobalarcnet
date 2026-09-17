import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { EngagementDatabase as DatabaseCore } from '../src/engagement/database.mjs';
import { ChatService } from '../src/engagement/chat.mjs';
import { AnalyticsService } from '../src/engagement/analytics.mjs';
import { EngagementError, hashToken, hmac, RETENTION_DAYS, DAY } from '../src/engagement/security.mjs';

const INITIAL = Date.UTC(2026, 8, 13, 12, 0, 0);
const liveDatabases = new Set();
class EngagementDatabase extends DatabaseCore {
  constructor(options) { super(options); liveDatabases.add(this); }
  close() { super.close(); liveDatabases.delete(this); }
}

function makeTmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'eng-test-'));
  const resolved = resolve(dir);
  const root = resolve(tmpdir());
  assert.ok(resolved.startsWith(root + sep), 'tmp dir must be within os.tmpdir');
  t.after(() => {
    for (const db of liveDatabases) if (db.file.startsWith(resolved + sep)) db.close();
    rmSync(resolved, { recursive: true, force: true });
  });
  return resolved;
}

function openDb(t, opts = {}) {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db = new EngagementDatabase({ file, now: () => clock.time, ...opts });
  t.after(() => { try { db.close(); } catch {} });
  return { db, file, dir, clock };
}

function expectErr(fn, status, code) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  assert.ok(caught, 'expected error');
  assert.ok(caught instanceof EngagementError, `expected EngagementError, got ${caught && caught.constructor && caught.constructor.name}: ${caught && caught.message}`);
  if (status != null) assert.equal(caught.status, status);
  if (code != null) assert.equal(caught.code, code);
  return caught;
}

function newChat(db, limits = {}) {
  return new ChatService(db, { limits: { sessionReads: 1000, sessionCreates: 1000, globalSessions: 100000, threadCreates: 1000, globalThreads: 100000, visitorMessages: 1000, sourceMessages: 1000, maxMessages: 100000, adminReplies: 1000, globalReplies: 100000, ...limits } });
}

function newAnalytics(db, opts = {}) {
  return new AnalyticsService(db, { limits: { sessionEvents: 1000, sourceEvents: 1000, globalEvents: 100000, ...(opts.limits || {}) }, geoReady: opts.geoReady });
}

function startSession(chat, source = '1.2.3.4') {
  const r = chat.session(null, source);
  assert.equal(r.newSession, true);
  return r;
}

function uuid() { return randomUUID(); }

// ---------- DB / security ----------

test('db: WAL and foreign_keys pragmas enabled', (t) => {
  const { db } = openDb(t);
  const jm = db.db.prepare('PRAGMA journal_mode').get();
  assert.equal(String(Object.values(jm)[0]).toLowerCase(), 'wal');
  const fk = db.db.prepare('PRAGMA foreign_keys').get();
  assert.equal(Number(Object.values(fk)[0]), 1);
});

test('db: secret file persisted, not raw in metadata', (t) => {
  const { db, file } = openDb(t);
  const secretPath = file + '.secret';
  assert.ok(existsSync(secretPath));
  const raw = readFileSync(secretPath, 'utf8').trim();
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  const meta = db.db.prepare('SELECT value FROM metadata WHERE key = ?').get('secret_fingerprint');
  assert.ok(meta);
  assert.notEqual(meta.value, raw);
  assert.notEqual(meta.value, db.secret.toString('base64url'));
});

test('db: reopen retains cookie/csrf/messages', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  const chat1 = newChat(db1);
  const s = startSession(chat1);
  const csrf = s.payload.csrfToken;
  const send = chat1.send(s.token, csrf, { body: 'hello', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  assert.equal(send.messages.length, 1);
  db1.close();

  const db2 = new EngagementDatabase({ file, now: () => clock.time });
  t.after(() => { try { db2.close(); } catch {} });
  const chat2 = newChat(db2);
  const again = chat2.session(s.token, '1.2.3.4');
  assert.equal(again.newSession, false);
  assert.equal(again.payload.csrfToken, csrf);
  assert.equal(again.payload.messages.length, 1);
  assert.equal(again.payload.messages[0].body, 'hello');
});

test('db: migrates v1 threads in place and preserves existing conversations', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const secret = randomBytes(32);
  const token = randomBytes(32).toString('base64url');
  const legacy = new DatabaseSync(file);
  legacy.exec('PRAGMA application_id = 1162300756');
  legacy.exec(`
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE visitor_sessions(token_hash TEXT PRIMARY KEY,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE threads(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE REFERENCES visitor_sessions(token_hash) ON DELETE CASCADE,display_name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','closed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,read_through INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,sender TEXT NOT NULL CHECK(sender IN ('visitor','admin')),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at INTEGER NOT NULL,client_id TEXT NOT NULL,signature TEXT NOT NULL,UNIQUE(thread_id,sender,client_id)) STRICT;
    CREATE TABLE events(event_hash TEXT PRIMARY KEY,day TEXT NOT NULL,session_hash TEXT NOT NULL,created_at INTEGER NOT NULL,path TEXT NOT NULL,referrer TEXT NOT NULL,device TEXT NOT NULL CHECK(device IN ('desktop','mobile','tablet')),country TEXT NOT NULL) STRICT;
    CREATE TABLE rate_limits(key TEXT PRIMARY KEY,window_end INTEGER NOT NULL,count INTEGER NOT NULL) STRICT;
    CREATE INDEX idx_messages_thread_id ON messages(thread_id,id);
    CREATE INDEX idx_messages_created_at ON messages(created_at);
    CREATE INDEX idx_events_day_session ON events(day,session_hash);
    CREATE INDEX idx_events_created_at ON events(created_at);
    CREATE INDEX idx_threads_updated_at ON threads(updated_at);
    CREATE INDEX idx_rate_limits_window_end ON rate_limits(window_end);
    CREATE INDEX idx_visitor_sessions_expires_at ON visitor_sessions(expires_at);
  `);
  legacy.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('secret_fingerprint', hmac(secret, 'engagement-secret-fingerprint-v1'));
  legacy.prepare('INSERT INTO visitor_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)').run(hashToken(token), INITIAL, INITIAL + 90 * DAY);
  legacy.prepare('INSERT INTO threads(id,token_hash,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('legacy-thread', hashToken(token), 'Legacy visitor', 'open', INITIAL, INITIAL);
  legacy.exec('PRAGMA user_version = 1');
  legacy.close();
  writeFileSync(file + '.secret', secret.toString('base64url') + '\n');

  const db = new EngagementDatabase({ file, now: () => INITIAL });
  t.after(() => { try { db.close(); } catch {} });
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(db.db.prepare('SELECT contact_email FROM threads WHERE id = ?').get('legacy-thread').contact_email, '');
  const chat = newChat(db);
  const sent = chat.send(token, hmac(secret, 'chat-csrf', token), { body: 'follow up', displayName: 'Updated visitor', email: 'updated@example.test', clientId: uuid() }, '1.2.3.4');
  assert.equal(sent.conversation.id, 'legacy-thread');
  assert.equal(chat.detail('legacy-thread').conversation.contactEmail, 'updated@example.test');
  db.db.exec('PRAGMA user_version = 1');
  db.close();
  const recovered = new EngagementDatabase({ file, now: () => INITIAL });
  t.after(() => { try { recovered.close(); } catch {} });
  assert.equal(recovered.db.prepare('PRAGMA user_version').get().user_version, 2);
});

test('db: existing zero-byte file throws and is not modified', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  writeFileSync(file, '');
  const before = statSync(file).size;
  expectErr(() => new EngagementDatabase({ file, now: () => INITIAL }), 500);
  assert.equal(statSync(file).size, before);
  assert.equal(existsSync(file + '.secret'), false);
});

test('db: random corrupt file throws and is not modified', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  writeFileSync(file, randomBytes(4096));
  const before = readFileSync(file);
  let caught = null;
  try { new EngagementDatabase({ file, now: () => INITIAL }); } catch (e) { caught = e; }
  assert.ok(caught);
  assert.ok(caught instanceof EngagementError || /SQLITE_/.test(caught.code || ''), `unexpected: ${caught && caught.code}`);
  assert.deepEqual(readFileSync(file), before);
});

test('db: missing table throws and does not reinitialize', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  db1.close();
  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE messages');
  raw.close();
  const before = readFileSync(file);
  expectErr(() => new EngagementDatabase({ file, now: () => clock.time }), 500, 'DB_SCHEMA_MISMATCH');
  assert.deepEqual(readFileSync(file), before);
});

test('db: extra trigger throws and does not modify file', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  db1.close();
  const raw = new DatabaseSync(file);
  raw.exec('CREATE TRIGGER extra_trg AFTER INSERT ON metadata BEGIN SELECT 1; END');
  raw.close();
  const before = readFileSync(file);
  expectErr(() => new EngagementDatabase({ file, now: () => clock.time }), 500, 'DB_SCHEMA_MISMATCH');
  assert.deepEqual(readFileSync(file), before);
});

test('db: missing fingerprint throws and does not reinitialize', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  db1.close();
  const raw = new DatabaseSync(file);
  raw.exec("DELETE FROM metadata WHERE key = 'secret_fingerprint'");
  raw.close();
  const before = readFileSync(file);
  expectErr(() => new EngagementDatabase({ file, now: () => clock.time }), 500, 'SECRET_MISSING');
  assert.deepEqual(readFileSync(file), before);
});

test('db: mismatched secret throws and does not replace secret file', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  db1.close();
  const secretPath = file + '.secret';
  const originalSecret = readFileSync(secretPath, 'utf8');
  const wrong = randomBytes(32).toString('base64url');
  expectErr(() => new EngagementDatabase({ file, secret: wrong, now: () => clock.time }), 500, 'SECRET_MISMATCH');
  assert.equal(readFileSync(secretPath, 'utf8'), originalSecret);
});

test('db: transaction rollback leaves no partial writes', (t) => {
  const { db } = openDb(t);
  const before = db.db.prepare('SELECT COUNT(*) AS c FROM threads').get().c;
  assert.throws(() => {
    db.transaction(() => {
      db.stmt('INSERT INTO metadata(key,value) VALUES(?,?)').run('rollback-test', 'temporary');
      throw new Error('boom');
    });
  }, /boom/);
  const after = db.db.prepare('SELECT COUNT(*) AS c FROM threads').get().c;
  assert.equal(after, before);
  assert.equal(db.stmt('SELECT value FROM metadata WHERE key = ?').get('rollback-test'), undefined);
});

test('db: SQLITE_BUSY on contention, succeeds after rollback', (t) => {
  const { db, file } = openDb(t);
  db.db.exec('PRAGMA busy_timeout = 30');
  const other = new DatabaseSync(file);
  other.exec('PRAGMA busy_timeout = 30');
  other.exec('BEGIN IMMEDIATE');
  let busy = null;
  try {
    db.transaction(() => {
      db.stmt('INSERT INTO metadata(key,value) VALUES(?,?)').run('contend', '1');
    });
  } catch (e) { busy = e; } finally { other.exec('ROLLBACK'); other.close(); }
  assert.ok(busy, 'expected busy error');
  assert.equal(busy.errcode, 5); // SQLITE_BUSY: node:sqlite uses ERR_SQLITE_ERROR + errcode.
  assert.match(busy.message, /locked/i);
  const row = db.db.prepare('SELECT value FROM metadata WHERE key = ?').get('contend');
  assert.equal(row, undefined);
  db.transaction(() => {
    db.stmt('INSERT INTO metadata(key,value) VALUES(?,?)').run('contend', '1');
  });
  const ok = db.db.prepare('SELECT value FROM metadata WHERE key = ?').get('contend');
  assert.equal(ok.value, '1');
});

// ---------- Chat: tokens / csrf / isolation ----------

test('chat: token stored only as hash, csrf HMAC bound', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const rows = db.db.prepare('SELECT token_hash FROM visitor_sessions').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, s.token);
  assert.equal(rows[0].token_hash, hashToken(s.token));
  const expected = hmac(db.secret, 'chat-csrf', s.token);
  assert.equal(s.payload.csrfToken, expected);
});

test('chat: forged/unknown token never matches existing thread', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  chat.send(s.token, s.payload.csrfToken, { body: 'hi', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const forged = randomBytes(32).toString('base64url');
  const r = chat.session(forged, '1.2.3.4');
  assert.equal(r.newSession, true);
  assert.equal(r.payload.conversation, null);
  assert.equal(r.payload.messages.length, 0);
  assert.notEqual(r.token, s.token);
});

test('chat: empty session has no thread', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  assert.equal(s.payload.conversation, null);
  assert.deepEqual(s.payload.messages, []);
  const threads = db.db.prepare('SELECT COUNT(*) AS c FROM threads').get().c;
  assert.equal(threads, 0);
});

test('chat: first send DTO exact, no hashes leaked', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const clientId = uuid();
  const r = chat.send(s.token, s.payload.csrfToken, { body: 'hello', displayName: 'Ann', email: 'ann@example.test', clientId }, '1.2.3.4');
  assert.deepEqual(Object.keys(r).sort(), ['conversation', 'messages']);
  assert.deepEqual(Object.keys(r.conversation).sort(), ['createdAt', 'displayName', 'id', 'lastMessage', 'messageCount', 'status', 'unreadCount', 'updatedAt']);
  assert.equal(r.conversation.displayName, 'Ann');
  assert.equal(Object.hasOwn(r.conversation, 'contactEmail'), false);
  const adminView = chat.detail(r.conversation.id);
  assert.equal(adminView.conversation.contactEmail, 'ann@example.test');
  assert.equal(chat.list({ q: 'ann@example.test' }).total, 1);
  assert.equal(r.conversation.status, 'open');
  assert.equal(r.conversation.messageCount, 1);
  assert.equal(r.conversation.unreadCount, 1);
  assert.equal(r.messages.length, 1);
  assert.deepEqual(Object.keys(r.messages[0]).sort(), ['body', 'clientId', 'createdAt', 'id', 'sender']);
  assert.equal(r.messages[0].sender, 'visitor');
  assert.equal(r.messages[0].body, 'hello');
  assert.equal(r.messages[0].clientId, clientId);
  const json = JSON.stringify(r);
  assert.ok(!json.includes(s.token));
  assert.ok(!json.includes(s.payload.csrfToken));
  assert.ok(!json.includes(db.secret.toString('base64url')));
});

test('chat: two visitors isolated, no cross-thread access', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const a = startSession(chat, '1.1.1.1');
  const b = startSession(chat, '2.2.2.2');
  const ra = chat.send(a.token, a.payload.csrfToken, { body: 'from-a', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.1.1.1');
  const rb = chat.send(b.token, b.payload.csrfToken, { body: 'from-b', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '2.2.2.2');
  assert.notEqual(ra.conversation.id, rb.conversation.id);
  const aView = chat.session(a.token, '1.1.1.1');
  assert.equal(aView.payload.messages.length, 1);
  assert.equal(aView.payload.messages[0].body, 'from-a');
  const bView = chat.session(b.token, '2.2.2.2');
  assert.equal(bView.payload.messages[0].body, 'from-b');
  // Visitor authorization is the server cookie, never an admin detail ID.
  assert.equal(chat.session(ra.conversation.id, '2.2.2.2').payload.conversation, null);
  expectErr(() => chat.send(b.token, a.payload.csrfToken, { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '2.2.2.2'), 403);
  expectErr(() => chat.send(b.token, b.payload.csrfToken, { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid(), conversationId: ra.conversation.id }, '2.2.2.2'), 400);
});

test('chat: validation rejects unknown actors, bad body, bad csrf', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x', clientId: uuid(), email: 'visitor@example.test' }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x', clientId: uuid(), displayName: 'Visitor' }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x', clientId: uuid(), displayName: 'Visitor', email: 'not-an-email' }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, 'wrong', { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4'), 403, 'CHAT_CSRF_INVALID');
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: '', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x'.repeat(2001), displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: 'bad key!' }, '1.2.3.4'), 400);
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid(), extra: 1 }, '1.2.3.4'), 400);
  expectErr(() => chat.send('not-a-token', s.payload.csrfToken, { body: 'x', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4'), 401, 'CHAT_UNAUTHORIZED');
});

test('chat: replay same clientId idempotent even after closed', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const clientId = uuid();
  const r1 = chat.send(s.token, s.payload.csrfToken, { body: 'once', displayName: 'Visitor', email: 'visitor@example.test', clientId }, '1.2.3.4');
  const threadId = r1.conversation.id;
  chat.status(threadId, { status: 'closed' });
  const r2 = chat.send(s.token, s.payload.csrfToken, { body: 'once', displayName: 'Visitor', email: 'visitor@example.test', clientId }, '1.2.3.4');
  assert.equal(r2.conversation.id, threadId);
  assert.equal(r2.conversation.status, 'closed');
  assert.equal(r2.messages.length, 1);
});

test('chat: conflicting replay 409, new visitor reopens', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const clientId = uuid();
  const r1 = chat.send(s.token, s.payload.csrfToken, { body: 'first', displayName: 'Visitor', email: 'visitor@example.test', clientId }, '1.2.3.4');
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'different', displayName: 'Visitor', email: 'visitor@example.test', clientId }, '1.2.3.4'), 409, 'IDEMPOTENCY_CONFLICT');
  chat.status(r1.conversation.id, { status: 'closed' });
  const r2 = chat.send(s.token, s.payload.csrfToken, { body: 'new', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  assert.equal(r2.conversation.status, 'open');
  assert.equal(r2.messages.length, 2);
});

test('chat: admin reply requires auth, no auto replies', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const r = chat.send(s.token, s.payload.csrfToken, { body: 'hi', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const threadId = r.conversation.id;
  expectErr(() => chat.reply(threadId, { body: 'reply', clientId: uuid() }, ''), 401, 'ADMIN_REQUIRED');
  expectErr(() => chat.reply(threadId, { body: 'reply', clientId: uuid() }, null), 401, 'ADMIN_REQUIRED');
  const before = chat.detail(threadId).messages.length;
  assert.equal(before, 1);
  const rep = chat.reply(threadId, { body: 'reply', clientId: uuid() }, 'admin@example.com');
  assert.equal(rep.messages.length, 2);
  assert.equal(rep.messages[1].sender, 'admin');
});

test('chat: admin idempotency per sender, distinct clientId allowed', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const r = chat.send(s.token, s.payload.csrfToken, { body: 'hi', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const threadId = r.conversation.id;
  const cid = uuid();
  const a1 = chat.reply(threadId, { body: 'same', clientId: cid }, 'admin@example.com');
  const a2 = chat.reply(threadId, { body: 'same', clientId: cid }, 'admin@example.com');
  assert.equal(a1.messages.length, a2.messages.length);
  expectErr(() => chat.reply(threadId, { body: 'diff', clientId: cid }, 'admin@example.com'), 409, 'IDEMPOTENCY_CONFLICT');
  const a3 = chat.reply(threadId, { body: 'other', clientId: uuid() }, 'admin@example.com');
  assert.equal(a3.messages.length, a2.messages.length + 1);
});

test('chat: list status/q literal wildcard, pagination caps', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  chat.send(s.token, s.payload.csrfToken, { body: 'hello %world_', displayName: 'A%B', email: 'a-b@example.test', clientId: uuid() }, '1.2.3.4');
  const all = chat.list({});
  assert.equal(all.threads.length, 1);
  const wild = chat.list({ q: '%' });
  assert.equal(wild.threads.length, 1);
  const under = chat.list({ q: '_' });
  assert.equal(under.threads.length, 1);
  const none = chat.list({ q: 'zzz' });
  assert.equal(none.threads.length, 0);
  const open = chat.list({ status: 'open' });
  assert.equal(open.threads.length, 1);
  const closed = chat.list({ status: 'closed' });
  assert.equal(closed.threads.length, 0);
  expectErr(() => chat.list({ status: 'bogus' }), 400, 'INVALID_STATUS');
  expectErr(() => chat.list({ offset: -1 }), 400, 'INVALID_OFFSET');
  expectErr(() => chat.list({ limit: 0 }), 400, 'INVALID_LIMIT');
  const capped = chat.list({ limit: 1000 });
  assert.equal(capped.limit, 100);
});

test('chat: list preview capped to 200 codepoints', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const long = '😀'.repeat(300);
  chat.send(s.token, s.payload.csrfToken, { body: long, displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const list = chat.list({});
  assert.equal(Array.from(list.threads[0].lastMessage).length, 200);
});

test('chat: detail read-only, no unread mutation', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const r = chat.send(s.token, s.payload.csrfToken, { body: 'hi', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const threadId = r.conversation.id;
  chat.reply(threadId, { body: 'reply', clientId: uuid() }, 'admin@example.com');
  const before = chat.detail(threadId).conversation.unreadCount;
  assert.equal(before, 1);
  chat.detail(threadId);
  const after = chat.detail(threadId).conversation.unreadCount;
  assert.equal(after, 1);
});

test('chat: read-through monotonic, cross-thread and future rejected', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const r = chat.send(s.token, s.payload.csrfToken, { body: 'hi', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const threadId = r.conversation.id;
  const msgId = r.messages[0].id;
  chat.read(threadId, { throughId: msgId });
  const after = chat.detail(threadId).conversation.unreadCount;
  assert.equal(after, 0);
  chat.read(threadId, { throughId: 0 });
  const still = chat.detail(threadId).conversation.unreadCount;
  assert.equal(still, 0);
  expectErr(() => chat.read(threadId, { throughId: msgId + 999 }), 400, 'INVALID_READ_MARKER');
  const s2 = startSession(chat, '9.9.9.9');
  const r2 = chat.send(s2.token, s2.payload.csrfToken, { body: 'other', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '9.9.9.9');
  expectErr(() => chat.read(threadId, { throughId: r2.messages[0].id }), 400, 'INVALID_READ_MARKER');
});

test('chat: >200 messages returns latest 200 ascending', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db);
  const s = startSession(chat);
  const first = chat.send(s.token, s.payload.csrfToken, { body: 'm0', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  const threadId = first.conversation.id;
  for (let i = 1; i < 250; i++) {
    chat.send(s.token, s.payload.csrfToken, { body: 'm' + i, displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  }
  const view = chat.session(s.token, '1.2.3.4');
  assert.equal(view.payload.messages.length, 200);
  assert.equal(view.payload.messages[0].body, 'm50');
  assert.equal(view.payload.messages[199].body, 'm249');
  for (let i = 1; i < view.payload.messages.length; i++) {
    assert.ok(view.payload.messages[i].id > view.payload.messages[i - 1].id);
  }
});

test('chat: persistent rate 429 same minute, resets next window', (t) => {
  const dir = makeTmp(t);
  const file = join(dir, 'engagement.sqlite');
  const clock = { time: INITIAL };
  const db1 = new EngagementDatabase({ file, now: () => clock.time });
  const chat1 = newChat(db1, { sessionCreates: 2 });
  chat1.session(null, '1.2.3.4');
  chat1.session(null, '1.2.3.4');
  expectErr(() => chat1.session(null, '1.2.3.4'), 429, 'RATE_LIMITED');
  db1.close();

  const db2 = new EngagementDatabase({ file, now: () => clock.time });
  t.after(() => { try { db2.close(); } catch {} });
  const chat2 = newChat(db2, { sessionCreates: 2 });
  expectErr(() => chat2.session(null, '1.2.3.4'), 429, 'RATE_LIMITED');
  clock.time = INITIAL + 60 * 60 * 1000;
  const ok = chat2.session(null, '1.2.3.4');
  assert.equal(ok.newSession, true);
});

test('chat: thread create cap rollback leaves no partial thread', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db, { threadCreates: 1 });
  const s1 = startSession(chat, '1.1.1.1');
  chat.send(s1.token, s1.payload.csrfToken, { body: 'a', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.1.1.1');
  const s2 = startSession(chat, '1.1.1.1');
  expectErr(() => chat.send(s2.token, s2.payload.csrfToken, { body: 'b', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.1.1.1'), 429, 'RATE_LIMITED');
  const threads = db.db.prepare('SELECT COUNT(*) AS c FROM threads').get().c;
  assert.equal(threads, 1);
});

test('chat: maxMessages limit, replay after limit still succeeds', (t) => {
  const { db } = openDb(t);
  const chat = newChat(db, { maxMessages: 3 });
  const s = startSession(chat);
  const cid = uuid();
  chat.send(s.token, s.payload.csrfToken, { body: 'a', displayName: 'Visitor', email: 'visitor@example.test', clientId: cid }, '1.2.3.4');
  chat.send(s.token, s.payload.csrfToken, { body: 'b', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  chat.send(s.token, s.payload.csrfToken, { body: 'c', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4');
  expectErr(() => chat.send(s.token, s.payload.csrfToken, { body: 'd', displayName: 'Visitor', email: 'visitor@example.test', clientId: uuid() }, '1.2.3.4'), 429, 'CHAT_THREAD_FULL');
  const replay = chat.send(s.token, s.payload.csrfToken, { body: 'a', displayName: 'Visitor', email: 'visitor@example.test', clientId: cid }, '1.2.3.4');
  assert.equal(replay.messages.length, 3);
});

// ---------- Analytics ----------

test('analytics: empty dashboard zero dates UTC', (t) => {
  const { db } = openDb(t);
  const a = newAnalytics(db);
  const r = a.traffic(7);
  assert.equal(r.totalViews, 0);
  assert.equal(r.dailyVisitors, 0);
  assert.equal(r.activeNow, 0);
  assert.equal(r.trend.length, 7);
  assert.equal(r.trend[6].date, '2026-09-13');
  assert.equal(r.trend[0].date, '2026-09-07');
  for (const d of r.trend) { assert.equal(d.views, 0); assert.equal(d.visitors, 0); }
  assert.equal(r.collectionStartedAt, null);
  assert.equal(r.geo.status, 'unavailable');
});

test('analytics: first event persists collectionStarted', (t) => {
  const { db } = openDb(t);
  const a = newAnalytics(db);
  a.collect({ sessionId: uuid(), eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1' });
  const r = a.traffic(7);
  assert.ok(r.collectionStartedAt);
  assert.equal(r.collectionStartedAt, new Date(INITIAL).toISOString());
});

test('analytics: eventId retry across changed source/country/route counts 1', (t) => {
  const { db } = openDb(t);
  const a = newAnalytics(db, { geoReady: true });
  const sid = uuid();
  const eid = uuid();
  a.collect({ sessionId: sid, eventId: eid, path: '/a', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1', country: 'US' });
  a.collect({ sessionId: sid, eventId: eid, path: '/b', referrer: 'https://x.com', device: 'mobile' }, {}, { source: '2.2.2.2', country: 'DE' });
  const r = a.traffic(7);
  assert.equal(r.totalViews, 1);
  assert.equal(r.countries.length, 1);
  assert.equal(r.countries[0].code, 'US');
});

test('analytics: session pseudonyms differ across days', (t) => {
  const { db, clock } = openDb(t);
  const a = newAnalytics(db);
  const sid = uuid();
  a.collect({ sessionId: sid, eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1' });
  clock.time = INITIAL + DAY;
  a.collect({ sessionId: sid, eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1' });
  const rows = db.db.prepare('SELECT DISTINCT session_hash FROM events').all();
  assert.equal(rows.length, 2);
});

test('analytics: sum dailyVisitors vs people not cross-day', (t) => {
  const { db, clock } = openDb(t);
  const a = newAnalytics(db);
  const sid = uuid();
  a.collect({ sessionId: sid, eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1' });
  clock.time = INITIAL + DAY;
  a.collect({ sessionId: sid, eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '1.1.1.1' });
  const r = a.traffic(7);
  assert.equal(r.dailyVisitors, 2);
});

test('analytics: sanitized path and referrer host only', (t) => {
  const { db } = openDb(t);
  const a = newAnalytics(db);
  a.collect({ sessionId: uuid(), eventId: uuid(), path: '/orders/private?wallet=secret', referrer: 'https://example.com/page?x=1', device: 'desktop' }, {}, { source: '1.1.1.1' });
  const r = a.traffic(7);
  assert.equal(r.pages[0].path, '/orders');
  assert.equal(r.referrers[0].host, 'example.com');
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes('wallet'));
  assert.ok(!raw.includes('secret'));
});

test('analytics: Direct referrer and IPv6 source not stored', (t) => {
  const { db } = openDb(t);
  const a = newAnalytics(db);
  a.collect({ sessionId: uuid(), eventId: uuid(), path: '/', referrer: '', device: 'desktop' }, {}, { source: '2001:db8::1' });
  const r = a.traffic(7);
  assert.equal(r.referrers[0].host, 'Direct');
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes('2001:db8'));
});
