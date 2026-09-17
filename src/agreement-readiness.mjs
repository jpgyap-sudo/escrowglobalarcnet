/**
 * Deterministic agreement preflight. Advisory only: it never edits terms,
 * rejects a user, authorizes money, or produces a safety score.
 */
export const READINESS_SEVERITY = Object.freeze({ error: 'error', warn: 'warn', info: 'info' });
export const READINESS_ISSUES = Object.freeze({
  SCOPE_MISSING: 'scope.missing', SCOPE_VAGUE: 'scope.vague', ACCEPTANCE_MISSING: 'acceptance.missing',
  ACCEPTANCE_VAGUE: 'acceptance.vague', DEADLINE_MISSING: 'deadline.missing', REMEDY_MISSING: 'remedy.missing',
  AMOUNT_INVALID: 'amount.invalid', AMOUNT_ZERO: 'amount.zero', ASSET_INVALID: 'asset.invalid',
  MILESTONE_TOTAL_MISMATCH: 'milestone.total_mismatch', GOODS_INSPECTION_MISSING: 'goods.inspection_missing',
  GOODS_SHIPPING_MISSING: 'goods.shipping_missing', DOMAIN_CONTROL_MISSING: 'domain.control_missing',
  REAL_ESTATE_CLOSING_MISSING: 'real_estate.closing_missing'
});

const vague = Object.freeze(['high quality', 'best effort', 'as soon as possible', 'asap', 'soon', 'promptly', 'reasonable', 'satisfactory', 'industry standard', 'tbd', 'tba']);
const measurable = Object.freeze([/\b\d+(?:\.\d+)?\s*(?:unit|item|piece|kg|g|lb|m|cm|mm|hour|hours|day|days|week|weeks)\b/i, /\b(?:api|endpoint|url|repo|commit|tag|sha-?256|checksum|iso|iec|astm)\b/i, /\b\d{4}-\d{2}-\d{2}\b/]);
const text = value => typeof value === 'string' && value.trim().length > 0;
const issue = (id, severity, field, message, details = undefined) => ({ id, severity, field, message, ...(details === undefined ? {} : { details }) });
const parseUnits = value => {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
};

export function checkAgreementReadiness(draft = {}) {
  const d = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const issues = [];
  if (!text(d.scope)) issues.push(issue(READINESS_ISSUES.SCOPE_MISSING, 'error', 'scope', 'Describe the deliverable and what will be handed over.'));
  else if (!measurable.some(pattern => pattern.test(d.scope))) issues.push(issue(READINESS_ISSUES.SCOPE_VAGUE, 'warn', 'scope', 'Add a measurable quantity, standard, date, artifact or test where possible.'));
  if (!text(d.acceptance)) issues.push(issue(READINESS_ISSUES.ACCEPTANCE_MISSING, 'error', 'acceptance', 'Add at least one condition that can be checked.'));
  else {
    const matches = vague.filter(word => d.acceptance.toLowerCase().includes(word));
    if (matches.length) issues.push(issue(READINESS_ISSUES.ACCEPTANCE_VAGUE, 'warn', 'acceptance', 'Replace vague acceptance language with observable tests.', { matches }));
  }
  if (!(Number.isInteger(Number(d.deadline)) && Number(d.deadline) > 0) && !text(d.deadline)) issues.push(issue(READINESS_ISSUES.DEADLINE_MISSING, 'error', 'deadline', 'Set a delivery date or duration.'));
  if (!text(d.remedy)) issues.push(issue(READINESS_ISSUES.REMEDY_MISSING, 'warn', 'remedy', 'Consider stating the revision, return or refund path.'));
  const amount = parseUnits(d.amount);
  if (amount === null) issues.push(issue(READINESS_ISSUES.AMOUNT_INVALID, 'error', 'amount', 'Enter a non-negative amount with no more than 6 decimal places.'));
  else if (amount <= 0n) issues.push(issue(READINESS_ISSUES.AMOUNT_ZERO, 'error', 'amount', 'Amount must be greater than zero.'));
  if (!['USDC', 'USDT'].includes(d.asset)) issues.push(issue(READINESS_ISSUES.ASSET_INVALID, 'error', 'asset', 'Choose USDC or USDT explicitly.'));
  if (Array.isArray(d.milestones) && d.milestones.length && amount !== null && amount > 0n) {
    const values = d.milestones.map(item => parseUnits(item?.amount));
    if (values.every(item => item !== null)) {
      const total = values.reduce((sum, item) => sum + item, 0n);
      if (total !== amount) issues.push(issue(READINESS_ISSUES.MILESTONE_TOTAL_MISMATCH, 'error', 'milestones', 'Milestone amounts must add up to the agreement total.', { expected: d.amount, actual: total.toString() }));
    }
  }
  const workflow = text(d.workflow) ? d.workflow : '';
  if (workflow === 'goods') {
    if (!text(d.inspection)) issues.push(issue(READINESS_ISSUES.GOODS_INSPECTION_MISSING, 'error', 'inspection', 'State who inspects, when, and against which checklist.'));
    if (!text(d.shipping)) issues.push(issue(READINESS_ISSUES.GOODS_SHIPPING_MISSING, 'error', 'shipping', 'State shipping responsibility, destination and risk transfer.'));
  } else if (workflow === 'domain' && !text(d.control)) issues.push(issue(READINESS_ISSUES.DOMAIN_CONTROL_MISSING, 'error', 'control', 'State the registrar/control-transfer method.'));
  else if (workflow === 'real_estate' && !text(d.closingConditions)) issues.push(issue(READINESS_ISSUES.REAL_ESTATE_CLOSING_MISSING, 'error', 'closingConditions', 'State the closing conditions and qualified professionals.'));
  const rank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  const counts = { error: 0, warn: 0, info: 0 };
  issues.forEach(item => { counts[item.severity] += 1; });
  return Object.freeze({ ready: counts.error === 0, issues, counts, boundary: 'advisory-only:no-live-custody:no-fund-authorization' });
}
