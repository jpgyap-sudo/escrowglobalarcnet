import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransactionAttempt, transitionTransaction, retryTransaction,
  serializeTransactionAttempt, deserializeTransactionAttempt,
  TransactionLifecycleError
} from '../src/custody/transaction-lifecycle.mjs';

const hash = 'a'.repeat(64);
const make = () => createTransactionAttempt({ operationId: 'fund:deal-1', intentHash: hash, meta: { network: 'devnet' }, now: 100 });

test('transaction lifecycle requires the wallet signing step before submission and finality', () => {
  let tx = make();
  tx = transitionTransaction(tx, { to: 'awaiting_signature', now: 110 });
  assert.throws(() => transitionTransaction(tx, { to: 'signed', now: 120 }), error => error instanceof TransactionLifecycleError && error.code === 'INVALID_SIGNATURE');
  tx = transitionTransaction(tx, { to: 'signed', signature: 'sig-1', now: 120 });
  tx = transitionTransaction(tx, { to: 'submitted', now: 130 });
  tx = transitionTransaction(tx, { to: 'confirmed', now: 140 });
  tx = transitionTransaction(tx, { to: 'finalized', now: 150 });
  assert.equal(tx.signature, 'sig-1');
  assert.equal(tx.operationId, 'fund:deal-1');
  assert.equal(tx.intentHash, hash);
});

test('illegal transitions and terminal mutation are rejected', () => {
  const tx = make();
  assert.throws(() => transitionTransaction(tx, { to: 'submitted' }), /Illegal transition/);
  const failed = transitionTransaction(transitionTransaction(tx, { to: 'awaiting_signature' }), { to: 'failed', error: 'Wallet rejected' });
  assert.throws(() => transitionTransaction(failed, { to: 'signed', signature: 'sig' }), /Cannot transition/);
  assert.throws(() => transitionTransaction(failed, { to: 'draft' }), /Cannot transition/);
});

test('failed and expired attempts can be retried exactly through a new attempt number', () => {
  const failed = transitionTransaction(transitionTransaction(make(), { to: 'awaiting_signature' }), { to: 'failed', error: 'User cancelled', now: 120 });
  const retried = retryTransaction(failed, { now: 130 });
  assert.equal(retried.state, 'draft');
  assert.equal(retried.attempt, 2);
  assert.equal(retried.signature, null);
  assert.equal(retried.history.at(-1).attempt, 2);
  assert.throws(() => retryTransaction(retried), /Only failed or expired/);
});

test('ambiguous RPC outcomes enter an explicit unknown state and require reconciliation', () => {
  let tx = make();
  tx = transitionTransaction(tx, { to: 'awaiting_signature', now: 110 });
  tx = transitionTransaction(tx, { to: 'signed', signature: 'sig-unknown', now: 120 });
  tx = transitionTransaction(tx, { to: 'submitted', now: 130 });
  tx = transitionTransaction(tx, { to: 'unknown', reason: 'RPC timeout after submission', now: 140 });
  assert.equal(tx.state, 'unknown');
  assert.equal(tx.signature, 'sig-unknown');
  assert.throws(() => retryTransaction(tx, { now: 150 }), error => error.code === 'RETRY_NOT_ALLOWED');
  tx = transitionTransaction(tx, { to: 'confirmed', now: 160 });
  tx = transitionTransaction(tx, { to: 'finalized', now: 170 });
  assert.equal(tx.state, 'finalized');
});

test('unknown status cannot be forged without a reason or an existing signature', () => {
  let tx = make();
  tx = transitionTransaction(tx, { to: 'awaiting_signature', now: 110 });
  tx = transitionTransaction(tx, { to: 'signed', signature: 'sig-2', now: 120 });
  tx = transitionTransaction(tx, { to: 'submitted', now: 130 });
  assert.throws(() => transitionTransaction(tx, { to: 'unknown', now: 140 }), error => error.code === 'INVALID_REASON');
  const forgedUnknown = {
    ...make(),
    state: 'unknown',
    history: [
      { state: 'draft', attempt: 1, at: 100, reason: 'created' },
      { state: 'awaiting_signature', attempt: 1, at: 110, reason: null },
      { state: 'signed', attempt: 1, at: 120, reason: null },
      { state: 'submitted', attempt: 1, at: 130, reason: null },
      { state: 'unknown', attempt: 1, at: 140, reason: 'RPC timeout' }
    ]
  };
  assert.throws(() => deserializeTransactionAttempt(JSON.stringify(forgedUnknown)), error => error.code === 'INVALID_SIGNATURE');
});

test('durable validation replays the transition history instead of trusting the current state', () => {
  const tx = make();
  assert.throws(() => deserializeTransactionAttempt(JSON.stringify({
    ...tx,
    state: 'finalized',
    signature: 'forged-finalized-signature',
    history: [...tx.history, { state: 'finalized', attempt: 1, at: 110, reason: null }]
  })), error => error.code === 'INVALID_RECORD');
  assert.throws(() => deserializeTransactionAttempt(JSON.stringify({
    ...tx,
    state: 'failed',
    error: null,
    history: [...tx.history, { state: 'failed', attempt: 1, at: 110, reason: null }]
  })), error => error.code === 'INVALID_RECORD');
});

test('transaction lifecycle serializes and validates its durable shape', () => {
  const tx = transitionTransaction(make(), { to: 'cancelled', now: 101 });
  const decoded = deserializeTransactionAttempt(serializeTransactionAttempt(tx));
  assert.deepEqual(decoded, tx);
  assert.throws(() => deserializeTransactionAttempt(JSON.stringify({ ...tx, state: 'finalized' })), error => error.code === 'INVALID_RECORD');
  assert.throws(() => createTransactionAttempt({ operationId: 'bad id', intentHash: hash }), /operationId/);
  assert.throws(() => createTransactionAttempt({ operationId: 'x', intentHash: 'g'.repeat(64) }), /intentHash/);
});

test('transaction lifecycle rejects timestamp regression in transitions, retries and persisted history', () => {
  let tx = make();
  tx = transitionTransaction(tx, { to: 'awaiting_signature', now: 110 });
  assert.throws(() => transitionTransaction(tx, { to: 'signed', signature: 'sig-time', now: 109 }), error => error instanceof TransactionLifecycleError && error.code === 'TIME_ORDER');
  tx = transitionTransaction(tx, { to: 'signed', signature: 'sig-time', now: 120 });
  tx = transitionTransaction(tx, { to: 'failed', error: 'provider rejected', now: 130 });
  assert.throws(() => retryTransaction(tx, { now: 129 }), error => error instanceof TransactionLifecycleError && error.code === 'TIME_ORDER');
  const forged = { ...tx, history: [...tx.history.slice(0, -1), { ...tx.history.at(-1), at: 99 }] };
  assert.throws(() => deserializeTransactionAttempt(JSON.stringify(forged)), error => error instanceof TransactionLifecycleError && error.code === 'INVALID_RECORD');
});
