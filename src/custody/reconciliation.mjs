/**
 * Pure verification boundary for a future Solana funding reconciler.
 *
 * The RPC adapter must normalize a finalized transaction into `observed`.
 * This module never contacts the network, signs, broadcasts, or mutates a
 * ledger. Decimal token amounts stay strings so large u64 values are exact.
 */
import { verifyIntent } from './intent.mjs';
import { deriveMilestoneReserve } from '../../packages/custody-contracts/reference-quote.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';

export const LEGACY_SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const FINALIZED_STATUS = 'finalized';
export const RECONCILIATION_ERRORS = Object.freeze({
  INVALID_INTENT: 'INVALID_INTENT', INVALID_OBSERVED: 'INVALID_OBSERVED',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION', NOT_FINALIZED: 'NOT_FINALIZED',
  MISMATCH: 'MISMATCH', MISSING_TRANSFER: 'MISSING_TRANSFER',
  MULTIPLE_TRANSFERS: 'MULTIPLE_TRANSFERS', EXTRA_TRANSFERS: 'EXTRA_TRANSFERS'
});

const decimal = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const SUPPORTED_NETWORKS = new Set(['localnet', 'devnet', 'testnet', 'mainnet-beta']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (code, message, details = undefined) => ({ ok: false, code, message, ...(details === undefined ? {} : { details }) });
const success = value => ({ ok: true, value });
const address = value => {
  if (!text(value)) return false;
  try {
    const bytes = base58Decode(value);
    return bytes.length === 32 && bytes.some(byte => byte !== 0) && base58Encode(bytes) === value;
  } catch { return false; }
};
const signature = value => {
  if (!text(value) || value.length > 128) return false;
  try { const bytes = base58Decode(value); return bytes.length === 64 && base58Encode(bytes) === value; } catch { return false; }
};
const hash32 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);

function admittedMint(intent, allowedMints) {
  const values = Array.isArray(allowedMints)
    ? allowedMints
    : allowedMints && Array.isArray(allowedMints[intent.chain.network])
      ? allowedMints[intent.chain.network]
      : null;
  if (!values || values.length === 0 || !values.every(address)) return 'valid mint admission configuration is required before reconciliation';
  if (!values.includes(intent.asset.mint)) return 'the intent mint is not admitted for this network';
  return null;
}

function validIntent(intent, options = {}) {
  if (!plain(intent) || !text(intent.intentHash) || intent.status !== 'unsigned' || intent.broadcastable !== false || intent.kind !== 'fund') return 'intent must be a verified unsigned funding intent';
  if (!plain(intent.chain) || !SUPPORTED_NETWORKS.has(intent.chain.network) || !address(intent.chain.programId) || !address(intent.chain.genesisHash)) return 'intent.chain is incomplete or has an invalid deployment identity';
  if (!hash32(intent.agreementIdHash) || !hash32(intent.termsHash) || !plain(intent.parties) || ![intent.parties.buyer, intent.parties.seller, intent.parties.arbiter, intent.parties.fee].every(address)) return 'intent agreement or terms commitment or party binding is incomplete';
  if (!plain(intent.asset) || intent.asset.tokenProgramId !== LEGACY_SPL_TOKEN_PROGRAM_ID || !address(intent.asset.mint)) return 'intent must use the legacy SPL Token program and a valid mint';
  const mintError = admittedMint(intent, options.allowedMints);
  if (mintError) return mintError;
  if (!Array.isArray(intent.milestones) || intent.milestones.length !== 1 || !decimal(intent.total) || BigInt(intent.total) <= 0n) return 'intent must contain exactly one positive funding total';
  const milestone = intent.milestones[0];
  if (!plain(milestone) || !decimal(milestone.principal) || !decimal(milestone.reserve) || BigInt(milestone.principal) <= 0n || BigInt(milestone.principal) + BigInt(milestone.reserve) !== BigInt(intent.total) || milestone.reserve !== deriveMilestoneReserve(milestone.principal)) return 'intent funding economics do not match the current single-milestone reserve policy';
  if (intent.authorization?.signer !== intent.parties.buyer || intent.authorization?.destinationPolicy !== 'fixed-original-parties-only') return 'intent authorization policy is not restricted to the original buyer and parties';
  return null;
}

