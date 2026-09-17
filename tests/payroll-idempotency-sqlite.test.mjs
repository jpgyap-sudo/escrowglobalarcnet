import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PayrollIdempotencySqliteStore } from '../src/payroll-idempotency-sqlite.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'payroll-idempotency-'));
  return { dir, file: join(dir, 'worker.sqlite') };
}
function record(overrides = {}) {
  return { intentHash: 'intent-hash-1', state: 'in_progress', signedPayloadRef: null, txRef: null, updatedAt: 100, ...overrides };
}

test('sqlite idempotency store persists records and performs compare-and-set updates', async () => {
  const f = fixture();
  try {
    const first = new PayrollIdempotencySqliteStore({ file: f.file });
    assert.equal(await first.get('batch-1'), null);
    assert.equal(await first.putIfAbsent('batch-1', record()), true);
    assert.equal(await first.putIfAbsent('batch-1', record({ intentHash: 'different' })), false);
    assert.deepEqual(await first.get('batch-1'), { key: 'batch-1', ...record() });
    assert.equal(await first.update('batch-1', 'in_progress', { state: 'signed', signedPayloadRef: 'opaque:signed', updatedAt: 101 }), true);
    assert.equal(await first.update('batch-1', 'in_progress', { state: 'final', updatedAt: 102 }), false);
    first.close();

    const second = new PayrollIdempotencySqliteStore({ file: f.file });
    assert.deepEqual(await second.get('batch-1'), { key: 'batch-1', ...record({ state: 'signed', signedPayloadRef: 'opaque:signed', updatedAt: 101 }) });
    second.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('sqlite idempotency store rejects malformed records and patches', async () => {
  const f = fixture();
  try {
    const store = new PayrollIdempotencySqliteStore({ file: f.file });
    await assert.rejects(store.putIfAbsent('bad key', record()), /key is invalid/i);
    await assert.rejects(store.putIfAbsent('batch-1', { ...record(), extra: true }), /unexpected payroll idempotency field/i);
    await assert.rejects(store.putIfAbsent('batch-1', record({ state: 'unknown' })), /state is invalid/i);
    await assert.rejects(store.update('batch-1', 'unknown', {}), /expected payroll idempotency state is invalid/i);
    store.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('sqlite idempotency store fails closed on an existing foreign database', () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.file);
    db.exec('CREATE TABLE unrelated(value TEXT)');
    db.close();
    assert.throws(() => new PayrollIdempotencySqliteStore({ file: f.file }), /schema mismatch/i);
    const check = new DatabaseSync(f.file);
    assert.equal(Object.values(check.prepare('PRAGMA journal_mode').get())[0], 'delete');
    check.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('sqlite idempotency store rejects use after close', async () => {
  const f = fixture();
  try {
    const store = new PayrollIdempotencySqliteStore({ file: f.file });
    store.close();
    await assert.rejects(store.get('batch-1'), /store is closed/i);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
