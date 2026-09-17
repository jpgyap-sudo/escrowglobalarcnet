import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createPostgresCustodyEventRepository, FINALIZED_EVENT_ERRORS, FinalizedCustodyEventIndexer } from '../src/custody/finalized-event-indexer.mjs';
import { createAnchorEventDecoder } from '../src/custody/anchor-event-decoder.mjs';

const sig = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
const buyer = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const programId = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => index + 33));
const tx = (slot = 77, meta = { err: null }) => ({ slot, transaction: { signatures: [sig], message: { instructions: [{ programId: '11111111111111111111111111111111' }, { programId: programId, data: 'event' }] } }, meta });

function make({ status = { confirmationStatus: 'finalized', err: null }, transaction = tx(), decodeEvents, repository = null, entries = [{ signature: sig, slot: 77, err: null }] } = {}) {
  const calls = [];
  const stored = [];
  const rpc = {
    async getSignatureStatuses() { return { value: [status] }; },
    async getTransaction() { return transaction; },
    async getSignaturesForAddress(address, config) { calls.push({ address, config }); return entries; }
  };
  const repo = repository || { async withTransaction(work) { return work({ async insertChainEvent(event) { stored.push(event); return { inserted: true }; } }); } };
  const indexer = new FinalizedCustodyEventIndexer({ rpc, repository: repo, deploymentId: 'dep-1', network: 'devnet', programId, address: buyer, decodeEvents: decodeEvents || (async ({ signature, slot, programId }) => [{ network: 'devnet', signature, instructionIndex: 1, slot, programId, eventType: 'Funded', payload: { amount: '10' } }]) });
  return { indexer, calls, stored };
}

test('ingests only finalized successful custody events atomically and is replay-safe at repository boundary', async () => {
  const { indexer, stored } = make();
  const result = await indexer.ingestSignature(sig);
  assert.equal(result.ok, true);
  assert.equal(result.eventCount, 1);
  assert.equal(stored[0].programId, programId);
  assert.equal(stored[0].instructionIndex, 1);
  assert.equal(stored[0].payload.amount, '10');
});

