# Pact — services marketplace + escrow workflow sandbox

**Working prototype, not a live escrow service.** No real funds, blockchain transactions, wallet connection, authenticated accounts, or actual buyer protection exist in this build. “Pact” is a temporary name; availability and trademarks have not been checked.

This is an original implementation inspired by Fiverr's publicly documented marketplace workflows. It does not contain Fiverr's source code, branding, seller data, or copied portfolio images.

## Try it immediately

Open `pact-preview.html` in a modern browser. It contains the UI, sample data, and executable off-chain escrow model in one file. It needs no build step, account, network connection, or API key. It stores changes in that browser's local storage where available; otherwise the session remains in memory. Browser security or attachment viewers can disable scripts; use the local-server option below in that case.

The standalone preview and local server use **separate data stores**. An agreement created in one does not appear in the other. A local deal URL is not a public, cross-device invitation link.

## Run the source locally

Requirements: Node.js 20 or later. Tested with Node.js 22.16.0. There are **no npm package dependencies to install**.

```sh
cd pact-marketplace
npm start
```

Open `http://127.0.0.1:4173` in your browser. The server is deliberately bound to the local machine. **Do not expose it publicly, tunnel it, or enter personal information or private keys.** The identity selector is a testing convenience, not authentication.

The server creates `data/sandbox.json` on first start and persists commands there. Use one server process only. To reset, stop the server, delete that JSON file, then restart. To reset the standalone preview, clear its browser storage. There is no automatic import or synchronization between these modes.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Local port, between 1024 and 65535 |
| `DATA_FILE` | `data/sandbox.json` under project root | Alternate local JSON store |
| `ESCROW_MODE` | sandbox behavior | Only `sandbox` is accepted; live mode is rejected |

## What is implemented

**Marketplace:** responsive discovery page; category, search, budget and sorting controls; eight fictional sample services; seller profiles; service details; Essential/Professional/Complete packages with scope, delivery time and revisions; buyer requirement collection; seller listing creation; publication review; pause/resume for approved listings; completed paid-order reviews.

**Additional ways to start a deal:** buyer project briefs, seller custom proposals, and private agreements that do not require a public service listing. A chosen proposal pre-fills a draft, which the seller still confirms before funding.

**Work management:** buyer and seller dashboards; one- or three-milestone agreements; seller acceptance before funding; work submission; acceptance checklists; free revision requests within the agreed allowance; text conversation and delivery references; original terms and activity history; clear simulated balances.

**Escrow simulation:** fixed buyer/seller/fee recipients; 3% fee reserve; an additional 5% initiator-paid dispute charge; milestone-specific dispute freeze; reviewer release/refund; bilateral final split or amendment; defined timeout rules; integer money arithmetic; JSON export.

**Not implemented:** a deployed smart contract; live USDC, wallet signatures or key management; production authentication or identity checks; real payouts or on-ramps; secure file uploads; email/push notifications; live chat transport; AI contract generation; full listing-edit/media tools; reputation fraud detection; arbitration staffing; external verifier integrations; a production database, search service or blockchain indexer.

Three-part agreements use an initial 20% / 50% / 30% allocation and a shared service-level acceptance checklist. Stage-specific deliverable configuration is a production requirement, not a complete feature in this prototype. All milestones are funded upfront in this build; partial future funding is not implemented.

## Five-minute demonstration

1. Start as **Buyer · Alex**. Open a service, choose a package, enter requirements and create an agreement. Switch to that service's seller, accept the agreement, then switch back to Alex and fund it. This moves simulated credit only.
2. Switch to the seller to submit a milestone. Switch back to the buyer to accept the checklist and release it, request an included revision, or open a formal paid dispute. Only the unresolved milestone is affected.
3. Switch to **Team · Pact** for a disputed case. The available binding decisions are release to the original seller or refund to the original buyer. Alternatively, use the original buyer and seller identities to propose and approve a revised scope or negotiated final split.

The seeded state also contains illustrative orders so dashboards are not empty. All people, profiles, payments and histories are fictional. No customer performance claims should be inferred from them.

## Fee policy used for this prototype

