/**
 * Deterministic transaction-attempt state machine for a future wallet client.
 *
 * This module is intentionally side-effect free: it never connects to RPC,
 * signs bytes, broadcasts a transaction, or treats a browser callback as
 * proof of finality.
 */
export const TRANSACTION_STATES = Object.freeze({
  DRAFT: 'draft', AWAITING_SIGNATURE: 'awaiting_signature', SIGNED: 'signed',
  SUBMITTED: 'submitted', CONFIRMED: 'confirmed', FINALIZED: 'finalized',
  UNKNOWN: 'unknown', FAILED: 'failed', EXPIRED: 'expired', CANCELLED: 'cancelled'
});

const values = Object.values(TRANSACTION_STATES);
const terminal = new Set(['finalized', 'failed', 'expired', 'cancelled']);
const retryable = new Set(['failed', 'expired']);
const transitions = Object.freeze({
  draft: new Set(['awaiting_signature', 'cancelled']),
  awaiting_signature: new Set(['signed', 'failed', 'expired', 'cancelled']),
  // The RPC can time out after receiving a fully signed transaction. Keep
  // that submission ambiguity explicit instead of forcing the caller to
  // guess whether it failed and risk requesting a duplicate signature.
  signed: new Set(['submitted', 'unknown', 'failed', 'expired', 'cancelled']),
  submitted: new Set(['confirmed', 'unknown', 'failed', 'expired']),
  confirmed: new Set(['finalized', 'unknown', 'failed']),
  // An RPC timeout or a pruned recent-cache result is not proof of failure.
  // Reconciliation must resolve this state before a new signature is sought.
  unknown: new Set(['submitted', 'confirmed', 'finalized', 'failed', 'expired']),
  finalized: new Set(), failed: new Set(['draft']), expired: new Set(['draft']), cancelled: new Set()
});
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export class TransactionLifecycleError extends Error {
  constructor(code, message) { super(message); this.name = 'TransactionLifecycleError'; this.code = code; }
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function jsonSafe(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TransactionLifecycleError('INVALID_JSON', 'Metadata contains a non-finite number.'); return; }
  if (typeof value !== 'object' || seen.has(value)) throw new TransactionLifecycleError('INVALID_JSON', 'Metadata must contain only JSON-safe values.');
  seen.add(value);
  if (!Array.isArray(value) && !plain(value)) throw new TransactionLifecycleError('INVALID_JSON', 'Metadata must contain plain objects.');
  for (const item of Array.isArray(value) ? value : Object.values(value)) jsonSafe(item, seen);
  seen.delete(value);
}

function requireId(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new TransactionLifecycleError('INVALID_ID', `${label} must be 1–128 safe identifier characters.`);
  return value;
}
function requireHash(value) {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new TransactionLifecycleError('INVALID_INTENT_HASH', 'intentHash must be 64 lowercase hexadecimal characters.');
  return value;
}
function requireTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TransactionLifecycleError('INVALID_TIME', 'Transaction time must be a non-negative safe integer.');
  return value;
}
function requireSignature(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) throw new TransactionLifecycleError('INVALID_SIGNATURE', 'A wallet signature is required and must be at most 512 characters.');
  return value;
}

export function createTransactionAttempt({ operationId, intentHash, meta = {}, now = Date.now() }) {
  requireId(operationId, 'operationId'); requireHash(intentHash); requireTime(now);
  if (!plain(meta)) throw new TransactionLifecycleError('INVALID_META', 'meta must be a plain object.');
  jsonSafe(meta);
  return Object.freeze({ operationId, intentHash, state: 'draft', attempt: 1, signature: null, error: null, meta: structuredClone(meta), history: [{ state: 'draft', attempt: 1, at: now, reason: 'created' }] });
}

export function transitionTransaction(record, { to, now, reason = null, signature, error } = {}) {
  validateTransactionAttempt(record);
  if (!values.includes(to)) throw new TransactionLifecycleError('INVALID_STATE', `Unknown transaction state: ${String(to)}.`);
  if (terminal.has(record.state)) throw new TransactionLifecycleError('TERMINAL_STATE', `Cannot transition from ${record.state}.`);
  if (!transitions[record.state].has(to)) throw new TransactionLifecycleError('ILLEGAL_TRANSITION', `Illegal transition ${record.state} → ${to}.`);
  const at = now === undefined ? record.history.at(-1).at : requireTime(now);
  if (reason !== null && (typeof reason !== 'string' || reason.length > 256)) throw new TransactionLifecycleError('INVALID_REASON', 'reason must be null or at most 256 characters.');
  if (to === 'unknown' && (typeof reason !== 'string' || reason.trim().length < 1)) throw new TransactionLifecycleError('INVALID_REASON', 'An unknown transaction status requires an explanation for reconciliation.');
  if (at < record.history.at(-1).at) throw new TransactionLifecycleError('TIME_ORDER', 'Transaction transition time cannot precede the previous transition.');
  let nextSignature = record.signature;
  if (to === 'signed') nextSignature = requireSignature(signature);
  if (['submitted', 'confirmed', 'finalized'].includes(to)) nextSignature = requireSignature(signature || record.signature);
  if (signature !== undefined && !['signed', 'submitted', 'confirmed', 'finalized'].includes(to)) throw new TransactionLifecycleError('UNEXPECTED_SIGNATURE', 'A signature is only recorded on a signed transaction path.');
  let nextError = null;
  if (to === 'failed') {
    if (typeof error !== 'string' || error.trim().length < 1 || error.length > 512) throw new TransactionLifecycleError('INVALID_ERROR', 'A failed transaction needs an error message.');
    nextError = error;
  } else if (error !== undefined) throw new TransactionLifecycleError('UNEXPECTED_ERROR', 'error is only valid for failed transactions.');
  return Object.freeze({ ...record, state: to, signature: nextSignature, error: nextError, history: [...record.history, { state: to, attempt: record.attempt, at, reason }] });
}

