import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState, applyCommand, assertInvariants } from '../src/universal-domain.mjs';
import { payrollSummary } from '../src/payroll-state.mjs';
import { base58Encode } from '../src/payments.mjs';

const payload = () => ({ name: 'October payroll', budget: '10000', months: 3, mode: 'autopay', startDate: '2026-10-30', timezone: 'Asia/Singapore' });
const walletAddress = base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (index + 7) % 255));

test('payroll summary reports exact budget reservation, disbursement and next payday', () => {
  let state = createSeedState();
  const add = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Summary payee', role: 'Ops', salary: '125.50', wallet: 'summary-wallet' });
  state = add.state;
  const plan = applyCommand(state, 'buyer', 'payroll_authorize_plan', { ...payload(), budget: '200', months: 3, staffIds: [add.result], acknowledge: true }).state;
  const before = payrollSummary(plan, 'buyer');
  assert.deepEqual(before, { activeStaff: 1, archivedStaff: 0, openPlans: 1, monthlyPayroll: '125.5', reserved: '376.5', disbursed: '0', remaining: '376.5', nextDueAt: '2026-10-30T01:00:00.000Z', nextPeriod: '2026-10-30', nextTimezone: 'Asia/Singapore', asset: 'USDC' });
  const run = plan.payrollByUser.buyer.runs[0];
  const after = applyCommand(plan, 'buyer', 'payroll_execute_period', { planId: run.planId, runId: run.id, period: '2026-10-30' }, { now: Date.UTC(2026, 9, 30, 12) }).state;
  const summary = payrollSummary(after, 'buyer');
  assert.equal(summary.disbursed, '125.5');
  assert.equal(summary.remaining, '251');
  assert.equal(summary.nextDueAt, '2026-11-30T01:00:00.000Z');
});

test('payroll roster stores format-checked payout addresses and snapshots them into plans', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Address holder', role: 'Ops', salary: '100', wallet: 'demo-label', walletAddress }).state;
  const person = state.payrollByUser.buyer.staff[0];
  assert.equal(person.walletAddress, walletAddress);
  const out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Address plan', budget: '100', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC', staffIds: [person.id] });
  state = out.state;
  assert.equal(state.payrollByUser.buyer.plans[0].lines[0].walletAddress, walletAddress);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_update_staff', { staffId: person.id, expectedRevision: 1, walletAddress: 'not-an-address' }), /valid Solana address/);
});

test('payroll staff and plans are actor scoped and persist through the domain state', () => {
  let state = createSeedState(Date.UTC(2026, 8, 13));
  let out = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Alex Morgan', role: 'Operations', salary: '2000', wallet: 'demo-wallet-alex' });
  state = out.state; const staffId = out.result;
  out = applyCommand(state, 'buyer', 'payroll_create_plan', payload());
  state = out.state; const planId = out.result;
  out = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }); state = out.state;
  out = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '6000' }); state = out.state;
  out = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }); state = out.state;
  out = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }); state = out.state;
  assert.equal(state.payrollByUser.buyer.staff[0].id, staffId);
  assert.equal(state.payrollByUser.buyer.plans[0].status, 'approved');
  assert.equal(state.payrollByUser.buyer.runs[0].periods.length, 3);
  assert.equal(state.payrollByUser.buyer.runs[0].periods[0].status, 'not_paid');
  assert.equal(state.payrollByUser.seller, undefined);
  assertInvariants(state);
});

test('payroll rejects over-budget plans, stale staff updates and invalid transitions', () => {
  let state = createSeedState();
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Extra', role: 'Ops', salary: '1', wallet: 'demo', destination: 'attacker' }), /Unsupported payroll field/);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Zero', role: 'Ops', salary: '0', wallet: 'demo-zero' }), /greater than zero/);
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Ari', role: 'Design', salary: '2000', wallet: 'demo-a' }).state;
  const staff = state.payrollByUser.buyer.staff[0];
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_update_staff', { staffId: staff.id, salary: '2500', expectedRevision: 99 }), /changed/);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Too small', budget: '100', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC' }), /exceed/);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_update_staff', { staffId: state.payrollByUser.buyer.staff[0].id, salary: '0', expectedRevision: 1 }), /greater than zero/);
});

