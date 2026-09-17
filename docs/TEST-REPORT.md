# Verification report — Escrow Global Settlement 0.3.0

Date: 2026-09-12. Windows; Node 22.23.2; Python 3.14.4; Playwright Chromium. Sandbox only.

| Check | Passed | Failed |
|---|---:|---:|
| Node domain / two-asset / migration / hash / auth / HTTP / payments | 155 | 0 |
| Existing browser workflows | 44 | 0 |
| HTTP committed-response-loss retry | 1 | 0 |
| Responsive routes × selected assets × widths | 216 | 0 |
| Browser/server migration and recovery | 10 | 0 |
| Offline/native packaging, keyboard, reflow and palette | 6 | 0 |
| Exact QR matrix comparisons | 18 | 0 |

Full command evidence, screenshots, scope, saved-data behavior, coordination and limitations: [Escrow Global verification report](rebrand/escrow-global/verification-report.md).

No real-money/provider transaction, native SDK compilation/device test or production deployment was performed. External Jupiter behavior is mocked where used in tests. This is not a security audit or a full accessibility certification. Native payment gates remain active and the live-custody API still returns 501.
