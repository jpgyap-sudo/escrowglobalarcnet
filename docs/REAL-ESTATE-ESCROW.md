# Real-estate escrow workflow

Escrow Global now includes a **Real estate escrow** agreement template. It is an earnest-only, off-chain sandbox workflow: it records a fictional property reference, purchase price, earnest deposit, due-diligence window, financing/appraisal contingencies, settlement contact label, target closing date, and a closing checklist. The existing bilateral acceptance, funding, milestone release, dispute, fixed-recipient, and terms-hash rules still apply.

## Why these fields

The workflow is intentionally shaped around common closing coordination needs:

- The CFPB describes earnest money as a deposit held until consummation and describes settlement agents as coordinating documents, funds, and disbursement.
- CFPB closing guidance emphasizes itemized closing costs, cash to close, title/closing service providers, and confirming the closing timeline.
- FTC consumer guidance warns that last-minute changes to real-estate wiring instructions are a common impersonation scam; instructions should be verified through a known contact rather than a reply or new message.

This product translates those ideas into a checklist rather than pretending to perform title search, appraisal, underwriting, recording, or regulated escrow services.

## Sandbox boundaries

Only the earnest deposit is represented in the simulated ledger. The purchase price is informational, and “cash to close after earnest” is a planning calculation—not a payment request. Property references reject street-address and postal-code patterns, and the form asks users not to enter personal data. No live custody, title verification, legal advice, lender integration, KYC, wire instructions, or closing-agent authority is implemented.

Before a production build, add authenticated parties, jurisdiction-specific legal review, licensed settlement/title partners, private document storage, verified payment-instruction controls, reconciliation, and a separately audited custody/disbursement service.

## References

- [CFPB: What is a mortgage closing?](https://www.consumerfinance.gov/ask-cfpb/what-is-a-mortgage-closing-what-happens-at-the-closing-en-176/)
- [CFPB: Closing Disclosure explainer](https://www.consumerfinance.gov/owning-a-home/closing-disclosure/)
- [CFPB: Shop for title insurance and other closing services](https://www.consumerfinance.gov/owning-a-home/close/shop-for-title-insurance-and-other-closing-services/)
- [FTC: Shopping for a mortgage FAQs](https://consumer.ftc.gov/articles/shopping-mortgage-faqs)
- [ALTA: Protect your money from closing scams](https://www.alta.org/business-operations/marketing/unbranded/protect-your-money-from-closing-scams-when-buying-a-home-usa.pdf)
