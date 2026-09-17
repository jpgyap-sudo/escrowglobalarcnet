/** Sandbox operator tools: analytics, blog content, settings and audit history. */
import { randomUUID } from 'node:crypto';
import { orderStatus } from './universal-domain.mjs';
import { ensureSupportState, mutateTicket, supportAnalytics, adminTicketSummary } from './support.mjs';
import { ensureContentState, syncTrackedContent, pageMediaUsage } from './content.mjs';

const MAX_AUDIT = 2000;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const asArray = value => Array.isArray(value) ? value : [];
const text = (value, label, min = 0, max = 5000) => {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new Error(`${label} must contain ${min}–${max} characters.`);
  return result;
};
const optionalText = (value, label, max) => value === undefined ? undefined : text(value, label, 0, max);
const exact = (payload, allowed) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Object payload required.');
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) throw new Error(`Unsupported admin field: ${key}`);
};
const bool = (value, label) => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
};
const nowIso = now => new Date(now).toISOString();
const FEATURE_FLAG_KEYS = ['blog', 'reports', 'domainOffers', 'accountCreation', 'walletSignIn'];
const PAGE_TEMPLATES = ['landing', 'standard', 'legal', 'journal'];
const PAGE_STATUSES = ['draft', 'published', 'archived'];
const SECTION_TYPES = ['hero', 'rich_text', 'list', 'image', 'cta'];
const MEDIA_KINDS = ['image', 'icon', 'vector', 'video', 'other'];

export const defaultAdminSettings = now => ({
  siteName: 'Escrow Global',
  tagline: 'Global deals. Clear settlement.',
  contactEmail: 'sandbox@example.invalid',
  maintenanceMode: false,
  // These account-entry flags are intentionally off until the production
  // identity, recovery, abuse, and custody roadmap gates are complete.
  featureFlags: { blog: true, reports: true, domainOffers: true, accountCreation: false, walletSignIn: false },
  seo: {
    defaultTitle: 'Escrow Global Settlement',
    defaultDescription: 'Global deals with clear scope, evidence and settlement.',
    robots: 'noindex,nofollow'
  },
  updatedAt: nowIso(now)
});

export function ensureAdminState(state, now = Date.now()) {
  let changed = false;
  if (!Number.isInteger(state.adminVersion)) { state.adminVersion = 1; changed = true; }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
    state.settings = defaultAdminSettings(now); changed = true;
  } else {
    const defaults = defaultAdminSettings(now);
    if (!state.settings.featureFlags || typeof state.settings.featureFlags !== 'object' || Array.isArray(state.settings.featureFlags)) { state.settings.featureFlags = {}; changed = true; }
    if (!state.settings.seo || typeof state.settings.seo !== 'object' || Array.isArray(state.settings.seo)) { state.settings.seo = {}; changed = true; }
    for (const [key, value] of Object.entries(defaults)) {
      if (state.settings[key] === undefined) { state.settings[key] = structuredClone(value); changed = true; }
    }
    for (const key of Object.keys(defaults.featureFlags)) {
      if (state.settings.featureFlags[key] === undefined) { state.settings.featureFlags[key] = defaults.featureFlags[key]; changed = true; }
    }
    for (const key of Object.keys(defaults.seo)) {
      if (state.settings.seo[key] === undefined) { state.settings.seo[key] = defaults.seo[key]; changed = true; }
    }
  }
  if (!Array.isArray(state.blog)) { state.blog = []; changed = true; }
  if (!Array.isArray(state.audit)) { state.audit = []; changed = true; }
  if (ensureContentState(state, now)) changed = true;
  if (ensureSupportState(state)) changed = true;
  return changed;
}