test('payroll archive preserves staff history and blocks future new plans from using it', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Bea', role: 'Support', salary: '500', wallet: 'demo-b' }).state;
  const staff = state.payrollByUser.buyer.staff[0];
  state = applyCommand(state, 'buyer', 'payroll_archive_staff', { staffId: staff.id, expectedRevision: 1 }).state;
  assert.equal(state.payrollByUser.buyer.staff[0].status, 'archived');
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Empty', budget: '500', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC' }), /active staff/);
});

test('payroll plan snapshots only the explicitly selected active staff', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Ari', role: 'Design', salary: '1000', wallet: 'demo-a' }).state;
  const first = state.payrollByUser.buyer.staff[0].id;
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Bo', role: 'Support', salary: '2000', wallet: 'demo-b' }).state;
  const second = state.payrollByUser.buyer.staff[1].id;
  state = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Selected only', budget: '1500', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC', staffIds: [first] }).state;
  assert.deepEqual(state.payrollByUser.buyer.plans[0].lines.map(line => line.staffId), [first]);
  assert.notEqual(first, second);
});

test('payroll prevents a staff member from being attached to overlapping open plans', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Overlap', role: 'Ops', salary: '100', wallet: 'demo-overlap' }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  state = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'First plan', budget: '100', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC', staffIds: [staffId] }).state;
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Duplicate plan', budget: '100', months: 1, mode: 'manual', startDate: '2026-11-01', timezone: 'UTC', staffIds: [staffId] }), /open payroll plan/);
  const firstPlanId = state.payrollByUser.buyer.plans[0].id;
  state = applyCommand(state, 'buyer', 'payroll_cancel_plan', { planId: firstPlanId }).state;
  assert.doesNotThrow(() => applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'After cancellation', budget: '100', months: 1, mode: 'manual', startDate: '2026-11-01', timezone: 'UTC', staffIds: [staffId] }));
});

test('payroll plan cannot attach another actor staff record', () => {
  let state = createSeedState();
  state = applyCommand(state, 'maya', 'payroll_add_staff', { name: 'Seller staff', role: 'Ops', salary: '100', wallet: 'demo-seller' }).state;
  const foreignId = state.payrollByUser.maya.staff[0].id;
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Buyer staff', role: 'Ops', salary: '100', wallet: 'demo-buyer' }).state;
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Foreign', budget: '100', months: 1, mode: 'manual', startDate: '2026-10-01', timezone: 'UTC', staffIds: [foreignId] }), /not found/);
});

test('approved payroll executes each due period once and snapshots wallets', () => {
  const start = Date.UTC(2026, 8, 13);
  let state = createSeedState(start);
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Payee', role: 'Ops', salary: '125.50', wallet: 'wallet-v1' }, { now: start }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  let out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'October', budget: '125.50', months: 1, mode: 'autopay', startDate: '2026-10-30', timezone: 'UTC', staffIds: [staffId] }, { now: start });
  state = out.state; const planId = out.result;
  state = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '125.50' }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }, { now: start }).state;
  state = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }, { now: start }).state;
  const run = state.payrollByUser.buyer.runs[0];
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_execute_period', { planId, runId: run.id, period: '2026-10-30' }, { now: Date.UTC(2026, 9, 29) }), /not due/);
  out = applyCommand(state, 'buyer', 'payroll_execute_period', { planId, runId: run.id, period: '2026-10-30' }, { now: Date.UTC(2026, 9, 30, 10) });
  state = out.state;
  assert.equal(out.result.payoutCount, 1);
  assert.equal(state.payrollByUser.buyer.runs[0].status, 'completed');
  assert.equal(state.payrollByUser.buyer.plans[0].funding.disbursed, '125.5');
  assert.equal(state.payrollByUser.buyer.runs[0].periods[0].payouts[0].wallet, 'wallet-v1');
  out = applyCommand(state, 'buyer', 'payroll_execute_period', { planId, runId: run.id, period: '2026-10-30' }, { now: Date.UTC(2026, 10, 1) });
  assert.equal(out.result.replayed, true);
  const tampered = structuredClone(out.state); tampered.payrollByUser.buyer.runs[0].periods[0].payouts[0].wallet = 'attacker-wallet';
  assert.throws(() => assertInvariants(tampered), /differs from the approved plan/);
  assertInvariants(out.state);
});

