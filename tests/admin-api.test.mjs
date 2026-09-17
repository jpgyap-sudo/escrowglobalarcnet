import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { scryptSync } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'admin-test-password';
const ADMIN_SALT = Buffer.from('escrow-global-test-salt');
const ADMIN_HASH = `scrypt$16384$8$1$${ADMIN_SALT.toString('base64')}$${scryptSync(ADMIN_PASSWORD, ADMIN_SALT, 32, { N: 16384, r: 8, p: 1 }).toString('base64')}`;

test('local admin API exposes analytics and sandbox-safe content controls', async () => {
  const port = await freePort(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pact-admin-')), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_FILE: path.join(temp, 'state.json'), ESCROW_MODE: 'sandbox', ADMIN_EMAIL, ADMIN_PASSWORD_HASH: ADMIN_HASH }, stdio: 'ignore' });
  let cookie = '', csrfToken = '';
  const headers = (admin = false) => ({ ...(cookie ? { cookie } : {}), ...(admin && csrfToken ? { 'x-csrf-token': csrfToken } : {}) });
  const get = route => fetch(url + route, { headers: headers(route.startsWith('/api/admin/') || route === '/api/custody/readiness') });
  const post = (route, data) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(route.startsWith('/api/admin/')) }, body: JSON.stringify(data) });
  try {
    let healthy = false, healthError;
    for (let i = 0; i < 400; i++) {
      try { if ((await get('/api/health')).ok) { healthy = true; break; } }
      catch (error) { healthError = error; }
      await delay(25);
    }
    assert.equal(healthy, true, `admin test server did not become ready: ${healthError?.message || 'health endpoint was not OK'}`);
    const login = await fetch(url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const setCookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie') || ''];
    cookie = setCookies.filter(Boolean).map(value => value.split(';', 1)[0]).join('; ');
    csrfToken = decodeURIComponent((cookie.match(/(?:^|; )eg_admin_csrf=([^;]+)/) || [])[1] || '');
    const overview = await (await get('/api/admin/overview?days=7')).json();
    assert.equal(overview.analytics.rangeDays, 7);
    assert.equal(overview.analytics.health.realFunds, false);
    assert.ok(overview.listings.length > 0);
    const readiness = await (await get('/api/custody/readiness')).json();
    assert.equal(readiness.mode, 'sandbox');
    assert.equal(readiness.realFunds, false);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.gates.find(gate => gate.id === 'program').ready, false);
    assert.equal(typeof readiness.localArtifact, 'boolean');
    assert.equal(typeof readiness.localArtifactFresh, 'boolean');
    assert.ok(readiness.blockers.includes('reconciliation'));
    assert.equal((await get('/admin')).status, 200);
    assert.equal((await get('/blog')).status, 200);

    const denied = await post('/api/admin/command', { actorId: 'buyer', command: 'update_settings', payload: { patch: { siteName: 'Nope' } } });
    assert.equal(denied.status, 403);

    const created = await (await post('/api/admin/command', { actorId: 'reviewer', command: 'save_blog', payload: {
      fields: { title: 'Safer escrow checklists', slug: 'safer-escrow-checklists', excerpt: 'A short checklist.', body: 'Confirm scope before funding.\n\nKeep evidence in the agreement.', tags: ['safety', 'escrow'], seo: { title: 'Safer escrow checklists | Escrow Global', description: 'A checklist for clearer sandbox agreements.' } }, publish: true
    } })).json();
    assert.ok(created.result.startsWith('blog_'));
    const publicPost = await (await get('/api/blog/safer-escrow-checklists')).json();
    assert.equal(publicPost.post.status, 'published');
    const html = await (await get('/blog/safer-escrow-checklists')).text();
    assert.match(html, /Safer escrow checklists \| Escrow Global/);
    assert.match(html, /Confirm scope before funding/);

    const duplicate = await post('/api/admin/command', { actorId: 'reviewer', command: 'save_blog', payload: { fields: { title: 'Duplicate', slug: 'safer-escrow-checklists', body: 'Another post' } } });
    assert.equal(duplicate.status, 400);

    const listingId = overview.listings[0].id;
    const moderated = await post('/api/admin/command', { actorId: 'reviewer', command: 'moderate_listing', payload: { listingId, decision: 'paused', reason: 'Temporarily paused for operator review.' } });
    assert.equal(moderated.status, 200);
    const settings = await post('/api/admin/command', { actorId: 'reviewer', command: 'update_settings', payload: { patch: { maintenanceMode: true, seo: { defaultTitle: 'Escrow Global Admin' } } } });
    assert.equal(settings.status, 200);
    const after = await (await get('/api/admin/overview')).json();
    assert.equal(after.settings.maintenanceMode, true);
    assert.equal(after.settings.seo.defaultTitle, 'Escrow Global Admin');
    assert.ok(after.audit.some(entry => entry.type === 'admin.save_blog'));
    const journal = await (await get('/api/admin/journal?limit=20')).json();
    assert.equal(journal.journal.valid, true);
    assert.ok(journal.journal.entries >= 3);
    assert.ok(journal.rows.some(entry => entry.kind === 'admin.command' && entry.command === 'save_blog'));
    const firstPage = await (await get('/api/admin/journal?limit=2')).json();
    assert.equal(firstPage.rows.length, 2);
    assert.equal(typeof firstPage.nextCursor, 'number');
    if (firstPage.hasMore) {
      const olderPage = await (await get(`/api/admin/journal?limit=2&before=${firstPage.nextCursor}`)).json();
      assert.ok(olderPage.rows.every(entry => entry.sequence < firstPage.nextCursor));
    }
    const reconciliation = await (await get('/api/admin/reconciliation')).json();
    assert.equal(reconciliation.inSync, true);
    assert.equal((await get('/api/admin/export?kind=blog&format=csv')).headers.get('content-type'), 'text/csv; charset=utf-8');
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
