import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text } from '../src/agreement.mjs';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { createEscrowSdk, EscrowSdkError, ESCROW_ACTIONS, SPL_TOKEN_PROGRAM, SYSTEM_PROGRAM } from '../packages/escrow-sdk/index.mjs';
import { assertEscrowOperation } from '../packages/escrow-sdk/operation-boundary.mjs';
import fs from 'node:fs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = key(1), seller = key(34), arbiter = key(67), fee = key(100), mint = key(133), programId = key(166), genesisHash = key(199);
const hash = n => n.toString(16).padStart(2, '0').repeat(32);

class FakePublicKey {
  constructor(value) {
    this.raw = value instanceof Uint8Array ? Uint8Array.from(value) : base58Decode(value);
    if (this.raw.length !== 32) throw new Error('bad key');
  }
  toBytes() { return Uint8Array.from(this.raw); }
  toBase58() { return base58Encode(this.raw); }
  equals(other) { return this.raw.every((value, index) => value === other.raw[index]); }
  static findProgramAddressSync(seeds) {
    const material = Uint8Array.from(seeds.flatMap(value => [...value]));
    const digest = sha256Text(base58Encode(material));
    return [new FakePublicKey(Uint8Array.from(digest.match(/../g).map(pair => Number.parseInt(pair, 16)))), 254];
  }
}

const deps = { PublicKey: FakePublicKey, sha256Hex: sha256Text };
const sdk = createEscrowSdk({
  network: 'devnet',
  programId,
  genesisHash,
  idlAddress: programId,
  expectedProgramIds: { devnet: programId },
  allowedMints: { devnet: [mint] },
  tokenProgram: SPL_TOKEN_PROGRAM,
  fixedFeeRecipient: fee,
  systemProgram: SYSTEM_PROGRAM
}, deps);

const base = (overrides = {}) => ({
  buyer, seller, arbiter, feeRecipient: fee, mint,
  agreementIdHash: hash(7), termsHash: hash(8), principal: '450000000',
  fundingDeadline: 1700000100, deliveryDeadline: 1700000200, reviewDeadline: 1700000300,
  milestoneIndex: 0, timedRelease: false,
  buyerTokenAccount: key(201), sellerTokenAccount: key(202), feeTokenAccount: key(203),
  opener: buyer, openerTokenAccount: key(201),
  ...overrides
});

test('SDK config pins the IDL, network, mint, legacy token program and fixed fee recipient', () => {
  assert.equal(sdk.config.network, 'devnet');
  assert.throws(() => createEscrowSdk({ network: 'devnet', programId: SYSTEM_PROGRAM, genesisHash, allowedMints: [mint], fixedFeeRecipient: fee }, deps), /program ID/);
  assert.throws(() => createEscrowSdk({ network: 'devnet', programId, genesisHash, idlAddress: seller, allowedMints: [mint], fixedFeeRecipient: fee }, deps), error => error instanceof EscrowSdkError && error.code === 'PROGRAM_MISMATCH');
  assert.throws(() => createEscrowSdk({ network: 'devnet', programId, genesisHash, allowedMints: [mint], fixedFeeRecipient: fee, tokenProgram: key(220) }, deps), /legacy SPL/);
  assert.throws(() => sdk.initialize(base({ mint: seller })), error => error instanceof EscrowSdkError && error.code === 'MINT_NOT_ALLOWED');
});

