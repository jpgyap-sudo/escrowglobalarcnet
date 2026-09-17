import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAgreementReadiness, READINESS_ISSUES } from '../src/agreement-readiness.mjs';

test('agreement preflight catches missing essentials without a safety score', () => {
  const result = checkAgreementReadiness({});
  assert.equal(result.ready, false);
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.SCOPE_MISSING));
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.ACCEPTANCE_MISSING));
  assert.equal(result.boundary, 'advisory-only:no-live-custody:no-fund-authorization');
  assert.equal(Object.hasOwn(result, 'score'), false);
});

test('preflight uses exact six-decimal amounts and flags vague criteria', () => {
  const result = checkAgreementReadiness({ scope: 'Deliver 10 units per ISO 9001', acceptance: 'High quality work ASAP', deadline: 7, remedy: 'Revision or refund', amount: '100.000000', asset: 'USDC' });
  assert.equal(result.ready, true);
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.ACCEPTANCE_VAGUE));
});

test('preflight catches milestone totals and goods workflow omissions', () => {
  const result = checkAgreementReadiness({ scope: 'Deliver 10 units', acceptance: 'All 10 units pass inspection', deadline: 7, amount: '100', asset: 'USDC', milestones: [{ amount: '40' }, { amount: '50' }], workflow: 'goods' });
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.MILESTONE_TOTAL_MISMATCH));
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.GOODS_INSPECTION_MISSING));
  assert.ok(result.issues.some(item => item.id === READINESS_ISSUES.GOODS_SHIPPING_MISSING));
});
