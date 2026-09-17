# Escrow Global instruction SDK boundary

`index.mjs` is a dependency-injected, read-only adapter for the current
Anchor program. It derives the V1/V2 PDAs and encodes exact Anchor
instruction bytes for every current Rust instruction, including Common Ground,
timeouts, cancellation, claims and close paths.

The SDK deliberately does **not** import `@solana/web3.js`, contact an RPC,
fetch accounts, create transactions, sign, submit, simulate, or mutate a
ledger. A caller must inject an audited `PublicKey` implementation with
`findProgramAddressSync` and a SHA-256 function. The returned frozen
instruction specification still requires independent on-chain state checks,
wallet review/signature, finality handling, and reconciliation.

The current protocol is legacy SPL Token only. Configuration pins the program
ID to the IDL/network manifest, requires the deployment manifest's cluster
genesis hash, admits only explicitly configured mints, and pins the fee
recipient. V2 milestone indexes use the exact little-endian
`u16` PDA seed used by the Rust program.

The SDK also builds bilateral `amend_terms` and `amend_terms_v2` operations.
Both buyer and seller are required signers, and the on-chain program accepts
the amendment only before funding; callers must then obtain fresh seller
acceptance for the new terms hash.

`operation-boundary.mjs` adds a second, still side-effect-free gate before a
wallet adapter receives an operation. It requires an explicit fee payer,
allowed signer set, canonical account set, writable-account subset, action
allowlist and exact Anchor discriminator/data lengths. It does not accept raw
transactions and cannot sign or submit them.

```js
const sdk = createEscrowSdk({
  network: 'devnet',
  programId,
  genesisHash,
  idlAddress: programId,
  expectedProgramIds: { devnet: programId },
  allowedMints: { devnet: [usdcMint] },
  fixedFeeRecipient: feeWallet
}, { PublicKey, sha256Hex });

const spec = sdk.fundV2({
  buyer, mint, agreementIdHash, milestoneIndex: 0,
  buyerTokenAccount
});
```

This is not evidence that a transaction was sent or that funds are in a
vault. Live custody remains gated until the rebuilt ABI, runtime tests,
authenticated API, finalized-state worker, audit, and deployment ceremony are
complete.

The externally signed transaction handoff is implemented separately at
`src/custody/external-wallet-boundary.mjs`. It accepts no key material, keeps
the sandbox server disabled, and requires a production release board plus a
durable operation repository with compare-and-set relay claiming before it can
prepare or relay bytes. `src/custody/postgres-operation-repository.mjs` is the
parameterized PostgreSQL journal adapter: it persists the reviewed request and
full lifecycle attempt with tagged PublicKey/byte encoding and atomically
claims the `relaying` state. It is not wired into the sandbox server or a live
deployment.
