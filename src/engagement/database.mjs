// SQLite persistence for the engagement slice.
//
// Uses Node >=22.13 built-in node:sqlite (DatabaseSync). No external deps.
//
// SAFETY INVARIANTS:
//  * Existing DB files are NEVER replaced, truncated, or re-initialized.
//    Missing/altered schema or unsupported user_version fails startup; known
//    schema migrations are applied in place and revalidated before serving.
//  * The secret file (<db>.secret) is created ONLY for a truly new DB.
//    Existing DB without a valid secret file refuses startup.
//  * All writes go through prepared statements; transactions are synchronous
//    (BEGIN IMMEDIATE ... COMMIT/ROLLBACK). Promise results are rejected.
//  * Rate-limit keys store only HMAC-derived identifiers, never raw IPs,
//    cookies, or session tokens.

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  readFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { EngagementError, error, hmac, RETENTION_DAYS, DAY } from './security.mjs';

const APPLICATION_ID = 0x45474d54; // 'EGMT'
const USER_VERSION = 2;
const LEGACY_USER_VERSION = 1;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

function assertNodeVersion() {
  const v = process.versions.node;
  const [maj, min] = v.split('.').map((n) => parseInt(n, 10));
  if (maj > 22 || (maj === 22 && min >= 13)) return;
  throw new EngagementError(
    500,
    'RUNTIME_UNSUPPORTED',
    `Node >=22.13 required for node:sqlite (found ${v})`,
  );
}

assertNodeVersion();
const { DatabaseSync } = await import('node:sqlite');

const EXPECTED_TABLES = {
  metadata: `CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT`,
  visitor_sessions: `CREATE TABLE visitor_sessions(token_hash TEXT PRIMARY KEY,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT`,
  threads: `CREATE TABLE threads(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE REFERENCES visitor_sessions(token_hash) ON DELETE CASCADE,display_name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','closed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,read_through INTEGER NOT NULL DEFAULT 0, contact_email TEXT NOT NULL DEFAULT '') STRICT`,
  messages: `CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,sender TEXT NOT NULL CHECK(sender IN ('visitor','admin')),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at INTEGER NOT NULL,client_id TEXT NOT NULL,signature TEXT NOT NULL,UNIQUE(thread_id,sender,client_id)) STRICT`,
  events: `CREATE TABLE events(event_hash TEXT PRIMARY KEY,day TEXT NOT NULL,session_hash TEXT NOT NULL,created_at INTEGER NOT NULL,path TEXT NOT NULL,referrer TEXT NOT NULL,device TEXT NOT NULL CHECK(device IN ('desktop','mobile','tablet')),country TEXT NOT NULL) STRICT`,
  rate_limits: `CREATE TABLE rate_limits(key TEXT PRIMARY KEY,window_end INTEGER NOT NULL,count INTEGER NOT NULL) STRICT`,
};

const LEGACY_TABLES = {
  ...EXPECTED_TABLES,
  threads: `CREATE TABLE threads(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE REFERENCES visitor_sessions(token_hash) ON DELETE CASCADE,display_name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','closed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,read_through INTEGER NOT NULL DEFAULT 0) STRICT`,
};

const EXPECTED_INDEXES = {
  idx_messages_thread_id: `CREATE INDEX idx_messages_thread_id ON messages(thread_id,id)`,
  idx_messages_created_at: `CREATE INDEX idx_messages_created_at ON messages(created_at)`,
  idx_events_day_session: `CREATE INDEX idx_events_day_session ON events(day,session_hash)`,
  idx_events_created_at: `CREATE INDEX idx_events_created_at ON events(created_at)`,
  idx_threads_updated_at: `CREATE INDEX idx_threads_updated_at ON threads(updated_at)`,
  idx_rate_limits_window_end: `CREATE INDEX idx_rate_limits_window_end ON rate_limits(window_end)`,
  idx_visitor_sessions_expires_at: `CREATE INDEX idx_visitor_sessions_expires_at ON visitor_sessions(expires_at)`,
};

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function ensureDir(path) {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function readSecretFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const trimmed = raw.replace(/\r?\n$/, '');
  if (!SECRET_RE.test(trimmed)) return null;
  const buf = Buffer.from(trimmed, 'base64url');
  if (buf.length !== 32) return null;
  return buf;
}

function writeSecretFileExclusive(path, buf) {
  const b64 = buf.toString('base64url');
  const data = Buffer.from(b64 + '\n', 'utf8');
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (e) {
    if (e && e.code === 'EEXIST') return null;
    throw e;
  }
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return b64;
}

function createDbFileExclusive(path) {
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (e) {
    if (e && e.code === 'EEXIST') return false;
    throw e;
  }
  closeSync(fd);
  return true;
}

