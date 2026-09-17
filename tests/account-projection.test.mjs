import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createFundingIntent, createMilestoneActionIntent } from '../src/custody/intent.mjs';
import { LEGACY_SPL_TOKEN_PROGRAM_ID } from '../src/custody/reconciliation.mjs';
import { findProgramAddress, u16le, utf8 } from '../src/custody/solana-pda.mjs';
import { sha256Text } from '../src/agreement.mjs';
import { projectFinalizedAccountSnapshot } from '../src/custody/account-projection.mjs';

const address = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = address(1), seller = address(33), arbiter = address(66), fee = address(99), program = address(132), mint = address(165);
const genesisHash = address(240);
const deployment = { deploymentId: 'devnet-escrow-global', programId: program, mint, fixedFeeRecipient: fee };
const v1Intent = createFundingIntent({ id: 'projection-v1', currentTermsHash: 'a'.repeat(64), termsVersion: 1, buyerWallet: buyer, sellerWallet: seller, arbiterWallet: arbiter, feeWallet: fee, acceptedAt: 1700000000000, fundedAt: null, cancelled: false, milestones: [{ id: 'm1', originalAmount: '1000', status: 'unfunded' }] }, { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash, fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, createdAt: 1700000000000 });
const v2Intent = createMilestoneActionIntent({ id: 'projection-v2', currentTermsHash: 'b'.repeat(64), termsVersion: 1, buyerWallet: buyer, sellerWallet: seller, arbiterWallet: arbiter, feeWallet: fee, acceptedAt: 1700000000000, fundedAt: null, cancelled: false, milestones: [{ id: 'm1', originalAmount: '1000', status: 'unfunded' }] }, 0, 'fund_milestone_v2', { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash, fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, createdAt: 1700000000000 });

function bytesForAddress(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = [];
  while (number) { bytes.unshift(Number(number & 255n)); number >>= 8n; }
  for (const character of value) { if (character === '1') bytes.unshift(0); else break; }
  assert.equal(bytes.length, 32);
  return Uint8Array.from(bytes);
}

function setU64(bytes, offset, value) {
  let remaining = BigInt(value);
  for (let index = 0; index < 8; index += 1) { bytes[offset + index] = Number(remaining & 255n); remaining >>= 8n; }
}

function rpcAccount(addressValue, owner, bytes) {
  return { address: addressValue, owner, data: [Buffer.from(bytes).toString('base64'), 'base64'] };
}

function tokenAccount(addressValue, authority, amount = '1030') {
  return { address: addressValue, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, mint, authority, amount, data: ['', 'base64'] };
}

function v1Fixture({ sellerEntitlement = 0 } = {}) {
  const escrow = findProgramAddress([utf8('escrow'), bytesForAddress(buyer), Uint8Array.from(Buffer.from(v1Intent.agreementIdHash, 'hex'))], program).address;
  const vault = findProgramAddress([utf8('vault'), bytesForAddress(escrow)], program).address;
  const bytes = new Uint8Array(464);
  bytes.set(Buffer.from(sha256Text('account:Escrow').slice(0, 16), 'hex'), 0);
  bytes.set(bytesForAddress(buyer), 8); bytes.set(bytesForAddress(seller), 40); bytes.set(bytesForAddress(arbiter), 72); bytes.set(bytesForAddress(fee), 104); bytes.set(bytesForAddress(mint), 136); bytes.set(bytesForAddress(vault), 168);
  bytes.set(Buffer.from(v1Intent.agreementIdHash, 'hex'), 200); bytes.set(Buffer.from(v1Intent.termsHash, 'hex'), 232);
  setU64(bytes, 296, 1000); setU64(bytes, 304, 30); setU64(bytes, 312, 1030); setU64(bytes, 352, 1700000000); setU64(bytes, 360, 1700003600); setU64(bytes, 368, 1700007200); setU64(bytes, 320, sellerEntitlement); bytes[418] = 2;
  return { escrow, vault, input: { kind: 'v1', deployment, finalized: true, pdaBindingsVerified: true, intent: v1Intent, vaultAmount: sellerEntitlement ? '0' : '1030', accounts: { contextSlot: 500, agreement: rpcAccount(escrow, program, bytes), vault: tokenAccount(vault, escrow, sellerEntitlement ? '0' : '1030') } } };
}

