# Custody deployment evidence

The custody program is not deployed by this repository. Solana's documented
deployment flow builds an SBF artifact and then uses `solana program deploy`;
the resulting Program and ProgramData accounts, deployment transaction and
upgrade authority must be checked separately. This repository deliberately
keeps signing, key custody, RPC writes and deployment approval outside the
working tree.

## Prepare an unsigned release packet

After building the exact release artifact and generated IDL, prepare a
deterministic packet for an offline release approver:

```text
npm run build:custody:sbf
npm run build:custody:abi
npm run prepare:custody:manifest -- \
  --deployment-id escrow-mainnet-2026-09-14-01 \
  --network mainnet-beta \
  --genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
  --deployment-config-address <on-chain-config-address> \
  --fee-recipient <fixed-fee-recipient-address> \
  --allowed-mints <canonical-mint-address[,canonical-mint-address]> \
  --release-approval-id <audited-release-approval-id> \
  --deployment-signature <finalized-deployment-transaction-signature> \
  --deployed-at-slot <finalized-deployment-slot> \
  --upgrade-authority <approved-upgrade-authority-address> \
  --out custody-deployment-manifest.unsigned.json
```

The command is **read-only**: it never loads a keypair, signs, calls RPC,
broadcasts, or creates an approved manifest. It reads the local Rust source,
`Anchor.toml`, generated IDL and SBF bytes; it computes the exact IDL and SBF
hashes and cross-checks the program ID from `declare_id!`, the Anchor mapping
and the IDL. `--allowed-mints` must list the one or two exact stablecoin mints
that the immutable on-chain `DeploymentConfig` will admit for this deployment;
mainnet accepts only canonical mainnet USDC/USDT. `--upgrade-authority` may be omitted only when the intended
ProgramData authority is immutable.

The controlled ceremony must initialize the on-chain `DeploymentConfig` PDA
before transferring or revoking upgrade authority. After deployment, the
read-only proof also requires the authority account used by the canonical
upgradeable-loader deployment or upgrade instruction to be marked as a signer
in the finalized transaction message; account contents alone are not accepted
as authority consent. The verifier derives the config PDA from the exact
`deployment-config` seed, checks the program-owned Anchor account discriminator,
length and bump, and matches its immutable fee recipient and accepted mint list
to the approved manifest. A manifest-supplied config address, fee recipient or
mint list is not accepted
without this finalized account evidence.

The packet contains `manifest.approval: null` and a base64-encoded,
domain-separated `approvalPayload` plus its SHA-256 hash. The manifest also
records the exact SBF byte length. The controlled
approver must review the operating/audit evidence and sign the canonical
payload out of band, then produce the exact approved manifest expected by
`npm run verify:custody:manifest`. The trusted approval public key must be
provided separately to that verifier; an embedded self-signature is not
trusted.

## Required metadata

| Option | Constraint |
| --- | --- |
| `--deployment-id` | Non-empty release identifier, maximum 128 characters |
| `--network` | `devnet`, `testnet`, or `mainnet-beta` |
| `--genesis-hash` | Canonical 32-byte base58 Solana cluster identity; mainnet must use the pinned identity |
| `--deployment-config-address` | Canonical non-zero 32-byte PDA derived from the program ID and exact `deployment-config` seed |
| `--fee-recipient` | Canonical non-zero 32-byte base58 address |
| `--allowed-mints` | One or two canonical non-zero mint addresses; mainnet is limited to canonical mainnet USDC/USDT |
| `--release-approval-id` | Non-empty auditable approval identifier, maximum 128 characters |
| `--deployment-signature` | Canonical 64-byte base58 transaction signature |
| `--deployed-at-slot` | Non-negative safe integer slot |
| `--upgrade-authority` | Optional canonical address; omit for immutable ProgramData |

`artifactLength` is generated from the exact SBF file and is signed with the
manifest. The on-chain verifier hashes exactly that many bytes after the
loader's fixed 45-byte ProgramData metadata region and requires any remaining
allocated bytes to be zero, so an account sized for future upgrades cannot
silently change the artifact identity.

Input paths can be overridden with `--source`, `--anchor-toml`, `--idl` and
`--artifact`. Without `--out`, the packet is emitted to stdout. Existing output
files are never overwritten.

This packet is artifact consistency evidence only. It is not proof of a live
deployment, audit, legal approval, or production readiness. The on-chain
read-only check remains `npm run verify:custody:onchain -- --manifest ...` and
requires a real approved manifest, trusted approval key and approved finalized
RPC endpoint.
