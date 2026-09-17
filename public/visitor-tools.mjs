const ROOT_ID = 'eg-visitor-tools';
const DEFAULT_ANALYTICS_ENDPOINT = '/api/analytics/event';
const ANALYTICS_PATH = '/api/analytics/event';
const CHAT_SESSION_URL = '/api/chat/session';
const CHAT_MESSAGES_URL = '/api/chat/messages';
const ANALYTICS_TIMEOUT_MS = 5000;
const CHAT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 8000;
const MAX_MESSAGES = 200;
const MAX_BODY = 2000;
const MAX_NAME = 60;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETENTION_DAYS = 90;
const PAGE_GROUPS = new Set([
  '/', '/market', '/templates', '/orders', '/deal', '/product',
  '/wallet', '/learn', '/blog', '/support', '/profile', '/settings',
  '/agreements', '/other'
]);
const STORAGE_OPTOUT = 'egv_optout';
const STORAGE_SESSION = 'egv_session_id';
const STORAGE_DRAFT = 'egv_chat_draft';
const STORAGE_PENDING = 'egv_chat_pending';
const STORAGE_NAME = 'egv_chat_name';
const STORAGE_EMAIL = 'egv_chat_email';

function safeStorage(kind) {
  try {
    const s = window.sessionStorage;
    const k = '__egv_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch (_) {
    return null;
  }
}

function uuid() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = [];
      for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
        h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
    }
  } catch (_) {}
  return null;
}

function privacySignaled() {
  try {
    if (navigator.globalPrivacyControl === true) return true;
    const vals = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null) continue;
      const s = String(v).toLowerCase();
      if (s === '1' || s === 'yes') return true;
    }
  } catch (_) {}
  return false;
}

function isAdminContext() {
  try {
    if (location.protocol === 'file:') return true;
    const host = location.hostname.toLowerCase();
    if (host.startsWith('admin.')) return true;
    const p = location.pathname.toLowerCase();
    if (p === '/admin' || p.startsWith('/admin/')) return true;
  } catch (_) {}
  return false;
}

function resolveAnalyticsEndpoint() {
  let raw = null;
  try {
    const el = document.querySelector('script[data-escrow-engagement]');
    if (el && el.dataset && el.dataset.analyticsEndpoint) {
      raw = el.dataset.analyticsEndpoint;
    }
  } catch (_) {}
  if (!raw) return DEFAULT_ANALYTICS_ENDPOINT;
  try {
    const u = new URL(raw, location.href);
    if (u.username || u.password) return DEFAULT_ANALYTICS_ENDPOINT;
    if (u.pathname !== ANALYTICS_PATH) return DEFAULT_ANALYTICS_ENDPOINT;
    if (u.search || u.hash) return DEFAULT_ANALYTICS_ENDPOINT;
    const cur = location.hostname.toLowerCase();
    const apex = cur.replace(/^www\./, '');
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'https:') {
      if (u.port !== '9443') return DEFAULT_ANALYTICS_ENDPOINT;
      const hApex = host.replace(/^www\./, '');
      if (hApex !== apex) return DEFAULT_ANALYTICS_ENDPOINT;
      return u.origin + ANALYTICS_PATH;
    }
    if (u.protocol === 'http:') {
      if (u.origin !== location.origin) return DEFAULT_ANALYTICS_ENDPOINT;
      return DEFAULT_ANALYTICS_ENDPOINT;
    }
    return DEFAULT_ANALYTICS_ENDPOINT;
  } catch (_) {
    return DEFAULT_ANALYTICS_ENDPOINT;
  }
}

function pageGroup() {
  try {
    let p = location.pathname || '/';
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/+$/, '');
    if (p === '') p = '/';
    const isRoot = p === '/' || p === '/index.html';
    if (isRoot) {
      const h = location.hash || '';
      if (h.indexOf('#/') === 0) {
        let hp = h.slice(1);
        const q = hp.indexOf('?');
        if (q !== -1) hp = hp.slice(0, q);
        const hs = hp.indexOf('#');
        if (hs !== -1) hp = hp.slice(0, hs);
        hp = hp.replace(/\/+$/, '');
        const segs = hp.split('/').filter(Boolean);
        if (segs.length > 0) {
          const first = '/' + segs[0].toLowerCase();
          if (PAGE_GROUPS.has(first)) return first;
        }
        return '/other';
      }
      return '/market';
    }
    const seg = p.split('/').filter(Boolean);
    if (seg.length === 0) return '/market';
    const first = '/' + seg[0].toLowerCase();
    if (PAGE_GROUPS.has(first)) return first;
    return '/other';
  } catch (_) {
    return '/other';
  }
}

