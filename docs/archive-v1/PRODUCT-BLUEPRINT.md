# Pact product blueprint

**Prepared 12 September 2026. Working name only.** This is a proposed product and a description of the accompanying local prototype, not a claim of a launched business. Public competitor information was checked against Fiverr's own Help Center. No proprietary source code or undisclosed ranking system was examined.

## 1. The product

A services marketplace where people publish offers, buyers define requirements, both parties approve payment terms, and milestone outcomes determine escrow settlement. The same agreement system accepts deals sourced outside the marketplace.

Positioning hypothesis: **“Find your person. Protect the plan.”**

Two complementary entry points matter. Public listings help someone discover a provider. Private escrow helps an existing buyer and seller formalize a deal. They should share the same acceptance, delivery, negotiation and dispute workflow rather than becoming separate products.

The administrator is not allowed to substitute a payout wallet. In an escalated dispute the administrator can release the unresolved milestone to the originally agreed seller or return it to the originally agreed buyer. A partial split or amended agreement requires both parties' consent.

This remains company-managed dispute resolution, not a trustless determination of service quality. An adjudicator can make an incorrect release/refund decision even when recipients cannot be changed.

## 2. What the public Fiverr workflow teaches us

| Publicly documented Fiverr pattern | Application in this product |
|---|---|
| A Gig combines a title, category, pricing, description, requirements and a gallery. [1] | A structured service page, not a vague seller advertisement. The prototype has service information and illustrative covers; uploaded portfolios are a later feature. |
| Packages can specify different prices, delivery times and revisions. [1] | Three scope-based packages; checkout preserves the selected offer in the agreement snapshot. |
| Required buyer inputs help define when work is ready to start. [1] | Capture requirements before creating the draft; obtain seller acceptance before funding. |
| Eligible Fiverr milestone orders have separate deliveries and payments for completed stages. [2] | Use individually resolvable milestones. The prototype funds every stage upfront; this differs from Fiverr's documented successive funding flow. |
| Sellers can send tailored custom offers. [3] | Buyers post a project brief; sellers propose scope and price; the selected proposal starts an agreement. |
| Fiverr credits freelancers 80% of a completed order's purchase amount. [4] | Show principal, seller proceeds, held funds and fees separately. The proposed 3% buyer-paid fee has different incidence, and is not an all-in like-for-like fee comparison. |

The useful lesson is agreement structure and workflow clarity. Copying every category, display convention, badge or marketplace feature is not necessary. This project uses original naming, artwork and layouts.

## 3. Core journeys

### Buy a packaged service

Browse a category, inspect a provider and package, complete requirements, and choose the acceptance mode. The resulting draft snapshots the price and scope. The seller confirms the exact agreement. Only then does the buyer fund principal and fee reserve.

On delivery, the buyer can approve, use an included revision, propose different terms, or open a formal paid dispute. A dispute does not reopen milestones already settled. Completion permits one buyer review in this prototype.

### Sell a service

Create a service with three distinct packages. Specify scope, timing, revisions and acceptance criteria. Submit the listing for publication review. When an order arrives, confirm that the requirements are feasible before accepting. Deliver through the agreed room and retain the delivery history.

The current seller studio supports creation and pause/resume. Full editing, portfolio uploads, analytics, availability limits and team accounts are not finished features.

### Request custom work

Post a brief, category and budget. A provider submits a tailored offer. A buyer selects it to prepare a private agreement, and the provider confirms that agreement before funding. The brief itself is not an escrow and the quoted budget is not a protected balance.

### Bring an existing client

Create a private agreement without publishing a public listing. This can later become a seller's “Pay through protected milestones” link. The delivered app demonstrates agreement creation locally; publicly shareable invitations, cross-device access and authenticated onboarding are still required.

## 4. The agreement as the central record

Every funded milestone should identify its deliverable, acceptance test, original parties, asset, amount, deadline, review rule, revision allowance, dispute policy and permitted resolver. The UI should show the original agreement separately from approved amendments.

A green state must identify what has happened: eligibility is not execution, delivery is not acceptance, and acceptance is not automatically an on-chain confirmation. The prototype uses green for settled/released states and simulated receipts.

For real off-chain services, an upload or AI assessment does not prove that the buyer received conforming work. Start with explicit buyer approval. Timed release should require the parties' prior consent, a qualifying submission and a meaningful review period. Named inspectors or verifiers can be added later for supported categories with carefully bounded authority.

The current three-milestone template splits principal 20/50/30 and starts with shared service-level requirements. Stage-specific acceptance criteria and dependency editing are a launch requirement.

## 5. Fees and incentive design

The prototype retains the requested 3% commission and 5% initiator-paid dispute charge. It assumes the buyer funds the 3% in addition to seller principal. Commission is earned only as principal reaches the seller. Unused reserve returns with refunded principal.

