import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createFundingIntent } from '../src/custody/intent.mjs';
import { LEGACY_SPL_TOKEN_PROGRAM_ID, reconcileFundingIntent } from '../src/custody/reconciliation.mjs';
import { createMilestoneActionIntent } from '../src/custody/intent.mjs';
import { decodeV1EscrowAccount, decodeV2FundingAccounts, decodeV2MilestoneAccount, decodeV2MultiEscrowAccount, loadFinalizedAccount, loadFinalizedAccounts, loadFinalizedProjectionInput, loadFinalizedTokenAccount, normalizeFinalizedFundingTransaction, reconcileFundingOnRpc, verifyRpcGenesisHash, SOLANA_COMPUTE_BUDGET_PROGRAM_ID } from '../src/custody/solana-reconciliation.mjs';
import { findProgramAddress, u16le, utf8 } from '../src/custody/solana-pda.mjs';
import { sha256Text } from '../src/agreement.mjs';

const address = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = address(1), seller = address(33), arbiter = address(66), fee = address(99), program = address(132), mint = address(165), vault = address(198), buyerToken = address(231), escrow = address(20), milestonePda = address(21), genesisHash = address(240);
const fixtureSignature = label => base58Encode(Uint8Array.from(Buffer.from(`${sha256Text(`tx:${label}`)}${sha256Text(`tx:${label}:tail`)}`, 'hex')));
const fixtureSignatures = Object.freeze(['signature-1', 'signature-compute-budget', 'signature-versioned', 'signature-bound', 'signature-forged-binding', 'signature-forged-terms', 'signature-missing-mint', 'signature-nested-custody', 'signature-multiple-transfers', 'signature-preloaded-vault', 'signature-v2', 'signature-v2-wrong-authority', 'signature-2', 'signature-default-decoder', 'signature-no-recorder', 'signature-default-v2-decoder', 'sig-pending', 'sig-failed', 'sig-dup', 'sig-no-program', 'sig-extra-program', 'sig-wrong-action', 'sig-missing-owner', 'sig-missing-role'].map(fixtureSignature));
const intent = createFundingIntent({ id: 'rpc-reconcile-1', currentTermsHash: 'a'.repeat(64), termsVersion: 1, buyerWallet: buyer, sellerWallet: seller, arbiterWallet: arbiter, feeWallet: fee, acceptedAt: 1700000000000, fundedAt: null, cancelled: false, milestones: [{ id: 'm1', originalAmount: '1000', reserve: '0', held: '0', status: 'unfunded' }] }, { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash, fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, createdAt: 1700000000000 });
const v2Intent = createMilestoneActionIntent({ id: 'rpc-reconcile-v2', currentTermsHash: 'a'.repeat(64), termsVersion: 1, buyerWallet: buyer, sellerWallet: seller, arbiterWallet: arbiter, feeWallet: fee, acceptedAt: 1700000000000, fundedAt: null, cancelled: false, milestones: [{ id: 'm1', originalAmount: '1000', status: 'unfunded' }] }, 0, 'fund_milestone_v2', { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash, fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, createdAt: 1700000000000 });
const strictEscrow = findProgramAddress([utf8('escrow'), requireAddressBytes(buyer), Uint8Array.from(Buffer.from(intent.agreementIdHash, 'hex'))], program).address;
const strictVault = findProgramAddress([utf8('vault'), requireAddressBytes(strictEscrow)], program).address;
const strictV2Escrow = findProgramAddress([utf8('escrow-v2'), requireAddressBytes(buyer), Uint8Array.from(Buffer.from(v2Intent.agreementIdHash, 'hex'))], program).address;
const strictMilestone = findProgramAddress([utf8('milestone-v2'), requireAddressBytes(strictV2Escrow), u16le(0)], program).address;
const strictV2Vault = findProgramAddress([utf8('vault-v2'), requireAddressBytes(strictMilestone)], program).address;

function parsedTransaction(fundingIntent = intent, overrides = {}, bindings = {}) {
  const isV2 = fundingIntent.kind === 'fund_milestone_v2';
  const observedEscrow = bindings.escrow || escrow;
  const observedVault = bindings.vault || vault;
  const observedMilestone = bindings.milestone || milestonePda;
  const vaultAuthority = isV2 ? observedMilestone : observedEscrow;
  const action = isV2 ? 'fund_milestone_v2' : 'fund';
  const fundData = base58Encode(Uint8Array.from(Buffer.from(sha256Text(`global:${action}`).slice(0, 16), 'hex')));
  const transaction = {
    slot: 100,
    transaction: { signatures: fixtureSignatures, message: { accountKeys: [
      { pubkey: buyer, signer: true, writable: true },
      { pubkey: observedVault, signer: false, writable: true },
      { pubkey: buyerToken, signer: false, writable: true },
      { pubkey: observedMilestone, signer: false, writable: true },
      { pubkey: observedEscrow, signer: false, writable: false },
      { pubkey: program, signer: false, writable: false },
      { pubkey: LEGACY_SPL_TOKEN_PROGRAM_ID, signer: false, writable: false }
    ], instructions: [
      { programId: program, data: fundData, accounts: isV2 ? [buyer, observedEscrow, mint, observedMilestone, observedVault, buyerToken, LEGACY_SPL_TOKEN_PROGRAM_ID] : [buyer, observedEscrow, mint, observedVault, buyerToken, LEGACY_SPL_TOKEN_PROGRAM_ID], parsed: null },
      { programId: LEGACY_SPL_TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: buyerToken, destination: observedVault, mint, tokenAmount: { amount: fundingIntent.total } } } }
    ] } },
    meta: { err: null, preTokenBalances: [{ accountIndex: 1, mint, owner: vaultAuthority, uiTokenAmount: { amount: '0' } }, { accountIndex: 2, mint, owner: buyer, uiTokenAmount: { amount: fundingIntent.total } }], postTokenBalances: [{ accountIndex: 1, mint, owner: vaultAuthority, uiTokenAmount: { amount: fundingIntent.total } }, { accountIndex: 2, mint, owner: buyer, uiTokenAmount: { amount: '0' } }] }
  };
  return {
    ...transaction,
    ...overrides,
    transaction: { ...transaction.transaction, ...(overrides.transaction || {}) },
    meta: { ...transaction.meta, ...(overrides.meta || {}) }
  };
}

