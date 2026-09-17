# Escrow Global Settlement — rebrand implementation plan

**Date:** 2026-09-12  
**Status:** Implementation authorized by the subsequent execution goal; sandbox rebrand delivered. See [verification-report.md](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/verification-report.md) for actual changes, evidence and limitations.

**Historical plan:** the sections below retain the original planning-time observations and authority wording. They are not claims that the application is still unmodified; the execution report supersedes proposed/current-state statements.  
**Recommendation:** Rebrand the existing product, retain its marketplace and agreement workflows, and implement genuine two-asset **sandbox accounting** rather than replacing “USDC” with “USDT / USDC” in the interface.

## 1. Outcome, authority, and execution policy

- Full brand: **Escrow Global Settlement**. Short brand: **Escrow Global**. Use the full name in page titles, metadata, introductory copy, wallet-ownership prompts, and about screens; use a two-line short-name/“Settlement” lockup where space is limited.
- Product prices, service packages, shipping, budgets, agreements, reserves, disputes, refunds, and balances support **USDT and USDC**, with explicit asset labels and independent accounting.
- Replace Pact’s platform identity and moss/lime/cream treatment across web, offline preview, PWA, mobile display surfaces, guides, and current release documentation.
- Authorized now: inspect, run a baseline test suite, create this plan, and generate the two accompanying concept images. No application code, build outputs, settlement behavior, deployment settings, or existing data is changed.
- Non-goals: real escrow custody, new chains, fiat conversion, subscription tiers, a framework rewrite, account authentication, changes to the existing 3%/5% fee policy, domain registration, trademark clearance, deployment, native-store submission, or Git initialization/commit.
- **Root identity:** not independently exposed/verified in this planning context. Do not assume an Astra-root exemption merely because this is an Astra-style handoff. No implementation model was invoked.
- **Execution routing after approval:** verify the actual execution root. In a verified Astra-root task, Luna authors substantial implementation and Astra reviews the actual diff/tests; Spark is only for isolated low-risk edits. Otherwise use the mandatory DeepSeek bridge coding route and health gates. Ollama remains memory-only. The current collaboration tool does not advertise exact Luna/Spark model overrides; report an unavailable route rather than substituting or creating a new user-owned task.
- All slices below are sequential by default. They deliberately share some files. Do not run simultaneous authors against the same file.

## 2. Verified current state

**Workspace:** D:/escrowglobal/pact-universal  
**Repository state:** neither this directory nor its parents is a Git repository; branch/commit and Git dirty state are unavailable. Preserve a source snapshot before execution. Do not invent a commit base.

| Inspected surface | Observed behavior / consequence |
|---|---|
| D:/escrowglobal/pact-universal/package.json | Dependency-free Node/ES-module app; no React, Tailwind, or external bundler is needed for this change. |
| D:/escrowglobal/pact-universal/public/app.mjs | Shared brand renderer, navigation/footer, services, deals, modals, rules, export, and persistence. USDC labels and one scalar user balance are widespread. |
| D:/escrowglobal/pact-universal/public/universal-ui.mjs | Goods, marketplace, agreements, wallet, tutorials, and mobile navigation. Market filters and product prices assume USDC. |
| D:/escrowglobal/pact-universal/public/styles.css | Base visual system, components, service illustrations, and responsive rules; 36,893 bytes in 12 physical lines. |
| D:/escrowglobal/pact-universal/public/universal.css | Later cascade adds a second green/cream palette and serif headings; 28,316 bytes in 8 physical lines. Changing only the first root palette will not fully rebrand the app. |
| D:/escrowglobal/pact-universal/src/domain.mjs | Integer six-decimal money, transactional commands, scalar balances/treasury, aggregate conservation, and an immutable demo-USDC order token. |
| D:/escrowglobal/pact-universal/src/universal-domain.mjs | Goods checkout, stock, inspection, returns, warranty, and custom milestone workflows extend the base ledger. |
| D:/escrowglobal/pact-universal/src/payments.mjs | External Solana receive requests already distinguish USDC and USDT; these are not escrow deposits. |
| D:/escrowglobal/pact-universal/server.mjs | Loopback-only API, exact static-file allowlist, atomic JSON persistence, and an HTTP 501 live-custody endpoint. New modules/images must be explicitly served. |
| D:/escrowglobal/pact-universal/scripts/build-preview.mjs | Known-module bundler inlines CSS/JS, but does not currently package external image assets. Produces D:/escrowglobal/pact-universal/pact-preview.html. |
| D:/escrowglobal/pact-universal/scripts/build-mobile.mjs | Copies the offline bundle into Android/iOS and injects the native payment-disable flag. |
| D:/escrowglobal/pact-universal/public/index.html and D:/escrowglobal/pact-universal/public/manifest.webmanifest | Old titles, loading text, app names, and theme colors. |
| D:/escrowglobal/pact-universal/public/favicon.svg and D:/escrowglobal/pact-universal/public/icons | Old P mark and raster app icons. |
| D:/escrowglobal/pact-universal/public/learn.mjs and D:/escrowglobal/pact-universal/scripts/export-guides.mjs | In-app guide source and generated Markdown export both carry platform branding. |
| D:/escrowglobal/pact-universal/mobile/android and D:/escrowglobal/pact-universal/mobile/ios | Display labels, toolbar/about text, icon assets, native colors, and embedded HTML all need coordinated treatment. |
| D:/escrowglobal/pact-universal/docs/screenshots/marketplace-desktop.png | Existing reference screenshot inspected: green editorial marketplace, chair-focused hero, four-column listings. It is a historical screenshot, not a fresh runtime capture. |

