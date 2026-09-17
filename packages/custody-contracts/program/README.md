# Escrow Global custody program · bilateral safety slice

This directory contains the first compileable Anchor custody boundary. It is
**not deployed, audited, or enabled by the web application**.

## What this slice enforces

Current Anchor instruction surface begins with the one-time `initialize_config`
deployment ceremony, followed by `initialize`, `seller_accept`, `amend_terms`,
`cancel_unfunded`, `fund`, `seller_submit`, `buyer_approve`,
`open_dispute`, `arbiter_release`, `arbiter_refund`,
`execute_review_timeout`, `propose_common_ground`, `approve_common_ground`,
`execute_common_ground`, `resolve_common_ground_remainder`,
`close_common_ground_proposal`, `bilateral_refund`, `claim_late_refund`,
`claim_seller`, `claim_fee`, `claim_buyer_refund`, and `close_escrow`.

The V2 instruction surface is: `initialize_v2`, `create_milestone_v2`,
`cancel_milestone_v2`, `seller_accept_v2`, `amend_terms_v2`,
`fund_milestone_v2`, `seller_submit_milestone_v2`,
`buyer_approve_milestone_v2`, `execute_milestone_review_timeout`,
`open_milestone_dispute_v2`, `arbiter_release_milestone_v2`,
`arbiter_refund_milestone_v2`, `bilateral_refund_milestone_v2`,
`claim_milestone_late_refund_v2`, `claim_milestone_seller_v2`,
`claim_milestone_fee_v2`, `claim_milestone_buyer_refund_v2`,
`close_milestone_v2`, and `close_escrow_v2`.

`seller_accept_v2` emits a dedicated `V2SellerAccepted` event so a finalized
indexer can observe the parent authorization transition instead of guessing
from an account delta.

- One immutable `DeploymentConfig` PDA per program, initialized only by the
  deployed program's upgrade authority and a consenting fee-recipient signer.
  It fixes the treasury before any agreement can be opened; there is no update
  instruction. The deployment operator must initialize it before transferring
  or revoking upgrade authority.
- One agreement PDA per `(buyer, agreement_id_hash)` using `escrow` seeds.
- Fixed buyer, seller, arbiter, fee recipient, mint, and vault identities.
- Agreement initialization reads the immutable deployment config rather than
  accepting a caller-supplied fee destination. SDK intents still pin the
  manifest fee recipient for client-side policy and recovery checks.
- The fixed arbiter must also sign initialization, proving consent to the
  dispute authority assignment before the agreement can be funded.
- Non-zero agreement/terms commitments and distinct buyer/seller/arbiter roles.
- Exact 3% reserve calculation with a `u128` intermediate and checked totals.
- Original SPL Token only; Token-2022 is intentionally rejected at runtime
  until its extension policy is separately reviewed. The `token_2022` Anchor
  SPL feature is enabled only because Anchor 0.31's generated `token::`
  initializer contains a compile-time account-sizing branch; the program's
  account types remain `Program<Token>`/legacy `TokenAccount` and do not
  accept Token-2022 accounts.
- `Created → Accepted → Funded → Submitted → Approved → SellerPaid → Closed`,
  with `Submitted → Disputed → Approved|Refunded` for arbiter resolution.
- The buyer can cancel an empty escrow from `Created` or `Accepted`.
- Bilateral refund from `Funded` or `Submitted` requires both
  buyer and seller signatures in the same transaction after funding.
- Funding, delivery, and review deadlines are committed at initialization;
  late funding/submission is rejected, late no-delivery refund is buyer-only,
  and review-timeout release is available only when explicitly enabled.
- Either original party can open an explicit dispute after submission. Only
  the fixed arbiter can then choose the bounded all-seller release or all-buyer
  refund outcome; arbitrary splits are not supported by this slice. Opening
  a dispute atomically charges the opener a separate, non-refundable 5% fee
  on the currently held principal to the fixed fee recipient; it never comes
  from the escrow vault.
