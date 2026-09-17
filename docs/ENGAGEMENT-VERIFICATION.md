# Admin engagement release verification

Verified 2026-09-13 on the VPS at `165.22.110.111` and the public HTTPS domains. Main implementation: `3c3110fc67fdc52ae2d16e1b07fe50de628dd576`. The accompanying follow-up corrects a mobile chat width issue found during live visual QA.

## Implemented and exercised

- Redesigned operator overview: real traffic KPIs, date ranges, trend/table, countries, top page groups, referrers, device categories and visitor inbox workload.
- Compact mobile section selector with every desktop section; visible sign-out. Local 390×844 navigation height reduced from approximately 460px to 113px. Desktop navigation preserved.
- Email/password sign-in retained. Global concurrent password-verification cap, bounded login input and trusted proxy source handling added. Public website cannot reach admin/state/command/wallet APIs.
- Persistent visitor chat and authenticated admin inbox: search, status, unread/read-through markers, replies, retry deduplication and per-conversation drafts. No fabricated online staff or automatic replies.
- In-page operator dialogs replace browser prompts. Keyboard focus/cancel and preserved drafts were exercised. Literal HTML in a test chat remained plain text; no image element was created.
- Public main site and blog are instrumented without rebuilding unrelated dirty marketplace work. Public admin links redirect to the admin domain; support opens chat.

## Tests

| Layer | Evidence |
| --- | --- |
| Full worktree backend/domain suite | 269 passed, 0 failed |
| Final engagement/admin/support focus | 54 passed, 0 failed |
| Committed release, isolated source tree | 53 passed, 0 failed; tests use the actual committed runtime, not the dirty worktree |
| Frontend DOM contract checks | 21 passed, 0 failed: login failures, command/CSRF envelope, draft preservation, polling/focus, retry acknowledgement, cookies, DNT/GPC, payload freezing, page/referrer sanitization and mobile navigation |
| Browser visual/functional QA | Local and live desktop/mobile; dashboard, chat transcript, sign-in, mobile navigation, note dialog, chat panel and launcher; no browser errors/warnings observed |
| Live HTTP smoke | Login, CSRF rejection, visitor isolation, idempotent send/reply, conflict rejection, valid CORS/preflight, forbidden Origin, route grouping, DNT and real geolocation passed |
| Persistence | Restarted only the admin service; the same visitor cookie recovered the same conversation and both messages. Old admin session invalidated, fresh sign-in passed |
| Server | Nginx syntax passed; app binds only 127.0.0.1:4174 under dedicated nologin user; SQLite integrity check `ok`; database and secret mode 0600; no service error entries |

The live smoke test retained **one closed conversation labelled Deployment QA**, containing one visitor message and one operator reply. No customer data was deleted. Initial analytics include verification visits; they are not historical traffic or invented activity. Country lookup reported a real country even when the test supplied conflicting client headers; Nginx overwrote those headers. The analytics database stores only the documented aggregate inputs and derived identifiers, not raw IPs.

## Deployment and recovery

- Source pushed to `jpgyap-sudo/escrow-global` on GitHub.
- A 41-file release manifest was SHA-256 verified after upload. Public baseline HTML SHA-256 remained `169b0c977cdf85181de1fe626fa30a32c6e3478124043ab22acbf1cc0288fe99` before widget injection.
- Successful activation backup: `/var/backups/escrow-global/20260913T002646Z-engagement-activation`; initial backup and rollback instructions are in the operations runbook.
- Initial health verification caught an old-worker 404 immediately after Nginx reload and automatically rolled back. Retried with bounded checks for the new worker's actual response. **Nginx reload is asynchronous; do not assume `systemctl reload` means every subsequent request immediately uses the new config.**
- Existing state/journal, credentials, certificates, DNS and unrelated services preserved. Shared Xray/VPN processes were not restarted or modified.
- Country collection uses first-party direct TLS 9443; blocked/source-hiding paths fall back to ordinary HTTPS with Unknown country. This limitation is intentional and documented, not guessed geolocation.

## Review and learning

DeepSeek `deepseek-chat` authored substantial implementation through the mandatory bridge. Codex reviewed actual changes, reconciled reviewer findings against the real reverse-proxy boundary, and ran integration/browser verification. Speculative findings assuming direct internet exposure of the entire sandbox were not accepted as evidence of an exposed route.

Post-commit hook verification for `3c3110f` reported **unknown**: no matching global hook log entry. No local `core.hooksPath` override blocks the configured global hook. Lesson capture was performed explicitly: stored locally and queued for Central Brain retry while the Brain was unreachable. Diagnostics: `C:\Users\User\.superroo\claude-hook.log` and `C:\Users\User\.superroo\retry-queue.json`.

## Deliberate limits / follow-up

Traffic and chat are real; balances, agreements and custody readiness remain a sandbox. This is not a full financial-production security audit. Country inference is approximate, analytics are not billing-grade, and retention is 90 days. The single configured operator still needs a unique strong password; MFA/account management, real custody, operator notifications and managed/off-site backups were not enabled by this release. Rotate the password supplied in chat rather than treating it as a long-term production credential.