function v2Fixture() {
  const escrow = findProgramAddress([utf8('escrow-v2'), bytesForAddress(buyer), Uint8Array.from(Buffer.from(v2Intent.agreementIdHash, 'hex'))], program).address;
  const milestone = findProgramAddress([utf8('milestone-v2'), bytesForAddress(escrow), u16le(0)], program).address;
  const vault = findProgramAddress([utf8('vault-v2'), bytesForAddress(milestone)], program).address;
  const parent = new Uint8Array(242);
  parent.set(Buffer.from(sha256Text('account:MultiEscrow').slice(0, 16), 'hex'), 0); parent.set(bytesForAddress(buyer), 8); parent.set(bytesForAddress(seller), 40); parent.set(bytesForAddress(arbiter), 72); parent.set(bytesForAddress(fee), 104); parent.set(bytesForAddress(mint), 136); parent.set(Buffer.from(v2Intent.agreementIdHash, 'hex'), 168); parent.set(Buffer.from(v2Intent.termsHash, 'hex'), 200); parent.set(Uint8Array.from([1, 0]), 232); parent.set(Uint8Array.from([1, 0]), 234); parent.set(Uint8Array.from([1, 0]), 236); parent[240] = 1;
  const milestoneBytes = new Uint8Array(161);
  milestoneBytes.set(Buffer.from(sha256Text('account:MilestoneV2').slice(0, 16), 'hex'), 0); milestoneBytes.set(bytesForAddress(escrow), 8); milestoneBytes.set(Uint8Array.from([0, 0]), 40); setU64(milestoneBytes, 42, 1000); setU64(milestoneBytes, 50, 30); setU64(milestoneBytes, 58, 1030); setU64(milestoneBytes, 98, 1700000000); setU64(milestoneBytes, 106, 1700003600); setU64(milestoneBytes, 114, 1700007200); milestoneBytes[155] = 1;
  return { escrow, milestone, vault, input: { kind: 'v2', deployment, finalized: true, pdaBindingsVerified: true, intent: v2Intent, milestoneIndex: 0, vaultAmount: '1030', accounts: { contextSlot: 501, agreement: rpcAccount(escrow, program, parent), milestone: rpcAccount(milestone, program, milestoneBytes), vault: tokenAccount(vault, milestone) } } };
}

test('projects a strict finalized V1 account into a canonical agreement row', () => {
  const result = projectFinalizedAccountSnapshot(v1Fixture().input);
  assert.equal(result.agreement.protocol_version, 'v1');
  assert.equal(result.agreement.agreement_address, v1Fixture().escrow);
  assert.equal(result.agreement.state, 'Funded');
  assert.equal(result.agreement.state_revision, '0');
  assert.deepEqual({ principal: result.agreement.principal, fee: result.agreement.fee_reserve, total: result.agreement.expected_total, vault: result.agreement.vault_amount }, { principal: '1000', fee: '30', total: '1030', vault: '1030' });
  assert.deepEqual(result.milestones, []);
});

test('projects a strict finalized V2 parent and milestone pair', () => {
  const fixture = v2Fixture();
  const result = projectFinalizedAccountSnapshot(fixture.input);
  assert.equal(result.agreement.protocol_version, 'v2');
  assert.equal(result.agreement.state, 'Accepted');
  assert.equal(result.milestone.milestone_address, fixture.milestone);
  assert.equal(result.milestone.vault_address, fixture.vault);
  assert.equal(result.milestone.expected_total, '1030');
});

test('keeps V1 entitlements fixed while tolerating post-funding vault dust', () => {
  const fixture = v1Fixture();
  const input = { ...fixture.input, vaultAmount: '1031', accounts: { ...fixture.input.accounts, vault: tokenAccount(fixture.vault, fixture.escrow, '1031') } };
  const result = projectFinalizedAccountSnapshot(input);
  assert.equal(result.agreement.expected_total, '1030');
  assert.equal(result.agreement.vault_amount, '1031');
  assert.equal(result.agreement.seller_entitlement, '0');
});

test('keeps V2 entitlements fixed while tolerating post-funding vault dust', () => {
  const fixture = v2Fixture();
  const input = { ...fixture.input, vaultAmount: '1031', accounts: { ...fixture.input.accounts, vault: tokenAccount(fixture.vault, fixture.milestone, '1031') } };
  const result = projectFinalizedAccountSnapshot(input);
  assert.equal(result.milestone.expected_total, '1030');
  assert.equal(result.milestone.vault_amount, '1031');
  assert.equal(result.milestone.seller_entitlement, '0');
});

test('rejects missing finality or PDA proof', () => {
  const fixture = v1Fixture().input;
  assert.throws(() => projectFinalizedAccountSnapshot({ ...fixture, finalized: false }), /finalized/);
  assert.throws(() => projectFinalizedAccountSnapshot({ ...fixture, pdaBindingsVerified: false }), /PDA/);
});

test('rejects forged V2 vault links and malformed token amounts', () => {
  const fixture = v2Fixture();
  assert.throws(() => projectFinalizedAccountSnapshot({ ...fixture.input, accounts: { ...fixture.input.accounts, vault: tokenAccount(address(250), fixture.milestone) } }), /canonical PDA|vault/i);
  assert.throws(() => projectFinalizedAccountSnapshot({ ...fixture.input, vaultAmount: '01' }), /canonical/);
  assert.throws(() => projectFinalizedAccountSnapshot({ ...fixture.input, vaultAmount: '18446744073709551616' }), /range/);
});

test('rejects entitlement conservation violations', () => {
  const fixture = v1Fixture({ sellerEntitlement: 1 });
  assert.throws(() => projectFinalizedAccountSnapshot(fixture.input), /obligation|entitlements exceed/);
});
