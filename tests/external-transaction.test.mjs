import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text } from '../src/agreement.mjs';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { createEscrowSdk } from '../packages/escrow-sdk/index.mjs';
import {
  createExternalSigningRequest,
  ExternalTransactionError,
  verifyExternalSignedTransaction
} from '../packages/escrow-sdk/external-transaction.mjs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = key(1), seller = key(34), arbiter = key(67), fee = key(100), mint = key(133), programId = key(166), genesisHash = key(199);
const hash = n => n.toString(16).padStart(2, '0').repeat(32);
const recentBlockhash = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (index + 7) % 255));

class FakePublicKey {
  constructor(value) { this.raw = value instanceof Uint8Array ? Uint8Array.from(value) : base58Decode(value); }
  toBytes() { return Uint8Array.from(this.raw); }
  toBase58() { return base58Encode(this.raw); }
  static findProgramAddressSync(seeds) {
    const material = Uint8Array.from(seeds.flatMap(value => [...value]));
    const digest = sha256Text(base58Encode(material));
    return [new FakePublicKey(Uint8Array.from(digest.match(/../g).map(pair => Number.parseInt(pair, 16)))), 254];
  }
}

const pk = value => new FakePublicKey(value);
const buyerKey = pk(buyer), arbiterKey = pk(arbiter);
const sdk = createEscrowSdk({
  network: 'devnet', programId, genesisHash, idlAddress: programId,
  expectedProgramIds: { devnet: programId }, allowedMints: { devnet: [mint] },
  fixedFeeRecipient: fee
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
const request = createExternalSigningRequest({
  instructions: [spec], boundary, operationId: 'op-external-1', intentHash: hash(9),
  recentBlockhash, lastValidBlockHeight: 200, createdAtSlot: 100
});

function decoded(overrides = {}) {
  return {
    version: 'legacy', feePayer: buyerKey, recentBlockhash,
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

test('external wallet boundary accepts only an exact reviewed legacy transaction', () => {
  const accepted = verifyExternalSignedTransaction({
    request, serializedTransaction: Uint8Array.of(1, 2, 3),
    decode: () => decoded(), verifySignature: verify, currentBlockHeight: 150
  });
  assert.equal(accepted.operationId, 'op-external-1');
  assert.equal(accepted.signerCount, 2);
  assert.deepEqual([...accepted.serializedTransaction], [1, 2, 3]);
});

test('external wallet boundary rejects fee-payer, instruction, version and expiry changes', () => {
  const expectCode = (value, code) => assert.throws(() => verifyExternalSignedTransaction({
    request, serializedTransaction: Uint8Array.of(1), decode: () => value,
    verifySignature: verify, currentBlockHeight: 150
  }), error => error instanceof ExternalTransactionError && error.code === code);
  expectCode(decoded({ feePayer: pk(seller) }), 'FEE_PAYER_MISMATCH');
  expectCode(decoded({ instructions: [] }), 'MESSAGE_MISMATCH');
  expectCode(decoded({ version: 0 }), 'UNSUPPORTED_MESSAGE_VERSION');
  assert.throws(() => verifyExternalSignedTransaction({
    request, serializedTransaction: Uint8Array.of(1), decode: () => decoded(),
    verifySignature: verify, currentBlockHeight: 201
  }), error => error.code === 'BLOCKHASH_EXPIRED');
});

test('external wallet boundary rejects noncanonical recent blockhashes', () => {
  assert.throws(() => createExternalSigningRequest({
    instructions: [spec], boundary, operationId: 'op-bad-blockhash', intentHash: hash(10),
    recentBlockhash: 'recent-blockhash-1', lastValidBlockHeight: 200, createdAtSlot: 100
  }), error => error instanceof ExternalTransactionError && error.code === 'INVALID_BLOCKHASH');
  assert.throws(() => verifyExternalSignedTransaction({
    request, serializedTransaction: Uint8Array.of(1),
    decode: () => decoded({ recentBlockhash: 'recent-blockhash-1' }), verifySignature: verify, currentBlockHeight: 150
  }), error => error instanceof ExternalTransactionError && error.code === 'INVALID_BLOCKHASH');
});

test('external wallet boundary rejects nonce, missing/invalid signatures and oversized bytes', () => {
  const expectCode = (value, code) => assert.throws(() => verifyExternalSignedTransaction({
    request, serializedTransaction: Uint8Array.of(1), decode: () => value,
    verifySignature: verify, currentBlockHeight: 150
  }), error => error instanceof ExternalTransactionError && error.code === code);
  expectCode(decoded({ durableNonceAccount: buyerKey }), 'DURABLE_NONCE_UNSUPPORTED');
  expectCode(decoded({ signatures: [{ publicKey: buyerKey, signature: Uint8Array.of(1) }] }), 'SIGNATURE_SET_MISMATCH');
  expectCode(decoded({ signatures: [{ publicKey: buyerKey, signature: new Uint8Array(64).fill(9) }, { publicKey: arbiterKey, signature: new Uint8Array(64).fill(2) }] }), 'SIGNATURE_INVALID');
  expectCode(decoded({ signatures: [{ publicKey: buyerKey, signature: new Uint8Array(0) }, { publicKey: arbiterKey, signature: new Uint8Array(64).fill(2) }] }), 'SIGNATURE_INVALID');
  expectCode(decoded({ signatures: [{ publicKey: buyerKey, signature: new Uint8Array(63).fill(1) }, { publicKey: arbiterKey, signature: new Uint8Array(64).fill(2) }] }), 'SIGNATURE_INVALID');
  expectCode(decoded({ signatures: [{ publicKey: buyerKey, signature: new Uint8Array(65).fill(1) }, { publicKey: arbiterKey, signature: new Uint8Array(64).fill(2) }] }), 'SIGNATURE_INVALID');
  assert.throws(() => verifyExternalSignedTransaction({
    request, serializedTransaction: new Uint8Array(1233), decode: () => decoded(),
    verifySignature: verify, currentBlockHeight: 150
  }), error => error.code === 'TRANSACTION_TOO_LARGE');
});
