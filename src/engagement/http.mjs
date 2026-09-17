// HTTP integration for the engagement slice.
//
// SAFETY INVARIANTS (do not weaken):
//  * Public engagement routes are EXACT matches only. Unknown paths inside
//    the public namespaces return 404 with a JSON error code; they never fall
//    through to other server routes.
//  * Admin engagement routes require an existing admin session (passed in by
//    the server) AND, for POSTs, an exact-match admin Origin (loopback for
//    the running port, or env.ADMIN_ORIGIN).
//  * Public POSTs require an exact-match public Origin from the engagement
//    config. No wildcards, no null origins, no userinfo, no paths, no query.
//  * Request bodies are bounded (16 KiB) with a reliable 413 JSON response
//    even when the client streams more than the limit.
//  * Unexpected DB/native errors become 503 ENGAGEMENT_UNAVAILABLE with a
//    generic message. No SQL, paths, or stack details leak.
//  * The database is never initialized lazily on a request, and there is no
//    in-memory fallback. If the DB cannot be opened at startup, the process
//    must fail closed.

import { EngagementDatabase } from './database.mjs';
import { ChatService } from './chat.mjs';
import { AnalyticsService } from './analytics.mjs';
import {
  EngagementError,
  error,
  loadEngagementConfig,
  requirePublicOrigin,
  trustedRequest,
  chatCookie,
  validateToken,
  singleHeader,
  CHAT_COOKIE,
} from './security.mjs';
import { csrfValid, parseCookies, ADMIN_CSRF_COOKIE } from '../admin-auth.mjs';

const MAX_JSON_BYTES = 16384;
const ADMIN_ORIGIN_HEADER = 'origin';

const PUBLIC_EXACT = new Set([
  '/api/chat/session',
  '/api/chat/messages',
  '/api/analytics/event',
]);

const PUBLIC_NAMESPACES = ['/api/chat/', '/api/analytics/'];
const ADMIN_CHAT_PREFIX = '/api/admin/chat';
const ADMIN_TRAFFIC_EXACT = '/api/admin/traffic';

export function isPublicEngagementPath(pathname) {
  return PUBLIC_EXACT.has(pathname);
}

export function isEngagementPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return false;
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const ns of PUBLIC_NAMESPACES) {
    if (pathname.startsWith(ns)) return true;
  }
  if (pathname === ADMIN_TRAFFIC_EXACT) return true;
  if (pathname === ADMIN_CHAT_PREFIX) return true;
  if (pathname.startsWith(`${ADMIN_CHAT_PREFIX}/`)) return true;
  return false;
}

function isAdminEngagementPath(pathname) {
  if (pathname === ADMIN_TRAFFIC_EXACT) return true;
  if (pathname === ADMIN_CHAT_PREFIX) return true;
  if (pathname.startsWith(`${ADMIN_CHAT_PREFIX}/`)) return true;
  return false;
}

function sendJson(res, status, payload, extraHeaders) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function sendError(res, err) {
  if (err instanceof EngagementError) {
    const status = err.status;
    if ((status >= 400 && status <= 499) || status === 503) {
      const headers = err.retryAfter !== undefined ? { 'Retry-After': String(err.retryAfter) } : undefined;
      sendJson(res, status, { error: err.message, code: err.code }, headers);
      return;
    }
  }
  // Unexpected: fail closed with a generic 503. Never leak internals.
  sendJson(res, 503, {
    error: 'Engagement service is temporarily unavailable.',
    code: 'ENGAGEMENT_UNAVAILABLE',
  });
}

