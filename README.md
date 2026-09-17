# Escrow Global Settlement · 0.3.0

**A runnable physical-goods and services marketplace sandbox, with restricted escrow workflows, configurable payment adapters, and Android/iOS source templates.**

## Arc Network separation status

This repository is the Arc Network build line (`escrowglobalarcnet`). The current browser demo remains an explicitly non-custodial sandbox, and no Arc escrow contract or live custody flow is deployed yet. The existing custody package is Solana-specific and is retained as migration reference only; Arc implementation work must use the official Arc EVM/USDC-gas model and be added behind new, tested boundaries. See [`docs/ARCNET-MIGRATION.md`](docs/ARCNET-MIGRATION.md) before implementing onchain settlement.

Escrow Global is a working name, not a trademark clearance. This is original product code, not Fiverr’s source code or an official Jupiter/MoonPay app.

## Read this before running

**This build does not hold customer funds. There is no deployed Solana escrow program, production account authentication, or live escrow transaction builder.** Identities are deliberately switchable so you can test buyer, seller and resolution-team behavior. Balances are separate simulated USDT and USDC credits. Existing agreements keep their original asset; changing the pricing selector affects only browsing and new agreements. Anyone using the local demo can switch roles; that is not authorization suitable for a public service.

**Planned production positioning:** Escrow Global is decentralized, non-custodial marketplace and agreement infrastructure—not a custodian or pooled-balance provider. A future on-chain escrow program would enforce the agreed release rules; a separate third-party arbiter would handle contested disputes within constrained, agreement-defined authority. Escrow Global would coordinate discovery, agreements, evidence and settlement UX, but would not unilaterally redirect or sweep user funds. These are design goals, not capabilities of this sandbox.

External payment tools are separate: Jupiter’s opt-in web widget can interact with a real wallet when connected; MoonPay checkout requires your partner configuration and signed ownership proof. Neither credits the sandbox ledger. Native templates disable payment execution. Do not expose the local API publicly or enter private/customer data.

## Start in two minutes

**Explore without installing anything:** open `escrow-global-preview.html`, or double-click `Open-Preview.cmd` on Windows. This is the bundled offline demonstration. Browser file storage behavior differs by browser; export demo data before closing when you need it.