**Baseline executed:** Node v22.23.2, npm 10.9.8; **npm test: 113 passed, 0 failed**.  
Evidence: [baseline-node-tests.txt](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/baseline-node-tests.txt).

Preview/mobile builds, browser tests, QR reference tests, device tests, and any live provider transaction were **not run during planning**. Older reports are not new verification evidence.

## 3. Resolved product and design decisions

### Brand and copy

1. Keep products, services, private agreements, seller studio, wallet tools, guidebook, and resolution flows. This is a rebrand, not a replacement with a banking dashboard.
2. Suggested hero: **“Global deals. Clear settlement.”** Supporting copy: “Agree on products, services, and milestones with pricing in USDT or USDC.” Place **“Interactive sandbox — no real custody or escrow deposits”** prominently beside the experience.
3. Use “Create an agreement,” “Review terms,” and “Simulate funding” at the relevant stages. Do not imply the artwork or new name makes the current product audited, insured, regulated, globally available, or live.
4. Keep external-provider names, their actual currencies, and factual limitations. “All pricing in USDT and USDC” applies to this platform’s commercial amounts—not MoonPay’s fiat purchase inputs or the separate Jupiter Spend balance.
5. Replace whole brand references contextually. Do not blindly replace the substring “pact” inside words such as “compact,” seller artwork, third-party URLs, user-entered text, or historical transaction evidence.

### Proposed visual system

| Role | Proposed value |
|---|---|
| Primary / headings / primary action | Navy **#102A43** |
| Accent / active and focus treatments | Teal **#087F8C** |
| Soft accent surface | Mint **#DDF4F2** |
| Page / card backgrounds | **#F7FAFC** / **#FFFFFF** |
| Body / secondary text | **#243B53** / **#52677A** |
| Decorative borders | **#D5E1EA**; interactive boundaries need independently sufficient contrast |
| Typography | Existing system-available sans stack: Inter when installed, Segoe UI, Arial, sans-serif; no new remote font dependency |
| Geometry | Consistent 12–16 px card radii, restrained shadows, clear spacing, tabular money figures |

Create semantic brand tokens, e.g. primary, accent, surface, text, border, focus, success, warning, and danger. Remove competing platform palettes; do not leave a third overriding “rebrand stylesheet.” Product material colors and distinct semantic status colors can remain intentionally different.

The longer logo requires flexible header sizing, not shrinking all navigation to unreadable text. Use a deterministic SVG globe/EG-style mark and live-text wordmark. Keep the existing icon system; raster hero artwork is not the logo.

