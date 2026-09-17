/**
 * Fail-closed orchestration around the read-only Solana reconciliation path.
 *
 * This worker does not sign or broadcast. It only reads finalized evidence,
 * records verified funding in an idempotent journal, and tells an operator
 * whether the same logical operation is safe to retry, needs reconciliation,
 * or is terminally rejected.
 */
import { reconcileFundingOnRpc, SOLANA_RECONCILIATION_ERRORS } from './solana-reconciliation.mjs';
import { RECONCILIATION_ERRORS } from './reconciliation.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';

export const CHAIN_WORKER_STATES = Object.freeze({ VERIFIED: 'verified', PENDING: 'pending', UNKNOWN: 'unknown', FAILED: 'failed', REJECTED: 'rejected' });

const RETRYABLE_CODES = new Set([
  SOLANA_RECONCILIATION_ERRORS.INVALID_RPC,
  SOLANA_RECONCILIATION_ERRORS.MISSING_TRANSACTION,
  SOLANA_RECONCILIATION_ERRORS.MISSING_ACCOUNT
]);
const PENDING_CODES = new Set(['NOT_FINALIZED']);
const TERMINAL_INVARIANT_CODES = new Set([
  ...Object.values(SOLANA_RECONCILIATION_ERRORS).filter(code => !RETRYABLE_CODES.has(code) && code !== SOLANA_RECONCILIATION_ERRORS.SIGNATURE_FAILED),
  ...Object.values(RECONCILIATION_ERRORS).filter(code => code !== RECONCILIATION_ERRORS.NOT_FINALIZED && code !== RECONCILIATION_ERRORS.DUPLICATE_OPERATION),
  'MINT_MISMATCH'
]);
const text = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const address = value => {
  if (!text(value)) return false;
  try { const bytes = base58Decode(value); return bytes.length === 32 && bytes.some(byte => byte !== 0) && base58Encode(bytes) === value; } catch { return false; }
};
const signature = value => {
  if (!text(value) || value.length > 128) return false;
  try { const bytes = base58Decode(value); return bytes.length === 64 && base58Encode(bytes) === value; } catch { return false; }
};

function validEvidence(value, operationId, { signature: expectedSignature, vault: expectedVault } = {}) {
  return plain(value)
    && value.operationId === operationId
    && (expectedSignature === undefined || value.signature === expectedSignature)
    && (expectedVault === undefined || value.vault === expectedVault)
    && signature(value.signature)
    && value.status === 'finalized'
    && /^[a-f0-9]{64}$/.test(value.intentHash)
    && !/^0+$/.test(value.intentHash)
    && address(value.vault)
    && /^(0|[1-9]\d*)$/.test(value.amount)
    && BigInt(value.amount) > 0n
    && address(value.genesisHash)
    && value.pdaBindingsVerified === true;
}

/** Normalize a reconciliation result into an operationally safe disposition. */
export function classifyReconciliationResult(result) {
  if (result?.ok === true) return Object.freeze({ state: CHAIN_WORKER_STATES.VERIFIED, retryable: false, terminal: true, code: null, message: 'Finalized custody evidence verified.' });
  const code = typeof result?.code === 'string' ? result.code : 'UNKNOWN_RECONCILIATION_ERROR';
  if (PENDING_CODES.has(code)) return Object.freeze({ state: CHAIN_WORKER_STATES.PENDING, retryable: true, terminal: false, code, message: result.message || 'The funding signature is not finalized yet.' });
  if (code === SOLANA_RECONCILIATION_ERRORS.SIGNATURE_FAILED) return Object.freeze({ state: CHAIN_WORKER_STATES.FAILED, retryable: false, terminal: true, code, message: result.message || 'The funding transaction failed on chain.' });
  if (code === 'DUPLICATE_OPERATION') return Object.freeze({ state: CHAIN_WORKER_STATES.REJECTED, retryable: false, terminal: true, code, message: result.message || 'The operation is already bound to evidence.' });
  if (RETRYABLE_CODES.has(code)) return Object.freeze({ state: CHAIN_WORKER_STATES.UNKNOWN, retryable: true, terminal: false, code, message: result.message || 'Chain evidence could not be read reliably; do not request a new signature yet.' });
  if (TERMINAL_INVARIANT_CODES.has(code)) return Object.freeze({ state: CHAIN_WORKER_STATES.REJECTED, retryable: false, terminal: true, code, message: result?.message || 'The chain evidence failed a custody invariant.' });
  return Object.freeze({ state: CHAIN_WORKER_STATES.UNKNOWN, retryable: false, terminal: false, code, message: result?.message || 'Chain evidence is inconclusive; do not request a new signature yet.' });
}

