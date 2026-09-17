# Pay a local merchant with Jupiter QR Pay

Jupiter Spend · 3 min · External references checked 2026-09-12.

Merchant QR Pay and a Solana wallet QR are different payment systems. This app does not issue Jupiter merchant QR codes.

## 1. Confirm the feature is available

QR Pay currently depends on your card issuer, country and sometimes issuance date. Check the app and official support table; some corridors are temporarily unavailable.

## 2. Open the scanner in Spend

Use the Spend screen’s scan control and scan a supported merchant QR. Do not assume every QR image is compatible.

## 3. Check merchant and amount

Verify the merchant name, local-currency total, conversion and fees before authorizing. QR Pay draws from your Spend USD balance.

## 4. Keep the receipt

Save the in-app transaction reference. A merchant payment receipt is not proof that an Escrow Global vault was funded.

## 5. For Escrow Global wallet top-ups, use the other QR

Escrow Global’s Receive page creates a Solana Pay-style transfer request for your own wallet. Wallet compatibility varies, and this is neither Jupiter merchant acquiring nor escrow settlement.

## Important limitation

No merchant onboarding or acquiring API is configured in this project. The Jupiter QR section is an instructional guide, not a live merchant-payment integration.

## References

- Jupiter QR Pay support and instructions: https://docs.jup.ag/user-docs/global/spend/qr-pay
- Solana Pay transfer requests: https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests
