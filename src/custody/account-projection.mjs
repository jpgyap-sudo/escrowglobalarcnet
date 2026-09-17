/**
 * Convert a verified finalized account snapshot into persistence rows.
 *
 * This is deliberately a pure boundary: it does not call RPC, sign, submit,
 * or write a database. The caller must obtain the proof envelope from the
 * finalized reconciliation path before invoking it.
 */
import {
  decodeV1EscrowAccount,
  decodeV2FundingAccounts,
  decodeV2MultiEscrowAccount,
  decodeV2MilestoneAccount
} from './solana-reconciliation.mjs';
import { LEGACY_SPL_TOKEN_PROGRAM_ID } from './reconciliation.mjs';
import { base58Decode } from '../payments.mjs';

const U64_MAX = (1n << 64n) - 1n;
const V1_STATES = new Set(['Funded', 'Submitted', 'Disputed', 'Approved', 'CommonGround', 'SellerPaid', 'Refunded', 'Closed']);
const V2_PARENT_STATES = new Set(['Accepted', 'Closed']);
const V2_MILESTONE_STATES = new Set(['Funded', 'Submitted', 'Disputed', 'Approved', 'SellerPaid', 'Refunded', 'Closed']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function address(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a Solana address.`);
  try {
    const bytes = base58Decode(value);
    if (bytes.length !== 32 || bytes.every(byte => byte === 0)) throw new Error();
  } catch { fail(`${label} must be a valid non-zero Solana address.`); }
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) fail(`${label} must be a non-zero lowercase SHA-256 hash.`);
  return value;
}

function amount(value, label, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail(`${label} must be a canonical unsigned decimal string.`);
  const parsed = BigInt(value);
  if (parsed > U64_MAX || (positive && parsed === 0n)) fail(`${label} is outside the supported token-unit range.`);
  return parsed;
}

function safeSlot(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('accounts.contextSlot must be a non-negative safe integer.');
  return value;
}

function requireProof(input) {
  if (!plain(input) || input.finalized !== true || input.pdaBindingsVerified !== true) fail('Only finalized, PDA-verified account evidence can be projected.');
  if (!plain(input.accounts)) fail('accounts are required.');
  return safeSlot(input.accounts.contextSlot);
}

function requireDeployment(deployment) {
  if (!plain(deployment)) fail('deployment is required.');
  address(deployment.programId, 'deployment.programId');
  address(deployment.mint, 'deployment.mint');
  address(deployment.fixedFeeRecipient, 'deployment.fixedFeeRecipient');
  if (typeof deployment.deploymentId !== 'string' || deployment.deploymentId.length < 1 || deployment.deploymentId.length > 128) fail('deployment.deploymentId is invalid.');
  return deployment;
}

function requireIntent(intent) {
  if (!plain(intent)) fail('intent is required.');
  if (typeof intent.agreementId !== 'string' || intent.agreementId.length < 1 || intent.agreementId.length > 128) fail('intent.agreementId is invalid.');
  hash(intent.agreementIdHash, 'intent.agreementIdHash');
  hash(intent.termsHash, 'intent.termsHash');
  if (!plain(intent.parties) || !plain(intent.asset)) fail('intent parties and asset bindings are required.');
  for (const [key, label] of [['buyer', 'intent.parties.buyer'], ['seller', 'intent.parties.seller'], ['arbiter', 'intent.parties.arbiter'], ['fee', 'intent.parties.fee'], ['mint', 'intent.asset.mint']]) address(intent.parties[key] ?? intent.asset[key], label);
  if (intent.asset.tokenProgramId !== LEGACY_SPL_TOKEN_PROGRAM_ID) fail('Only the legacy SPL Token Program is admitted for custody projection.');
  return intent;
}

function accountShape(account, label) {
  if (!plain(account)) fail(`${label} is required.`);
  address(account.address, `${label}.address`);
  address(account.owner, `${label}.owner`);
  if (!Array.isArray(account.data) || account.data.length !== 2 || typeof account.data[0] !== 'string' || account.data[1] !== 'base64') fail(`${label}.data must be canonical RPC base64 data.`);
  return account;
}

function tokenVaultShape(account, label, { mint, authority, expectedAmount }) {
  accountShape(account, label);
  if (account.owner !== LEGACY_SPL_TOKEN_PROGRAM_ID) fail(`${label} is not owned by the legacy SPL Token Program.`);
  address(account.mint, `${label}.mint`);
  address(account.authority, `${label}.authority`);
  equal(account.mint, mint, `${label} mint`);
  equal(account.authority, authority, `${label} authority`);
  if (amount(account.amount, `${label}.amount`) !== expectedAmount) fail(`${label} amount does not match the finalized account snapshot.`);
  return account;
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match the configured intent.`);
}