The user's specified rates are retained: **3% commission and an additional 5% charged to the dispute initiator**. This build does **not** silently replace the dispute charge with a refundable bond.

The following are implementation assumptions to approve before a real launch:

- The buyer deposits principal plus a 3% fee reserve. The platform earns 3% only on principal actually paid to the seller. Unused reserve follows refunded principal back to the buyer.
- A formal dispute costs 5% of that milestone's currently held principal, paid separately by the party opening it. It is non-refundable here even when the claimant wins. The counterparty is not automatically charged. Revisions and settlement proposals do not incur that fee.
- Renegotiation does not add a second 3% charge on the same retained money. There is no fee cap, minimum dispute fee, or appeal fee in the prototype.

For a single 1,000 USDC principal milestone, simulated buyer funding is 1,030. Successful completion pays the seller 1,000 and the platform 30. Full refund returns 1,030, excluding any separately paid dispute charge. A bilateral 600/400 split pays the seller 600, the platform 18, and the buyer 412. A dispute over that original 1,000 adds a separate 50 charge to its initiator.

All balances use integer micro-units with six decimals. Percentage fees round down per milestone. Real network charges, issuer restrictions, tax treatment, and fiat conversion are not modeled.

## Authority boundaries

| Decision | Who may authorize it in the reference model? |
|---|---|
| Accept the exact agreement | Original seller; buyer approval recorded on creation |
| Fund the agreement | Original buyer, after seller acceptance |
| Submit work | Original seller |
| Accept delivered work | Original buyer |
| Open a paid dispute | Either original party |
| Release/refund an open disputed milestone | Review-team role, with a rationale |
| Negotiate a new split, scope, or retained balance | Both original parties must approve the same proposal |
| Change original payment recipients or escrow fee formula | Nobody through the supported commands |
| Redirect principal to the review team | Not an available command |

These restrictions are implemented in a **simulated ledger**. They are not an audited on-chain guarantee. Someone with access to the local machine can modify the files. A production deployment needs a separately implemented, audited custody program with an upgrade policy that cannot bypass its advertised restrictions.

## Tests and verification

```sh
npm test
npm run build:preview
```

The delivered run passed **53 Node test checks** with zero failures. Coverage includes domain transitions, fee calculations, role restrictions, recipient immutability, stale/expired proposals, timeouts, revisions, failed-command atomicity, real local HTTP endpoints, replay handling and persistence. See `docs/node-test-results.txt`.

Optional browser test:

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser_smoke.py
```

The runner uses a `CHROMIUM` executable path when provided, otherwise an available system Chromium or Playwright's installed browser. The delivered run passed **16 browser workflow checks**, with no JavaScript errors during those flows. It rendered the standalone HTML directly in Chromium. The API was tested separately: this is **not** a browser-plus-server-plus-blockchain integration test, formal verification, penetration test or security audit. See `docs/browser-test-results.json` and screenshots.

## Project map

| Path | Purpose |
|---|---|
| `public/app.mjs` | Interactive marketplace and deal-room UI |
| `public/styles.css` | Original responsive visual design |
| `src/domain.mjs` | Transactional off-chain reference state machine |
| `server.mjs` | Dependency-free localhost server and JSON persistence |
| `scripts/build-preview.mjs` | Generates the standalone HTML from the same source |
| `tests/domain.test.mjs` | Reference-model tests |
| `tests/api.test.mjs` | HTTP, persistence and mode-guard tests |
| `tests/browser_smoke.py` | Optional interactive browser checks |
| `docs/PRODUCT-BLUEPRINT.md` | Public Fiverr workflow analysis and product plan |
| `docs/PRODUCTION-ESCROW-SPEC.md` | Live-system requirements and launch blockers |
| `docs/IMPLEMENTATION-STATUS.md` | Feature boundaries, test scope and risks |

## Security boundary

Everything in this build is local demo information. `/api/state` exposes all simulated identities, conversations and cases. Commands trust the explicitly selected identity. No secret keys or real addresses are needed, and none should be entered. Local origin checks, escaped text, headers and an API allowlist reduce accidental misuse; they do not make this a production security architecture.

The next engineering priority is a separately reviewed testnet custody implementation, real authentication and restricted evidence access—not enabling real funds on this server.