test('autopay cannot be submitted or approved without the full sandbox funding reservation', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Funded', role: 'Ops', salary: '10', wallet: 'demo-funded' }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  let out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Needs funding', budget: '10', months: 3, mode: 'autopay', startDate: '2026-10-01', timezone: 'UTC', staffIds: [staffId] });
  state = out.state; const planId = out.result;
  state = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }).state;
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '10' }), /equal the total commitment/);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }), /reserve the full/);
  state = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '30' }).state;
  state = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }).state;
  assert.equal(state.payrollByUser.buyer.plans[0].funding.amount, '30');
});

test('approved schedules can be paused and resumed without changing the funding reservation', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Pauseable', role: 'Ops', salary: '10', wallet: 'demo-pause' }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  let out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Pauseable plan', budget: '10', months: 2, mode: 'autopay', startDate: '2026-10-01', timezone: 'UTC', staffIds: [staffId] });
  state = out.state; const planId = out.result;
  state = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '20' }).state;
  state = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_pause_plan', { planId }).state;
  assert.equal(state.payrollByUser.buyer.plans[0].status, 'paused');
  assert.equal(state.payrollByUser.buyer.runs[0].periods[0].status, 'paused');
  state = applyCommand(state, 'buyer', 'payroll_resume_plan', { planId }).state;
  assert.equal(state.payrollByUser.buyer.plans[0].status, 'approved');
  assert.equal(state.payrollByUser.buyer.plans[0].funding.amount, '20');
  assert.equal(state.payrollByUser.buyer.runs[0].periods[0].status, 'not_paid');
});

test('single payroll authorization command atomically creates, funds and approves a batch', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Atomic', role: 'Ops', salary: '100', wallet: 'demo-atomic' }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  const out = applyCommand(state, 'buyer', 'payroll_authorize_plan', { name: 'Atomic approval', budget: '100', months: 2, mode: 'autopay', startDate: '2026-10-01', timezone: 'UTC', staffIds: [staffId], acknowledge: true });
  state = out.state;
  assert.equal(out.result.status, 'approved');
  assert.equal(state.payrollByUser.buyer.plans[0].status, 'approved');
  assert.equal(state.payrollByUser.buyer.plans[0].funding.amount, '200');
  assert.equal(state.payrollByUser.buyer.runs[0].id, out.result.runId);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_authorize_plan', { name: 'Missing acknowledgement', budget: '100', months: 1, mode: 'manual', startDate: '2026-12-01', timezone: 'UTC', staffIds: [staffId] }), /acknowledgement/);
  assert.equal(state.payrollByUser.buyer.plans.length, 1);
});

test('payroll schedules can be cancelled and cannot be resumed or executed afterward', () => {
  let state = createSeedState();
  state = applyCommand(state, 'buyer', 'payroll_add_staff', { name: 'Cancel me', role: 'Ops', salary: '10', wallet: 'demo-cancel' }).state;
  const staffId = state.payrollByUser.buyer.staff[0].id;
  let out = applyCommand(state, 'buyer', 'payroll_create_plan', { name: 'Cancel plan', budget: '10', months: 2, mode: 'autopay', startDate: '2026-10-01', timezone: 'UTC', staffIds: [staffId] });
  state = out.state; const planId = out.result;
  state = applyCommand(state, 'buyer', 'payroll_preview_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_fund_plan', { planId, amount: '20' }).state;
  state = applyCommand(state, 'buyer', 'payroll_submit_plan', { planId }).state;
  state = applyCommand(state, 'buyer', 'payroll_approve_plan', { planId }).state;
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_cancel_plan', { planId, reason: 'unexpected' }), /Unsupported payroll field/);
  state = applyCommand(state, 'buyer', 'payroll_cancel_plan', { planId }).state;
  assert.equal(state.payrollByUser.buyer.plans[0].status, 'cancelled');
  assert.equal(state.payrollByUser.buyer.runs[0].status, 'cancelled');
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_resume_plan', { planId }), /paused/);
  assert.throws(() => applyCommand(state, 'buyer', 'payroll_execute_period', { planId, runId: state.payrollByUser.buyer.runs[0].id, period: '2026-10-01' }, { now: Date.UTC(2026, 9, 2) }), /Only an approved/);
});

test('review-team identity cannot mutate an employer payroll account', () => {
  const state = createSeedState();
  assert.throws(() => applyCommand(state, 'reviewer', 'payroll_add_staff', { name: 'Nope', role: 'Staff', salary: '1', wallet: 'demo' }), /Review-team/);
});
