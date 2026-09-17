# S1 implementation report

**Date:** 2026-09-12  
**Scope:** sandbox reliability and actionable moderation; no live-money or custody changes.

## Delivered

- Durable command idempotency records in `server.mjs` (old entries are no longer evicted).
- Actor-scoped stable browser operation IDs with an offline-safe fallback in `public/app.mjs`.
- Lost-response retry regression in `tests/browser_http.py`; the first committed order is replayed rather than duplicated.
- Product publication guards in `src/universal-domain.mjs` so delivery and warranty tranches cannot be below 1 demo USDC.
- Report moderation workflow in `src/universal-domain.mjs` and `public/universal-ui.mjs`: hide, pause, dismiss, reinstate, reason/history, and funded-deal balance invariance.
- Regression coverage in `tests/api.test.mjs`, `tests/universal.test.mjs`, `tests/payments.test.mjs`, and `tests/browser_universal.py`.
- Rebuilt `pact-preview.html`, `escrow-global-preview.html`, and mobile bundled assets.

## Verification

| Command | Result |
|---|---|
| `npm test` | 116/116 passed |
| `node --test tests/universal.test.mjs tests/api.test.mjs tests/payments.test.mjs` | 63/63 passed |
| `python tests/browser_universal.py` | 44/44 passed |
| `npm run test:browser:http` | passed; 1 order before/after lost response/retry remained one new order |
| `npm run build:mobile` | completed; native binaries were not compiled |
| `python tests/qr_reference.py` | not run: optional Python `qrcode` package is absent |

## Explicit boundary

This is still a local, switchable-identity sandbox. It has no production authentication, database authorization, private evidence storage, chain escrow program, finality/reconciliation worker, or country eligibility engine. Do not accept customer deposits or market it as live decentralized custody.

## Operations

No Git repository or commit exists in this workspace, so no post-commit hook verification was applicable. Learning capture was stored in the local fallback queue because Central Brain was unreachable.