Formal disputes charge 5% of the currently contested milestone, separately from escrow principal. The charge is non-refundable in the prototype, even for a successful claimant. Included revisions and voluntary negotiation are free of this additional fee. The team cannot increase the fee on an already accepted agreement.

For one 1,000-unit milestone:

| Outcome | Seller receives | Platform commission | Buyer receives back |
|---|---:|---:|---:|
| Full release after 1,030 funding | 1,000 | 30 | 0 |
| Full refund | 0 | 0 | 1,030 |
| Bilateral 600/400 final split | 600 | 18 | 412 |

A formal dispute over that 1,000 adds 50 paid separately by whoever opens it. A later reduced milestone is disputed based on its remaining principal. Rounding is to six decimal places per milestone. These examples omit real network costs and taxes.

This fee design has unresolved tradeoffs. A victim must pay to seek relief; a fixed percentage can be too low to cover a small case and excessive for a large one. The platform earns additional revenue when a disagreement escalates. Policy validation should consider a cap, an independent appeal route, assistance for valid complaints, or a refundable bond. None of those alternatives has been selected or implemented here.

Track completion rate, paid dispute rate, reviewer hours, legitimate claimant cost, refund rate, and repeat use before expanding. Do not mistake gross 3% revenue for contribution margin.

## 6. Differentiation worth developing

### Portable seller business

Let providers use one storefront and agreement history for marketplace customers and existing customers. The hypothesis is that sellers will adopt a useful payment workflow before a new marketplace has abundant demand. Test that hypothesis with a small cohort rather than assuming a network effect.

### Agreement assistant

Build a future assistant that asks about missing scope, file formats, ownership handover, revisions, dependencies and acceptance tests. It should propose questions and draft terms; the parties approve them. It must not independently judge subjective completion or release funds. This feature is a roadmap item, not present in the app.

### Safe change requests

A proposal displays a before/after comparison of scope, held amount, refund and deadline. It moves no money until both original parties approve the same unexpired version. This behavior is already demonstrated locally and is more useful than forcing every disagreement into a paid case.

### Small disputed portions

Independent milestones and carefully defined warranty holdbacks can narrow what remains at risk. Warranty holdback is a future template; do not imply that already released principal can be clawed back.

### Earned history

Only completed paid work should create transaction-linked reviews. Future reputation needs fraud resistance, evidence quality and a fair appeals process. Do not count dispute initiation as proof of misconduct, use fake volume, or sell undisclosed ranking boosts. The current review gate is not a production anti-fraud system.

## 7. Launch scope and architecture

Start with narrowly scoped digital work, such as design, website implementation or documented automation. These are proposed test categories, not a claim of proven demand. Avoid regulated services and physical procurement until their specific operating requirements are addressed.

Use one explicitly chosen network and one supported stablecoin for the first real-money design. The current demo uses fake USDC-denominated balances, not a selected or deployed chain integration. Keep principal out of yield strategies. Do not begin with bridges, arbitrary assets, platform tokens, borrowing or guaranteed insurance.

A production system needs a public frontend, authenticated API, transactional database, private evidence storage, asynchronous jobs, chain event reconciliation and an independently secured resolver operation. The custody program must enforce the promised recipient restrictions. The attached local server is not that infrastructure.

Launch gates include a reviewed contract specification; testnet state-machine parity; security review and audit; authorization and recovery tests; fee and consumer-policy approval; reviewer operations; privacy and incident plans; and jurisdiction-specific legal assessment. An unresolved fallback when the resolver is unavailable is a blocker, not a cosmetic setting.

## 8. Suggested sequence

First validate the marketplace and bilateral workflow with the local prototype. Then implement authentication, stage-specific requirements, private evidence and the chosen network's testnet custody program. Reconcile every displayed balance with chain events and test cancellation/timeout races. Only after audit and operating readiness should a limited real-money pilot be considered.

After the first category demonstrates repeat transactions, add public invitations, storefront sharing, optional agreement assistance, and narrowly scoped integrations. Recurring subscriptions, team payouts, instant bookings, multi-chain settlement and complex physical-goods inspection are later products, not first-release requirements.

## Official source references

Checked 12 September 2026. These references document public Fiverr behavior, not this prototype's implementation.

[1] Fiverr Help Center, “Creating a Gig.”
https://help.fiverr.com/hc/en-us/articles/360010451397-Creating-a-Gig

[2] Fiverr Help Center, “Working with Milestones.”
https://help.fiverr.com/hc/en-us/articles/360010560178-Working-with-Milestones

[3] Fiverr Help Center, “Creating and managing custom offers.”
https://help.fiverr.com/hc/en-us/articles/360010559198-Creating-and-managing-custom-offers

[4] Fiverr Help Center, “Your earnings page.”
https://help.fiverr.com/hc/en-us/articles/9234443621137-Your-earnings-page