export function retryTransaction(record, { now = Date.now(), reason = 'retry' } = {}) {
  validateTransactionAttempt(record);
  if (!retryable.has(record.state)) throw new TransactionLifecycleError('RETRY_NOT_ALLOWED', `Only failed or expired attempts can be retried, not ${record.state}.`);
  requireTime(now);
  if (now < record.history.at(-1).at) throw new TransactionLifecycleError('TIME_ORDER', 'Retry time cannot precede the previous transition.');
  if (typeof reason !== 'string' || reason.length > 256) throw new TransactionLifecycleError('INVALID_REASON', 'reason must be at most 256 characters.');
  if (!Number.isSafeInteger(record.attempt + 1)) throw new TransactionLifecycleError('ATTEMPT_OVERFLOW', 'Transaction attempt number overflowed.');
  return Object.freeze({ ...record, state: 'draft', attempt: record.attempt + 1, signature: null, error: null, history: [...record.history, { state: 'draft', attempt: record.attempt + 1, at: now, reason }] });
}

export function validateTransactionAttempt(record) {
  if (!plain(record)) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction attempt must be a plain object.');
  requireId(record.operationId, 'operationId'); requireHash(record.intentHash);
  if (!values.includes(record.state) || !Number.isSafeInteger(record.attempt) || record.attempt < 1) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction state or attempt is invalid.');
  if (record.signature !== null) requireSignature(record.signature);
  if (record.error !== null && (typeof record.error !== 'string' || record.error.length < 1)) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction error is invalid.');
  if (!plain(record.meta)) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction metadata is invalid.');
  if (!Array.isArray(record.history) || record.history.length < 1) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history is required.');
  for (const entry of record.history) {
    if (!plain(entry) || !values.includes(entry.state) || !Number.isSafeInteger(entry.at) || entry.at < 0 || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1 || (entry.reason !== null && (typeof entry.reason !== 'string' || entry.reason.length > 256))) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history is invalid.');
  }
  for (let index = 1; index < record.history.length; index += 1) {
    if (record.history[index].at < record.history[index - 1].at) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history timestamps must be non-decreasing.');
  }
  const first = record.history[0];
  if (first.state !== 'draft' || first.attempt !== 1 || first.reason !== 'created') throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history must begin with the initial draft.');
  for (let index = 1; index < record.history.length; index += 1) {
    const previous = record.history[index - 1];
    const entry = record.history[index];
    if (!transitions[previous.state]?.has(entry.state)) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history contains an illegal transition.');
    const expectedAttempt = entry.state === 'draft' ? previous.attempt + 1 : previous.attempt;
    if (entry.attempt !== expectedAttempt) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history contains an invalid attempt number.');
  }
  const last = record.history.at(-1);
  if (last.state !== record.state || last.attempt !== record.attempt) throw new TransactionLifecycleError('INVALID_RECORD', 'Transaction history does not match the current transaction attempt.');
  if (record.state === 'failed' && record.error === null) throw new TransactionLifecycleError('INVALID_RECORD', 'A failed transaction must retain its failure reason.');
  if (record.state !== 'failed' && record.error !== null) throw new TransactionLifecycleError('INVALID_RECORD', 'Only a failed transaction may retain an error.');
  if (['signed', 'submitted', 'confirmed', 'unknown', 'finalized'].includes(record.state)) requireSignature(record.signature);
  jsonSafe(record);
  return true;
}

export function serializeTransactionAttempt(record) { validateTransactionAttempt(record); return JSON.stringify(record); }
export function deserializeTransactionAttempt(serialized) { let value; try { value = JSON.parse(serialized); } catch { throw new TransactionLifecycleError('INVALID_JSON', 'Serialized transaction attempt is not valid JSON.'); } validateTransactionAttempt(value); return Object.freeze(value); }
export function isRetryableTransactionState(state) { return retryable.has(state); }
