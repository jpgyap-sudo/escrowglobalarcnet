# Authenticated admin access

`admin.escrowglobal.io` is an authenticated **sandbox operator console**. It is
not a live-custody control plane and must not be used to authorize real funds,
wallets, recipients, or dispute outcomes.

## Required configuration

Set these values in the service environment, never in Git or a browser:

```dotenv
ADMIN_EMAIL=operator@example.com
ADMIN_PASSWORD_HASH=scrypt$32768$8$1$BASE64_SALT$BASE64_DERIVED_KEY
ADMIN_ORIGIN=https://admin.escrowglobal.io
```

Generate a hash locally from protected stdin with Node.js. The password is read
only for the command and only the resulting hash should be copied to the
environment file:

```powershell
node --input-type=module -e "import {scryptSync,randomBytes} from 'node:crypto'; import {readFileSync} from 'node:fs'; const p=readFileSync(0,'utf8').trimEnd(); const s=randomBytes(16); console.log('scrypt$32768$8$1$'+s.toString('base64')+'$'+scryptSync(p,s,32,{N:32768,r:8,p:1}).toString('base64'));"
```

Pipe the password from a protected prompt or secret store rather than placing
it in command history. Do not put a plaintext password in a source file,
`.env.example`, or deployment artifact.

## Session behavior

- Login is available at `/admin` and uses the configured email and password.
- Passwords are verified with scrypt; plaintext passwords are never persisted.
- Sessions are in memory, expire after eight hours, and expire after 30 minutes
  of inactivity. Restarting the service signs out all operators.
- Mutating admin requests require the session plus a CSRF token. Login failures
  are rate limited by source IP and normalized account for 15 minutes.
- The admin Nginx site exposes only the admin UI and `/api/admin/*` routes. It
  does not proxy the public marketplace API.

## Operational safeguards

Keep the environment file mode `0600`, keep the Node service bound to
`127.0.0.1`, and terminate TLS at Nginx. Verify the service and Nginx config
after every deployment. The custody readiness page is a release gateboard only;
the sandbox build has no live-money adapter.
