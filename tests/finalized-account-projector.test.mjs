import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinalizedAccountProjector } from '../src/custody/finalized-account-projector.mjs';

const evidence = (overrides = {}) => ({ finalized: true, pdaBindingsVerified: true, kind: 'v2', ...overrides });

test('requires a repository transaction boundary', () => {
  assert.throws(() => createFinalizedAccountProjector(), /persist\(\)/);
  assert.throws(() => createFinalizedAccountProjector({ repository: {} }), /persist\(\)/);
});

test('rejects unfinalized or unproven evidence before persistence', async () => {
  let calls = 0;
  const projector = createFinalizedAccountProjector({
    repository: { persist: async () => { calls += 1; return { agreementApplied: true, milestoneApplied: [true] }; } },
    project: () => ({ agreement: { protocol_version: 'v2' }, milestone: {} })
  });
  await assert.rejects(projector.projectAndPersist(evidence({ finalized: false })), /finalized/);
  await assert.rejects(projector.projectAndPersist(evidence({ pdaBindingsVerified: false })), /PDA/);
  assert.equal(calls, 0);
});

test('projects once and persists a V2 snapshot through one repository call', async () => {
  const calls = [];
  const projector = createFinalizedAccountProjector({
    repository: { persist: async (...args) => { calls.push(args); return { agreementApplied: true, milestoneApplied: [false] }; } },
    project: input => ({ agreement: { protocol_version: 'v2', source: input.kind }, milestone: { index: 0 } })
  });
  const result = await projector.projectAndPersist(evidence(), { observedAt: '2026-09-13T00:00:00.000Z' });
  assert.deepEqual(result, { agreementApplied: true, milestoneApplied: [false], applied: 1, stale: 1, complete: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].agreement.source, 'v2');
  assert.deepEqual(calls[0][1], { observedAt: '2026-09-13T00:00:00.000Z' });
});

test('reports complete V1 application and rejects malformed repository results', async () => {
  const projector = createFinalizedAccountProjector({
    repository: { persist: async () => ({ agreementApplied: true, milestoneApplied: [] }) },
    project: () => ({ agreement: { protocol_version: 'v1' }, milestones: [] })
  });
  assert.deepEqual(await projector.projectAndPersist(evidence({ kind: 'v1' })), { agreementApplied: true, milestoneApplied: [], applied: 1, stale: 0, complete: true });

  const malformed = createFinalizedAccountProjector({
    repository: { persist: async () => ({ agreementApplied: true }) },
    project: () => ({ agreement: { protocol_version: 'v1' }, milestones: [] })
  });
  await assert.rejects(malformed.projectAndPersist(evidence({ kind: 'v1' })), /invalid application result/);
});

test('does not accept a projector that changes the protocol shape', async () => {
  const projector = createFinalizedAccountProjector({
    repository: { persist: async () => ({ agreementApplied: true, milestoneApplied: [] }) },
    project: () => ({ agreement: { protocol_version: 'v3' }, milestones: [] })
  });
  await assert.rejects(projector.projectAndPersist(evidence({ kind: 'v1' })), /invalid protocol version/);
});
