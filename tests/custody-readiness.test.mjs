import test from 'node:test';
import assert from 'node:assert/strict';
import { custodyReadiness } from '../src/custody/readiness.mjs';

test('custody readiness defaults to a clearly blocked sandbox', () => {
  const result = custodyReadiness();
  assert.equal(result.mode, 'sandbox');
  assert.equal(result.realFunds, false);
  assert.equal(result.releaseApproved, false);
  assert.equal(result.localArtifact, false);
  assert.equal(result.localArtifactFresh, false);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('program'));
  assert.ok(result.blockers.includes('reconciliation'));
  assert.ok(result.blockers.includes('payroll-auth'));
  assert.ok(result.blockers.includes('payroll-ledger'));
  assert.ok(result.blockers.includes('payroll-worker'));
});

test('a local compiled artifact does not masquerade as a deployed program', () => {
  const result = custodyReadiness({ localArtifact: true });
  assert.equal(result.localArtifact, true);
  assert.equal(result.localArtifactFresh, false);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('program'));
});

test('readiness remains gated until every production control is explicit', () => {
  const result = custodyReadiness(Object.fromEntries([
    ['program', true], ['audit', true], ['auth', true], ['rpc', true],
    ['reconciliation', true], ['payrollVault', true], ['payrollAuth', true], ['payrollLedger', true], ['payrollWorker', true], ['database', true], ['operations', true], ['legal', true]
  ].map(([key, value]) => [key, value])));
  assert.equal(result.ready, false);
  assert.equal(result.releaseApproved, false);
  assert.deepEqual(result.blockers, ['release-approval']);
});

test('technical readiness still requires an explicit release approval', () => {
  const result = custodyReadiness(Object.fromEntries([
    ['program', true], ['audit', true], ['auth', true], ['rpc', true],
    ['reconciliation', true], ['payrollVault', true], ['payrollAuth', true], ['payrollLedger', true], ['payrollWorker', true], ['database', true], ['operations', true], ['legal', true], ['releaseApproved', true]
  ].map(([key, value]) => [key, value])));
  assert.equal(result.ready, true);
  assert.equal(result.releaseApproved, true);
  assert.deepEqual(result.blockers, []);
});
