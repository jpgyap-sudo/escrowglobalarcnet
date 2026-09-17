/**
 * Thin, dependency-injected Solana reconciliation worker.
 *
 * This module deliberately does not import a wallet, create a transaction, or
 * decide that a browser callback is finality. A caller supplies a trusted RPC
 * adapter and an account decoder for the agreement commitment. The worker
 * fetches finalized chain evidence, normalizes only parsed SPL transfers, and
 * delegates the economic/security checks to reconciliation.mjs.
 */
import { LEGACY_SPL_TOKEN_PROGRAM_ID, FINALIZED_STATUS, RECONCILIATION_ERRORS, reconcileFundingIntent } from './reconciliation.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';
import { sha256Text } from '../agreement.mjs';
import { findProgramAddress, u16le, utf8 } from './solana-pda.mjs';

export const SOLANA_COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

export const SOLANA_RECONCILIATION_ERRORS = Object.freeze({
  INVALID_RPC: 'INVALID_RPC',
  GENESIS_HASH_MISMATCH: 'GENESIS_HASH_MISMATCH',
  SIGNATURE_FAILED: 'SIGNATURE_FAILED',
  MISSING_TRANSACTION: 'MISSING_TRANSACTION',
  MISSING_ACCOUNT: 'MISSING_ACCOUNT',
  MALFORMED_ACCOUNT: 'MALFORMED_ACCOUNT',
  MALFORMED_TRANSACTION: 'MALFORMED_TRANSACTION',
  UNEXPECTED_PROGRAM: 'UNEXPECTED_PROGRAM',
  UNEXPECTED_TOKEN_INSTRUCTION: 'UNEXPECTED_TOKEN_INSTRUCTION',
  TOKEN_TRANSFER_COUNT: 'TOKEN_TRANSFER_COUNT',
  VAULT_NOT_EMPTY: 'VAULT_NOT_EMPTY',
  CUSTODY_INSTRUCTION_COUNT: 'CUSTODY_INSTRUCTION_COUNT'
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const decimal = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const fail = (code, message, details = undefined) => ({ ok: false, code, message, ...(details === undefined ? {} : { details }) });

const ACCOUNT_DISCRIMINATOR_LENGTH = 8;
const V1_ESCROW_ACCOUNT_PREFIX_LENGTH = 264;
const V2_MULTI_ESCROW_ACCOUNT_PREFIX_LENGTH = 240;
const V2_MILESTONE_ACCOUNT_PREFIX_LENGTH = 42;
// Anchor InitSpace sizes for the pinned escrow-global program, including the
// eight-byte account discriminator. Prefix decoding remains available for
// diagnostics; production projection uses the exact layouts.
const V1_ESCROW_ACCOUNT_LENGTH = 464;
const V2_MULTI_ESCROW_ACCOUNT_LENGTH = 242;
const V2_MILESTONE_ACCOUNT_LENGTH = 161;
// Legacy SPL Token Account layout from the pinned token interface: mint at
// byte 0, token-account owner/authority at byte 32, amount at byte 64, and
// initialized/frozen state at byte 108. Token-2022 is intentionally not
// admitted by the custody program or this decoder.
const LEGACY_TOKEN_ACCOUNT_LENGTH = 165;
const LEGACY_TOKEN_ACCOUNT_MINT_OFFSET = 0;
const LEGACY_TOKEN_ACCOUNT_AUTHORITY_OFFSET = 32;
const LEGACY_TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const LEGACY_TOKEN_ACCOUNT_STATE_OFFSET = 108;

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase64AccountData(data) {
  const encoded = Array.isArray(data) ? data[0] : data;
  const encoding = Array.isArray(data) ? data[1] : 'base64';
  if (typeof encoded !== 'string' || encoding !== 'base64' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Escrow account data must be base64 encoded.');
  }
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== encoded) throw new Error('Escrow account data is not canonical base64.');
  return bytes;
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readU16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('Account data is truncated.');
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) throw new Error('Account data is truncated.');
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  return value.toString();
}

function readI64(bytes, offset) {
  const unsigned = BigInt(readU64(bytes, offset));
  return (unsigned >= 0x8000000000000000n ? unsigned - 0x10000000000000000n : unsigned).toString();
}

function readBool(bytes, offset) {
  if (offset < 0 || offset >= bytes.length || ![0, 1].includes(bytes[offset])) throw new Error('Account boolean is not canonical.');
  return bytes[offset] === 1;
}

function readEnum(bytes, offset, values, label) {
  if (offset < 0 || offset >= bytes.length || bytes[offset] >= values.length) throw new Error(`${label} enum discriminant is invalid.`);
  return values[bytes[offset]];
}

function assertExactLayout(bytes, expectedLength, label, requireExactLayout) {
  if (requireExactLayout && bytes.length !== expectedLength) throw new Error(`${label} account data has an unexpected length.`);
}

function assertFundingState(state, allowed, label) {
  if (!allowed.includes(state)) throw new Error(`${label} is not in a creditable post-funding state.`);
}

function assertEconomics(principal, feeReserve, expectedTotal, label) {
  const p = BigInt(principal);
  const fee = BigInt(feeReserve);
  const total = BigInt(expectedTotal);
  if (p <= 0n || fee !== (p * 300n) / 10000n || total !== p + fee) throw new Error(`${label} economic fields are inconsistent with the pinned fee policy.`);
}

function assertDeadlines(fundingDeadline, deliveryDeadline, reviewDeadline, label) {
  const funding = BigInt(fundingDeadline);
  const delivery = BigInt(deliveryDeadline);
  const review = BigInt(reviewDeadline);
  const reviewWindow = review - delivery;
  if (delivery <= funding || review <= delivery || reviewWindow < 60n || reviewWindow > 2592000n) throw new Error(`${label} deadlines are inconsistent with the custody timing policy.`);
}

function assertLedger({ principal, expectedTotal, sellerEntitlement, feeEntitlement, buyerEntitlement, unresolvedPrincipal = '0', disputeFeePaid = '0' }, label) {
  const principalValue = BigInt(principal);
  const total = BigInt(expectedTotal);
  if (BigInt(sellerEntitlement) + BigInt(feeEntitlement) + BigInt(buyerEntitlement) > total) throw new Error(`${label} entitlements exceed expected total.`);
  if (BigInt(unresolvedPrincipal) > principalValue) throw new Error(`${label} unresolved principal exceeds principal.`);
  if (BigInt(disputeFeePaid) > (principalValue * 500n) / 10000n) throw new Error(`${label} dispute fee exceeds the pinned dispute-fee policy.`);
}