test('V1 initialize and dispute specs derive canonical PDAs and exact Anchor bytes', () => {
  const configInit = sdk.initializeConfig({ authority: key(220), feeRecipient: fee });
  assert.equal(configInit.action, 'initialize_config');
  assert.equal(configInit.data.length, 8 + 32 + 32);
  assert.deepEqual([...configInit.data.slice(8, 40)], [...base58Decode(mint)]);
  assert.deepEqual([...configInit.data.slice(40, 72)], new Array(32).fill(0));
  assert.deepEqual(configInit.requiredSigners.map(value => value.toBase58()), [key(220), fee]);
  assert.equal(configInit.keys[2].pubkey.toBase58(), programId);
  assert.equal(configInit.keys[2].isWritable, false);
  assert.equal(configInit.keys[4].pubkey.toBase58(), sdk.deriveDeploymentConfig().address.toBase58());
  assert.equal(configInit.keys[4].isWritable, true);
  const init = sdk.initialize(base());
  assert.equal(init.action, 'initialize');
  assert.equal(init.data.length, 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1);
  assert.deepEqual(init.requiredSigners.map(value => value.toBase58()), [buyer, arbiter]);
  assert.equal(init.keys[0].isSigner, true);
  assert.equal(init.keys[2].isSigner, true);
  assert.equal(init.keys[3].isSigner, false);
  assert.equal(init.keys[0].isWritable, true);
  assert.equal(init.keys[5].isWritable, true);
  assert.equal(init.keys[6].isWritable, true);
  const dispute = sdk.openDispute(base());
  assert.deepEqual(dispute.requiredSigners.map(value => value.toBase58()), [buyer]);
  assert.equal(dispute.keys.length, 7);
  assert.equal(dispute.keys[4].isWritable, true);
  assert.equal(dispute.keys[5].isWritable, true);
  const first = dispute.data;
  first[0] ^= 255;
  assert.notEqual(first[0], dispute.data[0]);
  const cancel = sdk.cancelUnfunded(base());
  assert.equal(cancel.keys[0].isSigner, true);
  assert.equal(cancel.keys[0].isWritable, false);
});

test('V2 builders cover creation, funding, dispute, claims and bilateral refund without signing', () => {
  const init = sdk.initializeV2(base({ milestoneCount: 2 }));
  assert.equal(init.data.length, 8 + 32 + 32 + 2);
  const create = sdk.createMilestoneV2(base());
  assert.equal(create.action, 'create_milestone_v2');
  const fund = sdk.fundV2(base());
  assert.equal(fund.keys[1].isWritable, true);
  assert.equal(fund.keys[3].isWritable, true);
  const submit = sdk.submitV2(base({ deliveryHash: hash(9) }));
  assert.equal(submit.data.length, 8 + 32);
  const dispute = sdk.openDisputeV2(base());
  assert.equal(dispute.action, 'open_milestone_dispute_v2');
  const release = sdk.resolveV2(base({ outcome: 'release' }));
  assert.equal(release.action, 'arbiter_release_milestone_v2');
  const refund = sdk.bilateralRefundV2(base({ seller }));
  assert.deepEqual(refund.requiredSigners.map(value => value.toBase58()), [buyer, seller]);
  const claim = sdk.claimMilestoneSellerV2(base());
  assert.equal(claim.action, 'claim_milestone_seller_v2');
  const lateRefund = sdk.claimLateRefundV2(base());
  assert.equal(lateRefund.action, 'claim_milestone_late_refund_v2');
  assert.equal(lateRefund.keys[4].isWritable, true);
  const close = sdk.closeMilestoneV2(base());
  assert.equal(close.action, 'close_milestone_v2');
  const dust = sdk.sweepUnentitledDust(base());
  assert.equal(dust.action, 'sweep_unentitled_dust');
  assert.equal(dust.keys[0].isWritable, false);
  const prefundingDust = sdk.recoverPrefundingDust(base());
  assert.equal(prefundingDust.action, 'recover_prefunding_dust');
  const milestoneDust = sdk.sweepMilestoneUnentitledDust(base());
  assert.equal(milestoneDust.action, 'sweep_milestone_unentitled_dust');
  assert.equal(milestoneDust.keys[3].isWritable, false);
  const milestonePrefundingDust = sdk.recoverMilestonePrefundingDust(base());
  assert.equal(milestonePrefundingDust.action, 'recover_milestone_prefunding_dust');
  const amendment = sdk.amendTerms(base({ newTermsHash: hash(10) }));
  assert.deepEqual(amendment.requiredSigners.map(value => value.toBase58()), [buyer, seller]);
  assert.equal(amendment.keys[2].isWritable, true);
  const amendmentV2 = sdk.amendTermsV2(base({ newTermsHash: hash(11) }));
  assert.equal(amendmentV2.action, 'amend_terms_v2');
});

