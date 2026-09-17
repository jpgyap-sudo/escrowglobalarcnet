// Security primitives for the engagement slice.
//
// SAFETY INVARIANTS (do not weaken):
//  * Trusted client IP is ONLY read from `x-escrow-client-ip`, and ONLY when
//    TRUST_ENGAGEMENT_PROXY=true AND the immediate socket peer is loopback.
//    `x-forwarded-for` is NEVER consulted. Nginx must overwrite (not append)
//    the header. If this invariant is violated, analytics geo/rate-limit
//    accuracy is not guaranteed.
//  * Country is ONLY read from `x-escrow-country`, and ONLY when trustProxy
//    AND geoReady are true AND the socket peer is loopback. Any value that is
//    not an assigned ISO 3166-1 alpha-2 code becomes 'ZZ'.
//  * Public origins are exact-match strings. No wildcards, no null origins,
//    no userinfo, no paths, no query strings.
//  * Raw IPs, cookies, and session tokens are never persisted verbatim; only
//    HMAC/SHA-256 derived keys are stored.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const RETENTION_DAYS = 90;
export const DAY = 86400000;
export const CHAT_COOKIE = '__Host-eg_chat';
export const CHAT_COOKIE_MAX_AGE = RETENTION_DAYS * 24 * 60 * 60; // 7776000

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_BODY_CHARS = 2000;
const MAX_DISPLAY_NAME_CHARS = 60;
const MAX_EMAIL_CHARS = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PATH_INPUT = 4096;
const MAX_REFERRER_HOST = 253;

// ISO 3166-1 alpha-2 assigned codes (subset used by DB-IP Lite output).
// We accept only these; anything else -> 'ZZ'. This intentionally excludes
// user-assigned codes (AA, QM-QZ, XA-XZ, ZZ) and reserved codes.
const ISO_ALPHA2 = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU',
  'WF','WS',
  'YE','YT',
  'ZA','ZM','ZW',
]);

export class EngagementError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = 'EngagementError';
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export function error(status, code, message, retryAfter) {
  throw new EngagementError(status, code, message, retryAfter);
}

// Strict object shape check: plain object, no arrays, no unknown keys.
export function exact(data, keys) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    error(400, 'BAD_REQUEST', 'Expected a JSON object');
  }
  const allowed = new Set(keys);
  for (const k of Object.keys(data)) {
    if (!allowed.has(k)) {
      error(400, 'BAD_REQUEST', `Unknown field: ${k}`);
    }
  }
  return data;
}

function countChars(s) {
  // Count Unicode code points (not UTF-16 units) to match SQL length().
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function validEmail(s) {
  if (!EMAIL_RE.test(s)) return false;
  const at = s.indexOf('@');
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return at === s.lastIndexOf('@') &&
    !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    !domain.startsWith('.') && !domain.endsWith('.') && !domain.includes('..');
}

export function validateMessage(data, visitor = false) {
  const keys = visitor ? ['body', 'clientId', 'displayName', 'email'] : ['body', 'clientId'];
  exact(data, keys);
  const { body, clientId } = data;
  if (typeof body !== 'string') error(400, 'BAD_REQUEST', 'body must be a string');
  if (body.includes('\u0000')) error(400, 'BAD_REQUEST', 'body must not contain NUL');
  const trimmed = body.trim();
  if (trimmed.length === 0) error(400, 'BAD_REQUEST', 'body must not be empty');
  const n = countChars(trimmed);
  if (n < 1 || n > MAX_BODY_CHARS) {
    error(400, 'BAD_REQUEST', `body must be 1..${MAX_BODY_CHARS} characters`);
  }
  if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) {
    error(400, 'BAD_REQUEST', 'clientId must be 8..100 safe ASCII characters');
  }
  let displayName;
  let email;
  if (visitor) {
    if (data.displayName === undefined) {
      error(400, 'BAD_REQUEST', 'displayName is required');
    }
    if (typeof data.displayName !== 'string') {
      error(400, 'BAD_REQUEST', 'displayName must be a string');
    }
    const dn = data.displayName.trim();
    if (dn.includes('\u0000')) error(400, 'BAD_REQUEST', 'displayName must not contain NUL');
    const dnLen = countChars(dn);
    if (dnLen < 1 || dnLen > MAX_DISPLAY_NAME_CHARS) {
      error(400, 'BAD_REQUEST', `displayName must be 1..${MAX_DISPLAY_NAME_CHARS} characters`);
    }
    displayName = dn;

    if (data.email === undefined) {
      error(400, 'BAD_REQUEST', 'email is required');
    }
    if (typeof data.email !== 'string') {
      error(400, 'BAD_REQUEST', 'email must be a string');
    }
    const normalizedEmail = data.email.trim().toLowerCase();
    const emailLen = countChars(normalizedEmail);
    if (normalizedEmail.includes('\u0000')) {
      error(400, 'BAD_REQUEST', 'email must not contain NUL');
    }
    if (emailLen < 3 || emailLen > MAX_EMAIL_CHARS || !validEmail(normalizedEmail)) {
      error(400, 'BAD_REQUEST', `email must be a valid email address of 3..${MAX_EMAIL_CHARS} characters`);
    }
    email = normalizedEmail;
  }
  return { body: trimmed, clientId, displayName, email };
}

