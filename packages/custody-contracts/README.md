# Custody contract reference quote

This directory contains a dependency-free **reference-only** economic quote
and a separate unsigned custody-intent builder for Escrow Global's future
Solana custody layer. The intent builder validates Solana address shape,
allowlisted networks/token programs, fixed parties, terms commitments, and
derives each 3% reserve from principal. Neither module is a smart contract,
RPC client, wallet adapter, transaction signer, broadcaster or payment
confirmation service.

## Technology decision

The current custody design uses a direct on-chain Anchor escrow program with
legacy SPL Token CPI. It does **not** use Solana Private Channels as the core
settlement layer. Private Channels is a separate state-channel architecture
with an on-chain Escrow/Withdraw pair, off-chain Gateway/Auth services and
operator-mediated Sparse Merkle Tree settlement; Solana's overview also warns
that it has not been security audited. It may be evaluated later as an
optional privacy/throughput lane, but it would introduce a different trust,
operations and reconciliation model than this marketplace escrow.

The Anchor program now includes an immutable `DeploymentConfig` PDA. Its
one-time `initialize_config` ceremony is authorized by the deployed program's
upgrade authority through `ProgramData` and requires fee-recipient consent;
it stores one or two exact accepted mint addresses, and agreement
initialization reads that PDA instead of trusting a caller-supplied treasury
account. This deployment-bound mint policy prevents a release from silently
accepting the wrong cluster's stablecoin identity. Initialize the config before
revoking upgrade authority.

## What it does

`quoteFunding()` calculates the initial amount required by the current sandbox
reference policy:

```text
reserve = floor(principal × 300 / 10,000)
total = principal + reserve
```

`deriveDisputeCharge()` separately calculates the non-refundable formal-dispute
charge as `floor(principal × 500 / 10,000)`. The on-chain dispute instruction
collects this from the opening party's own token account; it is never taken
from escrow principal or the 3% reserve.

All amounts are decimal strings in token base units. Arithmetic uses `BigInt`.
USDC and USDT are kept as separate assets. Each milestone is rounded
independently before totals are added.

For `450000000` base units:

```text
principal = 450000000
reserve   = 13500000
total     = 463500000
```

## Explicit non-goals of the reference quote

- No Solana addresses, PDAs, token accounts or mint verification
- No terms-signature or wallet-authority verification
- No transaction construction, signing, serialization or broadcast
- No balance crediting, escrow funding, release, refund or dispute execution
- No provider, database, browser or server integration

The result always includes `broadcastable: false`, `authorizationVerified: false`
and `fundingVerified: false`. The existing sandbox server's live escrow endpoint
must remain HTTP 501 until the audited custody program and reconciliation
service exist.

`src/custody/intent.mjs` now produces a deterministic unsigned envelope for a
future client adapter, but only when supplied a network-qualified deployment
manifest containing the program ID, genesis hash and fixed fee recipient. It
does not prove wallet authority: the `authorization`
field is a declared signer, not a signature. The Anchor program must re-check
all fields and the wallet must sign the final transaction. Its action map now
covers seller acceptance, explicit disputes with fixed-arbiter outcomes,
Common Ground consent, claims, refunds and close.

`src/custody/common-ground.mjs` provides the matching non-signing Common Ground
calculator and proposal hash checks. It is useful for client previews only;
the on-chain proposal account remains the source of payment authorization.

The original intent path remains limited to one milestone for compatibility
with the single-principal Anchor slice. The program source now also contains a
bounded V2 multi-milestone surface (up to 16 independent milestone PDAs and
vaults), and `src/custody/intent.mjs` produces unsigned V2
initialization/action envelopes including the separate 5% dispute charge. The
rebuilt ABI and the SBPF v2 compatibility lifecycle pass locally. The exact
SBPF v3 release-artifact probe is separately blocked by the pinned
ProgramTest loader before instruction execution, and audit, deployment and
live custody remain gated.
Token-2022 is also rejected; see `docs/policy-token-program.md`.

`src/custody/transaction-lifecycle.mjs` models signing, submission, finality,
failure, expiry, cancellation, and safe retry without contacting an RPC. It is
the state layer for a future wallet adapter, not a claim that a transaction was
sent or finalized.

`src/custody/reconciliation.mjs` is the matching pure verification boundary for
that future adapter. It accepts only a normalized finalized observation whose
program, agreement, buyer, mint, legacy SPL Token program, vault, transfer and
exact amount all match the unsigned intent. It returns a creditable evidence
record but never writes the ledger or contacts Solana.

`src/custody/solana-reconciliation.mjs` is the dependency-injected RPC worker
boundary. It verifies the configured endpoint genesis hash, then fetches
signature status, parsed finalized transactions, and the program-owned base64
agreement account at a context slot no older than the funding transaction; it
requires the exact funding discriminator/account order and token-account owner,
and then delegates to the pure verifier. Its V1/V2 account
helpers verify the account owner and Anchor discriminator before extracting
identity commitments; the caller still must provide the expected genesis hash,
correct account addresses and an idempotent evidence recorder. No wallet or live
server route is enabled by this module.

`src/custody/solana-rpc.mjs` is the native read-only JSON-RPC transport for
that worker. It validates cluster-safe endpoint URLs, uses bounded requests,
checks JSON-RPC envelopes and errors, and exposes only finalized-read methods;
it deliberately has no `sendTransaction`, wallet, signing, or mutation API.

`src/custody/finalized-event-indexer.mjs` adds the durable projection boundary:
it discovers candidate signatures, rechecks status and transaction evidence at
`finalized` commitment, requires decoded events to bind to outer custody
instructions, and writes them through an atomic, idempotent repository. Its
PostgreSQL adapter stores only finalized JSON facts and a scan cursor; it does
not treat a browser callback, a cursor, or an RPC page as settlement proof.
`src/custody/anchor-event-decoder.mjs` supplies the default dependency-free
decoder for the generated Anchor IDL: it parses only declared `Program data:`
events and ties them to the outer custody instruction that emitted the log.

`packages/escrow-sdk/index.mjs` is the separate dependency-injected
instruction adapter. It derives the canonical V1/V2 PDAs and emits exact
Anchor instruction specifications without importing a wallet library or
signing/broadcasting. Its configuration pins the program, network, admitted
mint, legacy SPL Token Program, and fixed fee recipient.

`scripts/verify-custody-deployment-manifest.mjs` is the release-boundary check
for a future controlled deployment. It compares an approved manifest with the
exact Rust `declare_id!`, generated IDL bytes and SBF hash, requires the
network, deployment-config, fee-recipient and legacy SPL Token identities, and
verifies an out-of-band Ed25519 approval over the canonical manifest payload
against a separately supplied trusted approver public key.
It does not query the chain and is not deployment, audit or upgrade-authority
proof; it intentionally fails until a real reviewed and signed manifest exists.

## Test

From `D:\escrowglobal\pact-universal`:

```powershell
node --test tests/production/custody-contracts/reference-quote.test.mjs
npm test
```

The tests use independently hardcoded expected values. This module is not a
replacement for the later Rust/Anchor program or its adversarial program tests.

The generated files under `program/target` are build outputs, not a proof of a
current ABI. Run `npm run verify:custody:abi` from the repository root before
using any client artifact; it must report that the IDL, generated types and
SBF are newer than `programs/escrow-global/src/lib.rs` and contain the same
instruction names. A stale artifact is a release blocker.
