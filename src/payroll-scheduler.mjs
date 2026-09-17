/** Deterministic sandbox scheduler. It records due autopay periods only; it never signs or transfers funds. */
import { applyPayrollCommand } from './payroll-state.mjs';

const dueMillis = period => period?.dueAt ? Date.parse(period.dueAt) : Date.parse(`${period?.period || ''}T00:00:00.000Z`);

export function executeDueAutopay(input, now = Date.now()) {
  let state = structuredClone(input);
  const executed = [];
  const failures = [];
  if (state?.mode !== 'sandbox') return { state, executed, failures: [{ error: 'Payroll scheduler refuses to run outside sandbox mode.' }] };
  for (const actorId of Object.keys(state.payrollByUser || {})) {
    const actor = state.users?.find(user => user.id === actorId);
    if (actor?.role === 'admin') continue;
    const planIds = (state.payrollByUser[actorId].plans || []).filter(plan => plan.mode === 'autopay' && plan.status === 'approved').map(plan => plan.id);
    for (const planId of planIds) {
      const runIds = (state.payrollByUser[actorId].runs || []).filter(run => run.planId === planId && run.status !== 'paused').map(run => run.id);
      for (const runId of runIds) {
        const periods = state.payrollByUser[actorId].runs.find(run => run.id === runId)?.periods || [];
        for (const period of periods.filter(item => item.status === 'not_paid' && Number.isFinite(dueMillis(item)) && dueMillis(item) <= now)) {
          try {
            const out = applyPayrollCommand(state, actorId, 'payroll_execute_period', { planId, runId, period: period.period }, { now });
            state = out.state;
            executed.push({ actorId, planId, runId, period: period.period });
          } catch (error) {
            failures.push({ actorId, planId, runId, period: period.period, error: error.message });
          }
        }
      }
    }
  }
  return { state, executed, failures };
}
