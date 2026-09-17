/**
 * Durable PostgreSQL journal for ExternalWalletCustodyBoundary.
 *
 * The SDK request contains PublicKey-like values and Uint8Arrays, neither of
 * which PostgreSQL's JSON encoder can safely represent by accident. This
 * adapter uses an explicit tagged JSON codec, validates the lifecycle record
 * on both write and read, and uses state-plus-attempt conditional updates so
 * stale relay or reconciliation workers cannot overwrite a newer result.
 */
import {
  deserializeTransactionAttempt,
  serializeTransactionAttempt,
  validateTransactionAttempt
} from './transaction-lifecycle.mjs';

const PUBLIC_KEY_TAG = '__escrow_global_public_key__';
const BYTES_TAG = '__escrow_global_bytes__';
const OPERATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const OPERATION_STATES = new Set(['prepared', 'signed', 'relaying', 'submitted', 'confirmed', 'finalized', 'unknown', 'failed', 'expired', 'cancelled']);

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message) { throw new Error(`PostgreSQL operation repository: ${message}`); }

function publicKeyBytes(value, label) {
  if (!value || typeof value.toBytes !== 'function') fail(`${label} must be PublicKey-like.`);
  let raw;
  try { raw = value.toBytes(); } catch { fail(`${label} could not be read.`); }
  if (!(raw instanceof Uint8Array) || raw.length !== 32 || raw.every(byte => byte === 0)) fail(`${label} must contain 32 non-zero bytes.`);
  return Uint8Array.from(raw);
}

function encode(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('JSON values must be finite.');
    return value;
  }
  if (value instanceof Uint8Array) return { [BYTES_TAG]: Buffer.from(value).toString('hex') };
  // PublicKey implementations and the tiny test doubles used by the SDK may
  // have Object.prototype, so detect the capability before the plain-object
  // branch rather than trying to JSON-encode their methods.
  if (typeof value === 'object' && typeof value.toBytes === 'function') {
    const raw = publicKeyBytes(value, 'request public key');
    return { [PUBLIC_KEY_TAG]: Buffer.from(raw).toString('hex') };
  }
  if (typeof value !== 'object' || seen.has(value)) fail('request contains an unsupported or cyclic value.');
  if (!Array.isArray(value) && !plain(value)) {
    const raw = publicKeyBytes(value, 'request public key');
    return { [PUBLIC_KEY_TAG]: Buffer.from(raw).toString('hex') };
  }
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => encode(item, seen)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, seen)]));
  seen.delete(value);
  return result;
}

function defaultPublicKeyFromBytes(raw) {
  const bytes = Uint8Array.from(raw);
  return Object.freeze({ toBytes: () => Uint8Array.from(bytes) });
}

function decode(value, publicKeyFromBytes) {
  if (Array.isArray(value)) return value.map(item => decode(item, publicKeyFromBytes));
  if (!plain(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === BYTES_TAG) {
    if (typeof value[BYTES_TAG] !== 'string' || !/^(?:[a-f0-9]{2})*$/.test(value[BYTES_TAG])) fail('stored bytes are malformed.');
    return Uint8Array.from(Buffer.from(value[BYTES_TAG], 'hex'));
  }
  if (keys.length === 1 && keys[0] === PUBLIC_KEY_TAG) {
    if (typeof value[PUBLIC_KEY_TAG] !== 'string' || !/^[a-f0-9]{64}$/.test(value[PUBLIC_KEY_TAG])) fail('stored public key is malformed.');
    const key = publicKeyFromBytes(Uint8Array.from(Buffer.from(value[PUBLIC_KEY_TAG], 'hex')));
    publicKeyBytes(key, 'decoded public key');
    return key;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, publicKeyFromBytes)]));
}

function json(value, label) {
  try { return JSON.stringify(encode(value)); } catch (error) { fail(`${label} cannot be serialized: ${error.message}`); }
}

function parsedJson(value, label) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { fail(`${label} is not valid JSON.`); }
}

function epoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) fail(`${label} must be a representable epoch millisecond value.`);
  return new Date(value).toISOString();
}