function identity(decoded, intent, deployment, label) {
  equal(decoded.agreementIdHash, intent.agreementIdHash, `${label} agreement commitment`);
  equal(decoded.termsHash, intent.termsHash, `${label} terms commitment`);
  const expected = { buyer: intent.parties.buyer, seller: intent.parties.seller, arbiter: intent.parties.arbiter, feeRecipient: intent.parties.fee, mint: intent.asset.mint };
  for (const [key, name] of [['buyer', 'buyer'], ['seller', 'seller'], ['arbiter', 'arbiter'], ['feeRecipient', 'fee recipient'], ['mint', 'mint']]) equal(decoded[key], expected[key], `${label} ${name}`);
  equal(decoded.mint, deployment.mint, `${label} deployment mint`);
  equal(decoded.feeRecipient, deployment.fixedFeeRecipient, `${label} deployment fee recipient`);
  if (decoded.pdaBindingsVerified !== true) fail(`${label} PDA proof is missing.`);
}

function economics(decoded, label) {
  const principal = amount(decoded.principal, `${label}.principal`, true);
  const feeReserve = amount(decoded.feeReserve, `${label}.feeReserve`);
  const expectedTotal = amount(decoded.expectedTotal, `${label}.expectedTotal`, true);
  const sellerEntitlement = amount(decoded.sellerEntitlement, `${label}.sellerEntitlement`);
  const feeEntitlement = amount(decoded.feeEntitlement, `${label}.feeEntitlement`);
  const buyerEntitlement = amount(decoded.buyerEntitlement, `${label}.buyerEntitlement`);
  if (principal + feeReserve !== expectedTotal) fail(`${label} principal plus fee reserve does not equal expected total.`);
  if (sellerEntitlement + feeEntitlement + buyerEntitlement > expectedTotal) fail(`${label} entitlements exceed expected total.`);
  return { principal, feeReserve, expectedTotal, sellerEntitlement, feeEntitlement, buyerEntitlement };
}

// SPL Token accounts accept permissionless transfers. Payout rights therefore
// come only from the program ledger; the observed vault is a solvency check.
function v1Obligation(decoded, values) {
  const entitlements = values.sellerEntitlement + values.feeEntitlement + values.buyerEntitlement;
  if (['Funded', 'Submitted', 'Disputed'].includes(decoded.state)) return values.expectedTotal;
  if (decoded.state === 'CommonGround') return entitlements + amount(decoded.unresolvedPrincipal, 'V1 unresolved principal') + amount(decoded.commonGroundRemainderFeeReserve, 'V1 Common Ground remainder fee reserve');
  return entitlements;
}

function v2Obligation(decoded, values) {
  if (['Funded', 'Submitted', 'Disputed'].includes(decoded.state)) return values.expectedTotal;
  return values.sellerEntitlement + values.feeEntitlement + values.buyerEntitlement;
}

function rowValues(values, label) {
  for (const [key, value] of Object.entries(values)) if (value === undefined) fail(`${label}.${key} is undefined.`);
  return Object.freeze(values);
}

function agreementRow(decoded, deployment, intent, protocolVersion, observedSlot, vaultAmount = null, v1Values = null) {
  const stateRevision = protocolVersion === 'v1' ? amount(decoded.decisionRevision, 'V1 decision revision') : amount(String(decoded.closedMilestones ?? 0), 'V2 closed milestone revision');
  return rowValues({
    agreement_id: intent.agreementId,
    deployment_id: deployment.deploymentId,
    agreement_address: decoded.escrow,
    agreement_id_hash: decoded.agreementIdHash,
    terms_hash: decoded.termsHash,
    buyer: decoded.buyer,
    seller: decoded.seller,
    arbiter: decoded.arbiter,
    fee_recipient: decoded.feeRecipient,
    mint: decoded.mint,
    protocol_version: protocolVersion,
    state: decoded.state,
    state_revision: stateRevision.toString(),
    principal: v1Values ? v1Values.principal.toString() : null,
    fee_reserve: v1Values ? v1Values.feeReserve.toString() : null,
    expected_total: v1Values ? v1Values.expectedTotal.toString() : null,
    seller_entitlement: v1Values ? v1Values.sellerEntitlement.toString() : null,
    fee_entitlement: v1Values ? v1Values.feeEntitlement.toString() : null,
    buyer_entitlement: v1Values ? v1Values.buyerEntitlement.toString() : null,
    unresolved_principal: v1Values ? amount(decoded.unresolvedPrincipal, 'V1 unresolved principal').toString() : null,
    vault_address: v1Values ? decoded.vault : null,
    vault_amount: v1Values ? vaultAmount.toString() : null,
    observed_slot: observedSlot
  }, `${protocolVersion} agreement`);
}

function checkCounters(parent) {
  const count = Number(parent.milestoneCount);
  const created = Number(parent.createdMilestones);
  const funded = Number(parent.fundedMilestones);
  const closed = Number(parent.closedMilestones);
  if (![count, created, funded, closed].every(value => Number.isSafeInteger(value) && value >= 0) || count < 1 || count > 16 || created > count || funded > created || closed > funded) fail('V2 milestone counters are inconsistent.');
  return count;
}