function decodeSecretInput(secret) {
  if (typeof secret === 'string') {
    if (!SECRET_RE.test(secret)) {
      throw new EngagementError(500, 'CONFIG_INVALID', 'secret must be 43 base64url chars');
    }
    const b = Buffer.from(secret, 'base64url');
    if (b.length !== 32) {
      throw new EngagementError(500, 'CONFIG_INVALID', 'secret must decode to 32 bytes');
    }
    return b;
  }
  if (Buffer.isBuffer(secret)) {
    if (secret.length < 32) {
      throw new EngagementError(500, 'CONFIG_INVALID', 'secret buffer must be >=32 bytes');
    }
    return Buffer.from(secret);
  }
  throw new EngagementError(500, 'CONFIG_INVALID', 'secret must be string or Buffer');
}

function validateSchema(db, tables = EXPECTED_TABLES, expectedVersion = USER_VERSION) {
  const appRow = db.prepare('PRAGMA application_id').get();
  const appVal = appRow ? Number(Object.values(appRow)[0]) : 0;
  if (appVal !== APPLICATION_ID) {
    throw new EngagementError(
      500,
      'DB_SCHEMA_MISMATCH',
      `Unexpected application_id (${appVal}); refusing to touch existing database`,
    );
  }
  const uvRow = db.prepare('PRAGMA user_version').get();
  const uvVal = uvRow ? Number(Object.values(uvRow)[0]) : 0;
  if (uvVal !== expectedVersion) {
    throw new EngagementError(
      500,
      'DB_SCHEMA_MISMATCH',
      `Unexpected user_version (${uvVal}); refusing to touch existing database`,
    );
  }

  const rows = db
    .prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'`)
    .all();
  const byName = new Map();
  for (const r of rows) byName.set(r.name, r);

  const expectedNames = new Set([
    ...Object.keys(tables),
    ...Object.keys(EXPECTED_INDEXES),
  ]);

  for (const r of rows) {
    if (!expectedNames.has(r.name)) {
      throw new EngagementError(
        500,
        'DB_SCHEMA_MISMATCH',
        `Unexpected schema object: ${r.type} ${r.name}`,
      );
    }
  }

  for (const [name, expected] of Object.entries(tables)) {
    const row = byName.get(name);
    if (!row || row.type !== 'table') {
      throw new EngagementError(500, 'DB_SCHEMA_MISMATCH', `Missing table: ${name}`);
    }
    if (normalizeSql(row.sql) !== normalizeSql(expected)) {
      throw new EngagementError(500, 'DB_SCHEMA_MISMATCH', `Table definition mismatch: ${name}`);
    }
  }
  for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
    const row = byName.get(name);
    if (!row || row.type !== 'index') {
      throw new EngagementError(500, 'DB_SCHEMA_MISMATCH', `Missing index: ${name}`);
    }
    if (normalizeSql(row.sql) !== normalizeSql(expected)) {
      throw new EngagementError(500, 'DB_SCHEMA_MISMATCH', `Index definition mismatch: ${name}`);
    }
  }
}

function userVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return row ? Number(Object.values(row)[0]) : 0;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function migrateLegacySchema(db) {
  if (userVersion(db) !== LEGACY_USER_VERSION) return false;
  const alreadyAdded = hasColumn(db, 'threads', 'contact_email');
  validateSchema(db, alreadyAdded ? EXPECTED_TABLES : LEGACY_TABLES, LEGACY_USER_VERSION);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!alreadyAdded) db.exec("ALTER TABLE threads ADD COLUMN contact_email TEXT NOT NULL DEFAULT ''");
    db.exec(`PRAGMA user_version = ${USER_VERSION}`);
    db.exec('COMMIT');
    if (userVersion(db) !== USER_VERSION) {
      db.exec(`PRAGMA user_version = ${USER_VERSION}`);
      if (userVersion(db) !== USER_VERSION) {
        throw new EngagementError(500, 'DB_MIGRATION_FAILED', 'Schema migration did not persist its version marker');
      }
    }
    return true;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw new EngagementError(500, 'DB_MIGRATION_FAILED', `Schema migration failed: ${e.message}`);
  }
}

function quickCheck(db) {
  const r = db.prepare('PRAGMA quick_check').get();
  const val = r ? Object.values(r)[0] : null;
  if (val !== 'ok') {
    throw new EngagementError(500, 'DB_CORRUPT', `quick_check failed: ${val}`);
  }
}

function foreignKeyCheck(db) {
  const rows = db.prepare('PRAGMA foreign_key_check').all();
  if (rows.length > 0) {
    throw new EngagementError(500, 'DB_CORRUPT', 'foreign_key_check reported violations');
  }
}

function readFingerprint(db) {
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('secret_fingerprint');
  return row ? row.value : null;
}

