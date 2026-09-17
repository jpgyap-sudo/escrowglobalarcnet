# Escrow Global capability matrix

> Machine-rendered from `docs/capabilities.json`. “Proven” means locally evidenced only; it does not mean deployed, audited, or safe for real funds.

| Capability | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Canonical V1/V2 PDA derivation and account binding | **Proven** | `packages/escrow-sdk/index.mjs`<br>`tests/escrow-sdk.test.mjs`<br>`tests/account-projection.test.mjs` | Pure derivation and binding checks are covered locally; this is not proof of a deployed program or live accounts. |
| SBPF v2 compatibility lifecycle execution | **Proven** | `scripts/run-custody-sbf-tests.mjs`<br>`packages/custody-contracts/program/tests/lifecycle/src/lib.rs`<br>`docs/IMPLEMENTATION-STATUS.md` | The compatibility artifact reaches the program through the pinned local ProgramTest harness and passes the six lifecycle cases. |
| Deterministic custody property-style regression coverage | **Proven** | `packages/custody-contracts/program/programs/escrow-global/src/lib.rs`<br>`docs/IMPLEMENTATION-STATUS.md` | Fixed-seed tests cover fee arithmetic, deadline boundaries, and initialization role/hash/mint constraints; they are not coverage-guided fuzzing or an independent audit. |
| Fresh SBPF v3 release-artifact lifecycle execution | **Probe blocked** | `scripts/run-custody-sbf-tests.mjs`<br>`scripts/probe-custody-release-sbf.mjs`<br>`packages/custody-contracts/program/README.md`<br>`RELEASE.json` | The fresh v3 artifact is rejected before instruction execution with UnsupportedProgramId by the pinned Solana 2.3.1 ProgramTest loader. A compatible validator/runtime probe is required before release approval. |
| Live escrow funding API | **Intentionally disabled** | `server.mjs`<br>`tests/auth-feature-gates.test.mjs`<br>`tests/payments-api.test.mjs` | The route returns HTTP 501 and the server only accepts ESCROW_MODE=sandbox; it cannot sign, broadcast, or move real funds. |
| Approved deployment identity, network manifest, and live cluster | **Intentionally disabled** | `scripts/verify-custody-deployment-manifest.mjs`<br>`scripts/verify-custody-onchain.mjs`<br>`tests/custody-deployment-manifest.test.mjs`<br>`docs/PRODUCTION-ROADMAP.md` | The read-only on-chain verifier can prove a supplied manifest with an Ed25519 approval matching a separately supplied trusted approver key against finalized RPC evidence, but no deployment manifest, funded authority, approved RPC, or release approval was supplied; it fails closed rather than inventing one. |

Generated files are evidence indexes, not a deployment approval or an on-chain attestation.
