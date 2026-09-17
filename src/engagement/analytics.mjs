import {
  RETENTION_DAYS,
  DAY,
  EngagementError,
  exact,
  sanitizePath,
  sanitizeReferrer,
  countryName,
  shouldIgnoreAnalytics,
  hmac,
  isKnownSource,
} from './security.mjs';

const DEFAULT_LIMITS = {
  sessionEvents: 60,
  sourceEvents: 120,
  globalEvents: 100000,
  globalBurst: 3000,
};

const MINUTE = 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICES = new Set(['desktop', 'mobile', 'tablet']);

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayStartMs(day) {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function addDays(day, delta) {
  const ms = dayStartMs(day) + delta * DAY;
  return utcDay(ms);
}

export class AnalyticsService {
  constructor(database, { geoReady = false, limits = {} } = {}) {
    if (!database) throw new Error('AnalyticsService requires database');
    this.db = database;
    this.geoReady = !!geoReady;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  _now() {
    return this.db.now();
  }

  collect(data, request, { source, country } = {}) {
    if (shouldIgnoreAnalytics(request)) {
      return { status: 202, payload: { ok: true } };
    }

    const { sessionId, eventId, path, referrer, device } = exact(data, [
      'sessionId',
      'eventId',
      'path',
      'referrer',
      'device',
    ]);

    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
      throw new EngagementError(400, 'INVALID_SESSION_ID', 'Invalid sessionId');
    }
    if (typeof eventId !== 'string' || !UUID_RE.test(eventId)) {
      throw new EngagementError(400, 'INVALID_EVENT_ID', 'Invalid eventId');
    }
    if (typeof path !== 'string' || path.length > 4096) {
      throw new EngagementError(400, 'INVALID_PATH', 'Invalid path');
    }
    if (typeof referrer !== 'string' || referrer.length > 4096) {
      throw new EngagementError(400, 'INVALID_REFERRER', 'Invalid referrer');
    }
    if (typeof device !== 'string' || !DEVICES.has(device)) {
      throw new EngagementError(400, 'INVALID_DEVICE', 'Invalid device');
    }

    const time = this._now();
    const day = utcDay(time);
    const sessionHash = hmac(this.db.secret, 'analytics-session', day, sessionId.toLowerCase());
    const eventHash = hmac(this.db.secret, 'analytics-event', eventId.toLowerCase());

    const cleanPath = sanitizePath(path);
    const cleanReferrer = sanitizeReferrer(referrer);

    let resolvedCountry = 'ZZ';
    if (this.geoReady && typeof country === 'string' && country.length === 2) {
      const upper = country.toUpperCase();
      if (/^[A-Z]{2}$/.test(upper) && countryName(upper) !== 'Unknown') {
        resolvedCountry = upper;
      }
    }

    const sourceKey = source == null ? 'unknown' : String(source);

    return this.db.transaction(() => {
      const existing = this.db
        .stmt('SELECT event_hash FROM events WHERE event_hash = ?')
        .get(eventHash);
      if (existing) {
        return { status: 200, payload: { ok: true } };
      }

      this.db.rateLimit('analytics-session', sessionHash, this.limits.sessionEvents, MINUTE, time);
      if (isKnownSource(sourceKey)) {
        this.db.rateLimit('analytics-source', sourceKey, this.limits.sourceEvents, MINUTE, time);
      }
      this.db.rateLimit('analytics-global', 'global', this.limits.globalEvents, DAY, time);
      this.db.rateLimit('analytics-global-burst', 'global', this.limits.globalBurst, MINUTE, time);

      this.db
        .stmt(
          'INSERT INTO events (event_hash, day, session_hash, created_at, path, referrer, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(eventHash, day, sessionHash, time, cleanPath, cleanReferrer, device, resolvedCountry);

      this.db
        .stmt(
          "INSERT OR IGNORE INTO metadata (key, value) VALUES ('collection_started_at', ?)"
        )
        .run(iso(time));

      return { status: 200, payload: { ok: true } };
    });
  }

  traffic(days = 7) {
    if (days !== 7 && days !== 30 && days !== 90) {
      throw new EngagementError(400, 'INVALID_RANGE', 'days must be 7, 30, or 90');
    }
    const time = this._now();
    const today = utcDay(time);
    const startDay = addDays(today, -(days - 1));
    const startMs = dayStartMs(startDay);
    const endMs = time + 1;

    return this.db.transaction(() => {
      const totalRow = this.db
        .stmt('SELECT COUNT(*) AS c FROM events WHERE created_at >= ? AND created_at < ?')
        .get(startMs, endMs);
      const totalViews = totalRow ? totalRow.c : 0;

      const trendRows = this.db
        .stmt(
          'SELECT day, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors FROM events WHERE created_at >= ? AND created_at < ? GROUP BY day'
        )
        .all(startMs, endMs);
      const trendMap = new Map();
      for (const r of trendRows) {
        trendMap.set(r.day, { views: r.views, visitors: r.visitors });
      }
      const trend = [];
      let dailyVisitors = 0;
      for (let i = 0; i < days; i++) {
        const d = addDays(startDay, i);
        const entry = trendMap.get(d) || { views: 0, visitors: 0 };
        dailyVisitors += entry.visitors;
        trend.push({ date: d, views: entry.views, visitors: entry.visitors });
      }

      const activeRow = this.db
        .stmt(
          'SELECT COUNT(DISTINCT session_hash) AS c FROM events WHERE created_at >= ? AND created_at < ?'
        )
        .get(time - 5 * MINUTE, endMs);
      const activeNow = activeRow ? activeRow.c : 0;

      const countryRows = this.db
        .stmt(
          'SELECT country AS code, COUNT(*) AS views, COUNT(DISTINCT session_hash) AS visitors FROM events WHERE created_at >= ? AND created_at < ? GROUP BY country ORDER BY views DESC'
        )
        .all(startMs, endMs);
      const countries = countryRows.map((r) => ({
        code: r.code,
        name: countryName(r.code),
        views: r.views,
        visitors: r.visitors,
      }));

      const pageRows = this.db
        .stmt(
          'SELECT path, COUNT(*) AS views FROM events WHERE created_at >= ? AND created_at < ? GROUP BY path ORDER BY views DESC'
        )
        .all(startMs, endMs);
      const pages = pageRows.map((r) => ({ path: r.path, views: r.views }));

      const referrerRows = this.db
        .stmt(
          'SELECT referrer AS host, COUNT(*) AS views FROM events WHERE created_at >= ? AND created_at < ? GROUP BY referrer ORDER BY views DESC LIMIT 50'
        )
        .all(startMs, endMs);
      const referrers = referrerRows.map((r) => ({ host: r.host, views: r.views }));

      const deviceRows = this.db
        .stmt(
          'SELECT device AS name, COUNT(*) AS views FROM events WHERE created_at >= ? AND created_at < ? GROUP BY device ORDER BY views DESC'
        )
        .all(startMs, endMs);
      const devices = deviceRows.map((r) => ({ name: r.name, views: r.views }));

      const metaRow = this.db
        .stmt("SELECT value FROM metadata WHERE key = 'collection_started_at'")
        .get();
      const collectionStartedAt = metaRow ? metaRow.value : null;

      const unknownRow = this.db
        .stmt(
          "SELECT COUNT(*) AS c FROM events WHERE created_at >= ? AND created_at < ? AND country = 'ZZ'"
        )
        .get(startMs, endMs);
      const unknownViews = unknownRow ? unknownRow.c : 0;

      const geo = this.geoReady
        ? {
            status: 'ready',
            source: 'DB-IP Lite',
            unknownViews,
            notice:
              'Country lookup uses the offline DB-IP Lite database (https://db-ip.com). No accuracy claim is made.',
          }
        : {
            status: 'unavailable',
            source: 'DB-IP Lite',
            unknownViews,
            notice:
              'Country lookup is not configured. Attribution: https://db-ip.com. No accuracy claim is made.',
          };

      return {
        rangeDays: days,
        generatedAt: iso(time),
        totalViews,
        dailyVisitors,
        activeNow,
        countries,
        trend,
        pages,
        referrers,
        devices,
        collectionStartedAt,
        geo,
        retentionDays: RETENTION_DAYS,
      };
    });
  }
}