function v1EscrowAccountData({ accountVault = vault, agreementHash = intent.agreementIdHash } = {}) {
  const bytes = new Uint8Array(464);
  bytes.set(Uint8Array.from(Buffer.from(sha256Text('account:Escrow').slice(0, 16), 'hex')), 0);
  bytes.set(Buffer.from(requireAddressBytes(buyer)), 8);
  bytes.set(Buffer.from(requireAddressBytes(seller)), 40);
  bytes.set(Buffer.from(requireAddressBytes(address(66))), 72);
  bytes.set(Buffer.from(requireAddressBytes(fee)), 104);
  bytes.set(Buffer.from(requireAddressBytes(mint)), 136);
  bytes.set(Buffer.from(requireAddressBytes(accountVault)), 168);
  bytes.set(Uint8Array.from(Buffer.from(agreementHash, 'hex')), 200);
  bytes.set(Uint8Array.from(Buffer.from(intent.termsHash, 'hex')), 232);
  setU64(bytes, 296, 1000);
  setU64(bytes, 304, 30);
  setU64(bytes, 312, 1030);
  setU64(bytes, 352, 1700000000);
  setU64(bytes, 360, 1700003600);
  setU64(bytes, 368, 1700007200);
  setU64(bytes, 410, 0x0102030405060708n);
  bytes[418] = 2; // Funded
  return [Buffer.from(bytes).toString('base64'), 'base64'];
}

function requireAddressBytes(value) {
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
  for (let index = 0; index < 8; index += 1) {
    bytes[offset + index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
}

function accountData(discriminatorName, length, fields) {
  const bytes = new Uint8Array(length);
  bytes.set(Uint8Array.from(Buffer.from(sha256Text(`account:${discriminatorName}`).slice(0, 16), 'hex')), 0);
  for (const [offset, value] of fields) bytes.set(value instanceof Uint8Array ? value : Uint8Array.from(Buffer.from(value, 'hex')), offset);
  return [Buffer.from(bytes).toString('base64'), 'base64'];
}

const decodedV1 = () => ({ agreementIdHash: intent.agreementIdHash, termsHash: intent.termsHash, programId: program, buyer, seller, arbiter, feeRecipient: fee, mint, vault, escrow });
const decodedV2 = () => ({ agreementIdHash: v2Intent.agreementIdHash, termsHash: v2Intent.termsHash, programId: program, buyer, seller, arbiter, feeRecipient: fee, mint, vault, vaultAuthority: milestonePda, escrow, milestone: milestonePda });
function v2MultiEscrowAccountData(parentEscrow = escrow) {
  return accountData('MultiEscrow', 242, [
    [8, requireAddressBytes(buyer)], [40, requireAddressBytes(seller)], [72, requireAddressBytes(arbiter)], [104, requireAddressBytes(fee)],
    [136, requireAddressBytes(mint)], [168, Uint8Array.from(Buffer.from(v2Intent.agreementIdHash, 'hex'))], [200, Uint8Array.from(Buffer.from(v2Intent.termsHash, 'hex'))],
    [232, Uint8Array.from([1, 0])], [234, Uint8Array.from([1, 0])], [240, Uint8Array.from([1])]
  ]);
}

function tokenAccountData({ accountMint = mint, authority = escrow, amount = 1030n, state = 1 } = {}) {
  const bytes = new Uint8Array(165);
  bytes.set(requireAddressBytes(accountMint), 0);
  bytes.set(requireAddressBytes(authority), 32);
  setU64(bytes, 64, amount);
  bytes[108] = state;
  return [Buffer.from(bytes).toString('base64'), 'base64'];
}
function v2MilestoneAccountData(index = 0, parent = escrow) {
  const data = accountData('MilestoneV2', 161, [[8, requireAddressBytes(parent)], [40, Uint8Array.from([index & 255, index >> 8])], [155, Uint8Array.from([1])]]);
  const bytes = Uint8Array.from(Buffer.from(data[0], 'base64'));
  setU64(bytes, 42, 1000);
  setU64(bytes, 50, 30);
  setU64(bytes, 58, 1030);
  setU64(bytes, 98, 1700000000);
  setU64(bytes, 106, 1700003600);
  setU64(bytes, 114, 1700007200);
  return [Buffer.from(bytes).toString('base64'), 'base64'];
}

test('decodes only the owned V1 Escrow commitment prefix', () => {
  const decoded = decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: v1EscrowAccountData() });
  assert.equal(decoded.agreementIdHash, intent.agreementIdHash);
  assert.equal(decoded.buyer, buyer);
  assert.equal(decoded.mint, mint);
  assert.equal(decoded.vault, vault);
  assert.equal(decoded.termsHash, intent.termsHash);
  assert.equal(decoded.escrow, escrow);
  assert.throws(() => decodeV1EscrowAccount({ owner: address(240), expectedProgramId: program, data: v1EscrowAccountData() }), /owner/);
  const malformed = v1EscrowAccountData();
  malformed[0] = Buffer.from('wrong').toString('base64');
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, data: malformed }), /shorter/);
});

