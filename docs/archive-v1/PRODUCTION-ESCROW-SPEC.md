# Production escrow requirements — NOT deployed code

This specification records desired properties and open decisions for a future custody implementation. `src/domain.mjs` is an executable, off-chain reference model only. No mainnet or testnet program is included, and no cryptographic enforcement is claimed.

## 1. Safety properties

The original buyer refund recipient, seller payout recipient, approved asset, permitted fee recipient and fee formulas must be committed before funding. Escrow principal may only reach the original buyer or original seller. The fee recipient may receive only contract-authorized commission and separately authorized dispute fees.

There must be no arbitrary recipient, delegate transfer, principal withdrawal, balance sweep, fee-increase, or unrelated-account substitution path. Include indirect authority, account closing, token approvals, migration and upgrade paths in this review. Removing a wallet-editing UI is insufficient.

Administrator resolution may operate only on an open disputed milestone and choose all-release or all-refund. Partial settlement and altered scope/deadlines require both original parties' valid consent. Already settled funds are outside subsequent disputes. Administrators do not acquire the ability to change contractual terms through listing moderation.

A program upgrade must not silently invalidate those restrictions for existing escrows. A candidate approach is a narrow immutable custody core with new versions for new agreements. This has repairability tradeoffs and requires independent review before adoption. A multisignature alone does not narrow what its authorized code can do.

## 2. Agreement data

Suggested immutable agreement fields:

- Chain/network identifier, deployment version, unique agreement ID and supported token identity.
- Original buyer authority/refund account and seller authority/payout account; recipient and account-ownership checks appropriate to the chosen chain.
- Bounded fee recipient, 300 basis-point commission formula, 500 basis-point dispute formula, rounding rule and policy version.
- Resolver authority and any explicitly pre-agreed fallback; review and timeout modes.
- Original agreement digest, evidence policy, acceptance signatures and funding cap.

Milestone fields include original principal, remaining principal, fee reserve, cumulative released/refunded/fee values, scope and criteria digests, delivery deadline, review deadline, revision allowance, status, monotonically increasing state revision, and any pending settlement proposal.

Maintain original terms and an append-only amendment history. A changed public listing must not change an existing agreement. Listing ownership and the seller's authenticated signature must match the chosen payment party.

## 3. State transitions

| From | Action and authority | Result |
|---|---|---|
| Draft awaiting seller | Seller accepts exact terms | Awaiting funding |
| Unfunded | Either party cancels | Cancelled, no principal moved |
| Accepted unfunded | Buyer funds required principal and reserve | Funded milestones |
| Funded | Seller submits qualifying delivery | Submitted, review starts |
| Submitted | Buyer approves accepted criteria | Release to original seller and formula fee |
| Submitted | Buyer requests included revision | Funded/revision work pending; timer updated |
| Funded/submitted | Either party pays separate dispute charge | Only that milestone disputed |
| Disputed | Authorized resolver releases | Full remaining principal to original seller |
| Disputed | Authorized resolver refunds | Remaining principal and unused reserve to buyer |
| Unsettled | Both parties accept same final split | Specified seller amount, remainder and unused reserve refunded |
| Unsettled | Both accept same amendment | Excess refunded; revised scope and retained balance remain |
| Submitted, timed mode | Deadline passed without qualifying freeze | Eligible for settlement transaction |
| Funded, no current delivery/dispute | Agreed lateness rule passes | Eligible buyer refund transaction |

No transition must be implied solely by a UI color. A deadline establishes eligibility; a transaction still must execute. In the local model, `execute_timeout` can be submitted by an original party or the admin role. A future permissionless executor should be evaluated separately: it can trigger a pre-authorized transition but must not choose a payout outcome or destination.

Model timeout edges, dispute/approval races, fork/finality behavior and cancellation atomically. The currently implemented timers are illustrative policy assumptions: a 72-hour review in timed mode, 48-hour grace for eligible non-delivery, and 72-hour amendment-proposal expiry. They need product and legal review.

The local model has no resolver-failure fallback or appeal mechanism. Real deposits must not launch with that omission hidden from users. A fallback resolver, limited appeal window or another pre-agreed terminal rule needs explicit approval and implementation.

## 4. Bilateral amendments

