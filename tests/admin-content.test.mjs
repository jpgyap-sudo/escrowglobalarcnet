import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../src/universal-domain.mjs';
import { adminSnapshot, applyAdminCommand, ensureAdminState, exportRows } from '../src/admin.mjs';

const stateWithContent = () => { const state = createSeedState(1700000000000); ensureAdminState(state, 1700000000000); return state; };

test('admin state seeds the existing website routes and tracked media additively', () => {
  const state = stateWithContent();
  assert.deepEqual(state.pages.map(page => page.path), ['/', '/about', '/disclaimer', '/support', '/blog']);
  assert.ok(state.pages.find(page => page.path === '/about').sections.some(section => section.type === 'hero'));
  assert.ok(state.media.find(item => item.path === '/images/escrow-global/hero-global-settlement.webp'));
  const existing = structuredClone(state); existing.pages.push({ id: 'custom', path: '/custom', title: 'Custom' });
  ensureAdminState(existing, 1700000001000);
  assert.ok(existing.pages.some(page => page.id === 'custom'));
});

test('page commands validate structured blocks, audit changes and preserve custom content during sync', () => {
  let state = stateWithContent();
  const about = state.pages.find(page => page.path === '/about');
  let out = applyAdminCommand(state, 'reviewer', 'save_page', { id: about.id, fields: { title: 'About, edited', sections: about.sections, status: 'published' } }, 1700000001000);
  state = out.state;
  assert.equal(state.pages.find(page => page.id === about.id).title, 'About, edited');
  out = applyAdminCommand(state, 'reviewer', 'sync_pages', {}, 1700000002000);
  assert.equal(out.state.pages.find(page => page.id === about.id).title, 'About, edited');
  assert.equal(out.state.audit.at(-1).type, 'admin.sync_pages');
  assert.throws(() => applyAdminCommand(state, 'reviewer', 'save_page', { id: about.id, fields: { sections: [{ type: 'script', data: {} }] } }), /Unsupported section type/);
});

test('media deletion is blocked while a page references the asset, and content is exposed to snapshot/export', () => {
  const state = stateWithContent();
  assert.throws(() => applyAdminCommand(state, 'reviewer', 'delete_media', { id: 'media_hero_global_settlement' }), /still used/);
  const snapshot = adminSnapshot(state);
  assert.equal(snapshot.pages.length, 5);
  assert.equal(snapshot.media.length, 5);
  assert.equal(exportRows(state, 'pages').length, 5);
  assert.equal(exportRows(state, 'media').length, 5);
});

test('metadata-only media records support local asset paths and duplicate paths are rejected', () => {
  let state = stateWithContent();
  const out = applyAdminCommand(state, 'reviewer', 'save_media', { fields: { path: '/images/custom-card.webp', title: 'Custom card', filename: 'custom-card.webp', kind: 'image', mime: 'image/webp', tags: ['card'] } }, 1700000003000);
  assert.equal(out.state.media.at(-1).title, 'Custom card');
  assert.throws(() => applyAdminCommand(out.state, 'reviewer', 'save_media', { fields: { path: '/images/custom-card.webp', title: 'Duplicate' } }), /already uses this path/);
});