test('strict full account decoders expose economics and reject pre-funding state', () => {
  const v1 = decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: v1EscrowAccountData(), requireExactLayout: true, requireFundingState: true });
  assert.deepEqual({ principal: v1.principal, feeReserve: v1.feeReserve, expectedTotal: v1.expectedTotal, decisionRevision: v1.decisionRevision, state: v1.state }, { principal: '1000', feeReserve: '30', expectedTotal: '1030', decisionRevision: '72623859790382856', state: 'Funded' });
  const preFunding = Uint8Array.from(Buffer.from(v1EscrowAccountData()[0], 'base64'));
  preFunding[418] = 1; // Accepted
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(preFunding).toString('base64'), 'base64'], requireExactLayout: true, requireFundingState: true }), /creditable/);
  const parent = decodeV2MultiEscrowAccount({ owner: program, expectedProgramId: program, accountAddress: strictV2Escrow, data: v2MultiEscrowAccountData(), requireExactLayout: true, requireFundingState: true });
  const milestone = decodeV2MilestoneAccount({ owner: program, expectedProgramId: program, accountAddress: strictMilestone, data: v2MilestoneAccountData(0, strictV2Escrow), requireExactLayout: true, requireFundingState: true });
  assert.deepEqual({ state: parent.state, milestoneCount: parent.milestoneCount, state2: milestone.state, expectedTotal: milestone.expectedTotal }, { state: 'Accepted', milestoneCount: 1, state2: 'Funded', expectedTotal: '1030' });
});

test('strict account decoders reject layout and enum boundary mutations', () => {
  const valid = Uint8Array.from(Buffer.from(v1EscrowAccountData()[0], 'base64'));
  for (const length of [463, 465]) {
    const mutated = new Uint8Array(length);
    mutated.set(valid.slice(0, Math.min(valid.length, length)));
    assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(mutated).toString('base64'), 'base64'], requireExactLayout: true }), /unexpected length/);
  }
  const invalidState = valid.slice();
  invalidState[418] = 255;
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(invalidState).toString('base64'), 'base64'], requireExactLayout: true }), /enum discriminant/);
  const invalidDeadlines = valid.slice();
  setU64(invalidDeadlines, 360, 1699999999);
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(invalidDeadlines).toString('base64'), 'base64'], requireExactLayout: true }), /deadlines/);
  const invalidLedger = valid.slice();
  setU64(invalidLedger, 320, 1031);
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(invalidLedger).toString('base64'), 'base64'], requireExactLayout: true }), /entitlements/);
  const invalidDisputeFee = valid.slice();
  setU64(invalidDisputeFee, 344, 51);
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: [Buffer.from(invalidDisputeFee).toString('base64'), 'base64'], requireExactLayout: true }), /dispute fee/);
  const incompleteParent = Uint8Array.from(Buffer.from(v2MultiEscrowAccountData()[0], 'base64'));
  incompleteParent[234] = 0;
  assert.throws(() => decodeV2MultiEscrowAccount({ owner: program, expectedProgramId: program, accountAddress: strictV2Escrow, data: [Buffer.from(incompleteParent).toString('base64'), 'base64'], requireExactLayout: true, requireFundingState: true }), /incomplete milestone/);
  const invalidMilestoneLedger = Uint8Array.from(Buffer.from(v2MilestoneAccountData()[0], 'base64'));
  setU64(invalidMilestoneLedger, 123, 1031);
  assert.throws(() => decodeV2MilestoneAccount({ owner: program, expectedProgramId: program, accountAddress: strictMilestone, data: [Buffer.from(invalidMilestoneLedger).toString('base64'), 'base64'], requireExactLayout: true, requireFundingState: true }), /entitlements/);
});