test('SDK rejects forged PDAs, duplicate roles and invalid hashes before producing a spec', () => {
  assert.throws(() => sdk.initialize(base({ escrow: seller })), error => error instanceof EscrowSdkError && error.code === 'PDA_MISMATCH');
  assert.throws(() => sdk.initialize(base({ seller: buyer })), error => error instanceof EscrowSdkError && error.code === 'INVALID_ROLES');
  assert.throws(() => sdk.initialize(base({ termsHash: '0'.repeat(64) })), error => error instanceof EscrowSdkError && error.code === 'INVALID_HASH');
  assert.throws(() => sdk.openDispute(base({ opener: arbiter })), error => error instanceof EscrowSdkError && error.code === 'UNAUTHORIZED_SIGNER');
  assert.throws(() => sdk.build(base({ action: 'not-a-real-action' })), error => error instanceof EscrowSdkError && error.code === 'UNSUPPORTED_ACTION');
  assert.throws(() => sdk.amendTerms(base({ newTermsHash: '0'.repeat(64) })), error => error instanceof EscrowSdkError && error.code === 'INVALID_HASH');
  assert.throws(() => sdk.initialize(base({ principal: Number.MAX_SAFE_INTEGER + 1 })), error => error instanceof EscrowSdkError && error.code === 'INVALID_INTEGER');
});

test('SDK covers every current Rust instruction and the operation boundary rejects forged specs', () => {
  const input = base({
    deliveryHash: hash(9),
    sellerAmount: '100000000',
    buyerPrincipalRefund: '100000000',
    proposalNonce: 1,
    expiresAt: 1700000400,
    proposer: buyer,
    approver: seller,
    cranker: arbiter,
    toSeller: true,
    outcome: 'release',
    milestoneCount: 2
  });
  const cases = [
    ['cancel_unfunded', input], ['execute_review_timeout', input], ['bilateral_refund', input],
    ['claim_late_refund', input], ['claim_seller', input], ['claim_fee', input],
    ['claim_buyer_refund', input], ['close_escrow', input], ['propose_common_ground', input],
    ['approve_common_ground', input], ['execute_common_ground', input],
    ['resolve_common_ground_remainder', input], ['close_common_ground_proposal', input],
    ['close_escrow_v2', input], ['sweep_unentitled_dust', input], ['recover_prefunding_dust', input], ['sweep_milestone_unentitled_dust', input], ['recover_milestone_prefunding_dust', input]
  ];
  for (const [action, values] of cases) assert.equal(sdk.build({ ...values, action }).action, action);

  const spec = sdk.initialize(input);
  const canonical = [sdk.config.programId, ...spec.keys.map(entry => entry.pubkey)];
  const writable = spec.keys.filter(entry => entry.isWritable).map(entry => entry.pubkey);
  const buyerKey = spec.keys[0].pubkey;
  const operation = assertEscrowOperation({
    instructions: [spec],
    programId: sdk.config.programId,
    feePayer: buyerKey,
    allowedSigners: [buyerKey, new FakePublicKey(arbiter)],
    canonicalAccounts: canonical,
    writableAccounts: writable,
    sha256Hex: sha256Text
  });
  assert.equal(operation.instructions[0].name, 'initialize');
  assert.deepEqual(operation.signers.map(value => value.toBase58()), [buyer, arbiter]);
  const forged = { ...spec, action: 'close_escrow', data: spec.data };
  assert.throws(() => assertEscrowOperation({
    instructions: [forged], programId: sdk.config.programId, feePayer: buyerKey, allowedSigners: [buyerKey],
    canonicalAccounts: canonical, writableAccounts: writable, sha256Hex: sha256Text
  }), error => error instanceof EscrowSdkError && error.code === 'INVALID_INSTRUCTION_DATA');
  const sellerKey = new FakePublicKey(seller);
  const badWritable = { ...spec, keys: spec.keys.map(entry => entry.isWritable ? { ...entry, pubkey: sellerKey } : entry) };
  assert.throws(() => assertEscrowOperation({
    instructions: [badWritable], programId: sdk.config.programId, feePayer: buyerKey, allowedSigners: [buyerKey],
    canonicalAccounts: [...canonical, sellerKey], writableAccounts: writable, sha256Hex: sha256Text
  }), error => error instanceof EscrowSdkError && error.code === 'WRITABLE_ACCOUNT_NOT_ALLOWED');
});

test('SDK action manifest matches every public Rust instruction name', () => {
  const rust = fs.readFileSync(new URL('../packages/custody-contracts/program/programs/escrow-global/src/lib.rs', import.meta.url), 'utf8');
  const rustActions = [...rust.matchAll(/pub fn ([a-z0-9_]+)\s*\(/g)].map(match => match[1]);
  assert.deepEqual([...ESCROW_ACTIONS].sort(), rustActions.sort());
});