function contentTypeIsJson(req) {
  const raw = req.headers?.['content-type'];
  if (typeof raw !== 'string') return false;
  const parts = raw.split(';').map((p) => p.trim());
  if (parts.length === 0) return false;
  const mime = parts[0].toLowerCase();
  if (mime !== 'application/json') return false;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === '') continue;
    const eq = p.indexOf('=');
    if (eq < 0) return false;
    const k = p.slice(0, eq).trim().toLowerCase();
    const v = p.slice(eq + 1).trim().toLowerCase();
    if (k !== 'charset') return false;
    if (v !== 'utf-8' && v !== 'utf8') return false;
  }
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const cl = req.headers?.['content-length'];
    if (typeof cl === 'string' && cl.length > 0) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > MAX_JSON_BYTES) {
        req.resume();
        reject(new EngagementError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 16 KiB.'));
        return;
      }
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_JSON_BYTES) {
        // Stop buffering; keep draining to avoid socket reset.
        chunks.length = 0;
        finish(reject, new EngagementError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 16 KiB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const buf = Buffer.concat(chunks, total);
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        finish(reject, new EngagementError(400, 'BAD_REQUEST', 'Invalid UTF-8 body.'));
        return;
      }
      if (text.length === 0) {
        finish(reject, new EngagementError(400, 'BAD_REQUEST', 'Empty JSON body.'));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        finish(reject, new EngagementError(400, 'BAD_REQUEST', 'Invalid JSON body.'));
        return;
      }
      finish(resolve, parsed);
    });
    req.on('error', () => {
      finish(reject, new EngagementError(400, 'BAD_REQUEST', 'Request stream error.'));
    });
    req.on('aborted', () => {
      finish(reject, new EngagementError(400, 'BAD_REQUEST', 'Request aborted.'));
    });
  });
}

function parseDays(raw) {
  if (raw === null || raw === undefined) return 7;
  if (typeof raw !== 'string') error(400, 'BAD_REQUEST', 'days must be 7, 30, or 90');
  if (!['7', '30', '90'].includes(raw)) error(400, 'BAD_REQUEST', 'days must be 7, 30, or 90');
  return Number(raw);
}

function parseListQuery(url) {
  const status = url.searchParams.get('status') ?? 'all';
  if (!['all', 'open', 'closed'].includes(status)) {
    error(400, 'BAD_REQUEST', 'status must be all, open, or closed');
  }
  let q = url.searchParams.get('q') ?? '';
  if (typeof q !== 'string') q = '';
  if (q.length > 100) q = q.slice(0, 100);
  const offsetRaw = url.searchParams.get('offset');
  let offset = 0;
  if (offsetRaw !== null) {
    if (!/^[0-9]+$/.test(offsetRaw)) error(400, 'BAD_REQUEST', 'offset must be a non-negative integer');
    offset = Number(offsetRaw);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      error(400, 'BAD_REQUEST', 'offset out of range');
    }
  }
  const limitRaw = url.searchParams.get('limit');
  let limit = 40;
  if (limitRaw !== null) {
    if (!/^[0-9]+$/.test(limitRaw)) error(400, 'BAD_REQUEST', 'limit must be a positive integer');
    limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      error(400, 'BAD_REQUEST', 'limit must be a positive integer');
    }
    if (limit > 100) limit = 100;
  }
  return { status, q, offset, limit };
}

function decodeIdSegment(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.length === 0 || decoded.length > 128) return null;
  if (decoded.includes('/') || decoded.includes('\u0000')) return null;
  return decoded;
}

function adminOriginAllowed(req, config, port) {
  const raw = singleHeader(req, ADMIN_ORIGIN_HEADER);
  if (typeof raw !== 'string' || raw.length === 0) return false;
  if (raw.includes(',')) return false;
  const allowed = new Set();
  if (Number.isInteger(port) && port > 0) {
    allowed.add(`http://127.0.0.1:${port}`);
    allowed.add(`http://localhost:${port}`);
  }
  const envOrigin = config?.adminOrigin;
  if (typeof envOrigin === 'string' && envOrigin.length > 0) allowed.add(envOrigin);
  return allowed.has(raw);
}

function requireAdminOrigin(req, config, port) {
  if (!adminOriginAllowed(req, config, port)) {
    error(403, 'ADMIN_ORIGIN_FORBIDDEN', 'Admin Origin header required and must match.');
  }
}

function requireAdminSession(adminSession) {
  if (!adminSession || typeof adminSession.email !== 'string' || adminSession.email.length === 0) {
    error(401, 'ADMIN_UNAUTHORIZED', 'Admin sign-in required.');
  }
  return adminSession;
}

