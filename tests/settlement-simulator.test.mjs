import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlement } from '../src/settlement-simulator.mjs';

test('settlement simulator separates principal, reserve, payout and refund', () => {
  assert.deepEqual(calculateSettlement({ principal: 1000, releasePercent: 100 }), {
    principal: 1000, reserve: 30, totalFunded: 1030, releasePercent: 100,
    releasedPrincipal: 1000, sellerPayout: 1000, platformFee: 30,
    buyerRefund: 0, heldAfterSettlement: 0, feeBps: 300,
    boundary: 'education-only:no-wallet:no-ledger:no-live-custody'
  });
});

test('partial release charges only the released share and returns the rest', () => {
  const result = calculateSettlement({ principal: 1000, releasePercent: 50 });
  assert.equal(result.totalFunded, 1030);
  assert.equal(result.sellerPayout, 500);
  assert.equal(result.platformFee, 15);
  assert.equal(result.buyerRefund, 515);
  assert.equal(result.heldAfterSettlement, 0);
});

test('invalid simulator inputs are rejected', () => {
  assert.throws(() => calculateSettlement({ principal: 0 }), /Principal/);
  assert.throws(() => calculateSettlement({ principal: 100, releasePercent: 101 }), /percentage/);
  assert.throws(() => calculateSettlement({ principal: 100, feeBps: 10001 }), /basis points/);
});
