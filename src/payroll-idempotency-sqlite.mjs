/**
 * Durable, atomic idempotency storage for the payroll payout worker.
 *
 * This adapter stores only payout coordination metadata (never keys, signed
 * bytes, recipient secrets, or RPC credentials). It intentionally exposes the
 * small async interface consumed by payroll-payout-worker.mjs while using
 * synchronous node:sqlite statements so INSERT/UPDATE compare-and-set calls
 * are atomic across worker processes.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const APPLICATION_ID = 0x50574944; // "PWID"
const USER_VERSION = 1;
const TABLE = 'payroll_idempotency';
const STATES = new Set(['in_progress', 'signed', 'final', 'failed']);
const KEY_RE = /^[A-Za-z0-9:_-]{1,256}$/;
const TEXT_MAX = 1024;

const SCHEMA = `CREATE TABLE ${TABLE}(
  key TEXT PRIMARY KEY,
  intent_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('in_progress','signed','final','failed')),
  signed_payload_ref TEXT,
  tx_ref TEXT,
  updated_at INTEGER NOT NULL,
  error TEXT
) STRICT`;

function fail(message) { throw new Error(message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, label, max = TEXT_MAX) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(`${label} is invalid.`);
  return value;
}
function nullableText(value, label) {
  if (value !== null && (typeof value !== 'string' || value.length === 0 || value.length > TEXT_MAX)) fail(`${label} is invalid.`);
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('updatedAt is invalid.');
  return value;
}
function validateKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) fail('Payroll idempotency key is invalid.');
  return key;
}
function validateRecord(record, expectedKey = undefined) {
  if (!plain(record)) fail('Payroll idempotency record is required.');
  const allowed = new Set(['key', 'intentHash', 'state', 'signedPayloadRef', 'txRef', 'updatedAt', 'error']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`Unexpected payroll idempotency field: ${key}`);
  const key = validateKey(record.key);
  if (expectedKey !== undefined && key !== expectedKey) fail('Payroll idempotency key mismatch.');
  text(record.intentHash, 'intentHash');
  if (!STATES.has(record.state)) fail('Payroll idempotency state is invalid.');
  nullableText(record.signedPayloadRef, 'signedPayloadRef');
  nullableText(record.txRef, 'txRef');
  timestamp(record.updatedAt);
  if (record.error !== undefined && record.error !== null) nullableText(record.error, 'error');
  return {
    key,
    intentHash: record.intentHash,
    state: record.state,
    signedPayloadRef: record.signedPayloadRef ?? null,
    txRef: record.txRef ?? null,
    updatedAt: record.updatedAt,
    ...(record.error ? { error: record.error } : {}),
  };
}

function rowToRecord(row) {
  if (!row) return null;
  const record = {
    key: String(row.key),
    intentHash: String(row.intent_hash),
    state: String(row.state),
    signedPayloadRef: row.signed_payload_ref === null ? null : String(row.signed_payload_ref),
    txRef: row.tx_ref === null ? null : String(row.tx_ref),
    updatedAt: Number(row.updated_at),
  };
  if (row.error !== null && row.error !== undefined) record.error = String(row.error);
  return validateRecord(record);
}

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function validateSchema(db) {
  const app = Number(Object.values(db.prepare('PRAGMA application_id').get() || {})[0] || 0);
  const version = Number(Object.values(db.prepare('PRAGMA user_version').get() || {})[0] || 0);
  if (app !== APPLICATION_ID || version !== USER_VERSION) fail('Payroll idempotency database schema mismatch.');
  const rows = db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'`).all();
  const table = rows.find(row => row.type === 'table' && row.name === TABLE);
  if (!table || String(table.sql).replace(/\s+/g, ' ').trim() !== SCHEMA.replace(/\s+/g, ' ').trim()) fail('Payroll idempotency table schema mismatch.');
  if (rows.some(row => row.name !== TABLE)) fail('Unexpected payroll idempotency schema object.');
}

const { DatabaseSync } = await import('node:sqlite');

export class PayrollIdempotencySqliteStore {
  constructor({ file } = {}) {
    if (typeof file !== 'string' || file.length === 0) fail('Payroll idempotency store requires a file path.');
    const abs = isAbsolute(file) ? file : resolve(file);
    ensureDir(abs);
    const isNew = !existsSync(abs);
    this.file = abs;
    // Validate an existing file read-only before any writable pragmas can
    // modify journal state. A foreign/corrupt database must fail closed.
    if (!isNew) {
      const ro = new DatabaseSync(abs, { readOnly: true });
      try { validateSchema(ro); } finally { try { ro.close(); } catch { /* ignore */ } }
    }
    this.db = new DatabaseSync(abs);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;');
      if (isNew) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(SCHEMA);
          this.db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${USER_VERSION};`);
          this.db.exec('COMMIT');
        } catch (error) {
          try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
          throw error;
        }
      } else validateSchema(this.db);
      validateSchema(this.db);
    } catch (error) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
      throw error;
    }
    this._get = this.db.prepare(`SELECT key,intent_hash,state,signed_payload_ref,tx_ref,updated_at,error FROM ${TABLE} WHERE key = ?`);
    this._insert = this.db.prepare(`INSERT OR IGNORE INTO ${TABLE}(key,intent_hash,state,signed_payload_ref,tx_ref,updated_at,error) VALUES(?,?,?,?,?,?,?)`);
    this._update = this.db.prepare(`UPDATE ${TABLE} SET state=?,signed_payload_ref=?,tx_ref=?,updated_at=?,error=? WHERE key=? AND state=?`);
  }

  _assertOpen() { if (!this.db) fail('Payroll idempotency store is closed.'); }

  async get(key) {
    this._assertOpen();
    return rowToRecord(this._get.get(validateKey(key)));
  }

  async putIfAbsent(key, record) {
    this._assertOpen();
    const normalized = validateRecord({ ...record, key }, key);
    const result = this._insert.run(normalized.key, normalized.intentHash, normalized.state, normalized.signedPayloadRef, normalized.txRef, normalized.updatedAt, normalized.error ?? null);
    return Number(result.changes) === 1;
  }

  async update(key, expectedState, patch) {
    this._assertOpen();
    validateKey(key);
    if (!STATES.has(expectedState)) fail('Expected payroll idempotency state is invalid.');
    if (!plain(patch)) fail('Payroll idempotency patch is required.');
    const current = await this.get(key);
    if (!current || current.state !== expectedState) return false;
    const next = validateRecord({ ...current, ...patch, key }, key);
    const result = this._update.run(next.state, next.signedPayloadRef, next.txRef, next.updatedAt, next.error ?? null, key, expectedState);
    return Number(result.changes) === 1;
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }
}
