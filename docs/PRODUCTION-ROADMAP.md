# Production implementation gates

This package is a tested product/workflow sandbox plus integration and native source templates. The following work is not represented as completed.

## Gate 1 — decide the real service

Choose initial jurisdictions, supported goods/services, settlement mint, fee allocation, refund rights, inspection defaults, warranty limits, evidence requirements and funded maximums. Obtain advice for custody/payment/escrow regulation, consumer rights, financial crime obligations and both app stores. Write a dispute-handling SLA, reviewer conflicts policy and a funded backup process when your team is unavailable. The 5% non-refundable complaint fee needs explicit legal/fairness review.

Deliverable: an approved operating and custody specification. Do not start collecting user deposits merely because the local UX works.

## Gate 2 — build the constrained Solana custody program

Use an escrow identifier and program-derived vault per agreement or milestone. Commit original buyer, seller, token mint/program, fee recipient, fee rates, canonical terms hash, deadlines, amounts and reviewer authority. Require the correct party signatures for creation/acceptance/funding; store a monotonic version and terminal-state flags.

Required instructions include creation/acceptance, funding, buyer release, eligible refund, dispute initiation with separate fee deposit, reviewer release/refund to original accounts, proposed bilateral settlement/amendment, expired-proposal handling and safe account closure. Contract amendment must bind both signatures to exactly the same terms and amounts. None of these instructions may accept an arbitrary payout destination. Reviewer authority must not impose arbitrary splits.

The on-chain program need not store private shipping documents; store commitments and permissions, with confidential evidence off-chain. Do not equate a courier event with customer acceptance. A warranty tranche has its own held balance and permitted resolution paths.

Document upgrade policy honestly. An immutable custody core with versioned new deployments offers a stronger address guarantee but demands careful audits and migration planning. A multisig upgrade path still retains upgrade powers. Decide emergency behavior without creating an unrestricted withdrawal back door.

Deliverable: the existing Rust/Anchor source, generated IDL/client, validator/devnet integration tests, fuzz/property tests, independent review/audit, and an enforced deployment allowlist. The local source and host-side ABI artifacts now exist, but they are not deployment or audit evidence.

## Gate 3 — production accounts and signatures

Replace demo identity selection with a real account provider, verified wallet bindings, recovery and scoped sessions. For email/social login, obtain permissions from your provider and follow native store requirements. Never copy the on-ramp proof into an escrow authorization: its purpose is different.

Build an HTTPS API with versioned schemas, relational transactions, authorization, abuse limits, audit logging and controlled admin signing. Separate party approval from operator administration. The API should not hold private user keys. Change login credentials without silently rewriting already-funded wallet recipients.

## Gate 4 — real payment reconciliation

Build wallet balance/gas displays, transaction construction/simulation, signature handling, finality tracking and independently verified deposit/release/refund events. Handle RPC outages, partial payments, wrong tokens, duplicate signatures, retries and expired blockhashes. Maintain conservation checks against the actual chain, not a mutable UI balance.

Provision and approve MoonPay (or another provider) partners/domains. Complete sandbox end-to-end tests, webhook verification, region/payment method filtering, account support and final quote handling. Jupiter swaps remain distinct from custody; quote-to-swap-to-fund should have explicit steps and user consent. A bank/card top-up into an ordinary wallet is not escrow.

Merchant QR collection would require its own supported local payment partner and settlement/refund model. No documented merchant integration is assumed merely because users can scan a QR in Jupiter. Fiat settlement into a merchant bank account and smart-contract token custody are different arrangements.

## Gate 5 — private evidence and real delivery

Add tenant-isolated object storage, upload scanning, document access control, immutable commitments, retention/deletion rules and export. Decide courier/inspector integrations and authenticate their webhooks. Keep provider status subordinate to the actual acceptance agreement. Add inventory reservations/expiry and return-stock reconciliation with auditable adjustments. Never fake an inspection by accepting a carrier’s delivery flag.

## Gate 6 — web and native release

Move the API to a hardened service with durable backups, monitoring, incident playbooks and rollout/rollback controls. A reviewed financial CSP and payment-origin architecture should replace permissive integration defaults. Test slow networks, resumption, localization, accessibility and screen-reader flows.

Integrate native wallet/deep-link handling only after choosing a supported design. Build and sign Android and iOS packages in their actual SDKs; test real devices and production-equivalent sandbox credentials. Complete store metadata, privacy/account-deletion flows, financial declarations, regional distribution and payment-policy review. A WebView shell alone is not an app-store acceptance guarantee.

## Gate 7 — restricted beta

Use audited custody only, defined transaction limits, staffed disputes and alerts. Review adverse cases, not just completed orders: non-delivery, fraudulent evidence, lost wallet, frozen stablecoin account, silent reviewer, leaked session, compromised admin and provider outage. Increase limits only with evidence from operations. Keep customer deposits out of lending/yield strategies.