export function validateToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function chatCookie(token) {
  if (!validateToken(token)) {
    throw new EngagementError(500, 'INTERNAL', 'Invalid token for cookie');
  }
  return `${CHAT_COOKIE}=${token}; Path=/; Max-Age=${CHAT_COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Strict`;
}

export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function hmac(secret, ...parts) {
  const h = createHmac('sha256', secret);
  h.update(JSON.stringify(parts), 'utf8');
  return h.digest('hex');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length > 128 || b.length > 128) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length > 128 || bb.length > 128) return false;
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseOrigin(raw, { allowHttpLoopback }) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw === 'null' || raw === '*') return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.hostname.includes('*')) return null;
  if (u.pathname !== '/' || u.search || u.hash) return null;
  if (raw !== u.origin) return null;
  if (u.protocol === 'https:') {
    // ok
  } else if (u.protocol === 'http:') {
    if (!allowHttpLoopback) return null;
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
      return null;
    }
  } else {
    return null;
  }
  // Normalize: origin form without trailing slash.
  return `${u.protocol}//${u.host}`;
}

function parseBoolEnv(name, value) {
  if (value === undefined || value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new EngagementError(500, 'CONFIG_INVALID', `${name} must be 'true' or 'false'`);
}

// Parse a primary env var with an optional legacy alias. Both are validated
// strictly (only 'true'/'false'/undefined/empty accepted). If both are set
// (nonempty) and disagree, startup fails with CONFIG_INVALID. Otherwise the
// primary value wins, falling back to the alias.
function parseAliasedBool(primaryName, aliasName, env) {
  const primaryRaw = env[primaryName];
  const aliasRaw = env[aliasName];
  const primarySet = primaryRaw !== undefined && primaryRaw !== null && primaryRaw !== '';
  const aliasSet = aliasRaw !== undefined && aliasRaw !== null && aliasRaw !== '';
  const primaryVal = parseBoolEnv(primaryName, primaryRaw);
  const aliasVal = parseBoolEnv(aliasName, aliasRaw);
  if (primarySet && aliasSet && primaryVal !== aliasVal) {
    throw new EngagementError(
      500,
      'CONFIG_INVALID',
      `${primaryName} and ${aliasName} disagree; set only one or make them equal`,
    );
  }
  return primarySet ? primaryVal : aliasVal;
}

export function loadEngagementConfig(env = process.env, port = 0) {
  const origins = new Set();
  const loopbackPort = Number.isInteger(port) && port > 0 ? port : 0;
  if (loopbackPort > 0) {
    origins.add(`http://127.0.0.1:${loopbackPort}`);
    origins.add(`http://localhost:${loopbackPort}`);
  }

  const raw = env.ENGAGEMENT_PUBLIC_ORIGINS ?? env.PUBLIC_ORIGINS ?? 'https://www.escrowglobal.io,https://escrowglobal.io';
  if (raw !== undefined && raw !== null && raw !== '') {
    if (typeof raw !== 'string') {
      throw new EngagementError(500, 'CONFIG_INVALID', 'ENGAGEMENT_PUBLIC_ORIGINS must be a string');
    }
    for (const piece of raw.split(',')) {
      const trimmed = piece.trim();
      if (trimmed === '') continue;
      const parsed = parseOrigin(trimmed, { allowHttpLoopback: true });
      if (!parsed) {
        throw new EngagementError(
          500,
          'CONFIG_INVALID',
          `Invalid origin in ENGAGEMENT_PUBLIC_ORIGINS: ${trimmed}`,
        );
      }
      origins.add(parsed);
    }
  }

  // Primary names are TRUST_ENGAGEMENT_PROXY / ENGAGEMENT_GEO_READY.
  // Legacy aliases TRUST_PROXY / GEO_READY are accepted for compatibility.
  const trustProxy = parseAliasedBool('TRUST_ENGAGEMENT_PROXY', 'TRUST_PROXY', env);
  const geoReady = parseAliasedBool('ENGAGEMENT_GEO_READY', 'GEO_READY', env);
  if (geoReady && !trustProxy) {
    throw new EngagementError(
      500,
      'CONFIG_INVALID',
      'ENGAGEMENT_GEO_READY requires TRUST_ENGAGEMENT_PROXY=true',
    );
  }

  return Object.freeze({
    publicOrigins: Object.freeze([...origins]),
    trustProxy,
    geoReady,
  });
}

export function requirePublicOrigin(req, config) {
  const raw = singleHeader(req, 'origin');
  if (typeof raw !== 'string' || raw.length === 0) {
    error(403, 'ORIGIN_REQUIRED', 'Origin header required');
  }
  if (raw.includes(',')) {
    error(403, 'ORIGIN_INVALID', 'Multiple origins not allowed');
  }
  if (!config.publicOrigins.includes(raw)) {
    error(403, 'ORIGIN_FORBIDDEN', 'Origin not allowed');
  }
  return raw;
}

function isLoopbackPeer(req) {
  const addr = req.socket?.remoteAddress;
  if (typeof addr !== 'string') return false;
  if (isIP(addr) === 0) return false;
  if (addr === '::1') return true;
  if (addr.startsWith('127.')) return true;
  if (addr.startsWith('::ffff:127.')) return true;
  return false;
}

function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (trimmed.includes(',')) return null;
  if (isIP(trimmed) === 0) return null;
  return trimmed;
}

