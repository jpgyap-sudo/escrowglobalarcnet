import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalizedFundingProjector, FINALIZED_FUNDING_PROJECTION_ERRORS } from '../src/custody/finalized-funding-projector.mjs';
import { base58Encode } from '../src/payments.mjs';

const key = n => `key-${n}`;
const evidence = { signature: base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 11) % 255)), intentHash: 'a'.repeat(64), amount: '1030', status: 'finalized', pdaBindingsVerified: true, slot: 700, vault: key(3) };

test('requires a verified finalized funding envelope before loading accounts', async () => {
  let loaded = false;
  const projector = createFinalizedFundingProjector({ loadInput: async () => { loaded = true; return { ok: true, value: {} }; }, projectAndPersist: { async projectAndPersist() { return {}; } } });
  const result = await projector.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence: { ...evidence, status: 'confirmed' } });
  assert.equal(result.code, FINALIZED_FUNDING_PROJECTION_ERRORS.INVALID_EVIDENCE);
  assert.equal(loaded, false);
});

test('rejects a non-canonical transaction signature before loading accounts', async () => {
  let loaded = false;
  const projector = createFinalizedFundingProjector({ loadInput: async () => { loaded = true; return { ok: true, value: {} }; }, projectAndPersist: { async projectAndPersist() { return {}; } } });
  const result = await projector.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence: { ...evidence, signature: 'signature-1' } });
  assert.equal(result.code, FINALIZED_FUNDING_PROJECTION_ERRORS.INVALID_EVIDENCE);
  assert.equal(loaded, false);
});

test('passes the verified transaction slot to the finalized account loader', async () => {
  let request;
  const projector = createFinalizedFundingProjector({
    loadInput: async input => { request = input; return { ok: true, value: { kind: 'v1', vaultAmount: '1030' } }; },
    projectAndPersist: { async projectAndPersist(input, options) { return { input, options, complete: true }; } }
  });
  const result = await projector.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, deployment: { id: 'd' }, agreementAddress: key(1), vault: key(3), rpc: {}, evidence, persistOptions: { observedAt: '2026-09-13T00:00:00.000Z' } });
  assert.equal(result.ok, true);
  assert.equal(request.transactionSlot, 700);
  assert.equal(result.value.options.observedAt, '2026-09-13T00:00:00.000Z');
});

test('propagates a loader refusal without invoking persistence', async () => {
  let persisted = false;
  const projector = createFinalizedFundingProjector({ loadInput: async () => ({ ok: false, code: 'MISSING_ACCOUNT', message: 'missing' }), projectAndPersist: { async projectAndPersist() { persisted = true; } } });
  const result = await projector.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence });
  assert.deepEqual(result, { ok: false, code: 'MISSING_ACCOUNT', message: 'missing' });
  assert.equal(persisted, false);
});

test('returns repository projection results and converts thrown persistence errors', async () => {
  const good = createFinalizedFundingProjector({ loadInput: async () => ({ ok: true, value: { kind: 'v2', vaultAmount: '1030' } }), projectAndPersist: { async projectAndPersist() { return { complete: true }; } } });
  const result = await good.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence });
  assert.deepEqual(result, { ok: true, value: { complete: true } });
  const bad = createFinalizedFundingProjector({ loadInput: async () => ({ ok: true, value: { vaultAmount: '1030' } }), projectAndPersist: { async projectAndPersist() { throw new Error('db down'); } } });
  const failed = await bad.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence });
  assert.equal(failed.code, FINALIZED_FUNDING_PROJECTION_ERRORS.PROJECTION_FAILED);
  const mismatch = createFinalizedFundingProjector({ loadInput: async () => ({ ok: true, value: { vaultAmount: '1' } }), projectAndPersist: { async projectAndPersist() { throw new Error('must not persist'); } } });
  const mismatchResult = await mismatch.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence });
  assert.equal(mismatchResult.code, FINALIZED_FUNDING_PROJECTION_ERRORS.EVIDENCE_MISMATCH);
  const wrongIntent = await good.projectVerifiedFunding({ intent: { intentHash: 'b'.repeat(64) }, vault: key(3), evidence });
  assert.equal(wrongIntent.code, FINALIZED_FUNDING_PROJECTION_ERRORS.INVALID_EVIDENCE);
});

test('tolerates post-funding unsolicited vault dust without changing the verified amount', async () => {
  const good = createFinalizedFundingProjector({ loadInput: async () => ({ ok: true, value: { kind: 'v1', vaultAmount: '1031' } }), projectAndPersist: { async projectAndPersist(input) { return { projected: true, vaultAmount: input.vaultAmount }; } } });
  const result = await good.projectVerifiedFunding({ intent: { intentHash: evidence.intentHash }, vault: key(3), evidence });
  assert.deepEqual(result, { ok: true, value: { projected: true, vaultAmount: '1031' } });
});
