/** Local-only support and bug intake. Attachments are intentionally sandbox data. */
import { createHash, randomUUID } from 'node:crypto';

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
export const TICKET_CATEGORIES = ['support', 'bug', 'payment', 'listing', 'account'];
export const TICKET_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const attachmentTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);
const maxFile = 2 * 1024 * 1024, maxFiles = 3, maxTotal = 5 * 1024 * 1024;
const text = (value, label, min = 0, max = 5000) => {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (result.length < min || result.length > max) throw new Error(`${label} must contain ${min}–${max} characters.`);
  return result;
};
const exact = (payload, allowed) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Object payload required.');
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) throw new Error(`Unsupported ticket field: ${key}`);
};
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const iso = now => new Date(now).toISOString();
function safeUrl(value) {
  if (value === undefined || value === '') return '';
  const url = text(value, 'Page URL', 0, 500);
  if (url.startsWith('//') || /^\s*(?:javascript|data|vbscript):/i.test(url)) throw new Error('Page URL must be a relative path or http(s) URL.');
  if (url.startsWith('/')) return url;
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return url; } catch { throw new Error('Page URL must be a relative path or http(s) URL.'); }
}
function magicMatches(buffer, mime) {
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  return true;
}
function attachment(value, index) {
  exact(value, ['filename', 'mime', 'dataB64']);
  const mime = text(value.mime, `Attachment ${index + 1} type`, 1, 80).toLowerCase();
  if (!attachmentTypes.has(mime)) { const error = new Error('Unsupported attachment type. Use PNG, JPEG, WebP, GIF, PDF or text.'); error.code = 'UNSUPPORTED_MEDIA_TYPE'; throw error; }
  const filename = text(value.filename, `Attachment ${index + 1} filename`, 1, 120).replace(/[\\/\u0000]/g, '_').replace(/\.\.+/g, '.');
  if (typeof value.dataB64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.dataB64)) throw new Error(`Attachment ${index + 1} is not valid base64.`);
  const bytes = Buffer.from(value.dataB64, 'base64');
  if (!bytes.length || bytes.length > maxFile) { const error = new Error(`Attachment ${index + 1} exceeds the 2 MB limit.`); error.code = 'PAYLOAD_TOO_LARGE'; throw error; }
  if (!magicMatches(bytes, mime)) { const error = new Error(`Attachment ${index + 1} does not match its declared file type.`); error.code = 'UNSUPPORTED_MEDIA_TYPE'; throw error; }
  return { id: `att_${randomUUID()}`, filename, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), dataB64: value.dataB64, createdAt: Date.now() };
}
function related(value, state) {
  if (value === undefined) return {};
  exact(value, ['orderId', 'listingId']);
  const result = {};
  if (value.orderId) { if (!id(value.orderId)) throw new Error('Related agreement ID is invalid.'); if (!state.orders.some(x => x.id === value.orderId)) throw new Error('Related agreement was not found.'); result.orderId = value.orderId; }
  if (value.listingId) { if (!id(value.listingId)) throw new Error('Related listing ID is invalid.'); if (!state.listings.some(x => x.id === value.listingId)) throw new Error('Related listing was not found.'); result.listingId = value.listingId; }
  return result;
}
function environment(value) {
  if (value === undefined) return { userAgent: '', viewport: '', locale: '', appVersion: '' };
  exact(value, ['userAgent', 'viewport', 'locale', 'appVersion']);
  return { userAgent: text(value.userAgent || '', 'Browser', 0, 300), viewport: text(value.viewport || '', 'Viewport', 0, 20), locale: text(value.locale || '', 'Locale', 0, 20), appVersion: text(value.appVersion || '', 'App version', 0, 40) };
}
export function ensureSupportState(state) { if (!Array.isArray(state.supportTickets)) { state.supportTickets = []; return true; } return false; }
export function createTicket(state, payload, now = Date.now()) {
  if (state.supportTickets.length >= 10000) { const error = new Error('Support intake is at capacity.'); error.code = 'SERVICE_UNAVAILABLE'; throw error; }
  exact(payload, ['category', 'subject', 'description', 'severity', 'pageUrl', 'environment', 'related', 'reporterHandle', 'attachments']);
  if (!TICKET_CATEGORIES.includes(payload.category)) throw new Error('Choose a supported ticket category.');
  if (!TICKET_SEVERITIES.includes(payload.severity)) throw new Error('Choose a supported severity.');
  const attachments = payload.attachments === undefined ? [] : payload.attachments.map(attachment);
  if (attachments.length > maxFiles) throw new Error('Attach no more than 3 files.');
  if (attachments.reduce((n, x) => n + x.size, 0) > maxTotal) { const error = new Error('Attachments exceed the 5 MB total limit.'); error.code = 'PAYLOAD_TOO_LARGE'; throw error; }
  const storedBytes = state.supportTickets.reduce((n, ticket) => n + (ticket.attachments || []).reduce((m, item) => m + item.size, 0), 0);
  if (storedBytes + attachments.reduce((n, x) => n + x.size, 0) > 50 * 1024 * 1024) { const error = new Error('Support attachment storage is at capacity.'); error.code = 'SERVICE_UNAVAILABLE'; throw error; }
  const ticket = { id: `tkt_${randomUUID()}`, createdAt: now, updatedAt: now, status: 'open', category: payload.category,
    severity: payload.severity, subject: text(payload.subject, 'Subject', 3, 140), description: text(payload.description, 'Description', 10, 6000),
    pageUrl: safeUrl(payload.pageUrl), environment: environment(payload.environment), related: related(payload.related, state),
    reporterHandle: payload.reporterHandle === undefined ? '' : text(payload.reporterHandle, 'Reporter handle', 0, 40), assignee: null,
    attachments, replies: [], audit: [{ id: `ta_${randomUUID()}`, at: iso(now), actor: 'user', action: 'created', note: 'Ticket created from the web form.' }] };
  state.supportTickets.push(ticket); return ticket;
}
export function publicTicket(ticket) { return { id: ticket.id, status: ticket.status, category: ticket.category, severity: ticket.severity, subject: ticket.subject, description: ticket.description, pageUrl: ticket.pageUrl, related: ticket.related, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, replies: ticket.replies.filter(x => x.visibility === 'public').map(({ id, createdAt, author, body }) => ({ id, createdAt, author, body })), attachments: ticket.attachments.map(({ id, filename, mime, size, sha256, createdAt }) => ({ id, filename, mime, size, sha256, createdAt })) }; }
export function adminTicketSummary(ticket) { return { ...publicTicket(ticket), assignee: ticket.assignee, reporterHandle: ticket.reporterHandle, replyCount: ticket.replies.length, auditCount: ticket.audit.length, attachments: ticket.attachments.map(({ id, filename, mime, size, sha256, createdAt }) => ({ id, filename, mime, size, sha256, createdAt })) }; }
export function addPublicReply(ticket, body, now = Date.now()) { const reply = { id: `rep_${randomUUID()}`, createdAt: now, author: 'user', visibility: 'public', body: text(body, 'Reply', 3, 3000) }; ticket.replies.push(reply); ticket.updatedAt = now; ticket.audit.push({ id: `ta_${randomUUID()}`, at: iso(now), actor: 'user', action: 'reply_added' }); return reply; }
export function findTicket(state, ticketId) { const ticket = state.supportTickets.find(x => x.id === ticketId); if (!ticket) throw new Error('Support ticket not found.'); return ticket; }
export function mutateTicket(state, payload, actorId, now = Date.now()) {
  exact(payload, ['ticketId', 'status', 'assignee', 'body', 'visibility']); const ticket = findTicket(state, payload.ticketId); const previous = ticket.status;
  if (payload.status !== undefined) { if (!TICKET_STATUSES.includes(payload.status)) throw new Error('Unsupported ticket status.'); const allowed = { open: ['in_progress', 'waiting_user', 'resolved', 'closed'], in_progress: ['waiting_user', 'resolved', 'closed'], waiting_user: ['in_progress', 'resolved', 'closed'], resolved: ['closed', 'open'], closed: ['open'] }; if (payload.status !== previous && !allowed[previous].includes(payload.status)) { const error = new Error(`Cannot change a ${previous} ticket to ${payload.status}.`); error.code = 'CONFLICT'; throw error; } ticket.status = payload.status; }
  if (payload.assignee !== undefined) { if (payload.assignee !== null && (!id(payload.assignee) || !state.users?.some(user => user.id === payload.assignee && user.role === 'admin'))) throw new Error('Assignee must be an existing local admin identity.'); ticket.assignee = payload.assignee; }
  if (payload.body !== undefined) { if (!['public', 'internal'].includes(payload.visibility)) throw new Error('Reply visibility must be public or internal.'); ticket.replies.push({ id: `rep_${randomUUID()}`, createdAt: now, author: actorId, visibility: payload.visibility, body: text(payload.body, 'Reply', 3, 3000) }); }
  if (ticket.status !== previous) ticket.audit.push({ id: `ta_${randomUUID()}`, at: iso(now), actor: actorId, action: 'status_changed', from: previous, to: ticket.status });
  if (payload.assignee !== undefined) ticket.audit.push({ id: `ta_${randomUUID()}`, at: iso(now), actor: actorId, action: 'assigned', note: ticket.assignee || 'unassigned' });
  if (payload.body !== undefined) ticket.audit.push({ id: `ta_${randomUUID()}`, at: iso(now), actor: actorId, action: 'reply_added', note: payload.visibility });
  ticket.updatedAt = now; return ticket;
}
export function supportAnalytics(state, now = Date.now()) { const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [], count = key => tickets.reduce((o, x) => { const v = x[key] || 'unknown'; o[v] = (o[v] || 0) + 1; return o; }, {}); return { total: tickets.length, open: tickets.filter(x => ['open', 'in_progress', 'waiting_user'].includes(x.status)).length, byStatus: count('status'), byCategory: count('category'), bySeverity: count('severity'), unassigned: tickets.filter(x => !x.assignee).length, withAttachments: tickets.filter(x => x.attachments?.length).length, attachmentBytesTotal: tickets.reduce((n, x) => n + (x.attachments || []).reduce((m, a) => m + a.size, 0), 0), createdLast24h: tickets.filter(x => x.createdAt >= now - 86400000).length, resolvedLast24h: tickets.filter(x => x.updatedAt >= now - 86400000 && ['resolved', 'closed'].includes(x.status)).length }; }
export const ticketLimits = { maxFile, maxFiles, maxTotal, attachmentTypes: [...attachmentTypes] };
