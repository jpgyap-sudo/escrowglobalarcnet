import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text } from '../src/agreement.mjs';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { createEscrowSdk } from '../packages/escrow-sdk/index.mjs';
import { ExternalWalletBoundaryError, ExternalWalletCustodyBoundary } from '../src/custody/external-wallet-boundary.mjs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = key(1), seller = key(34), arbiter = key(67), fee = key(100), mint = key(133), programId = key(166), genesisHash = key(199);
const hash = n => n.toString(16).padStart(2, '0').repeat(32);
const recentBlockhash = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (index + 7) % 255));
const transactionSignature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 11) % 255));

class FakePublicKey {
  constructor(value) { this.raw = value instanceof Uint8Array ? Uint8Array.from(value) : base58Decode(value); }
  toBytes() { return Uint8Array.from(this.raw); }
  toBase58() { return base58Encode(this.raw); }
  static findProgramAddressSync(seeds) {
    const digest = sha256Text(base58Encode(Uint8Array.from(seeds.flatMap(value => [...value]))));
    return [new FakePublicKey(Uint8Array.from(digest.match(/../g).map(pair => Number.parseInt(pair, 16)))), 254];
  }
}

const pk = value => new FakePublicKey(value);
const buyerKey = pk(buyer), arbiterKey = pk(arbiter);
const sdk = createEscrowSdk({
  network: 'devnet', programId, genesisHash, idlAddress: programId,
  expectedProgramIds: { devnet: programId }, allowedMints: { devnet: [mint] }, fixedFeeRecipient: fee
}, { PublicKey: FakePublicKey, sha256Hex: sha256Text });
const spec = sdk.initialize({
  buyer, seller, arbiter, feeRecipient: fee, mint,
  agreementIdHash: hash(7), termsHash: hash(8), principal: '450000000',
  fundingDeadline: 1700000100, deliveryDeadline: 1700000200, reviewDeadline: 1700000300,
  timedRelease: false
});
const boundary = {
  programId: pk(programId), feePayer: buyerKey,
  allowedSigners: [buyerKey, arbiterKey],
  canonicalAccounts: [pk(programId), ...spec.keys.map(entry => entry.pubkey)],
  writableAccounts: spec.keys.filter(entry => entry.isWritable).map(entry => entry.pubkey),
  sha256Hex: sha256Text
};

function decoded(overrides = {}) {
  return {
    version: 'legacy', transactionSignature, feePayer: buyerKey, recentBlockhash,
    instructions: [{
      programId: spec.programId, data: spec.data,
      accounts: spec.keys.map(entry => ({ pubkey: entry.pubkey, isSigner: entry.isSigner, isWritable: entry.isWritable }))
    }],
    signatures: [
      { publicKey: buyerKey, signature: new Uint8Array(64).fill(1) },
      { publicKey: arbiterKey, signature: new Uint8Array(64).fill(2) }
    ],
    messageBytes: Uint8Array.of(9, 8, 7),
    ...overrides
  };
}

const verify = (signature, publicKey) => signature[0] === (publicKey === buyerKey ? 1 : 2);
const readiness = Object.freeze({ mode: 'production', realFunds: true, ready: true, releaseApproved: true });

class MemoryOperationRepository {
  constructor() { this.operations = new Map(); }
  async getOperation(id) { return this.operations.get(id) || null; }
  async createOperation(record) { if (this.operations.has(record.operationId)) throw new Error('duplicate'); this.operations.set(record.operationId, record); }
  async updateOperation(id, patch) {
    const record = this.operations.get(id);
    if (!record || record.state !== patch.expectedState || record.attempt.attempt !== patch.expectedAttempt) return null;
    const { expectedState: _expectedState, expectedAttempt: _expectedAttempt, ...stored } = patch;
    const next = Object.freeze({ ...record, ...stored });
    this.operations.set(id, next);
    return next;
  }
  async compareAndSetOperation(id, expectedState, patch) {
    const record = this.operations.get(id);
    if (!record || record.state !== expectedState || record.attempt.attempt !== patch.expectedAttempt) return false;
    const { expectedAttempt: _expectedAttempt, ...stored } = patch;
    this.operations.set(id, Object.freeze({ ...record, ...stored }));
    return true;
  }
}

