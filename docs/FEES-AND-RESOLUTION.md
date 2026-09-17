# Fees, resolution and delivery rules

This is a specification of the delivered **simulation**, not a regulated escrow agreement. Obtain legal and operating review before adopting it for real customers.

## Commission: 3%

The buyer deposits principal plus a 3% reserve. The platform earns commission only on principal paid to the seller. Amounts use integer micro-units (six decimal places), never binary floating-point for ledger mutations. Fees are rounded down to token base units by the reference model.

For 1,000 demo USDC **or** 1,000 demo USDT (all following amounts remain in that selected asset), the buyer initially contributes 1,030. Full release gives the seller 1,000 and the platform 30. Full refund gives the buyer 1,030. A mutually signed 600/400 split gives the seller 600, platform 18 and buyer 412. Separately incurred dispute charges are not included in these returns.

A revised agreement does not charge another 3% on the same retained funds. A lower retained amount refunds excess principal and unused reserve under the accepted proposal.

## Formal dispute: additional non-refundable 5%

Either original party may initiate a formal dispute on an eligible unresolved milestone. The initiator pays 5% of that milestone’s currently held principal, from their separate demo balance in the agreement’s asset. A balance in the other asset cannot pay this charge. It is a fee, not a refundable bond. A successful claimant is still charged. Previously released milestones cannot be reopened, and unrelated milestones are not automatically frozen.

A 500 principal dispute costs 25; it does not cost 500 merely because the original project once totaled 10,000. Insufficient separate credits prevent filing in the sandbox. Before real launch, decide how a genuine complainant without funds receives access to recourse; the current fee model does not solve that fairness issue.

Included revisions, normal return requests, reporting a listing and proposing a negotiation do not charge a dispute fee. A fee should never be hidden in a “help” button.

The Anchor custody slice mirrors this policy for its V1 and V2 dispute
instructions: the opener's own admitted-mint SPL token account pays the fixed
fee recipient atomically, and the escrow vault is never used to pay the
charge. The web application remains sandbox-only until the program ABI,
runtime lifecycle, reconciliation and audit gates are complete.

## Team authority

For an open dispute, a reviewer may release the milestone’s entire held principal to the original seller or refund it to the original buyer, with a recorded reason. They cannot redirect principal, edit wallets, take arbitrary sums, alter active fee schedules or force a partial split. The platform receives only its scheduled simulated fees.

A final partial split or revised scope/price/deadline requires a proposal and acceptance by the *other original party*. The proposer cannot approve on their counterparty’s behalf. Proposals expire and are bound to an agreement/milestone/version; stale state and duplicate conflicting actions fail rather than overwriting terms.

A fixed destination does not make a bad ruling fair. Your company remains responsible for evidence standards, reviewer conflicts and response times. No automatic backup arbitrator or external appeal provider is integrated. Do not leave real deposits under this incomplete operating arrangement.

## Goods are not services with a shipping checkbox

A product agreement snapshots its quantity, price, per-order shipping, specifications, inspection period, warranty rules, original parties and milestone definitions before funding. Stock is rechecked and decremented atomically when funding succeeds; unfunded drafts do not reserve it. A second order cannot consume an already-sold unit.

The seller records shipment references. A seller-reported carrier status is not independently authenticated. The buyer’s receipt confirmation starts inspection and creates a delivery submission; it does **not release principal**. The buyer must accept the original requirements, negotiate or use dispute resolution. Goods use manual acceptance rather than an automatic “courier delivered” payout.

The optional warranty milestone retains a stated share of principal. Its period starts on confirmed receipt. Only the remaining held share is protection; released money cannot be recalled. Early unilateral warranty release is blocked. A genuine bilateral settlement may resolve the holdback under the accepted agreement.

## Returns and replacement agreements

The return request must be within the agreed inspection window and before the main delivery has been paid. The seller authorizes instructions; the buyer records return shipment; the seller confirms what came back. The seller can offer full refund of unresolved balances. Each actual original buyer acceptance remains necessary. If either party refuses, funds remain held until a permitted negotiated or formal resolution.

A pending return blocks ordinary acceptance, but does not erase the parties’ ability to negotiate. A mutually accepted replacement amendment on the main delivery records the previous fulfillment and resets shipping/receipt/inspection for a new cycle, without changing payment destinations or imposing another full commission.

No automatic carrier fetching, warehouse acceptance, actual shipping-label purchase, condition assessment or return-stock reconciliation is implemented. Use fictional delivery references in this demo; real addresses and photos require a private storage and access-control design.
