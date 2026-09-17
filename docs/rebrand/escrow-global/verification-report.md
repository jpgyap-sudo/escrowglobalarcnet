# Escrow Global Settlement — implementation and verification

**Completed:** 2026-09-12 · **Release:** 0.3.0 · **State schema:** 3  
**Scope:** implemented local/offline sandbox rebrand and independent USDT/USDC pricing. **Not live escrow, production authentication, a regulatory review or a deployment.**

## Delivered

- Escrow Global Settlement identity across header/footer, pages, wallet copy, guides, metadata/Open Graph, PWA, app icons and native display surfaces. Short lockup: **Escrow Global / Settlement**. Package: `escrow-global-settlement-sandbox`.
- Navy/teal/mint semantic CSS tokens; consistent sans typography, controls, panels, marketplace, agreements, dialogs, wallet and responsive navigation. Product-material/illustration colors and meaningful warning/error colors remain intentionally distinct.
- Two generated and visually reviewed illustrations, optimized as WebP: hero **69,556 bytes**, agreement milestones **52,402 bytes**, each 1536×1024. New SVG globe/EG identity and 192/512/1024 px raster app icons. Prices, asset badges and disclaimers remain HTML text.
- Seller quotes, product shipping, briefs, custom milestones, checkout and financial dialogs support USDT or USDC. Quotes may be independently offered in one or both assets; absent quotes never become zero-price purchases or automatic FX. Every order keeps its immutable selected asset and demo token.
- Separate micro-unit user balances, treasury fees and conservation per asset; fees, refunds, disputes, splits, returns, warranty and timeouts stay in that asset. Fractional amounts retain significant precision up to six decimals. Fresh demos explicitly seed two ledgers; migration does not.
- New browser/server migration, corruption recovery, raw export, backup-before-reset, stale-tab rejection and persistent memory-only warnings. The keyboard skip link now focuses main without changing the SPA route.
- Rebuilt `escrow-global-preview.html`, the byte-identical compatibility `pact-preview.html`, both native embedded HTML files and all ten exported tutorials. Primary HTML: **586,590 bytes**, comfortably below the 1.5 MiB target. No remote font or brand-image dependency.

## Evidence from the actual merged app

| Command / check | Result |
|---|---|
| `npm test` | **155 passed, 0 failed** — existing protections plus asset/migration/lifecycle coverage, agreement commitments and account sessions |
| `npm run test:browser` | **44 passed, 0 failed** — complete goods/service workflows and existing wallet/native guards; external plugin mocked |
| `npm run test:browser:http` | **1 passed** — discarded committed HTTP response retried without a duplicate agreement |
| `npm run test:rebrand` | **216 passed** — 18 routes × 6 widths (1440/1024/768/390/360/320) × 2 assets; no page errors, document overflow or visible old brand; USDT checkout/funding stayed USDT after header preference changed to USDC |
| `npm run test:storage` | **10 passed** — legacy USDC-only migration/actor preference, missing USDT quote, corrupt/future cache, exact raw export, backup/reset, stale tabs, HTTP backups/allowlist/501 and failed-startup preservation |
| `npm run test:packaging` | **6 passed** — exact compatibility/native builds, defined CSS variables, offline art, keyboard skip/focus/Escape, reflow and persistent storage-failure notices |
| `npm run test:qr` | **18 exact reference matrices passed** against Python qrcode 8.2; Unicode and payment-URI samples included |
| `npm run build:mobile`; `node scripts/export-guides.mjs` | Preview + both native source assets rebuilt; eleven tutorials available; no native binary compiled |

The final browser build was rerun after the skip-link/status correction. The final financial/server/wallet state passed the 155-test suite; subsequent edits were limited to the keyboard/status display, documentation, metadata and derived packaging. An independent check from the task **“Assess project potential and gaps”** also confirmed 155 Node tests, 44 browser checks and the HTTP retry case after the core merge.

Evidence is in [evidence](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/evidence). Desktop/mobile viewport and full-page screenshots were inspected. Eight main palette pairs meet targeted contrast thresholds (e.g. teal/white 4.75:1; muted/page 5.60:1; control border/white 3.26:1). This is **targeted QA, not a complete WCAG certification**. The 640 CSS-pixel, 2×-scale check is a reflow emulation, not a native browser-menu zoom test.

## Saved data and compatibility

