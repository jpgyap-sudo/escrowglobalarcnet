/**
 * Explicit production transaction boundary for externally signed escrow
 * operations.
 *
 * This module is deliberately not wired into the sandbox HTTP server. When a
 * production deployment is approved, it provides the missing P4 seam:
 * prepare an exact legacy transaction request, accept bytes signed by an
 * external wallet, verify the bytes before relay, and resolve submission via
 * finalized RPC status. It never receives a private key or signs anything.
 */
import {
  createExternalSigningRequest,
  SOLANA_ED25519_SIGNATURE_LENGTH,
  verifyExternalSignedTransaction
} from '../../packages/escrow-sdk/external-transaction.mjs';
import {
  createTransactionAttempt,
  transitionTransaction,
  validateTransactionAttempt
} from './transaction-lifecycle.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';

export const EXTERNAL_WALLET_BOUNDARY_ERRORS = Object.freeze({
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  RELEASE_BLOCKED: 'RELEASE_BLOCKED',
  INVALID_INPUT: 'INVALID_INPUT',
  OPERATION_NOT_FOUND: 'OPERATION_NOT_FOUND',
  OPERATION_CONFLICT: 'OPERATION_CONFLICT',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  SUBMISSION_UNKNOWN: 'SUBMISSION_UNKNOWN',
  SIGNATURE_REQUIRED: 'SIGNATURE_REQUIRED',
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  INVALID_RPC_RESULT: 'INVALID_RPC_RESULT',
  RPC_FAILURE: 'RPC_FAILURE'
});

const OPERATION_STATES = new Set(['prepared', 'signed', 'relaying', 'submitted', 'confirmed', 'finalized', 'unknown', 'failed', 'expired', 'cancelled']);
const ATTEMPT_STATE_BY_OPERATION = Object.freeze({
  prepared: 'awaiting_signature', signed: 'signed', relaying: 'signed',
  submitted: 'submitted', confirmed: 'confirmed', finalized: 'finalized',
  unknown: 'unknown', failed: 'failed', expired: 'expired', cancelled: 'cancelled'
});
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export class ExternalWalletBoundaryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ExternalWalletBoundaryError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) { throw new ExternalWalletBoundaryError(code, message, details); }
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_INPUT, `${label} is invalid.`); return value; }
function hash(value, label) { if (typeof value !== 'string' || !HASH.test(value)) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_INPUT, `${label} must be lowercase SHA-256 hex.`); return value; }
function time(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_INPUT, `${label} must be a non-negative safe integer.`); return value; }
function signature(value) {
  if (typeof value !== 'string' || !SIGNATURE.test(value)) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.SIGNATURE_REQUIRED, 'A canonical base58 transaction signature is required.');
  let raw;
  try { raw = base58Decode(value); } catch { fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.SIGNATURE_REQUIRED, 'A canonical base58 transaction signature is required.'); }
  if (raw.length !== SOLANA_ED25519_SIGNATURE_LENGTH || base58Encode(raw) !== value) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.SIGNATURE_REQUIRED, 'A canonical base58 transaction signature is required.');
  return value;
}

function releaseGate(readiness) {
  const board = typeof readiness === 'function' ? readiness() : readiness;
  if (!plain(board) || board.mode !== 'production' || board.realFunds !== true || board.ready !== true || board.releaseApproved !== true) {
    fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.RELEASE_BLOCKED, 'Production external-wallet custody is disabled until the production release board and separate approval are both active.');
  }
  return board;
}

function repositoryShape(repository) {
  if (!repository || typeof repository.getOperation !== 'function' || typeof repository.createOperation !== 'function' || typeof repository.updateOperation !== 'function' || typeof repository.compareAndSetOperation !== 'function') {
    fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_CONFIGURATION, 'A durable operation repository with getOperation, createOperation, updateOperation and compareAndSetOperation is required.');
  }
  return repository;
}

function rpcShape(rpc) {
  const methods = ['getLatestBlockhash', 'getBlockHeight', 'getSignatureStatuses', 'sendRawTransaction'];
  if (!rpc || methods.some(method => typeof rpc[method] !== 'function')) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_CONFIGURATION, `The submission RPC must expose ${methods.join(', ')}.`);
  return rpc;
}