test('strict decoders recompute canonical V1 and V2 PDAs instead of trusting labels', () => {
  const v1 = decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: strictEscrow, data: v1EscrowAccountData({ accountVault: strictVault }), verifyPdas: true });
  assert.equal(v1.pdaBindingsVerified, true);
  assert.equal(v1.vault, strictVault);
  assert.throws(() => decodeV1EscrowAccount({ owner: program, expectedProgramId: program, accountAddress: escrow, data: v1EscrowAccountData({ accountVault: strictVault }), verifyPdas: true }), /canonical PDA/);

  const pair = decodeV2FundingAccounts({
    agreementAccount: { address: strictV2Escrow, owner: program, data: v2MultiEscrowAccountData() },
    milestoneAccount: { address: strictMilestone, owner: program, data: v2MilestoneAccountData(0, strictV2Escrow) },
    expectedProgramId: program,
    expectedMilestoneAddress: strictMilestone,
    expectedMilestoneIndex: 0,
    expectedVault: strictV2Vault,
    verifyPdas: true
  });
  assert.equal(pair.pdaBindingsVerified, true);
  assert.equal(pair.vault, strictV2Vault);
  assert.throws(() => decodeV2FundingAccounts({
    agreementAccount: { address: strictV2Escrow, owner: program, data: v2MultiEscrowAccountData() },
    milestoneAccount: { address: strictMilestone, owner: program, data: v2MilestoneAccountData(0, strictV2Escrow) },
    expectedProgramId: program,
    expectedMilestoneAddress: strictMilestone,
    expectedMilestoneIndex: 0,
    expectedVault: vault,
    verifyPdas: true
  }), /canonical PDA/);
});

test('decodes V2 parent and milestone identity prefixes without trusting account labels', () => {
  const multi = decodeV2MultiEscrowAccount({
    owner: program,
    expectedProgramId: program,
    data: accountData('MultiEscrow', 240, [
      [8, requireAddressBytes(buyer)], [40, requireAddressBytes(seller)],
      [136, requireAddressBytes(mint)], [168, Uint8Array.from(Buffer.from(intent.agreementIdHash, 'hex'))], [200, Uint8Array.from(Buffer.from(intent.termsHash, 'hex'))]
    ])
  });
  assert.deepEqual({ buyer: multi.buyer, seller: multi.seller, mint: multi.mint, agreementIdHash: multi.agreementIdHash, termsHash: multi.termsHash }, { buyer, seller, mint, agreementIdHash: intent.agreementIdHash, termsHash: intent.termsHash });
  const milestone = decodeV2MilestoneAccount({ owner: program, expectedProgramId: program, data: accountData('MilestoneV2', 42, [[8, requireAddressBytes(program)], [40, Uint8Array.from([3, 0])]]) });
  assert.equal(milestone.escrow, program);
  assert.equal(milestone.index, 3);
  assert.throws(() => decodeV2MultiEscrowAccount({ owner: program, expectedProgramId: program, data: accountData('MilestoneV2', 240, []) }), /MultiEscrow/);
  const pair = decodeV2FundingAccounts({
    agreementAccount: { address: escrow, owner: program, data: v2MultiEscrowAccountData() },
    milestoneAccount: { address: milestonePda, owner: program, data: v2MilestoneAccountData() },
    expectedProgramId: program,
    expectedMilestoneAddress: milestonePda,
    expectedMilestoneIndex: 0,
    expectedVault: vault
  });
  assert.deepEqual({ agreementIdHash: pair.agreementIdHash, buyer: pair.buyer, mint: pair.mint, escrow: pair.escrow, milestone: pair.milestone, vaultAuthority: pair.vaultAuthority }, { agreementIdHash: v2Intent.agreementIdHash, buyer, mint, escrow, milestone: milestonePda, vaultAuthority: milestonePda });
  assert.throws(() => decodeV2FundingAccounts({ agreementAccount: { address: escrow, owner: program, data: v2MultiEscrowAccountData() }, milestoneAccount: { address: milestonePda, owner: program, data: v2MilestoneAccountData(1) }, expectedProgramId: program, expectedMilestoneAddress: milestonePda, expectedMilestoneIndex: 0 }), /index/);
  assert.throws(() => decodeV2FundingAccounts({ agreementAccount: { address: escrow, owner: program, data: v2MultiEscrowAccountData() }, milestoneAccount: { address: milestonePda, owner: program, data: v2MilestoneAccountData(0, seller) }, expectedProgramId: program, expectedMilestoneAddress: milestonePda, expectedMilestoneIndex: 0 }), /owned/);
});

test('loads only a finalized program-owned base64 account', async () => {
  const validRpc = { async getAccountInfo() { return { context: { slot: 100 }, value: { executable: false, owner: program, data: v1EscrowAccountData() } }; }, async getGenesisHash() { return genesisHash; } };
  const loaded = await loadFinalizedAccount({ rpc: validRpc, address: escrow, expectedProgramId: program });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.value.data, v1EscrowAccountData());
  const tooOld = await loadFinalizedAccount({ rpc: validRpc, address: escrow, expectedProgramId: program, minContextSlot: 101 });
  assert.equal(tooOld.code, 'MALFORMED_ACCOUNT');
  const missing = await loadFinalizedAccount({ rpc: { async getAccountInfo() { return { value: null }; } }, address: escrow, expectedProgramId: program });
  assert.equal(missing.code, 'MISSING_ACCOUNT');
  const wrongOwner = await loadFinalizedAccount({ rpc: { async getAccountInfo() { return { value: { executable: false, owner: seller, data: v1EscrowAccountData() } }; } }, address: escrow, expectedProgramId: program });
  assert.equal(wrongOwner.code, 'MALFORMED_ACCOUNT');
  const executable = await loadFinalizedAccount({ rpc: { async getAccountInfo() { return { value: { executable: true, owner: program, data: v1EscrowAccountData() } }; } }, address: escrow, expectedProgramId: program });
  assert.equal(executable.code, 'MALFORMED_ACCOUNT');
  const invalidAddress = await loadFinalizedAccount({ rpc: { async getAccountInfo() { throw new Error('must not call RPC'); } }, address: 'not-an-address', expectedProgramId: program });
  assert.equal(invalidAddress.code, 'INVALID_RPC');
});

