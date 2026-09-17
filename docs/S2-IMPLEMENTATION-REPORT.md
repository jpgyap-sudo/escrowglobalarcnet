# S2 terms-conformance report

**Date:** 2026-09-12  
**Scope:** canonical off-chain agreement commitments; no live custody or signature authority.

## Delivered

- Added `src/agreement.mjs` with deterministic key ordering, NFC Unicode normalization, finite-value checks, canonical JSON, and SHA-256 hashes.
- Added explicit canonicalization/hash algorithm versions, NIST boundary vectors, differential checks against Node crypto, cycle/surrogate/number rejection, and a hash-linked amendment history.
- New service and goods agreements store `termsHash`, `currentTermsHash`, `termsVersion`, and `termsHashHistory`.
- Invariants verify the current commitment on every state transition.
- Bilateral amendments update the current commitment only after the second party accepts; the original commitment remains unchanged.
- Served `/agreement.mjs` as a future client/SDK conformance surface.

## Verification

- `node --test tests/agreement.test.mjs tests/domain.test.mjs tests/universal.test.mjs`: 79/79 passed.
- Tests cover canonical key ordering, Unicode normalization, NIST SHA-256 boundaries, random differential hashing, invalid-value rejection, tamper detection, amendment hash rotation, and original-hash preservation.

## Boundary

These hashes are not wallet signatures, chain commitments, or proof of legal agreement. They are a shared serialization foundation for the future authenticated API and audited custody program. Legacy sandbox JSON without hashes remains readable for compatibility and must not be treated as historically signed production data.