- The pure migration validates before persistence. Legacy scalar state becomes USDC-only; USDT supply, balances and fees begin at zero and no USDT quotes are invented. Old order IDs, amounts, snapshots, events, commitments, replay signatures and inventory remain intact.
- Server migration preserves the exact original file bytes in an adjacent unique `pre-escrow-global-v3` backup before atomic replacement. Invalid or unknown state stops startup without replacing the original. Existing valid v3 files are not rewritten at startup.
- Browser state prefers `escrow-global-sandbox-v3`; only an absent new key permits legacy lookup. The old `pact-universal-sandbox-v2` data and actor key remain available. A corrupt new cache never triggers an old-cache fallback or automatic seed reset. If storage fails, the UI explicitly labels the session as memory-only and offers export.
- Tests used fictional fixtures and isolated temporary server files/browser contexts. **Existing operator saved-data files were not opened and migrated as part of this verification.** They will be validated/backed up when the operator starts the upgraded server. Export before changing offline file URLs; cross-file browser storage continuity is not guaranteed.
- Technical compatibility identifiers intentionally remain: `PACT_NATIVE`, `PACT_EMBEDDED`, `PACT_CHROMIUM`, `pact-dialog`, legacy cache keys, `pact_wallet`/`pact_account_session`, Android `app.pact.demo`, iOS `Pact` project/classes and the old preview filename. Hash domain separator `PACT_ORIGINAL_TERMS_V1` stays unchanged. Archived plans/test fixtures retain historical references; user evidence and third-party/legal ownership notices are not rewritten.
- Rollback after new USDT activity needs a forward-compatible reader or an explicitly restored pre-upgrade demo snapshot. Never coerce USDT into USDC or silently discard subsequent activity.

## Coordination, authoring and review

The actual root model identity was not independently exposed, so the Astra exemption was not assumed. DeepSeek bridge health was verified (`deepseek-chat`) and DeepSeek authored substantive implementation; Codex reviewed returned code, applied guarded changes, wrote tests and verified actual results. Ollama was used only for the required memory support route, not implementation. Authoring/review records remain under `D:/escrowglobal/rebrand-work`.

The other task added agreement hashing and isolated account-session foundations in the same folder. Promotion paused, compared file hashes and preserved those changes. Current `src/agreement.mjs`, account-auth routes/config/tests and the isolated `src/custody/intent.mjs` remain present. The latter is outside this rebrand scope and is **not connected to live custody**. The server still returns 501 for live escrow transactions and remains loopback-only.

The DeepSeek review output discussed existing boundaries and was truncated; it is not represented as a completed independent security audit. Its optional idea of adding asset into legacy snapshots was **rejected** because it would rewrite sealed historical commitments. Codex reviewed that boundary and added a passing hashed-legacy preservation regression. No actual blocking financial migration finding remained after local review/tests.

## Plan adjustments and limits

The original plan is retained as historical planning evidence in [implementation-plan.md](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/implementation-plan.md). Central brand rendering and exact formatting helpers remain in existing modules rather than adding unused `brand.mjs`/`money.mjs` abstractions. A single small WebP rendition per illustration met the size budget; redundant responsive raster variants were not necessary. Open Graph title/description/type are present; the optional social card/public canonical domain was not invented.

No real transfer, provider purchase, wallet transaction, deployed custody, app-store submission or production deployment was performed. Native compilation/device tests were unavailable on this Windows environment; Java/Gradle/Swift compiler commands were not available on PATH. Both native templates retain payment execution restrictions. Historical Swift parsing evidence is not a fresh native build result. Third-party provider availability remains subject to the existing official-reference warnings.

## Preservation and learning

Original backup: `D:/escrowglobal/rebrand-backups/pact-original-20260912-205207.zip`. Pre-merge source/hash evidence: `D:/escrowglobal/rebrand-work/pre-final-merge` and adjacent SHA-256 records. Final distributable-file hashes are in `D:/escrowglobal/pact-universal/MANIFEST.sha256` (excludes private data/config, memory logs, tool caches and itself).

Central Brain was offline. The reusable rebrand/migration lesson was **stored locally and queued for retry** through `superroo-learn`; local records are in `D:/escrowglobal/pact-universal/memory/lessons-learned.md` and `lesson-index.jsonl`. Remote sync was not confirmed. No Git repository was initialized, no commit occurred, and therefore no post-commit hook verification was applicable.
