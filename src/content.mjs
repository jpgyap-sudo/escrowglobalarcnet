/** Structured website content inventory and the small, safe public page renderer. */

const iso = now => new Date(now).toISOString();

export const TRACKED_PAGE_SEEDS = [
  { id: 'page_home', path: '/', slug: 'home', title: 'Escrow Global Settlement', template: 'landing', sourceFile: 'public/index.html',
    seo: { title: 'Escrow Global Settlement — Global deals. Clear settlement.', description: 'Global deals with clear scope, evidence and settlement.', canonical: '/', robots: 'noindex,nofollow' },
    sections: [{ id: 'home-hero', type: 'hero', data: { eyebrow: 'ESCROW GLOBAL SETTLEMENT · DEMO', heading: 'Global deals. Clear settlement.', body: 'Agree on products, services, or private agreements with clear scope, milestones and simulated settlement.', mediaId: 'media_hero_global_settlement', ctaLabel: 'Explore the sandbox', ctaHref: '/#/market' } }],
    syncNote: 'SPA shell: interactive content remains owned by public/app.mjs and public/universal-ui.mjs.' },
  { id: 'page_about', path: '/about', slug: 'about', title: 'About us', template: 'standard', sourceFile: 'public/about.html',
    seo: { title: 'About us · Escrow Global', description: 'Learn why Escrow Global makes agreements clearer before settlement.', canonical: '/about', robots: 'noindex,nofollow' },
    sections: [
      { id: 'about-hero', type: 'hero', data: { eyebrow: 'ABOUT ESCROW GLOBAL', heading: 'Blockchain should feel useful before it feels technical.', body: 'We are building a clearer way to agree on scope, evidence, milestones and settlement.', mediaId: 'media_hero_global_settlement' } },
      { id: 'about-purpose', type: 'rich_text', data: { eyebrow: 'OUR PURPOSE', heading: 'Make the agreement readable.', paragraphs: ['Escrow Global is an interactive sandbox for exploring how products, services and private agreements can become easier to understand.', 'The useful part is not the jargon. It is the shared record of what will be delivered, how it will be checked and what happens next.'] } },
      { id: 'about-practical', type: 'list', data: { eyebrow: 'WHAT WE PRACTICE', heading: 'Clarity at every handoff.', items: ['Write the scope before the money moves.', 'Keep milestones, evidence and acceptance criteria together.', 'Make recipients and resolution rules visible to both parties.'] } },
      { id: 'about-cta', type: 'cta', data: { eyebrow: 'THE NEXT STEP IS YOURS', heading: 'Find a use case. Learn the rails. Make a clearer agreement.', body: 'Explore the sandbox or ask a question when you need a human starting point.', ctaLabel: 'Explore the sandbox', ctaHref: '/#/explore' } }
    ] },
  { id: 'page_disclaimer', path: '/disclaimer', slug: 'disclaimer', title: 'Blockchain risk notice', template: 'legal', sourceFile: 'public/disclaimer.html',
    seo: { title: 'Blockchain risk notice · Escrow Global', description: 'Important blockchain, wallet and sandbox risk information.', canonical: '/disclaimer', robots: 'noindex,nofollow' },
    sections: [
      { id: 'disclaimer-hero', type: 'hero', data: { eyebrow: 'BLOCKCHAIN RISK NOTICE', heading: 'Blockchain gives you control. It also gives you responsibility.', body: 'Read this practical notice before using external wallet or blockchain tools.' } },
      { id: 'disclaimer-safety', type: 'list', data: { eyebrow: 'YOUR WALLET SAFETY PLAN', heading: 'Use a separate wallet for Escrow Global.', items: ['Verify the domain and HTTPS origin before connecting.', 'Review the network, mint, amount, recipient and permissions before signing.', 'Keep seed phrases and private keys offline. Support will never ask for them.', 'Pause on urgent messages, guaranteed returns, recovery offers or address changes.'] } },
      { id: 'disclaimer-boundary', type: 'rich_text', data: { eyebrow: 'CURRENT BUILD', heading: 'This Escrow Global build is a sandbox.', paragraphs: ['It does not currently custody live funds, operate a deployed escrow smart contract or provide real buyer protection. Demo balances and agreements are local simulations.', 'This notice is a practical risk disclosure, not legal, tax, investment or financial advice. Consider qualified advice for your circumstances and jurisdiction.'] } },
      { id: 'disclaimer-terms', type: 'rich_text', data: { eyebrow: 'ACCOUNT TERMS & CONDITIONS', heading: 'Your account does not remove blockchain risk.', paragraphs: ['When account creation becomes available, using an Escrow Global account will require acceptance of the account terms. Account registration is not a promise of custody, recovery, security, availability, financial return or buyer protection.', 'You remain responsible for reviewing every transaction, protecting credentials and recovery secrets, using a separate dedicated wallet and deciding whether a transaction or counterparty is appropriate for you.'] } }
    ] },
  { id: 'page_support', path: '/support', slug: 'support', title: 'Support', template: 'standard', sourceFile: 'public/support.html',
    seo: { title: 'Support · Escrow Global', description: 'Get help with a sandbox ticket, bug report or listing question.', canonical: '/support', robots: 'noindex,nofollow' },
    sections: [{ id: 'support-hero', type: 'hero', data: { eyebrow: 'HELP CENTER', heading: 'Tell us what went wrong.', body: 'The support form remains powered by public/support.mjs; edit its framing here when the form is migrated to blocks.' } }],
    syncNote: 'Functional support form stays on the existing source file until its fields are represented as a first-class block.' },
  { id: 'page_blog', path: '/blog', slug: 'blog', title: 'Journal', template: 'journal', sourceFile: 'public/blog.html',
    seo: { title: 'Journal · Escrow Global', description: 'Practical notes on scope, evidence, safety and settlement.', canonical: '/blog', robots: 'noindex,nofollow' },
    sections: [{ id: 'blog-hero', type: 'hero', data: { eyebrow: 'ESCROW GLOBAL JOURNAL', heading: 'Clearer deals start with better context.', body: 'Practical notes on scope, evidence, safety and settlement.' } }],
    syncNote: 'Blog posts remain API-backed records and are edited in the Blog tab.' }
];