test('loads and decodes a finalized legacy SPL Token vault without trusting parsed balances', async () => {
  const optionsSeen = [];
  const rpc = { async getAccountInfo(observedAddress, options) {
    optionsSeen.push({ observedAddress, options });
    return { context: { slot: 100 }, value: { executable: false, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, data: tokenAccountData() } };
  } };
  const loaded = await loadFinalizedTokenAccount({ rpc, address: vault, expectedMint: mint, expectedAuthority: escrow, minContextSlot: 99 });
  assert.equal(loaded.ok, true);
  assert.deepEqual({ mint: loaded.value.mint, authority: loaded.value.authority, amount: loaded.value.amount, contextSlot: loaded.value.contextSlot }, { mint, authority: escrow, amount: '1030', contextSlot: 100 });
  assert.equal(optionsSeen[0].observedAddress, vault);
  assert.deepEqual(optionsSeen[0].options, { commitment: 'finalized', encoding: 'base64', minContextSlot: 99 });
  const wrongMint = await loadFinalizedTokenAccount({ rpc, address: vault, expectedMint: seller, expectedAuthority: escrow });
  assert.equal(wrongMint.code, 'MALFORMED_ACCOUNT');
  const wrongAuthority = await loadFinalizedTokenAccount({ rpc, address: vault, expectedMint: mint, expectedAuthority: seller });
  assert.equal(wrongAuthority.code, 'MALFORMED_ACCOUNT');
  const uninitialized = await loadFinalizedTokenAccount({ rpc: { async getAccountInfo() { return { context: { slot: 100 }, value: { executable: false, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, data: tokenAccountData({ state: 0 }) } }; } }, address: vault, expectedMint: mint, expectedAuthority: escrow });
  assert.equal(uninitialized.code, 'MALFORMED_ACCOUNT');
  const wrongOwner = await loadFinalizedTokenAccount({ rpc: { async getAccountInfo() { return { context: { slot: 100 }, value: { executable: false, owner: program, data: tokenAccountData() } }; } }, address: vault, expectedMint: mint, expectedAuthority: escrow });
  assert.equal(wrongOwner.code, 'MALFORMED_ACCOUNT');
  const wrongLength = await loadFinalizedTokenAccount({ rpc: { async getAccountInfo() { return { context: { slot: 100 }, value: { executable: false, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, data: [Buffer.alloc(164).toString('base64'), 'base64'] } }; } }, address: vault, expectedMint: mint, expectedAuthority: escrow });
  assert.equal(wrongLength.code, 'MALFORMED_ACCOUNT');
});

test('assembles a finalized V1 projection envelope with a common context lower bound', async () => {
  const deployment = { deploymentId: 'devnet-escrow-global', programId: program, mint, fixedFeeRecipient: fee };
  const calls = [];
  const rpc = {
    async getAccountInfo(observedAddress, options) {
      calls.push({ method: 'getAccountInfo', observedAddress, options });
      if (observedAddress === strictEscrow) return { context: { slot: 101 }, value: { executable: false, owner: program, data: v1EscrowAccountData({ accountVault: strictVault }) } };
      return { context: { slot: 103 }, value: { executable: false, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, data: tokenAccountData({ authority: strictEscrow }) } };
    }
  };
  const result = await loadFinalizedProjectionInput({ intent, rpc, deployment, agreementAddress: strictEscrow, vault: strictVault, transactionSlot: 100 });
  assert.equal(result.ok, true);
  assert.deepEqual({ kind: result.value.kind, slot: result.value.accounts.contextSlot, amount: result.value.vaultAmount, pda: result.value.pdaBindingsVerified }, { kind: 'v1', slot: 101, amount: '1030', pda: true });
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.options.commitment === 'finalized' && call.options.minContextSlot === 100), true);
  const badDeployment = await loadFinalizedProjectionInput({ intent, rpc, deployment: { ...deployment, programId: seller }, agreementAddress: strictEscrow, vault: strictVault, transactionSlot: 100 });
  assert.equal(badDeployment.code, 'MALFORMED_ACCOUNT');
});

test('strict Solana identity boundaries reject non-canonical public-key encodings', async () => {
  const malformed = `1${program}`;
  assert.throws(() => findProgramAddress([utf8('escrow')], malformed), /canonical base58/);
  const invalidAccount = await loadFinalizedAccount({ rpc: { async getAccountInfo() { throw new Error('must not call RPC'); } }, address: malformed, expectedProgramId: program });
  assert.equal(invalidAccount.code, 'INVALID_RPC');
});