function validV2Intent(intent, options = {}) {
  if (!plain(intent) || !text(intent.intentHash) || intent.status !== 'unsigned' || intent.broadcastable !== false || intent.kind !== 'fund_milestone_v2' || intent.programInstruction !== 'fund_milestone_v2') return 'intent must be a verified unsigned V2 milestone funding intent';
  if (!plain(intent.chain) || !SUPPORTED_NETWORKS.has(intent.chain.network) || !address(intent.chain.programId) || !address(intent.chain.genesisHash)) return 'intent.chain is incomplete or has an invalid deployment identity';
  if (!hash32(intent.agreementIdHash) || !hash32(intent.termsHash) || !plain(intent.parties) || ![intent.parties.buyer, intent.parties.seller, intent.parties.arbiter, intent.parties.fee].every(address)) return 'intent agreement or terms commitment or party binding is incomplete';
  if (!plain(intent.asset) || intent.asset.tokenProgramId !== LEGACY_SPL_TOKEN_PROGRAM_ID || !address(intent.asset.mint)) return 'intent must use the legacy SPL Token program and a valid mint';
  const mintError = admittedMint(intent, options.allowedMints);
  if (mintError) return mintError;
  const milestone = intent.milestone;
  if (!plain(milestone) || !decimal(milestone.principal) || !decimal(milestone.feeReserve) || !decimal(milestone.expectedTotal) || BigInt(milestone.principal) <= 0n || milestone.feeReserve !== deriveMilestoneReserve(milestone.principal) || BigInt(milestone.principal) + BigInt(milestone.feeReserve) !== BigInt(milestone.expectedTotal) || intent.total !== milestone.expectedTotal) return 'intent V2 milestone economics do not match the reserve policy';
  if (intent.authorization?.signer !== intent.parties.buyer || intent.authorization?.destinationPolicy !== 'fixed-original-parties-only') return 'intent authorization policy is not restricted to the original buyer and parties';
  return null;
}

function validObserved(observed) {
  if (!plain(observed) || !signature(observed.signature) || observed.status === undefined || !SUPPORTED_NETWORKS.has(observed.network) || !address(observed.programId) || !hash32(observed.agreementIdHash) || !address(observed.mint) || !address(observed.tokenProgramId) || !address(observed.vault) || !address(observed.genesisHash) || !Array.isArray(observed.signers) || !Array.isArray(observed.transfers) || !plain(observed.vaultDelta)) return 'observed transaction shape is incomplete';
  if (observed.slot !== undefined && (!Number.isSafeInteger(observed.slot) || observed.slot < 0)) return 'observed.slot must be a non-negative safe integer';
  if (!observed.signers.every(address)) return 'observed.signers must contain valid Solana addresses';
  if (![observed.programId, observed.buyer, observed.mint, observed.tokenProgramId, observed.vault].every(address)) return 'observed account fields must be valid Solana addresses';
  if (!decimal(observed.vaultDelta.delta)) return 'observed.vaultDelta.delta must be a decimal string';
  if (observed.transfers.some(t => !plain(t) || !address(t.source) || !address(t.destination) || !address(t.mint) || !address(t.tokenProgramId) || !decimal(t.amount) || (t.sourceOwner !== undefined && !address(t.sourceOwner)))) return 'observed transfers are malformed';
  return null;
}

const equal = (a, b, code, label) => a === b ? null : fail(code, `${label} does not match the funding intent.`, { expected: a, observed: b });

/**
 * Verify a normalized finalized funding transaction.
 * `operationId`, `vault` and the network-qualified `allowedMints` admission
 * policy are supplied by the future transaction worker and are intentionally
 * not invented from an untrusted browser callback. Reconciliation refuses to
 * run without the mint policy even if the unsigned intent hashes correctly.
 */