export const TRACKED_MEDIA_SEEDS = [
  { id: 'media_hero_global_settlement', path: '/images/escrow-global/hero-global-settlement.webp', filename: 'hero-global-settlement.webp', kind: 'image', mime: 'image/webp', width: 1536, height: 1024, alt: 'Abstract globe and agreement milestones in navy and teal.', title: 'Hero — Global Settlement', tags: ['hero', 'marketing'], sourceFile: 'public/images/escrow-global/hero-global-settlement.webp' },
  { id: 'media_agreement_milestones', path: '/images/escrow-global/agreement-milestones.webp', filename: 'agreement-milestones.webp', kind: 'image', mime: 'image/webp', width: 1536, height: 1024, alt: 'Illustration of a milestone agreement workflow.', title: 'Agreement Milestones', tags: ['diagram', 'workflow'], sourceFile: 'public/images/escrow-global/agreement-milestones.webp' },
  { id: 'media_icon_192', path: '/icons/icon-192.png', filename: 'icon-192.png', kind: 'icon', mime: 'image/png', width: 192, height: 192, alt: 'Escrow Global app icon.', title: 'App Icon 192', tags: ['icon', 'app'], sourceFile: 'public/icons/icon-192.png' },
  { id: 'media_icon_512', path: '/icons/icon-512.png', filename: 'icon-512.png', kind: 'icon', mime: 'image/png', width: 512, height: 512, alt: 'Escrow Global app icon.', title: 'App Icon 512', tags: ['icon', 'app'], sourceFile: 'public/icons/icon-512.png' },
  { id: 'media_favicon', path: '/favicon.svg', filename: 'favicon.svg', kind: 'vector', mime: 'image/svg+xml', width: null, height: null, alt: 'Escrow Global mark.', title: 'Favicon', tags: ['icon', 'brand'], sourceFile: 'public/favicon.svg' }
];

function seeded(records, now) { return records.map(item => ({ ...structuredClone(item), lastSyncedAt: iso(now), updatedAt: iso(now) })); }

export function ensureContentState(state, now = Date.now()) {
  let changed = false;
  if (!Array.isArray(state.pages)) { state.pages = seeded(TRACKED_PAGE_SEEDS, now); changed = true; }
  if (!Array.isArray(state.media)) { state.media = seeded(TRACKED_MEDIA_SEEDS, now); changed = true; }
  return changed;
}

export function syncTrackedContent(state, now = Date.now()) {
  const at = iso(now);
  const pages = Array.isArray(state.pages) ? state.pages : [];
  const media = Array.isArray(state.media) ? state.media : [];
  for (const seed of TRACKED_PAGE_SEEDS) {
    const page = pages.find(item => item.id === seed.id || item.path === seed.path);
    if (!page) pages.push({ ...structuredClone(seed), lastSyncedAt: at, updatedAt: at });
    else { page.sourceFile = seed.sourceFile; page.syncNote = seed.syncNote; page.lastSyncedAt = at; }
  }
  for (const seed of TRACKED_MEDIA_SEEDS) {
    const item = media.find(entry => entry.id === seed.id || entry.path === seed.path);
    if (!item) media.push({ ...structuredClone(seed), lastSyncedAt: at, updatedAt: at });
    else { item.sourceFile = seed.sourceFile; item.lastSyncedAt = at; }
  }
  state.pages = pages; state.media = media;
  return { pages, media };
}