function referrerHost() {
  try {
    const r = document.referrer;
    if (!r) return '';
    const u = new URL(r);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    const host = u.hostname.toLowerCase();
    if (!host) return '';
    if (host === 'localhost' || host.endsWith('.localhost')) return '';
    if (host.indexOf(':') !== -1) return '';
    if (host.charAt(0) === '[' || host.charAt(host.length - 1) === ']') return '';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return '';
    return u.origin;
  } catch (_) {
    return '';
  }
}

function deviceCategory() {
  try {
    if (window.matchMedia) {
      if (window.matchMedia('(max-width: 640px)').matches) return 'mobile';
      if (window.matchMedia('(max-width: 1024px)').matches) return 'tablet';
    }
  } catch (_) {}
  return 'desktop';
}

function escapeText(s) {
  return String(s == null ? '' : s);
}

function createEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = escapeText(text);
  return el;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function safeASCII(s, min, max) {
  if (typeof s !== 'string') return false;
  if (s.length < min || s.length > max) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

function Analytics() {
  let storage = null;
  const endpoint = resolveAnalyticsEndpoint();
  const fallbackEndpoint = DEFAULT_ANALYTICS_ENDPOINT;
  let sessionId = null;
  let capable = false;
  let enabled = false;
  let lastGroup = null;
  let inflight = new Set();
  let optedOut = false;
  let privacyBlocked = false;
  let generation = 0;

  function readOptout() {
    if (!storage) return false;
    try { return storage.getItem(STORAGE_OPTOUT) === '1'; } catch (_) { return false; }
  }
  function writeOptout(v) {
    if (!storage) return;
    try {
      if (v) storage.setItem(STORAGE_OPTOUT, '1');
      else storage.removeItem(STORAGE_OPTOUT);
    } catch (_) {}
  }

  function evaluateEnabled() {
    if (!capable) { enabled = false; return; }
    if (privacyBlocked) { enabled = false; return; }
    if (optedOut) { enabled = false; return; }
    enabled = true;
  }

  function init() {
    if (isAdminContext()) { capable = false; enabled = false; return; }
    if (privacySignaled()) {
      privacyBlocked = true;
      capable = false;
      enabled = false;
      return;
    }
    storage = safeStorage('session');
    if (!storage) { capable = false; enabled = false; return; }
    optedOut = readOptout();
    let sid = null;
    try { sid = storage.getItem(STORAGE_SESSION); } catch (_) {}
    if (sid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
      sid = null;
    }
    if (!sid) {
      sid = uuid();
      if (!sid) { capable = false; enabled = false; return; }
      try { storage.setItem(STORAGE_SESSION, sid); } catch (_) { capable = false; enabled = false; return; }
    }
    sessionId = sid;
    capable = true;
    evaluateEnabled();
    if (enabled) {
      scheduleEvent(pageGroup());
    }
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      if (!enabled) return;
      const g = pageGroup();
      if (g !== lastGroup) {
        scheduleEvent(g);
      }
    }
  }

  function onHash() {
    if (!enabled) return;
    if (document.visibilityState !== 'visible') return;
    const g = pageGroup();
    if (g === lastGroup) return;
    scheduleEvent(g);
  }

  function scheduleEvent(group) {
    if (!enabled) return;
    if (privacySignaled()) { privacyBlocked = true; evaluateEnabled(); return; }
    if (document.visibilityState !== 'visible') return;
    const eventId = uuid();
    if (!eventId) return;
    lastGroup = group;
    sendEvent(eventId, group, false);
  }

  function buildBody(eventId, path) {
    return {
      sessionId: sessionId,
      eventId: eventId,
      path: path,
      referrer: referrerHost(),
      device: deviceCategory()
    };
  }

  function fetchWithTimeout(url, payload, timeoutMs) {
    const ctrl = new AbortController();
    inflight.add(ctrl);
    const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
    return fetch(url, {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: ctrl.signal
    }).then((r) => {
      clearTimeout(t);
      inflight.delete(ctrl);
      return r;
    }, (e) => {
      clearTimeout(t);
      inflight.delete(ctrl);
      throw e;
    });
  }

  function sendEvent(eventId, path, isFallback, payload) {
    if (!enabled) return;
    if (privacySignaled()) { privacyBlocked = true; evaluateEnabled(); return; }
    if (payload === undefined) {
      payload = JSON.stringify(buildBody(eventId, path));
    }
    const gen = generation;
    const url = isFallback ? fallbackEndpoint : endpoint;
    fetchWithTimeout(url, payload, ANALYTICS_TIMEOUT_MS)
      .then(() => {})
      .catch(() => {
        if (gen !== generation) return;
        if (!enabled) return;
        if (privacySignaled()) { privacyBlocked = true; evaluateEnabled(); return; }
        if (!isFallback) {
          sendEvent(eventId, path, true, payload);
        }
      });
  }

  function abortAll() {
    generation++;
    for (const c of inflight) {
      try { c.abort(); } catch (_) {}
    }
    inflight.clear();
  }

  function setOptout(v) {
    optedOut = !!v;
    writeOptout(optedOut);
    if (optedOut) {
      abortAll();
    }
    evaluateEnabled();
    if (enabled) {
      scheduleEvent(pageGroup());
    }
  }

  return {
    init: init,
    isEnabled: () => enabled,
    isCapable: () => capable,
    isOptedOut: () => optedOut,
    isPrivacySignaled: () => privacyBlocked || privacySignaled(),
    setOptout: setOptout,
    getOptout: () => optedOut
  };
}