export class EngagementDatabase {
  constructor({ file, secret, now = Date.now } = {}) {
    if (typeof file !== 'string' || file.length === 0) {
      throw new EngagementError(500, 'CONFIG_INVALID', 'EngagementDatabase requires a file path');
    }
    if (typeof now !== 'function') {
      throw new EngagementError(500, 'CONFIG_INVALID', 'now must be a function');
    }
    const abs = isAbsolute(file) ? file : resolve(file);
    this.file = abs;
    this.now = now;
    this._stmtCache = new Map();
    this._stmtCacheMax = 128;
    this.db = null;
    this.secret = null;
    this._inTransaction = false;

    const dir = dirname(abs);
    ensureDir(dir);

    const existed = existsSync(abs);
    const isNew = !existed;

    let secretBuf = null;
    if (secret !== undefined && secret !== null) {
      secretBuf = decodeSecretInput(secret);
    }

    const secretPath = abs + '.secret';

    if (isNew) {
      // Brand new DB: create file exclusively, then secret exclusively.
      const created = createDbFileExclusive(abs);
      if (!created) {
        // Concurrent creator won the race; treat as existing.
        throw new EngagementError(
          500,
          'DB_RACE',
          'Database file appeared during initialization; retry startup',
        );
      }
      if (!secretBuf) {
        const fresh = randomBytes(32);
        const wrote = writeSecretFileExclusive(secretPath, fresh);
        if (wrote === null) {
          const again = readSecretFile(secretPath);
          if (!again) {
            throw new EngagementError(500, 'SECRET_INVALID', 'Secret file exists but is invalid');
          }
          secretBuf = again;
        } else {
          secretBuf = fresh;
        }
      } else {
        // Caller supplied secret via env: NEVER write it to disk.
        // The DB fingerprint is validated below; a stale sidecar is ignored.
      }
    } else {
      // Existing DB: never write anything until validated.
      if (!secretBuf) {
        const existing = readSecretFile(secretPath);
        if (!existing) {
          throw new EngagementError(
            500,
            'SECRET_MISSING',
            'Existing database has no valid secret file; refusing to start',
          );
        }
        secretBuf = existing;
      } else {
        // Caller supplied secret via env: NEVER write it to disk.
        // The DB fingerprint is validated below; a stale sidecar is ignored.
      }
    }

    this.secret = secretBuf;

    // Phase 1: read-only validation of existing DB (no writes, no WAL pragmas).
    if (!isNew) {
      let roDb = null;
      try {
        roDb = new DatabaseSync(abs, { readOnly: true });
        const version = userVersion(roDb);
        const legacyHasContact = version === LEGACY_USER_VERSION && hasColumn(roDb, 'threads', 'contact_email');
        const schemaVersion = version === LEGACY_USER_VERSION ? LEGACY_USER_VERSION : USER_VERSION;
        validateSchema(roDb, legacyHasContact || version !== LEGACY_USER_VERSION ? EXPECTED_TABLES : LEGACY_TABLES, schemaVersion);
        quickCheck(roDb);
        foreignKeyCheck(roDb);
        const fp = readFingerprint(roDb);
        if (!fp) {
          throw new EngagementError(
            500,
            'SECRET_MISSING',
            'Existing database has no secret fingerprint; refusing to start',
          );
        }
        const expectedFp = hmac(this.secret, 'engagement-secret-fingerprint-v1');
        if (fp !== expectedFp) {
          throw new EngagementError(
            500,
            'SECRET_MISMATCH',
            'Secret does not match persisted fingerprint; refusing to start',
          );
        }
      } catch (e) {
        if (roDb) {
          try {
            roDb.close();
          } catch {
            /* ignore */
          }
        }
        throw e;
      }
      try {
        roDb.close();
      } catch {
        /* ignore */
      }
    }

    // Phase 2: open writable connection.
    let db;
    try {
      db = new DatabaseSync(abs);
    } catch (e) {
      throw new EngagementError(500, 'DB_OPEN_FAILED', `Failed to open database: ${e.message}`);
    }
    this.db = db;

    try {
      this._configurePragmas();
      if (isNew) {
        this._initializeNew();
      } else {
        // Re-verify after opening writable (defense in depth).
        if (userVersion(db) === LEGACY_USER_VERSION) migrateLegacySchema(db);
        validateSchema(db);
        quickCheck(db);
        foreignKeyCheck(db);
        const fp = readFingerprint(db);
        const expectedFp = hmac(this.secret, 'engagement-secret-fingerprint-v1');
        if (!fp || fp !== expectedFp) {
          throw new EngagementError(
            500,
            'SECRET_MISMATCH',
            'Secret fingerprint mismatch after writable open',
          );
        }
      }
      this.prune();
    } catch (e) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      this.db = null;
      throw e;
    }
  }

  _configurePragmas() {
    const db = this.db;
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 3000');
    db.exec('PRAGMA synchronous = FULL');
  }

  _initializeNew() {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const sql of Object.values(EXPECTED_TABLES)) db.exec(sql);
      for (const sql of Object.values(EXPECTED_INDEXES)) db.exec(sql);
      const fp = hmac(this.secret, 'engagement-secret-fingerprint-v1');
      db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('secret_fingerprint', fp);
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      db.exec(`PRAGMA user_version = ${USER_VERSION}`);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw new EngagementError(500, 'DB_INIT_FAILED', `Schema init failed: ${e.message}`);
    }
  }

  stmt(sql) {
    if (typeof sql !== 'string' || sql.length === 0) {
      throw new EngagementError(500, 'INTERNAL', 'stmt requires SQL string');
    }
    let s = this._stmtCache.get(sql);
    if (s) return s;
    s = this.db.prepare(sql);
    if (this._stmtCache.size >= this._stmtCacheMax) {
      const firstKey = this._stmtCache.keys().next().value;
      this._stmtCache.delete(firstKey);
    }
    this._stmtCache.set(sql, s);
    return s;
  }

  transaction(fn) {
    if (typeof fn !== 'function') {
      throw new EngagementError(500, 'INTERNAL', 'transaction requires a function');
    }
    if (this._inTransaction) {
      throw new EngagementError(500, 'INTERNAL', 'nested transactions are not supported');
    }
    this.db.exec('BEGIN IMMEDIATE');
    this._inTransaction = true;
    let result;
    try {
      result = fn();
      if (result && typeof result.then === 'function') {
        throw new EngagementError(500, 'INTERNAL', 'transaction body must be synchronous');
      }
      this.db.exec('COMMIT');
      this._inTransaction = false;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      this._inTransaction = false;
      throw e;
    }
    return result;
  }

  rateLimit(scope, identity, max, windowMs, time = this.now()) {
    if (!this._inTransaction) throw new EngagementError(500, 'INTERNAL', 'rateLimit requires a transaction');
    if (typeof scope !== 'string' || scope.length === 0 || scope.length > 64) {
      throw new EngagementError(500, 'INTERNAL', 'rateLimit scope invalid');
    }
    if (typeof identity !== 'string' || identity.length === 0 || identity.length > 512) {
      throw new EngagementError(500, 'INTERNAL', 'rateLimit identity invalid');
    }
    if (!Number.isInteger(max) || max <= 0 || max > 1e9) {
      throw new EngagementError(500, 'INTERNAL', 'rateLimit max invalid');
    }
    if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > 30 * DAY) {
      throw new EngagementError(500, 'INTERNAL', 'rateLimit windowMs invalid');
    }
    if (!Number.isSafeInteger(time) || time < 0) {
      throw new EngagementError(500, 'INTERNAL', 'rateLimit time invalid');
    }
    const windowStart = Math.floor(time / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    const key = hmac(this.secret, 'rate', scope, identity, String(windowStart));

    const row = this.stmt('SELECT count, window_end FROM rate_limits WHERE key = ?').get(key);
    if (row && row.window_end === windowEnd) {
      if (row.count >= max) {
        const retryAfter = Math.max(1, Math.ceil((windowEnd - time) / 1000));
        error(
          429,
          'RATE_LIMITED',
          `Rate limit exceeded for ${scope}; retry in ${retryAfter}s`,
          retryAfter,
        );
      }
      this.stmt('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
      return;
    }
    this.stmt(
      'INSERT INTO rate_limits(key,window_end,count) VALUES(?,?,1) ' +
        'ON CONFLICT(key) DO UPDATE SET window_end = excluded.window_end, count = 1',
    ).run(key, windowEnd);
  }

  prune(time = this.now()) {
    if (!Number.isSafeInteger(time) || time < 0) {
      throw new EngagementError(500, 'INTERNAL', 'prune time invalid');
    }
    const cutoff = time - RETENTION_DAYS * DAY;
    const delEvents = this.stmt('DELETE FROM events WHERE created_at < ?');
    const delMessages = this.stmt('DELETE FROM messages WHERE created_at < ?');
    const delThreads = this.stmt(
      'DELETE FROM threads WHERE updated_at < ? AND id NOT IN (SELECT DISTINCT thread_id FROM messages)',
    );
    const delSessions = this.stmt('DELETE FROM visitor_sessions WHERE expires_at <= ?');
    const delRate = this.stmt('DELETE FROM rate_limits WHERE window_end <= ?');

    return this.transaction(() => {
      const events = delEvents.run(cutoff).changes;
      const messages = delMessages.run(cutoff).changes;
      const threads = delThreads.run(cutoff).changes;
      const sessions = delSessions.run(time).changes;
      const rate = delRate.run(time).changes;
      return { events, messages, threads, sessions, rate };
    });
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* ignore */
      }
      this.db = null;
    }
    this._stmtCache.clear();
    this._inTransaction = false;
  }
}
