# Security model and boundaries

## What the current code enforces

The reference model validates command schemas, recognized roles, original buyer/seller identity, record version, fixed recipients, permitted transitions and conserved integer funds. Goods add immutable commercial snapshots, per-stage definitions, stock checks, return sequencing and warranty constraints. The local server uses idempotency keys, rejects conflicting replay and atomically replaces its JSON state within one process.

On-ramp ownership proofs are origin/purpose-bound Ed25519 messages with random nonces and five-minute expiry. Nonces are consumed once even when verification fails. Authenticated checkout takes its address from a short-lived HttpOnly/SameSite session. Secrets are not sent to the browser or served as static files. Payment endpoints do not mutate escrow balances. Public/customer-forwarded headers are not trusted as a verified public IP.

The QR encoder has independent exact-matrix tests. QR accuracy does not authenticate its destination, prove payment, or provide escrow protection. Users must check the final wallet transaction.

## What these protections do not mean

All marketplace identities are switchable. The API accepts simulated actor IDs. Local JSON/browser state is not authoritative cryptographic custody. An operator can change the source/files. The model’s “no address change” rule is not a property of a deployed smart contract because no such contract is included. The local append-only operation journal is tamper-evident hash-linked evidence for reconciliation, not a replicated production database or tamper prevention.

There is no audited smart contract, actual vault, real wallet-funded escrow, authenticated multi-tenant account system, recovery, encrypted evidence store or production authorization. A wallet proof for on-ramp prefill does not authorize a market order. A typed contract, uploaded delivery reference, provider success callback or merchant QR scan is not a signature or final payment confirmation.

## Production threat checklist

- Replace the role switcher with real authentication, session lifecycle, authorization, tenant isolation and per-party verifiable agreement signatures. Domain-separate every signed action; bind chain, program, escrow, version, amount, destination, expiry and nonce. Show understandable consent.
- Model real custody separately. Enforce original token and recipient accounts in every transfer path, including fees, administrator actions, closure, amendments, emergencies and upgrade authority. Do not advertise immutability while an unrestricted upgrade key can rewrite payout rules.
- Use checked integer arithmetic; reject unexpected token programs/extensions; decide supported native token mints; handle issuer freezing, account closure, rent and failed transfers. Avoid arbitrary transfer-tax/rebasing assets in the first custody implementation.
- Implement finality-aware chain indexing, reconciliation, retries, idempotency and reorg handling. Never trust UI or provider redirects to establish escrow funding. Investigate duplicate, partial, wrong-mint, over/underpaid and abandoned transfers.
- Use durable relational transactions, unique constraints, row-level authorization, private object storage, expiring access, malware scanning, tamper-evident audit logs and tested backups. Evidence hashes alone do not preserve files or prove when the physical work occurred.
- Isolate third-party payment code and approve a narrow CSP. The demo allows broad HTTPS connections/frames for widget experimentation; do not copy that policy into an authenticated financial production origin without review.
- Resolve CSRF/XSS, replay, stale proposals, fee rounding, griefing, deadline races, administrative compromise and dispute-service outages. Use multiple reviewers/controlled signing, not a developer’s everyday wallet.
- Validate and test native navigation, deep links, universal/app links, wallet resume/cancellation, file permissions, accessibility, session logout and privacy. Do not inject untrusted HTML or add an unrestricted JavaScript-to-native signing bridge.

## Local operation and disclosure

Never expose this server to the Internet or a public tunnel with real customer data. Do not commit `.env`, signing keys, credentials, personal addresses, evidence files or the generated `data/` folder. Demo export is intentionally unencrypted and contains local messages/agreements. Store only fictional content.

Production security reporting needs a real team contact, triage process, response targets and disclosure policy. No external audit or penetration test has been commissioned for this package.
