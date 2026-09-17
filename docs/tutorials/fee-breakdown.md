# Understand the fee and refund math

Payments · 3 min · External references checked 2026-09-12.

See exactly how the buyer fee reserve, seller payout and refund interact before funding a milestone.

## 1. Start with the principal

The principal is the amount intended for the seller when the agreed work is released. In the example, the principal is 1,000 demo USDC.

## 2. Add the disclosed reserve

The buyer adds a 3% commission reserve, so the simulated funding total is 1,030. The reserve is not hidden and is kept separate from seller principal.

## 3. Release accepted work

When the current acceptance conditions are approved, the seller receives the released principal and the platform receives the formula-based commission from the reserve.

## 4. Refund without release

If the milestone is refunded before a dispute, the buyer receives the principal plus any unused reserve. A partial settlement returns the unresolved remainder according to the recorded proposal.

## 5. Treat disputes separately

A formal dispute charge is an additional 5% of the disputed milestone principal in this prototype. It is not taken from the seller payout or treated as a refundable bond.

## Important limitation

All amounts in this guide are simulated integer token units. The policy is a product prototype, not a legal, tax or financial guarantee.

## References

This guide describes the Escrow Global sandbox, not a live escrow service.
