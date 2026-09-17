# Admin and visitor engagement operations

Scope: operator UI, first-party traffic aggregates and persistent human-to-human support chat. **Real traffic/chat are not real escrow custody.** Marketplace fixtures, moderation examples, balances and financial charts remain sandbox data. The static marketplace is not synchronized with all sandbox admin settings.

## Runtime and boundaries

- Node **22.13 or newer**; tested deployment target is 22.22.2. SQLite is built in, no npm runtime dependencies. On Node 22 it may emit the experimental SQLite warning. See [Node SQLite history](https://nodejs.org/api/sqlite.html), consulted 2026-09-13.
- Service: `escrow-global-admin`, loopback `127.0.0.1:4174`.
- Root-owned code: `/opt/escrow-global-admin/releases/<commit>/app`; `current` points to that app directory.
- Persistent writable state: `/opt/escrow-global-admin/data`. Never replace this directory with a release or overwrite its sandbox state/journal.
- Dedicated nologin service identity: `escrow-global-admin`. The supplied systemd unit grants write access only to the data directory and private temporary storage; code is not service-writable.
- Secrets: `/etc/escrow-global-admin.env`, root-owned mode 0600. Never put credentials in source, Git, release manifests or browser JavaScript. Preserve the existing scrypt password verifier and session configuration.
- Admin sessions are in memory: an application restart requires sign-in again. Visitor chat is durable in SQLite and survives restart when the visitor cookie, database and companion secret are retained.

Additional environment (existing admin variables remain unchanged):

```ini
ENGAGEMENT_PUBLIC_ORIGINS=https://escrowglobal.io,https://www.escrowglobal.io
TRUST_ENGAGEMENT_PROXY=true
ENGAGEMENT_GEO_READY=true
ENGAGEMENT_DB_FILE=/opt/escrow-global-admin/data/engagement.sqlite
```

`ENGAGEMENT_GEO_READY` must be false unless offline lookup and the trusted proxy path have been verified. The companion database secret is generated server-side. Back up `engagement.sqlite.secret` with the database; do not regenerate it for an existing database.

## Traffic interpretation and privacy

- Collection begins at deployment, not retrospectively. No fabricated countries, history, visitors or growth percentages.
- Views are recorded page-group events, not a billing-grade count. Visitors are approximate daily sessions; range totals sum daily sessions and do not deduplicate people across days. Active means sessions with an event in the last five minutes, not a guarantee they remain online.
- Store only known page groups, referrer hostname, device category, country and HMAC-derived daily session/event identifiers. Strip paths containing identifiers, query strings and referrer credentials. No raw IP address or raw analytics token is stored in the engagement database. Existing infrastructure security/access logs have their own retention and are not covered by this claim.
- Respect Do Not Track and Global Privacy Control. Session storage is used for anonymous event/session identifiers. Chat uses a separate necessary Secure/HttpOnly/SameSite=Strict cookie only after opening chat; it is not an analytics cookie.
- Retention: 90 days with pruning. Support messages are not end-to-end encrypted and authorized operators can read them. Do not submit passwords, wallet keys, seed phrases or payment details.
- Visitor cookies are host-only. Opening the apex site and www can create separate support histories; keep the user on the same hostname and browser to recover a conversation.

### Why the collector uses HTTPS port 9443

On this specific VPS, a shared Xray listener owns public 443 and forwards website HTTPS to Nginx on 9443 without the original source address. Its two existing processes also serve other connections. **Do not restart or reconfigure Xray for this release.**

The script first sends to the first-party `https://www.escrowglobal.io:9443/api/analytics/event` endpoint. Direct Nginx TLS retains the source IP for an offline country lookup. If that port is blocked or times out, the script retries the ordinary same-origin endpoint using the same event ID; the server deduplicates it. Traffic through the source-hiding proxy is honestly classified **Unknown**. No third-party geolocation API receives visitor IPs.

Nginx overwrites `X-Escrow-Client-IP` and `X-Escrow-Country`. The application accepts these only with the explicit proxy-trust flag and a loopback socket. Client `X-Forwarded-For` is not an authentication/rate-limit authority. Neither normal public proxy paths nor direct 9443 expose `/api/state`, command, wallet or admin API routes.

### Geolocation database maintenance

Nginx module: Ubuntu `libnginx-mod-http-geoip2`, configured by `/etc/nginx/conf.d/escrow-engagement-http.conf`. Database: `/var/lib/escrow-global-geoip/dbip-country-lite.mmdb`, readable by Nginx, root-owned.

Initial database: DB-IP Country Lite September 2026. Uncompressed SHA-1 checked against the publisher: `385d4ab1e08417634a0a64921ac0e9c15c4c5e8a`. Country estimates can be wrong, especially for VPNs. The free database is monthly and CC BY 4.0; keep visible **[IP Geolocation by DB-IP](https://db-ip.com)** attribution. Sources consulted 2026-09-13: [download and checksums](https://db-ip.com/db/download/ip-to-country-lite), [free license/limitations](https://db-ip.com/db/lite.php), [MMDB field format](https://db-ip.com/db/format/ip-to-country-lite/mmdb.html), [Nginx module configuration](https://github.com/leev/ngx_http_geoip2_module).

Refresh manually: download the current month from the publisher to a separate staging file, verify its published checksum after decompression, retain the previous database, then atomically install it root-owned mode 0644 at the configured path. Run `nginx -t` before reload. No automatic updater or recurring task is installed by this change.

## Build, deploy and rollback

Build only committed source using `scripts/build-engagement-release.mjs --out <absolute-new-directory> --ref <commit>`. The output must be outside the repository and must not exist. It includes SHA-256 hashes in `manifest.json` and a minimal runtime package. The public static baseline is pinned to commit `6fcf7b6b4e09338f65d2fae76504e40fcd5cef93` with SHA-256 `169b0c977cdf85181de1fe626fa30a32c6e3478124043ab22acbf1cc0288fe99`; only the new widget stylesheet/script are injected. This avoids publishing unrelated dirty marketplace/custody work.

1. Verify every manifest hash after upload; install under a new immutable release directory. Never copy developer `.env`, `.git`, local databases or memory files.
2. Back up current app, systemd unit, env, public HTML/assets and both Nginx sites before activation. Back up an existing SQLite database consistently: briefly stop the app and copy database, WAL/SHM (if present) and secret together, or use SQLite's online backup facility. Copying only a live main DB file can miss WAL data.
3. Preserve all state; create the dedicated user only if absent and adjust ownership only under the named data directory. Keep env root-readable only.
4. Point `current` at the verified app directory; install the reviewed unit and run `systemd-analyze verify`. Set only the engagement env additions, preserving existing credentials. Run `systemctl daemon-reload` and restart this app only.
5. Verify loopback authentication/health and persistence, then install the reviewed Nginx files, run `nginx -t` and reload Nginx. Reload is asynchronous: allow a bounded transition and check actual new page content/status before concluding that old-worker responses indicate failure. Do not alter shared 443/Xray services, unrelated sites, DNS or email records.
6. Verify public TLS, assets/MIME, collector preflight, allowed origins, root admin landing, unauthenticated API denials and blocked sandbox APIs. Exercise chat send/reply, idempotent retry, isolation and persistence; check desktop and mobile UI.

Pre-upgrade backup for this change: `/var/backups/escrow-global/20260912T230756Z`. Original Nginx files are explicitly named **`escrowglobal.io.preupgrade`** and **`admin.escrowglobal.io.preupgrade`**; the unsuffixed files in that backup directory are staging proposals, not rollback originals.

Rollback: stop only `escrow-global-admin`; restore the backed-up unit/env and previous code path without overwriting the latest persistent data. Restore the `.preupgrade` Nginx files and previous static HTML/assets, move the new engagement HTTP config aside if it did not previously exist, then `nginx -t`, daemon-reload, start the app and reload Nginx. Keep new chat data/secret archived even when running old code. Verify sign-in and public TLS again.

## Remaining production safeguards

- Rotate the admin password supplied in chat to a unique strong value. Do not publish the supplied value or a default credential. MFA, account management and password-reset UI are separate future work; this change preserves the existing single configured operator.
- This release does not activate escrow settlement, real-money custody, email delivery, push notifications or a 24/7 support team. Replies appear while visitors reopen or keep the chat open.
- Arrange encrypted/off-site backups and a restore drill for chat if needed; this release provides local rollback backups, not a managed backup service.
- A future planned maintenance window can consolidate the duplicate shared proxy services and restore original-IP forwarding on 443. Do not silently change that architecture during a UI release.
