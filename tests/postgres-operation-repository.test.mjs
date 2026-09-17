import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresOperationRepository, CAS_OPERATION_SQL } from '../src/custody/postgres-operation-repository.mjs';
import { base58Encode } from '../src/payments.mjs';

const key = bytes => Object.freeze({ toBytes: () => Uint8Array.from(bytes) });
const hash = 'ab'.repeat(32);
const recentBlockhash = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (index + 7) % 255));
const request = Object.freeze({
  protocol: 'escrow-global-external-signature-v1', operationId: 'op-pg', intentHash: hash,
  recentBlockhash, lastValidBlockHeight: 99, createdAtSlot: 7,
  operation: Object.freeze({ programId: key(new Uint8Array(32).fill(1)), feePayer: key(new Uint8Array(32).fill(2)), signers: Object.freeze([key(new Uint8Array(32).fill(2))]), instructions: Object.freeze([{ programId: key(new Uint8Array(32).fill(1)), data: Uint8Array.of(1, 2), accounts: Object.freeze([{ pubkey: key(new Uint8Array(32).fill(3)), isSigner: true, isWritable: true }]) }]) })
});
const attempt = Object.freeze({ operationId: 'op-pg', intentHash: hash, state: 'awaiting_signature', attempt: 1, signature: null, error: null, meta: {}, history: [{ state: 'draft', attempt: 1, at: 10, reason: 'created' }, { state: 'awaiting_signature', attempt: 1, at: 10, reason: 'prepared' }] });

function fakeDb() {
  const calls = [];
  let row = null;
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] }; },
    async transaction(fn) {
      const client = { query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO custody_operations')) {
          row = { operation_id: params[0], intent_hash_hex: hash, state: params[2], request: JSON.parse(params[3]), attempt: JSON.parse(params[4]), created_at: new Date(params[5]), updated_at: new Date(params[6]) };
          return { rowCount: 1, rows: [row] };
        }
        if (sql.includes('UPDATE custody_operations')) {
          const cas = sql.includes('state = $3');
          const expected = cas ? params[1] : params[4];
          const storedAttempt = typeof row.attempt === 'string' ? JSON.parse(row.attempt) : row.attempt;
          if (row.state !== expected || storedAttempt.attempt !== params[5]) return { rowCount: 0, rows: [] };
          row = { ...row, state: params[cas ? 2 : 1], attempt: JSON.parse(params[cas ? 3 : 2]), updated_at: new Date(params[cas ? 4 : 3]) };
          return { rowCount: 1, rows: [row] };
        }
        return { rowCount: 1, rows: [] };
      } };
      return fn(client);
    }
  };
}

test('PostgreSQL operation repository round-trips tagged keys and bytes', async () => {
  const db = fakeDb();
  const repo = createPostgresOperationRepository({ db });
  const record = { operationId: 'op-pg', intentHash: hash, state: 'prepared', request, attempt, createdAt: 10, updatedAt: 10 };
  await repo.createOperation(record);
  const loaded = await repo.getOperation('op-pg');
  assert.equal(loaded.operationId, 'op-pg');
  assert.equal(loaded.request.operation.programId.toBytes()[0], 1);
  assert.deepEqual([...loaded.request.operation.instructions[0].data], [1, 2]);
  assert.equal(loaded.attempt.state, 'awaiting_signature');
  assert.match(db.calls.find(call => call.sql.includes('SELECT operation_id'))?.sql || '', /SELECT operation_id/);
});

test('PostgreSQL operation repository uses a state and intent conditional CAS', async () => {
  const db = fakeDb();
  const repo = createPostgresOperationRepository({ db });
  await repo.createOperation({ operationId: 'op-pg', intentHash: hash, state: 'prepared', request, attempt, createdAt: 10, updatedAt: 10 });
  const claimedAttempt = { ...attempt, state: 'signed', signature: 'sig', history: [...attempt.history, { state: 'signed', attempt: 1, at: 11, reason: 'external-wallet-verified' }] };
  assert.equal(await repo.compareAndSetOperation('op-pg', 'prepared', { expectedAttempt: 1, state: 'relaying', attempt: claimedAttempt, updatedAt: 11 }), true);
  assert.match(CAS_OPERATION_SQL, /state = \$2/);
  assert.match(CAS_OPERATION_SQL, /intent_hash = \$7/);
});

test('PostgreSQL operation repository rejects stale non-CAS updates', async () => {
  const db = fakeDb();
  const repo = createPostgresOperationRepository({ db });
  await repo.createOperation({ operationId: 'op-pg', intentHash: hash, state: 'prepared', request, attempt, createdAt: 10, updatedAt: 10 });
  const claimedAttempt = { ...attempt, state: 'signed', signature: 'sig', history: [...attempt.history, { state: 'signed', attempt: 1, at: 11, reason: 'external-wallet-verified' }] };
  assert.equal(await repo.compareAndSetOperation('op-pg', 'prepared', { expectedAttempt: 1, state: 'relaying', attempt: claimedAttempt, updatedAt: 11 }), true);
  const staleAttempt = { ...claimedAttempt, state: 'submitted', history: [...claimedAttempt.history, { state: 'submitted', attempt: 1, at: 12, reason: 'rpc-accepted' }] };
  assert.equal(await repo.updateOperation('op-pg', { expectedState: 'prepared', expectedAttempt: 1, state: 'submitted', attempt: staleAttempt, updatedAt: 12 }), null);
  assert.equal((await repo.getOperation('op-pg')).state, 'relaying');
});

test('PostgreSQL operation repository rejects zero public-key bindings', async () => {
  const db = fakeDb();
  const repo = createPostgresOperationRepository({ db });
  const zeroRequest = { ...request, operation: { ...request.operation, programId: key(new Uint8Array(32)) } };
  await assert.rejects(() => repo.createOperation({ operationId: 'op-zero', intentHash: hash, state: 'prepared', request: zeroRequest, attempt: { ...attempt, operationId: 'op-zero' }, createdAt: 10, updatedAt: 10 }), /32 non-zero bytes/);
});