function getCookie(req, name) {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let found = null;
  for (const piece of raw.split(';')) {
    const trimmed = piece.trim();
    if (trimmed.startsWith(`${name}=`)) {
      if (found !== null) {
        error(400, 'CHAT_COOKIE_INVALID', 'Duplicate chat cookie');
      }
      found = trimmed.slice(name.length + 1);
    }
  }
  if (found === null) return null;
  if (found.length > 128) {
    error(400, 'CHAT_COOKIE_INVALID', 'Invalid chat cookie');
  }
  if (!validateToken(found)) {
    error(400, 'CHAT_COOKIE_INVALID', 'Invalid chat cookie');
  }
  return found;
}

function getHeader(req, name) {
  return singleHeader(req, name);
}

export function createEngagement({ file, env = process.env, port = 0, config } = {}) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new EngagementError(500, 'CONFIG_INVALID', 'ENGAGEMENT_DB_FILE is required');
  }
  const resolvedConfig = config ?? loadEngagementConfig(env, port);
  const secret = typeof env.ENGAGEMENT_SECRET === 'string' && env.ENGAGEMENT_SECRET.length > 0
    ? env.ENGAGEMENT_SECRET
    : undefined;
  const db = new EngagementDatabase({ file, secret });
  const chat = new ChatService(db);
  const analytics = new AnalyticsService(db, { geoReady: resolvedConfig.geoReady });

  let pruneTimer = null;
  let pruneFailure = null;
  let closed = false;

  const runPrune = () => {
    try {
      db.prune();
      pruneFailure = null;
    } catch (err) {
      pruneFailure = err;
    }
  };

  // Initial prune attempt; failures are recorded and retried on next request.
  runPrune();

  pruneTimer = setInterval(runPrune, 60 * 60 * 1000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  const ensureHealthy = () => {
    if (pruneFailure) {
      // Retry once per request to recover; if it still fails, fail closed.
      runPrune();
      if (pruneFailure) {
        throw new EngagementError(503, 'ENGAGEMENT_UNAVAILABLE', 'Engagement service is temporarily unavailable.');
      }
    }
  };

  async function handle(req, res, url, adminSession) {
    if (closed) {
      sendJson(res, 503, { error: 'Engagement service is shutting down.', code: 'ENGAGEMENT_UNAVAILABLE' });
      return true;
    }
    const pathname = url.pathname;
    const method = req.method;

    if (!isEngagementPath(pathname)) return false;

    try {
      ensureHealthy();

      if (isAdminEngagementPath(pathname)) {
        return await handleAdmin(req, res, url, adminSession);
      }
      return await handlePublic(req, res, url);
    } catch (err) {
      sendError(res, err);
      return true;
    }
  }

  async function handlePublic(req, res, url) {
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/chat/session') {
      // Cross-site GET rejection via Sec-Fetch-Site when present.
      const sfs = getHeader(req, 'sec-fetch-site');
      if (typeof sfs === 'string' && sfs.length > 0) {
        const v = sfs.toLowerCase();
        if (v === 'cross-site') {
          error(403, 'ORIGIN_FORBIDDEN', 'Cross-site request not allowed');
        }
      }
      // If an Origin is provided, it must be a configured public origin.
      const origin = getHeader(req, 'origin');
      if (typeof origin === 'string' && origin.length > 0) {
        requirePublicOrigin(req, resolvedConfig);
      }
      const token = getCookie(req, CHAT_COOKIE);
      const trusted = trustedRequest(req, resolvedConfig);
      const result = chat.session(token, trusted.source);
      const headers = {};
      if (result.newSession && result.token) {
        headers['Set-Cookie'] = chatCookie(result.token);
      }
      sendJson(res, 200, result.payload, headers);
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/messages') {
      requirePublicOrigin(req, resolvedConfig);
      if (!contentTypeIsJson(req)) {
        error(400, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
      const data = await readJson(req);
      const token = getCookie(req, CHAT_COOKIE);
      const csrf = getHeader(req, 'x-csrf-token');
      const trusted = trustedRequest(req, resolvedConfig);
      const result = chat.send(token, csrf, data, trusted.source);
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'POST' && pathname === '/api/analytics/event') {
      requirePublicOrigin(req, resolvedConfig);
      if (!contentTypeIsJson(req)) {
        error(400, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
      const data = await readJson(req);
      const trusted = trustedRequest(req, resolvedConfig);
      const result = analytics.collect(data, req, trusted);
      sendJson(res, result.status, result.payload);
      return true;
    }

    // Unknown path inside a public engagement namespace.
    error(404, 'NOT_FOUND', 'Not found');
  }

  async function handleAdmin(req, res, url, adminSession) {
    const pathname = url.pathname;
    const method = req.method;

    // Defense in depth: server must have already authenticated.
    const session = requireAdminSession(adminSession);

    if (method === 'POST') {
      requireAdminOrigin(req, { adminOrigin: env.ADMIN_ORIGIN }, port);
      const csrfHeader = getHeader(req, 'x-csrf-token');
      const cookies = parseCookies(req.headers?.cookie);
      const csrfCookie = cookies ? cookies[ADMIN_CSRF_COOKIE] : undefined;
      if (!csrfValid(session, csrfHeader, csrfCookie)) {
        error(403, 'ADMIN_CSRF_INVALID', 'Invalid CSRF token');
      }
    }

    if (method === 'GET' && pathname === '/api/admin/traffic') {
      const days = parseDays(url.searchParams.get('days'));
      const payload = analytics.traffic(days);
      sendJson(res, 200, payload);
      return true;
    }

    if (method === 'GET' && pathname === '/api/admin/chat') {
      const query = parseListQuery(url);
      const payload = chat.list(query);
      sendJson(res, 200, payload);
      return true;
    }

    const detailMatch = pathname.match(/^\/api\/admin\/chat\/([^/]+)$/);
    if (detailMatch) {
      const id = decodeIdSegment(detailMatch[1]);
      if (id === null) error(404, 'NOT_FOUND', 'Not found');
      if (method === 'GET') {
        const payload = chat.detail(id);
        sendJson(res, 200, payload);
        return true;
      }
      error(404, 'NOT_FOUND', 'Not found');
    }

    const readMatch = pathname.match(/^\/api\/admin\/chat\/([^/]+)\/read$/);
    if (readMatch) {
      const id = decodeIdSegment(readMatch[1]);
      if (id === null) error(404, 'NOT_FOUND', 'Not found');
      if (method !== 'POST') error(404, 'NOT_FOUND', 'Not found');
      if (!contentTypeIsJson(req)) {
        error(400, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
      const data = await readJson(req);
      const payload = chat.read(id, data);
      sendJson(res, 200, payload);
      return true;
    }

    const replyMatch = pathname.match(/^\/api\/admin\/chat\/([^/]+)\/reply$/);
    if (replyMatch) {
      const id = decodeIdSegment(replyMatch[1]);
      if (id === null) error(404, 'NOT_FOUND', 'Not found');
      if (method !== 'POST') error(404, 'NOT_FOUND', 'Not found');
      if (!contentTypeIsJson(req)) {
        error(400, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
      const data = await readJson(req);
      const payload = chat.reply(id, data, session.email);
      sendJson(res, 200, payload);
      return true;
    }

    const statusMatch = pathname.match(/^\/api\/admin\/chat\/([^/]+)\/status$/);
    if (statusMatch) {
      const id = decodeIdSegment(statusMatch[1]);
      if (id === null) error(404, 'NOT_FOUND', 'Not found');
      if (method !== 'POST') error(404, 'NOT_FOUND', 'Not found');
      if (!contentTypeIsJson(req)) {
        error(400, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
      const data = await readJson(req);
      const payload = chat.status(id, data);
      sendJson(res, 200, payload);
      return true;
    }

    // Unknown admin engagement path.
    error(404, 'NOT_FOUND', 'Not found');
  }

  function close() {
    if (closed) return;
    closed = true;
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    try {
      db.close();
    } catch {
      // Idempotent close: swallow.
    }
  }

  return { handle, close };
}

// Re-export for server convenience.
export { loadEngagementConfig, trustedRequest, validateToken };