function latestValue(value) {
  const result = plain(value) && plain(value.value) ? value : { value };
  if (!plain(result.value) || typeof result.value.blockhash !== 'string' || result.value.blockhash.length < 1 || result.value.blockhash.length > 128) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'getLatestBlockhash returned an invalid blockhash.');
  time(result.value.lastValidBlockHeight, 'lastValidBlockHeight');
  const slot = result.context?.slot;
  if (slot !== undefined) time(slot, 'createdAtSlot');
  return { blockhash: result.value.blockhash, lastValidBlockHeight: result.value.lastValidBlockHeight, createdAtSlot: slot === undefined ? 0 : slot };
}

function blockHeightValue(value) {
  const result = plain(value) && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
  return time(result, 'currentBlockHeight');
}

function statusValue(value) {
  const result = plain(value) && Array.isArray(value.value) ? value.value[0] : Array.isArray(value) ? value[0] : value;
  if (result === null || result === undefined) return null;
  if (!plain(result) || (result.confirmationStatus !== undefined && !['processed', 'confirmed', 'finalized'].includes(result.confirmationStatus))) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'getSignatureStatuses returned an invalid status.');
  return result;
}

function operationRecord(value) {
  if (!plain(value) || !ID.test(value.operationId) || !HASH.test(value.intentHash) || !OPERATION_STATES.has(value.state) || !value.request || !value.attempt) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'The durable operation record is malformed.');
  try { validateTransactionAttempt(value.attempt); } catch { fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'The durable transaction attempt is malformed.'); }
  if (value.attempt.state !== ATTEMPT_STATE_BY_OPERATION[value.state]) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'The durable operation and transaction-attempt states disagree.');
  return value;
}

async function currentAfterLostUpdate(repository, operationId, fallback) {
  const current = await requireOperation(repository, operationId);
  return current || fallback;
}

function observedTransition(attempt, { to, now, signature: txSignature, error: txError } = {}) {
  let next = attempt;
  // A reconciliation worker may observe a transaction after it has already
  // advanced on chain while the relay worker still owns the journal row.
  // Preserve the lifecycle's legal path instead of manufacturing a direct
  // signed -> confirmed/finalized transition.
  if (next.state === 'signed' && ['confirmed', 'finalized'].includes(to)) {
    next = transitionTransaction(next, { to: 'submitted', now, reason: 'rpc-observed', signature: txSignature });
  }
  if (next.state === 'submitted' && to === 'finalized') {
    next = transitionTransaction(next, { to: 'confirmed', now, reason: 'rpc-observed', signature: txSignature });
  }
  return transitionTransaction(next, { to, now, reason: to === 'failed' ? 'chain-failed' : 'rpc-observed', signature: ['submitted', 'confirmed', 'finalized'].includes(to) ? txSignature : undefined, error: txError });
}

async function requireOperation(repository, operationId) {
  const value = await repository.getOperation(operationId);
  if (value === null || value === undefined) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_NOT_FOUND, 'The operation does not exist or has expired from the durable journal.');
  const record = operationRecord(value);
  if (record.operationId !== operationId) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'The durable repository returned an operation under the wrong ID.');
  if (record.request.operationId !== record.operationId || record.request.intentHash !== record.intentHash
    || record.attempt.operationId !== record.operationId || record.attempt.intentHash !== record.intentHash) {
    fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_RPC_RESULT, 'The durable operation record has inconsistent identity bindings.');
  }
  return record;
}

/**
 * Construct a production-ready boundary. The repository implementation must
 * be durable (PostgreSQL in production), must atomically reject a second
 * operation with the same id but a different intent hash, and must return
 * boolean true/false from compareAndSetOperation for concurrency control.
 * State and attempt number are both used as the optimistic-lock token because
 * retries can legitimately return an operation to the same state.
 */
