# Payment integrations and exact boundaries
Checked against official documentation on 2026-09-12. Recheck before release. Product availability, payment methods, network support and policies can change.

## 1. Funds never become escrow because a browser says they did

The UI keeps separate simulated USDT and USDC balances, distinct from a user’s external crypto wallet and the separate USD balance used by Jupiter Spend. No provider callback mutates the sandbox ledger. The live escrow transaction endpoint returns HTTP 501.

A production funding event must be independently derived from a finalized token transfer into the correct audited vault, for the correct mint, amount, agreement and original payer. Duplicate events must be idempotent. Wallet connect, screenshot uploads, QR scans, redirect completion and client-side `onSuccess` are never funding proof.

## 2. Jupiter swap

`public/jupiter.mjs` lazy-loads `https://plugin.jup.ag/plugin-v1.js` only after explicit user opt-in. It uses `window.Jupiter.init` with integrated display and a fixed UI container. Initial output is native Solana USDC or USDT; the widget manages its own wallet connection and quotes. This is not a contract funding transaction.

Use `npm start` rather than a `file:` URL. The plugin must be fetched over the network; a failed or timed-out load surfaces an error. Check every wallet transaction yourself, especially slippage, output mint, minimum received and network fees. Browser tests mock `window.Jupiter`; they verify initialization/callback separation, not a completed swap.

The remote widget is third-party executable code. Review its supply-chain risk and tighten CSP to actual required domains before production. Consider an isolated payment origin and approved integration architecture instead of allowing arbitrary financial code to share an authenticated app origin.

Official references:
- https://developers.jup.ag/docs/tool-kits/plugin
- https://developers.jup.ag/docs/tool-kits/plugin/html-app-example

## 3. MoonPay setup

Copy `.env.example` to `.env`. Supply your **own** sandbox partner public/secret keys. Do not copy fixture strings in tests into a real setup. Set `MOONPAY_SOLANA_USDC_CODE` and `MOONPAY_SOLANA_USDT_CODE` to the exact currently supported Solana asset codes shown in your partner dashboard/API. A ticker such as `USDC` is not enough to specify its network.

Open Wallet → Buy on the local server. Connect a compatible Wallet Standard wallet. Your wallet signs a readable, non-transaction ownership message naming this origin, receiving address, nonce, expiry and purpose. The server verifies Ed25519 and stores a five-minute HttpOnly/SameSite session. It takes the checkout destination from that session, never a replacement address in request JSON.

The server assembles and signs a full checkout URL using HMAC-SHA256 over the original query string including `?`, then appends an encoded base64 signature last. Secret keys remain server-side. The returned link opens the provider’s checkout for its final quote, KYC and payment. The provider may let users modify their own purchase details; this is a wallet top-up, not a fixed-recipient escrow payout.

Selections offered include credit/debit cards, Apple Pay, Google Pay and specified bank-transfer types. A selection is a request, not a promise that the provider supports it for that customer, currency or country. Issuers may decline purchases. Provider fees and limits are not Escrow Global’s 3% fee. Do not promise that a Jupiter Card is accepted as a crypto-purchase funding card.

No real MoonPay checkout was completed here. The API and official signing test vector passed with fixtures. Your own approved sandbox configuration and browser tests are still necessary.

### Live on-ramp gate

`MOONPAY_ENV=live` additionally requires `ALLOW_LIVE_ONRAMP=true`, live keys and a verified public customer IP. The standalone loopback server deliberately cannot supply that public client IP and will reject live checkout. It never trusts a caller’s `X-Forwarded-For` header. The included validator is intentionally public-IPv4-only.

A real deployment needs an authenticated HTTPS service, secure cookies, CSRF protections, a narrowly configured trusted edge and correct client-IP derivation, provider-approved domains, rate limits, monitoring and replay/callback handling. Do not bypass the gate with a constant IP or a browser-supplied field. The local API is not the deployment architecture.

Optional `MOONPAY_RETURN_URL` must be an approved HTTPS return URL; a return is not proof of successful payment. No automatic ledger credit or customer-support promise is implemented.

Official references:
- https://dev.moonpay.com/widget/on-ramp/integration-methods/url
- https://dev.moonpay.com/widget/on-ramp/customization/url-signing
- https://dev.moonpay.com/widget/on-ramp/customization/parameters

## 4. Other ways to acquire USDC/USDT

The UI includes an official external Transak alternative, exchange-withdrawal guidance, compatible-wallet transfer QR and Jupiter links. **There is no embedded Transak integration.** Current Transak documentation specifies server-created widget URLs; do not substitute a guessed legacy query-string widget. Adding a partner adapter requires its own credentials, authentication, supported-country checks, allowlisted checkout host and independent payment verification.

For exchange withdrawals, select native USDC or USDT on **Solana**, inspect the full address and mint, verify any withdrawal fee, and keep sufficient SOL in the spending wallet where required. This application neither selects an exchange for the user nor controls exchange approval.

Official Transak reference:
https://docs.transak.com/guides/how-to-create-a-widget-url-and-test-different-scenarios

## 5. Actual Solana transfer QR, not a merchant or escrow QR

`makeReceiveRequest` builds a standard `solana:<wallet>?spl-token=<mint>&amount=...` URI. `qr.mjs` encodes it into an SVG. Users supply their own address; no operator-controlled address is hidden in the code. Address format checks cannot establish ownership or recovery safety. No real funds should be sent to addresses appearing in tests or screenshots.

The QR is explicitly labelled **Wallet transfer · NOT ESCROW**. A transfer to the wallet goes straight to that wallet; Escrow Global cannot refund it or protect it. Native demo builds disable QR generation because the mobile financial workflow has not been implemented or reviewed.

Reference mint addresses:
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

Sources:
- https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests
- https://docs.solanapay.com/spec
- https://developers.circle.com/stablecoins/usdc-contract-addresses
- https://tether.to/en/supported-protocols/

## 6. Jupiter Global / Spend and merchant QR

Current documentation calls the spending product **Jupiter Spend**. It has a separate verified Jupiter ID. Supported deposits are converted to USD for the Spend balance; it is not simply the user’s DeFi-wallet token balance.

Jupiter QR Pay scans supported merchant/local-network codes and settles through local processors. It is **not Solana Pay**, and an Escrow Global-generated Solana URI is not a QRPh/VietQR merchant code. Support depends on card issuer, residence and activation date; some corridors are unavailable. Tutorials link to current official availability instead of hardcoding a universal promise.

There is no integrated Jupiter merchant-payment API or customer KYC collection in Escrow Global. A future merchant collection flow would need the relevant regulated merchant account/acquirer, supported rails, refunds, signed payment notifications and a separate approach to custodial escrow. Do not count a merchant QR payment as an on-chain escrow deposit. If someone pays a seller directly with Jupiter QR Pay, that bypasses this proposed escrow.

See the twelve guides in `docs/tutorials/` and the in-app Guidebook. Official sources:
- https://docs.jup.ag/user-docs/global/spend
- https://docs.jup.ag/user-docs/global/spend/jupiter-card
- https://docs.jup.ag/user-docs/global/spend/qr-pay
- https://docs.jup.ag/user-docs/global/spend/faq