- Common Ground proposals are exact, expiring, two-party approvals for a
  partial allocation, with any remainder kept unresolved until a bilateral
  decision. A proposal is never payment consent until both original parties
  approve the same on-chain proposal account.
- Independent seller, fee, and buyer-refund claims, so one unavailable token
  account cannot silently mark every payout as complete.
- Separate `close_escrow` rent-recovery instruction after all entitlements are
  zero and the token vault is empty.
- Terms commitment stored on the agreement account.
- Both original parties can amend the terms commitment before funding; the
  amendment returns the agreement to `Created` and requires the seller to
  accept the new commitment again. Funded agreements cannot be amended.
- Non-zero agreement/terms commitments and an arbiter distinct from buyer and seller.
- No arbitrary destination, privileged sweep, pooled balance, or browser actor.
  The only dust path is a terminal, buyer-bound return after every ledger
  entitlement is zero.
- Exact vault balance delta checks that reject fee-on-transfer behavior rather
  than silently accounting an unexpected amount.
- Fee claim is ordered after the seller principal claim.

The V2 multi-milestone boundary is also present in the program source. It
includes `initialize_v2`, `amend_terms_v2`, and the bounded milestone action
surface, creating a bounded `MultiEscrow` plus one `MilestoneV2` PDA and token vault per
milestone (maximum 16), with independent deadlines, funding, submission,
approval/dispute resolution, late no-submission refunds, claims, and rent cleanup. Milestones must be
created contiguously before seller acceptance; unfunded milestones can be
cancelled independently; a disputed milestone does not freeze other
milestones. This V2 surface is source-complete for the bounded
slice and passes the isolated SBPF v2 compatibility lifecycle tests. The
fresh SBPF v3 release artifact still requires a compatible runtime probe,
independent audit and deployment review.

V2 includes `claim_milestone_late_refund_v2`, which is buyer-only and can run
only after the milestone delivery deadline when the milestone is still
`Funded`; submitted work must use the review or dispute path. The aggregate
`close_escrow_v2` action is available only after every milestone account has
been closed or cancelled.

The independent `packages/escrow-recovery` boundary provides a login-free
Escrow Passport verifier. It accepts only finalized, owner-verified and
state-verified evidence, checks exact milestone conservation, and exposes
claimable amounts without signing or submitting a transaction.

The finalized reconciliation worker recomputes canonical PDA bindings for
both protocol versions. Its V2 parent/milestone reads use one finalized
`getMultipleAccounts` snapshot so a recovery or indexer process cannot combine
account data from different RPC contexts. This validates evidence outside the
program; it does not replace on-chain constraints or an independent audit.

V2 also exposes `amend_terms_v2`. It records the first-funded-milestone
 counter on `MultiEscrow`, so terms cannot be amended once any milestone has
 received canonical funding even though the parent remains in `Accepted`.

