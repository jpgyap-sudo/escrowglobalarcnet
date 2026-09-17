import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOrderActions, deriveActionCenter } from '../src/action-center.mjs';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const order = (overrides = {}) => ({
  id: 'ord_action', buyerId: 'buyer', sellerId: 'seller', acceptedAt: NOW,
  fundedAt: NOW, snapshot: { acceptance: 'manual' },
  milestones: [{ id: 'm1', status: 'funded', dueAt: NOW + 7 * DAY, deliveries: [], reserve: '30' }],
  ...overrides
});

test('buyer receives a stable funding action only after seller acceptance', () => {
  const actions = deriveOrderActions({ ...order(), fundedAt: null }, { id: 'buyer', role: 'buyer' }, NOW);
  assert.deepEqual(actions.map(x => x.kind), ['fund_agreement']);
  assert.equal(actions[0].id, 'ord_action:order:buyer:fund_agreement');
});

test('seller receives acceptance and service delivery actions', () => {
  const pending = deriveOrderActions({ ...order(), acceptedAt: null, fundedAt: null }, { id: 'seller', role: 'seller' }, NOW);
  assert.deepEqual(pending.map(x => x.kind), ['accept_agreement']);
  const funded = deriveOrderActions(order(), { id: 'seller', role: 'seller' }, NOW);
  assert.deepEqual(funded.map(x => x.kind), ['submit_delivery']);
});

test('goods actions distinguish shipment, receipt and inspection', () => {
  const goods = { commerce: { quantity: 1 }, fulfillment: { shippedAt: null, receivedAt: null }, ...order() };
  assert.equal(deriveOrderActions(goods, { id: 'seller', role: 'seller' }, NOW)[0].kind, 'ship_goods');
  goods.fulfillment.shippedAt = NOW;
  assert.equal(deriveOrderActions(goods, { id: 'buyer', role: 'buyer' }, NOW)[0].kind, 'confirm_receipt');
  goods.fulfillment.receivedAt = NOW;
  assert.equal(deriveOrderActions(goods, { id: 'seller', role: 'seller' }, NOW)[0].kind, 'awaiting_buyer_review');
});

test('submitted delivery creates urgent buyer review and elapsed deadline action', () => {
  const submitted = { ...order(), snapshot: { acceptance: 'timed' }, milestones: [{ id: 'm1', status: 'submitted', reviewEndsAt: NOW - 1, deliveries: [] }] };
  const actions = deriveOrderActions(submitted, { id: 'buyer', role: 'buyer' }, NOW);
  assert.deepEqual(actions.map(x => x.kind), ['review_deadline_elapsed', 'review_delivery']);
  assert.ok(actions.every(x => x.severity === 'urgent'));
});

test('disputed milestones are isolated and reviewer sees restricted review', () => {
  const disputed = { ...order(), milestones: [{ id: 'm1', status: 'disputed', deliveries: [] }, { id: 'm2', status: 'funded', deliveries: [] }] };
  const buyer = deriveOrderActions(disputed, { id: 'buyer', role: 'buyer' }, NOW);
  assert.ok(buyer.some(x => x.kind === 'provide_dispute_evidence'));
  assert.ok(buyer.some(x => x.kind === 'awaiting_delivery'));
  assert.equal(deriveOrderActions(disputed, { id: 'reviewer', role: 'admin' }, NOW)[0].kind, 'review_dispute');
});

test('late refund is advisory and does not mutate the order', () => {
  const late = order({ milestones: [{ id: 'm1', status: 'funded', dueAt: NOW - 3 * DAY, deliveries: [] }] });
  const before = JSON.stringify(late);
  assert.equal(deriveOrderActions(late, { id: 'buyer', role: 'buyer' }, NOW).some(x => x.kind === 'late_refund_available'), true);
  assert.equal(JSON.stringify(late), before);
});

test('action center is deterministic, role-scoped and priority sorted', () => {
  const actions = deriveActionCenter([
    order({ id: 'b', milestones: [{ id: 'm', status: 'submitted', reviewEndsAt: NOW + 1 * DAY, deliveries: [] }] }),
    order({ id: 'a', milestones: [{ id: 'm', status: 'funded', dueAt: NOW + 1 * DAY, deliveries: [] }] })
  ], { id: 'buyer', role: 'buyer' }, NOW);
  assert.deepEqual(actions, deriveActionCenter(JSON.parse(JSON.stringify([
    order({ id: 'b', milestones: [{ id: 'm', status: 'submitted', reviewEndsAt: NOW + 1 * DAY, deliveries: [] }] }),
    order({ id: 'a', milestones: [{ id: 'm', status: 'funded', dueAt: NOW + 1 * DAY, deliveries: [] }] })
  ])), { id: 'buyer', role: 'buyer' }, NOW));
  assert.equal(actions[0].kind, 'review_delivery');
  assert.ok(actions.every(x => x.cta.route.startsWith('#/deal/')));
});