function assertV2Counters(milestoneCount, createdMilestones, fundedMilestones, closedMilestones, state, requireFundingState) {
  if (milestoneCount < 1 || milestoneCount > 16 || createdMilestones > milestoneCount || fundedMilestones > createdMilestones || closedMilestones > createdMilestones) throw new Error('V2 milestone counters are inconsistent.');
  if (requireFundingState && (state === 'Accepted' || state === 'Closed') && createdMilestones !== milestoneCount) throw new Error('V2 accepted escrow has incomplete milestone creation.');
  if (state === 'Closed' && closedMilestones !== milestoneCount) throw new Error('V2 closed escrow has incomplete milestone closure.');
}

function assertRoles({ buyer, seller, arbiter, feeRecipient }, label) {
  const roles = { buyer, seller, arbiter, feeRecipient };
  if (Object.entries(roles).some(([name, value]) => !validPubkey(value))) throw new Error(`${label} contains an invalid role public key.`);
  const values = Object.values(roles);
  if (new Set(values).size !== values.length) throw new Error(`${label} role public keys must be distinct.`);
}

function anchorDiscriminator(action) {
  return Uint8Array.from(Buffer.from(sha256Text(`global:${action}`).slice(0, 16), 'hex'));
}

function decodeInstructionDiscriminator(data) {
  if (!text(data)) return null;
  try {
    const decoded = base58Decode(data);
    return decoded.length === ACCOUNT_DISCRIMINATOR_LENGTH ? decoded : null;
  } catch {
    return null;
  }
}

function validGenesisHash(value) {
  return validPubkey(value);
}

function validPubkey(value) {
  if (!text(value)) return false;
  try {
    const bytes = base58Decode(value);
    return bytes.length === 32 && bytes.some(byte => byte !== 0) && base58Encode(bytes) === value;
  } catch {
    return false;
  }
}

function validTransactionSignature(value) {
  if (!text(value) || value.length > 128) return false;
  try {
    const bytes = base58Decode(value);
    return bytes.length === 64 && base58Encode(bytes) === value;
  } catch {
    return false;
  }
}

