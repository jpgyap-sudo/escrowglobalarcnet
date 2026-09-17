# Salary disbursement workflow

The Salary management route (`#/account/payroll`) is implemented as a sandbox account workflow. It keeps an employer's staff, plans and run receipts actor-scoped and never treats a browser demo identity as authentication.

## Current workflow

1. Add each employee's name, role, monthly USDC salary, recipient wallet label and (optionally in the sandbox) a format-checked Solana payout address. The roster supports explicit save/update and archive actions; the address is snapshotted with the plan so a later roster edit cannot redirect an approved batch.
2. Enter the monthly budget and first payday. The planner uses exact six-decimal token units and rejects zero salaries, duplicate staff, over-budget plans and invalid dates.
3. Choose **Approve each month** or **Pre-funded autopay**. Autopay is bounded to 1–12 monthly periods, schedules 09:00 in the selected IANA timezone, and clamps month-end paydays (for example, January 31 → February 28).
4. Review allocation, unallocated budget, total commitment and scheduled periods.
5. The single approval action atomically creates the plan, computes the preview, reserves the exact commitment, submits it and records approval. Wallet and salary lines are snapshotted into the approved plan.
6. Due autopay periods are advanced by the local scheduler (including a catch-up tick after server restart) or the “Record due demo payout” control exactly once. Receipts are marked `sandbox_recorded` and decrement the plan’s simulated disbursed commitment exactly once; no token transfer occurs.
7. The account dashboard exposes exact active-staff, monthly-payroll, reserved, disbursed, remaining-commitment and next-payday totals. These are derived from the account bucket; they are planning/receipt data, not a chain balance.
8. History can be exported as labelled JSON or CSV. CSV cells are escaped and protected against spreadsheet formula injection; exports are explicitly sandbox receipts and contain no signing material.

An active staff member can belong to only one open plan at a time. Complete or cancel the existing plan before creating another overlapping schedule; archived staff remain available in historical receipts but cannot be added to new plans.

## Safety boundaries

- State mutations use the existing idempotent `/api/command` envelope and persist to the local journal.
- Payroll commands resolve staff and plans from the requesting actor's bucket; cross-actor IDs and review-team identities are rejected.
- Public `/api/state` omits payroll buckets, and command responses return only the requesting actor’s payroll bucket. The server scheduler fails closed unless state mode is `sandbox`.
- The current wallet field is a fictional label, not proof of wallet ownership. `sandbox_budget` is a simulated reservation, not custody.
- A separate unsigned payroll custody-intent boundary (`src/payroll-custody-intent.mjs`) now binds one due period to an employer signer, vault, admitted mint/program manifest, unique recipient wallet addresses and exact token totals. It rejects sandbox reservations unless explicitly used by fixtures and is never broadcastable.
- `src/payroll-idempotency-sqlite.mjs` provides a fail-closed Node `node:sqlite` store for payout-worker coordination. It uses a versioned schema, WAL + full synchronous durability, a unique batch key, atomic `INSERT OR IGNORE`, and compare-and-set state updates. It stores only intent hashes and opaque signed/transaction references—never private keys or signed bytes. The server does not enable this adapter automatically while the app remains sandbox-only; production wiring must place the database on encrypted, backed-up storage and monitor busy/corruption failures.

## Production gates before enabling real payouts

Implement these as separate audited components rather than extending the demo scheduler:

- verified employer account/session and role/approval policy;
- recipient wallet ownership proof and change approval with an effective date;
- prefunded restricted payout vault/program with fixed mint, recipients, amounts and expiry;
- dedicated `payroll-vault`, `payroll-auth`, `payroll-ledger` and `payroll-worker` readiness gates must all report ready before any unsigned batch intent may be handed to a live adapter; gate readiness is still not a release decision, so an explicit auditable release approval is also required;
- a fail-closed payout worker must use an injected signer plus read-only finality/reconciliation adapter and an atomic durable idempotency store; it must never hold keys or expose broadcast capability. For admitted `payroll_vault` funding, it also requires a readiness board with every production gate and all four payroll-specific gates ready;
- durable replicated payroll ledger and an idempotent worker with retries, failure handling and pause/cancel controls;
- trusted RPC finality/reconciliation, monitoring, audit exports and recovery runbooks;
- jurisdictional payroll/tax/compliance review.

Until every gate is satisfied, keep `realFunds: false` and the live custody endpoint disabled.

## Implementation and rollout plan

1. **Account and roster foundation (delivered):** keep staff records inside the employer account, validate salary/budget decimals, require explicit staff selection, and snapshot salary plus recipient identity into each plan.
2. **Approval and schedule engine (delivered):** preview the allocation, reserve the exact full-term commitment, then use one idempotent approval command. Bound autopay to 1–12 periods with deterministic timezone-aware dates and pause/resume/cancel controls.
3. **Sandbox verification (delivered):** run due periods through the local scheduler, create clearly labelled receipts, prevent cross-account access, and expose no live custody endpoint. Cover domain, API, UI wiring, replay, and failure-path tests.
4. **Identity and policy (required before production):** replace demo identity selection with authenticated employer sessions, role-based approval limits, recipient wallet ownership/change proofs, effective dates, and dual approval for changes to an active schedule.
5. **Funding vault and ledger (required before production):** deploy and audit a restricted payroll vault that accepts only the admitted mint and exact approved batches; add a replicated ledger, durable idempotency store, prefunding/expiry/refund rules, and independent balance reconciliation.
6. **Payout operations (required before production):** connect the fail-closed worker to an HSM/remote signer and read-only finalized RPC adapter, add retry/backoff and alerting, reconcile every batch before marking final, and provide operator pause/kill-switch and recovery runbooks.
7. **Compliance and release (required before production):** complete payroll/tax withholding requirements, sanctions and beneficiary screening, privacy/retention review, penetration/security audit, staged canary with capped amounts, and incident response approval. Only then may the custody readiness gate permit real payouts.
