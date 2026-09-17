import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFundingIntent, reconcileFundingBatch, LEGACY_SPL_TOKEN_PROGRAM_ID } from '../src/custody/reconciliation.mjs';
import { base58Encode } from '../src/payments.mjs';
import { createFundingIntent, finalizeIntent } from '../src/custody/intent.mjs';

const address = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = address(1), seller = address(33), arbiter = address(66), fee = address(99), program = address(132), mint = address(165), vault = address(198), genesisHash = address(240);
const observedSignature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
const secondObservedSignature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 65));
const intent = createFundingIntent({ id: 'reconcile-1', currentTermsHash: 'a'.repeat(64), termsVersion: 1, buyerWallet: buyer, sellerWallet: seller, arbiterWallet: arbiter, feeWallet: fee, acceptedAt: 1700000000000, fundedAt: null, cancelled: false, milestones: [{ id: 'm1', originalAmount: '1000', reserve: '0', held: '0', status: 'unfunded' }] }, { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash, fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, createdAt: 1700000000000 });
const observed = (overrides = {}) => ({ genesisHash, signature: observedSignature, status: 'finalized', network: intent.chain.network, programId: intent.chain.programId, agreementIdHash: intent.agreementIdHash, buyer, mint: intent.asset.mint, tokenProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID, vault, signers: [buyer], transfers: [{ source: buyer, destination: vault, mint: intent.asset.mint, tokenProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID, amount: intent.total }], vaultDelta: { vault, mint: intent.asset.mint, delta: intent.total }, ...overrides });

test('reconciles only an exact finalized single-milestone funding observation', () => {
  const result = reconcileFundingIntent(intent, observed(), { operationId: 'fund:1', vault, allowedMints: [mint] });
  assert.equal(result.ok, true);
  assert.equal(result.value.amount, '1030');
});

test('rejects pending, mismatched, duplicate and extra-transfer observations', () => {
  assert.equal(reconcileFundingIntent(intent, observed({ status: 'confirmed' }), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'NOT_FINALIZED');
  assert.equal(reconcileFundingIntent(intent, observed({ mint: address(230) }), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'MISMATCH');
  assert.equal(reconcileFundingIntent(intent, observed(), { operationId: 'fund:1', vault, allowedMints: [mint], seenOperationIds: ['fund:1'] }).code, 'DUPLICATE_OPERATION');
  assert.equal(reconcileFundingIntent(intent, observed({ extraTransfers: [{ amount: '1' }] }), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'EXTRA_TRANSFERS');
  assert.equal(reconcileFundingIntent(intent, observed({ programId: 'not-a-solana-address' }), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'INVALID_OBSERVED');
});

test('batch reconciliation adds only successful operation IDs', () => {
  const result = reconcileFundingBatch([{ intent, observed: observed(), bindings: { operationId: 'fund:1', vault } }, { intent, observed: observed({ signature: secondObservedSignature, status: 'processed' }), bindings: { operationId: 'fund:2', vault } }], { allowedMints: [mint] });
  assert.deepEqual(result.seenOperationIds, ['fund:1']);
  assert.equal(result.results[1].ok, false);
});

test('rejects non-canonical or unsupported-network observed evidence before matching transfers', () => {
  assert.equal(reconcileFundingIntent(intent, observed({ signature: 'sig' }), { operationId: 'fund:bad-signature', vault, allowedMints: [mint] }).code, 'INVALID_OBSERVED');
  assert.equal(reconcileFundingIntent(intent, observed({ network: 'ethereum' }), { operationId: 'fund:bad-network', vault, allowedMints: [mint] }).code, 'INVALID_OBSERVED');
});

test('rejects an intent whose hash is valid but whose economics or authorization policy is unsafe', () => {
  const badEconomics = finalizeIntent({ ...intent, milestones: [{ ...intent.milestones[0], reserve: '1' }] });
  assert.equal(reconcileFundingIntent(badEconomics, observed(), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'INVALID_INTENT');
  const badPolicy = finalizeIntent({ ...intent, authorization: { signer: seller, destinationPolicy: 'arbitrary' } });
  assert.equal(reconcileFundingIntent(badPolicy, observed(), { operationId: 'fund:1', vault, allowedMints: [mint] }).code, 'INVALID_INTENT');
  assert.equal(reconcileFundingIntent(intent, observed(), { operationId: 'fund:mint-not-admitted', vault, allowedMints: [address(230)] }).code, 'INVALID_INTENT');
});