**Accessibility target:** WCAG 2.2 AA, including 4.5:1 normal text, 3:1 large text, keyboard operation, visible/unobscured focus, and usable reflow. Prefer 44 px primary touch controls as a project target; the AA target-size rule is 24 px subject to exceptions, not a blanket 44 px requirement. [W3C reference](https://www.w3.org/WAI/WCAG22/quickref/).

### Images already created

| Planning asset | Use and implementation treatment |
|---|---|
| [Hero: global settlement](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/images/hero-global-settlement.png) | 1536 × 1024 PNG, navy/teal globe and agreement slabs. Use for the marketplace hero, preserving the left-side negative space and legible HTML copy. |
| [Agreement milestones](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/images/agreement-milestones.png) | 1536 × 1024 PNG, frosted agreement sheets and three milestone forms. Use for the private-agreement/how-it-works section. |

Both were generated with the built-in image tool and visually inspected. They are concepts, not screenshots of an implemented page or verified product photography. Exact prompts and review notes: [image-prompts.md](D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/image-prompts.md).

During execution, prepare optimized renditions under the **proposed** D:/escrowglobal/pact-universal/public/images/escrow-global directory. Target a largest hero rendition at no more than the source’s 1536 px width and about 250 KiB, supporting art about 180 KiB, with smaller responsive versions. Treat these as budgets to verify visually, not achieved results.

Keep prices, token names, logos, disclosures, and workflow labels out of baked-in imagery. Use real text; decorative illustrations can have empty alt text when adjacent copy conveys their purpose. Give meaningful isolated imagery an accurate concise description. Preserve fictional-listing/illustration labels. Do not replace every listing with unrelated global-finance art.

## 4. USDT/USDC data and interface contract

### Shared asset authority — proposed

Create **D:/escrowglobal/pact-universal/src/settlement-assets.mjs** as the dependency-free definition of the two permitted settlement asset codes and their six-decimal sandbox token identifiers. This module must be usable by Node, browser, and offline bundler without browser globals.

- Asset codes: USDC and USDT only.
- Keep existing order token **DEMO_USDC_6_DECIMALS_NO_REAL_MINT** for migrated USDC orders; introduce the analogous explicit demo-USDT identifier for new USDT orders.
- Never reuse an external mainnet mint address as the simulated escrow token identity.
- D:/escrowglobal/pact-universal/src/payments.mjs retains the distinct real Solana mint configuration for external wallet tools. Its existing addresses match the issuer references checked during planning: [Circle USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [Tether supported protocols](https://tether.to/en/supported-protocols/).
- No extra chain selector or bridge is introduced. External tools remain Solana-specific; simulated agreements are clearly marked sandbox, not presented as on-chain transactions.

### Proposed state shape

Introduce an explicit **schemaVersion = 3**, separate from the existing command/state revision counter and universal extension marker.

| Entity | Contract |
|---|---|
| User | Replace scalar balance with balances keyed by USDC and USDT, each an integer micro-unit string. |
| Treasury | Keep the demo wallet identity; store commission and disputeFees separately per asset in a balances map. |
| State | Replace scalar initialFunds with initialFundsByAsset; conservation must hold independently for each asset. |
| Listing package | Replace scalar price with prices keyed by supported asset; the seller explicitly quotes each offered asset. All packages in one listing must share the same offered-asset set. |
| Product shipping | shippingPrices uses exactly the product’s offered-asset set; quantity, item price, and shipping are evaluated in the selected asset only. |
| Order | Store immutable asset plus its immutable demo token. Snapshot the exact chosen quote, parties, amount, fee rules, and goods terms at creation. Milestones inherit the order’s asset. |
| Brief and quote | A brief has one asset and budget; a quote inherits that asset and has its own amount. Converting a quote to an agreement carries the same asset. |
| Events and exports | New amount-bearing events include asset. Export per-asset balances and original order asset; do not rewrite old human evidence or events. |

Do not maintain two writable sources of truth, such as both scalar balance and a balances map. Financial arithmetic stays BigInt/integer strings end to end. Display two decimal places only when exact at that precision; retain meaningful precision up to six decimals for smaller fractions and fee amounts.

**A seller may quote one or both assets.** Example: 100 USDC and 102 USDT are independent seller quotes, not a currency conversion. Fresh fictional seed listings may explicitly quote the same nominal number in both assets, but never describe that as a guaranteed exchange rate. Migrated real demo content gains only its original USDC quote.

### Command contracts and failure behavior

- Listed service checkout and product purchase accept an explicit **asset** selected from the listing’s offered assets. The server/domain resolves that asset’s price and demo token from trusted state.
- Continue rejecting caller-supplied raw **token**, mint, price, fee, sellerWallet, or other override fields. In particular, retain the current product “token override” attack test; add valid asset-selection cases rather than weakening the test.
- Listing creation accepts explicit per-asset quote maps. Custom orders and agreements require an asset. Brief creation requires an asset; quotes cannot change the brief’s asset.
- Existing post-creation actions receive the order ID/version and their existing permitted arguments, not a new currency selector. Asset and demo token are immutable from **draft creation**, not only after funding.
- Switching assets after draft creation means canceling the unfunded draft and creating a new agreement with both parties’ approval. Funded orders cannot be redenominated.
- Funding, release, dispute charges, refunds, negotiated splits, retained reserves, and warranty payments debit/credit **only the order asset**. A high USDC balance cannot cover insufficient USDT.
- Unoffered/unknown assets, incomplete quote maps, invalid precision, negative values, tampered recipients, stale versions, and insufficient matching balance fail atomically without mutating funds, stock, or the input state.
- Keep the current 1-to-100,000 per-amount sandbox limits and 3% commission / separate 5% formal dispute fee behavior, interpreted in the chosen asset. All rounding remains integer micro-unit rounding as in the current model.
- Preserve the existing command idempotency envelope, stored request signatures, replay result, and expectedVersion protection. Do not normalize historical replay signatures in migration.
- No external wallet callback, on-ramp purchase, swap success, or QR generation may credit either simulated asset balance.

### Pricing UX

- Keep **USDC as the initial preference** to preserve the current default; show USDT as an equal option. Preference affects browsing/new drafts, not existing agreements.
- A marketplace token filter selects which quotes to show; a listing without that quote is excluded or explicitly unavailable. Price caps and “lowest price” sorting compare only that asset using integer amounts, never a combined ranking or silent FX rate.
- Preserve the chosen asset in marketplace links, search/filter forms, package selection, checkout, and back navigation. Every priced card and form label includes the actual ticker.
- Show distinct USDT and USDC balances and totals in wallet, dashboards, studio, and resolution. Do not add them into an unlabeled grand total. Mixed-asset tables either group by asset or display it in every row.
- Display a single token-specific principal/reserve/total before approval. For a 1,000-unit agreement in either selected asset: 1,000 principal, 30 reserve, 1,030 funding; a full-principal dispute separately costs the initiator 50 in that same asset.
- Payment-provider fiat inputs and Spend’s separate USD balance remain correctly labeled. Do not change them to USDT merely to eliminate the letters “USD.”

## 5. Compatibility and migration

Implement a pure, idempotent migration in **proposed D:/escrowglobal/pact-universal/src/state-migrations.mjs**, shared by browser startup and server persistence.

1. Recognize the inspected legacy base shape and universalVersion 2 shape; validate their current scalar invariants before converting. Reject unknown/newer, mixed, or ambiguous shapes instead of guessing.
2. Map every old balance, treasury amount, initialFunds, listing/package price, shipping price, brief budget, quote, and order denomination to **USDC only**. Initialize migrated USDT balances/treasury/initial total to zero. Do not mint a second balance or duplicate the USDC supply.
3. Preserve order IDs, participants, original demo-USDC token, milestone values/statuses, immutable historical terms, evidence, messages, inventory, revision counters, and processedCommands. Add asset metadata without rewriting historical agreement text.
4. Preserve the original data before persisting a migrated copy. On the server, keep D:/escrowglobal/pact-universal/data/universal-sandbox.json as the default location and honor DATA_FILE; back up the actual configured file, validate both asset invariants, then atomically replace.
5. In browser storage, read the **new proposed key escrow-global-sandbox-v3** first, otherwise the existing **pact-universal-sandbox-v2** and its actor preference. Leave the old keys untouched. Validate before writing the new key.
6. Replace the current catch-and-reseed behavior for invalid saved state with a clear recovery screen and raw-data export/reset choice. Existing invalid data must not silently disappear. If persistence is unavailable, keep an explicit in-memory warning and export option; do not claim migration was saved.
7. Never fall back to old state merely because a new-format record is corrupt. Do not reset data automatically. Detect concurrent/stale browser state before overwriting it; require reload or recovery rather than combining snapshots.
8. Fresh/reset demos may deliberately seed separate 25,000-unit balances in each asset and dual-quoted sample listings. This initialization is not used during migration.
9. Renaming an offline HTML filename can change file-origin storage behavior in some browsers. Keep a rebranded compatibility output at the old filename for one transition release and instruct users to export before changing entry files; do not promise cross-file storage recovery.

Retain internal compatibility identifiers for this scope: PACT_NATIVE, PACT_EMBEDDED, the pact_wallet proof cookie, the pact-dialog DOM ID, PACT_CHROMIUM, Android app.pact.demo, existing iOS project paths/technical bundle identifiers, and legacy storage keys used only for migration. Non-visible test temporary-directory prefixes may also remain. These are not visible brand defects. Renaming signing IDs, cookies, or payment-disable flags is a separate compatibility/security change.

Change the human-readable wallet-proof brand line, but not its origin/nonce/expiry/purpose or signature-validation behavior. Invalidate/restart outstanding short-lived sessions through normal restart/expiry, not by accepting a modified signed message.

## 6. Ordered implementation slices

### S0 — preserve and revalidate

**Outcome:** a recoverable baseline and an available authorized implementation route.

- Recheck workspace state and applicable instructions; save a non-destructive source/data snapshot because Git is absent.
- Run learning health/query. Use the offline queue when Central Brain is unreachable.
- If the execution root is not verified Astra, run the required DeepSeek/Ollama bridge status gates before substantial code. Restore an unhealthy mandatory route or report that coding is blocked.
- Re-run npm test from D:/escrowglobal/pact-universal. Do not overwrite the planning baseline with later results.

Verified instruction-supplied gate commands for non-Astra execution (not run during this documentation-only planning task):

    node C:/Users/User/superroo/superroo2/scripts/mcp-codex-bridge.mjs deepseek status
    node C:/Users/User/superroo/superroo2/scripts/mcp-codex-bridge.mjs ollama status

Use the same bridge's deepseek code command with the complete bounded slice packet for substantial implementation; use its review command for the required non-Astra review route. Learning commands use C:/Users/User/.superroo/bin/superroo-learn.cmd health, query, and store.

**Stop:** source has materially changed, original state cannot be preserved, or the required coding route is unavailable.

### S1 — brand authority and identity surfaces

**Depends on:** S0.  
**Outcome:** one platform name/copy authority and no old visible wordmark in the main web flow.

**Change surface:**
- Proposed D:/escrowglobal/pact-universal/src/brand.mjs: side-effect-free full/short names, approved tagline, and display metadata.
- Existing D:/escrowglobal/pact-universal/public/app.mjs, D:/escrowglobal/pact-universal/public/universal-ui.mjs, D:/escrowglobal/pact-universal/public/index.html, D:/escrowglobal/pact-universal/public/learn.mjs, D:/escrowglobal/pact-universal/public/wallet.mjs.
- Existing D:/escrowglobal/pact-universal/src/domain.mjs for new demo reviewer display identity; D:/escrowglobal/pact-universal/src/payments.mjs and D:/escrowglobal/pact-universal/src/integrations/wallet-auth.mjs for human-facing brand text only.
- Existing D:/escrowglobal/pact-universal/server.mjs and D:/escrowglobal/pact-universal/scripts/build-preview.mjs to expose/package the shared brand module.

Use Escrow Global Review Team for the seeded reviewer display name, a context-appropriate non-P abbreviation, and escrow-global-demo-export.json for new exports. Treat the known legacy seeded reviewer display name as migratable metadata, not permission to rewrite arbitrary user content.

**Acceptance:** header/footer, route titles, loading/errors, guidebook, QR warning, proof prompt, and new exports use the new brand; sandbox and provider-separation warnings remain. Test signed proofs and no-escrow receive warning. npm test passes; build:preview resolves the new module.

**Stop:** any proposed branding edit weakens a payment/native gate or changes authorization semantics.

### S2 — asset-aware ledger and safe migration

**Depends on:** S1.  
**Outcome:** both assets are supported by the model, with independent funds conservation.

**Change surface:**
- Proposed D:/escrowglobal/pact-universal/src/settlement-assets.mjs and D:/escrowglobal/pact-universal/src/state-migrations.mjs.
- Existing D:/escrowglobal/pact-universal/src/domain.mjs, D:/escrowglobal/pact-universal/src/universal-domain.mjs, D:/escrowglobal/pact-universal/server.mjs, and persistence initialization in D:/escrowglobal/pact-universal/public/app.mjs.
- Existing D:/escrowglobal/pact-universal/tests/domain.test.mjs, D:/escrowglobal/pact-universal/tests/universal.test.mjs, D:/escrowglobal/pact-universal/tests/api.test.mjs, and D:/escrowglobal/pact-universal/tests/payments-api.test.mjs.
- Proposed D:/escrowglobal/pact-universal/tests/asset-pricing.test.mjs and D:/escrowglobal/pact-universal/tests/state-migrations.test.mjs.
- Existing D:/escrowglobal/pact-universal/scripts/build-preview.mjs for the two new shared modules; keep the server module allowlist synchronized.

Update credit/debit/settle/totalFunds/assertInvariants and every amount-bearing creation path together. Extend immutable-field checks to asset. Preserve all goods guards and transactionality. Add migrated legacy fixtures and parameterize financially significant service/goods scenarios across both assets.

**Acceptance:** both asset lifecycles pass; cross-asset funding fails; every mutation preserves per-asset funds and stock; migration is deterministic/idempotent, preserves legacy values, adds no USDT supply, and rejects corrupt data without replacement. API replay and 501 custody boundary remain intact.

**Command:** npm test from D:/escrowglobal/pact-universal.

**Stop:** any conservation discrepancy, historical token ambiguity, unbacked state write, or caller-controlled price/mint/recipient.

### S3 — complete token-aware pricing UI

**Depends on:** S2.  
**Outcome:** every commercial amount and workflow agrees with the ledger.

**Change surface:** existing D:/escrowglobal/pact-universal/public/app.mjs, D:/escrowglobal/pact-universal/public/universal-ui.mjs, D:/escrowglobal/pact-universal/public/learn.mjs; proposed D:/escrowglobal/pact-universal/public/money.mjs for shared exact formatting and per-asset display helpers; server/bundler module inventories as required.

Cover service/product cards and details, package tabs, max-price filters/sort, seller quote entry, shipping, checkout, custom milestones, briefs/offers, dashboards/deal rows, deal finance tabs, funding/release/dispute/settlement dialogs, resolution totals, wallet, rules examples, toast/event text, and exports. Search for every current scalar balance/price use, not only visible USDC strings.

**Acceptance:** user selects USDT, creates and funds a USDT goods or service agreement, completes/refunds it in USDT, then views an existing USDC deal with no denomination change. Token preference survives navigation; missing quotes, insufficient matching balance, six-decimal values, and mixed-asset totals display correctly.

**Commands:** npm test; npm run build:preview; npm run test:browser, from D:/escrowglobal/pact-universal. Extend browser assertions first; discover/install prerequisites through the authorized environment when needed.

### S4 — full CSS redesign and image delivery

**Depends on:** S3.  
**Outcome:** a consistent responsive Escrow Global visual system, not a landing-page-only patch.

**Change surface:** existing D:/escrowglobal/pact-universal/public/styles.css, D:/escrowglobal/pact-universal/public/universal.css, D:/escrowglobal/pact-universal/public/app.mjs, D:/escrowglobal/pact-universal/public/universal-ui.mjs, D:/escrowglobal/pact-universal/public/favicon.svg; proposed D:/escrowglobal/pact-universal/public/brand-tokens.css and D:/escrowglobal/pact-universal/public/images/escrow-global.

- Reformat the two compressed CSS sources into reviewable rules without reordering the cascade; then remove competing platform color/font declarations and use shared semantic tokens. Aliases may bridge the two existing token sets during the slice; do not leave duplicated hard-coded palettes at completion.
- Audit navigation/footer, hero, search/filter controls, cards, detail sidebars, modal/forms, wallet tabs, guide pages, seller studio, resolution, finance tables, QR panel, toast/error/empty/loading states, mobile bottom nav, and safe-area spacing.
- Replace the P logo with a scalable vector mark. Preserve content/category illustrations where appropriate.
- Integrate the two generated concepts with fixed dimensions/aspect ratio, suitable mobile composition, a high-priority hero only, and lazy-loaded secondary art.
- Add explicit new asset/module/style routes and WebP MIME type to D:/escrowglobal/pact-universal/server.mjs. Keep its allowlist/path restrictions; do not replace them with unrestricted static filesystem access.
- Teach D:/escrowglobal/pact-universal/scripts/build-preview.mjs to inline an explicit small image manifest as data URLs for offline use. Add every proposed shared module to its known-module table. Do not hand-edit bundled HTML or broaden the custom bundler into arbitrary JavaScript transformation.
- Keep all transaction text and disclosures readable if an image fails. No external font or image request is required for the local experience.

**Acceptance:** at 360/390, 768, 1024, and 1440 px there is no horizontal overflow, cropped wordmark, overlapping action, hidden amount, obstructed dialog, or unreadable state. Also inspect 320 px reflow and 200% zoom. Review keyboard focus, contrast, reduced-motion behavior, and dark/light native chrome where relevant. All image requests succeed with correct MIME; the offline build works with networking blocked. Target total standalone HTML at or below about 1.5 MiB, revisiting only with measured evidence.

**Commands:** npm run build:preview; npm run test:browser; npm test. Add explicit server-served image and no-network offline tests; existing browser tests alone use set_content and cannot prove HTTP image routing.

### S5 — PWA, mobile, guides, and release artifacts

**Depends on:** S4.  
**Outcome:** all distribution surfaces use the new visible identity.

**Change surface:**
- Existing D:/escrowglobal/pact-universal/public/manifest.webmanifest, D:/escrowglobal/pact-universal/public/icons/icon-192.png, D:/escrowglobal/pact-universal/public/icons/icon-512.png, and D:/escrowglobal/pact-universal/public/index.html.
- Existing D:/escrowglobal/pact-universal/mobile/android/app/src/main/AndroidManifest.xml, D:/escrowglobal/pact-universal/mobile/android/app/src/main/res/values/styles.xml, D:/escrowglobal/pact-universal/mobile/android/app/src/main/res/drawable/pact_icon.png, and D:/escrowglobal/pact-universal/mobile/android/app/src/main/java/app/pact/demo/MainActivity.java.
- Existing D:/escrowglobal/pact-universal/mobile/ios/Pact/Info.plist, D:/escrowglobal/pact-universal/mobile/ios/Pact/PactApp.swift, and D:/escrowglobal/pact-universal/mobile/ios/Pact/Assets.xcassets/AppIcon.appiconset/AppIcon.png.
- Existing D:/escrowglobal/pact-universal/scripts/build-preview.mjs, D:/escrowglobal/pact-universal/scripts/build-mobile.mjs, D:/escrowglobal/pact-universal/scripts/export-guides.mjs, and D:/escrowglobal/pact-universal/Open-Preview.cmd.
- Current metadata/docs: D:/escrowglobal/pact-universal/package.json, D:/escrowglobal/pact-universal/RELEASE.json, D:/escrowglobal/pact-universal/README.md, D:/escrowglobal/pact-universal/mobile/README.md, D:/escrowglobal/pact-universal/deploy/README.md, and applicable current documentation under D:/escrowglobal/pact-universal/docs.

Use the full PWA name and compact “Escrow Global” short name; keep Demo/Sandbox visible in descriptions/native about surfaces. Regenerate app icons from the vector identity with correct sizes/safe areas, not by stretching the hero PNG.

Generate **proposed D:/escrowglobal/pact-universal/escrow-global-preview.html**, plus the rebranded old-filename compatibility output. Rebuild D:/escrowglobal/pact-universal/mobile/android/app/src/main/assets/index.html and D:/escrowglobal/pact-universal/mobile/ios/Pact/assets/index.html from source.

Update page/social metadata. A proposed 1200 × 630 social card can combine the approved art and exact brand text. Do not invent a public canonical domain, support address, legal entity, or issuer partnership. Leave production URL binding as a release-owner input.

Regenerate tutorials from the guide source. Preserve D:/escrowglobal/pact-universal/docs/archive-v1 and historical evidence as historical, not as current product claims. Keep D:/escrowglobal/pact-universal/THIRD-PARTY-NOTICES.md and license notices accurate; a brand rename is not permission to rewrite legal ownership.

Discover the existing release/checksum convention for D:/escrowglobal/pact-universal/MANIFEST.sha256; regenerate checksums only after final outputs/reports are fixed. Do not carry forward old “passed” metadata as new test results.

**Acceptance:** new app names/icons, native toolbar/about labels, guide exports, and rebuilt HTML have no visible Pact identity. Internal IDs are documented exceptions. Native payment gates and network restrictions remain active. Service worker remains deliberately free of financial/API caching.

**Commands:** npm run build:mobile; node scripts/export-guides.mjs; npm test; npm run test:qr; npm run test:browser, all from D:/escrowglobal/pact-universal. Native compilation/device commands must be discovered for the available toolchain using D:/escrowglobal/pact-universal/mobile/README.md; report unavailable platforms rather than claiming binaries are tested.

### S6 — integrated review and delivery

**Depends on:** S5.  
**Outcome:** evidence that branding, accounting, persistence, and packaging agree.

Review the actual changes against this packet, not a coder’s summary. Refresh route screenshots and automated checks for both selected assets and at least one migrated fixture. Record the commands, outputs, limitations, asset sizes, and any remaining intentional legacy identifiers. No deployment or commit is implied.

## 7. Completion gates

| Gate | Required evidence |
|---|---|
| Brand completeness | Rendered text/accessibility labels, metadata, app icons, native display names, generated outputs, and new exports use Escrow Global. Contextual source scan has only an explicit compatibility/history allowlist. |
| CSS completeness | Token palette and typography across all routes/states; image comparison and keyboard/mobile/zoom checks, not just root-variable edits. |
| Currency correctness | Every commercial amount names one asset; two independent balances; no aggregate cross-asset total, auto FX, or silent quote substitution. |
| Ledger safety | Both assets tested through funding, approval, split/refund/amendment, dispute, return, warranty, and timeout paths; no recipient or mint override; invariants and stock survive failures. |
| Migration | Legacy seed plus funded/disputed/goods/custom data survives exactly; USDT starts at zero for migrated data; repeated migration is a no-op; corrupt/unknown state is preserved and recoverable. |
| API compatibility | Same idempotency key/payload replays once; a different payload conflicts; stale versions fail; no payment route credits either ledger; live-custody endpoint stays 501. |
| Payment boundaries | USDT and USDC QR mint selection and changed warning are tested; both still say personal-wallet-only. Proof replay/expiry/tampering tests still pass. MoonPay fiat labels and native blocking stay truthful. |
| Packaging | All new modules/styles/images work through the HTTP allowlist and no-network standalone/mobile bundles; correct MIME and no old build artifacts used accidentally. |
| Verification honesty | All existing behavioral protections retained with new tests added; updated pass counts reflect this run. Untested native/live-provider paths are explicitly listed. |

A blanket zero-match search for “USDC” or “Pact” is not a valid acceptance test: USDC is required, historical records must remain truthful, and internal compatibility names are intentionally retained. Likewise, a zero-match dollar-sign scan is meaningless in JavaScript template strings. Verify visible financial labels and their data source.

## 8. Rollback and unresolved release inputs

- Keep the original source snapshot, original server data backup, and legacy browser keys.
- Revert pure branding independently only if the data/schema-reading code stays compatible.
- Old code cannot read newly created USDT state. After v3 activity, rollback requires a forward-compatible reader or explicit restoration of the pre-upgrade demo snapshot with disclosure that later simulated actions are excluded. Never coerce USDT into USDC or silently discard newer activity.
- Replacing local file entry points or native bundle identifiers can affect storage continuity; technical IDs remain unchanged here.
- Proposed palette, copy, short-name lockup, equal-access two-token quoting, and retained USDC default are reversible recommendations, not a claim of user approval.
- Public domain, support contact, trademark/legal entity, live settlement networks/custody provider, production compliance, and app-store signing are unverified/out of scope. They do not block this sandbox rebrand; they do block claims or deployment requiring them.

## 9. Learning and final reporting

Planning health/query ran: Central Brain was offline (fetch failed); configured local JSONL/Markdown fallback was available; query returned no matching lessons. The planning lesson was subsequently **stored locally and queued for retry** through superroo-learn. Local records: D:/escrowglobal/pact-universal/memory/lessons-learned.md and D:/escrowglobal/pact-universal/memory/lesson-index.jsonl. Remote synchronization was not confirmed.

Planning artifact audit: all **102 pre-existing files were SHA-256 checked and remained unchanged**. Only the plan, prompt record, two concept PNGs, baseline test evidence, and the required learning fallback records were added. Local links in the plan were checked to resolve successfully.

During execution, run learning health/query before substantial work and store lessons afterward. If a Git commit is later expressly performed in an actual repository, verify the global hook using C:/Users/User/.superroo/bin/superroo-verify-hook.cmd --sha COMMIT_SHA and report stored/queued/triggered/blocked/failure/unknown. If not stored, include C:/Users/User/.superroo/claude-hook.log, C:/Users/User/.superroo/retry-queue.json, and any local core.hooksPath blocker. No commit or hook verification occurred during planning.

The delivery report must list changed files, acceptance evidence, executed commands/results, migration outcome, screenshots, remaining risks, and learning status. Do not label the product production-ready.

## 10. Copyable execution handoff

> After I approve implementation, use $luna-execute with D:/escrowglobal/pact-universal/docs/rebrand/escrow-global/implementation-plan.md. Revalidate the workspace and actual root model first, then use the mandatory route permitted by the active SuperRoo policy; do not substitute an unavailable model or create another task automatically. Implement S0–S6 in order, preserving the sandbox/payment boundaries and old demo data. Use the two generated planning images as the visual direction. Make every marketplace quote, balance, fee, and agreement correctly asset-aware for USDT/USDC, not merely relabeled. Preserve internal compatibility identifiers and immutable recipients/tokens. Review actual changes and test evidence, resolve routine details, and report material deviations before proceeding. Do not deploy, register domains, change signing IDs, enable live custody, or commit without separate authorization.