test('assembles a finalized V2 parent/milestone projection envelope from one program snapshot', async () => {
  const deployment = { deploymentId: 'devnet-escrow-global-v2', programId: program, mint, fixedFeeRecipient: fee };
  const rpc = {
    async getMultipleAccounts(addresses, options) {
      assert.deepEqual(addresses, [strictV2Escrow, strictMilestone]);
      assert.deepEqual(options, { commitment: 'finalized', encoding: 'base64', minContextSlot: 200 });
      return { context: { slot: 202 }, value: [
        { executable: false, owner: program, data: v2MultiEscrowAccountData(strictV2Escrow) },
        { executable: false, owner: program, data: v2MilestoneAccountData(0, strictV2Escrow) }
      ] };
    },
    async getAccountInfo(address, options) {
      assert.equal(address, strictV2Vault);
      assert.deepEqual(options, { commitment: 'finalized', encoding: 'base64', minContextSlot: 200 });
      return { context: { slot: 203 }, value: { executable: false, owner: LEGACY_SPL_TOKEN_PROGRAM_ID, data: tokenAccountData({ authority: strictMilestone }) } };
    }
  };
  const result = await loadFinalizedProjectionInput({ intent: v2Intent, rpc, deployment, agreementAddress: strictV2Escrow, milestoneAddress: strictMilestone, vault: strictV2Vault, transactionSlot: 200 });
  assert.equal(result.ok, true);
  assert.deepEqual({ kind: result.value.kind, milestoneIndex: result.value.milestoneIndex, slot: result.value.accounts.contextSlot, amount: result.value.vaultAmount }, { kind: 'v2', milestoneIndex: 0, slot: 202, amount: '1030' });
});

test('loads V2 parent and milestone accounts from one finalized RPC snapshot', async () => {
  const optionsSeen = [];
  const loaded = await loadFinalizedAccounts({
    rpc: { async getMultipleAccounts(addresses, options) { optionsSeen.push({ addresses, options }); return { context: { slot: 100 }, value: [{ executable: false, owner: program, data: v2MultiEscrowAccountData() }, { executable: false, owner: program, data: v2MilestoneAccountData() }] }; } },
    addresses: [escrow, milestonePda],
    expectedProgramId: program,
    minContextSlot: 99
  });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.value.map(account => account.contextSlot), [100, 100]);
  assert.equal(optionsSeen[0].options.commitment, 'finalized');
  assert.equal(optionsSeen[0].options.minContextSlot, 99);
  const missing = await loadFinalizedAccounts({ rpc: { async getMultipleAccounts() { return { context: { slot: 100 }, value: [null, null] }; } }, addresses: [escrow, milestonePda], expectedProgramId: program });
  assert.equal(missing.code, 'MISSING_ACCOUNT');
});

test('requires the configured RPC endpoint to prove its cluster identity', async () => {
  const verified = await verifyRpcGenesisHash({ rpc: { async getGenesisHash() { return genesisHash; } }, expectedGenesisHash: genesisHash });
  assert.equal(verified.ok, true);
  const mismatch = await verifyRpcGenesisHash({ rpc: { async getGenesisHash() { return address(241); } }, expectedGenesisHash: genesisHash });
  assert.equal(mismatch.code, 'GENESIS_HASH_MISMATCH');
  const unavailable = await verifyRpcGenesisHash({ rpc: {}, expectedGenesisHash: genesisHash });
  assert.equal(unavailable.code, 'INVALID_RPC');
});