function rpc({ send = async () => transactionSignature, status = { confirmationStatus: 'confirmed', err: null } } = {}) {
  return {
    async getLatestBlockhash() { return { context: { slot: 44 }, value: { blockhash: recentBlockhash, lastValidBlockHeight: 200 } }; },
    async getBlockHeight() { return 150; },
    async getSignatureStatuses() { return { value: [typeof status === 'function' ? status() : status] }; },
    sendRawTransaction: send
  };
}

test('production boundary refuses sandbox readiness and missing durable operations', async () => {
  const repository = new MemoryOperationRepository();
  const blocked = new ExternalWalletCustodyBoundary({
    rpc: rpc(), repository, readiness: { mode: 'sandbox', realFunds: false, ready: false, releaseApproved: false },
    decode: decoded, verifySignature: verify, clock: () => 1
  });
  await assert.rejects(() => blocked.prepare({ operationId: 'op-blocked', intentHash: hash(9), instructions: [spec], boundary }), error => error instanceof ExternalWalletBoundaryError && error.code === 'RELEASE_BLOCKED');
  const live = new ExternalWalletCustodyBoundary({ rpc: rpc(), repository, readiness, decode: decoded, verifySignature: verify, clock: () => 1 });
  await assert.rejects(() => live.submit({ operationId: 'missing', serializedTransaction: Uint8Array.of(1) }), error => error.code === 'OPERATION_NOT_FOUND');
});

test('prepare is idempotent and submit verifies bytes before relaying', async () => {
  const repository = new MemoryOperationRepository();
  const calls = [];
  const boundaryAdapter = new ExternalWalletCustodyBoundary({
    rpc: rpc({ send: async (bytes, options) => { calls.push({ bytes: [...bytes], options }); return transactionSignature; } }),
    repository, readiness, decode: decoded, verifySignature: verify, clock: () => 10
  });
  const first = await boundaryAdapter.prepare({ operationId: 'op-prepare', intentHash: hash(9), instructions: [spec], boundary });
  const second = await boundaryAdapter.prepare({ operationId: 'op-prepare', intentHash: hash(9), instructions: [spec], boundary });
  assert.equal(first.request.recentBlockhash, recentBlockhash);
  assert.equal(second.attempt.state, 'awaiting_signature');
  const submitted = await boundaryAdapter.submit({ operationId: 'op-prepare', serializedTransaction: Uint8Array.of(1, 2, 3) });
  assert.equal(submitted.state, 'submitted');
  assert.deepEqual(calls, [{ bytes: [1, 2, 3], options: { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 } }]);
  const replay = await boundaryAdapter.submit({ operationId: 'op-prepare', serializedTransaction: Uint8Array.of(99) });
  assert.equal(replay.state, 'submitted');
});

test('ambiguous relay becomes unknown and requires reconciliation before retry', async () => {
  const repository = new MemoryOperationRepository();
  const boundaryAdapter = new ExternalWalletCustodyBoundary({
    rpc: rpc({ send: async () => { throw new Error('network timeout'); } }),
    repository, readiness, decode: decoded, verifySignature: verify, clock: () => 20
  });
  await boundaryAdapter.prepare({ operationId: 'op-unknown', intentHash: hash(10), instructions: [spec], boundary });
  await assert.rejects(() => boundaryAdapter.submit({ operationId: 'op-unknown', serializedTransaction: Uint8Array.of(4) }), error => error.code === 'SUBMISSION_UNKNOWN');
  await assert.rejects(() => boundaryAdapter.submit({ operationId: 'op-unknown', serializedTransaction: Uint8Array.of(4) }), error => error.code === 'RECONCILIATION_REQUIRED');
});

