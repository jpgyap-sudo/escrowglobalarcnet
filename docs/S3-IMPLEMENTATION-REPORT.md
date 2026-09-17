# S3 account-session foundation report

**Date:** 2026-09-12  
**Scope:** wallet-first account session primitives; no custody or escrow-command authorization.

## Delivered

- Added `src/integrations/account-auth.mjs` with a separate `WalletAccountSessions` class.
- Login challenges are origin-bound, nonce-bound, expiring, scope-limited, and explicitly state that they do not approve agreements or transfers.
- Signatures are verified against the wallet's Ed25519 public key; challenges are consumed before verification to prevent replay probing.
- Sessions use HttpOnly/SameSite cookies through `/api/auth/challenge`, `/api/auth/verify`, `/api/auth/session`, and `/api/auth/logout`.
- Existing `WalletProofs` on-ramp purpose remains unchanged.
- Sandbox command authorization remains demo-identity based by design; account login is not silently treated as party authorization.

## Verification

- `node --test tests/account-auth.test.mjs tests/account-auth-api.test.mjs`: 5/5 passed.
- Full verification: `npm test` 126/126, `npm run build:mobile`, offline browser 44/44, and HTTP retry regression passed.

## Boundary

Sessions are currently in-memory and loopback-only. Production still needs persistent wallet bindings, HTTPS deployment, database transactions, resource authorization, account recovery policy, rate limiting, audit logging, and separate signed party approvals.