A proposed split or revision binds the agreement ID, milestone ID, current revision, original recipient identities, supported asset, proposed amount, scope digest, new timing, proposal ID, nonce and expiry. Include chain/deployment domain separation. Signatures must not be replayable across networks, programs, milestones or superseded versions.

The original proposer approves by signing the complete proposal. The other party must sign exactly that proposal. Reviewer approval cannot substitute for either party. Changes to delivery/dispute state should invalidate or explicitly reconcile a pending proposal. A proposal alone must not freeze deadlines indefinitely or move principal.

An amendment cannot silently increase the buyer's exposure. Additional deposits and newly purchased scope require separately authorized funding. The local implementation supports only reducing or retaining held principal; it does not implement top-ups.

## 5. Money accounting

Use integer base units with checked arithmetic and a supported token allowlist. Never use floating-point money. For the six-decimal reference model:

`commission(sellerAmount) = floor(sellerAmount * 300 / 10000)`

`disputeCharge(heldPrincipal) = floor(heldPrincipal * 500 / 10000)`

For a final split, transfer sellerAmount to the original seller, remaining principal to the original buyer, the formula commission to the allowed fee recipient, and unused reserve to the buyer. During amendment, release only the excess principal and corresponding unused reserve; keep the retained principal and its fee reserve in escrow.

Preserve per-milestone principal conservation and whole-system accounting after every transition. Separate network rent/gas, account-creation costs and token balance handling from service principal. Do not allow a account-close/rent-refund path to redirect principal.

Before selecting a live token, review its issuer controls, account restrictions, decimals, transfer behavior and fee/extension compatibility. Reject unsupported transfer-tax or rebasing behavior rather than assuming a quoted amount will arrive unchanged. No such live-token validation exists in the demo.

## 6. Application security and evidence

Replace the demo identity picker with authenticated sessions, validated wallet ownership, account-linking rules, CSRF protection and narrowly scoped authorization. Do not accept a client-supplied actor ID as proof of authority. Separate listing moderation, support, evidence review and custody decision permissions.

Use a transactional production database, unique command nonces, optimistic concurrency, durable jobs and idempotent event processing. Store request and transaction states separately so retries do not imply duplicate funding or payouts. Index chain events with reconciliation and finality-aware status; do not display a server-side success response as final settlement.

Evidence should be private by default. Implement object storage authorization, signed limited-lifetime access, upload limits, content-type checks, malware scanning, retention/deletion policies and reviewer access logs. Avoid secrets in messages. Hash commitments can support later integrity checks without publishing private documents, but do not prove that the content is true.

The current demo displays all evidence to all simulated identities through its state endpoint and has no attachment upload pipeline. It must not be deployed as a private case-management system.

## 7. Resolver operations and remaining trust

Use a separately protected resolution authority with narrowly defined actions. For material amounts, require multiple authorized reviewers or a pre-agreed escalation policy. Preserve each rationale and identify which milestone it affects. Require conflict-of-interest checks, evidence response deadlines and a documented complaint route.

Fixed recipients limit diversion but do not prevent wrongful release to the original counterparty. The service must disclose that human resolution remains a source of trust. Never describe subjective service-quality decisions as mathematically verified by the blockchain.

Do not reward reviewers based on fees collected or which side wins. Publish how dispute charges, refunds and negotiated cases are handled. Customer-support costs must be covered even when policy changes return a valid claimant's charge.

## 8. Required test families before real money

Carry the local state-machine tests into the selected chain's test framework and add adversarial accounts, wrong assets, recipient substitution, account ownership, duplicate funding, replayed signatures, stale proposal acceptance, two-party collusion against invariants, unsupported token behavior, arithmetic extremes, fee rounding, race conditions, timeout execution, resolver unavailability and unauthorized upgrades.

Test all core flows against the deployed testnet program with real wallet signatures, API authentication, private evidence controls and event reconciliation. Have independent reviewers validate custody, authority and policy implementation. Existing tests verify a simulation, not those properties of an unbuilt contract.

Mainnet readiness also requires operational monitoring, backups, incident response, recovery drills, a supported-services policy, sanctions/identity requirements as applicable, fee disclosure and jurisdiction-specific legal review. Final network, asset, resolver fallback, fee cap and immutable-core policy are still decisions to make.