**Open the hosted presentation snapshot:** [GitHub Pages preview](https://jpgyap-sudo.github.io/escrow-global/). It is the same static sandbox bundle, with no backend and no live custody. The current branch does not automatically publish new public snapshots.

**Run the local website and API:** install Node.js 22.13+ (tested on Node 22.23.2), extract this folder, then:

```sh
npm start
```

Open **http://127.0.0.1:4173**. There are no npm runtime dependencies and no `npm install` step. On Windows, `Start-Server.cmd` runs the same command. Keep the terminal open. Stop with Ctrl+C.

The server persists simulated state in `data/universal-sandbox.json`. It binds only to loopback, validates Host/Origin, and rejects any `ESCROW_MODE` other than `sandbox`. Before resetting, stop the server and export or back up that file. A new demo may be created only after explicitly moving the old file aside. Never include that file in a public deployment.

## Pricing and existing demo data

Select **USDC or USDT** in the header. Sellers can independently quote one or both assets; unavailable quotes cannot be checked out. Fees, funding, refunds and payouts stay in the agreement’s fixed asset. Balances and treasury totals are never combined or automatically converted. Fresh/reset demos explicitly give each identity 25,000 of each demo asset; these are not real tokens or an exchange rate.

Legacy scalar saved state migrates to **USDC only**, with zero USDT balance and no invented USDT quotes. The server validates first and saves a byte-exact adjacent `pre-escrow-global-v3` backup before replacement. Browser migration leaves `pact-universal-sandbox-v2` untouched and writes `escrow-global-sandbox-v3`. Corrupt/unknown saved state produces a recovery screen, with raw export and an explicit backed-up reset; it is never silently reseeded. A stale browser tab cannot overwrite peer changes. If storage is unavailable, a persistent warning identifies memory-only operation.

The rebranded `pact-preview.html` is a byte-identical compatibility entry point for the transition. Export before changing file URLs because cross-file browser storage continuity is not guaranteed. Old code cannot interpret new USDT activity: do not downgrade by relabeling or discarding an asset.

The agreement-hash and isolated account-session foundations from the parallel reliability work are preserved. They do not make switchable demo identities production authorization or provide live custody.

## What is included

| Area | Implemented behavior |
|---|---|
| Marketplace | 17 categories, product/service filters, search, sorting, profiles, packages, seller publication, moderation, reports and blocking |
| Products | Quantity, inventory checks at funding, shipping cost, fixed specifications, tracking references, buyer receipt, inspection, return requests, refund proposals and warranty holdback |
| Services | Three packages, requirements, delivery, revision rounds, milestones, briefs/quotes, custom agreements and deal-linked reviews |
| Agreements | Ten workflows including real-estate earnest deposits, custom milestone amounts and acceptance checks, fixed simulated recipients, bilateral amendments and final settlements |
| Resolution | Additional 5% formal-dispute fee; reviewer release/refund only; no unilateral split or address change |
| Payments | Opt-in Jupiter web widget adapter, Wallet Standard connection, short-lived Ed25519 ownership proof, server-signed MoonPay checkout URLs, provider alternatives, actual Solana transfer QR generation |
| Education | Twenty-three in-app guides with accessible flow diagrams covering non-custodial settlement, fee math, milestone planning, disputes, rights and deadlines, fee sponsorship, protection receipts, wallet safety, reconciliation, Jupiter ID, KYC, Card, QR Pay, buying stablecoins and avoiding network mistakes |
| Custody readiness | Unsigned single-milestone intent validation, deterministic agreement preflight, transaction lifecycle, pure finalized-observation reconciliation and a machine-readable production gateboard; no live custody |
| Mobile | Responsive UI, installable-web manifest, Android Java/WebView project and SwiftUI/WKWebView Xcode project with bundled offline assets |

There are 15 fictional published listings (six products, eight services, and one domain listing) and four example agreements. Illustrations are not verified product photography. New product and service listings require simulated team publication before discovery.

## Operator console and SEO journal

Run `npm start` and open **http://127.0.0.1:4173/admin** for the local operator console. It includes:

- marketplace analytics and activity trends for listings, agreements, reports, users and simulated value;
- listing moderation, report resolution, agreement monitoring flags and operator notes;
- a draft/publish workflow for the SEO journal, including slugs, excerpts, tags, canonical paths, meta descriptions and Open Graph image fields;
- site/SEO defaults, feature toggles, audit history, and JSON/CSV exports;
- a custody-readiness gateboard that separates a local compiled artifact from deployment, audit, auth, RPC, reconciliation, storage, operations and legal approval;
- a public journal at **http://127.0.0.1:4173/blog** with SEO metadata on published post pages.
- a support inbox at **http://127.0.0.1:4173/support** for general support, bug reports, payment/listing/account issues, screenshots and follow-up replies;

The console and support intake are intentionally **local sandbox tools**. They have no production authentication or authorization, must remain loopback-only, should not receive PII, and cannot move funds, rewrite agreement recipients, or override settlement rules. Support attachments are limited to three files, 2 MB each / 5 MB total, and are stored inline as sandbox test data; production should use authenticated object storage with malware scanning, retention, access control and private ticket ownership. Treat exports as test data.

## Try a physical-goods deal

Start as **Buyer · Alex**. Open the oak chair product, choose quantity, add fictional requirements and a delivery reference, and accept the disclosed inspection and fee terms. Switch to **Noa**, accept the agreement, switch back to **Alex** and simulate funding.

As Noa, record shipping. As Alex, confirm receipt; this starts inspection, **not payout**. Inspect and approve the delivery milestone, request a free return, negotiate, or open a formal paid dispute. The warranty portion stays held until its agreed period has elapsed and the buyer approves, or a permitted settlement resolves it.

For a return, the buyer requests it, the seller authorizes logistics, the buyer records return shipping, and the seller confirms receipt. The seller can propose a full refund of each unresolved milestone, but the buyer must accept every proposal. Returned stock is **not automatically restocked**; condition and inventory reconciliation need an operator workflow.

Shipment events are manually supplied references, not a live courier integration. Warranty periods in seed examples are real elapsed days; do not change the system clock for financial behavior. The automated tests use an injected clock to exercise those transitions safely.

## Your fee and authority rules

Commission is **3% of principal actually released to the seller**, funded as a separate buyer reserve. Unused reserve returns with refunded principal. A formal dispute incurs a separate **non-refundable 5% charge on the currently disputed milestone’s held principal**, paid by the initiating party. Winning does not refund that charge in this version. Revisions, return requests and mutual negotiation do not themselves incur it.

The reference model permits the team to release a disputed milestone to its original seller or refund its original buyer. It rejects recipient replacement, arbitrary withdrawals, fee rewrites and imposed partial allocations. Both original parties must agree to revised terms. These are **off-chain model restrictions, not yet an immutable on-chain guarantee**.

Detailed examples and fairness considerations: `docs/FEES-AND-RESOLUTION.md`.

## Payments: four distinct actions

**Buy:** the MoonPay page creates a server-signed provider checkout after ownership verification. Copy `.env.example` to `.env`, use your own test keys, and obtain the exact Solana USDC/USDT currency codes from your partner dashboard. The provider determines available payment methods, KYC, minimums, fees and countries. The code has not completed a real provider purchase in this environment.

**Swap:** explicitly enable the Jupiter Plugin on the local web app. It loads the official remotely hosted widget. Review its real transaction in your wallet. An external swap never creates an escrow deposit in this build. Network connectivity and a compatible wallet are required.

**Receive:** generate a real `solana:` transfer request and scannable QR for a receiving wallet you supply. It labels the destination as **personal wallet top-up, NOT ESCROW**. Format validation is not proof that an address belongs to you. The app does not watch the chain or reconcile deposits.

**Spend:** read the Jupiter Global/Spend guides and follow official app links. Jupiter’s merchant QR Pay is not the same as Solana Pay. No Jupiter merchant account, card issuance, automated KYC, QR merchant settlement or Spend balance API is integrated here.

See `docs/PAYMENTS.md` for configuration and the exact production boundary. Transak is an official external alternative link, **not an embedded checkout adapter**. The real-estate workflow is documented in `docs/REAL-ESTATE-ESCROW.md`.

## Mobile projects

Run:

```sh
npm run build:mobile
```

This rebuilds the standalone HTML and embeds it into both native projects with `PACT_NATIVE=true`.

Android: open `mobile/android` in Android Studio. It uses AGP 9.3.2, Gradle 9.5.0, JDK 17, target/compile SDK 36 and minimum SDK 26. `bootstrap.cmd` / `bootstrap.sh` can generate the Gradle wrapper using an installed matching Gradle distribution. The wrapper JAR, Android SDK, APK/AAB and signing key are not included.

iOS: open `mobile/ios/Pact.xcodeproj` in Xcode on a Mac. Choose your own bundle identifier/signing team and a simulator or registered device. The target is iOS 17+. No IPA, certificate or provisioning profile is included.

**These are offline native source templates, not compiled/tested store submissions.** Swift syntax was parsed; iOS/Android compilation and device execution were not available here. Native payment execution is intentionally disabled pending mobile wallet integration and store/regional review. Read `mobile/README.md` and `docs/MOBILE-RELEASE-CHECKLIST.md` before distributing.

## Tests and reproducible builds

```sh
npm test                 # Domain, asset/migration, agreement, auth, HTTP API and payment checks
npm run build:preview    # Rebuild the single-file HTML without external build packages
npm run build:mobile     # Rebuild both bundled mobile assets
python tests/qr_reference.py
python tests/browser_universal.py
npm run test:rebrand     # 216 route/asset/width checks
npm run test:storage     # Legacy migration and recovery checks
npm run test:packaging   # Offline/native bundle, keyboard and palette checks
npm run test:production:custody # Native custody safety and ABI boundary tests
npm run verify:custody:manifest # Verify a separately approved release manifest
npm run verify:custody:onchain  # Read-only finalized deployment proof (fails closed without evidence)
```

Optional Python test dependencies: `pip install playwright qrcode`, then `playwright install chromium`. `PACT_CHROMIUM` can point to an existing browser binary. QR verification compares exact matrices, not OCR. Browser tests use the standalone bundle via `set_content`; the HTTP API has a separate test suite.

Current verification: see `docs/rebrand/escrow-global/verification-report.md` and `docs/TEST-REPORT.md` for this release’s measured results. Jupiter’s browser test uses a mocked plugin; no live-money transaction, payment-provider session completion, courier API call or native-device test was performed. This is not an audit. See `docs/TEST-REPORT.md`.

## Project map

```text
public/                  Responsive marketplace, wallet UI, tutorials, QR, wallet and Jupiter modules
public/admin.*           Local operator console for analytics, moderation, monitoring and SEO content
public/blog.*            Public sandbox journal index and client-side listing view
public/support.*         Local support and bug intake with screenshot/file metadata and ticket follow-up
src/domain.mjs           Original conserved-funds escrow reference state machine
src/universal-domain.mjs Goods, inventory, returns, warranty, contracts and moderation extension
src/admin.mjs            Validated admin commands, audit records, analytics and blog/settings state
src/support.mjs          Validated ticket intake, attachment checks, public replies and support analytics
src/catalog.mjs          Categories and workflow definitions
src/payments.mjs         Mint constants, address/amount/URL validation and transfer requests
src/integrations/        MoonPay URL signing and wallet ownership proofs
server.mjs               Loopback-only API and validated migration and atomic local JSON persistence
mobile/android/          Java WebView source and Gradle project
mobile/ios/              SwiftUI/WKWebView source and Xcode project
scripts/                 Preview/mobile build and tutorial-export scripts
tests/                  Domain, payment, API, browser and QR tests
docs/                   Current implementation, security, payment, mobile and tutorial documentation
```

The custody release packet workflow is documented in `docs/CUSTODY-DEPLOYMENT.md`. The next production work is explicitly described in `docs/PRODUCTION-ROADMAP.md`: audited custody, signed agreements, account authentication, private evidence storage, reliable reconciliation, operating/legal decisions and native review. Old v1 design notes are retained in `docs/archive-v1` for context only; they do not describe this release’s current status.