export function pageMediaUsage(state, media) {
  const matches = value => value === media.id || value === media.path;
  const contains = value => {
    if (matches(value)) return true;
    if (Array.isArray(value)) return value.some(contains);
    if (value && typeof value === 'object') return Object.values(value).some(contains);
    return false;
  };
  return (state.pages || []).filter(page => contains(page.seo) || contains(page.sections)).map(page => page.id);
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('#')) return /[\x00-\x1f\\]/.test(raw) ? '' : raw;
  if (raw.startsWith('//') || raw.includes('\\') || /[\x00-\x1f]/.test(raw)) return '';
  if (raw.startsWith('/')) return raw;
  return /^https:\/\/([a-z0-9-]+\.)*escrowglobal\.io(?:\/|$)/i.test(raw) ? raw : '';
}
function safeMediaPath(value) {
  const raw = String(value || '').trim();
  return /^\/[a-z0-9._/-]+$/i.test(raw) && !raw.includes('..') ? raw : '';
}
function text(value) { return String(value ?? ''); }
function renderSection(section, mediaById) {
  const data = section.data || {}, type = section.type;
  const eyebrow = data.eyebrow ? `<p class="eyebrow">${escapeHtml(data.eyebrow)}</p>` : '';
  if (type === 'hero') {
    const image = mediaById.get(data.mediaId);
    const imagePath = image && safeMediaPath(image.path);
    return `<section class="content-block content-hero"><div>${eyebrow}<h1>${escapeHtml(data.heading)}</h1><p>${escapeHtml(data.body)}</p>${data.ctaLabel && safeUrl(data.ctaHref) ? `<a class="content-button" href="${escapeAttr(safeUrl(data.ctaHref))}">${escapeHtml(data.ctaLabel)} <span aria-hidden="true">↗</span></a>` : ''}</div>${imagePath ? `<img src="${escapeAttr(imagePath)}" alt="${escapeAttr(data.alt || image.alt)}" loading="lazy">` : ''}</section>`;
  }
  if (type === 'rich_text') return `<section class="content-block content-rich">${eyebrow}<h2>${escapeHtml(data.heading)}</h2>${(data.paragraphs || []).map(item => `<p>${escapeHtml(item).replace(/\r?\n/g, '<br>')}</p>`).join('')}</section>`;
  if (type === 'list') return `<section class="content-block content-list">${eyebrow}<h2>${escapeHtml(data.heading)}</h2><ul>${(data.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
  if (type === 'image') { const image = mediaById.get(data.mediaId), imagePath = image && safeMediaPath(image.path); return imagePath ? `<figure class="content-block content-image"><img src="${escapeAttr(imagePath)}" alt="${escapeAttr(data.alt || image.alt)}" loading="lazy"><figcaption>${escapeHtml(data.caption)}</figcaption></figure>` : ''; }
  if (type === 'cta') return `<section class="content-block content-cta">${eyebrow}<h2>${escapeHtml(data.heading)}</h2><p>${escapeHtml(data.body)}</p>${data.ctaLabel && safeUrl(data.ctaHref) ? `<a class="content-button" href="${escapeAttr(safeUrl(data.ctaHref))}">${escapeHtml(data.ctaLabel)} <span aria-hidden="true">↗</span></a>` : ''}</section>`;
  return `<section class="content-block"><p>Unsupported content block: ${escapeHtml(type || 'unknown')}</p></section>`;
}
function escapeHtml(value) { return text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function escapeAttr(value) { return escapeHtml(value); }

export function renderManagedPage(page, settings = {}, media = []) {
  const seo = page.seo || {}, title = seo.title || page.title || settings.seo?.defaultTitle || settings.siteName || 'Escrow Global';
  const description = seo.description || settings.seo?.defaultDescription || '';
  const mediaById = new Map((media || []).map(item => [item.id, item]));
  const blocks = (page.sections || []).map(section => renderSection(section, mediaById)).join('');
  const canonical = safeUrl(seo.canonical || page.path);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeAttr(description)}"><meta name="robots" content="${escapeAttr(seo.robots || settings.seo?.robots || 'noindex,nofollow')}">${canonical ? `<link rel="canonical" href="${escapeAttr(canonical)}">` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/brand-tokens.css"><link rel="stylesheet" href="/content-page.css"></head><body><main class="managed-page"><a class="content-back" href="/">← ${escapeHtml(settings.siteName || 'Escrow Global')}</a>${blocks || `<section class="content-block"><h1>${escapeHtml(page.title)}</h1><p>This page has no editable sections yet.</p></section>`}<footer><a href="/about">About</a><a href="/support">Support</a><a href="/disclaimer">Risk notice</a></footer></main></body></html>`;
}
