import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OperationJournal, canonicalJSON, sha256, stateHash } from '../src/operations/journal.mjs';

function withJournal(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-global-journal-'));
  const file = path.join(dir, 'events.jsonl');
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('operation journal canonicalizes objects independent of key order', () => {
  assert.equal(canonicalJSON({ b: 2, a: 1 }), canonicalJSON({ a: 1, b: 2 }));
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  assert.equal(stateHash({ version: 1, state: 'sandbox' }), stateHash({ state: 'sandbox', version: 1 }));
  assert.throws(() => canonicalJSON({ missing: undefined }), /JSON-safe/);
  assert.throws(() => canonicalJSON({ value: Number.NaN }), /finite/);
  assert.throws(() => canonicalJSON([, 1]), /sparse/);
});

test('operation journal appends a verifiable hash chain and returns newest rows first', () => withJournal(file => {
  const journal = new OperationJournal(file);
  journal.append({ kind: 'domain.command', command: 'create_agreement', stateVersion: 2, stateHash: 'abc' });
  journal.append({ kind: 'domain.command', command: 'fund_order', idempotencyKey: 'fund_12345678', stateVersion: 3, stateHash: 'def' });
  const health = journal.verify();
  assert.equal(health.valid, true);
  assert.equal(health.entries, 2);
  const rows = journal.rows(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].command, 'fund_order');
  assert.equal(rows[0].prevHash, rows[1].hash);
  const page = journal.page(1);
  assert.equal(page.rows[0].sequence, 2);
  assert.equal(page.hasMore, true);
  assert.equal(journal.page(1, page.nextCursor).rows[0].sequence, 1);
}));

test('operation journal detects tampering before accepting another append', () => withJournal(file => {
  const journal = new OperationJournal(file);
  journal.append({ kind: 'domain.command', command: 'create_agreement', stateVersion: 2, stateHash: 'abc' });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.command = 'refund_order';
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
  const health = journal.verify();
  assert.equal(health.valid, false);
  assert.throws(() => journal.append({ kind: 'domain.command' }), error => error.code === 'JOURNAL_CORRUPT');
}));

test('operation journal records verified custody evidence idempotently', () => withJournal(file => {
  const journal = new OperationJournal(file);
  const evidence = { operationId: 'fund:verified:1', signature: 'sig-1', amount: '1030' };
  const first = journal.appendIdempotentEvidence(evidence);
  const replay = journal.appendIdempotentEvidence({ amount: '1030', signature: 'sig-1', operationId: 'fund:verified:1' });
  assert.equal(first.hash, replay.hash);
  assert.equal(journal.verify().entries, 1);
  assert.throws(() => journal.appendIdempotentEvidence({ ...evidence, amount: '1031' }), error => error.code === 'JOURNAL_IDEMPOTENCY_CONFLICT');
  assert.throws(() => journal.appendIdempotentEvidence({ signature: 'missing-operation-id' }), /operationId/);
}));

test('operation journal rejects malformed records rather than silently skipping them', () => withJournal(file => {
  fs.writeFileSync(file, '{not-json}\n');
  const journal = new OperationJournal(file);
  const health = journal.verify();
  assert.equal(health.valid, false);
  assert.equal(health.code, 'JOURNAL_CORRUPT');
}));

test('operation journal fails closed when another process holds the mutation lock', () => withJournal(file => {
  const journal = new OperationJournal(file);
  fs.writeFileSync(journal.lockFile, 'held\n', { flag: 'wx', mode: 0o600 });
  assert.throws(() => journal.append({ kind: 'domain.command' }), error => error.code === 'JOURNAL_BUSY');
  fs.unlinkSync(journal.lockFile);
  assert.equal(journal.append({ kind: 'domain.command' }).sequence, 1);
}));
