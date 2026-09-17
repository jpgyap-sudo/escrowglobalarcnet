/**
 * Fail-closed orchestration for a future payroll custody adapter.
 *
 * The worker verifies an unsigned batch intent, asks an injected signer for
 * an opaque signed-payload reference, and asks an injected read-only adapter
 * about finality/reconciliation. It has no RPC client, broadcast method or
 * key material capability. Production wiring must supply those capabilities
 * outside this module and pass an admitted `payroll_vault` funding source.
 */
import { agreementHash } from './agreement.mjs';
import { verifyPayrollPayoutIntent } from './payroll-custody-intent.mjs';

const STATES = new Set(['in_progress', 'signed', 'final', 'failed']);
const OUTCOMES = new Set(['final', 'pending', 'failed', 'duplicate', 'rejected']);
const REQUIRED_PAYROLL_GATES = new Set(['payroll-vault', 'payroll-auth', 'payroll-ledger', 'payroll-worker']);
const nowMs = value => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Worker clock must be a non-negative safe integer.'); return value; };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function assertDependencies(deps) {
  if (!plain(deps)) fail('Payroll payout worker dependencies are required.');
  if (typeof deps.signer?.sign !== 'function') fail('Payroll payout worker requires an injected signer.');
  if (!plain(deps.finality) || typeof deps.finality.checkFinality !== 'function' || typeof deps.finality.reconcile !== 'function') fail('Payroll payout worker requires a read-only finality/reconciliation adapter.');
  for (const forbidden of ['broadcast', 'send', 'submit', 'sendRawTransaction', 'sendTransaction']) if (Object.prototype.hasOwnProperty.call(deps.finality, forbidden)) fail(`Finality adapter must not expose ${forbidden}.`);
  if (!plain(deps.idempotency) || typeof deps.idempotency.get !== 'function' || typeof deps.idempotency.putIfAbsent !== 'function' || typeof deps.idempotency.update !== 'function') fail('Payroll payout worker requires an atomic idempotency store.');
  if (deps.now !== undefined && typeof deps.now !== 'function') fail('Payroll payout worker clock must be a function.');
  if (deps.readiness !== undefined && typeof deps.readiness !== 'function') fail('Payroll payout worker readiness must be a function.');
}

function productionReady(deps) {
  if (typeof deps.readiness !== 'function') return false;
  let board;
  try { board = deps.readiness(); } catch { return false; }
  if (!plain(board) || board.ready !== true || board.releaseApproved !== true || !Array.isArray(board.gates)) return false;
  const gates = new Map(board.gates.filter(gate => plain(gate)).map(gate => [gate.id, gate.ready === true]));
  return [...REQUIRED_PAYROLL_GATES].every(id => gates.get(id) === true);
}

function validateRecord(record, key) {
  if (!plain(record) || record.key !== key || typeof record.intentHash !== 'string' || !STATES.has(record.state)) fail('Payroll payout idempotency record is invalid.');
  if (record.signedPayloadRef !== null && typeof record.signedPayloadRef !== 'string') fail('Payroll payout signed-payload reference is invalid.');
  if (record.txRef !== null && typeof record.txRef !== 'string') fail('Payroll payout transaction reference is invalid.');
  return record;
}

// The batch identity is the idempotency key; the hash is checked against the
// stored record so a changed payload cannot silently become a new payout.
function keyFor(intent) { return agreementHash({ protocol: 'escrow-global-payroll-worker-v1', batchId: intent.batchId }); }
function result(outcome, intent, reason, txRef = null) { if (!OUTCOMES.has(outcome)) throw new Error('Unknown payroll worker outcome.'); return { outcome, batchId: intent?.batchId || null, txRef, reason }; }

/** Simple process-local store for tests and local adapters; production must use an atomic durable store. */
export function createMemoryPayrollIdempotencyStore() {
  const records = new Map();
  return Object.freeze({
    async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async putIfAbsent(key, record) { if (records.has(key)) return false; records.set(key, structuredClone(record)); return true; },
    async update(key, expectedState, patch) { const current = records.get(key); if (!current || current.state !== expectedState) return false; records.set(key, structuredClone({ ...current, ...patch })); return true; },
    _snapshot() { return structuredClone(Object.fromEntries(records)); }
  });
}

export function createPayrollPayoutWorker(deps) { assertDependencies(deps); return Object.freeze({ deps, now: deps.now || (() => Date.now()) }); }

/**
 * Run one payroll payout intent without ever broadcasting it. Unknown or
 * mismatched observations remain pending/failed and cannot be auto-corrected.
 */
