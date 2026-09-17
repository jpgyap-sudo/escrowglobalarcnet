import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDisputeCharge, deriveMilestoneReserve, quoteFunding } from '../../../packages/custody-contracts/reference-quote.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(fs.readFileSync(path.resolve(here, '../../../packages/custody-contracts/fixtures/economic-vectors.json'), 'utf8'));
const base = (overrides = {}) => ({
  agreementId: 'deal-test',
  termsHash: 'd'.repeat(64),
  termsVersion: 1,
  asset: 'USDC',
  status: 'accepted',
  acceptedAt: 1700000000000,
  fundedAt: null,
  cancelled: false,
  feeBps: 300,
  milestones: [{ id: 'm1', principal: '450000000' }],
  ...overrides
});

test('derives the corrected 450-token reserve independently from milestone state', () => {
  assert.equal(deriveMilestoneReserve('450000000'), '13500000');
  const quote = quoteFunding(base());
  assert.deepEqual(quote.milestones, [{ id: 'm1', principal: '450000000', reserve: '13500000' }]);
  assert.equal(quote.totalPrincipal, '450000000');
  assert.equal(quote.totalReserve, '13500000');
  assert.equal(quote.total, '463500000');
  assert.equal(quote.broadcastable, false);
  assert.equal(quote.authorizationVerified, false);
  assert.equal(quote.fundingVerified, false);
});

test('keeps USDT separate and applies the 3 percent policy', () => {
  const quote = quoteFunding(base({ asset: 'USDT', milestones: [{ id: 'm1', principal: '1000000000' }] }));
  assert.equal(quote.asset, 'USDT');
  assert.equal(quote.totalReserve, '30000000');
  assert.equal(quote.total, '1030000000');
});

test('quotes the separate five percent formal dispute charge', () => {
  assert.equal(deriveDisputeCharge('450000000'), '22500000');
  assert.throws(() => deriveDisputeCharge('19'), /at least one/);
});

test('rounds each milestone before summing the reserve', () => {
  const quote = quoteFunding(base({ milestones: [
    { id: 'm1', principal: '1' },
    { id: 'm2', principal: '333333' },
    { id: 'm3', principal: '100000000' }
  ] }));
  assert.deepEqual(quote.milestones.map(({ id, reserve }) => ({ id, reserve })), [
    { id: 'm1', reserve: '0' },
    { id: 'm2', reserve: '9999' },
    { id: 'm3', reserve: '3000000' }
  ]);
  assert.equal(quote.totalPrincipal, '100333334');
  assert.equal(quote.totalReserve, '3009999');
  assert.equal(quote.total, '103343333');
});

test('passes all independent positive economic vectors', () => {
  for (const vector of vectors.vectors) {
    const quote = quoteFunding(vector.input);
    assert.deepEqual({
      totalPrincipal: quote.totalPrincipal,
      totalReserve: quote.totalReserve,
      total: quote.total
    }, vector.expected, vector.id);
  }
});

test('rejects missing, malformed and non-lowercase terms commitments', () => {
  for (const termsHash of [undefined, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    assert.throws(() => quoteFunding(base({ termsHash })), /termsHash/);
  }
});

test('rejects unsupported state, asset, policy and funding status', () => {
  assert.throws(() => quoteFunding(base({ status: 'funded' })), /status/);
  assert.throws(() => quoteFunding(base({ asset: 'SOL' })), /asset/);
  assert.throws(() => quoteFunding(base({ feeBps: 500 })), /feeBps/);
  assert.throws(() => quoteFunding(base({ fundedAt: 1700000000001 })), /fundedAt/);
  assert.throws(() => quoteFunding(base({ cancelled: true })), /cancelled/);
  for (const acceptedAt of [null, 0, true, '1700000000000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => quoteFunding(base({ acceptedAt })), /acceptedAt/);
  }
});

test('rejects invalid milestone collections and integer formats', () => {
  for (const milestones of [[], null, [{ id: 'm1', principal: '0' }], [{ id: 'm1', principal: '-1' }], [{ id: 'm1', principal: '1.0' }], [{ id: 'm1', principal: '1e6' }], [{ id: 'm1', principal: '01' }], [{ id: 'm1', principal: 1 }]]) {
    assert.throws(() => quoteFunding(base({ milestones })), /milestones|principal/);
  }
  assert.throws(() => quoteFunding(base({ milestones: [{ id: 'm1', principal: '1' }, { id: 'm1', principal: '2' }] })), /unique/);
  assert.equal(quoteFunding(base({ agreementId: '  deal-test  ', milestones: [{ id: '  m1  ', principal: '1' }] })).agreementId, 'deal-test');
  assert.throws(() => quoteFunding(base({ agreementId: 'x'.repeat(161) })), /agreementId/);
  assert.throws(() => quoteFunding(base({ milestones: [{ id: 'x'.repeat(161), principal: '1' }] })), /id/);
});

test('rejects transaction-like and unknown fields rather than pretending to authorize them', () => {
  assert.throws(() => quoteFunding(base({ programId: 'not-a-program' })), /unsupported field/);
  assert.throws(() => quoteFunding(base({ transaction: 'base64' })), /unsupported field/);
  assert.throws(() => quoteFunding(base({ milestones: [{ id: 'm1', principal: '1', reserve: '999' }] })), /unsupported field/);
});

test('does not accept values above Solana token-unit bounds', () => {
  assert.throws(() => deriveMilestoneReserve('18446744073709551616'), /limit/);
  assert.throws(() => quoteFunding(base({ milestones: [{ id: 'm1', principal: '18446744073709551615' }, { id: 'm2', principal: '1' }] })), /limit/);
});