Admitted mints are hard-coded in the program: Circle USDC mainnet
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, Tether USDt mainnet
`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, and Circle USDC devnet
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. A deployment must still
select the correct network and verify these addresses independently. The
`test-mints` escape hatch is accepted only in debug builds used by the local
lifecycle harness; release/SBF builds enforce this allowlist even if the test
feature is accidentally passed.

## What it does not yet prove

This is not the complete production protocol. The V2 milestone surface is
included in the fresh SBPF build and covered by the isolated ProgramTest
lifecycle harness. `npm run test:custody:sbf` builds a fresh SBPF v2
compatibility artifact in `target/sbf-test-v2` and runs the harness against
it; `npm run test:custody:sbf:release` probes the exact SBPF v3 artifact in
`target/deploy`. The native harness remains available through the direct
Cargo command for fast local iteration. A live cluster lifecycle remains
unverified. The repository does not yet provide
backup resolver phases, goods/return/warranty-specific gates, a full
arbitrary-transfer quarantine policy beyond the buyer-bound recovery paths, a
connected production wallet/API adapter, or a deployed local/devnet lifecycle.
Canonical funding deliberately rejects a non-empty vault so unsolicited
pre-funding tokens cannot be mixed into the deposit; an explicit
`recover_prefunding_dust` or `recover_milestone_prefunding_dust` action can
return that unsolicited balance only to the original buyer before funding.
Unsolicited post-funding tokens are observed as non-entitled balance by the
finalized projection boundary. Once the escrow or milestone is terminally
closed and every entitlement is zero, `sweep_unentitled_dust` or
`sweep_milestone_unentitled_dust` can return only that residual balance to the
original buyer, allowing the vault to close.
Production schema, event-indexing, finalized account projection and
reconciliation boundaries are present as injected adapters, but they are not
connected to a production database/service and are not evidence of deployment.
These remaining controls must be added, tested and audited before any
real-money flag can change.

The `declare_id!` value is a generated local-development identity only. The
matching keypair is an ignored build artifact and must never be treated as a
production deploy key. Replace the source ID and `Anchor.toml` mapping together
with an approved, separately controlled program keypair before any deployment;
this repository does not contain a deploy key or deployment configuration. A
local SBF artifact is generated at `target/deploy/escrow_global.so` and an IDL at
`target/idl/escrow_global.json`; after source changes, rebuild before treating
those generated files as matching the current ABI. Any generated keypair is
only a local build artifact and must not be used for production.

## Reproducible container commands

From the repository root, the pinned build container is:

The deployable workspace intentionally contains only the Anchor program. The
heavier `ProgramTest` lifecycle harness is an excluded, independent workspace
with its own lockfile so test-only Solana bank dependencies cannot silently
become SBF program dependencies. Generate and validate that lockfile from the
`tests/lifecycle` directory before running the lifecycle suite. The lifecycle
lockfile pins `solana-program-test`/`solana-sdk` 2.3.1 to stay compatible with
the deployable program's Solana 2.3 syscall family; do not mix it back with the
older 2.2.7 bank harness.

```text
docker run --rm -v D:\\escrowglobal\\pact-universal\\packages\\custody-contracts:/work -w /work/program solanafoundation/anchor:v0.31.1 cargo test --locked
docker run --rm -v D:\\escrowglobal\\pact-universal\\packages\\custody-contracts:/work -w /work/program/tests/lifecycle solanafoundation/anchor:v0.31.1 cargo test
docker run --rm -v D:\\escrowglobal\\pact-universal\\packages\\custody-contracts:/work -w /work/program solanafoundation/anchor:v0.31.1 anchor build
```

The commands above compile or test only. They do not deploy, sign, broadcast,
or move tokens.

To refresh the host-side ABI artifacts from the pinned Anchor program without
the Anchor CLI, run `npm run build:custody:abi` from the repository root. On
Windows, run it from a Visual Studio developer shell if the Rust linker is not
already on `PATH`; then run `npm run verify:custody:abi`. This refreshes only
the IDL and TypeScript helper. It does not create or refresh an SBF binary.

The current release toolchain targets SBPF v3. From the repository root, use
`npm run build:custody:sbf` to invoke `cargo-build-sbf --arch v3` with the
program workspace and output path pinned. The deployable crate pins the
Solana 2.3 syscall family; do not treat the existing `.so` as current until
this command completes and `npm run verify:custody:abi` passes.

After rebuilding, run `npm run test:custody:sbf` to build and execute a SBPF v2
compatibility artifact from the current source in the lifecycle ProgramTest.
This is the passing source-level runtime gate while the pinned Solana 2.3.1
ProgramTest loader rejects the release SBPF v3 artifact before execution. Run
`npm run test:custody:sbf:release` to probe the exact `target/deploy` artifact;
until the loader/toolchain is upgraded, its failure is recorded by
`programTestRuntimeVerified: false` in `RELEASE.json`. Both commands fail
closed when the selected artifact is absent or empty, and keep the test-only
SPL Token processor native. Neither is evidence of devnet/mainnet deployment,
upgrade-authority control, or audit.
