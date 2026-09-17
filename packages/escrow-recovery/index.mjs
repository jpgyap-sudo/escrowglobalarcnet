/**
 * Login-independent Escrow Passport verifier.
 *
 * This package is intentionally read-only. It validates a passport assembled
 * from finalized RPC/account evidence and returns a canonical claim view; it
 * does not contact RPC, sign, submit, or infer that an unverified browser
 * snapshot is chain truth.
 */
import { agreementHash } from '../../src/agreement.mjs';
import { base58Decode } from '../../src/payments.mjs';
import { findProgramAddress, u16le, utf8 } from '../../src/custody/solana-pda.mjs';
import { deriveMilestoneReserve } from '../custody-contracts/reference-quote.mjs';

export const RECOVERY_NETWORKS = Object.freeze(['localnet', 'devnet', 'testnet', 'mainnet-beta']);
export const RECOVERY_MAX_MILESTONES = 16;
export const RECOVERY_STATES = Object.freeze(['unfunded', 'funded', 'submitted', 'disputed', 'approved', 'seller_paid', 'refunded', 'closed', 'cancelled']);
export const LEGACY_SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export class EscrowRecoveryError extends Error {
  constructor(code, message) { super(message); this.name = 'EscrowRecoveryError'; this.code = code; }
}

const fail = (code, message) => { throw new EscrowRecoveryError(code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const address = (value, label) => {
  if (typeof value !== 'string') fail('INVALID_ADDRESS', `${label} must be a Solana address.`);
  try {
    const bytes = base58Decode(value);
    if (bytes.length !== 32 || bytes.every(byte => byte === 0)) throw new Error();
  } catch { fail('INVALID_ADDRESS', `${label} must be a non-zero Solana address.`); }
  return value;
};
const hash = (value, label) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) fail('INVALID_HASH', `${label} must be a non-zero lowercase SHA-256 hash.`);
  return value;
};
const amount = (value, label) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail('INVALID_AMOUNT', `${label} must be a canonical token-unit string.`);
  const parsed = BigInt(value);
  if (parsed > (1n << 64n) - 1n) fail('INVALID_AMOUNT', `${label} exceeds u64.`);
  return parsed;
};
const nonNegative = (value, label) => amount(value, label);
const bool = (value, label) => { if (typeof value !== 'boolean') fail('INVALID_FIELD', `${label} must be boolean.`); return value; };

function hashBytes(value, label) {
  hash(value, label);
  return Uint8Array.from(value.match(/[a-f0-9]{2}/g), pair => Number.parseInt(pair, 16));
}

function addressBytes(value, label) {
  address(value, label);
  return base58Decode(value);
}

function assertPda(actual, expected, label) {
  if (actual !== expected.address) fail('PDA_MISMATCH', `${label} is not the canonical PDA for this passport.`);
}

function verifyEvidence(evidence) {
  if (!plain(evidence) || evidence.finality !== 'finalized' || evidence.accountOwnerVerified !== true || evidence.stateContextVerified !== true || evidence.pdaBindingsVerified !== true || evidence.transferEvidenceVerified !== true) {
    fail('UNVERIFIED_EVIDENCE', 'A recovery passport must carry finalized, owner-, PDA-, transfer- and state-verified RPC evidence.');
  }
  if (!Number.isSafeInteger(evidence.slot) || evidence.slot < 0) fail('INVALID_EVIDENCE', 'Finalized evidence must include a non-negative slot.');
  if (evidence.rpcGenesisHash !== undefined) address(evidence.rpcGenesisHash, 'RPC genesis hash');
}

