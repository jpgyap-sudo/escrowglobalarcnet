import { randomBytes, randomUUID } from 'node:crypto';
import {
  RETENTION_DAYS,
  DAY,
  EngagementError,
  exact,
  validateMessage,
  validateToken,
  chatCookie,
  hashToken,
  hmac,
  safeEqual,
  isKnownSource,
} from './security.mjs';

const DEFAULT_LIMITS = {
  sessionReads: 240,
  sessionCreates: 30,
  globalSessions: 10000,
  globalReads: 20000,
  sessionCreateBurst: 120,
  globalMessages: 100000,
  threadCreates: 20,
  globalThreads: 1000,
  visitorMessages: 12,
  sourceMessages: 30,
  maxMessages: 5000,
  adminReplies: 60,
  globalReplies: 10000,
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function iso(ms) {
  return new Date(ms).toISOString();
}

function capCodepoints(str, max) {
  if (typeof str !== 'string') return '';
  const arr = Array.from(str);
  if (arr.length <= max) return str;
  return arr.slice(0, max).join('');
}

function threadRow(row, unreadCount, messageCount, lastMessage, includeContact = false) {
  const result = {
    id: row.id,
    displayName: row.display_name || 'Visitor',
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastMessage: lastMessage == null ? '' : capCodepoints(lastMessage, 200),
    unreadCount: unreadCount || 0,
    messageCount: messageCount || 0,
  };
  if (includeContact) result.contactEmail = row.contact_email || '';
  return result;
}

function messageRow(row) {
  return {
    id: row.id,
    sender: row.sender,
    body: row.body,
    createdAt: iso(row.created_at),
    clientId: row.client_id,
  };
}

export class ChatService {
  constructor(database, { limits = {} } = {}) {
    if (!database) throw new Error('ChatService requires database');
    this.db = database;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  _now() {
    return this.db.now();
  }

  _csrf(token) {
    return hmac(this.db.secret, 'chat-csrf', token);
  }

  _signature(body, displayName, email) {
    return hmac(
      this.db.secret,
      'chat-msg',
      body,
      displayName == null ? '\u0000' : displayName,
      email == null ? '\u0000' : email,
    );
  }

  _loadSession(tokenHash, time) {
    const row = this.db
      .stmt('SELECT token_hash, created_at, expires_at FROM visitor_sessions WHERE token_hash = ?')
      .get(tokenHash);
    if (!row) return null;
    if (row.expires_at <= time) return null;
    return row;
  }

  _threadByToken(tokenHash) {
    return this.db
      .stmt('SELECT * FROM threads WHERE token_hash = ?')
      .get(tokenHash);
  }

  _threadById(id) {
    return this.db.stmt('SELECT * FROM threads WHERE id = ?').get(id);
  }

  _unreadCount(threadId, readThrough) {
    const row = this.db
      .stmt(
        'SELECT COUNT(*) AS c FROM messages WHERE thread_id = ? AND sender = ? AND id > ?'
      )
      .get(threadId, 'visitor', readThrough || 0);
    return row ? row.c : 0;
  }

  _messageCount(threadId) {
    const row = this.db
      .stmt('SELECT COUNT(*) AS c FROM messages WHERE thread_id = ?')
      .get(threadId);
    return row ? row.c : 0;
  }

  _lastMessage(threadId) {
    const row = this.db
      .stmt(
        'SELECT body FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(threadId);
    return row ? row.body : '';
  }

  _transcript(threadId) {
    const rows = this.db
      .stmt(
        'SELECT id, sender, body, created_at, client_id FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 200'
      )
      .all(threadId);
    rows.reverse();
    return rows.map(messageRow);
  }

  _threadPayload(row, includeContact = false) {
    const unread = this._unreadCount(row.id, row.read_through);
    const count = this._messageCount(row.id);
    const last = this._lastMessage(row.id);
    return threadRow(row, unread, count, last, includeContact);
  }

  session(token, source) {
    const time = this._now();
    const sourceKey = source == null ? 'unknown' : String(source);
    let tokenHash = null;
    let existing = null;

    if (typeof token === 'string' && validateToken(token)) {
      tokenHash = hashToken(token);
      existing = this._loadSession(tokenHash, time);
    }

    if (existing) {
      this.db.transaction(() => {
        this.db.rateLimit('chat-session-read', tokenHash, this.limits.sessionReads, MINUTE, time);
        this.db.rateLimit('chat-session-read-global', 'global', this.limits.globalReads, MINUTE, time);
      });
      const thread = this._threadByToken(tokenHash);
      const csrfToken = this._csrf(token);
      if (!thread) {
        return {
          payload: {
            conversation: null,
            messages: [],
            csrfToken,
            retentionDays: RETENTION_DAYS,
          },
          token,
          newSession: false,
        };
      }
      return {
        payload: {
          conversation: this._threadPayload(thread),
          messages: this._transcript(thread.id),
          csrfToken,
          retentionDays: RETENTION_DAYS,
        },
        token,
        newSession: false,
      };
    }

    const newToken = randomBytes(32).toString('base64url');
    const newHash = hashToken(newToken);
    const expiresAt = time + RETENTION_DAYS * DAY;

    this.db.transaction(() => {
      this.db.rateLimit('chat-session-read-global', 'global', this.limits.globalReads, MINUTE, time);
      if (isKnownSource(sourceKey)) {
        this.db.rateLimit('chat-session-create-source', sourceKey, this.limits.sessionCreates, HOUR, time);
      }
      this.db.rateLimit('chat-session-create-global', 'global', this.limits.globalSessions, DAY, time);
      this.db.rateLimit('chat-session-create-burst', 'global', this.limits.sessionCreateBurst, MINUTE, time);
      this.db
        .stmt(
          'INSERT INTO visitor_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)'
        )
        .run(newHash, time, expiresAt);
    });

    return {
      payload: {
        conversation: null,
        messages: [],
        csrfToken: this._csrf(newToken),
        retentionDays: RETENTION_DAYS,
      },
      token: newToken,
      newSession: true,
    };
  }

  send(token, csrf, data, source) {
    const time = this._now();
    if (typeof token !== 'string' || !validateToken(token)) {
      throw new EngagementError(401, 'CHAT_UNAUTHORIZED', 'Chat session required');
    }
    const tokenHash = hashToken(token);
    const sessionRow = this._loadSession(tokenHash, time);
    if (!sessionRow) {
      throw new EngagementError(401, 'CHAT_UNAUTHORIZED', 'Chat session expired');
    }
    const expectedCsrf = this._csrf(token);
    if (typeof csrf !== 'string' || !safeEqual(csrf, expectedCsrf)) {
      throw new EngagementError(403, 'CHAT_CSRF_INVALID', 'Invalid CSRF token');
    }

    const normalized = validateMessage(data, true);
    const sourceKey = source == null ? 'unknown' : String(source);
    const signature = this._signature(
      normalized.body,
      normalized.displayName == null ? null : normalized.displayName,
      normalized.email == null ? null : normalized.email,
    );

    return this.db.transaction(() => {
      let thread = this._threadByToken(tokenHash);
      if (thread) {
        const existing = this.db
          .stmt(
            'SELECT id, body, signature FROM messages WHERE thread_id = ? AND sender = ? AND client_id = ?'
          )
          .get(thread.id, 'visitor', normalized.clientId);
        if (existing) {
          if (existing.signature === signature) {
            return {
              conversation: this._threadPayload(thread),
              messages: this._transcript(thread.id),
            };
          }
          throw new EngagementError(409, 'IDEMPOTENCY_CONFLICT', 'Conflicting retry');
        }
      }

      this.db.rateLimit('chat-visitor-msg-cookie', tokenHash, this.limits.visitorMessages, MINUTE, time);
      this.db.rateLimit('chat-visitor-msg-global', 'global', this.limits.globalMessages, DAY, time);
      if (isKnownSource(sourceKey)) {
        this.db.rateLimit('chat-visitor-msg-source', sourceKey, this.limits.sourceMessages, MINUTE, time);
      }

      if (!thread) {
        if (isKnownSource(sourceKey)) {
          this.db.rateLimit('chat-thread-create-source', sourceKey, this.limits.threadCreates, DAY, time);
        }
        this.db.rateLimit('chat-thread-create-global', 'global', this.limits.globalThreads, DAY, time);
        const id = randomUUID();
        const displayName = normalized.displayName;
        const contactEmail = normalized.email;
        this.db
          .stmt(
            'INSERT INTO threads (id, token_hash, display_name, contact_email, status, created_at, updated_at, read_through) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
          )
          .run(id, tokenHash, displayName, contactEmail, 'open', time, time);
        thread = this._threadById(id);
      } else {
        const count = this._messageCount(thread.id);
        if (count >= this.limits.maxMessages) {
          throw new EngagementError(
            429,
            'CHAT_THREAD_FULL',
            'This conversation has reached its message limit. Please contact support later.'
          );
        }
      }

      const count = this._messageCount(thread.id);
      if (count >= this.limits.maxMessages) {
        throw new EngagementError(
          429,
          'CHAT_THREAD_FULL',
          'This conversation has reached its message limit. Please contact support later.'
        );
      }

      this.db
        .stmt(
          'INSERT INTO messages (thread_id, sender, body, created_at, client_id, signature) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(thread.id, 'visitor', normalized.body, time, normalized.clientId, signature);

      const updates = ['updated_at = ?'];
      const params = [time];
      if (normalized.displayName != null) {
        updates.push('display_name = ?');
        params.push(normalized.displayName);
      }
      if (normalized.email != null) {
        updates.push('contact_email = ?');
        params.push(normalized.email);
      }
      if (thread.status === 'closed') {
        updates.push("status = 'open'");
      }
      params.push(thread.id);
      this.db
        .stmt(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`)
        .run(...params);

      const fresh = this._threadById(thread.id);
      return {
        conversation: this._threadPayload(fresh),
        messages: this._transcript(fresh.id),
      };
    });
  }

  list({ status = 'all', q = '', offset = 0, limit = 40 } = {}) {
    if (status !== 'all' && status !== 'open' && status !== 'closed') {
      throw new EngagementError(400, 'INVALID_STATUS', 'Invalid status filter');
    }
    if (typeof q !== 'string') {
      throw new EngagementError(400, 'INVALID_QUERY', 'Invalid query');
    }
    const query = capCodepoints(q, 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      throw new EngagementError(400, 'INVALID_OFFSET', 'Invalid offset');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new EngagementError(400, 'INVALID_LIMIT', 'Invalid limit');
    }
    const cappedLimit = Math.min(limit, 100);

    const where = [];
    const params = [];
    if (status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (query.length > 0) {
      const needle = query.toLowerCase();
      where.push(
        "(instr(lower(t.display_name), ?) > 0 OR instr(lower(COALESCE(t.contact_email, '')), ?) > 0 OR instr(lower(COALESCE((SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1), '')), ?) > 0)"
      );
      params.push(needle, needle, needle);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = this.db
      .stmt(`SELECT COUNT(*) AS c FROM threads t ${whereSql}`)
      .get(...params);
    const total = totalRow ? totalRow.c : 0;

    const rows = this.db
      .stmt(
        `SELECT t.* FROM threads t ${whereSql} ORDER BY t.updated_at DESC, t.id ASC LIMIT ? OFFSET ?`
      )
      .all(...params, cappedLimit, offset);

    const threads = rows.map((row) => this._threadPayload(row, true));

    const unreadRow = this.db
      .stmt(
        'SELECT COUNT(*) AS c FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.sender = ? AND m.id > t.read_through'
      )
      .get('visitor');
    const unreadCount = unreadRow ? unreadRow.c : 0;

    const openRow = this.db
      .stmt("SELECT COUNT(*) AS c FROM threads WHERE status = 'open'")
      .get();
    const openCount = openRow ? openRow.c : 0;

    return {
      threads,
      total,
      unreadCount,
      openCount,
      offset,
      limit: cappedLimit,
    };
  }

  detail(id) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    const row = this._threadById(id);
    if (!row) {
      throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    return {
      conversation: this._threadPayload(row, true),
      messages: this._transcript(row.id),
    };
  }

  read(id, data) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    const { throughId } = exact(data, ['throughId']);
    if (!Number.isSafeInteger(throughId) || throughId < 0) {
      throw new EngagementError(400, 'INVALID_READ_MARKER', 'Invalid read marker');
    }
    return this.db.transaction(() => {
      const thread = this._threadById(id);
      if (!thread) {
        throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
      }
      if (throughId > 0) {
        const msg = this.db
          .stmt('SELECT id FROM messages WHERE id = ? AND thread_id = ?')
          .get(throughId, id);
        if (!msg) {
          throw new EngagementError(400, 'INVALID_READ_MARKER', 'Read marker not in thread');
        }
      }
      const next = Math.max(thread.read_through || 0, throughId);
      if (next !== (thread.read_through || 0)) {
        this.db
          .stmt('UPDATE threads SET read_through = ? WHERE id = ?')
          .run(next, id);
      }
      return { ok: true };
    });
  }

  reply(id, data, admin) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    if (typeof admin !== 'string' || admin.length === 0) {
      throw new EngagementError(401, 'ADMIN_REQUIRED', 'Admin session required');
    }
    const normalized = validateMessage(data, false);
    const time = this._now();
    const signature = this._signature(normalized.body, null, null);

    return this.db.transaction(() => {
      const thread = this._threadById(id);
      if (!thread) {
        throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
      }
      const existing = this.db
        .stmt(
          'SELECT id, signature FROM messages WHERE thread_id = ? AND sender = ? AND client_id = ?'
        )
        .get(id, 'admin', normalized.clientId);
      if (existing) {
        if (existing.signature === signature) {
          return {
            conversation: this._threadPayload(thread, true),
            messages: this._transcript(id),
          };
        }
        throw new EngagementError(409, 'IDEMPOTENCY_CONFLICT', 'Conflicting retry');
      }

      const count = this._messageCount(id);
      if (count >= this.limits.maxMessages) {
        throw new EngagementError(
          429,
          'CHAT_THREAD_FULL',
          'This conversation has reached its message limit.'
        );
      }

      this.db.rateLimit('chat-admin-reply', admin, this.limits.adminReplies, MINUTE, time);
      this.db.rateLimit('chat-admin-reply-global', 'global', this.limits.globalReplies, DAY, time);

      this.db
        .stmt(
          'INSERT INTO messages (thread_id, sender, body, created_at, client_id, signature) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(id, 'admin', normalized.body, time, normalized.clientId, signature);

      this.db
        .stmt('UPDATE threads SET updated_at = ? WHERE id = ?')
        .run(time, id);

      const fresh = this._threadById(id);
      return {
        conversation: this._threadPayload(fresh, true),
        messages: this._transcript(id),
      };
    });
  }

  status(id, data) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    const { status } = exact(data, ['status']);
    if (status !== 'open' && status !== 'closed') {
      throw new EngagementError(400, 'INVALID_STATUS', 'Invalid status');
    }
    const time = this._now();
    return this.db.transaction(() => {
      const thread = this._threadById(id);
      if (!thread) {
        throw new EngagementError(404, 'THREAD_NOT_FOUND', 'Thread not found');
      }
      if (thread.status !== status) {
        this.db
          .stmt('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?')
          .run(status, time, id);
      }
      const fresh = this._threadById(id);
      return { conversation: this._threadPayload(fresh, true) };
    });
  }
}

export { chatCookie };
