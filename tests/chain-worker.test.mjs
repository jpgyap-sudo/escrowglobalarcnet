import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { base58Encode } from '../src/payments.mjs';
import { OperationJournal } from '../src/operations/journal.mjs';
import { CHAIN_WORKER_STATES, CustodyChainWorker, classifyReconciliationResult } from '../src/custody/chain-worker.mjs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const signature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 7) % 255));

async function withJournal(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-chain-worker-'));
  try { return await fn(new OperationJournal(path.join(directory, 'operations.jsonl'))); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('chain-worker classifies pending, unknown, failed and invariant failures without blind retry', () => {
  assert.equal(classifyReconciliationResult({ ok: false, code: 'NOT_FINALIZED' }).state, CHAIN_WORKER_STATES.PENDING);
  assert.equal(classifyReconciliationResult({ ok: false, code: 'MISSING_TRANSACTION' }).state, CHAIN_WORKER_STATES.UNKNOWN);
  assert.equal(classifyReconciliationResult({ ok: false, code: 'SIGNATURE_FAILED' }).state, CHAIN_WORKER_STATES.FAILED);
  assert.equal(classifyReconciliationResult({ ok: false, code: 'MINT_MISMATCH' }).state, CHAIN_WORKER_STATES.REJECTED);
  assert.equal(classifyReconciliationResult({ ok: true, value: {} }).terminal, true);
});

test('chain-worker records finalized evidence once and replays it without querying again', async () => withJournal(async journal => {
  let calls = 0;
  const worker = new CustodyChainWorker({
    rpc: { getSignatureStatuses() {}, getTransaction() {} },
    journal,
    expectedGenesisHash: 'genesis',
    allowedMints: ['mint'],
    reconcile: async ({ record, operationId }) => {
      calls += 1;
      const value = { operationId, signature, status: 'finalized', intentHash: 'a'.repeat(64), vault: key(201), amount: '1030', genesisHash: key(199), pdaBindingsVerified: true };
      await record(value);
      return { ok: true, value };
    }
  });
  const first = await worker.reconcileFunding({ operationId: 'fund:1', intent: {}, signature, vault: key(201) });
  assert.equal(first.state, CHAIN_WORKER_STATES.VERIFIED);
  assert.equal(first.replayed, undefined);
  const second = await worker.reconcileFunding({ operationId: 'fund:1', intent: {}, signature, vault: key(201), record: () => { throw new Error('caller recorder must be ignored'); } });
  assert.equal(second.state, CHAIN_WORKER_STATES.VERIFIED);
  assert.equal(second.replayed, true);
  assert.equal(calls, 1);
}));

test('chain-worker rejects a successful result without cryptographic provenance bindings', async () => withJournal(async journal => {
  const worker = new CustodyChainWorker({
    rpc: { getSignatureStatuses() {}, getTransaction() {} },
    journal,
    reconcile: async () => ({ ok: true, value: { operationId: 'fund:unsafe', signature: 'sig', status: 'finalized', amount: '1030' } })
  });
  const result = await worker.reconcileFunding({ operationId: 'fund:unsafe' });
  assert.equal(result.state, CHAIN_WORKER_STATES.REJECTED);
  assert.equal(result.code, 'MALFORMED_EVIDENCE');
}));

test('chain-worker binds successful and replayed evidence to the requested transaction identity', async () => {
  const signature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 21) % 255));
  await withJournal(async journal => {
    const worker = new CustodyChainWorker({
      rpc: { getSignatureStatuses() {}, getTransaction() {} },
      journal,
      reconcile: async ({ operationId }) => ({ ok: true, value: { operationId, signature, status: 'finalized', intentHash: 'a'.repeat(64), vault: key(201), amount: '1030', genesisHash: key(199), pdaBindingsVerified: true } })
    });
    const mismatched = await worker.reconcileFunding({ operationId: 'fund:bound', signature: base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 22) % 255)), vault: key(201) });
    assert.equal(mismatched.code, 'MALFORMED_EVIDENCE');
  });
  await withJournal(async journal => {
    journal.findCustodyEvidence = () => ({ result: { operationId: 'fund:replay', signature: 'not-canonical', status: 'finalized', intentHash: 'a'.repeat(64), vault: key(201), amount: '1030', genesisHash: key(199), pdaBindingsVerified: true } });
    const worker = new CustodyChainWorker({ rpc: { getSignatureStatuses() {}, getTransaction() {} }, journal, reconcile: async () => { throw new Error('must not reconcile'); } });
    const malformed = await worker.reconcileFunding({ operationId: 'fund:replay', signature, vault: key(201) });
    assert.equal(malformed.code, 'MALFORMED_EVIDENCE');
  });
});

test('chain-worker turns reconciliation exceptions into safe unknown status', async () => withJournal(async journal => {
  const worker = new CustodyChainWorker({
    rpc: { getSignatureStatuses() {}, getTransaction() {} },
    journal,
    reconcile: async () => { throw Object.assign(new Error('provider timeout'), { code: 'TIMEOUT' }); }
  });
  const result = await worker.reconcileFunding({ operationId: 'fund:timeout' });
  assert.equal(result.state, CHAIN_WORKER_STATES.UNKNOWN);
  assert.equal(result.retryable, false);
  assert.equal(result.terminal, false);
  assert.equal(result.code, 'TIMEOUT');
}));
