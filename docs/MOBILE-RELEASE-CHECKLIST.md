# Native release checklist — not store approval
Checked 2026-09-12. These are implementation tasks, not legal conclusions about your specific distribution.

## Payment classification

Apple distinguishes physical goods/services consumed outside the app from in-app digital goods and functionality. A marketplace containing both physical products and digital assets must classify each transaction correctly. Cryptocurrency payments do not automatically exempt in-app digital sales from store rules. External-purchase rules also vary by region/program and change over time. Review Google Play’s current payments policy separately.

Do not hide financial features from review and then enable them remotely. Describe wallet, exchange/on-ramp, dispute and custody behavior accurately, including who operates and is licensed for each activity in every distribution region. Obtain necessary financial-services declarations/authorizations and review the current store requirements before enabling those features.

## Distribution checklist

- Organization-owned developer accounts, unique identifiers, signing keys/certificates, release channels, test accounts and named support contacts.
- SDK builds and device tests for both operating systems, tablet/phone layouts, screen reader/font scaling, keyboard overlap, rotation, slow network, offline state and return from external apps.
- Authentication, account recovery, logout, session expiry, account deletion and data export/deletion policies matching the actual backend.
- Accurate privacy labels/Data Safety, draft privacy manifest reviewed against the compiled app, consent screens and minimum necessary permissions. No seed phrase collection.
- User-generated-content reporting, blocking, moderation, response processes and legal terms. Demo report/block buttons are not a staffed production moderation system.
- Native wallet integration and verified links, safe browser handoff, provider sandbox end-to-end tests, chain transaction reconciliation and explicit transaction previews.
- Real, audited custody and controlled operator permissions before any customer deposit; no local demo balances presented as real tokens.
- Screenshots and store descriptions reflecting the actual enabled features. Do not advertise insurance, guarantees, regulator approval or irreversible “trustlessness” without support.

## Sources

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play payments: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en
- Google Play financial services: https://support.google.com/googleplay/android-developer/answer/9876821?hl=en

The supplied native code is an offline review template, not an approved or tested release binary. Store decisions depend on the submitted app, business model, region and documentation.