/** Validate and return an immutable, normalized claim-oriented passport. */
export function verifyEscrowPassport(passport, { expectedProgramId, expectedGenesisHash, expectedFeeRecipient, allowedMints } = {}) {
  if (!plain(passport) || passport.type !== 'escrow-global-passport' || passport.version !== 1) fail('INVALID_PASSPORT', 'Unsupported Escrow Passport envelope.');
  if (!RECOVERY_NETWORKS.includes(passport.network)) fail('INVALID_NETWORK', 'Passport network is not supported.');
  const programId = address(passport.programId, 'Program ID');
  const genesisHash = address(passport.genesisHash, 'Cluster genesis hash');
  if (expectedProgramId !== undefined && programId !== address(expectedProgramId, 'Expected program ID')) fail('PROGRAM_MISMATCH', 'Passport program ID does not match the configured deployment.');
  if (expectedGenesisHash !== undefined && genesisHash !== address(expectedGenesisHash, 'Expected genesis hash')) fail('GENESIS_MISMATCH', 'Passport genesis hash does not match the configured cluster.');
  verifyEvidence(passport.evidence);
  if (passport.evidence.rpcGenesisHash !== undefined && passport.evidence.rpcGenesisHash !== genesisHash) fail('GENESIS_MISMATCH', 'RPC evidence and passport genesis hashes differ.');

  const agreement = passport.agreement;
  if (!plain(agreement)) fail('INVALID_PASSPORT', 'Passport agreement binding is missing.');
  for (const [field, label] of [['address', 'Agreement address'], ['programId', 'Agreement program ID'], ['buyer', 'Buyer'], ['seller', 'Seller'], ['arbiter', 'Arbiter'], ['feeRecipient', 'Fee recipient'], ['mint', 'Settlement mint']]) address(agreement[field], label);
  if (new Set([agreement.buyer, agreement.seller, agreement.arbiter, agreement.feeRecipient]).size !== 4) fail('INVALID_ROLES', 'Agreement parties and fee recipient must be distinct.');
  if (expectedFeeRecipient !== undefined && agreement.feeRecipient !== address(expectedFeeRecipient, 'Expected fee recipient')) fail('FEE_RECIPIENT_MISMATCH', 'Passport fee recipient does not match the configured deployment.');
  if (agreement.programId !== programId) fail('PROGRAM_MISMATCH', 'Agreement program ID differs from the passport deployment.');
  if (agreement.tokenProgramId !== LEGACY_SPL_TOKEN_PROGRAM_ID) fail('TOKEN_PROGRAM_UNSUPPORTED', 'The passport must use the legacy SPL Token Program.');
  hash(agreement.agreementIdHash, 'Agreement commitment');
  hash(agreement.termsHash, 'Terms commitment');
  if (passport.pdaScheme !== undefined && passport.pdaScheme !== 'v2') fail('UNSUPPORTED_PDA_SCHEME', 'This passport verifier supports only the V2 milestone PDA scheme.');
  const agreementPda = findProgramAddress([
    utf8('escrow-v2'),
    addressBytes(agreement.buyer, 'Buyer'),
    hashBytes(agreement.agreementIdHash, 'Agreement commitment')
  ], programId);
  assertPda(agreement.address, agreementPda, 'Agreement address');
  if (typeof agreement.state !== 'string' || !['created', 'accepted', 'funded', 'submitted', 'disputed', 'approved', 'common_ground', 'seller_paid', 'refunded', 'closed'].includes(agreement.state)) fail('INVALID_STATE', 'Agreement state is not recognized.');
  if (expectedProgramId === undefined && passport.programId !== agreement.programId && agreement.programId !== undefined) fail('PROGRAM_MISMATCH', 'Agreement program binding differs from the passport.');
  const allowed = Array.isArray(allowedMints) ? allowedMints : allowedMints?.[passport.network];
  if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.includes(agreement.mint)) fail('MINT_NOT_ALLOWED', 'The passport mint is not admitted for this network.');

  if (!Array.isArray(passport.milestones) || passport.milestones.length < 1 || passport.milestones.length > RECOVERY_MAX_MILESTONES) fail('INVALID_MILESTONES', 'Passport must contain 1–16 milestones.');
  let previousIndex = -1;
  const milestones = passport.milestones.map((milestone, position) => {
    if (!plain(milestone) || milestone.index !== position || milestone.index !== previousIndex + 1) fail('INVALID_MILESTONES', 'Milestones must be contiguous and position-bound.');
    previousIndex = milestone.index;
    address(milestone.address, `Milestone ${position + 1} address`);
    if (milestone.escrow !== agreement.address) fail('PARENT_MISMATCH', `Milestone ${position + 1} is not linked to the passport agreement.`);
    address(milestone.vault, `Milestone ${position + 1} vault`);
    assertPda(milestone.address, findProgramAddress([
      utf8('milestone-v2'),
      addressBytes(agreement.address, 'Agreement address'),
      u16le(milestone.index)
    ], programId), `Milestone ${position + 1} address`);
    assertPda(milestone.vault, findProgramAddress([
      utf8('vault-v2'),
      addressBytes(milestone.address, `Milestone ${position + 1} address`)
    ], programId), `Milestone ${position + 1} vault`);
    if (milestone.vaultAuthority !== milestone.address) fail('VAULT_AUTHORITY_MISMATCH', `Milestone ${position + 1} vault authority must be its milestone PDA.`);
    if (!RECOVERY_STATES.includes(milestone.state)) fail('INVALID_STATE', `Milestone ${position + 1} state is not recognized.`);
    const principal = amount(milestone.principal, `Milestone ${position + 1} principal`);
    if (principal === 0n) fail('INVALID_AMOUNT', `Milestone ${position + 1} principal must be positive.`);
    const reserve = amount(milestone.reserve, `Milestone ${position + 1} reserve`);
    const expectedTotal = amount(milestone.expectedTotal, `Milestone ${position + 1} expected total`);
    if (reserve !== BigInt(deriveMilestoneReserve(principal.toString())) || principal + reserve !== expectedTotal) fail('ECONOMICS_MISMATCH', `Milestone ${position + 1} reserve or total is inconsistent.`);
    const vaultAmount = nonNegative(milestone.vaultAmount, `Milestone ${position + 1} vault amount`);
    const sellerPaid = nonNegative(milestone.sellerPaid, `Milestone ${position + 1} seller paid amount`);
    const feePaid = nonNegative(milestone.feePaid, `Milestone ${position + 1} fee paid amount`);
    const buyerRefunded = nonNegative(milestone.buyerRefunded, `Milestone ${position + 1} buyer refunded amount`);
    const sellerEntitlement = nonNegative(milestone.sellerEntitlement, `Milestone ${position + 1} seller entitlement`);
    const feeEntitlement = nonNegative(milestone.feeEntitlement, `Milestone ${position + 1} fee entitlement`);
    const buyerEntitlement = nonNegative(milestone.buyerEntitlement, `Milestone ${position + 1} buyer entitlement`);
    const noFunding = milestone.state === 'unfunded' || milestone.state === 'cancelled';
    if (noFunding) {
      if (sellerPaid !== 0n || feePaid !== 0n || buyerRefunded !== 0n || vaultAmount !== 0n) fail('CANCELLED_WITH_FUNDS', `Milestone ${position + 1} has funding evidence despite being ${milestone.state}.`);
    } else if (sellerPaid + feePaid + buyerRefunded + vaultAmount !== expectedTotal) {
      fail('CONSERVATION_MISMATCH', `Milestone ${position + 1} does not conserve its funded amount.`);
    }
    // Entitlements are claims against the vault, not additional deposits. A
    // refund transition therefore records both a full buyer entitlement and
    // the still-full vault balance until the separate claim executes.
    if (sellerEntitlement + feeEntitlement + buyerEntitlement > vaultAmount) fail('ENTITLEMENT_MISMATCH', `Milestone ${position + 1} claims exceed its vault obligation.`);
    const only = (allowed, label) => {
      if (allowed) return;
      fail('ENTITLEMENT_STATE_MISMATCH', `Milestone ${position + 1} has a ${label} entitlement in state ${milestone.state}.`);
    };
    only(!['unfunded', 'funded', 'submitted', 'disputed', 'cancelled'].includes(milestone.state) || (sellerEntitlement === 0n && feeEntitlement === 0n && buyerEntitlement === 0n), 'unsettled');
    only(!['approved', 'seller_paid', 'closed', 'cancelled'].includes(milestone.state) || buyerEntitlement === 0n, 'buyer-refund');
    only(!['refunded', 'closed', 'cancelled'].includes(milestone.state) || (sellerEntitlement === 0n && feeEntitlement === 0n), 'seller/fee');
    if (milestone.state === 'closed' && (sellerEntitlement !== 0n || feeEntitlement !== 0n || buyerEntitlement !== 0n || vaultAmount !== 0n)) fail('CLOSED_WITH_OBLIGATION', `Milestone ${position + 1} is closed with an unpaid obligation.`);
    if (milestone.state === 'cancelled' && (sellerPaid !== 0n || feePaid !== 0n || buyerRefunded !== 0n || vaultAmount !== 0n)) fail('CANCELLED_WITH_FUNDS', `Milestone ${position + 1} is cancelled with funds.`);
    return Object.freeze({ ...milestone, principal: principal.toString(), reserve: reserve.toString(), expectedTotal: expectedTotal.toString(), vaultAmount: vaultAmount.toString(), sellerPaid: sellerPaid.toString(), feePaid: feePaid.toString(), buyerRefunded: buyerRefunded.toString(), sellerEntitlement: sellerEntitlement.toString(), feeEntitlement: feeEntitlement.toString(), buyerEntitlement: buyerEntitlement.toString() });
  });
  const normalized = { type: 'escrow-global-passport', version: 1, pdaScheme: 'v2', network: passport.network, programId, genesisHash, evidence: { ...passport.evidence }, agreement: { ...agreement }, milestones };
  const passportHash = agreementHash(normalized);
  if (passport.passportHash !== undefined && passport.passportHash !== passportHash) fail('PASSPORT_HASH_MISMATCH', 'Passport hash does not match its immutable content.');
  return Object.freeze({ ...normalized, passportHash, claimable: Object.freeze(milestones.map(milestone => Object.freeze({ index: milestone.index, seller: milestone.sellerEntitlement, fee: milestone.feeEntitlement, buyerRefund: milestone.buyerEntitlement }))) });
}

/** Create a canonical passport after a separate RPC worker has verified it. */
export function createEscrowPassport(input, options = {}) {
  const candidate = { ...input };
  delete candidate.passportHash;
  const verified = verifyEscrowPassport(candidate, options);
  return verified;
}