test('normalizes parsed finalized SPL funding and verifies the token-account owner', () => {
  const result = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-1'), transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(result.ok, true);
  assert.equal(result.value.transfers[0].source, buyerToken);
  assert.equal(result.value.transfers[0].sourceOwner, buyer);
  assert.equal(result.value.vaultDelta.delta, intent.total);
  const computeBudget = structuredClone(parsedTransaction());
  computeBudget.transaction.message.instructions.unshift({ programId: SOLANA_COMPUTE_BUDGET_PROGRAM_ID, data: '3' });
  const computeBudgetResult = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-compute-budget'), transaction: computeBudget, vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(computeBudgetResult.ok, true);
  const versioned = structuredClone(parsedTransaction());
  versioned.transaction.message.version = 0;
  versioned.transaction.message.accountKeys = versioned.transaction.message.accountKeys.filter(entry => entry.pubkey !== buyerToken);
  versioned.meta.loadedAddresses = { writable: [buyerToken], readonly: [] };
  versioned.meta.preTokenBalances[1].accountIndex = 6;
  versioned.meta.postTokenBalances[1].accountIndex = 6;
  const versionedResult = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-versioned'), transaction: versioned, vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(versionedResult.ok, true);
  assert.equal(versionedResult.value.transfers[0].sourceOwner, buyer);
  const bound = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-bound'), transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(bound.ok, true);
  const forgedBinding = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-forged-binding'), transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: () => ({ agreementIdHash: intent.agreementIdHash, buyer: seller }) });
  assert.equal(forgedBinding.code, 'MALFORMED_TRANSACTION');
  const forgedTerms = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-forged-terms'), transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: () => ({ ...decodedV1(), termsHash: 'b'.repeat(64) }) });
  assert.equal(forgedTerms.code, 'MALFORMED_TRANSACTION');
  const missingMint = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-missing-mint'), transaction: parsedTransaction(intent, { transaction: { message: { ...parsedTransaction().transaction.message, instructions: [parsedTransaction().transaction.message.instructions[0], { programId: LEGACY_SPL_TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: buyerToken, destination: vault, tokenAmount: { amount: intent.total } } } }] } } }), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(missingMint.code, 'MISSING_TRANSFER');
  const nestedCustody = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-nested-custody'), transaction: parsedTransaction(intent, { meta: { ...parsedTransaction().meta, innerInstructions: [{ index: 0, instructions: [{ programId: program, data: parsedTransaction().transaction.message.instructions[0].data, accounts: [] }] }] } }), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(nestedCustody.code, 'CUSTODY_INSTRUCTION_COUNT');
  const multipleTransfers = structuredClone(parsedTransaction());
  multipleTransfers.transaction.message.instructions.push({ programId: LEGACY_SPL_TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: buyerToken, destination: vault, mint, tokenAmount: { amount: '1' } } } });
  const multiple = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-multiple-transfers'), transaction: multipleTransfers, vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(multiple.code, 'TOKEN_TRANSFER_COUNT');
  const preloadedVault = structuredClone(parsedTransaction());
  preloadedVault.meta.preTokenBalances[0].uiTokenAmount.amount = '1';
  const preloaded = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-preloaded-vault'), transaction: preloadedVault, vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(preloaded.code, 'VAULT_NOT_EMPTY');
  const v2Observed = normalizeFinalizedFundingTransaction({ intent: v2Intent, signature: fixtureSignature('signature-v2'), transaction: parsedTransaction(v2Intent), vault, genesisHash, decodeAgreementIdHash: decodedV2 });
  assert.equal(reconcileFundingIntent(v2Intent, v2Observed.value, { operationId: 'fund:v2:1', vault, allowedMints: [mint] }).ok, true);
  const wrongV2Authority = normalizeFinalizedFundingTransaction({ intent: v2Intent, signature: fixtureSignature('signature-v2-wrong-authority'), transaction: parsedTransaction(v2Intent), vault, genesisHash, decodeAgreementIdHash: () => ({ ...decodedV2(), vaultAuthority: escrow }) });
  assert.equal(wrongV2Authority.code, 'MALFORMED_TRANSACTION');
  const missingRequestedSignature = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('not-in-transaction'), transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(missingRequestedSignature.code, 'MALFORMED_TRANSACTION');
  const malformedSignature = normalizeFinalizedFundingTransaction({ intent, signature: 'signature-not-canonical', transaction: parsedTransaction(), vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(malformedSignature.code, 'MALFORMED_TRANSACTION');
  const malformedSlot = normalizeFinalizedFundingTransaction({ intent, signature: fixtureSignature('signature-1'), transaction: { ...parsedTransaction(), slot: -1 }, vault, genesisHash, decodeAgreementIdHash: decodedV1 });
  assert.equal(malformedSlot.code, 'MALFORMED_TRANSACTION');
});

test('RPC worker gates finality, invokes the pure reconciler, and records only verified evidence', async () => {
  let recorded = null;
  let decodedAccount = null;
  const accountOptions = [];
  const rpc = {
    async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; },
    async getTransaction() { return parsedTransaction(); },
    async getAccountInfo(address, options) { accountOptions.push({ address, options }); return { context: { slot: 100 }, value: { executable: false, owner: program, data: v1EscrowAccountData() } }; }, async getGenesisHash() { return genesisHash; }
  };
  const result = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('signature-2'), operationId: 'fund:rpc:2', vault, agreementAddress: escrow, expectedGenesisHash: genesisHash, rpc, allowedMints: [mint], decodeAgreementIdHash: input => { decodedAccount = input.agreementAccount; return decodedV1(); }, record: value => { recorded = value; } });
  assert.equal(result.ok, true);
  assert.equal(result.value.amount, intent.total);
  assert.equal(result.value.genesisHash, genesisHash);
  assert.equal(result.value.slot, 100);
  assert.equal(recorded.operationId, 'fund:rpc:2');
  assert.equal(decodedAccount.address, escrow);
  assert.equal(decodedAccount.owner, program);
  assert.equal(accountOptions[0].options.commitment, 'finalized');
  assert.equal(accountOptions[0].options.minContextSlot, 100);
  const strictRpc = {
    async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; },
    async getTransaction() { return parsedTransaction(intent, {}, { escrow: strictEscrow, vault: strictVault }); },
    async getAccountInfo(address) { return { context: { slot: 100 }, value: { executable: false, owner: program, data: v1EscrowAccountData({ accountVault: strictVault }) } }; },
    async getGenesisHash() { return genesisHash; }
  };
  const defaultDecoder = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('signature-default-decoder'), operationId: 'fund:rpc:default-decoder', vault: strictVault, agreementAddress: strictEscrow, expectedGenesisHash: genesisHash, rpc: strictRpc, allowedMints: [mint], record: () => {} });
  assert.equal(defaultDecoder.ok, true);
  assert.equal(defaultDecoder.value.pdaBindingsVerified, true);
  const noRecorder = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('signature-no-recorder'), operationId: 'fund:rpc:no-recorder', vault, agreementAddress: escrow, expectedGenesisHash: genesisHash, rpc, allowedMints: [mint], decodeAgreementIdHash: decodedV1 });
  assert.equal(noRecorder.code, 'MALFORMED_TRANSACTION');

  const v2Rpc = {
    async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; },
    async getTransaction() { return parsedTransaction(v2Intent, {}, { escrow: strictV2Escrow, milestone: strictMilestone, vault: strictV2Vault }); },
    async getAccountInfo(address) {
      return { context: { slot: 100 }, value: { executable: false, owner: program, data: address === strictV2Escrow ? v2MultiEscrowAccountData() : v2MilestoneAccountData(0, strictV2Escrow) } };
    },
    async getMultipleAccounts() {
      return { context: { slot: 100 }, value: [{ executable: false, owner: program, data: v2MultiEscrowAccountData() }, { executable: false, owner: program, data: v2MilestoneAccountData(0, strictV2Escrow) }] };
    },
    async getGenesisHash() { return genesisHash; }
  };
  const defaultV2 = await reconcileFundingOnRpc({ intent: v2Intent, signature: fixtureSignature('signature-default-v2-decoder'), operationId: 'fund:rpc:default-v2-decoder', vault: strictV2Vault, agreementAddress: strictV2Escrow, milestoneAddress: strictMilestone, expectedGenesisHash: genesisHash, rpc: v2Rpc, allowedMints: [mint], record: () => {} });
  assert.equal(defaultV2.ok, true);
});