export class CustodyChainWorker {
  constructor({ rpc, journal, expectedGenesisHash, allowedMints, reconcile = reconcileFundingOnRpc } = {}) {
    if (!rpc || typeof rpc.getSignatureStatuses !== 'function' || typeof rpc.getTransaction !== 'function') throw new Error('A read-only Solana RPC adapter is required.');
    if (!journal || typeof journal.appendIdempotentEvidence !== 'function' || typeof journal.findCustodyEvidence !== 'function') throw new Error('An idempotent custody journal is required.');
    if (typeof reconcile !== 'function') throw new Error('A reconciliation function is required.');
    this.rpc = rpc;
    this.journal = journal;
    this.expectedGenesisHash = expectedGenesisHash;
    this.allowedMints = allowedMints;
    this.reconcile = reconcile;
  }

  async reconcileFunding(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.operationId !== 'string' || input.operationId.trim() === '') {
      return Object.freeze({ state: CHAIN_WORKER_STATES.REJECTED, retryable: false, terminal: true, code: 'INVALID_OPERATION', message: 'A logical operationId is required.' });
    }
    let existing;
    try { existing = this.journal.findCustodyEvidence(input.operationId); } catch (error) {
      return Object.freeze({ state: CHAIN_WORKER_STATES.UNKNOWN, retryable: false, terminal: false, code: error?.code || 'JOURNAL_ERROR', message: error instanceof Error ? error.message : 'The custody journal could not be read safely.' });
    }
    if (existing) {
      if (!validEvidence(existing.result, input.operationId, input)) return Object.freeze({ state: CHAIN_WORKER_STATES.REJECTED, retryable: false, terminal: true, replayed: true, code: 'MALFORMED_EVIDENCE', message: 'The custody journal returned malformed or request-unbound evidence.' });
      return Object.freeze({ state: CHAIN_WORKER_STATES.VERIFIED, retryable: false, terminal: true, replayed: true, code: null, message: 'Previously verified custody evidence was replayed idempotently.', value: existing.result });
    }

    const { record: _ignoredRecord, ...request } = input;
    let result;
    try {
      result = await this.reconcile({
        ...request,
        rpc: this.rpc,
        expectedGenesisHash: this.expectedGenesisHash,
        allowedMints: this.allowedMints,
        record: evidence => this.journal.appendIdempotentEvidence(evidence)
      });
    } catch (error) {
      result = { ok: false, code: error?.code || 'RECONCILIATION_ERROR', message: error instanceof Error ? error.message : 'Custody reconciliation failed.' };
    }
    const disposition = classifyReconciliationResult(result);
    if (result?.ok === true && !validEvidence(result.value, input.operationId, input)) {
      return Object.freeze({ state: CHAIN_WORKER_STATES.REJECTED, retryable: false, terminal: true, code: 'MALFORMED_EVIDENCE', message: 'Reconciliation returned evidence without the required finalized operation, PDA and provenance bindings.' });
    }
    return Object.freeze({ ...disposition, ...(result?.ok === true ? { value: result.value } : { details: result?.details }) });
  }
}
