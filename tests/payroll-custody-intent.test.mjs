import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createPayrollPayoutIntent, verifyPayrollPayoutIntent, serializePayrollPayoutIntent } from '../src/payroll-custody-intent.mjs';

const addr = n => base58Encode(Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 255));
const employer = addr(1), vault = addr(33), programId = addr(65), genesisHash = addr(97), mint = addr(129);
const staffA = addr(161), staffB = addr(193);
const options = { network: 'devnet', programId, expectedProgramIds: { devnet: programId }, genesisHash, mint, allowedMints: { devnet: [mint] }, employerAddress: employer, vaultAddress: vault, now: Date.parse('2026-10-30T12:00:00Z') };
const plan = (overrides = {}) => ({
  id: 'plan-production-1', status: 'approved', months: 2,
  lines: [
    { staffId: 'staff-a', walletAddress: staffA, salary: '100' },
    { staffId: 'staff-b', walletAddress: staffB, salary: '20' }
  ],
  preview: { total: '120', commitment: '240' },
  funding: { amount: '240', disbursed: '0', source: 'sandbox_budget' },
  ...overrides
});
const run = (overrides = {}) => ({ id: 'run-production-1', planId: 'plan-production-1', status: 'sandbox_recorded', periods: [{ period: '2026-10-30', dueAt: '2026-10-30T00:00:00.000Z', timezone: 'UTC', status: 'not_paid' }], ...overrides });

test('payroll payout intent binds approved lines, vault, period and exact total', () => {
  const intent = createPayrollPayoutIntent(plan(), run(), '2026-10-30', { ...options, allowSandbox: true });
  assert.equal(intent.programInstruction, 'disburse_payroll_batch');
  assert.equal(intent.total, '120');
  assert.equal(intent.recipients[0].wallet, staffA);
  assert.equal(intent.authorization.signer, employer);
  assert.equal(intent.broadcastable, false);
  assert.equal(verifyPayrollPayoutIntent(intent), true);
  assert.equal(typeof serializePayrollPayoutIntent(intent), 'string');
});

test('sandbox funding cannot authorize a payout intent by default', () => {
  assert.throws(() => createPayrollPayoutIntent(plan(), run(), '2026-10-30', options), /Sandbox funding/);
});

test('payout intent rejects early, paid, duplicate-wallet and over-limit batches', () => {
  assert.throws(() => createPayrollPayoutIntent(plan(), run(), '2026-10-30', { ...options, allowSandbox: true, now: Date.parse('2026-10-29T23:00:00Z') }), /not due/);
  assert.throws(() => createPayrollPayoutIntent(plan(), run({ periods: [{ period: '2026-10-30', status: 'sandbox_recorded' }] }), '2026-10-30', { ...options, allowSandbox: true }), /unpaid/);
  assert.throws(() => createPayrollPayoutIntent(plan({ lines: [{ staffId: 'staff-a', walletAddress: staffA, salary: '100' }, { staffId: 'staff-b', walletAddress: staffA, salary: '20' }] }), run(), '2026-10-30', { ...options, allowSandbox: true }), /wallets must be unique/);
  assert.throws(() => createPayrollPayoutIntent(plan({ lines: Array.from({ length: 41 }, (_, i) => ({ staffId: `staff-${i}`, walletAddress: addr((i + 1) % 200), salary: '1' })), preview: { total: '41', commitment: '82' }, funding: { amount: '82', disbursed: '0', source: 'sandbox_budget' } }), run(), '2026-10-30', { ...options, allowSandbox: true }), /limited to 40/);
});

test('payout intent rejects signer substitution, invalid manifests and non-vault funding', () => {
  assert.throws(() => createPayrollPayoutIntent(plan(), run(), '2026-10-30', { ...options, allowSandbox: true, signer: staffA }), /Only the employer/);
  assert.throws(() => createPayrollPayoutIntent(plan(), run(), '2026-10-30', { ...options, allowSandbox: true, expectedProgramIds: { devnet: staffA } }), /does not match/);
  assert.throws(() => createPayrollPayoutIntent(plan({ funding: { amount: '240', disbursed: '0', source: 'unknown' } }), run(), '2026-10-30', { ...options, allowSandbox: true }), /not an admitted custody vault/);
});

test('tampering invalidates the immutable unsigned intent and serialization gate', () => {
  const intent = createPayrollPayoutIntent(plan(), run(), '2026-10-30', { ...options, allowSandbox: true });
  const tampered = structuredClone(intent); tampered.recipients[0].amount = '999';
  assert.equal(verifyPayrollPayoutIntent(tampered), false);
  assert.throws(() => serializePayrollPayoutIntent(tampered), /verified unsigned/);
});