export function trustedRequest(req, config) {
  const loopback = isLoopbackPeer(req);
  let source = null;
  if (config.trustProxy && loopback) {
    const hdr = req.headers?.['x-escrow-client-ip'];
    if (typeof hdr === 'string') {
      source = normalizeIp(hdr);
    }
  }
  if (source === null) {
    source = normalizeIp(req.socket?.remoteAddress) ?? '0.0.0.0';
  }

  let country = 'ZZ';
  if (config.trustProxy && config.geoReady && loopback) {
    const hdr = req.headers?.['x-escrow-country'];
    if (typeof hdr === 'string') {
      const up = hdr.trim().toUpperCase();
      if (up.length === 2 && ISO_ALPHA2.has(up)) country = up;
    }
  }
  return { source, country };
}

const KNOWN_ROUTES = new Set([
  'market', 'templates', 'orders', 'deal', 'product', 'wallet',
  'learn', 'blog', 'support', 'profile', 'settings', 'agreements',
]);

export function sanitizePath(input) {
  if (typeof input !== 'string') return '/other';
  if (input.length === 0 || input.length > MAX_PATH_INPUT) return '/other';
  let s = input;

  // Reject full URLs.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return '/other';

  // Prefer SPA hash route if present.
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) {
    const after = s.slice(hashIdx + 1);
    if (after.startsWith('/')) s = after;
  }

  // Strip query and any remaining hash.
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  const hIdx = s.indexOf('#');
  if (hIdx >= 0) s = s.slice(0, hIdx);

  if (!s.startsWith('/')) return '/other';
  if (s === '/' || s === '/index.html') return '/';

  // Take first non-empty segment.
  const segs = s.split('/').filter((x) => x.length > 0);
  if (segs.length === 0) return '/';
  const first = segs[0].toLowerCase();
  if (KNOWN_ROUTES.has(first)) return `/${first}`;
  return '/other';
}

export function sanitizeReferrer(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) return 'Direct';
  let u;
  try {
    u = new URL(input);
  } catch {
    return 'Direct';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Direct';
  if (u.username || u.password) return 'Direct';
  let host = u.hostname.toLowerCase();
  if (host.length === 0 || host.length > MAX_REFERRER_HOST) return 'Direct';
  // Strip IPv6 brackets BEFORE isIP so bracketed literals are detected.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.length === 0) return 'Direct';
  // IP literal host -> Direct (avoid storing raw IP).
  if (isIP(host) !== 0) return 'Direct';
  return host;
}

let displayNames = null;
function getDisplayNames() {
  if (displayNames) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

export function countryName(code) {
  if (typeof code !== 'string' || code.length !== 2) return 'Unknown';
  const up = code.toUpperCase();
  if (up === 'ZZ') return 'Unknown';
  if (!ISO_ALPHA2.has(up)) return 'Unknown';
  const dn = getDisplayNames();
  if (!dn) return up;
  try {
    const name = dn.of(up);
    return typeof name === 'string' && name.length > 0 ? name : up;
  } catch {
    return up;
  }
}

const BOT_RE = /bot|crawler|spider|headless|slurp|preview/i;

export function shouldIgnoreAnalytics(req) {
  const h = req.headers ?? {};
  const dnt = h['dnt'];
  if (typeof dnt === 'string' && dnt.trim() === '1') return true;
  const gpc = h['sec-gpc'];
  if (typeof gpc === 'string' && gpc.trim() === '1') return true;
  const ua = h['user-agent'];
  if (typeof ua === 'string' && ua.length > 0) {
    if (BOT_RE.test(ua.slice(0, 1024))) return true;
  }
  return false;
}

export function singleHeader(req, name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  const lower = name.toLowerCase();
  const raw = req.rawHeaders;
  if (!Array.isArray(raw)) {
    const v = req.headers?.[lower];
    if (Array.isArray(v)) error(400, 'BAD_REQUEST', 'Duplicate header not allowed');
    if (typeof v === 'string') return v;
    return null;
  }
  let found = null;
  let count = 0;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (typeof raw[i] === 'string' && raw[i].toLowerCase() === lower) {
      count++;
      if (count > 1) error(400, 'BAD_REQUEST', 'Duplicate header not allowed');
      found = raw[i + 1];
    }
  }
  if (typeof found !== 'string') return null;
  return found;
}

export function isKnownSource(source) {
  if (typeof source !== 'string' || source.length === 0) return false;
  if (source === 'unknown') return false;
  if (isIP(source) === 0) return false;
  if (source === '0.0.0.0' || source === '::') return false;
  if (source === '::1' || source === '127.0.0.1' || source === '::ffff:127.0.0.1') return false;
  if (source.startsWith('127.')) return false;
  if (source.startsWith('::ffff:127.')) return false;
  return true;
}