export function reconcileFundingIntent(intent, observed, { operationId, vault, seenOperationIds = [], allowedMints } = {}) {
  const intentError = intent?.kind === 'fund_milestone_v2' ? validV2Intent(intent, { allowedMints }) : validIntent(intent, { allowedMints });
  if (intentError || !verifyIntent(intent)) return fail(RECONCILIATION_ERRORS.INVALID_INTENT, intentError || 'intentHash is not internally verifiable');
  const observedError = validObserved(observed);
  if (observedError) return fail(RECONCILIATION_ERRORS.INVALID_OBSERVED, observedError);
  if (!text(operationId) || !address(vault)) return fail(RECONCILIATION_ERRORS.INVALID_OBSERVED, 'operationId and a valid vault are required worker bindings');
  if ([...seenOperationIds].includes(operationId)) return fail(RECONCILIATION_ERRORS.DUPLICATE_OPERATION, 'operationId has already been reconciled.', { operationId });
  if (observed.status !== FINALIZED_STATUS) return fail(RECONCILIATION_ERRORS.NOT_FINALIZED, 'A funding transaction is not creditable until finalized.', { status: observed.status });
  for (const mismatch of [
    equal(intent.chain.network, observed.network, RECONCILIATION_ERRORS.MISMATCH, 'network'),
    equal(intent.chain.programId, observed.programId, RECONCILIATION_ERRORS.MISMATCH, 'program'),
    equal(intent.agreementIdHash, observed.agreementIdHash, RECONCILIATION_ERRORS.MISMATCH, 'agreement'),
    equal(intent.parties.buyer, observed.buyer, RECONCILIATION_ERRORS.MISMATCH, 'buyer'),
    equal(intent.asset.mint, observed.mint, RECONCILIATION_ERRORS.MISMATCH, 'mint'),
    equal(LEGACY_SPL_TOKEN_PROGRAM_ID, observed.tokenProgramId, RECONCILIATION_ERRORS.MISMATCH, 'token program'),
    equal(vault, observed.vault, RECONCILIATION_ERRORS.MISMATCH, 'vault'),
  ]) if (mismatch) return mismatch;
  const expectedGenesis = intent.chain.genesisHash;
  if (observed.genesisHash !== expectedGenesis) return fail(RECONCILIATION_ERRORS.MISMATCH, 'genesis hash does not match the funding intent.', { expected: expectedGenesis, observed: observed.genesisHash });
  if (!observed.signers.includes(intent.parties.buyer)) return fail(RECONCILIATION_ERRORS.MISMATCH, 'The original buyer did not sign the observed transaction.');
  if (observed.transfers.length === 0) return fail(RECONCILIATION_ERRORS.MISSING_TRANSFER, 'No token transfer was observed.');
  if (observed.transfers.length > 1) return fail(RECONCILIATION_ERRORS.MULTIPLE_TRANSFERS, 'More than one token transfer was observed; refuse to infer funding.');
  const transfer = observed.transfers[0];
  for (const mismatch of [
    equal(intent.parties.buyer, transfer.sourceOwner || transfer.source, RECONCILIATION_ERRORS.MISMATCH, 'transfer source owner'),
    equal(vault, transfer.destination, RECONCILIATION_ERRORS.MISMATCH, 'transfer destination'),
    equal(intent.asset.mint, transfer.mint, RECONCILIATION_ERRORS.MISMATCH, 'transfer mint'),
    equal(LEGACY_SPL_TOKEN_PROGRAM_ID, transfer.tokenProgramId, RECONCILIATION_ERRORS.MISMATCH, 'transfer token program'),
    equal(intent.total, transfer.amount, RECONCILIATION_ERRORS.MISMATCH, 'transfer amount'),
    equal(intent.total, observed.vaultDelta.delta, RECONCILIATION_ERRORS.MISMATCH, 'vault delta'),
  ]) if (mismatch) return mismatch;
  if (observed.vaultDelta.vault !== vault || observed.vaultDelta.mint !== intent.asset.mint) return fail(RECONCILIATION_ERRORS.MISMATCH, 'Vault delta account or mint does not match the intent.');
  if (Array.isArray(observed.extraTransfers) && observed.extraTransfers.length) return fail(RECONCILIATION_ERRORS.EXTRA_TRANSFERS, 'Extra token transfers were observed; refuse to credit.');
  const evidence = { signature: observed.signature, operationId, intentHash: intent.intentHash, vault, amount: intent.total, status: FINALIZED_STATUS, genesisHash: observed.genesisHash };
  if (observed.pdaBindingsVerified === true) evidence.pdaBindingsVerified = true;
  if (observed.slot !== undefined) evidence.slot = observed.slot;
  return success(Object.freeze(evidence));
}

export function reconcileFundingBatch(items, options = {}) {
  const seen = new Set(options.seenOperationIds || []), results = [];
  for (const item of items || []) {
    const result = reconcileFundingIntent(item.intent, item.observed, { ...item.bindings, allowedMints: options.allowedMints, seenOperationIds: seen });
    results.push(result);
    if (result.ok) seen.add(result.value.operationId);
  }
  return { results, seenOperationIds: [...seen] };
}