function Chat(root, analytics) {
  const storage = safeStorage('session');
  let csrfToken = null;
  let conversation = null;
  let messages = [];
  let pollTimer = null;
  let pollInFlight = false;
  let sessionLoaded = false;
  let sessionError = null;
  let sendError = null;
  let pending = null;
  let pendingNeedsContact = false;
  let draft = '';
  let displayName = '';
  let email = '';
  let storageAvailable = !!storage;
  let requestGen = 0;
  let lastUpdatedAt = null;
  let pollError = null;
  let sendInFlight = false;
  let sessionAbort = null;
  let pollAbort = null;
  let renderedIds = null;
  let liveStatus = null;

  const els = {};

  function loadStored() {
    if (!storage) return;
    try {
      const d = storage.getItem(STORAGE_DRAFT);
      if (d != null) draft = d;
      const n = storage.getItem(STORAGE_NAME);
      if (n != null) displayName = n;
      const em = storage.getItem(STORAGE_EMAIL);
      if (em != null) email = em.trim().toLowerCase();
      const p = storage.getItem(STORAGE_PENDING);
      if (p) {
        const parsed = JSON.parse(p);
        const pendingCore = parsed && typeof parsed.body === 'string' && typeof parsed.clientId === 'string' &&
          safeASCII(parsed.clientId, 8, 100) && parsed.body.length > 0 && parsed.body.length <= MAX_BODY;
        if (pendingCore) {
          draft = parsed.body;
        }
        if (pendingCore && typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0 && parsed.displayName.trim().length <= MAX_NAME &&
            typeof parsed.email === 'string' && parsed.email.trim().length <= MAX_EMAIL && EMAIL_RE.test(parsed.email.trim())) {
          pending = parsed;
          displayName = parsed.displayName.trim();
          email = parsed.email.trim().toLowerCase();
        } else if (pendingCore) {
          pendingNeedsContact = true;
          try { storage.removeItem(STORAGE_PENDING); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function saveDraft() {
    if (!storage) return;
    try { storage.setItem(STORAGE_DRAFT, draft); } catch (_) {}
  }
  function saveName() {
    if (!storage) return;
    try { storage.setItem(STORAGE_NAME, displayName); } catch (_) {}
  }
  function saveEmail() {
    if (!storage) return;
    try { storage.setItem(STORAGE_EMAIL, email); } catch (_) {}
  }
  function savePending() {
    if (!storage) return;
    try {
      if (pending) storage.setItem(STORAGE_PENDING, JSON.stringify(pending));
      else storage.removeItem(STORAGE_PENDING);
    } catch (_) {}
  }

  function build() {
    const launcher = createEl('button', 'egv-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-label', 'Open chat');
    const icon = createEl('span', 'egv-launcher-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\uD83D\uDCAC';
    launcher.appendChild(icon);
    launcher.appendChild(createEl('span', 'egv-launcher-label', 'Chat'));

    const privacyStandalone = createEl('details', 'egv-privacy-standalone');
    const psSummary = createEl('summary', 'egv-privacy-summary', 'Privacy');
    privacyStandalone.appendChild(psSummary);
    const psBody = createEl('div', 'egv-privacy-body');
    const psInfo = createEl('p', null,
      'First-party aggregate page analytics. No analytics cookies. Analytics retained 90 days. ' +
      'Chat messages and the contact email you provide are retained 90 days and visible only to authorized operators. ' +
      'No automated email delivery or immediate response is guaranteed. ' +
      'Country data, when available, is provided by ');
    const psAttr = createEl('a', 'egv-attribution', 'DB-IP Lite');
    psAttr.href = 'https://db-ip.com';
    psAttr.target = '_blank';
    psAttr.rel = 'noopener noreferrer';
    psInfo.appendChild(psAttr);
    psBody.appendChild(psInfo);
    const psToggleWrap = createEl('label', 'egv-toggle');
    const psToggle = createEl('input', 'egv-toggle-input');
    psToggle.type = 'checkbox';
    psToggle.setAttribute('aria-label', 'Allow page analytics');
    psToggleWrap.appendChild(psToggle);
    psToggleWrap.appendChild(createEl('span', 'egv-toggle-label', 'Allow page analytics'));
    psBody.appendChild(psToggleWrap);
    const psNote = createEl('p', 'egv-privacy-note');
    psBody.appendChild(psNote);
    privacyStandalone.appendChild(psBody);

    const dialog = createEl('dialog', 'egv-dialog');
    dialog.setAttribute('aria-labelledby', 'egv-dialog-title');
    dialog.setAttribute('aria-modal', 'true');

    const header = createEl('div', 'egv-dialog-header');
    const title = createEl('h2', 'egv-dialog-title', 'Chat with Escrow Global');
    title.id = 'egv-dialog-title';
    header.appendChild(title);
    const closeBtn = createEl('button', 'egv-close', '\u00D7');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close chat');
    header.appendChild(closeBtn);

    const safety = createEl('div', 'egv-safety');
    safety.appendChild(createEl('p', null,
      'Never send passwords, private keys, seed phrases, or payment information. ' +
      'Messages and your contact email are retained 90 days. No automated email delivery or guaranteed immediate reply.'));

    const body = createEl('div', 'egv-dialog-body');
    const transcript = createEl('div', 'egv-transcript');
    transcript.setAttribute('role', 'log');
    transcript.setAttribute('aria-live', 'off');
    transcript.setAttribute('aria-relevant', 'additions');
    transcript.setAttribute('aria-label', 'Chat messages');
    body.appendChild(transcript);

    const live = createEl('div', 'egv-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    body.appendChild(live);

    const sessionStatus = createEl('div', 'egv-session-status');
    sessionStatus.setAttribute('role', 'status');
    sessionStatus.setAttribute('aria-live', 'polite');
    body.appendChild(sessionStatus);

    const pollStatus = createEl('div', 'egv-poll-status');
    pollStatus.setAttribute('role', 'status');
    pollStatus.setAttribute('aria-live', 'polite');
    body.appendChild(pollStatus);

    const sendStatus = createEl('div', 'egv-send-status');
    sendStatus.id = 'egv-send-status';
    sendStatus.setAttribute('role', 'status');
    sendStatus.setAttribute('aria-live', 'polite');
    body.appendChild(sendStatus);

    const form = createEl('form', 'egv-form');
    form.setAttribute('novalidate', 'novalidate');
    const nameLabel = createEl('label', 'egv-label', 'Name');
    nameLabel.setAttribute('for', 'egv-name-input');
    const nameInput = createEl('input', 'egv-name');
    nameInput.id = 'egv-name-input';
    nameInput.type = 'text';
    nameInput.maxLength = MAX_NAME;
    nameInput.placeholder = 'Your name';
    nameInput.required = true;
    nameInput.setAttribute('aria-required', 'true');
    nameInput.setAttribute('aria-describedby', 'egv-send-status');
    const emailLabel = createEl('label', 'egv-label', 'Email');
    emailLabel.setAttribute('for', 'egv-email-input');
    const emailInput = createEl('input', 'egv-email');
    emailInput.id = 'egv-email-input';
    emailInput.type = 'email';
    emailInput.maxLength = MAX_EMAIL;
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'you@example.com';
    emailInput.required = true;
    emailInput.setAttribute('aria-required', 'true');
    emailInput.setAttribute('aria-describedby', 'egv-send-status');
    const msgLabel = createEl('label', 'egv-label', 'Message');
    msgLabel.setAttribute('for', 'egv-msg-input');
    const msgInput = createEl('textarea', 'egv-input');
    msgInput.id = 'egv-msg-input';
    msgInput.rows = 2;
    msgInput.maxLength = MAX_BODY;
    msgInput.placeholder = 'Type your message\u2026';
    const sendBtn = createEl('button', 'egv-send', 'Send');
    sendBtn.type = 'submit';
    const retryBtn = createEl('button', 'egv-retry', 'Retry message');
    retryBtn.type = 'button';
    retryBtn.hidden = true;
    form.appendChild(nameLabel);
    form.appendChild(nameInput);
    form.appendChild(emailLabel);
    form.appendChild(emailInput);
    form.appendChild(msgLabel);
    form.appendChild(msgInput);
    form.appendChild(sendBtn);
    form.appendChild(retryBtn);

    dialog.appendChild(header);
    dialog.appendChild(safety);
    dialog.appendChild(body);
    dialog.appendChild(form);

    root.appendChild(launcher);
    root.appendChild(privacyStandalone);
    root.appendChild(dialog);

    els.launcher = launcher;
    els.dialog = dialog;
    els.closeBtn = closeBtn;
    els.transcript = transcript;
    els.live = live;
    els.sessionStatus = sessionStatus;
    els.pollStatus = pollStatus;
    els.sendStatus = sendStatus;
    els.form = form;
    els.nameInput = nameInput;
    els.emailInput = emailInput;
    els.msgInput = msgInput;
    els.sendBtn = sendBtn;
    els.retryBtn = retryBtn;
    els.toggle = psToggle;
    els.privacyNote = psNote;

    launcher.addEventListener('click', openDialog);
    closeBtn.addEventListener('click', closeDialog);
    dialog.addEventListener('close', onDialogClose);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
    form.addEventListener('submit', onSubmit);
    retryBtn.addEventListener('click', onRetry);
    msgInput.addEventListener('input', () => {
      if (pending) return;
      draft = msgInput.value;
      saveDraft();
    });
    nameInput.addEventListener('input', () => {
      if (pending) return;
      displayName = nameInput.value.trim();
      nameInput.setAttribute('aria-invalid', 'false');
      saveName();
    });
    emailInput.addEventListener('input', () => {
      if (pending) return;
      email = emailInput.value.trim().toLowerCase();
      emailInput.setAttribute('aria-invalid', 'false');
      saveEmail();
    });
    psToggle.addEventListener('change', () => {
      if (analytics) analytics.setOptout(!psToggle.checked);
      updatePrivacyNote();
    });
  }

  function updatePrivacyNote() {
    if (!els.privacyNote) return;
    if (analytics && analytics.isPrivacySignaled()) {
      els.privacyNote.textContent = 'Analytics disabled by your browser privacy signal.';
      els.toggle.disabled = true;
      els.toggle.checked = false;
    } else if (!analytics || !analytics.isCapable()) {
      els.privacyNote.textContent = 'Analytics unavailable in this browser session.';
      els.toggle.disabled = true;
      els.toggle.checked = false;
    } else {
      els.toggle.disabled = false;
      els.toggle.checked = !analytics.isOptedOut();
      if (analytics.isOptedOut()) {
        els.privacyNote.textContent = 'Page analytics is off for this tab.';
      } else {
        els.privacyNote.textContent = 'Page analytics is on for this tab. You can turn it off here.';
      }
    }
  }

  function openDialog() {
    if (typeof els.dialog.showModal === 'function') {
      els.dialog.showModal();
    } else {
      els.dialog.setAttribute('open', '');
    }
    updatePrivacyNote();
    if (!sessionLoaded) loadSession();
    startPoll();
  }

  function closeDialog() {
    if (typeof els.dialog.close === 'function') {
      els.dialog.close();
    } else {
      els.dialog.removeAttribute('open');
      onDialogClose();
    }
  }

  function onDialogClose() {
    stopPoll();
    requestGen++;
    if (sessionAbort) { try { sessionAbort.abort(); } catch (_) {} sessionAbort = null; }
    if (pollAbort) { try { pollAbort.abort(); } catch (_) {} pollAbort = null; }
    pollInFlight = false;
    try { els.launcher.focus(); } catch (_) {}
  }

  function requestJSON(url, method, body, timeoutMs, extraHeaders) {
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
    const opts = {
      method: method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal
    };
    if (method === 'POST') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then((r) => {
      return r.json().then((data) => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: data };
      }, () => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: null };
      });
    }, (e) => {
      clearTimeout(t);
      throw e;
    });
  }

  function loadSession() {
    if (sendInFlight) return;
    if (sessionAbort) return;
    sessionError = null;
    renderSessionStatus('Loading\u2026');
    const gen = ++requestGen;
    const ctrl = new AbortController();
    sessionAbort = ctrl;
    const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, CHAT_TIMEOUT_MS);
    fetch(CHAT_SESSION_URL, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal
    }).then((r) => {
      return r.json().then((data) => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: data };
      }, () => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: null };
      });
    }, (e) => {
      clearTimeout(t);
      throw e;
    }).then((res) => {
      if (gen !== requestGen) return;
      sessionAbort = null;
      if (!res.ok) throw new Error('session');
      const data = res.data;
      if (!data || !Array.isArray(data.messages) || typeof data.csrfToken !== 'string' || !data.csrfToken) {
        throw new Error('malformed');
      }
      sessionLoaded = true;
      csrfToken = data.csrfToken;
      conversation = data.conversation || null;
      messages = validateMessages(data.messages).slice(-MAX_MESSAGES);
      lastUpdatedAt = conversation && conversation.updatedAt ? conversation.updatedAt : null;
      renderTranscript();
      renderSessionStatus('');
      reconcilePending();
      if (!pending) unlockInputs();
    }).catch(() => {
      if (gen !== requestGen) return;
      sessionAbort = null;
      sessionError = 'unavailable';
      renderSessionStatus('Chat is unavailable right now.');
      renderRetrySession();
    });
  }

  function renderRetrySession() {
    if (!els.sessionStatus) return;
    els.sessionStatus.textContent = '';
    const p = createEl('p', null, 'Chat is unavailable right now.');
    const b = createEl('button', 'egv-retry', 'Retry');
    b.type = 'button';
    b.addEventListener('click', () => { loadSession(); });
    els.sessionStatus.appendChild(p);
    els.sessionStatus.appendChild(b);
  }

  function renderSessionStatus(text) {
    if (!els.sessionStatus) return;
    els.sessionStatus.textContent = '';
    if (text) els.sessionStatus.appendChild(createEl('p', null, text));
  }

  function renderPollStatus(text) {
    if (!els.pollStatus) return;
    els.pollStatus.textContent = '';
    if (text) els.pollStatus.appendChild(createEl('p', null, text));
  }

  function renderSendStatus(text) {
    if (!els.sendStatus) return;
    els.sendStatus.textContent = '';
    if (text) els.sendStatus.appendChild(createEl('p', null, text));
  }

  function renderTranscript() {
    if (!els.transcript) return;
    els.transcript.classList.toggle('egv-transcript-empty', messages.length === 0);
    const atBottom = isAtBottom();
    const prevScroll = els.transcript.scrollTop;
    const newIds = new Set();
    for (const m of messages) if (m && m.id != null) newIds.add(m.id);
    let changed = renderedIds === null || newIds.size !== renderedIds.size;
    if (!changed) {
      for (const id of newIds) {
        if (!renderedIds.has(id)) { changed = true; break; }
      }
    }
    if (!changed) return;
    const prevCount = renderedIds ? renderedIds.size : 0;
    els.transcript.textContent = '';
    if (!messages.length) {
      els.transcript.appendChild(createEl('p', 'egv-empty', 'Send a message to start. We will respond here.'));
    } else {
      for (const m of messages) {
        els.transcript.appendChild(renderMessage(m));
      }
    }
    renderedIds = newIds;
    if (atBottom) scrollToBottom();
    else els.transcript.scrollTop = prevScroll;
    if (newIds.size > prevCount && els.live) {
      els.live.textContent = newIds.size + ' message' + (newIds.size === 1 ? '' : 's');
    }
  }

  function renderMessage(m) {
    const wrap = createEl('div', 'egv-msg egv-msg-' + (m.sender === 'admin' ? 'admin' : 'visitor'));
    const meta = createEl('div', 'egv-msg-meta');
    meta.appendChild(createEl('span', 'egv-msg-sender', m.sender === 'admin' ? 'Escrow Global team' : 'You'));
    meta.appendChild(createEl('span', 'egv-msg-time', formatTime(m.createdAt)));
    wrap.appendChild(meta);
    wrap.appendChild(createEl('div', 'egv-msg-body', m.body));
    return wrap;
  }

  function isAtBottom() {
    if (!els.transcript) return true;
    return els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight < 40;
  }
  function scrollToBottom() {
    if (!els.transcript) return;
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function startPoll() {
    if (pollTimer) return;
    if (document.visibilityState !== 'visible') return;
    if (!els.dialog.open) return;
    pollTimer = setInterval(() => { poll(); }, POLL_INTERVAL_MS);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function poll() {
    if (pollInFlight) return;
    if (sendInFlight) return;
    if (!els.dialog.open) return;
    if (document.visibilityState !== 'visible') return;
    if (!sessionLoaded) return;
    pollInFlight = true;
    const gen = requestGen;
    if (pollAbort) { try { pollAbort.abort(); } catch (_) {} }
    const ctrl = new AbortController();
    pollAbort = ctrl;
    const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, CHAT_TIMEOUT_MS);
    fetch(CHAT_SESSION_URL, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal
    }).then((r) => {
      return r.json().then((data) => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: data };
      }, () => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: null };
      });
    }, (e) => {
      clearTimeout(t);
      throw e;
    }).then((res) => {
      pollInFlight = false;
      pollAbort = null;
      if (gen !== requestGen) return;
      if (!els.dialog.open) return;
      if (!res.ok) throw new Error('poll');
      const data = res.data;
      if (!data || !Array.isArray(data.messages)) throw new Error('poll');
      if (typeof data.csrfToken === 'string' && data.csrfToken) csrfToken = data.csrfToken;
      const newConv = data.conversation || null;
      const newMsgs = validateMessages(data.messages).slice(-MAX_MESSAGES);
      const newUpdated = newConv && newConv.updatedAt ? newConv.updatedAt : null;
      if (lastUpdatedAt && newUpdated && newUpdated < lastUpdatedAt) return;
      conversation = newConv;
      messages = mergeMessages(messages, newMsgs);
      lastUpdatedAt = newUpdated || lastUpdatedAt;
      pollError = null;
      renderPollStatus('');
      renderTranscript();
      reconcilePending();
    }).catch(() => {
      pollInFlight = false;
      pollAbort = null;
      if (gen !== requestGen) return;
      if (!els.dialog.open) return;
      pollError = 'poll';
      renderPollStatus('Could not refresh messages.');
      renderPollRetry();
    });
  }

  function renderPollRetry() {
    if (!els.pollStatus) return;
    const b = createEl('button', 'egv-retry', 'Retry');
    b.type = 'button';
    b.addEventListener('click', () => { poll(); });
    els.pollStatus.appendChild(b);
  }

  function validateMessages(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const m of arr) {
      if (!m || typeof m !== 'object') continue;
      if (typeof m.id !== 'number' || !isFinite(m.id) || m.id <= 0) continue;
      if (m.sender !== 'visitor' && m.sender !== 'admin') continue;
      if (typeof m.body !== 'string') continue;
      if (typeof m.createdAt !== 'string') continue;
      if (typeof m.clientId !== 'string') continue;
      out.push(m);
    }
    return out;
  }

  function mergeMessages(oldMsgs, newMsgs) {
    const map = new Map();
    for (const m of oldMsgs) if (m && m.id != null) map.set(m.id, m);
    for (const m of newMsgs) if (m && m.id != null) map.set(m.id, m);
    const arr = Array.from(map.values());
    arr.sort((a, b) => (a.id || 0) - (b.id || 0));
    return arr.slice(-MAX_MESSAGES);
  }

  function reconcilePending() {
    if (!pending) return;
    const found = messages.some((m) => m && m.sender === 'visitor' &&
      m.clientId === pending.clientId && m.body === pending.body);
    if (found) {
      pending = null;
      sendError = null;
      savePending();
      draft = '';
      saveDraft();
      if (els.msgInput) els.msgInput.value = '';
      unlockInputs();
      renderSendStatus('');
    }
  }

  function lockInputs() {
    els.msgInput.disabled = true;
    els.nameInput.disabled = true;
    els.emailInput.disabled = true;
    els.sendBtn.disabled = true;
    els.retryBtn.hidden = false;
  }
  function unlockInputs() {
    els.msgInput.disabled = false;
    els.nameInput.disabled = false;
    els.emailInput.disabled = false;
    els.sendBtn.disabled = false;
    els.retryBtn.hidden = true;
  }

  function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    if (sendInFlight) return;
    if (!sessionLoaded || !csrfToken) {
      renderSendStatus('Chat is unavailable right now.');
      return;
    }
    const body = (els.msgInput.value || '').trim();
    if (!body) return;
    if (body.length > MAX_BODY) return;
    const name = (els.nameInput.value || '').trim();
    if (!name || name.length > MAX_NAME) {
      els.nameInput.setAttribute('aria-invalid', 'true');
      renderSendStatus('Enter your name to send a message.');
      els.nameInput.focus();
      return;
    }
    const contactEmail = (els.emailInput.value || '').trim().toLowerCase();
    if (!contactEmail || contactEmail.length > MAX_EMAIL || !EMAIL_RE.test(contactEmail)) {
      els.emailInput.setAttribute('aria-invalid', 'true');
      renderSendStatus('Enter a valid email address to send a message.');
      els.emailInput.focus();
      return;
    }
    els.nameInput.setAttribute('aria-invalid', 'false');
    els.emailInput.setAttribute('aria-invalid', 'false');
    const clientId = uuid();
    if (!clientId) {
      renderSendStatus('Unable to send message in this browser.');
      return;
    }
    displayName = name;
    pending = { body: body, clientId: clientId, displayName: name, email: contactEmail };
    email = contactEmail;
    saveName();
    saveEmail();
    savePending();
    lockInputs();
    sendError = null;
    renderSendStatus('Sending\u2026');
    doSend();
  }

  function onRetry() {
    if (!pending) return;
    if (sendInFlight) return;
    sendError = null;
    renderSendStatus('Sending\u2026');
    doSend();
  }

  function doSend() {
    if (!pending) return;
    if (sendInFlight) return;
    if (!sessionLoaded || !csrfToken) {
      renderSendStatus('Chat is unavailable right now.');
      return;
    }
    sendInFlight = true;
    els.retryBtn.disabled = true;
    if (pollAbort) { try { pollAbort.abort(); } catch (_) {} pollAbort = null; }
    pollInFlight = false;
    if (sessionAbort) { try { sessionAbort.abort(); } catch (_) {} sessionAbort = null; }
    const attempt = { body: pending.body, clientId: pending.clientId, displayName: pending.displayName, email: pending.email };
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, CHAT_TIMEOUT_MS);
    fetch(CHAT_MESSAGES_URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: JSON.stringify(attempt),
      signal: ctrl.signal
    }).then((r) => {
      return r.json().then((data) => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: data };
      }, () => {
        clearTimeout(t);
        return { ok: r.ok, status: r.status, data: null };
      });
    }, (e) => {
      clearTimeout(t);
      throw e;
    }).then((res) => {
      if (res.status === 401 || res.status === 403) {
        return refreshSessionThenRetry(attempt);
      }
      if (!pending || pending.clientId !== attempt.clientId || pending.body !== attempt.body) {
        return;
      }
      if (res.status === 429) {
        sendError = 'Too many messages. Please wait and retry.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
        return;
      }
      if (res.status === 503) {
        sendError = 'Chat is temporarily unavailable. Please retry.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
        return;
      }
      if (!res.ok) {
        sendError = 'Message not sent. Please retry.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
        return;
      }
      const data = res.data;
      if (!data) {
        sendError = 'Delivery unconfirmed. Retry safely.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
        return;
      }
      const newMsgs = validateMessages(data.messages).slice(-MAX_MESSAGES);
      const ack = newMsgs.some((m) => m && m.sender === 'visitor' &&
        m.clientId === attempt.clientId && m.body === attempt.body);
      if (data.conversation) conversation = data.conversation;
      messages = mergeMessages(messages, newMsgs);
      if (data.conversation && data.conversation.updatedAt) lastUpdatedAt = data.conversation.updatedAt;
      if (ack) {
        pending = null;
        savePending();
        draft = '';
        saveDraft();
        els.msgInput.value = '';
        sendError = null;
        unlockInputs();
        renderSendStatus('');
        renderTranscript();
        scrollToBottom();
      } else {
        sendError = 'Delivery unconfirmed. Retry safely.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
        renderTranscript();
      }
    }).catch(() => {
      if (!pending || pending.clientId !== attempt.clientId || pending.body !== attempt.body) {
        return;
      }
      sendError = 'Delivery unconfirmed. Retry safely.';
      renderSendStatus(sendError);
      els.retryBtn.hidden = false;
    }).then(() => {
      sendInFlight = false;
      els.retryBtn.disabled = false;
      if (!pending) {
        unlockInputs();
      }
    });
  }

  function refreshSessionThenRetry(attempt) {
    return requestJSON(CHAT_SESSION_URL, 'GET', null, CHAT_TIMEOUT_MS).then((res) => {
      if (!res.ok || !res.data || typeof res.data.csrfToken !== 'string' || !res.data.csrfToken) {
        if (pending && pending.clientId === attempt.clientId && pending.body === attempt.body) {
          sendError = 'Session expired. Please retry.';
          renderSendStatus(sendError);
          els.retryBtn.hidden = false;
        }
        return;
      }
      csrfToken = res.data.csrfToken;
      if (res.data.conversation) conversation = res.data.conversation;
      if (Array.isArray(res.data.messages)) {
        messages = mergeMessages(messages, validateMessages(res.data.messages).slice(-MAX_MESSAGES));
      }
      renderTranscript();
      reconcilePending();
      if (pending && pending.clientId === attempt.clientId && pending.body === attempt.body) {
        sendError = 'Session refreshed. Please retry.';
        renderSendStatus(sendError);
        els.retryBtn.hidden = false;
      }
    });
  }

  function init() {
    build();
    loadStored();
    if (els.msgInput) els.msgInput.value = draft;
    if (els.nameInput) els.nameInput.value = displayName;
    if (els.emailInput) els.emailInput.value = email;
    if (pending) {
      lockInputs();
      renderSendStatus('Delivery unconfirmed. Retry safely.');
    } else if (pendingNeedsContact) {
      renderSendStatus('Enter your name and email to retry the saved message.');
    }
    if (!storageAvailable) {
      renderSessionStatus('Draft will not be saved between refreshes in this browser.');
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (els.dialog.open) {
          if (!sessionLoaded) loadSession();
          startPoll();
        }
      } else {
        stopPoll();
        requestGen++;
        if (sessionAbort) { try { sessionAbort.abort(); } catch (_) {} sessionAbort = null; }
        if (pollAbort) { try { pollAbort.abort(); } catch (_) {} pollAbort = null; }
        pollInFlight = false;
      }
    });
    updatePrivacyNote();
  }

  return { init: init, open: openDialog };
}

function boot() {
  if (document.getElementById(ROOT_ID)) return;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'egv-root';
  document.body.appendChild(root);

  const analytics = Analytics();
  analytics.init();

  const chat = Chat(root, analytics);
  chat.init();

  try {
    const params = new URLSearchParams(location.search);
    if (params.get('chat') === '1') {
      chat.open();
    }
  } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
