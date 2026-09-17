import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearAuthCookies,
  clearLoginFailures,
  constantTimeEqual,
  createSession,
  csrfCookie,
  csrfValid,
  destroySession,
  getSession,
  isLoginRateLimited,
  loadAdminConfig,
  normalizeEmail,
  parseCookies,
  parsePasswordHash,
  recordLoginFailure,
  sessionCookie,
  verifyPassword
} from '../src/admin-auth.mjs';

const password = 'test-only-password';
const salt = randomBytes(16);
const hash = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64')}`;

test('admin password hashes and config are validated without plaintext storage', async () => {
  assert.deepEqual(parsePasswordHash(hash)?.N, 16384);
  assert.equal(parsePasswordHash('plaintext-password'), null);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.deepEqual(loadAdminConfig({ ADMIN_EMAIL: ' JPgyap@GMAIL.com ', ADMIN_PASSWORD_HASH: hash }), {
    email: 'jpgyap@gmail.com', passwordHash: hash
  });
  assert.equal(loadAdminConfig({ ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD_HASH: hash }), null);
  assert.equal(normalizeEmail('  Operator@Example.com '), 'operator@example.com');
});

test('admin sessions, cookies, and CSRF tokens have the expected boundaries', () => {
  const session = createSession('operator@example.test');
  assert.equal(getSession(session.sid)?.email, 'operator@example.test');
  assert.equal(csrfValid(session, session.csrf, session.csrf), true);
  assert.equal(csrfValid(session, session.csrf, 'wrong-token'), false);
  assert.equal(constantTimeEqual(session.csrf, session.csrf), true);
  assert.equal(constantTimeEqual(session.csrf, 'wrong-token'), false);

  const cookieHeader = `${sessionCookie(session.sid)}; ${csrfCookie(session.csrf)}`;
  const cookies = parseCookies(cookieHeader);
  assert.equal(cookies[ADMIN_SESSION_COOKIE], session.sid);
  assert.equal(cookies[ADMIN_CSRF_COOKIE], session.csrf);
  assert.match(sessionCookie(session.sid), /HttpOnly/);
  assert.match(sessionCookie(session.sid), /Secure/);
  assert.match(csrfCookie(session.csrf), /SameSite=Strict/);
  assert.equal(clearAuthCookies().length, 2);
  destroySession(session.sid);
  assert.equal(getSession(session.sid), null);
});

test('admin login failures are rate limited by IP and account and can be cleared', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const email = `operator-${randomBytes(6).toString('hex')}@example.test`;
  clearLoginFailures(ip, email);
  assert.equal(isLoginRateLimited(ip, email), false);
  for (let i = 0; i < 8; i++) recordLoginFailure(ip, email);
  assert.equal(isLoginRateLimited(ip, email), true);
  clearLoginFailures(ip, email);
  assert.equal(isLoginRateLimited(ip, email), false);
});
