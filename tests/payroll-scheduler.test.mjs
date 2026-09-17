import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState, applyCommand } from '../src/universal-domain.mjs';
import { executeDueAutopay } from '../src/payroll-scheduler.mjs';

function approvedPlan() {
  const start = Date.UTC(2026, 8, 13);
  let state = createSeedState(start);
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Payee', role: 'Ops', salary: '100', wallet: 'demo-payee' }, { now: start }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  let out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Autopay', budget: '100', mode: 'autopay', months: 2, startDate: '2026-09-30', timezone: 'UTC', staffIds: [staffId] }, { now: start });
  state = out.state; const planId = out.result;
  state = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '200' }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }, { now: start }).state;
  return { state, planId };
}

test('sandbox scheduler executes only due autopay periods and is replay-safe', () => {
  const { state, planId } = approvedPlan();
  const before = executeDueAutopay(state, Date.UTC(2026, 8, 29));
  assert.equal(before.executed.length, 0);
  const due = executeDueAutopay(state, Date.UTC(2026, 9, 1));
  assert.deepEqual(due.executed.map(item => item.period), ['2026-09-30']);
  assert.equal(due.state.payrollByUser.buyer.runs[0].periods[0].status, 'sandbox_recorded');
  const again = executeDueAutopay(due.state, Date.UTC(2026, 9, 1));
  assert.equal(again.executed.length, 0);
  assert.equal(again.state.payrollByUser.buyer.plans.find(plan => plan.id === planId).status, 'approved');
  const later = executeDueAutopay(again.state, Date.UTC(2026, 10, 1));
  assert.deepEqual(later.executed.map(item => item.period), ['2026-10-30']);
  assert.equal(later.state.payrollByUser.buyer.plans.find(plan => plan.id === planId).status, 'completed');
  assert.equal(later.state.payrollByUser.buyer.plans.find(plan => plan.id === planId).funding.disbursed, '200');
});

test('sandbox scheduler leaves manual plans and paused schedules untouched', () => {
  const { state } = approvedPlan();
  state.payrollByUser.buyer.plans[0].mode = 'manual';
  const manual = executeDueAutopay(state, Date.UTC(2026, 10, 1));
  assert.equal(manual.executed.length, 0);
  const paused = approvedPlan().state;
  paused.payrollByUser.buyer.plans[0].status = 'paused';
  paused.payrollByUser.buyer.runs[0].status = 'paused';
  paused.payrollByUser.buyer.runs[0].periods.forEach(period => { period.status = 'paused'; });
  const out = executeDueAutopay(paused, Date.UTC(2026, 10, 1));
  assert.equal(out.executed.length, 0);
});

test('scheduler fails closed for a non-sandbox state', () => {
  const { state } = approvedPlan();
  state.mode = 'production';
  const out = executeDueAutopay(state, Date.UTC(2026, 10, 1));
  assert.equal(out.executed.length, 0);
  assert.match(out.failures[0].error, /sandbox mode/);
});