function auditEntry(type, summary, target, now, actorId, extra = {}) {
  return { id: `audit_${randomUUID()}`, at: nowIso(now), actorId, type, summary, target, ...extra };
}
function record(state, entry) {
  state.audit = [...asArray(state.audit), entry].slice(-MAX_AUDIT);
}
function actorMustBeAdmin(state, actorId) {
  const actor = state.users?.find(user => user.id === actorId);
  if (!actor || actor.role !== 'admin') {
    const error = new Error('A local admin demo identity is required. This is not authentication.');
    error.code = 'FORBIDDEN';
    throw error;
  }
  return actor;
}
function listing(state, id) {
  const found = state.listings.find(item => item.id === id);
  if (!found) throw new Error('Listing not found.');
  return found;
}
function report(state, id) {
  const found = asArray(state.reports).find(item => item.id === id);
  if (!found) throw new Error('Report not found.');
  return found;
}
function order(state, id) {
  const found = state.orders.find(item => item.id === id);
  if (!found) throw new Error('Agreement not found.');
  return found;
}
function normaliseTags(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new Error('Tags must be an array of at most 20 items.');
  return value.map((tag, index) => text(tag, `Tag ${index + 1}`, 1, 40)).filter(Boolean);
}
function normaliseSeo(value) {
  if (value === undefined) return undefined;
  exact(value, ['title', 'description', 'canonical', 'ogImage', 'keywords']);
  const result = {};
  if (value.title !== undefined) result.title = text(value.title, 'SEO title', 0, 70);
  if (value.description !== undefined) result.description = text(value.description, 'SEO description', 0, 170);
  if (value.canonical !== undefined) result.canonical = text(value.canonical, 'Canonical path', 0, 300);
  if (value.ogImage !== undefined) result.ogImage = text(value.ogImage, 'OG image', 0, 500);
  if (value.keywords !== undefined) result.keywords = text(value.keywords, 'SEO keywords', 0, 300);
  return result;
}
function normaliseBlogFields(payload, existing = {}) {
  exact(payload, ['title', 'slug', 'excerpt', 'body', 'tags', 'status', 'seo', 'author']);
  const result = {};
  if (payload.title !== undefined) result.title = text(payload.title, 'Blog title', 3, 160);
  if (payload.slug !== undefined) {
    const slug = text(payload.slug, 'Blog slug', 3, 80).toLowerCase();
    if (!slugPattern.test(slug)) throw new Error('Blog slug must use lowercase letters, numbers and hyphens.');
    result.slug = slug;
  }
  if (payload.excerpt !== undefined) result.excerpt = text(payload.excerpt, 'Excerpt', 0, 300);
  if (payload.body !== undefined) result.body = text(payload.body, 'Blog body', 1, 30000);
  const tags = normaliseTags(payload.tags); if (tags !== undefined) result.tags = tags;
  if (payload.author !== undefined) result.author = text(payload.author, 'Author', 1, 100);
  if (payload.status !== undefined) {
    if (!['draft', 'published', 'archived'].includes(payload.status)) throw new Error('Unsupported blog status.');
    result.status = payload.status;
  }
  const seo = normaliseSeo(payload.seo); if (seo !== undefined) result.seo = { ...(existing.seo || {}), ...seo };
  return result;
}
function uniqueSlug(state, slug, ignoreId = null) {
  if (state.blog.some(post => post.slug === slug && post.id !== ignoreId)) throw new Error('A blog post already uses this slug.');
}
function pagePath(value) {
  const result = text(value, 'Page path', 1, 300);
  if (!result.startsWith('/') || result.includes('\\') || /[?#]/.test(result) || !/^\/[a-z0-9/_-]*$/i.test(result)) throw new Error('Page path must be a local URL path such as /about.');
  return result.length > 1 ? result.replace(/\/+$/, '') : result;
}
function mediaPath(value) {
  const result = text(value, 'Media path', 1, 300);
  if (!result.startsWith('/') || result.includes('\\') || result.includes('..') || /[?#]/.test(result) || !/^\/[a-z0-9/_ .-]+$/i.test(result)) throw new Error('Media path must be a local public asset path.');
  return result.replace(/\s+/g, '-');
}
function contentSlug(value, fallback) {
  const result = text(value || fallback, 'Page slug', 1, 100).toLowerCase();
  if (!slugPattern.test(result)) throw new Error('Page slug must use lowercase letters, numbers and hyphens.');
  return result;
}
function contentSections(value, existing = []) {
  if (value === undefined) return structuredClone(existing);
  if (!Array.isArray(value) || value.length > 40) throw new Error('Sections must be an array of at most 40 blocks.');
  return value.map((section, index) => {
    exact(section, ['id', 'type', 'data']);
    if (!SECTION_TYPES.includes(section.type)) throw new Error(`Unsupported section type at position ${index + 1}.`);
    if (!section.data || typeof section.data !== 'object' || Array.isArray(section.data)) throw new Error(`Section ${index + 1} data must be an object.`);
    const data = section.data;
    const allowed = section.type === 'hero' ? ['eyebrow', 'heading', 'body', 'mediaId', 'alt', 'ctaLabel', 'ctaHref']
      : section.type === 'rich_text' ? ['eyebrow', 'heading', 'paragraphs']
        : section.type === 'list' ? ['eyebrow', 'heading', 'items']
          : section.type === 'image' ? ['mediaId', 'alt', 'caption'] : ['eyebrow', 'heading', 'body', 'ctaLabel', 'ctaHref'];
    exact(data, allowed);
    const str = (key, max) => data[key] === undefined ? '' : text(data[key], `${section.type} ${key}`, 0, max);
    const out = { id: text(section.id || `${section.type}-${index + 1}`, 'Section id', 1, 100), type: section.type, data: {} };
    for (const key of allowed) if (key !== 'paragraphs' && key !== 'items') out.data[key] = str(key, key === 'body' ? 4000 : key === 'eyebrow' ? 120 : 500);
    if (section.type === 'rich_text') {
      if (!Array.isArray(data.paragraphs) || data.paragraphs.length > 50) throw new Error('Rich text paragraphs must be an array of at most 50 items.');
      out.data.paragraphs = data.paragraphs.map((item, i) => text(item, `Paragraph ${i + 1}`, 1, 4000));
    }
    if (section.type === 'list') {
      if (!Array.isArray(data.items) || data.items.length > 50) throw new Error('List items must be an array of at most 50 items.');
      out.data.items = data.items.map((item, i) => text(item, `List item ${i + 1}`, 1, 500));
    }
    return out;
  });
}
function normalisePageFields(payload, existing = {}) {
  exact(payload, ['title', 'path', 'slug', 'template', 'status', 'seo', 'sections', 'sourceFile', 'syncNote']);
  const result = {};
  if (payload.title !== undefined) result.title = text(payload.title, 'Page title', 2, 180);
  if (payload.path !== undefined) result.path = pagePath(payload.path);
  if (payload.slug !== undefined) result.slug = contentSlug(payload.slug);
  if (payload.template !== undefined) { if (!PAGE_TEMPLATES.includes(payload.template)) throw new Error('Unsupported page template.'); result.template = payload.template; }
  if (payload.status !== undefined) { if (!PAGE_STATUSES.includes(payload.status)) throw new Error('Unsupported page status.'); result.status = payload.status; }
  if (payload.seo !== undefined) result.seo = { ...(existing.seo || {}), ...normaliseSeo(payload.seo) };
  if (payload.sections !== undefined) result.sections = contentSections(payload.sections, existing.sections);
  return result;
}
function uniquePagePath(state, pagePathValue, ignoreId = null) { if (state.pages.some(page => page.path === pagePathValue && page.id !== ignoreId)) throw new Error('A page already uses this path.'); }
function normaliseMediaFields(payload, existing = {}) {
  exact(payload, ['path', 'filename', 'kind', 'mime', 'width', 'height', 'alt', 'title', 'tags', 'sourceFile']);
  const result = {};
  if (payload.path !== undefined) result.path = mediaPath(payload.path);
  if (payload.filename !== undefined) result.filename = text(payload.filename, 'Media filename', 1, 180);
  if (payload.kind !== undefined) { if (!MEDIA_KINDS.includes(payload.kind)) throw new Error('Unsupported media kind.'); result.kind = payload.kind; }
  if (payload.mime !== undefined) result.mime = text(payload.mime, 'Media MIME type', 3, 120);
  for (const key of ['width', 'height']) if (payload[key] !== undefined) { if (payload[key] !== null && (!Number.isSafeInteger(payload[key]) || payload[key] < 0 || payload[key] > 100000)) throw new Error(`Media ${key} must be a non-negative integer or null.`); result[key] = payload[key]; }
  for (const key of ['alt', 'title', 'sourceFile']) if (payload[key] !== undefined) result[key] = text(payload[key], `Media ${key}`, key === 'title' ? 1 : 0, key === 'sourceFile' ? 300 : 400);
  if (payload.tags !== undefined) { if (!Array.isArray(payload.tags) || payload.tags.length > 20) throw new Error('Media tags must be an array of at most 20 items.'); result.tags = payload.tags.map((tag, i) => text(tag, `Media tag ${i + 1}`, 1, 40)); }
  return result;
}
function uniqueMediaPath(state, mediaPath, ignoreId = null) { if (state.media.some(item => item.path === mediaPath && item.id !== ignoreId)) throw new Error('A media record already uses this path.'); }

export function applyAdminCommand(input, actorId, command, payload = {}, now = Date.now()) {
  const state = structuredClone(input);
  ensureAdminState(state, now);
  actorMustBeAdmin(state, actorId);
  let summary = '';
  let target = { kind: 'admin', id: command };
  if (command === 'moderate_listing') {
    exact(payload, ['listingId', 'decision', 'reason']);
    const item = listing(state, payload.listingId);
    if (!['published', 'paused', 'hidden'].includes(payload.decision)) throw new Error('Choose published, paused or hidden.');
    const reason = text(payload.reason || '', 'Moderation reason', payload.decision === 'hidden' ? 15 : 0, 1500);
    const before = item.status; item.status = payload.decision;
    item.moderationHistory = asArray(item.moderationHistory);
    item.moderationHistory.push({ decision: payload.decision, reason: reason || 'Operator status update.', reviewerId: actorId, at: now });
    summary = `${item.title} changed from ${before} to ${item.status}.`; target = { kind: 'listing', id: item.id };
  } else if (command === 'resolve_report') {
    exact(payload, ['reportId', 'resolution', 'note']);
    const item = report(state, payload.reportId);
    if (!['dismissed', 'actioned', 'escalated'].includes(payload.resolution)) throw new Error('Unsupported report resolution.');
    item.status = payload.resolution; item.decision = payload.resolution; item.reviewedAt = now; item.reviewerId = actorId;
    item.reviewerReason = text(payload.note || '', 'Resolution note', 0, 1500);
    summary = `Report ${item.id} marked ${item.status}.`; target = { kind: 'report', id: item.id };
  } else if (command === 'flag_order') {
    exact(payload, ['orderId', 'flagged', 'reason']);
    const item = order(state, payload.orderId); bool(payload.flagged, 'Flag');
    if (payload.flagged) item.adminFlag = { reason: text(payload.reason || '', 'Flag reason', 10, 1000), at: now, actorId };
    else item.adminFlag = null;
    summary = `${item.id} ${payload.flagged ? 'flagged for monitoring' : 'cleared from monitoring'}.`; target = { kind: 'order', id: item.id };
  } else if (command === 'add_order_note') {
    exact(payload, ['orderId', 'note']);
    const item = order(state, payload.orderId); const note = text(payload.note, 'Operator note', 3, 1500);
    item.adminNotes = [...asArray(item.adminNotes), { note, at: now, actorId }].slice(-50);
    summary = `Operator note added to ${item.id}.`; target = { kind: 'order', id: item.id };
  } else if (command === 'support_update_ticket') {
    exact(payload, ['ticketId', 'status', 'assignee']);
    const ticket = mutateTicket(state, payload, actorId, now);
    summary = `Support ticket ${ticket.id} updated.`; target = { kind: 'ticket', id: ticket.id };
  } else if (command === 'support_reply') {
    exact(payload, ['ticketId', 'body', 'visibility']);
    const ticket = mutateTicket(state, payload, actorId, now);
    summary = `Reply added to support ticket ${ticket.id}.`; target = { kind: 'ticket', id: ticket.id };
  } else if (command === 'save_blog') {
    exact(payload, ['id', 'fields', 'publish']);
    if (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)) throw new Error('Blog fields are required.');
    if (payload.publish !== undefined) bool(payload.publish, 'Publish');
    const existing = payload.id ? state.blog.find(post => post.id === payload.id) : null;
    if (payload.id && !existing) throw new Error('Blog post not found.');
    const fields = normaliseBlogFields(payload.fields, existing || {});
    if (!existing) {
      if (!fields.title || !fields.body) throw new Error('A new post needs a title and body.');
      fields.slug ||= fields.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
      uniqueSlug(state, fields.slug);
      const post = { id: `blog_${randomUUID()}`, title: fields.title, slug: fields.slug, excerpt: fields.excerpt || '', body: fields.body,
        tags: fields.tags || [], author: fields.author || 'Escrow Global team', status: payload.publish ? 'published' : (fields.status || 'draft'),
        seo: fields.seo || {}, createdAt: now, updatedAt: now, publishedAt: payload.publish ? now : null };
      if (!post.seo.title) post.seo.title = post.title;
      state.blog.push(post); target = { kind: 'blog', id: post.id }; summary = `Blog post “${post.title}” created.`;
    } else {
      if (fields.slug) uniqueSlug(state, fields.slug, existing.id);
      Object.assign(existing, fields, { updatedAt: now });
      if (payload.publish === true) { existing.status = 'published'; existing.publishedAt ||= now; }
      if (payload.publish === false && existing.status === 'published') { existing.status = 'draft'; existing.publishedAt = null; }
      target = { kind: 'blog', id: existing.id }; summary = `Blog post “${existing.title}” saved.`;
    }
  } else if (command === 'delete_blog') {
    exact(payload, ['id']);
    const index = state.blog.findIndex(post => post.id === payload.id); if (index < 0) throw new Error('Blog post not found.');
    const [removed] = state.blog.splice(index, 1); summary = `Blog post “${removed.title}” deleted.`; target = { kind: 'blog', id: removed.id };
  } else if (command === 'save_page') {
    exact(payload, ['id', 'fields', 'publish']);
    if (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)) throw new Error('Page fields are required.');
    if (payload.publish !== undefined) bool(payload.publish, 'Publish');
    const existing = payload.id ? state.pages.find(page => page.id === payload.id) : null;
    if (payload.id && !existing) throw new Error('Page not found.');
    const fields = normalisePageFields(payload.fields, existing || {});
    if (!existing) {
      if (!fields.title || !fields.path) throw new Error('A new page needs a title and path.');
      uniquePagePath(state, fields.path);
      const page = { id: `page_${randomUUID()}`, title: fields.title, path: fields.path, slug: fields.slug || contentSlug('', fields.path.replace(/^\//, '') || 'home'), template: fields.template || 'standard', status: payload.publish ? 'published' : (fields.status || 'draft'), sourceFile: '', syncNote: 'Created from the admin template editor.', seo: fields.seo || {}, sections: fields.sections || [], createdAt: now, updatedAt: now, lastSyncedAt: null };
      state.pages.push(page); target = { kind: 'page', id: page.id }; summary = `Page “${page.title}” created.`;
    } else {
      if (fields.path) uniquePagePath(state, fields.path, existing.id);
      Object.assign(existing, fields, { updatedAt: now });
      if (payload.publish === true) existing.status = 'published';
      if (payload.publish === false && existing.status === 'published') existing.status = 'draft';
      target = { kind: 'page', id: existing.id }; summary = `Page “${existing.title}” saved.`;
    }
  } else if (command === 'delete_page') {
    exact(payload, ['id']);
    const index = state.pages.findIndex(page => page.id === payload.id); if (index < 0) throw new Error('Page not found.');
    const removed = state.pages[index]; if (removed.sourceFile && ['/', '/about', '/disclaimer', '/support', '/blog'].includes(removed.path)) throw new Error('Tracked website pages cannot be deleted; archive them instead.');
    state.pages.splice(index, 1); summary = `Page “${removed.title}” deleted.`; target = { kind: 'page', id: removed.id };
  } else if (command === 'sync_pages') {
    exact(payload, []); const before = state.pages.length + state.media.length; syncTrackedContent(state, now); const after = state.pages.length + state.media.length;
    summary = `Website content inventory synced (${after - before} new record${after - before === 1 ? '' : 's'}).`; target = { kind: 'content', id: 'website' };
  } else if (command === 'save_media') {
    exact(payload, ['id', 'fields']); if (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)) throw new Error('Media fields are required.');
    const existing = payload.id ? state.media.find(item => item.id === payload.id) : null; if (payload.id && !existing) throw new Error('Media record not found.');
    const fields = normaliseMediaFields(payload.fields, existing || {}); if (!existing && !fields.path) throw new Error('A new media record needs a path.');
    const pathValue = fields.path || existing.path; uniqueMediaPath(state, pathValue, existing?.id);
    if (!existing) { const item = { id: `media_${randomUUID()}`, path: pathValue, filename: fields.filename || pathValue.split('/').pop(), kind: fields.kind || 'image', mime: fields.mime || 'application/octet-stream', width: fields.width ?? null, height: fields.height ?? null, alt: fields.alt || '', title: fields.title || fields.filename || pathValue.split('/').pop(), tags: fields.tags || [], sourceFile: fields.sourceFile || '', lastSyncedAt: null, updatedAt: now }; state.media.push(item); target = { kind: 'media', id: item.id }; summary = `Media “${item.title}” created.`; }
    else { Object.assign(existing, fields, { updatedAt: now }); target = { kind: 'media', id: existing.id }; summary = `Media “${existing.title}” saved.`; }
  } else if (command === 'delete_media') {
    exact(payload, ['id']); const index = state.media.findIndex(item => item.id === payload.id); if (index < 0) throw new Error('Media record not found.');
    const item = state.media[index]; const usage = pageMediaUsage(state, item); if (usage.length) throw new Error(`Media is still used by ${usage.length} page${usage.length === 1 ? '' : 's'}; remove the references first.`);
    state.media.splice(index, 1); summary = `Media “${item.title}” deleted.`; target = { kind: 'media', id: item.id };
  } else if (command === 'update_settings') {
    exact(payload, ['patch']);
    const patch = payload.patch; if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Settings patch is required.');
    exact(patch, ['siteName', 'tagline', 'contactEmail', 'maintenanceMode', 'featureFlags', 'seo']);
    const next = {};
    if (patch.siteName !== undefined) next.siteName = text(patch.siteName, 'Site name', 2, 100);
    if (patch.tagline !== undefined) next.tagline = text(patch.tagline, 'Tagline', 2, 180);
    if (patch.contactEmail !== undefined) {
      next.contactEmail = text(patch.contactEmail, 'Contact email', 3, 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.contactEmail)) throw new Error('Contact email is invalid.');
    }
    if (patch.maintenanceMode !== undefined) next.maintenanceMode = bool(patch.maintenanceMode, 'Maintenance mode');
    if (patch.featureFlags !== undefined) {
      exact(patch.featureFlags, FEATURE_FLAG_KEYS); next.featureFlags = {};
      for (const key of FEATURE_FLAG_KEYS) if (patch.featureFlags[key] !== undefined) next.featureFlags[key] = bool(patch.featureFlags[key], key);
    }
    if (patch.seo !== undefined) { exact(patch.seo, ['defaultTitle', 'defaultDescription', 'robots']); next.seo = {};
      if (patch.seo.defaultTitle !== undefined) next.seo.defaultTitle = text(patch.seo.defaultTitle, 'Default SEO title', 0, 70);
      if (patch.seo.defaultDescription !== undefined) next.seo.defaultDescription = text(patch.seo.defaultDescription, 'Default SEO description', 0, 170);
      if (patch.seo.robots !== undefined) { next.seo.robots = text(patch.seo.robots, 'Robots policy', 1, 80); if (!/^[a-z, -]+$/i.test(next.seo.robots)) throw new Error('Robots policy contains unsupported characters.'); }
    }
    state.settings = { ...state.settings, ...next, featureFlags: { ...state.settings.featureFlags, ...(next.featureFlags || {}) }, seo: { ...state.settings.seo, ...(next.seo || {}) }, updatedAt: nowIso(now) };
    summary = 'Site and SEO settings updated.'; target = { kind: 'settings', id: 'site' };
  } else {
    throw new Error('Unknown admin command.');
  }
  record(state, auditEntry(`admin.${command}`, summary, target, now, actorId));
  state.version += 1;
  return { state, result: target.id, auditEntry: state.audit.at(-1) };
}

function countBy(items, key) { return items.reduce((out, item) => { const value = key(item) || 'unknown'; out[value] = (out[value] || 0) + 1; return out; }, {}); }
function trend(state, days, now) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now - (i + 1) * 86400000); const end = new Date(now - i * 86400000);
    const inWindow = (value) => typeof value === 'number' && value >= start.getTime() && value < end.getTime();
    result.push({ date: start.toISOString().slice(0, 10), listings: state.listings.filter(x => inWindow(x.createdAt)).length,
      orders: state.orders.filter(x => inWindow(x.createdAt)).length, reports: asArray(state.reports).filter(x => inWindow(x.at)).length,
      publishedPosts: asArray(state.blog).filter(x => inWindow(x.publishedAt)).length });
  }
  return result;
}
export function getAdminAnalytics(state, days = 30, now = Date.now()) {
  const orders = asArray(state.orders), listings = asArray(state.listings), reports = asArray(state.reports), blog = asArray(state.blog);
  const values = orders.reduce((out, item) => { out[item.asset] = (out[item.asset] || 0n) + item.milestones.reduce((sum, m) => sum + BigInt(m.originalAmount || 0), 0n); return out; }, {});
  const openReports = reports.filter(x => ['pending', 'escalated'].includes(x.status));
  return { generatedAt: nowIso(now), rangeDays: days, counts: { users: asArray(state.users).length, listings: listings.length, orders: orders.length,
    reports: reports.length, supportTickets: asArray(state.supportTickets).length, briefs: asArray(state.briefs).length, reviews: asArray(state.reviews).length, evidence: asArray(state.evidence).length, blog: blog.length, pages: asArray(state.pages).length, media: asArray(state.media).length },
    listings: { byStatus: countBy(listings, x => x.status), byCategory: countBy(listings, x => x.category || x.categoryId), published: listings.filter(x => x.status === 'published').length },
    orders: { byStatus: countBy(orders, x => orderStatus(x)), flagged: orders.filter(x => x.adminFlag).length, totalValueByAsset: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.toString()])) },
    reports: { open: openReports.length, byStatus: countBy(reports, x => x.status || 'pending') },
    support: supportAnalytics(state, now),
    blog: { byStatus: countBy(blog, x => x.status), lastPublishedAt: blog.filter(x => x.publishedAt).sort((a, b) => b.publishedAt - a.publishedAt)[0]?.publishedAt || null },
    audit: { total: asArray(state.audit).length, last24h: asArray(state.audit).filter(x => Date.parse(x.at) >= now - 86400000).length, lastEntryAt: state.audit.at(-1)?.at || null },
    health: { stateVersion: state.version, adminVersion: state.adminVersion, maintenanceMode: Boolean(state.settings?.maintenanceMode), mode: state.mode, realFunds: false },
    trend: trend(state, days, now) };
}

export function adminSnapshot(state, days = 30, now = Date.now()) {
  ensureAdminState(state, now);
  return { analytics: getAdminAnalytics(state, days, now), users: state.users, listings: state.listings, reports: state.reports,
    orders: state.orders, blog: state.blog, pages: state.pages, media: state.media, supportTickets: state.supportTickets.slice(-100).reverse().map(adminTicketSummary), settings: state.settings, audit: [...state.audit].slice(-100).reverse() };
}

export function auditRows(state, limit = 100) { return [...asArray(state.audit)].slice(-Math.min(Math.max(Number(limit) || 100, 1), 200)).reverse(); }

export function exportRows(state, kind) {
  const rows = { listings: state.listings, orders: state.orders, reports: asArray(state.reports), blog: asArray(state.blog), pages: asArray(state.pages), media: asArray(state.media), audit: asArray(state.audit), users: state.users, support: asArray(state.supportTickets).map(adminTicketSummary) }[kind];
  if (!rows) throw new Error('Unsupported export type.');
  return rows;
}
