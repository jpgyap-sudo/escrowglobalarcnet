import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { base58Encode } from '../src/payments.mjs';
import { createPayrollPayoutIntent } from '../src/payroll-custody-intent.mjs';
import { createMemoryPayrollIdempotencyStore, createPayrollPayoutWorker, runPayrollPayout } from '../src/payroll-payout-worker.mjs';
import { PayrollIdempotencySqliteStore } from '../src/payroll-idempotency-sqlite.mjs';
import { custodyReadiness } from '../src/custody/readiness.mjs';

const addr = n => base58Encode(Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 255));
const employer = addr(1), vault = addr(33), program = addr(65), genesis = addr(97), mint = addr(129), recipient = addr(161);
const now = Date.parse('2026-10-30T12:00:00Z');
const baseIntent = (overrides = {}) => createPayrollPayoutIntent({ id: 'worker-plan', status: 'approved', months: 1, lines: [{ staffId: 'staff-1', walletAddress: recipient, salary: '12.5' }], preview: { total: '12.5', commitment: '12.5' }, funding: { amount: '12.5', disbursed: '0', source: 'sandbox_budget' }, ...overrides }, { id: 'worker-run', planId: 'worker-plan', status: 'sandbox_recorded', periods: [{ period: '2026-10-30', dueAt: '2026-10-30T00:00:00.000Z', timezone: 'UTC', status: 'not_paid' }] }, '2026-10-30', { network: 'devnet', programId: program, expectedProgramIds: { devnet: program }, genesisHash: genesis, mint, allowedMints: { devnet: [mint] }, employerAddress: employer, vaultAddress: vault, now, allowSandbox: true, ...overrides.intentOptions });
const deps = (store, hooks = {}) => ({
  allowSandbox: true,
  signer: { sign: async request => { hooks.signed?.(request); return { signedPayloadRef: 'opaque-signed-ref' }; } },
  finality: { checkFinality: async query => { hooks.checked?.(query); return hooks.finality || { status: 'final', txRef: 'tx-worker-1' }; }, reconcile: async query => { hooks.reconciled?.(query); return hooks.reconcile || { status: 'match', observedTxRef: 'tx-worker-1' }; } },
  idempotency: store, now: () => now
});

test('worker construction rejects missing or broadcast-capable dependencies', () => {
  assert.throws(() => createPayrollPayoutWorker({}), /injected signer/);
  assert.throws(() => createPayrollPayoutWorker({ signer: { sign() {} }, idempotency: createMemoryPayrollIdempotencyStore() }), /finality/);
  assert.throws(() => createPayrollPayoutWorker({ signer: { sign() {} }, finality: { checkFinality() {}, reconcile() {} }, idempotency: { get() {}, putIfAbsent() {} } }), /atomic idempotency/);
  assert.throws(() => createPayrollPayoutWorker({ signer: { sign() {} }, finality: { checkFinality() {}, reconcile() {}, broadcast() {} }, idempotency: createMemoryPayrollIdempotencyStore() }), /must not expose broadcast/);
});

test('worker signs at most once, waits for finality, then reconciles and becomes duplicate-safe', async () => {
  const store = createMemoryPayrollIdempotencyStore(); let signCount = 0; let reconcileCount = 0;
  const worker = createPayrollPayoutWorker(deps(store, { signed: () => { signCount++; }, reconciled: () => { reconcileCount++; } }));
  const intent = baseIntent();
  const first = await runPayrollPayout(worker, intent);
  assert.equal(first.outcome, 'final'); assert.equal(first.txRef, 'tx-worker-1');
  const second = await runPayrollPayout(worker, intent);
  assert.equal(second.outcome, 'duplicate'); assert.equal(second.txRef, 'tx-worker-1');
  assert.equal(signCount, 1); assert.equal(reconcileCount, 1);
});