test('compare-and-set claims the relay slot so concurrent submitters cannot double-send', async () => {
  const repository = new MemoryOperationRepository();
  let resolveSend;
  let allowRelay;
  const sendStarted = new Promise(resolve => { resolveSend = resolve; });
  const allowSend = new Promise(resolve => { allowRelay = resolve; });
  let sends = 0;
  const boundaryAdapter = new ExternalWalletCustodyBoundary({
    rpc: rpc({ send: async () => { sends += 1; resolveSend(); await allowSend; return transactionSignature; } }),
    repository, readiness, decode: decoded, verifySignature: verify, clock: () => 25
  });
  await boundaryAdapter.prepare({ operationId: 'op-concurrent', intentHash: hash(12), instructions: [spec], boundary });
  const first = boundaryAdapter.submit({ operationId: 'op-concurrent', serializedTransaction: Uint8Array.of(6) });
  await sendStarted;
  await assert.rejects(() => boundaryAdapter.submit({ operationId: 'op-concurrent', serializedTransaction: Uint8Array.of(6) }), error => error.code === 'OPERATION_CONFLICT');
  allowRelay();
  assert.equal((await first).state, 'submitted');
  assert.equal(sends, 1);
});

test('relay boundary rejects non-canonical or wrong-length transaction signatures', async () => {
  for (const invalidSignature of [base58Encode(new Uint8Array(32)), `1${transactionSignature}`]) {
    const repository = new MemoryOperationRepository();
    const boundaryAdapter = new ExternalWalletCustodyBoundary({
      rpc: rpc(), repository, readiness, decode: () => decoded({ transactionSignature: invalidSignature }), verifySignature: verify, clock: () => 2
    });
    await boundaryAdapter.prepare({ operationId: `op-invalid-signature-${invalidSignature.length}`, intentHash: hash(14 + invalidSignature.length), instructions: [spec], boundary });
    await assert.rejects(() => boundaryAdapter.submit({ operationId: `op-invalid-signature-${invalidSignature.length}`, serializedTransaction: Uint8Array.of(1) }), error => error.code === 'SIGNATURE_REQUIRED');
  }
});

test('a newer reconciliation result cannot be clobbered by a late relay response', async () => {
  const repository = new MemoryOperationRepository();
  let resolveSendEntered;
  let releaseSend;
  const sendEntered = new Promise(resolve => {
    resolveSendEntered = resolve;
  });
  const sendRelease = new Promise(resolve => {
    releaseSend = resolve;
  });
  const boundaryAdapter = new ExternalWalletCustodyBoundary({
    rpc: rpc({
      status: { confirmationStatus: 'finalized', err: null },
      send: async () => {
        resolveSendEntered();
        await sendRelease;
        return transactionSignature;
      }
    }),
    repository, readiness, decode: decoded, verifySignature: verify, clock: () => 26
  });
  await boundaryAdapter.prepare({ operationId: 'op-reconcile-race', intentHash: hash(13), instructions: [spec], boundary });
  const submit = boundaryAdapter.submit({ operationId: 'op-reconcile-race', serializedTransaction: Uint8Array.of(7) });
  await sendEntered;
  const reconciled = await boundaryAdapter.reconcile('op-reconcile-race');
  assert.equal(reconciled.state, 'finalized');
  releaseSend();
  assert.equal((await submit).state, 'finalized');
  assert.equal((await repository.getOperation('op-reconcile-race')).state, 'finalized');
});

test('reconcile advances confirmed and finalized states from canonical RPC status', async () => {
  const repository = new MemoryOperationRepository();
  let status = { confirmationStatus: 'confirmed', err: null };
  const boundaryAdapter = new ExternalWalletCustodyBoundary({
    rpc: rpc({ status: () => status }), repository, readiness, decode: decoded, verifySignature: verify, clock: () => 30
  });
  await boundaryAdapter.prepare({ operationId: 'op-finality', intentHash: hash(11), instructions: [spec], boundary });
  await boundaryAdapter.submit({ operationId: 'op-finality', serializedTransaction: Uint8Array.of(5) });
  const confirmed = await boundaryAdapter.reconcile('op-finality');
  assert.equal(confirmed.state, 'confirmed');
  assert.equal((await boundaryAdapter.reconcile('op-finality')).state, 'confirmed');
  status = { confirmationStatus: 'finalized', err: null };
  const finalized = await boundaryAdapter.reconcile('op-finality');
  assert.equal(finalized.state, 'finalized');
});
