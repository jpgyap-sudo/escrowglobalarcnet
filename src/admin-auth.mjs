/**
 * Session authentication for the operator console.
 *
 * This module deliberately keeps sessions in memory: restarting the sandbox
 * invalidates every operator session. Passwords are represented only by a
 * scrypt hash in the process environment; plaintext passwords never belong in
 * source, state, logs, or the browser after login.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const ADMIN_SESSION_COOKIE = 'eg_admin_session';
export const ADMIN_CSRF_COOKIE = 'eg_admin_csrf';
export const PASSWORD_HASH_PREFIX = 'scrypt';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const SESSION_TTL_MS = ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_SWEEP_MS = 60 * 1000;
const MAX_SESSIONS = 128;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;
const MAX_LOGIN_KEYS = 2048;
const HASH_MAX_MEM = 256 * 1024 * 1024;

const sessions = new Map();
const failures = new Map();
const sweeper = setInterval(() => sweepSessions(), SESSION_SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

function now() { return Date.now(); }

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length ? decoded : null;
}

export function parsePasswordHash(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('$');
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) return null;
  const [, nText, rText, pText, saltText, digestText] = parts;
  const N = Number(nText), r = Number(rText), p = Number(pText);
  if (!Number.isSafeInteger(N) || N < 1 << 14 || N > 1 << 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isSafeInteger(r) || r < 1 || r > 32 || !Number.isSafeInteger(p) || p < 1 || p > 16) return null;
  const salt = decodeBase64(saltText), digest = decodeBase64(digestText);
  if (!salt || salt.length < 16 || !digest || digest.length < 16 || digest.length > 128) return null;
  return { N, r, p, salt, digest };
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function loadAdminConfig(env = process.env) {
  const email = normalizeEmail(env.ADMIN_EMAIL);
  const passwordHash = env.ADMIN_PASSWORD_HASH;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!parsePasswordHash(passwordHash)) return null;
  return Object.freeze({ email, passwordHash });
}

export async function verifyPassword(password, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed || typeof password !== 'string' || password.length === 0) return false;
  const derived = await scryptAsync(password, parsed.salt, parsed.digest.length, {
    N: parsed.N, r: parsed.r, p: parsed.p, maxmem: HASH_MAX_MEM
  });
  return derived.length === parsed.digest.length && timingSafeEqual(derived, parsed.digest);
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right), length = Math.max(a.length, b.length, 1);
  const ap = Buffer.alloc(length), bp = Buffer.alloc(length);
  a.copy(ap); b.copy(bp);
  return timingSafeEqual(ap, bp) && a.length === b.length;
}

function sweepSessions() {
  const cutoff = now();
  for (const [sid, session] of sessions) {
    if (cutoff - session.createdAt > SESSION_TTL_MS || cutoff - session.lastSeen > SESSION_IDLE_MS) sessions.delete(sid);
  }
  for (const [key, timestamps] of failures) {
    while (timestamps.length && cutoff - timestamps[0] > LOGIN_WINDOW_MS) timestamps.shift();
    if (!timestamps.length) failures.delete(key);
  }
}

function boundedInsert(map, key, value) {
  if (map.size >= MAX_LOGIN_KEYS && !map.has(key)) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

export function isLoginRateLimited(ip, email = '') {
  const cutoff = now() - LOGIN_WINDOW_MS;
  return [String(ip || 'unknown'), normalizeEmail(email)].filter(Boolean).some(key => {
    const timestamps = failures.get(key) || [];
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    if (timestamps.length) boundedInsert(failures, key, timestamps);
    return timestamps.length >= LOGIN_FAILURE_LIMIT;
  });
}

export function recordLoginFailure(ip, email = '') {
  const timestamp = now();
  for (const key of [String(ip || 'unknown'), normalizeEmail(email)].filter(Boolean)) {
    const timestamps = failures.get(key) || [];
    while (timestamps.length && timestamp - timestamps[0] > LOGIN_WINDOW_MS) timestamps.shift();
    timestamps.push(timestamp);
    boundedInsert(failures, key, timestamps);
  }
}

export function clearLoginFailures(ip, email = '') {
  failures.delete(String(ip || 'unknown'));
  if (email) failures.delete(normalizeEmail(email));
}

export function createSession(email) {
  sweepSessions();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const createdAt = now();
  const session = {
    sid: randomBytes(32).toString('base64url'),
    csrf: randomBytes(32).toString('base64url'),
    email,
    createdAt,
    lastSeen: createdAt
  };
  sessions.set(session.sid, session);
  return { ...session };
}

export function getSession(sid) {
  if (typeof sid !== 'string' || sid.length < 32) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  const current = now();
  if (current - session.createdAt > SESSION_TTL_MS || current - session.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeen = current;
  return { ...session };
}

export function destroySession(sid) {
  if (typeof sid === 'string') sessions.delete(sid);
}

export function parseCookies(header) {
  const result = Object.create(null);
  if (typeof header !== 'string') return result;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim(), value = part.slice(separator + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch { result[name] = value; }
  }
  return result;
}

export function sessionCookie(sid) {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function csrfCookie(token) {
  return `${ADMIN_CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}; Secure; SameSite=Strict`;
}

export function clearAuthCookies() {
  return [
    `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    `${ADMIN_CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Strict`
  ];
}

export function csrfValid(session, csrfHeader, csrfCookieValue) {
  return Boolean(session && constantTimeEqual(session.csrf, csrfHeader) && constantTimeEqual(session.csrf, csrfCookieValue));
}