export class ExternalWalletCustodyBoundary {
  constructor({ rpc, repository, readiness, decode, verifySignature, clock = () => Date.now() } = {}) {
    this.rpc = rpcShape(rpc);
    this.repository = repositoryShape(repository);
    this.readiness = readiness;
    if (typeof decode !== 'function' || typeof verifySignature !== 'function') fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_CONFIGURATION, 'A transaction decoder and signature verifier are required.');
    if (typeof clock !== 'function') fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.INVALID_CONFIGURATION, 'A clock function is required.');
    this.decode = decode;
    this.verifySignature = verifySignature;
    this.clock = clock;
  }

  async prepare({ operationId, intentHash, instructions, boundary } = {}) {
    releaseGate(this.readiness);
    id(operationId, 'operationId');
    hash(intentHash, 'intentHash');
    const existing = await this.repository.getOperation(operationId);
    if (existing !== null && existing !== undefined) {
      const record = await requireOperation(this.repository, operationId);
      if (record.intentHash !== intentHash) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_CONFLICT, 'The operation ID is already bound to a different intent hash.');
      return record;
    }
    let latest;
    let currentHeight;
    try {
      latest = latestValue(await this.rpc.getLatestBlockhash({ commitment: 'finalized' }));
      currentHeight = blockHeightValue(await this.rpc.getBlockHeight({ commitment: 'finalized' }));
    } catch (error) {
      if (error instanceof ExternalWalletBoundaryError) throw error;
      fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.RPC_FAILURE, error instanceof Error ? error.message : 'The RPC preparation request failed.');
    }
    if (currentHeight > latest.lastValidBlockHeight) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.RPC_FAILURE, 'The RPC returned an already-expired blockhash.');
    const now = time(this.clock(), 'current time');
    const request = createExternalSigningRequest({
      instructions,
      boundary,
      operationId,
      intentHash,
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      createdAtSlot: latest.createdAtSlot
    });
    let attempt = createTransactionAttempt({ operationId, intentHash, now });
    attempt = transitionTransaction(attempt, { to: 'awaiting_signature', now, reason: 'prepared' });
    const record = Object.freeze({ operationId, intentHash, state: 'prepared', request, attempt, createdAt: now, updatedAt: now });
    try {
      await this.repository.createOperation(record);
    } catch (error) {
      const concurrent = await this.repository.getOperation(operationId).catch(() => null);
      if (concurrent) {
        const checked = await requireOperation(this.repository, operationId);
        if (checked.intentHash === intentHash) return checked;
        fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_CONFLICT, 'The operation ID was concurrently bound to a different intent hash.');
      }
      throw error;
    }
    return record;
  }

  async submit({ operationId, serializedTransaction } = {}) {
    releaseGate(this.readiness);
    id(operationId, 'operationId');
    let record = await requireOperation(this.repository, operationId);
    if (['submitted', 'confirmed', 'finalized'].includes(record.state)) return record;
    if (record.state === 'unknown') fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.RECONCILIATION_REQUIRED, 'The previous submission is ambiguous; reconcile it before requesting another relay.');
    if (!['prepared', 'signed'].includes(record.state)) fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_CONFLICT, `Operation cannot be submitted from ${record.state}.`);
    const height = blockHeightValue(await this.rpc.getBlockHeight({ commitment: 'finalized' }));
    if (height > record.request.lastValidBlockHeight) {
      const expired = transitionTransaction(record.attempt, { to: 'expired', now: time(this.clock(), 'current time'), reason: 'blockhash-expired' });
      const expiredAt = time(this.clock(), 'current time');
      const changed = await this.repository.compareAndSetOperation(operationId, record.state, { expectedAttempt: record.attempt.attempt, state: 'expired', attempt: expired, updatedAt: expiredAt });
      if (!changed) {
        const current = await requireOperation(this.repository, operationId);
        if (['submitted', 'confirmed', 'finalized'].includes(current.state)) return current;
      }
      fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_CONFLICT, 'The reviewed transaction blockhash has expired; prepare a new attempt.');
    }
    let verified;
    try {
      verified = verifyExternalSignedTransaction({ request: record.request, serializedTransaction, decode: this.decode, verifySignature: this.verifySignature, currentBlockHeight: height });
    } catch (error) {
      throw error;
    }
    const txSignature = signature(verified.transactionSignature);
    const now = time(this.clock(), 'current time');
    const signed = transitionTransaction(record.attempt, { to: 'signed', now, reason: 'external-wallet-verified', signature: txSignature });
    const claimed = await this.repository.compareAndSetOperation(operationId, record.state, { expectedAttempt: record.attempt.attempt, state: 'relaying', attempt: signed, updatedAt: now });
    if (!claimed) {
      const current = await requireOperation(this.repository, operationId);
      if (['submitted', 'confirmed', 'finalized'].includes(current.state)) return current;
      if (current.state === 'unknown') fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.RECONCILIATION_REQUIRED, 'The previous submission is ambiguous; reconcile it before requesting another relay.');
      fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.OPERATION_CONFLICT, 'Another caller owns the submission attempt; do not relay a second transaction.');
    }
    try {
      const relayed = await this.rpc.sendRawTransaction(verified.serializedTransaction, { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 });
      if (relayed !== txSignature) {
        const unknown = transitionTransaction(signed, { to: 'unknown', now: time(this.clock(), 'current time'), reason: 'rpc-signature-mismatch' });
        const changed = await this.repository.updateOperation(operationId, { expectedState: 'relaying', expectedAttempt: signed.attempt, state: 'unknown', attempt: unknown, updatedAt: time(this.clock(), 'current time') });
        if (!changed) return currentAfterLostUpdate(this.repository, operationId, record);
        fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.SUBMISSION_UNKNOWN, 'The RPC returned a different signature; reconcile the signed transaction before retrying.');
      }
      const submitted = transitionTransaction(signed, { to: 'submitted', now: time(this.clock(), 'current time'), signature: txSignature, reason: 'rpc-accepted' });
      record = Object.freeze({ ...record, state: 'submitted', attempt: submitted, updatedAt: submitted.history.at(-1).at });
      const stored = await this.repository.updateOperation(operationId, { expectedState: 'relaying', expectedAttempt: signed.attempt, state: record.state, attempt: record.attempt, updatedAt: record.updatedAt });
      return stored || currentAfterLostUpdate(this.repository, operationId, record);
    } catch (error) {
      if (error instanceof ExternalWalletBoundaryError) throw error;
      const unknown = transitionTransaction(signed, { to: 'unknown', now: time(this.clock(), 'current time'), reason: 'rpc-ambiguous' });
      const changed = await this.repository.updateOperation(operationId, { expectedState: 'relaying', expectedAttempt: signed.attempt, state: 'unknown', attempt: unknown, updatedAt: time(this.clock(), 'current time') });
      if (!changed) return currentAfterLostUpdate(this.repository, operationId, record);
      fail(EXTERNAL_WALLET_BOUNDARY_ERRORS.SUBMISSION_UNKNOWN, 'RPC submission outcome is ambiguous; reconcile the signature before retrying.');
    }
  }

  async reconcile(operationId) {
    releaseGate(this.readiness);
    id(operationId, 'operationId');
    let record = await requireOperation(this.repository, operationId);
    if (['finalized', 'failed', 'expired', 'cancelled'].includes(record.state)) return record;
    const txSignature = signature(record.attempt.signature);
    const height = blockHeightValue(await this.rpc.getBlockHeight({ commitment: 'finalized' }));
    const status = statusValue(await this.rpc.getSignatureStatuses([txSignature], { searchTransactionHistory: true }));
    const now = time(this.clock(), 'current time');
    const expectedState = record.state;
    let next;
    if (status?.err !== undefined && status.err !== null) {
      next = observedTransition(record.attempt, { to: 'failed', now, error: typeof status.err === 'string' ? status.err : JSON.stringify(status.err) });
      record = Object.freeze({ ...record, state: 'failed', attempt: next, updatedAt: now });
    } else if (status?.confirmationStatus === 'finalized') {
      next = observedTransition(record.attempt, { to: 'finalized', now, signature: txSignature });
      record = Object.freeze({ ...record, state: 'finalized', attempt: next, updatedAt: now });
    } else if (status?.confirmationStatus === 'confirmed' && record.state === 'confirmed') {
      return record;
    } else if (status?.confirmationStatus === 'confirmed') {
      next = observedTransition(record.attempt, { to: 'confirmed', now, signature: txSignature });
      record = Object.freeze({ ...record, state: 'confirmed', attempt: next, updatedAt: now });
    } else if (status?.confirmationStatus === 'processed' && ['submitted', 'confirmed'].includes(record.state)) {
      return record;
    } else if (status?.confirmationStatus === 'processed') {
      next = observedTransition(record.attempt, { to: 'submitted', now, signature: txSignature });
      record = Object.freeze({ ...record, state: 'submitted', attempt: next, updatedAt: now });
    } else if (height > record.request.lastValidBlockHeight) {
      next = transitionTransaction(record.attempt, { to: 'expired', now, reason: 'blockhash-expired' });
      record = Object.freeze({ ...record, state: 'expired', attempt: next, updatedAt: now });
    } else if (record.state !== 'unknown') {
      next = transitionTransaction(record.attempt, { to: 'unknown', now, reason: 'status-unavailable' });
      record = Object.freeze({ ...record, state: 'unknown', attempt: next, updatedAt: now });
    } else {
      return record;
    }
    const stored = await this.repository.updateOperation(operationId, { expectedState, expectedAttempt: record.attempt.attempt, state: record.state, attempt: record.attempt, updatedAt: record.updatedAt });
    return stored || currentAfterLostUpdate(this.repository, operationId, record);
  }
}
