# Escrow Global Passport / recovery boundary

This package is an independent, login-free verifier for a **finalized RPC
evidence bundle**. It validates deployment identity, mint admission, canonical
V2 agreement/milestone/vault PDA bindings, legacy-token transfer evidence,
milestone economics, entitlements and conservation. The evidence bundle must
be produced by a strict finalized chain worker; this package does not turn
self-asserted booleans into chain proof. It exposes claimable amounts without
choosing a recipient.

The current passport envelope commits `pdaScheme: "v2"`; V1 single-vault
recovery is intentionally not silently inferred from this milestone schema.

It does not contact Solana, sign, submit, or treat a browser snapshot as proof.
A real recovery client must obtain finalized account data and then pass the
same audited SDK instruction to the wallet that controls the original party.
