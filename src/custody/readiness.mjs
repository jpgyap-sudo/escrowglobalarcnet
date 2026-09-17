/**
 * Machine-readable production gateboard for the custody boundary.
 *
 * Every live gate defaults to false. This keeps the UI and operators from
 * treating a compiled artifact or a sandbox command as a real-money launch.
 */
const gate = (id, label, ready, detail) => ({ id, label, ready: Boolean(ready), detail });

export function custodyReadiness(overrides = {}) {
  const gates = [
    gate('program', 'Restricted program deployed', overrides.program, 'The Anchor artifact is local-only until a controlled deployment exists.'),
    gate('audit', 'Independent program audit', overrides.audit, 'A compiled contract is not an audited contract.'),
    gate('auth', 'Production account authorization', overrides.auth, 'Sandbox identities and wallet ownership proofs are not account authorization.'),
    gate('rpc', 'Trusted RPC and finality service', overrides.rpc, 'Funding must be confirmed from chain state, not a browser callback.'),
    gate('reconciliation', 'On-chain reconciliation', overrides.reconciliation, 'The ledger must verify program, PDA, mint, amount, signer and finality idempotently.'),
    gate('payroll-vault', 'Restricted payroll payout vault/program', overrides.payrollVault, 'Salary batches require a dedicated vault/program that fixes every recipient, amount, period and replay key.'),
    gate('payroll-auth', 'Payroll employer authorization and approval policy', overrides.payrollAuth, 'Payroll approval must be bound to an authenticated employer account, role limits and recipient-change policy.'),
    gate('payroll-ledger', 'Payroll ledger and idempotency durability', overrides.payrollLedger, 'Every batch and period needs replicated accounting, atomic replay keys, and recovery evidence.'),
    gate('payroll-worker', 'Fail-closed payroll payout worker', overrides.payrollWorker, 'The worker must use an isolated signer, read-only finality checks, reconciliation and operational pause controls.'),
    gate('database', 'Durable production ledger', overrides.database, 'Local JSON state and a local journal are not replicated production storage.'),
    gate('operations', 'Dispute and recovery operations', overrides.operations, 'Liveness, backup resolver, wallet recovery, monitoring and incident runbooks are required.'),
    gate('legal', 'Legal and jurisdiction approval', overrides.legal, 'Escrow, payments, domains and real estate need qualified legal review.'),
    gate('release-approval', 'Auditable release approval', overrides.releaseApproved, 'All technical gates may report ready, but live custody stays disabled until a separately recorded release approval exists.'),
  ];
  const blockers = gates.filter(item => !item.ready).map(item => item.id);
  return Object.freeze({
    protocol: 'escrow-global-custody-v1',
    mode: 'sandbox',
    realFunds: false,
    // Keep this field explicit for operators and API consumers; it is also a
    // gate, so ready cannot become true without the separate approval.
    releaseApproved: Boolean(overrides.releaseApproved),
    localArtifact: Boolean(overrides.localArtifact),
    localArtifactFresh: Boolean(overrides.localArtifactFresh),
    ready: blockers.length === 0,
    gates,
    blockers,
    message: blockers.length ? 'Live custody is unavailable until every production gate and the separate release approval are independently satisfied.' : 'All configured gates and the separate release approval report ready; keep the adapter disabled until the reviewed deployment manifest is active.'
  });
}