function hashBytes(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte lowercase hexadecimal hash.`);
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function pubkeyBytes(value, label) {
  if (!validPubkey(value)) throw new Error(`${label} must be a valid public key.`);
  return base58Decode(value);
}

function assertPda(actual, seeds, programId, label) {
  if (!text(actual)) throw new Error(`${label} address is required for PDA verification.`);
  const derived = findProgramAddress(seeds, programId).address;
  if (derived !== actual) throw new Error(`${label} does not match its canonical PDA.`);
}

/**
 * Verify the RPC endpoint's cluster identity against a deployment manifest.
 * A browser-selected network label is not sufficient: a configured endpoint
 * can be misrouted, proxied, or accidentally pointed at another cluster.
 */
export async function verifyRpcGenesisHash({ rpc, expectedGenesisHash }) {
  if (!rpc || typeof rpc.getGenesisHash !== 'function' || !validGenesisHash(expectedGenesisHash)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'RPC cluster verification requires getGenesisHash and a valid manifest genesis hash.');
  let actualGenesisHash;
  try { actualGenesisHash = await rpc.getGenesisHash(); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'RPC genesis-hash request failed.'); }
  if (!validGenesisHash(actualGenesisHash)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'RPC returned an invalid genesis hash.');
  if (actualGenesisHash !== expectedGenesisHash) return fail(SOLANA_RECONCILIATION_ERRORS.GENESIS_HASH_MISMATCH, 'RPC endpoint genesis hash does not match the configured deployment manifest.', { expected: expectedGenesisHash, actual: actualGenesisHash });
  return { ok: true, value: Object.freeze({ genesisHash: actualGenesisHash }) };
}

/**
 * Load one finalized account with the only encoding accepted by the strict
 * account decoders below. This keeps account data on the same finality boundary
 * as the funding transaction and prevents a caller from substituting a
 * browser-provided owner or base58 representation.
 */
export async function loadFinalizedAccount({ rpc, address, expectedProgramId, minContextSlot }) {
  if (!rpc || typeof rpc.getAccountInfo !== 'function' || !validPubkey(address) || !validPubkey(expectedProgramId)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'RPC account loading requires getAccountInfo, valid account addresses and the expected program ID.');
  if (minContextSlot !== undefined && (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'The account context slot must be a non-negative safe integer.');
  let response;
  const config = { commitment: FINALIZED_STATUS, encoding: 'base64', ...(minContextSlot === undefined ? {} : { minContextSlot }) };
  try { response = await rpc.getAccountInfo(address, config); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'RPC account request failed.'); }
  const value = response?.value;
  if (value === null || value === undefined) return fail(SOLANA_RECONCILIATION_ERRORS.MISSING_ACCOUNT, 'The finalized account does not exist.');
  if (minContextSlot !== undefined && (!Number.isSafeInteger(response?.context?.slot) || response.context.slot < minContextSlot)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'The finalized account response is older than the funding transaction context.');
  if (!plain(value) || value.executable !== false || value.owner !== expectedProgramId || !Array.isArray(value.data) || value.data.length !== 2 || value.data[1] !== 'base64' || !text(value.data[0])) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'The finalized account must be a non-executable program-owned account with canonical base64 data.');
  return { ok: true, value: Object.freeze({ address, owner: value.owner, data: value.data, ...(response?.context?.slot === undefined ? {} : { contextSlot: response.context.slot }) }) };
}

/**
 * Load and decode a finalized legacy SPL Token account from raw account data.
 * Parsed transaction token balances are useful corroboration, but a durable
 * account projection also needs the vault's actual mint, authority and amount
 * at the same finalized context as the escrow account. The raw layout is
 * decoded only after loadFinalizedAccount proves the account owner is the
 * legacy SPL Token Program.
 */
export async function loadFinalizedTokenAccount({ rpc, address, expectedMint, expectedAuthority, minContextSlot }) {
  if (!validPubkey(expectedMint) || !validPubkey(expectedAuthority)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'Token-account loading requires valid expected mint and authority addresses.');
  const loaded = await loadFinalizedAccount({ rpc, address, expectedProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID, minContextSlot });
  if (!loaded.ok) return loaded;
  try {
    const bytes = decodeBase64AccountData(loaded.value.data);
    if (bytes.length !== LEGACY_TOKEN_ACCOUNT_LENGTH) throw new Error('The legacy SPL Token account must contain exactly 165 bytes.');
    const mint = base58Encode(bytes.slice(LEGACY_TOKEN_ACCOUNT_MINT_OFFSET, LEGACY_TOKEN_ACCOUNT_MINT_OFFSET + 32));
    const authority = base58Encode(bytes.slice(LEGACY_TOKEN_ACCOUNT_AUTHORITY_OFFSET, LEGACY_TOKEN_ACCOUNT_AUTHORITY_OFFSET + 32));
    if (mint !== expectedMint || authority !== expectedAuthority) throw new Error('The finalized token account mint or authority does not match the custody binding.');
    if (![1, 2].includes(bytes[LEGACY_TOKEN_ACCOUNT_STATE_OFFSET])) throw new Error('The finalized token account is not initialized.');
    return { ok: true, value: Object.freeze({
      ...loaded.value,
      mint,
      authority,
      amount: readU64(bytes, LEGACY_TOKEN_ACCOUNT_AMOUNT_OFFSET)
    }) };
  } catch (error) {
    return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, error instanceof Error ? error.message : 'The finalized token account is malformed.');
  }
}

/**
 * Assemble the strict account-projection envelope from finalized RPC reads.
 * Program-owned escrow accounts are read together; the vault is read through
 * the legacy-token owner boundary. Every read is required to be at least as
 * new as transactionSlot, and the returned contextSlot is the common lower
 * bound across those reads rather than a fabricated single-slot claim.
 */
export async function loadFinalizedProjectionInput({ intent, rpc, deployment, agreementAddress, milestoneAddress, vault, transactionSlot }) {
  if (!plain(intent) || !plain(deployment) || !Number.isSafeInteger(transactionSlot) || transactionSlot < 0) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'Projection loading requires an intent, deployment and finalized transaction slot.');
  const kind = intent.kind === 'fund' ? 'v1' : intent.kind === 'fund_milestone_v2' ? 'v2' : null;
  if (!kind || !text(agreementAddress) || !text(vault)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'Projection loading requires a supported funding intent, agreement PDA and vault PDA.');
  if (kind === 'v2' && !text(milestoneAddress)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'V2 projection loading requires a milestone PDA.');

  const programId = deployment.programId;
  const programAccounts = kind === 'v2'
    ? await loadFinalizedAccounts({ rpc, addresses: [agreementAddress, milestoneAddress], expectedProgramId: programId, minContextSlot: transactionSlot })
    : await loadFinalizedAccount({ rpc, address: agreementAddress, expectedProgramId: programId, minContextSlot: transactionSlot });
  if (!programAccounts.ok) return programAccounts;
  const agreement = kind === 'v2' ? programAccounts.value[0] : programAccounts.value;
  const milestone = kind === 'v2' ? programAccounts.value[1] : undefined;
  let decoded;
  try {
    decoded = kind === 'v2'
      ? decodeV2FundingAccounts({ agreementAccount: agreement, milestoneAccount: milestone, expectedProgramId: programId, expectedMilestoneAddress: milestoneAddress, expectedMilestoneIndex: intent.milestoneIndex, expectedVault: vault, verifyPdas: true, requireExactLayout: true, requireFundingState: true })
      : decodeV1EscrowAccount({ owner: agreement.owner, data: agreement.data, expectedProgramId: programId, accountAddress: agreement.address, verifyPdas: true, requireExactLayout: true, requireFundingState: true });
  } catch (error) {
    return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, error instanceof Error ? error.message : 'Finalized escrow account decoding failed.');
  }
  const authority = kind === 'v2' ? decoded.milestone : decoded.escrow;
  const tokenAccount = await loadFinalizedTokenAccount({ rpc, address: vault, expectedMint: decoded.mint, expectedAuthority: authority, minContextSlot: transactionSlot });
  if (!tokenAccount.ok) return tokenAccount;
  const contextSlots = [agreement.contextSlot, tokenAccount.value.contextSlot, ...(milestone ? [milestone.contextSlot] : [])];
  if (contextSlots.some(slot => !Number.isSafeInteger(slot) || slot < transactionSlot)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'Projection account reads do not share a safe finalized context lower bound.');
  const input = {
    kind,
    finalized: true,
    pdaBindingsVerified: decoded.pdaBindingsVerified === true,
    intent,
    deployment,
    vaultAmount: tokenAccount.value.amount,
    accounts: { contextSlot: Math.min(...contextSlots), agreement, vault: tokenAccount.value, ...(milestone ? { milestone } : {}) }
  };
  if (kind === 'v2') input.milestoneIndex = intent.milestoneIndex;
  return { ok: true, value: Object.freeze(input) };
}

/**
 * Load several program accounts from one finalized RPC snapshot. Separate
 * getAccountInfo calls can observe different slots; V2 funding binds the
 * parent and milestone to one context so a worker never mixes account state
 * from unrelated snapshots.
 */
export async function loadFinalizedAccounts({ rpc, addresses, expectedProgramId, minContextSlot }) {
  if (!rpc || typeof rpc.getMultipleAccounts !== 'function' || !Array.isArray(addresses) || addresses.length < 1 || addresses.length > 100 || addresses.some(address => !validPubkey(address)) || !validPubkey(expectedProgramId)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'RPC batch account loading requires getMultipleAccounts, 1–100 valid account addresses and the expected program ID.');
  if (minContextSlot !== undefined && (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)) return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'The account context slot must be a non-negative safe integer.');
  let response;
  const config = { commitment: FINALIZED_STATUS, encoding: 'base64', ...(minContextSlot === undefined ? {} : { minContextSlot }) };
  try { response = await rpc.getMultipleAccounts(addresses, config); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'RPC batch account request failed.'); }
  if (!plain(response) || !Array.isArray(response.value) || response.value.length !== addresses.length || !Number.isSafeInteger(response.context?.slot) || response.context.slot < 0 || (minContextSlot !== undefined && response.context.slot < minContextSlot)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'The finalized batch account response has an invalid context or account count.');
  try {
    const values = response.value.map((value, index) => {
      if (value === null || value === undefined) throw new Error(`Finalized account ${index + 1} does not exist.`);
      if (!plain(value) || value.executable !== false || value.owner !== expectedProgramId || !Array.isArray(value.data) || value.data.length !== 2 || value.data[1] !== 'base64' || !text(value.data[0])) throw new Error(`Finalized account ${index + 1} is not a program-owned canonical base64 account.`);
      return Object.freeze({ address: addresses[index], owner: value.owner, data: value.data, contextSlot: response.context.slot });
    });
    return { ok: true, value: Object.freeze(values) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'A finalized batch account is missing or malformed.';
    return fail(message.includes('does not exist') ? SOLANA_RECONCILIATION_ERRORS.MISSING_ACCOUNT : SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, message);
  }
}

/**
 * Decode the commitment-bearing prefix of the deployed V1 Anchor Escrow
 * account. The caller must obtain `owner` and `data` from a trusted finalized
 * RPC response; this helper never treats browser-supplied account fields as
 * authoritative. It intentionally returns only commitment metadata needed by
 * reconciliation rather than pretending to be a complete account decoder.
 */
export function decodeV1EscrowAccount({ owner, data, expectedProgramId, accountAddress, verifyPdas = false, requireExactLayout = false, requireFundingState = false }) {
  if (!validPubkey(owner) || !validPubkey(expectedProgramId) || owner !== expectedProgramId || (accountAddress !== undefined && !validPubkey(accountAddress))) throw new Error('Escrow account owner or address does not match the configured custody program.');
  const bytes = decodeBase64AccountData(data);
  if (bytes.length < V1_ESCROW_ACCOUNT_PREFIX_LENGTH) throw new Error('Escrow account data is shorter than the V1 commitment layout.');
  assertExactLayout(bytes, V1_ESCROW_ACCOUNT_LENGTH, 'V1 Escrow', requireExactLayout);
  const expectedDiscriminator = Uint8Array.from(Buffer.from(sha256Text('account:Escrow').slice(0, 16), 'hex'));
  if (!equalBytes(bytes.slice(0, ACCOUNT_DISCRIMINATOR_LENGTH), expectedDiscriminator)) throw new Error('Escrow account discriminator does not match V1 Escrow.');
  const buyer = base58Encode(bytes.slice(ACCOUNT_DISCRIMINATOR_LENGTH, ACCOUNT_DISCRIMINATOR_LENGTH + 32));
  const sellerOffset = ACCOUNT_DISCRIMINATOR_LENGTH + 32;
  const seller = base58Encode(bytes.slice(sellerOffset, sellerOffset + 32));
  const arbiter = base58Encode(bytes.slice(72, 104));
  const feeRecipient = base58Encode(bytes.slice(104, 136));
  const mintOffset = ACCOUNT_DISCRIMINATOR_LENGTH + (4 * 32);
  const mint = base58Encode(bytes.slice(mintOffset, mintOffset + 32));
  const vaultOffset = mintOffset + 32;
  const vault = base58Encode(bytes.slice(vaultOffset, vaultOffset + 32));
  const agreementOffset = vaultOffset + 32;
  const termsOffset = agreementOffset + 32;
  const agreementIdHash = hex(bytes.slice(agreementOffset, agreementOffset + 32));
  if (verifyPdas) {
    assertPda(accountAddress, [utf8('escrow'), pubkeyBytes(buyer, 'Buyer'), hashBytes(agreementIdHash, 'Agreement ID hash')], expectedProgramId, 'Escrow');
    assertPda(vault, [utf8('vault'), pubkeyBytes(accountAddress, 'Escrow')], expectedProgramId, 'Vault');
  }
  const full = bytes.length >= V1_ESCROW_ACCOUNT_LENGTH;
  const principal = full ? readU64(bytes, 296) : null;
  const feeReserve = full ? readU64(bytes, 304) : null;
  const expectedTotal = full ? readU64(bytes, 312) : null;
  const state = full ? readEnum(bytes, 418, ['Created', 'Accepted', 'Funded', 'Submitted', 'Disputed', 'Approved', 'CommonGround', 'SellerPaid', 'Refunded', 'Closed'], 'V1 Escrow state') : null;
  if (full) {
    assertEconomics(principal, feeReserve, expectedTotal, 'V1 Escrow');
    assertDeadlines(readI64(bytes, 352), readI64(bytes, 360), readI64(bytes, 368), 'V1 Escrow');
    assertLedger({ principal, expectedTotal, sellerEntitlement: readU64(bytes, 320), feeEntitlement: readU64(bytes, 328), buyerEntitlement: readU64(bytes, 336), unresolvedPrincipal: readU64(bytes, 377), disputeFeePaid: readU64(bytes, 344) }, 'V1 Escrow');
  }
  if (full) assertRoles({ buyer, seller, arbiter, feeRecipient }, 'V1 Escrow');
  if (requireFundingState) assertFundingState(state, ['Funded', 'Submitted', 'Disputed', 'Approved', 'CommonGround', 'SellerPaid', 'Refunded', 'Closed'], 'V1 Escrow state');
  return Object.freeze({
    agreementIdHash,
    termsHash: hex(bytes.slice(termsOffset, termsOffset + 32)),
    escrow: accountAddress,
    buyer,
    seller,
    arbiter,
    feeRecipient,
    mint,
    vault,
    ...(full ? {
      principal,
      feeReserve,
      expectedTotal,
      sellerEntitlement: readU64(bytes, 320),
      feeEntitlement: readU64(bytes, 328),
      buyerEntitlement: readU64(bytes, 336),
      disputeFeePaid: readU64(bytes, 344),
      fundingDeadline: readI64(bytes, 352),
      deliveryDeadline: readI64(bytes, 360),
      reviewDeadline: readI64(bytes, 368),
      timedRelease: readBool(bytes, 376),
      unresolvedPrincipal: readU64(bytes, 377),
      commonGroundSellerAmount: readU64(bytes, 385),
      commonGroundRemainder: readU64(bytes, 393),
      commonGroundRemainderFeeReserve: readU64(bytes, 401),
      commonGroundExecuted: readBool(bytes, 409),
      decisionRevision: readU64(bytes, 410),
      state,
      bump: bytes[419],
      vaultBump: bytes[420],
      acceptedAt: readI64(bytes, 421),
      fundedAt: readI64(bytes, 429),
      submittedAt: readI64(bytes, 437),
      approvedAt: readI64(bytes, 445),
      settledAt: readI64(bytes, 453),
      sellerClaimed: readBool(bytes, 461),
      feeClaimed: readBool(bytes, 462),
      buyerClaimed: readBool(bytes, 463)
    } : {}),
    programId: expectedProgramId,
    pdaBindingsVerified: verifyPdas
  });
}

/** Decode the identity prefix of the V2 MultiEscrow account. */
export function decodeV2MultiEscrowAccount({ owner, data, expectedProgramId, accountAddress, verifyPdas = false, requireExactLayout = false, requireFundingState = false }) {
  if (!validPubkey(owner) || !validPubkey(expectedProgramId) || owner !== expectedProgramId || (accountAddress !== undefined && !validPubkey(accountAddress))) throw new Error('MultiEscrow account owner or address does not match the configured custody program.');
  const bytes = decodeBase64AccountData(data);
  if (bytes.length < V2_MULTI_ESCROW_ACCOUNT_PREFIX_LENGTH) throw new Error('MultiEscrow account data is shorter than the V2 identity layout.');
  assertExactLayout(bytes, V2_MULTI_ESCROW_ACCOUNT_LENGTH, 'V2 MultiEscrow', requireExactLayout);
  const expectedDiscriminator = Uint8Array.from(Buffer.from(sha256Text('account:MultiEscrow').slice(0, 16), 'hex'));
  if (!equalBytes(bytes.slice(0, ACCOUNT_DISCRIMINATOR_LENGTH), expectedDiscriminator)) throw new Error('Account discriminator does not match V2 MultiEscrow.');
  const buyer = base58Encode(bytes.slice(8, 40));
  const seller = base58Encode(bytes.slice(40, 72));
  const arbiter = base58Encode(bytes.slice(72, 104));
  const feeRecipient = base58Encode(bytes.slice(104, 136));
  const mint = base58Encode(bytes.slice(136, 168));
  const agreementIdHash = hex(bytes.slice(168, 200));
  if (verifyPdas) assertPda(accountAddress, [utf8('escrow-v2'), pubkeyBytes(buyer, 'Buyer'), hashBytes(agreementIdHash, 'Agreement ID hash')], expectedProgramId, 'V2 escrow');
  const full = bytes.length >= V2_MULTI_ESCROW_ACCOUNT_LENGTH;
  const state = full ? readEnum(bytes, 240, ['Created', 'Accepted', 'Closed'], 'V2 MultiEscrow state') : null;
  if (full) {
    assertRoles({ buyer, seller, arbiter, feeRecipient }, 'V2 MultiEscrow');
    assertV2Counters(readU16(bytes, 232), readU16(bytes, 234), readU16(bytes, 236), readU16(bytes, 238), state, requireFundingState);
  }
  if (requireFundingState) assertFundingState(state, ['Accepted', 'Closed'], 'V2 MultiEscrow state');
  return Object.freeze({
    agreementIdHash,
    termsHash: hex(bytes.slice(200, 232)),
    escrow: accountAddress,
    buyer,
    seller,
    arbiter,
    feeRecipient,
    mint,
    ...(full ? { milestoneCount: readU16(bytes, 232), createdMilestones: readU16(bytes, 234), fundedMilestones: readU16(bytes, 236), closedMilestones: readU16(bytes, 238), state, bump: bytes[241] } : {}),
    programId: expectedProgramId,
    pdaBindingsVerified: verifyPdas
  });
}

/** Decode the parent/index prefix of a V2 milestone account. */
export function decodeV2MilestoneAccount({ owner, data, expectedProgramId, accountAddress, verifyPdas = false, requireExactLayout = false, requireFundingState = false }) {
  if (!validPubkey(owner) || !validPubkey(expectedProgramId) || owner !== expectedProgramId || (accountAddress !== undefined && !validPubkey(accountAddress))) throw new Error('Milestone account owner or address does not match the configured custody program.');
  const bytes = decodeBase64AccountData(data);
  if (bytes.length < V2_MILESTONE_ACCOUNT_PREFIX_LENGTH) throw new Error('Milestone account data is shorter than the V2 identity layout.');
  assertExactLayout(bytes, V2_MILESTONE_ACCOUNT_LENGTH, 'V2 MilestoneV2', requireExactLayout);
  const expectedDiscriminator = Uint8Array.from(Buffer.from(sha256Text('account:MilestoneV2').slice(0, 16), 'hex'));
  if (!equalBytes(bytes.slice(0, ACCOUNT_DISCRIMINATOR_LENGTH), expectedDiscriminator)) throw new Error('Account discriminator does not match V2 MilestoneV2.');
  const escrow = base58Encode(bytes.slice(8, 40));
  const index = bytes[40] | (bytes[41] << 8);
  if (verifyPdas) assertPda(accountAddress, [utf8('milestone-v2'), pubkeyBytes(escrow, 'V2 escrow'), u16le(index)], expectedProgramId, 'V2 milestone');
  const full = bytes.length >= V2_MILESTONE_ACCOUNT_LENGTH;
  const principal = full ? readU64(bytes, 42) : null;
  const feeReserve = full ? readU64(bytes, 50) : null;
  const expectedTotal = full ? readU64(bytes, 58) : null;
  const state = full ? readEnum(bytes, 155, ['Unfunded', 'Funded', 'Submitted', 'Disputed', 'Approved', 'SellerPaid', 'Refunded', 'Closed'], 'V2 Milestone state') : null;
  if (full) {
    assertEconomics(principal, feeReserve, expectedTotal, 'V2 MilestoneV2');
    assertDeadlines(readI64(bytes, 98), readI64(bytes, 106), readI64(bytes, 114), 'V2 MilestoneV2');
    assertLedger({ principal, expectedTotal, sellerEntitlement: readU64(bytes, 123), feeEntitlement: readU64(bytes, 131), buyerEntitlement: readU64(bytes, 139), disputeFeePaid: readU64(bytes, 147) }, 'V2 MilestoneV2');
  }
  if (requireFundingState) assertFundingState(state, ['Funded', 'Submitted', 'Disputed', 'Approved', 'SellerPaid', 'Refunded', 'Closed'], 'V2 Milestone state');
  return Object.freeze({
    escrow,
    index,
    ...(full ? {
      principal,
      feeReserve,
      expectedTotal,
      deliveryHash: hex(bytes.slice(66, 98)),
      fundingDeadline: readI64(bytes, 98),
      deliveryDeadline: readI64(bytes, 106),
      reviewDeadline: readI64(bytes, 114),
      timedRelease: readBool(bytes, 122),
      sellerEntitlement: readU64(bytes, 123),
      feeEntitlement: readU64(bytes, 131),
      buyerEntitlement: readU64(bytes, 139),
      disputeFeePaid: readU64(bytes, 147),
      state,
      bump: bytes[156],
      vaultBump: bytes[157],
      sellerClaimed: readBool(bytes, 158),
      feeClaimed: readBool(bytes, 159),
      buyerClaimed: readBool(bytes, 160)
    } : {}),
    ...(accountAddress === undefined ? {} : { milestone: accountAddress }),
    programId: expectedProgramId,
    pdaBindingsVerified: verifyPdas
  });
}

/**
 * Decode the exact V2 account pair used by fund_milestone_v2. The milestone
 * inherits buyer/mint/agreement identity from its parent; its own account
 * contributes only the parent link and u16 index. Both accounts must therefore
 * be decoded from the same finalized RPC context before a funding observation
 * can be credited.
 */
export function decodeV2FundingAccounts({ agreementAccount, milestoneAccount, expectedProgramId, expectedMilestoneAddress, expectedMilestoneIndex, expectedVault, verifyPdas = false, requireExactLayout = false, requireFundingState = false }) {
  if (!plain(agreementAccount) || !plain(milestoneAccount)) throw new Error('V2 funding requires both finalized parent and milestone accounts.');
  const parent = decodeV2MultiEscrowAccount({
    owner: agreementAccount.owner,
    data: agreementAccount.data,
    expectedProgramId,
    accountAddress: agreementAccount.address,
    verifyPdas,
    requireExactLayout,
    requireFundingState
  });
  const milestone = decodeV2MilestoneAccount({
    owner: milestoneAccount.owner,
    data: milestoneAccount.data,
    expectedProgramId,
    accountAddress: milestoneAccount.address,
    verifyPdas,
    requireExactLayout,
    requireFundingState
  });
  if (text(expectedMilestoneAddress) && milestone.milestone !== expectedMilestoneAddress) throw new Error('Decoded milestone account does not match the requested milestone PDA.');
  if (Number.isSafeInteger(expectedMilestoneIndex) && milestone.index !== expectedMilestoneIndex) throw new Error('Decoded milestone index does not match the funding intent.');
  if (milestone.escrow !== parent.escrow) throw new Error('Decoded milestone is not owned by the decoded V2 escrow.');
  if (!text(expectedVault)) throw new Error('V2 funding requires the expected milestone vault binding.');
  if (verifyPdas) assertPda(expectedVault, [utf8('vault-v2'), pubkeyBytes(milestone.milestone, 'V2 milestone')], expectedProgramId, 'V2 vault');
  return Object.freeze({
    ...parent,
    vault: expectedVault,
    vaultAuthority: milestone.milestone,
    milestone: milestone.milestone,
    milestoneIndex: milestone.index,
    pdaBindingsVerified: Boolean(parent.pdaBindingsVerified && milestone.pdaBindingsVerified && verifyPdas)
  });
}

function accountKey(value) {
  return typeof value === 'string' ? value : value && typeof value.pubkey === 'string' ? value.pubkey : null;
}

function accountKeys(transaction) {
  const message = transaction?.transaction?.message || transaction?.message;
  const values = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  const loaded = transaction?.meta?.loadedAddresses;
  return [
    ...values,
    ...(Array.isArray(loaded?.writable) ? loaded.writable : []),
    ...(Array.isArray(loaded?.readonly) ? loaded.readonly : [])
  ].map(accountKey);
}

function allInstructions(transaction) {
  const message = transaction?.transaction?.message || transaction?.message;
  const outer = Array.isArray(message?.instructions) ? message.instructions : [];
  const inner = Array.isArray(transaction?.meta?.innerInstructions)
    ? transaction.meta.innerInstructions.flatMap(item => Array.isArray(item.instructions) ? item.instructions : [])
    : [];
  return [...outer, ...inner];
}

function tokenBalanceEntries(transaction, keys) {
  const meta = transaction?.meta;
  const pre = Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : [];
  return { pre, post, forAccount: (list, address, mint) => list.find(entry => keys[entry.accountIndex] === address && (!mint || entry.mint === mint)) };
}

function balanceAmount(entry) {
  return entry?.uiTokenAmount?.amount;
}

function parseTransfer(instruction, transaction, keys, expectedMint) {
  if (!plain(instruction) || instruction.programId !== LEGACY_SPL_TOKEN_PROGRAM_ID || !plain(instruction.parsed)) return null;
  // Funding is emitted by the Anchor program with TransferChecked. A plain
  // SPL transfer does not commit the mint in its instruction data, so accepting
  // it would make a parsed RPC response insufficient evidence of the asset.
  if (instruction.parsed.type !== 'transferChecked' || !plain(instruction.parsed.info)) return null;
  const info = instruction.parsed.info;
  const source = info.source;
  const destination = info.destination;
  const mint = info.mint;
  const amount = info.amount || info.tokenAmount?.amount;
  if (!text(source) || !text(destination) || !text(mint) || mint !== expectedMint || !decimal(amount)) return null;
  const balances = tokenBalanceEntries(transaction, keys);
  const sourceBalance = balances.pre.find(entry => keys[entry.accountIndex] === source && entry.mint === mint)
    || balances.post.find(entry => keys[entry.accountIndex] === source && entry.mint === mint);
  if (!text(sourceBalance?.owner)) return null;
  return {
    source,
    sourceOwner: sourceBalance?.owner,
    destination,
    mint,
    tokenProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID,
    amount
  };
}

/**
 * Normalize a parsed, finalized `getTransaction` response. The agreement
 * commitment must come from a trusted on-chain account decoder; it is never
 * copied from an arbitrary browser payload or inferred from the signature.
 */
export function normalizeFinalizedFundingTransaction({ intent, signature, transaction, vault, agreementAccount, milestoneAccount, genesisHash, decodeAgreementIdHash, requireRoleBindings = false }) {
  if (!plain(intent) || !text(signature) || !text(vault) || typeof decodeAgreementIdHash !== 'function') return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Intent, signature, vault and an agreement account decoder are required.');
  const message = transaction?.transaction?.message || transaction?.message;
  const transactionSignatures = transaction?.transaction?.signatures || transaction?.signatures;
  if (!plain(transaction) || !plain(message) || !plain(transaction.meta) || transaction.meta.err !== null || !validTransactionSignature(signature) || !Number.isSafeInteger(transaction.slot) || transaction.slot < 0 || !Array.isArray(transactionSignatures) || !transactionSignatures.includes(signature)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The RPC response is not a successful parsed transaction bound to a canonical signature and slot.');
  // Versioned transactions may place token accounts in meta.loadedAddresses;
  // accountIndex values are resolved against static keys followed by loaded
  // writable and readonly keys, so omitting them would create false negatives
  // or, worse, bind a balance to the wrong address.
  const keys = accountKeys(transaction);
  if (keys.some(key => !text(key))) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Loaded or unresolved account keys cannot be safely normalized.');
  const outerInstructions = Array.isArray(message.instructions) ? message.instructions : [];
  const instructions = allInstructions(transaction);
  const outerCustodyCount = outerInstructions.filter(instruction => instruction?.programId === intent.chain?.programId).length;
  const custodyCount = instructions.filter(instruction => instruction?.programId === intent.chain?.programId).length;
  if (outerCustodyCount !== 1 || custodyCount !== 1) return fail(SOLANA_RECONCILIATION_ERRORS.CUSTODY_INSTRUCTION_COUNT, 'Exactly one outer instruction and no inner instruction may invoke the configured custody program.');
  const custodyInstruction = outerInstructions.find(instruction => instruction?.programId === intent.chain?.programId);
  const expectedAction = intent.kind === 'fund_milestone_v2' ? 'fund_milestone_v2' : 'fund';
  for (const instruction of instructions) {
    if (!text(instruction?.programId)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Every loaded instruction must expose a program ID.');
    if (![intent.chain?.programId, LEGACY_SPL_TOKEN_PROGRAM_ID, SOLANA_COMPUTE_BUDGET_PROGRAM_ID].includes(instruction.programId)) return fail(SOLANA_RECONCILIATION_ERRORS.UNEXPECTED_PROGRAM, 'The funding transaction contains an unallowlisted program instruction.');
    if (instruction.programId === LEGACY_SPL_TOKEN_PROGRAM_ID && (!plain(instruction.parsed) || instruction.parsed.type !== 'transferChecked')) return fail(SOLANA_RECONCILIATION_ERRORS.UNEXPECTED_TOKEN_INSTRUCTION, 'Only a parsed TransferChecked instruction is permitted for funding.');
  }
  const discriminator = decodeInstructionDiscriminator(custodyInstruction?.data);
  if (!discriminator || !equalBytes(discriminator, anchorDiscriminator(expectedAction))) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, `The custody instruction must be the exact ${expectedAction} Anchor instruction.`);
  const transfers = instructions.map(instruction => parseTransfer(instruction, transaction, keys, intent.asset?.mint)).filter(Boolean);
  if (transfers.length === 0) return fail(RECONCILIATION_ERRORS.MISSING_TRANSFER, 'No parsed legacy SPL transfer was found.');
  if (transfers.length !== 1) return fail(SOLANA_RECONCILIATION_ERRORS.TOKEN_TRANSFER_COUNT, 'Exactly one parsed legacy SPL transfer is permitted for funding.');
  const transfer = transfers[0];
  const balances = tokenBalanceEntries(transaction, keys);
  const preVault = balances.forAccount(balances.pre, vault, intent.asset?.mint);
  const postVault = balances.forAccount(balances.post, vault, intent.asset?.mint);
  const preAmount = balanceAmount(preVault);
  const postAmount = balanceAmount(postVault);
  if (!decimal(preAmount) || !decimal(postAmount)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Finalized vault token balances are missing or malformed.');
  if (preAmount !== '0') return fail(SOLANA_RECONCILIATION_ERRORS.VAULT_NOT_EMPTY, 'The vault must be empty before canonical funding.');
  let delta;
  try { delta = (BigInt(postAmount) - BigInt(preAmount)).toString(); } catch { return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Vault balance arithmetic is invalid.'); }
  let decodedAgreement;
  try { decodedAgreement = decodeAgreementIdHash({ intent, signature, transaction, keys, agreementAccount, milestoneAccount }); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, error instanceof Error ? error.message : 'Agreement account decoding failed.'); }
  if (!plain(decodedAgreement)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The agreement decoder must return commitment and account bindings.');
  const agreementIdHash = decodedAgreement.agreementIdHash;
  if (!text(agreementIdHash)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The agreement decoder did not return a commitment.');
  const bindings = [
    ['programId', intent.chain?.programId],
    ['buyer', intent.parties?.buyer],
    ['mint', intent.asset?.mint],
    ['vault', vault],
    ['termsHash', intent.termsHash]
  ];
  for (const [field, expected] of bindings) {
    if (decodedAgreement[field] !== expected) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, `Decoded agreement ${field} does not match the funding intent.`);
  }
  if (requireRoleBindings) {
    const roleBindings = [
      ['seller', intent.parties?.seller],
      ['arbiter', intent.parties?.arbiter],
      ['feeRecipient', intent.parties?.fee]
    ];
    for (const [field, expected] of roleBindings) {
      if (!text(decodedAgreement[field]) || decodedAgreement[field] !== expected) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, `Decoded agreement ${field} does not match the funding intent.`);
    }
  }
  if (text(agreementAccount?.address) && decodedAgreement.escrow !== agreementAccount.address) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Decoded agreement PDA does not match the finalized account that was loaded.');
  if (text(milestoneAccount?.address) && decodedAgreement.milestone !== milestoneAccount.address) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Decoded milestone PDA does not match the finalized account that was loaded.');
  const expectedVaultAuthority = intent.kind === 'fund_milestone_v2'
    ? decodedAgreement.vaultAuthority || decodedAgreement.milestone
    : decodedAgreement.vaultAuthority || decodedAgreement.escrow;
  if (!validPubkey(decodedAgreement.escrow) || !validPubkey(expectedVaultAuthority) || !text(preVault?.owner) || !text(postVault?.owner) || preVault.owner !== expectedVaultAuthority || postVault.owner !== expectedVaultAuthority) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Vault token-account ownership is not bound to the decoded custody authority.');
  const instructionAccounts = Array.isArray(custodyInstruction.accounts) ? custodyInstruction.accounts : null;
  const expectedAccounts = intent.kind === 'fund_milestone_v2'
    ? [intent.parties.buyer, decodedAgreement.escrow, intent.asset.mint, decodedAgreement.milestone, vault, transfers[0].source, LEGACY_SPL_TOKEN_PROGRAM_ID]
    : [intent.parties.buyer, decodedAgreement.escrow, intent.asset.mint, vault, transfers[0].source, LEGACY_SPL_TOKEN_PROGRAM_ID];
  if (!instructionAccounts || instructionAccounts.length !== expectedAccounts.length || instructionAccounts.some((account, index) => account !== expectedAccounts[index])) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The custody instruction accounts do not exactly match the decoded funding intent.');
  const signers = message.accountKeys.filter(entry => entry && entry.signer).map(accountKey).filter(text);
  const observed = {
    signature,
    status: FINALIZED_STATUS,
    network: intent.chain.network,
    programId: intent.chain.programId,
    agreementIdHash,
    buyer: intent.parties.buyer,
    mint: intent.asset.mint,
    tokenProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID,
    vault,
    pdaBindingsVerified: decodedAgreement.pdaBindingsVerified === true,
    signers,
    transfers,
    vaultDelta: { vault, mint: intent.asset.mint, delta }
  };
  if (genesisHash !== undefined) observed.genesisHash = genesisHash;
  if (transaction.slot !== undefined) observed.slot = transaction.slot;
  const accountContextSlots = {};
  if (Number.isSafeInteger(agreementAccount?.contextSlot)) accountContextSlots.agreement = agreementAccount.contextSlot;
  if (Number.isSafeInteger(milestoneAccount?.contextSlot)) accountContextSlots.milestone = milestoneAccount.contextSlot;
  if (Object.keys(accountContextSlots).length > 0) observed.accountContextSlots = accountContextSlots;
  return { ok: true, value: observed };
}

/**
 * Fetch a signature and transaction through an injected RPC client, then
 * optionally persist the verified evidence. `record` is the only side effect
 * and must be idempotent on operationId in the production ledger.
 */
export async function reconcileFundingOnRpc({ intent, signature, operationId, vault, rpc, expectedGenesisHash, agreementAddress, milestoneAddress, seenOperationIds = [], decodeAgreementIdHash, record, allowedMints }) {
  if (!rpc || typeof rpc.getSignatureStatuses !== 'function' || typeof rpc.getTransaction !== 'function') return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, 'RPC adapter must expose getSignatureStatuses and getTransaction.');
  if (!text(signature) || !text(operationId) || !text(vault)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'Signature, operationId and vault are required.');
  if (seenOperationIds.includes(operationId)) return fail(RECONCILIATION_ERRORS.DUPLICATE_OPERATION, 'operationId has already been reconciled.', { operationId });
  const accountDecoder = decodeAgreementIdHash || (intent?.kind === 'fund'
    ? ({ agreementAccount }) => decodeV1EscrowAccount({
      owner: agreementAccount.owner,
      data: agreementAccount.data,
      expectedProgramId: intent.chain?.programId,
      accountAddress: agreementAccount.address,
      verifyPdas: true,
      requireExactLayout: true,
      requireFundingState: true
    })
    : intent?.kind === 'fund_milestone_v2'
      ? ({ agreementAccount, milestoneAccount }) => decodeV2FundingAccounts({
        agreementAccount,
        milestoneAccount,
        expectedProgramId: intent.chain?.programId,
        expectedMilestoneAddress: milestoneAddress,
        expectedMilestoneIndex: intent.milestoneIndex,
        expectedVault: vault,
        verifyPdas: true,
        requireExactLayout: true,
        requireFundingState: true
      })
      : null);
  if (typeof accountDecoder !== 'function') return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'A strict V2 agreement/milestone decoder is required before reconciliation can credit funding.');
  let statusResult;
  try { statusResult = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'RPC status request failed.'); }
  const status = statusResult?.value?.[0];
  if (!status) return fail(RECONCILIATION_ERRORS.NOT_FINALIZED, 'The signature is not yet available from the configured RPC.');
  if (status.err) return fail(SOLANA_RECONCILIATION_ERRORS.SIGNATURE_FAILED, 'The funding transaction failed on chain.', { err: status.err });
  if (status.confirmationStatus !== FINALIZED_STATUS) return fail(RECONCILIATION_ERRORS.NOT_FINALIZED, 'Funding is not creditable until finalized.', { status: status.confirmationStatus || 'unknown' });
  const cluster = await verifyRpcGenesisHash({ rpc, expectedGenesisHash });
  if (!cluster.ok) return cluster;
  let transaction;
  try { transaction = await rpc.getTransaction(signature, { commitment: FINALIZED_STATUS, encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }); } catch (error) { return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'RPC transaction request failed.'); }
  if (!transaction) return fail(SOLANA_RECONCILIATION_ERRORS.MISSING_TRANSACTION, 'The finalized signature has no retrievable transaction.');
  if (!Number.isSafeInteger(transaction.slot) || transaction.slot < 0) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The finalized transaction is missing a valid slot context.');
  const transactionSignatures = transaction.transaction?.signatures;
  if (Array.isArray(transactionSignatures) && !transactionSignatures.includes(signature)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'The returned transaction does not contain the requested signature.');
  if (!text(agreementAddress)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'A finalized agreement account address is required.');
  let agreementAccount;
  let milestoneAccount;
  if (intent.kind === 'fund_milestone_v2') {
    if (!text(milestoneAddress)) return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_ACCOUNT, 'A finalized V2 milestone account address is required.');
    const accounts = await loadFinalizedAccounts({ rpc, addresses: [agreementAddress, milestoneAddress], expectedProgramId: intent.chain?.programId, minContextSlot: transaction.slot });
    if (!accounts.ok) return accounts;
    agreementAccount = { ok: true, value: accounts.value[0] };
    milestoneAccount = { ok: true, value: accounts.value[1] };
  } else {
    agreementAccount = await loadFinalizedAccount({ rpc, address: agreementAddress, expectedProgramId: intent.chain?.programId, minContextSlot: transaction.slot });
    if (!agreementAccount.ok) return agreementAccount;
  }
  // Even an injected decoder is a production authorization boundary: callers
  // must return every persisted role binding, not only the terms commitment.
  const normalized = normalizeFinalizedFundingTransaction({ intent, signature, transaction, vault, agreementAccount: agreementAccount.value, milestoneAccount: milestoneAccount?.value, genesisHash: cluster.value.genesisHash, decodeAgreementIdHash: accountDecoder, requireRoleBindings: true });
  if (!normalized.ok) return normalized;
  const verified = reconcileFundingIntent(intent, normalized.value, { operationId, vault, seenOperationIds, allowedMints });
  if (!verified.ok) return verified;
  if (typeof record !== 'function') return fail(SOLANA_RECONCILIATION_ERRORS.MALFORMED_TRANSACTION, 'An idempotent evidence recorder is required before reconciliation can credit funding.');
  try {
    await record(verified.value);
  } catch (error) {
    return fail(SOLANA_RECONCILIATION_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'Verified evidence could not be persisted.', { operationId });
  }
  return verified;
}