test('rejects unsupported networks and decoder-supplied non-canonical timestamps', async () => {
  const validRpc = { getSignatureStatuses() {}, getTransaction() {}, getSignaturesForAddress() {} };
  const validRepository = { withTransaction() {} };
  assert.throws(() => new FinalizedCustodyEventIndexer({
    rpc: validRpc, repository: validRepository, deploymentId: 'dep-1', network: 'localnet', programId, address: buyer, decodeEvents() { return []; }
  }), /supported network/);
  const malformed = make({ decodeEvents: async ({ signature, slot, programId }) => [{
    network: 'devnet', signature, instructionIndex: 1, slot, programId, eventType: 'Funded', payload: {}, observedAt: 'yesterday'
  }] });
  assert.equal((await malformed.indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.MALFORMED_EVENT);
});

test('persists worker observation time instead of decoder-supplied event time', async () => {
  const stored = [];
  const { indexer } = make({
    decodeEvents: async ({ signature, slot, programId }) => [{ network: 'devnet', signature, instructionIndex: 1, slot, programId, eventType: 'Funded', payload: {}, observedAt: '2026-09-13T00:00:00.000Z' }],
    repository: { async withTransaction(work) { return work({ async insertChainEvent(event) { stored.push(event); return { inserted: true }; } }); } }
  });
  indexer.clock = () => new Date('2026-09-14T00:00:00.000Z');
  assert.equal((await indexer.ingestSignature(sig)).ok, true);
  assert.equal(stored[0].observedAt, '2026-09-14T00:00:00.000Z');
});

test('rejects non-finalized, failed, missing custody, and decoder binding violations', async () => {
  const wrongDeployment = make().indexer;
  assert.equal((await wrongDeployment.scanAndCommitCursor({ deploymentId: 'dep-2' })).code, FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION);
  assert.equal((await wrongDeployment.resume({ deploymentId: 'dep-2' })).code, FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION);
  assert.equal((await make({ status: { confirmationStatus: 'confirmed', err: null } }).indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.NOT_FINALIZED);
  assert.equal((await make({ status: { confirmationStatus: 'finalized', err: { InstructionError: [0, 'failed'] } } }).indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.FAILED_TRANSACTION);
  const noCustody = { ...tx(), transaction: { signatures: [sig], message: { instructions: [{ programId: '11111111111111111111111111111111' }] } } };
  assert.equal((await make({ transaction: noCustody }).indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION);
  const malformed = make({ decodeEvents: async ({ signature, slot }) => [{ network: 'devnet', signature, instructionIndex: 0, slot, programId, eventType: 'Funded', payload: {} }] });
  assert.equal((await malformed.indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.MALFORMED_EVENT);
});

test('scans finalized signature pages and emits a continuation cursor only for a full page', async () => {
  const { indexer, calls } = make();
  const result = await indexer.scan({ limit: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.exhausted, false);
  assert.equal(result.nextBeforeSignature, sig);
  assert.equal(calls[0].config.commitment, 'finalized');
  assert.equal(calls[0].config.limit, 1);
});

test('admits multiple finalized events from one custody instruction with distinct event positions', async () => {
  const { indexer, stored } = make({ decodeEvents: async ({ signature, slot, programId }) => [
    { network: 'devnet', signature, instructionIndex: 1, eventIndex: 0, slot, programId, eventType: 'MilestoneCreated', payload: {} },
    { network: 'devnet', signature, instructionIndex: 1, eventIndex: 1, slot, programId, eventType: 'MilestoneStateChanged', payload: {} }
  ] });
  const result = await indexer.ingestSignature(sig);
  assert.equal(result.ok, true);
  assert.deepEqual(stored.map(event => event.eventIndex), [0, 1]);
  const reordered = make({ decodeEvents: async ({ signature, slot, programId }) => [{ network: 'devnet', signature, instructionIndex: 1, eventIndex: 1, slot, programId, eventType: 'Funded', payload: {} }] });
  assert.equal((await reordered.indexer.ingestSignature(sig)).code, FINALIZED_EVENT_ERRORS.MALFORMED_EVENT);
});

test('does not advance a durable cursor after a page has a non-finalized candidate', async () => {
  const { indexer } = make({ status: { confirmationStatus: 'confirmed', err: null } });
  const result = await indexer.scanAndCommitCursor({ deploymentId: 'dep-1', limit: 1 });
  assert.equal(result.code, FINALIZED_EVENT_ERRORS.SCAN_PARTIAL_FAILURE);
});

test('commits the cursor only after the complete page is persisted', async () => {
  const cursors = [];
  const { indexer } = make({ repository: { async withTransaction(work) { return work({ async insertChainEvent() { return { inserted: true }; }, async saveCursor(cursor) { cursors.push(cursor); } }); } } });
  const result = await indexer.scanAndCommitCursor({ deploymentId: 'dep-1', limit: 1 });
  assert.equal(result.ok, true);
  assert.equal(cursors.length, 1);
  assert.equal(cursors[0].beforeSignature, sig);
  assert.equal(cursors[0].lastScannedSlot, 77);
  assert.equal(cursors[0].exhausted, false);
});

test('marks an exhausted signature page so a durable cursor does not restart from the newest signature', async () => {
  const cursors = [];
  const { indexer } = make({ entries: [], repository: { async withTransaction(work) { return work({ async saveCursor(cursor) { cursors.push(cursor); } }); } } });
  const result = await indexer.scanAndCommitCursor({ deploymentId: 'dep-1', limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.exhausted, true);
  assert.equal(result.cursor.exhausted, true);
  assert.equal(cursors[0].beforeSignature, null);
});

test('resume treats an exhausted durable cursor as terminal without rediscovering signatures', async () => {
  const { indexer, calls } = make({ repository: {
    async loadCursor() { return { network: 'devnet', deploymentId: 'dep-1', address: buyer, beforeSignature: null, lastScannedSlot: 77, exhausted: true, updatedAt: '2026-09-13T00:00:00.000Z' }; },
    async withTransaction() { throw new Error('must not scan or write an exhausted cursor'); }
  } });
  const result = await indexer.resume({ deploymentId: 'dep-1', limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.resumed, false);
  assert.equal(result.exhausted, true);
  assert.equal(calls.length, 0);
});

test('resume passes a non-exhausted cursor continuation to the next finalized page', async () => {
  const { indexer, calls } = make({ repository: {
    async loadCursor() { return { network: 'devnet', deploymentId: 'dep-1', address: buyer, beforeSignature: sig, lastScannedSlot: 77, exhausted: false, updatedAt: '2026-09-13T00:00:00.000Z' }; },
    async withTransaction(work) { return work({ async insertChainEvent() { return { inserted: true }; }, async saveCursor() {} }); }
  }, entries: [] });
  const result = await indexer.resume({ deploymentId: 'dep-1', limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.exhausted, true);
  assert.equal(calls[0].config.before, sig);
});

test('repository failure does not turn an uncommitted event into success', async () => {
  const { indexer } = make({ repository: { async withTransaction() { throw new Error('db down'); } } });
  const result = await indexer.ingestSignature(sig);
  assert.equal(result.code, FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR);
});

test('PostgreSQL repository uses parameterized append-only event and cursor statements inside the caller transaction', async () => {
  const calls = [];
  const db = {
    async query(text, params) { calls.push({ text, params }); return { rows: [{ inserted: true }] }; },
    async transaction(work) { return work({ query: db.query }); }
  };
  const repository = createPostgresCustodyEventRepository({ db, deploymentId: 'dep-1', network: 'devnet', programId });
  let result;
  await repository.withTransaction(async tx => {
    result = await tx.insertChainEvent({ deploymentId: 'dep-1', network: 'devnet', programId, signature: sig, instructionIndex: 1, eventIndex: 0, slot: 77, eventType: 'Funded', payload: { amount: '10' }, observedAt: '2026-09-13T00:00:00.000Z' });
    await tx.saveCursor({ network: 'devnet', deploymentId: 'dep-1', address: buyer, beforeSignature: sig, lastScannedSlot: 77, exhausted: false, updatedAt: '2026-09-13T00:00:00.000Z' });
  });
  assert.deepEqual(result, { inserted: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /ON CONFLICT \(deployment_id, network, program_id, signature, instruction_index, event_index\) DO NOTHING/);
  assert.equal(calls[0].params[0], 'dep-1');
  assert.deepEqual([...calls[0].params[2]], [...Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 33))]);
  assert.equal(calls[0].params[8], JSON.stringify({ amount: '10' }));
  assert.equal(calls[1].params[3], sig);
  assert.deepEqual([...calls[1].params[2]], [...Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1))]);
  assert.equal(calls[1].params[5], false);
});

test('PostgreSQL repository loads and validates an exhausted cursor without trusting an unbound address', async () => {
  const calls = [];
  const db = {
    async query(text, params) { calls.push({ text, params }); return { rows: [{ network: 'devnet', deployment_id: 'dep-1', address: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)), before_signature: null, last_scanned_slot: '77', exhausted: true, updated_at: '2026-09-13T00:00:00.000Z' }] }; },
    async transaction(work) { return work({ query: db.query }); }
  };
  const repository = createPostgresCustodyEventRepository({ db, deploymentId: 'dep-1', network: 'devnet', programId });
  const cursor = await repository.loadCursor({ network: 'devnet', deploymentId: 'dep-1', address: buyer });
  assert.equal(cursor.exhausted, true);
  assert.equal(cursor.beforeSignature, null);
  assert.equal(cursor.lastScannedSlot, 77);
  assert.match(calls[0].text, /WHERE network = \$1 AND deployment_id = \$2 AND address = \$3/);
  assert.deepEqual([...calls[0].params[2]], [...Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1))]);
});

test('PostgreSQL event repository rejects foreign or malformed direct event injection', async () => {
  const calls = [];
  const db = { async query(text, params) { calls.push({ text, params }); return { rows: [{ inserted: true }] }; }, async transaction(work) { return work({ query: db.query }); } };
  const repository = createPostgresCustodyEventRepository({ db, deploymentId: 'dep-1', network: 'devnet', programId });
  await assert.rejects(() => repository.withTransaction(tx => tx.insertChainEvent({ deploymentId: 'dep-2', network: 'devnet', programId: buyer, signature: sig, instructionIndex: 1, eventIndex: 0, slot: 77, eventType: 'Funded', payload: {}, observedAt: '2026-09-13T00:00:00.000Z' })), /not bound/);
  await assert.rejects(() => repository.withTransaction(tx => tx.saveCursor({ network: 'devnet', deploymentId: 'dep-2', address: buyer, beforeSignature: null, lastScannedSlot: null, exhausted: true, updatedAt: '2026-09-13T00:00:00.000Z' })), /not bound/);
  await assert.rejects(() => repository.loadCursor({ network: 'devnet', deploymentId: 'dep-2', address: buyer }), /Configured deployment/);
  assert.equal(calls.length, 0);
});

test('Anchor IDL decoder decodes declared Borsh payloads with instruction provenance', () => {
  const discriminator = [1, 2, 3, 4, 5, 6, 7, 8];
  const idl = { events: [{ name: 'AgreementFunded', discriminator }], types: [{ name: 'AgreementFunded', type: { kind: 'struct', fields: [{ name: 'escrow', type: 'pubkey' }, { name: 'amount', type: 'u64' }] } }] };
  const pubkeyBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 65);
  const escrow = base58Encode(pubkeyBytes);
  const encoded = Buffer.from(Uint8Array.from([...discriminator, ...pubkeyBytes, 10, 0, 0, 0, 0, 0, 0, 0])).toString('base64');
  const decoder = createAnchorEventDecoder({ idl, programId });
  const decoded = decoder({ network: 'devnet', signature: sig, slot: 77, transaction: { meta: { logMessages: [`Program ${programId} invoke [1]`, `Program data: ${encoded}`, `Program ${programId} success`] }, transaction: { message: { instructions: [{ programId }] } } } });
  assert.equal(decoded[0].instructionIndex, 0);
  assert.equal(decoded[0].eventType, 'AgreementFunded');
  assert.equal(decoded[0].payload.escrow, escrow);
  assert.equal(decoded[0].payload.amount, '10');
  assert.throws(() => decoder({ network: 'devnet', signature: sig, slot: 77, transaction: { meta: { logMessages: [`Program ${programId} invoke [1]`, `Program ${programId} invoke [2]`] }, transaction: { message: { instructions: [{ programId }] } } } }), /Nested custody/);
});
