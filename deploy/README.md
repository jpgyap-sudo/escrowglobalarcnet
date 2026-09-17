# Showing the website safely

## Local full demo

Use `npm start` on the operator’s computer. It serves the website plus a **loopback-only** sandbox API and persists fictional orders locally. Do not publish that API through a reverse proxy, public tunnel or VPS port: its identities are intentionally switchable and it has no production account authorization.

## Static presentation deployment

To share the browser-only demonstration on your own HTTPS static host, run:

```sh
npm run build:preview
```

Copy `escrow-global-preview.html` to your host as `index.html`. No backend, secret key or database is needed for that demo. Keep the sandbox banner and disclosure intact. Each visitor has independent browser-local demo data, not a shared live marketplace. Use no real customer or sensitive information.

Before sharing a generated bundle, run `npm run verify:manifest` and `npm run test:packaging` from the repository root. The manifest check uses canonical text line endings and exact binary hashes, so it is stable across Windows and Linux checkouts.

## Historical GitHub Pages snapshot

The previously verified [GitHub Pages preview](https://jpgyap-sudo.github.io/escrow-global/)
is a static sandbox snapshot from the release metadata. It does not expose the
local API, enable live custody, or prove a Solana program deployment. The
current branch intentionally contains no public Pages workflow, so new public
snapshots are not published automatically. If public hosting is re-enabled,
run `npm run verify:manifest` and `npm run test:packaging` first, and preserve
the sandbox banner and disclosure.

The static page cannot create server-signed MoonPay sessions. The opt-in Jupiter widget is an external tool and may use a real wallet; either leave its warnings intact or disable external financial features in the preview you share. An external swap still cannot fund an Escrow Global escrow.

## Real customer deployment

Read `docs/PRODUCTION-ROADMAP.md` before building a public service. The current package deliberately provides no one-command deployment that presents a localhost simulator as live financial infrastructure. Real accounts, multi-tenant storage, custody, signatures, reconciliation, operator processes and security review must come first.

## Read-only deployment verification

After an approved deployment ceremony creates a real
`custody-deployment-manifest.json`, independently verify it against finalized
RPC evidence without exposing a key or enabling the sandbox API:

```sh
npm run verify:custody:onchain -- --manifest custody-deployment-manifest.json --approval-key <trusted-approval-public-key> --rpc https://your-approved-rpc.example
```

The command checks the network genesis identity (pinned for persistent mainnet
and matched from the approved manifest for resettable devnet/testnet), the
upgradeable-loader Program and
ProgramData accounts, deployment slot and deployment transaction. The manifest
must carry an out-of-band Ed25519 approval over the canonical manifest payload;
it may contain a real upgrade authority or explicit `null` for an immutable
ProgramData account. It returns `blocked` when the manifest or evidence is
missing and does not sign or broadcast transactions. The current repository
intentionally has no approved manifest, so this command must fail closed here.
The manifest also signs the exact SBF byte length; the verifier hashes that
length after the fixed ProgramData metadata region and rejects non-zero
allocated padding.

The approval envelope is exactly:

```json
{
  "alg": "Ed25519",
  "signedScope": "escrow-global/custody-deployment-manifest/v2",
  "publicKey": "<base58 32-byte public key>",
  "signature": "<base58 64-byte signature>"
}
```

Sign the bytes returned by `custodyDeploymentManifestApprovalPayload` in a
separate controlled approval environment. Supply the corresponding trusted
public key with `--approval-key` or `CUSTODY_APPROVAL_PUBLIC_KEY`; never add a
deployment private key to this repository or its scripts.