export async function runPayrollPayout(worker, intent) {
  if (!worker || !worker.deps) fail('Payroll payout worker is required.');
  const { deps } = worker;
  const now = nowMs(worker.now());
  if (!verifyPayrollPayoutIntent(intent)) return result('rejected', intent, 'invalid_intent');
  if (intent.funding?.source !== 'payroll_vault' && deps.allowSandbox !== true) return result('rejected', intent, 'sandbox_or_unadmitted_funding');
  if (intent.funding?.source === 'payroll_vault' && !productionReady(deps)) return result('rejected', intent, 'production_readiness_blocked');
  const dueAt = Date.parse(intent.period.dueAt);
  if (!Number.isFinite(dueAt) || now < dueAt) return result('rejected', intent, 'period_not_due');
  const key = keyFor(intent);
  let record = await deps.idempotency.get(key);
  if (record) {
    validateRecord(record, key);
    if (record.intentHash !== intent.intentHash) return result('rejected', intent, 'idempotency_conflict');
    if (record.state === 'final') return result('duplicate', intent, 'already_final', record.txRef);
    if (record.state === 'failed') return result('failed', intent, 'previously_failed', record.txRef);
    if (record.state === 'in_progress') return result('pending', intent, 'in_progress');
  } else {
    const claimed = await deps.idempotency.putIfAbsent(key, { key, intentHash: intent.intentHash, state: 'in_progress', signedPayloadRef: null, txRef: null, updatedAt: now });
    if (!claimed) {
      record = await deps.idempotency.get(key);
      if (!record) return result('pending', intent, 'idempotency_race');
      validateRecord(record, key);
      if (record.intentHash !== intent.intentHash) return result('rejected', intent, 'idempotency_conflict');
      if (record.state === 'final') return result('duplicate', intent, 'already_final', record.txRef);
      if (record.state === 'failed') return result('failed', intent, 'previously_failed', record.txRef);
      if (record.state === 'in_progress') return result('pending', intent, 'in_progress');
    }
    record = await deps.idempotency.get(key);
  }
  if (!record || !STATES.has(record.state)) return result('pending', intent, 'idempotency_unavailable');
  let signedPayloadRef = record.signedPayloadRef;
  if (record.state === 'in_progress') {
    let signed;
    try {
      signed = await deps.signer.sign({
        batchId: intent.batchId, intentHash: intent.intentHash, planId: intent.planId, runId: intent.runId,
        period: intent.period, chain: intent.chain, asset: intent.asset, employer: intent.employer,
        vault: intent.vault, recipients: intent.recipients, total: intent.total
      });
      if (!plain(signed) || typeof signed.signedPayloadRef !== 'string' || !signed.signedPayloadRef.trim()) throw new Error('Signer did not return an opaque signed-payload reference.');
      signedPayloadRef = signed.signedPayloadRef.trim();
      const updated = await deps.idempotency.update(key, 'in_progress', { state: 'signed', signedPayloadRef, updatedAt: now });
      if (!updated) return result('pending', intent, 'idempotency_update_race');
    } catch (error) {
      await deps.idempotency.update(key, 'in_progress', { state: 'failed', updatedAt: now, error: error instanceof Error ? error.message.slice(0, 256) : 'signing_failed' });
      return result('failed', intent, 'signing_failed');
    }
  }
  let finality;
  try { finality = await deps.finality.checkFinality({ batchId: intent.batchId, intentHash: intent.intentHash, signedPayloadRef }); } catch { return result('pending', intent, 'finality_unknown'); }
  if (!plain(finality) || !['pending', 'final', 'failed', 'unknown'].includes(finality.status)) return result('pending', intent, 'finality_unknown');
  if (finality.status === 'pending' || finality.status === 'unknown') return result('pending', intent, finality.status === 'pending' ? 'awaiting_finality' : 'finality_unknown');
  if (finality.status === 'failed') { await deps.idempotency.update(key, 'signed', { state: 'failed', txRef: finality.txRef || null, updatedAt: now }); return result('failed', intent, 'chain_failed', finality.txRef || null); }
  if (typeof finality.txRef !== 'string' || !finality.txRef.trim()) return result('pending', intent, 'finality_unknown');
  let reconciliation;
  try { reconciliation = await deps.finality.reconcile({ intent, signedPayloadRef, txRef: finality.txRef || null }); } catch { return result('pending', intent, 'reconciliation_unknown', finality.txRef || null); }
  if (!plain(reconciliation) || !['match', 'mismatch', 'unknown'].includes(reconciliation.status)) return result('pending', intent, 'reconciliation_unknown', finality.txRef || null);
  if (reconciliation.status === 'unknown') return result('pending', intent, 'reconciliation_unknown', finality.txRef || null);
  const txRef = reconciliation.observedTxRef || finality.txRef || null;
  if (reconciliation.status === 'mismatch') { await deps.idempotency.update(key, 'signed', { state: 'failed', txRef, updatedAt: now }); return result('failed', intent, 'reconciliation_mismatch', txRef); }
  const updated = await deps.idempotency.update(key, 'signed', { state: 'final', txRef, updatedAt: now });
  return updated ? result('final', intent, 'reconciled', txRef) : result('pending', intent, 'idempotency_update_race', txRef);
}
