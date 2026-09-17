/** Actor-scoped salary planning records for the sandbox. No funds, RPC, or wallet signing. */
import { formatTokenAmount, parseTokenAmount, scheduleMonthlyDates, validatePayroll, MAX_STAFF_PER_PLAN } from './payroll-domain.mjs';
import { base58Decode } from './payments.mjs';

export const PAYROLL_SCHEMA_VERSION = 1;
const STATUSES = new Set(['draft', 'submitted', 'approved', 'paused', 'completed', 'cancelled']);
const RUN_STATUSES = new Set(['sandbox_recorded', 'not_paid', 'paused', 'completed', 'cancelled']);
const clone = value => structuredClone(value);
const fail = (message, code = 'PAYROLL_INVALID') => { const error = new Error(message); error.code = code; throw error; };
const text = (value, label, max = 120) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} is required and must be at most ${max} characters.`); return value.trim(); };
const optionalAddress = (value, label) => { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.length > 64) fail(`${label} must be a valid Solana address.`); try { const bytes = base58Decode(value.trim()); if (bytes.length !== 32 || bytes.every(byte => byte === 0)) throw new Error(); } catch { fail(`${label} must be a valid Solana address.`); } return value.trim(); };
const exactPayload = (payload, keys) => { if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Payroll payload must be an object.'); for (const key of Object.keys(payload)) if (!keys.includes(key)) fail(`Unsupported payroll field: ${key}`); };
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const emptyBucket = () => ({ version: PAYROLL_SCHEMA_VERSION, staff: [], plans: [], runs: [] });

export function assertPayrollInvariants(state) {
  if (state?.payrollByUser === undefined) return true;
  if (!state.payrollByUser || typeof state.payrollByUser !== 'object' || Array.isArray(state.payrollByUser)) fail('payrollByUser must be an object.');
  for (const [actorId, bucket] of Object.entries(state.payrollByUser)) {
    if (!bucket || bucket.version !== PAYROLL_SCHEMA_VERSION || !Array.isArray(bucket.staff) || !Array.isArray(bucket.plans) || !Array.isArray(bucket.runs)) fail('Payroll account data has an invalid shape.');
    const staffIds = new Set();
    for (const person of bucket.staff) {
      if (!person || typeof person.id !== 'string' || staffIds.has(person.id)) fail('Payroll staff IDs must be unique.');
      staffIds.add(person.id);
      text(person.name, 'Staff name', 120); text(person.role, 'Staff role', 120); text(person.wallet, 'Recipient wallet label', 160);
      if (person.walletAddress !== undefined && person.walletAddress !== null) optionalAddress(person.walletAddress, 'Recipient wallet address');
      try { if (parseTokenAmount(person.salary, 'Staff salary') === 0n) fail('Staff salary must be greater than zero.'); } catch (error) { if (error.code === 'PAYROLL_INVALID') throw error; fail('Staff salary is invalid.'); }
      if (!['active', 'archived'].includes(person.status) || !Number.isSafeInteger(person.revision) || person.revision < 1) fail('Payroll staff status or revision is invalid.');
    }
    const planIds = new Set();
    for (const plan of bucket.plans) {
      if (!plan || typeof plan.id !== 'string' || planIds.has(plan.id)) fail('Payroll plan IDs must be unique.');
      planIds.add(plan.id);
      text(plan.name, 'Payroll plan name', 160);
      try { parseTokenAmount(plan.budget, 'Payroll budget'); } catch { fail('Payroll budget is invalid.'); }
      if (!Number.isInteger(plan.months) || plan.months < 1 || plan.months > 12 || !STATUSES.has(plan.status) || !['manual', 'autopay'].includes(plan.mode)) fail('Payroll plan fields are invalid.');
      if (!Array.isArray(plan.lines) || plan.lines.length < 1 || plan.lines.length > MAX_STAFF_PER_PLAN) fail(`Payroll plan must include 1-${MAX_STAFF_PER_PLAN} staff lines.`);
      const lineIds = new Set(); let total = 0n;
      for (const line of plan.lines) {
        if (!line || !staffIds.has(line.staffId) || lineIds.has(line.staffId)) fail('Payroll plan contains an invalid or duplicate staff line.');
        lineIds.add(line.staffId); text(line.wallet, 'Payroll recipient wallet label', 160); if (line.walletAddress !== undefined && line.walletAddress !== null) optionalAddress(line.walletAddress, 'Payroll recipient wallet address'); const salary = parseTokenAmount(line.salary, 'Payroll line salary'); if (salary === 0n) fail('Payroll line salary must be greater than zero.'); total += salary;
      }
      if (total > parseTokenAmount(plan.budget, 'Payroll budget')) fail('Payroll plan exceeds its budget.');
      const commitment = total * BigInt(plan.months);
      if (plan.preview !== null && (!plan.preview || plan.preview.total !== formatTokenAmount(total) || plan.preview.commitment !== formatTokenAmount(commitment) || plan.preview.lineCount !== plan.lines.length)) fail('Payroll preview is stale or invalid.');
      if (plan.funding !== null && (!plan.funding || plan.funding.source !== 'sandbox_budget' || plan.funding.amount !== formatTokenAmount(commitment) || !Number.isSafeInteger(plan.funding.fundedAt) || plan.funding.fundedAt < 1 || typeof plan.funding.disbursed !== 'string' || parseTokenAmount(plan.funding.disbursed, 'Disbursed payroll amount') > parseTokenAmount(plan.funding.amount, 'Funding amount'))) fail('Payroll funding reservation is invalid.');
      if (['submitted', 'approved', 'completed'].includes(plan.status) && !plan.funding) fail('Submitted payroll plans require a funding reservation.');
      if (plan.status === 'approved' && !plan.approval) fail('Approved payroll plans require an approval record.');
    }
    for (const run of bucket.runs) {
      if (!run || !planIds.has(run.planId) || !RUN_STATUSES.has(run.status) || !Array.isArray(run.periods) || run.periods.length < 1) fail('Payroll run is invalid.');
      const linkedPlan = bucket.plans.find(plan => plan.id === run.planId);
      for (const period of run.periods) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(period.period) || !['not_paid', 'paused', 'sandbox_recorded'].includes(period.status) || (period.dueAt !== undefined && typeof period.dueAt !== 'string') || (period.timezone !== undefined && typeof period.timezone !== 'string')) fail('Payroll run period is invalid.');
        if (period.status === 'sandbox_recorded') {
          if (!Array.isArray(period.payouts) || period.payouts.length < 1) fail('Recorded payroll periods require payout receipts.');
          if (period.payouts.length !== linkedPlan.lines.length) fail('Recorded payroll payouts do not match the approved plan.');
          for (const payout of period.payouts) { text(payout.staffId, 'Payroll payout staff ID', 160); text(payout.wallet, 'Payroll payout wallet label', 160); if (payout.walletAddress !== undefined && payout.walletAddress !== null) optionalAddress(payout.walletAddress, 'Payroll payout wallet address'); parseTokenAmount(payout.salary, 'Payroll payout salary'); const line = linkedPlan.lines.find(item => item.staffId === payout.staffId); if (!line || line.wallet !== payout.wallet || (line.walletAddress || null) !== (payout.walletAddress || null) || line.salary !== payout.salary) fail('Recorded payroll payout differs from the approved plan.'); }
        }
      }
    }
    for (const plan of bucket.plans) if (plan.funding) {
      let disbursed = 0n;
      for (const run of bucket.runs.filter(item => item.planId === plan.id)) for (const period of run.periods) if (period.status === 'sandbox_recorded') for (const payout of period.payouts || []) disbursed += parseTokenAmount(payout.salary, 'Payroll payout salary');
      if (plan.funding.disbursed !== formatTokenAmount(disbursed)) fail('Payroll funding disbursement total is inconsistent.');
    }
  }
  return true;
}

function bucketFor(state, actorId) { state.payrollByUser ??= {}; state.payrollByUser[actorId] ??= emptyBucket(); return state.payrollByUser[actorId]; }
function staffFor(bucket, staffId) { const person = bucket.staff.find(item => item.id === staffId); if (!person) fail('Staff member was not found.', 'PAYROLL_NOT_FOUND'); return person; }
function planFor(bucket, planId) { const plan = bucket.plans.find(item => item.id === planId); if (!plan) fail('Payroll plan was not found.', 'PAYROLL_NOT_FOUND'); return plan; }

export function applyPayrollCommand(input, actorId, command, payload = {}, context = {}) {
  const state = clone(input); const bucket = bucketFor(state, actorId); const now = context.now ?? Date.now();
  if (!command.startsWith('payroll_')) fail('Unsupported payroll command.');
  if (command === 'payroll_authorize_plan') {
    exactPayload(payload, ['name', 'budget', 'months', 'mode', 'startDate', 'timezone', 'staffIds', 'acknowledge']);
    if (payload.acknowledge !== true) fail('Explicit payroll approval acknowledgement is required.');
    const planPayload = { ...payload }; delete planPayload.acknowledge;
    // Stage the complete create -> preview -> reserve -> submit -> approve
    // sequence on cloned states. A failure at any step returns no mutation to
    // the caller, while the UI still presents one approval action.
    const created = applyPayrollCommand(state, actorId, 'payroll_create_plan', planPayload, context);
    const planId = created.result;
    const preview = applyPayrollCommand(created.state, actorId, 'payroll_preview_plan', { planId }, context);
    const funded = applyPayrollCommand(preview.state, actorId, 'payroll_fund_plan', { planId, amount: preview.result.commitment }, context);
    const submitted = applyPayrollCommand(funded.state, actorId, 'payroll_submit_plan', { planId }, context);
    const approved = applyPayrollCommand(submitted.state, actorId, 'payroll_approve_plan', { planId }, context);
    const approvedBucket = approved.state.payrollByUser[actorId];
    const run = approvedBucket.runs.find(item => item.planId === planId);
    return { state: approved.state, result: { planId, runId: run?.id || null, commitment: preview.result.commitment, status: 'approved' } };
  }
  if (command === 'payroll_add_staff') {
    exactPayload(payload, ['name', 'role', 'salary', 'wallet', 'walletAddress']);
    if (bucket.staff.filter(person => person.status === 'active').length >= MAX_STAFF_PER_PLAN) fail(`The payroll roster is limited to ${MAX_STAFF_PER_PLAN} active staff.`);
    const salaryUnits = parseTokenAmount(payload.salary, 'Salary'); if (salaryUnits === 0n) fail('Salary must be greater than zero.');
    const person = { id: id('staff'), name: text(payload.name, 'Staff name'), role: text(payload.role, 'Staff role'), salary: formatTokenAmount(salaryUnits), wallet: text(payload.wallet || 'demo-wallet-pending', 'Recipient wallet label', 160), walletAddress: optionalAddress(payload.walletAddress, 'Recipient wallet address'), status: 'active', revision: 1, createdAt: now, updatedAt: now };
    bucket.staff.push(person); assertPayrollInvariants(state); return { state, result: person.id };
  }
  if (command === 'payroll_update_staff') {
    exactPayload(payload, ['staffId', 'expectedRevision', 'name', 'role', 'salary', 'wallet', 'walletAddress']);
    const person = staffFor(bucket, payload.staffId); if (person.status === 'archived') fail('Archived staff cannot be edited.');
    if (payload.expectedRevision !== person.revision) fail('Staff changed. Refresh before editing.', 'STALE_VERSION');
    for (const key of ['name', 'role', 'wallet']) if (payload[key] !== undefined) person[key] = text(payload[key], `Staff ${key}`, 160);
    if (payload.salary !== undefined) { const salaryUnits = parseTokenAmount(payload.salary, 'Salary'); if (salaryUnits === 0n) fail('Salary must be greater than zero.'); person.salary = formatTokenAmount(salaryUnits); }
    if (payload.walletAddress !== undefined) person.walletAddress = optionalAddress(payload.walletAddress, 'Recipient wallet address');
    person.revision++; person.updatedAt = now; assertPayrollInvariants(state); return { state, result: person.id };
  }
  if (command === 'payroll_archive_staff') {
    exactPayload(payload, ['staffId', 'expectedRevision']);
    const person = staffFor(bucket, payload.staffId); if (person.status === 'archived') return { state, result: person.id };
    if (payload.expectedRevision !== person.revision) fail('Staff changed. Refresh before archiving.', 'STALE_VERSION');
    person.status = 'archived'; person.revision++; person.updatedAt = now; person.archivedAt = now; assertPayrollInvariants(state); return { state, result: person.id };
  }
  if (command === 'payroll_create_plan') {
    exactPayload(payload, ['name', 'budget', 'months', 'mode', 'startDate', 'timezone', 'staffIds']);
    const active = bucket.staff.filter(person => person.status === 'active'); if (!active.length) fail('Add at least one active staff member first.');
    const selectedIds = payload.staffIds === undefined ? active.map(person => person.id) : payload.staffIds;
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) fail('Select at least one unique active staff member.');
    const selected = selectedIds.map(staffId => { const person = staffFor(bucket, staffId); if (person.status !== 'active') fail('Archived staff cannot be added to a new payroll plan.'); return person; });
    const selectedSet = new Set(selectedIds); const openPlans = bucket.plans.filter(existing => ['draft', 'submitted', 'approved', 'paused'].includes(existing.status));
    if (openPlans.some(existing => existing.lines.some(line => selectedSet.has(line.staffId)))) fail('One or more selected staff members already belong to an open payroll plan. Complete or cancel that plan first.');
    const budget = formatTokenAmount(parseTokenAmount(payload.budget, 'Monthly budget'));
    const mode = payload.mode === 'autopay' ? 'autopay' : 'manual'; const requestedMonths = Number(payload.months ?? 1); if (!Number.isInteger(requestedMonths) || requestedMonths < 1 || requestedMonths > 12) fail('Automation term must be 1–12 months.'); const months = requestedMonths;
    const dates = scheduleMonthlyDates(payload.startDate, mode === 'manual' ? 1 : months, payload.timezone || 'UTC');
    const plan = { id: id('plan'), name: text(payload.name || `${mode === 'autopay' ? 'Autopay' : 'Monthly'} payroll`, 'Plan name', 160), budget, months: mode === 'manual' ? 1 : months, mode, startDate: dates[0].period, timezone: payload.timezone || 'UTC', lines: selected.map(person => ({ staffId: person.id, salary: person.salary, wallet: person.wallet, walletAddress: person.walletAddress || null })), preview: null, funding: null, approval: null, status: 'draft', createdAt: now, updatedAt: now };
    bucket.plans.push(plan); assertPayrollInvariants(state); return { state, result: plan.id };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Payroll payload must be an object.');
  const plan = planFor(bucket, payload.planId);
  if (command === 'payroll_preview_plan') {
    exactPayload(payload, ['planId']);
    const total = plan.lines.reduce((sum, line) => sum + parseTokenAmount(line.salary, 'Payroll salary'), 0n);
    if (total > parseTokenAmount(plan.budget, 'Payroll budget')) fail(`Salaries exceed the monthly budget by ${formatTokenAmount(total - parseTokenAmount(plan.budget, 'Payroll budget'))}.`);
    plan.preview = { total: formatTokenAmount(total), commitment: formatTokenAmount(total * BigInt(plan.months)), lineCount: plan.lines.length, computedAt: now }; plan.funding = null; assertPayrollInvariants(state); return { state, result: plan.preview };
  }
  if (command === 'payroll_fund_plan') {
    exactPayload(payload, ['planId', 'amount']);
    if (plan.status !== 'draft' || !plan.preview) fail('Preview the draft before reserving payroll funds.');
    const expected = parseTokenAmount(plan.preview.commitment, 'Payroll commitment'); const amount = parseTokenAmount(payload.amount, 'Funding amount');
    if (amount !== expected) fail(`Funding amount must equal the total commitment of ${formatTokenAmount(expected)}.`);
    if (plan.funding) return { state, result: { planId: plan.id, amount: plan.funding.amount, replayed: true } };
    plan.funding = { amount: formatTokenAmount(amount), disbursed: '0', fundedAt: now, source: 'sandbox_budget' }; plan.updatedAt = now; assertPayrollInvariants(state); return { state, result: { planId: plan.id, amount: plan.funding.amount, replayed: false } };
  }
  if (command === 'payroll_submit_plan') {
    exactPayload(payload, ['planId']);
    if (plan.status !== 'draft' || !plan.preview || !plan.funding) fail('Preview and reserve the full payroll commitment before submitting it for approval.');
    plan.status = 'submitted'; plan.updatedAt = now; assertPayrollInvariants(state); return { state, result: plan.id };
  }
  if (command === 'payroll_approve_plan') {
    exactPayload(payload, ['planId']);
    if (plan.status !== 'submitted' || !plan.preview) fail('Only a previewed submitted plan can be approved.');
    plan.status = 'approved'; plan.approval = { approvedAt: now, approvedBy: actorId }; plan.updatedAt = now;
    const periods = scheduleMonthlyDates(plan.startDate, plan.months, plan.timezone).map(date => ({ period: date.period, dueAt: date.dueAt, timezone: date.timezone, status: 'not_paid' }));
    bucket.runs.unshift({ id: id('run'), planId: plan.id, status: 'sandbox_recorded', createdAt: now, periods });
    assertPayrollInvariants(state); return { state, result: plan.id };
  }
  if (command === 'payroll_execute_period') {
    exactPayload(payload, ['planId', 'runId', 'period']);
    const run = bucket.runs.find(item => item.planId === plan.id && item.id === payload.runId); if (!run) fail('Payroll run was not found.', 'PAYROLL_NOT_FOUND');
    const period = run.periods.find(item => item.period === payload.period); if (!period) fail('Payroll period was not found.', 'PAYROLL_NOT_FOUND');
    if (period.status === 'sandbox_recorded') return { state, result: { runId: run.id, period: period.period, replayed: true } };
    if (plan.status !== 'approved') fail('Only an approved payroll plan can run.');
    if (period.status === 'paused' || run.status === 'paused' || plan.status === 'paused') fail('This payroll schedule is paused.');
    const dueAt = period.dueAt ? Date.parse(period.dueAt) : Date.parse(`${period.period}T00:00:00.000Z`); if (!Number.isFinite(dueAt) || now < dueAt) fail(`Payroll period ${period.period} is not due yet.`);
    const periodTotal = plan.lines.reduce((sum, line) => sum + parseTokenAmount(line.salary, 'Payroll salary'), 0n); const funded = parseTokenAmount(plan.funding?.amount || '0', 'Funding amount'); const disbursed = parseTokenAmount(plan.funding?.disbursed || '0', 'Disbursed payroll amount'); if (disbursed + periodTotal > funded) fail('Payroll funding reservation is exhausted.');
    period.status = 'sandbox_recorded'; period.executedAt = now; period.payouts = plan.lines.map(line => ({ staffId: line.staffId, wallet: line.wallet, walletAddress: line.walletAddress || null, salary: line.salary })); plan.funding.disbursed = formatTokenAmount(disbursed + periodTotal); plan.updatedAt = now;
    if (run.periods.every(item => item.status === 'sandbox_recorded')) { run.status = 'completed'; plan.status = 'completed'; }
    assertPayrollInvariants(state); return { state, result: { runId: run.id, period: period.period, payoutCount: period.payouts.length, replayed: false } };
  }
  if (command === 'payroll_pause_plan') {
    exactPayload(payload, ['planId']);
    if (!['approved', 'submitted'].includes(plan.status)) fail('Only submitted or approved plans can be paused.');
    plan.status = 'paused'; plan.updatedAt = now; for (const run of bucket.runs.filter(item => item.planId === plan.id)) { run.status = 'paused'; run.periods.forEach(period => { if (period.status === 'not_paid') period.status = 'paused'; }); } assertPayrollInvariants(state); return { state, result: plan.id };
  }
  if (command === 'payroll_resume_plan') {
    exactPayload(payload, ['planId']);
    if (plan.status !== 'paused' || !plan.funding) fail('Only a paused, funded payroll plan can be resumed.');
    plan.status = 'approved'; plan.updatedAt = now;
    for (const run of bucket.runs.filter(item => item.planId === plan.id)) { run.status = 'sandbox_recorded'; run.periods.forEach(period => { if (period.status === 'paused') period.status = 'not_paid'; }); }
    assertPayrollInvariants(state); return { state, result: plan.id };
  }
  if (command === 'payroll_cancel_plan') {
    exactPayload(payload, ['planId']);
    if (!['draft', 'submitted', 'approved', 'paused'].includes(plan.status)) fail('Completed payroll plans cannot be cancelled.');
    plan.status = 'cancelled'; plan.cancelledAt = now; plan.updatedAt = now;
    for (const run of bucket.runs.filter(item => item.planId === plan.id)) { run.status = 'cancelled'; run.periods.forEach(period => { if (period.status === 'not_paid' || period.status === 'paused') period.status = 'paused'; }); }
    assertPayrollInvariants(state); return { state, result: plan.id };
  }
  fail('Unsupported payroll command.');
}

export function payrollForActor(state, actorId) { return clone(state?.payrollByUser?.[actorId] || emptyBucket()); }

/**
 * Exact, read-only account dashboard totals. This deliberately reports
 * reservations and sandbox disbursements separately so an employer can see
 * what remains committed without treating a browser receipt as a payment.
 */
export function payrollSummary(state, actorId) {
  const bucket = state?.payrollByUser?.[actorId] || emptyBucket();
  const activeStaff = bucket.staff.filter(person => person.status === 'active').length;
  const archivedStaff = bucket.staff.filter(person => person.status === 'archived').length;
  const openStatuses = new Set(['draft', 'submitted', 'approved', 'paused']);
  const openPlans = bucket.plans.filter(plan => openStatuses.has(plan.status));
  let monthlyPayroll = 0n;
  let reserved = 0n;
  let disbursed = 0n;
  let nextDueAt = null;
  for (const plan of bucket.plans) {
    if (openStatuses.has(plan.status)) monthlyPayroll += plan.lines.reduce((sum, line) => sum + parseTokenAmount(line.salary, 'Payroll salary'), 0n);
    if (plan.funding) {
      reserved += parseTokenAmount(plan.funding.amount, 'Funding amount');
      disbursed += parseTokenAmount(plan.funding.disbursed, 'Disbursed payroll amount');
    }
    if (openStatuses.has(plan.status)) {
      for (const run of bucket.runs.filter(item => item.planId === plan.id)) for (const period of run.periods || []) {
        if (period.status !== 'not_paid' || typeof period.dueAt !== 'string') continue;
        const due = Date.parse(period.dueAt);
        if (Number.isFinite(due) && (nextDueAt === null || due < nextDueAt.time)) nextDueAt = { time: due, value: period.dueAt, period: period.period, timezone: period.timezone || plan.timezone || 'UTC' };
      }
    }
  }
  const remaining = reserved >= disbursed ? reserved - disbursed : 0n;
  return Object.freeze({
    activeStaff,
    archivedStaff,
    openPlans: openPlans.length,
    monthlyPayroll: formatTokenAmount(monthlyPayroll),
    reserved: formatTokenAmount(reserved),
    disbursed: formatTokenAmount(disbursed),
    remaining: formatTokenAmount(remaining),
    nextDueAt: nextDueAt?.value || null,
    nextPeriod: nextDueAt?.period || null,
    nextTimezone: nextDueAt?.timezone || null,
    asset: 'USDC',
  });
}