test('RPC worker rejects pending, failed, duplicate and unbound transactions', async () => {
  const baseRpc = { async getTransaction() { return parsedTransaction(); }, async getAccountInfo() { return { context: { slot: 100 }, value: { executable: false, owner: program, data: v1EscrowAccountData() } }; }, async getGenesisHash() { return genesisHash; } };
  const pending = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-pending'), operationId: 'fund:pending', vault, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'confirmed', err: null }] }; } }, decodeAgreementIdHash: () => intent.agreementIdHash });
  assert.equal(pending.code, 'NOT_FINALIZED');
  const failed = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-failed'), operationId: 'fund:failed', vault, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }] }; } }, decodeAgreementIdHash: () => intent.agreementIdHash });
  assert.equal(failed.code, 'SIGNATURE_FAILED');
  const duplicate = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-dup'), operationId: 'fund:dup', vault, allowedMints: [mint], seenOperationIds: ['fund:dup'], rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [] }; } }, decodeAgreementIdHash: () => intent.agreementIdHash });
  assert.equal(duplicate.code, 'DUPLICATE_OPERATION');
  const noProgram = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-no-program'), operationId: 'fund:no-program', vault, agreementAddress: escrow, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; }, async getTransaction() { return parsedTransaction(intent, { transaction: { message: { ...parsedTransaction().transaction.message, instructions: [{ programId: address(240), parsed: null }] } } }); } }, decodeAgreementIdHash: decodedV1 });
  assert.equal(noProgram.code, 'CUSTODY_INSTRUCTION_COUNT');
  const unexpectedProgram = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-extra-program'), operationId: 'fund:extra-program', vault, agreementAddress: escrow, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; }, async getTransaction() { return parsedTransaction(intent, { transaction: { message: { ...parsedTransaction().transaction.message, instructions: [{ programId: program, data: base58Encode(Uint8Array.from(Buffer.from(sha256Text('global:fund').slice(0, 16), 'hex'))), accounts: [buyer, escrow, mint, vault, buyerToken, LEGACY_SPL_TOKEN_PROGRAM_ID], parsed: null }, { programId: address(240), parsed: null }] } } }); } }, decodeAgreementIdHash: decodedV1 });
  assert.equal(unexpectedProgram.code, 'UNEXPECTED_PROGRAM');
  const wrongAction = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-wrong-action'), operationId: 'fund:wrong-action', vault, agreementAddress: escrow, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; }, async getTransaction() { return parsedTransaction(intent, { transaction: { message: { ...parsedTransaction().transaction.message, instructions: [{ programId: program, data: base58Encode(Uint8Array.from(Buffer.from(sha256Text('global:seller_accept').slice(0, 16), 'hex'))), accounts: [seller, escrow], parsed: null }, parsedTransaction().transaction.message.instructions[1]] } } }); } }, decodeAgreementIdHash: decodedV1 });
  assert.equal(wrongAction.code, 'MALFORMED_TRANSACTION');
  const missingOwner = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-missing-owner'), operationId: 'fund:missing-owner', vault, agreementAddress: escrow, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; }, async getTransaction() { return parsedTransaction(intent, { meta: { ...parsedTransaction().meta, preTokenBalances: [{ accountIndex: 1, mint, uiTokenAmount: { amount: '0' } }, { accountIndex: 2, mint, uiTokenAmount: { amount: intent.total } }], postTokenBalances: [{ accountIndex: 1, mint, uiTokenAmount: { amount: intent.total } }, { accountIndex: 2, mint, uiTokenAmount: { amount: intent.total } }] } }); } }, decodeAgreementIdHash: decodedV1 });
  assert.equal(missingOwner.code, 'MISSING_TRANSFER');
  const missingRole = await reconcileFundingOnRpc({ intent, signature: fixtureSignature('sig-missing-role'), operationId: 'fund:missing-role', vault, agreementAddress: escrow, allowedMints: [mint], expectedGenesisHash: genesisHash, rpc: { ...baseRpc, async getSignatureStatuses() { return { value: [{ confirmationStatus: 'finalized', err: null }] }; } }, decodeAgreementIdHash: () => ({ ...decodedV1(), feeRecipient: seller }) });
  assert.equal(missingRole.code, 'MALFORMED_TRANSACTION');
});
