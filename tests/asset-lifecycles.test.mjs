import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../src/universal-domain.mjs';
import { createEmptyState, totalFunds } from '../src/domain.mjs';
import { initializeTermsHash, verifyCurrentTermsHash } from '../src/agreement.mjs';
import { migrateState } from '../src/state-migrations.mjs';

const NOW = 1800000000000;
const scope = 'Deliver the exact approved specification and document all acceptance evidence.';
function goods(asset, fund = true) {
  let state = createEmptyState(NOW);
  const run = (actor, command, payload, now = NOW) => {
    const out = D.applyCommand(state, actor, command, payload, { now });
    state = out.state;
    return out.result;
  };
  const listingId = run('maya', 'create_product', {
    title: 'Asset-specific oak chair agreement', categoryId: 'furniture', description: scope,
    criteria: ['Material and dimensions match the approved specification'],
    prices: { USDC: '100', USDT: '100' }, shippingPrices: { USDC: '10', USDT: '10' },
    stock: 3, days: 7, inspectionDays: 3, warrantyDays: 14, holdbackBps: 1000,
    condition: 'New', returns: scope, specifications: scope, shippingRegion: 'Fictional delivery region'
  });
  run('reviewer', 'moderate_listing', { listingId, decision: 'published' });
  const id = run('buyer', 'purchase_product', {
    listingId, asset, quantity: 1, requirements: scope, deliveryReference: 'FICTIONAL QA',
    agreeInspection: true, agreeFees: true
  });
  const order = () => state.orders.find(o => o.id === id);
  const cmd = (actor, command, payload = {}, now = NOW) => run(actor, command, { orderId: id, expectedVersion: order().version, ...payload }, now);
  const ms = (actor, command, payload = {}, index = 0, now = NOW) => cmd(actor, command, { milestoneId: order().milestones[index].id, ...payload }, now);
  cmd('maya', 'accept_order');
  if (fund) cmd('buyer', 'fund_order');
  const shipAndReceive = () => {
    cmd('maya', 'ship_goods', { carrier: 'Demo', tracking: 'QA-123', evidence: scope });
    cmd('buyer', 'receive_goods', { acknowledge: true });
  };
  return { get state() { return state; }, order, cmd, ms, shipAndReceive };
}
function conserved(s, other) {
  D.assertInvariants(s);
  for (const a of D.ASSET_CODES) assert.equal(totalFunds(s, a), s.initialFundsByAsset[a]);
  for (const u of s.users) assert.equal(u.balances[other], D.units('25000'));
  assert.deepEqual(s.treasury.balances[other], { commission: '0', disputeFees: '0' });
}
for (const asset of D.ASSET_CODES) {
  const other = asset === 'USDC' ? 'USDT' : 'USDC';
  test(`${asset}: goods approval and warranty release never debit the other asset`, () => {
    const t = goods(asset); t.shipAndReceive(); t.ms('buyer', 'approve_delivery', { criteriaAccepted: true });
    assert.equal(t.order().milestones[1].held, D.units('11'));
    t.cmd('buyer', 'release_warranty', { acknowledge: true }, NOW + 15 * D.DAY);
    assert.equal(t.state.users.find(u => u.id === 'maya').balances[asset], D.units('25110'));
    assert.equal(t.state.treasury.balances[asset].commission, D.units('3.3'));
    assert.ok(t.order().events.every(e => e.asset === asset));
    conserved(t.state, other);
  });
  test(`${asset}: goods return refunds principal and reserve in the original asset`, () => {
    const t = goods(asset); t.shipAndReceive();
    t.cmd('buyer', 'request_return', { reason: scope });
    t.cmd('maya', 'authorize_return', { instructions: scope });
    t.cmd('buyer', 'send_return', { tracking: 'QA-RETURN', evidence: scope });
    t.cmd('maya', 'confirm_return', { condition: scope });
    t.cmd('maya', 'refund_return', { acknowledge: true });
    for (let i = 0; i < 2; i++) t.ms('buyer', 'accept_terms', { proposalId: t.order().milestones[i].proposal.id }, i);
    assert.equal(t.state.users.find(u => u.id === 'buyer').balances[asset], D.units('25000'));
    assert.equal(t.state.treasury.balances[asset].commission, '0');
    conserved(t.state, other);
  });
  test(`${asset}: late goods refund does not convert balances`, () => {
    const t = goods(asset);
    for (let i = 0; i < 2; i++) t.ms('buyer', 'claim_late_refund', {}, i, NOW + 60 * D.DAY);
    assert.equal(t.state.users.find(u => u.id === 'buyer').balances[asset], D.units('25000'));
    conserved(t.state, other);
  });
  test(`${asset}: high other-asset balance cannot fund an underfunded goods order`, () => {
    const t = goods(asset, false); const s = structuredClone(t.state);
    s.users.find(u => u.id === 'buyer').balances[asset] = '0';
    s.initialFundsByAsset[asset] = totalFunds(s, asset);
    D.assertInvariants(s); const before = JSON.stringify(s);
    assert.throws(() => D.applyCommand(s, 'buyer', 'fund_order', { orderId: t.order().id, expectedVersion: t.order().version }, { now: NOW }), /enough simulated credit/);
    assert.equal(JSON.stringify(s), before);
  });
  test(`${asset}: pre-agreed timed service release retains asset and precise event amount`, () => {
    let s = createEmptyState(NOW);
    const run = (actor, cmd, p, now = NOW) => { const out = D.applyCommand(s, actor, cmd, p, { now }); s = out.state; return out.result; };
    const id = run('buyer', 'create_order', { sellerId: 'maya', title: 'Precisely quoted timed agreement', amount: '1.000001', asset, scope, criteria: [scope], requirements: scope, days: 7, revisions: 1, acceptance: 'timed', milestones: false });
    const o = () => s.orders.find(x => x.id === id);
    const cmd = (actor, name, p = {}, now = NOW) => run(actor, name, { orderId: id, expectedVersion: o().version, ...p }, now);
    cmd('maya', 'accept_order'); cmd('buyer', 'fund_order');
    assert.match(o().events.at(-1).text, new RegExp(`1\\.030001 demo ${asset}`));
    cmd('maya', 'submit_delivery', { milestoneId: o().milestones[0].id, text: scope, evidence: scope });
    cmd('maya', 'execute_timeout', { milestoneId: o().milestones[0].id }, NOW + 4 * D.DAY);
    assert.equal(o().milestones[0].sellerPaid, D.units('1.000001')); conserved(s, other);
  });
}
test('Migration preserves pre-existing terms hashes, seals and event evidence', () => {
  const legacy = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-universal.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  for (const o of legacy.orders) initializeTermsHash(o);
  const before = structuredClone(legacy), migrated = migrateState(legacy);
  assert.deepEqual(legacy, before);
  for (let i = 0; i < legacy.orders.length; i++) {
    const { asset, ...rest } = migrated.orders[i];
    assert.equal(asset, 'USDC'); assert.deepEqual(rest, legacy.orders[i]);
    verifyCurrentTermsHash(migrated.orders[i]);
  }
  D.assertInvariants(migrated);
});
test('Money formatting retains significant micro precision without floating point', () => {
  assert.equal(D.money('1000001'), '1.000001');
  assert.equal(D.money('2000000'), '2.00');
  assert.equal(D.money('1033333'), '1.033333');
  assert.equal(D.money('10000000000000001'), '10,000,000,000.000001');
  assert.equal(D.money('1234567', 6), '1.234567');
  assert.equal(D.money('1234567', 0), '1');
});
