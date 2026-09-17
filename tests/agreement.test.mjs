import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJSON, agreementHash, termsHash, verifyCurrentTermsHash, sha256Text
} from '../src/agreement.mjs';
import { createHash, randomBytes } from 'node:crypto';
import {
  createEmptyState, applyCommand, assertInvariants
} from '../src/domain.mjs';

const NOW = 1_700_000_000_000;
const requirements = 'Use the supplied brief, include the agreed handover files, and document the acceptance test results.';

test('canonical terms serialization is key-order independent and Unicode normalized', () => {
  assert.equal(canonicalJSON({ b: 'ok', a: 'e\u0301' }), canonicalJSON({ a: 'é', b: 'ok' }));
  assert.equal(agreementHash({ a: 1, b: 2 }), agreementHash({ b: 2, a: 1 }));
});

test('pure-JS SHA-256 matches NIST boundary vectors and Node crypto', () => {
  const vectors = new Map([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['a'.repeat(55), '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    ['a'.repeat(64), 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb']
  ]);
  for (const [input, expected] of vectors) assert.equal(sha256Text(input), expected);
  for (let i = 0; i < 20; i++) {
    const input = randomBytes(256 + i).toString('base64');
    assert.equal(sha256Text(input), createHash('sha256').update(input).digest('hex'));
  }
});

test('canonicalization rejects ambiguous values and cycles', () => {
  assert.throws(() => canonicalJSON({ value: NaN }), /non-finite/);
  assert.throws(() => canonicalJSON({ value: 0.5 }), /safe integers/);
  assert.throws(() => canonicalJSON({ value: '\ud800' }), /surrogate/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJSON(cyclic), /circular/);
  assert.throws(() => canonicalJSON(new Date(0)), /plain objects/);
});

test('new agreements carry a verifiable current terms hash', () => {
  const state = createEmptyState(NOW);
  const out = applyCommand(state, 'buyer', 'create_order', {
    listingId: 'web', packageIndex: 0, requirements, acceptance: 'manual', milestones: false
  }, { now: NOW });
  const order = out.state.orders[0];
  assert.match(order.termsHash, /^[a-f0-9]{64}$/);
  assert.equal(order.termsHash, order.currentTermsHash);
  assert.equal(order.termsHash, termsHash(order));
  assert.equal(verifyCurrentTermsHash(order), true);
  assert.doesNotThrow(() => assertInvariants(out.state));
  const tampered = structuredClone(out.state);
  tampered.orders[0].snapshot.scope += ' silently changed';
  assert.throws(() => assertInvariants(tampered), /terms hash/);
});

test('bilateral amendments advance the current hash without replacing the original commitment', () => {
  let state = createEmptyState(NOW);
  const created = applyCommand(state, 'buyer', 'create_order', {
    listingId: 'web', packageIndex: 0, requirements, acceptance: 'manual', milestones: false
  }, { now: NOW });
  state = created.state;
  const id = created.result;
  const run = (actor, command, payload = {}, now = NOW) => {
    const order = state.orders.find(x => x.id === id);
    state = applyCommand(state, actor, command, { orderId: id, expectedVersion: order.version, ...payload }, { now }).state;
  };
  run('maya', 'accept_order');
  run('buyer', 'fund_order');
  const original = state.orders[0].termsHash;
  run('maya', 'propose_terms', {
    milestoneId: state.orders[0].milestones[0].id,
    kind: 'amend', amount: '100',
    scope: 'Deliver the revised website with the agreed handover package and acceptance evidence.', days: 9
  });
  const proposalId = state.orders[0].milestones[0].proposal.id;
  run('buyer', 'accept_terms', { milestoneId: state.orders[0].milestones[0].id, proposalId });
  const order = state.orders[0];
  assert.equal(order.termsHash, original);
  assert.notEqual(order.currentTermsHash, original);
  assert.equal(order.currentTermsHash, termsHash(order));
  assert.equal(order.termsHashHistory.length, 1);
  assert.equal(order.termsHashHistory[0].hash, original);
  assert.equal(order.termsHashHistory[0].nextHash, order.currentTermsHash);
  assert.doesNotThrow(() => assertInvariants(state));
  const tampered = structuredClone(state);
  tampered.orders[0].termsHash = '0'.repeat(64);
  assert.throws(() => assertInvariants(tampered), /terms hash/);
});
