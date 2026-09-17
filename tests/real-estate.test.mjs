import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/domain.mjs';
import { applyCommand, assertInvariants, DAY, units } from '../src/universal-domain.mjs';

const NOW = 1800000000000;
const closingDate = new Date(NOW + 45 * DAY).toISOString().slice(0, 10);
const baseDeal = {
  sellerId: 'maya', title: 'Project Atlas earnest deposit', amount: '5000',
  scope: 'Hold the earnest deposit while the parties complete the recorded real-estate closing checklist.',
  criteria: ['Inspection review is completed or waived', 'Title and settlement review is completed', 'Closing statement is confirmed through known contacts'],
  requirements: 'Buyer and seller will use qualified local professionals for title, financing, appraisal, and closing.',
  days: 10, revisions: 0, acceptance: 'manual', workflow: 'real_estate', asset: 'USDC', milestoneSpecs: [],
  realEstate: {
    propertyReference: 'Project Atlas · Unit B12', transactionType: 'residential_purchase',
    purchasePrice: '25000', earnestDeposit: '5000', inspectionDays: 10,
    financingContingency: true, appraisalContingency: true, settlementContact: 'Demo title company',
    targetClosingDate: closingDate,
    closingConditions: ['Inspection review is completed or waived', 'Financing and appraisal conditions are resolved', 'Title and settlement review is completed']
  }
};

function setup() {
  let state = createEmptyState(NOW);
  const run = (actor, command, payload, now = NOW) => {
    const out = applyCommand(state, actor, command, payload, { now });
    state = out.state;
    return out.result;
  };
  const id = run('buyer', 'create_agreement', baseDeal);
  const order = () => state.orders.find(x => x.id === id);
  const cmd = (actor, command, payload = {}, now = NOW) => run(actor, command, { orderId: id, expectedVersion: order().version, ...payload }, now);
  return { get state() { return state; }, order, cmd };
}

test('creates an earnest-only real-estate agreement with an immutable closing checklist', () => {
  const t = setup();
  const o = t.order();
  assert.equal(o.workflow, 'real_estate');
  assert.equal(o.realEstate.earnestDeposit, units('5000'));
  assert.equal(o.realEstate.purchasePrice, units('25000'));
  assert.equal(o.milestones.length, 2);
  assert.equal(o.milestones[0].title, 'Earnest money & due diligence');
  assert.equal(o.milestones[1].title, 'Closing release');
  assert.equal(o.milestones.reduce((sum, m) => sum + BigInt(m.originalAmount), 0n), BigInt(units('5000')));
  assertInvariants(t.state);
});

test('real-estate funding follows the existing mutual acceptance gate', () => {
  const t = setup();
  assert.throws(() => t.cmd('buyer', 'fund_order'), /accept/);
  t.cmd('maya', 'accept_order');
  t.cmd('buyer', 'fund_order');
  assert.equal(t.order().milestones[0].held, units('2500'));
  assert.equal(t.order().milestones[1].held, units('2500'));
  assertInvariants(t.state);
});

test('rejects a deposit larger than the purchase price, bad date, unsafe address, and unsupported fields', () => {
  assert.throws(() => applyCommand(createEmptyState(NOW), 'buyer', 'create_agreement', {
    ...baseDeal, amount: '6000', realEstate: { ...baseDeal.realEstate, earnestDeposit: '6000', purchasePrice: '5000' }
  }), /no more than the purchase price/);
  assert.throws(() => applyCommand(createEmptyState(NOW), 'buyer', 'create_agreement', {
    ...baseDeal, realEstate: { ...baseDeal.realEstate, targetClosingDate: 'not-a-date' }
  }), /Target closing date/);
  assert.throws(() => applyCommand(createEmptyState(NOW), 'buyer', 'create_agreement', {
    ...baseDeal, realEstate: { ...baseDeal.realEstate, propertyReference: '123 Main Street, 90210' }
  }), /street address/);
  assert.throws(() => applyCommand(createEmptyState(NOW), 'buyer', 'create_agreement', {
    ...baseDeal, realEstate: { ...baseDeal.realEstate, untrusted: 'field' }
  }), /Unsupported field/);
});

test('real-estate metadata cannot be rewritten after creation', () => {
  const t = setup();
  const changed = structuredClone(t.state);
  changed.orders[0].realEstate.settlementContact = 'Attacker destination';
  assert.throws(() => assertInvariants(changed, t.state), /Immutable agreement changed/);
});