test('worker can use the durable sqlite idempotency adapter across process lifetimes', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'payroll-worker-sqlite-'));
  const file = path.join(dir, 'worker.sqlite');
  try {
    const store = new PayrollIdempotencySqliteStore({ file });
    const worker = createPayrollPayoutWorker(deps(store));
    const intent = baseIntent();
    assert.equal((await runPayrollPayout(worker, intent)).outcome, 'final');
    store.close();
    const reopened = new PayrollIdempotencySqliteStore({ file });
    const replayWorker = createPayrollPayoutWorker(deps(reopened));
    assert.equal((await runPayrollPayout(replayWorker, intent)).outcome, 'duplicate');
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('worker leaves pending finality/reconciliation states signed and never broadcasts', async () => {
  const store = createMemoryPayrollIdempotencyStore(); let reconciled = 0;
  const pendingWorker = createPayrollPayoutWorker(deps(store, { finality: { status: 'pending' }, reconciled: () => { reconciled++; } }));
  const intent = baseIntent();
  const pending = await runPayrollPayout(pendingWorker, intent);
  assert.deepEqual(pending.outcome, 'pending'); assert.equal(pending.reason, 'awaiting_finality'); assert.equal(reconciled, 0);
  const unknownWorker = createPayrollPayoutWorker(deps(store, { finality: { status: 'final', txRef: 'tx-worker-1' }, reconcile: { status: 'unknown' } }));
  const unknown = await runPayrollPayout(unknownWorker, intent);
  assert.equal(unknown.outcome, 'pending'); assert.equal(unknown.reason, 'reconciliation_unknown');
});

test('worker fails closed on signing, chain failure, mismatch and sandbox funding', async () => {
  const invalidDeps = createPayrollPayoutWorker({ ...deps(createMemoryPayrollIdempotencyStore()), signer: { sign: async () => { throw new Error('HSM unavailable'); } } });
  const failed = await runPayrollPayout(invalidDeps, baseIntent()); assert.equal(failed.outcome, 'failed'); assert.equal(failed.reason, 'signing_failed');
  const chainWorker = createPayrollPayoutWorker(deps(createMemoryPayrollIdempotencyStore(), { finality: { status: 'failed', txRef: 'tx-failed' } }));
  const chain = await runPayrollPayout(chainWorker, baseIntent()); assert.equal(chain.outcome, 'failed'); assert.equal(chain.reason, 'chain_failed');
  const mismatchWorker = createPayrollPayoutWorker(deps(createMemoryPayrollIdempotencyStore(), { reconcile: { status: 'mismatch', observedTxRef: 'tx-mismatch' } }));
  const mismatch = await runPayrollPayout(mismatchWorker, baseIntent()); assert.equal(mismatch.outcome, 'failed'); assert.equal(mismatch.reason, 'reconciliation_mismatch');
  const sandboxWorker = createPayrollPayoutWorker({ ...deps(createMemoryPayrollIdempotencyStore()), allowSandbox: false });
  const sandbox = await runPayrollPayout(sandboxWorker, baseIntent()); assert.equal(sandbox.outcome, 'rejected'); assert.equal(sandbox.reason, 'sandbox_or_unadmitted_funding');
});

test('worker requires every production readiness gate for payroll-vault funding', async () => {
  const vaultIntent = baseIntent({ funding: { amount: '12.5', disbursed: '0', source: 'payroll_vault' } });
  const blocked = await runPayrollPayout(createPayrollPayoutWorker(deps(createMemoryPayrollIdempotencyStore())), vaultIntent);
  assert.equal(blocked.outcome, 'rejected');
  assert.equal(blocked.reason, 'production_readiness_blocked');
  const ready = () => custodyReadiness({ program: true, audit: true, auth: true, rpc: true, reconciliation: true, payrollVault: true, payrollAuth: true, payrollLedger: true, payrollWorker: true, database: true, operations: true, legal: true, releaseApproved: true });
  const final = await runPayrollPayout(createPayrollPayoutWorker({ ...deps(createMemoryPayrollIdempotencyStore()), readiness: ready }), vaultIntent);
  assert.equal(final.outcome, 'final');
});

test('worker rejects idempotency payload conflicts, early periods and invalid intents', async () => {
  const store = createMemoryPayrollIdempotencyStore(); const worker = createPayrollPayoutWorker(deps(store));
  const first = baseIntent(); await runPayrollPayout(worker, first);
  const changed = baseIntent({ lines: [{ staffId: 'staff-1', walletAddress: recipient, salary: '11.5' }], preview: { total: '11.5', commitment: '11.5' }, funding: { amount: '11.5', disbursed: '0', source: 'sandbox_budget' } });
  // Keep the same batch identity while changing the approved economics.
  const conflict = { ...changed, batchId: first.batchId };
  assert.equal((await runPayrollPayout(worker, conflict)).reason, 'idempotency_conflict');
  const early = createPayrollPayoutWorker({ ...deps(createMemoryPayrollIdempotencyStore()), now: () => Date.parse('2026-10-29T12:00:00Z') });
  assert.equal((await runPayrollPayout(early, first)).reason, 'period_not_due');
  assert.equal((await runPayrollPayout(worker, { ...first, status: 'signed' })).reason, 'invalid_intent');
});

test('worker source has no broadcast or private-key capability', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'payroll-payout-worker.mjs'), 'utf8');
  assert.doesNotMatch(source, /import[^\n]+(?:rpc|broadcast)|privateKey|secretKey|broadcast\s*\(/i);
});
