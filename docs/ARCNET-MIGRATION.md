# Escrow Global Arc Network migration

This repository is the separated Arc Network build line. It currently contains the existing Escrow Global sandbox and Solana custody-readiness reference; it is **not** an Arc onchain deployment.

## Current boundary

- The static GitHub Pages deployment is a browser-only demo with no backend, wallet signing, custody, or shared ledger.
- The existing `packages/custody-contracts` implementation is Solana/Anchor-specific and must not be presented as an Arc deployment.
- No production private key, Circle entity secret, Arc deployer, or customer funds belong in this repository.

## Arc target

The Arc implementation should use the official Arc EVM stack: Solidity with standard EVM tooling, USDC as the gas token, explicit chain configuration, receipt-based transaction lifecycle, and current Arc/Circle contract-address references. Arc-specific runtime differences must be read before implementing balances, transfers, gas estimation, or event indexing.

Start with the [Arc documentation index](https://docs.arc.io/llms.txt), then read:

- [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc.md)
- [EVM differences](https://docs.arc.io/arc/references/evm-differences.md)
- [Contract addresses](https://docs.arc.io/arc/references/contract-addresses.md)
- [Deploy on Arc](https://docs.arc.io/integrate/deploy-on-arc.md)
- [Circle Wallets](https://developers.circle.com/wallets/supported-blockchains)

## Recommended migration slices

1. Define an Arc-native escrow state machine and immutable agreement terms; do not port Solana PDAs or account layouts into Solidity by analogy.
2. Add typed Arc network and asset configuration with environment-specific addresses resolved from the official references.
3. Implement and test the contract locally first, including access control, reentrancy, replay protection, amount precision, dispute boundaries, and deterministic settlement accounting.
4. Add a read-only RPC/indexing adapter and a separate signing/broadcast boundary. Keep Circle Wallets, App Kit, Gateway, and CCTP integrations isolated behind interfaces.
5. Run an explicitly authorized Arc Testnet smoke test with testnet USDC only, verify receipts/events in the Arc explorer, and update release evidence.
6. Do not call the system production-ready until key management, authentication, reconciliation, monitoring, audits, legal review, and an approved deployment manifest are complete.