function epochFromDb(value, label) {
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0) fail(`${label} is not a valid database timestamp.`);
  return at;
}

function operationId(value) { if (typeof value !== 'string' || !OPERATION_ID.test(value)) fail('operationId is invalid.'); return value; }
function intentHash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('intentHash is invalid.'); return value; }

function rowToRecord(row, publicKeyFromBytes) {
  if (!plain(row)) fail('database returned an invalid operation row.');
  const request = decode(parsedJson(row.request, 'request'), publicKeyFromBytes);
  const attempt = deserializeTransactionAttempt(typeof row.attempt === 'string' ? row.attempt : JSON.stringify(row.attempt));
  if (!plain(request)) fail('database request is not a JSON object.');
  const record = Object.freeze({
    operationId: operationId(row.operation_id),
    intentHash: intentHash(row.intent_hash_hex || (Buffer.isBuffer(row.intent_hash) ? row.intent_hash.toString('hex') : row.intent_hash)),
    state: row.state,
    request,
    attempt,
    createdAt: epochFromDb(row.created_at, 'created_at'),
    updatedAt: epochFromDb(row.updated_at, 'updated_at')
  });
  if (!OPERATION_STATES.has(record.state) || record.request?.operationId !== record.operationId || record.request?.intentHash !== record.intentHash || record.attempt.operationId !== record.operationId || record.attempt.intentHash !== record.intentHash) fail('database operation identity or state is inconsistent.');
  validateTransactionAttempt(record.attempt);
  return record;
}

function intentBytes(hash) { return Buffer.from(intentHash(hash), 'hex'); }

const SELECT_OPERATION_SQL = `SELECT operation_id, encode(intent_hash, 'hex') AS intent_hash_hex, state,
  request, attempt, created_at, updated_at
  FROM custody_operations WHERE operation_id = $1`;

const INSERT_OPERATION_SQL = `INSERT INTO custody_operations
  (operation_id, action, intent_hash, state, request, attempt, created_at, updated_at)
  VALUES ($1, 'external_wallet', $2, $3, $4::jsonb, $5::jsonb, $6::timestamptz, $7::timestamptz)`;

const UPDATE_OPERATION_SQL = `UPDATE custody_operations
  SET state = $2, attempt = $3::jsonb, updated_at = $4::timestamptz
  WHERE operation_id = $1 AND state = $5
    AND state NOT IN ('finalized', 'failed', 'expired', 'cancelled')
    AND (attempt->>'attempt')::integer = $6
    AND intent_hash = $7
  RETURNING operation_id, encode(intent_hash, 'hex') AS intent_hash_hex, state,
    request, attempt, created_at, updated_at`;

const CAS_OPERATION_SQL = `UPDATE custody_operations
  SET state = $3, attempt = $4::jsonb, updated_at = $5::timestamptz
  WHERE operation_id = $1 AND state = $2
    AND state NOT IN ('finalized', 'failed', 'expired', 'cancelled')
    AND (attempt->>'attempt')::integer = $6
    AND intent_hash = $7
  RETURNING operation_id, encode(intent_hash, 'hex') AS intent_hash_hex, state,
    request, attempt, created_at, updated_at`;

const UPSERT_ATTEMPT_SQL = `INSERT INTO custody_attempts
  (operation_id, attempt, state, signature, failure_reason, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
  ON CONFLICT (operation_id, attempt) DO UPDATE SET
    state = EXCLUDED.state, signature = EXCLUDED.signature,
    failure_reason = EXCLUDED.failure_reason, updated_at = EXCLUDED.updated_at`;

function attemptParams(record) {
  const attempt = record.attempt;
  return [record.operationId, attempt.attempt, attempt.state, attempt.signature, attempt.state === 'failed' ? attempt.error : null, epoch(record.updatedAt, 'updatedAt'), epoch(record.updatedAt, 'updatedAt')];
}