function milestoneRow(decoded, deployment, intent, parent, vaultAddress, vaultAmount, observedSlot) {
  const values = economics(decoded, 'V2 milestone');
  if (v2Obligation(decoded, values) > vaultAmount) fail('V2 milestone ledger obligation exceeds the current vault balance.');
  return rowValues({
    agreement_id: intent.agreementId,
    milestone_index: decoded.index,
    milestone_address: decoded.milestone,
    vault_address: vaultAddress,
    principal: values.principal.toString(),
    fee_reserve: values.feeReserve.toString(),
    expected_total: values.expectedTotal.toString(),
    state: decoded.state,
    seller_entitlement: values.sellerEntitlement.toString(),
    fee_entitlement: values.feeEntitlement.toString(),
    buyer_entitlement: values.buyerEntitlement.toString(),
    vault_amount: vaultAmount.toString(),
    observed_slot: observedSlot
  }, 'V2 milestone');
}

export function projectFinalizedAccountSnapshot(input) {
  const observedSlot = requireProof(input);
  const deployment = requireDeployment(input.deployment);
  const intent = requireIntent(input.intent);
  const vaultAmount = amount(input.vaultAmount, 'vaultAmount');
  if (input.kind !== 'v1' && input.kind !== 'v2') fail('kind must be v1 or v2.');

  if (input.kind === 'v1') {
    const agreement = accountShape(input.accounts.agreement, 'accounts.agreement');
    const decoded = decodeV1EscrowAccount({ owner: agreement.owner, data: agreement.data, expectedProgramId: deployment.programId, accountAddress: agreement.address, verifyPdas: true, requireExactLayout: true, requireFundingState: true });
    if (!V1_STATES.has(decoded.state)) fail('V1 account state is not supported for projection.');
    identity(decoded, intent, deployment, 'V1 agreement');
    const vault = tokenVaultShape(input.accounts.vault, 'accounts.vault', { mint: decoded.mint, authority: decoded.escrow, expectedAmount: vaultAmount });
    if (decoded.vault !== vault.address) fail('V1 vault address does not match the account commitment.');
    const values = economics(decoded, 'V1 agreement');
    if (v1Obligation(decoded, values) > vaultAmount) fail('V1 ledger obligation exceeds the current vault balance.');
    return Object.freeze({ agreement: agreementRow(decoded, deployment, intent, 'v1', observedSlot, vaultAmount, values), milestones: Object.freeze([]) });
  }

  const agreement = accountShape(input.accounts.agreement, 'accounts.agreement');
  const milestone = accountShape(input.accounts.milestone, 'accounts.milestone');
  if (!Number.isSafeInteger(input.milestoneIndex) || input.milestoneIndex < 0 || input.milestoneIndex > 15) fail('milestoneIndex must be an integer from 0 through 15.');
  const parent = decodeV2MultiEscrowAccount({ owner: agreement.owner, data: agreement.data, expectedProgramId: deployment.programId, accountAddress: agreement.address, verifyPdas: true, requireExactLayout: true, requireFundingState: true });
  const decodedMilestone = decodeV2MilestoneAccount({ owner: milestone.owner, data: milestone.data, expectedProgramId: deployment.programId, accountAddress: milestone.address, verifyPdas: true, requireExactLayout: true, requireFundingState: true });
  const vault = tokenVaultShape(input.accounts.vault, 'accounts.vault', { mint: parent.mint, authority: decodedMilestone.milestone, expectedAmount: vaultAmount });
  const linked = decodeV2FundingAccounts({ agreementAccount: agreement, milestoneAccount: milestone, expectedProgramId: deployment.programId, expectedMilestoneAddress: milestone.address, expectedMilestoneIndex: input.milestoneIndex, expectedVault: vault.address, verifyPdas: true, requireExactLayout: true, requireFundingState: true });
  if (!V2_PARENT_STATES.has(parent.state)) fail('V2 parent state is not supported for projection.');
  if (!V2_MILESTONE_STATES.has(decodedMilestone.state)) fail('V2 milestone state is not supported for projection.');
  if (checkCounters(parent) <= decodedMilestone.index) fail('V2 milestone index is outside the parent milestone set.');
  if (linked.pdaBindingsVerified !== true || decodedMilestone.escrow !== parent.escrow) fail('V2 parent and milestone bindings are not proven.');
  identity(parent, intent, deployment, 'V2 agreement');
  if (decodedMilestone.milestone !== milestone.address) fail('V2 milestone address does not match the account snapshot.');
  const row = milestoneRow(decodedMilestone, deployment, intent, parent, vault.address, vaultAmount, observedSlot);
  return Object.freeze({ agreement: agreementRow(parent, deployment, intent, 'v2', observedSlot), milestone: row });
}

export default projectFinalizedAccountSnapshot;