export function createPostgresOperationRepository({ db, publicKeyFromBytes = defaultPublicKeyFromBytes } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.transaction !== 'function') throw new Error('A PostgreSQL adapter with query and transaction is required.');
  if (typeof publicKeyFromBytes !== 'function') throw new Error('publicKeyFromBytes must be a function.');
  const repository = {
    async getOperation(id) {
      const result = await db.query(SELECT_OPERATION_SQL, [operationId(id)]);
      return Number(result?.rowCount || 0) === 0 ? null : rowToRecord(result.rows[0], publicKeyFromBytes);
    },
    async createOperation(record) {
      const createdAt = epoch(record?.createdAt, 'createdAt');
      const updatedAt = epoch(record?.updatedAt, 'updatedAt');
      const checked = rowToRecord({ operation_id: record.operationId, intent_hash_hex: record.intentHash, state: record.state, request: json(record.request, 'request'), attempt: serializeTransactionAttempt(record.attempt), created_at: new Date(createdAt), updated_at: new Date(updatedAt) }, publicKeyFromBytes);
      await db.transaction(async client => {
        await client.query(INSERT_OPERATION_SQL, [checked.operationId, intentBytes(checked.intentHash), checked.state, json(checked.request, 'request'), serializeTransactionAttempt(checked.attempt), createdAt, updatedAt]);
        await client.query(UPSERT_ATTEMPT_SQL, attemptParams(checked));
      });
    },
    async updateOperation(id, patch) {
      const current = await repository.getOperation(id);
      if (!current) throw new Error('Operation does not exist.');
      if (!plain(patch) || !OPERATION_STATES.has(patch.expectedState) || !Number.isSafeInteger(patch.expectedAttempt) || patch.expectedAttempt < 1) {
        fail('updateOperation requires expectedState and expectedAttempt.');
      }
      const next = { ...current, ...patch };
      if (!OPERATION_STATES.has(next.state)) fail('operation state is invalid.');
      const checkedAttempt = next.attempt;
      validateTransactionAttempt(checkedAttempt);
      if (checkedAttempt.operationId !== current.operationId || checkedAttempt.intentHash !== current.intentHash) fail('operation patch changes identity.');
      const result = await db.transaction(async client => {
        const updated = await client.query(UPDATE_OPERATION_SQL, [current.operationId, next.state, serializeTransactionAttempt(checkedAttempt), epoch(next.updatedAt, 'updatedAt'), patch.expectedState, patch.expectedAttempt, intentBytes(current.intentHash)]);
        if (Number(updated?.rowCount || 0) === 0) return null;
        await client.query(UPSERT_ATTEMPT_SQL, attemptParams({ ...current, ...next, attempt: checkedAttempt }));
        return updated.rows[0];
      });
      return result === null ? null : rowToRecord(result, publicKeyFromBytes);
    },
    async compareAndSetOperation(id, expectedState, patch) {
      const nextAttempt = patch?.attempt;
      if (!OPERATION_STATES.has(expectedState) || !Number.isSafeInteger(patch?.expectedAttempt) || patch.expectedAttempt < 1 || !OPERATION_STATES.has(patch?.state)) fail('compare-and-set state is invalid.');
      validateTransactionAttempt(nextAttempt);
      if (nextAttempt.operationId !== id) fail('compare-and-set attempt operationId does not match.');
      const result = await db.transaction(async client => {
        const updated = await client.query(CAS_OPERATION_SQL, [operationId(id), expectedState, patch.state, serializeTransactionAttempt(nextAttempt), epoch(patch.updatedAt, 'updatedAt'), patch.expectedAttempt, intentBytes(nextAttempt.intentHash)]);
        if (Number(updated?.rowCount || 0) === 0) return false;
        await client.query(UPSERT_ATTEMPT_SQL, attemptParams({ operationId: id, updatedAt: patch.updatedAt, attempt: nextAttempt }));
        return true;
      });
      return result === true;
    }
  };
  return Object.freeze(repository);
}

export { CAS_OPERATION_SQL, INSERT_OPERATION_SQL, SELECT_OPERATION_SQL, UPDATE_OPERATION_SQL, UPSERT_ATTEMPT_SQL };
