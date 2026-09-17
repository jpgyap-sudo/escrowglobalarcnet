#!/usr/bin/env node
// scripts/build-engagement-release.mjs
// Node 22 ES module. No npm dependencies. Uses only node: builtins + git CLI.
//
// Builds a deployment artifact for the engagement release.
// - Reads source blobs from a git ref (default HEAD), never the dirty worktree.
// - Reads the static baseline HTML from a pinned static ref (default escrow baseline).
// - Writes a fresh staging directory (must not exist, must be outside the repo).
// - Injects visitor-tools link/script tags into the static HTML.
// - Emits manifest.json with sha256 + byte counts for every emitted file.
//
// Usage:
//   node scripts/build-engagement-release.mjs --out /abs/path/to/new-staging [--ref HEAD] [--static-ref <sha>]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep, posix, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- constants ----------

const DEFAULT_STATIC_REF = '6fcf7b6b4e09338f65d2fae76504e40fcd5cef93';
const STATIC_BASELINE_SHA256 = '169b0c977cdf85181de1fe626fa30a32c6e3478124043ab22acbf1cc0288fe99';
const STATIC_HTML_NAME = 'escrow-global-preview.html';
const VISITOR_TOOLS_MJS = 'visitor-tools.mjs';
const VISITOR_TOOLS_CSS = 'visitor-tools.css';
const ANALYTICS_ENDPOINT = 'https://www.escrowglobal.io:9443/api/analytics/event';

// Files that must exist at the source ref (app tree).
const REQUIRED_APP_FILES = [
  'server.mjs',
  'package.json',
  'public/admin.html',
  'public/admin.mjs',
  'public/admin.css',
  'public/brand-tokens.css',
  'public/favicon.svg',
  'public/blog.html',
  'public/blog.mjs',
  'public/blog.css',
];

// Both visitor-tools assets are required for a complete release.
const VISITOR_TOOLS = [VISITOR_TOOLS_MJS, VISITOR_TOOLS_CSS];

// Paths that must never be emitted.
const EXCLUDED_PREFIXES = [
  '.env',
  'data/',
  'memory/',
  '.git/',
  'docs/',
  'packages/',
  'binary/',
  'tests/',
  'node_modules/',
];

// ---------- helpers ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root = parent of scripts/
const REPO_ROOT = resolve(__dirname, '..');

function fail(msg) {
  process.stderr.write(`build-engagement-release: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { out: null, ref: 'HEAD', staticRef: DEFAULT_STATIC_REF };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out.out = argv[++i]; }
    else if (a === '--ref') { out.ref = argv[++i]; }
    else if (a === '--static-ref') { out.staticRef = argv[++i]; }
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: build-engagement-release.mjs --out <abs-new-dir> [--ref HEAD] [--static-ref <sha>]\n');
      process.exit(0);
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  if (!out.out) fail('--out is required');
  if (!out.ref) fail('--ref must not be empty');
  if (!out.staticRef) fail('--static-ref must not be empty');
  return out;
}

// Run git with argument array, return stdout as Buffer. No shell.
function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

function gitText(args) {
  return git(args).toString('utf8').trim();
}

// Resolve a ref to a full commit sha.
function revParse(ref) {
  const sha = gitText(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sha)) fail(`ref ${ref} did not resolve to a commit sha`);
  return sha;
}

// Read a blob at a ref. Returns Buffer. Fails if path missing.
function readBlob(ref, path) {
  // git cat-file blob <ref>:<path>
  return git(['cat-file', 'blob', `${ref}:${path}`]);
}

// Return mode (as string) for a path at a ref, or null if missing.
function modeAtRef(ref, path) {
  // git ls-tree <ref> -- <path>  -> "100644 blob <sha>\t<path>"
  let out;
  try {
    out = gitText(['ls-tree', ref, '--', path]);
  } catch {
    return null;
  }
  if (!out) return null;
  const line = out.split('\n')[0];
  const m = line.match(/^(\d{6})\s+(\w+)\s+([0-9a-f]+)\t/);
  if (!m) return null;
  return { mode: m[1], type: m[2], sha: m[3] };
}

// List all tracked files under a prefix at a ref. Returns array of {path, mode}.
function listTracked(ref, prefix) {
  // -r recursive, --name-only would drop mode; use ls-tree -r
  const out = gitText(['ls-tree', '-r', ref, '--', prefix]);
  if (!out) return [];
  const rows = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d{6})\s+(\w+)\s+([0-9a-f]+)\t(.+)$/);
    if (!m) continue;
    rows.push({ mode: m[1], type: m[2], sha: m[3], path: m[4] });
  }
  return rows;
}

// Reject unsafe paths: absolute, traversal, backslashes, control chars, empty segments.
function assertSafeRelPath(p) {
  if (typeof p !== 'string' || p.length === 0) fail(`unsafe path: ${JSON.stringify(p)}`);
  if (p.startsWith('/')) fail(`unsafe absolute path: ${p}`);
  if (p.includes('\\')) fail(`unsafe backslash path: ${p}`);
  if (p.includes(':')) fail(`unsafe colon path: ${p}`);
  if (/[\x00-\x1f]/.test(p)) fail(`unsafe control char in path: ${p}`);
  const parts = p.split('/');
  for (const seg of parts) {
    if (seg === '' || seg === '.' || seg === '..') fail(`unsafe path segment in: ${p}`);
  }
  // Normalize check: posix.normalize must equal input.
  if (posix.normalize(p) !== p) fail(`non-normalized path: ${p}`);
}

function isExcluded(p) {
  for (const pre of EXCLUDED_PREFIXES) {
    if (p === pre.replace(/\/$/, '')) return true;
    if (p.startsWith(pre)) return true;
  }
  return false;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

// ---------- main ----------

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve output dir; must be absolute, must not exist, must be outside repo.
  if (!isAbsolute(args.out)) fail('--out must be an absolute path');
  const outDir = resolve(args.out);
  if (existsSync(outDir)) fail(`--out already exists: ${outDir}`);
  // Must not be inside repo. Compare realpath of repo root against outDir prefix.
  const repoReal = realpathSync(REPO_ROOT);
  // outDir may not exist yet, so realpath its parent.
  const parentReal = realpathSync(dirname(outDir));
  const outReal = join(parentReal, outDir.slice(dirname(outDir).length + 1));
  const comparison = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (comparison(outReal) === comparison(repoReal) || comparison(outReal).startsWith(comparison(repoReal + sep))) {
    fail(`--out must not be inside the repository: ${outDir}`);
  }

  // Resolve refs.
  const commit = revParse(args.ref);
  const staticCommit = revParse(args.staticRef);

  // If using default static ref, verify the baseline sha constant.
  if (args.staticRef === DEFAULT_STATIC_REF) {
    const baselineBlob = readBlob(staticCommit, STATIC_HTML_NAME);
    const got = sha256(baselineBlob);
    if (got !== STATIC_BASELINE_SHA256) {
      fail(`static baseline sha mismatch: expected ${STATIC_BASELINE_SHA256}, got ${got}`);
    }
  }

  // ---------- collect app files ----------

  // Required app files must exist at ref, be regular blobs (100644/100755), not symlinks.
  const appFiles = []; // {srcPath, outPath, buf}
  const seen = new Set();

  function addAppFile(srcPath, outPath) {
    if (seen.has(outPath)) return;
    seen.add(outPath);
    assertSafeRelPath(srcPath);
    assertSafeRelPath(outPath);
    if (isExcluded(srcPath)) fail(`excluded path requested: ${srcPath}`);
    const info = modeAtRef(commit, srcPath);
    if (!info) fail(`required file missing at ref ${commit}: ${srcPath}`);
    if (info.mode === '120000') fail(`symlink not allowed: ${srcPath}`);
    if (info.mode !== '100644' && info.mode !== '100755') {
      fail(`unsupported mode ${info.mode} for ${srcPath}`);
    }
    const buf = readBlob(commit, srcPath);
    appFiles.push({ srcPath, outPath, buf });
  }

  for (const p of REQUIRED_APP_FILES) {
    addAppFile(p, p);
  }

  // All tracked src/**/*.mjs at ref.
  const srcRows = listTracked(commit, 'src');
  for (const row of srcRows) {
    if (!row.path.endsWith('.mjs')) continue;
    if (row.mode === '120000') fail(`symlink not allowed: ${row.path}`);
    if (row.mode !== '100644' && row.mode !== '100755') {
      fail(`unsupported mode ${row.mode} for ${row.path}`);
    }
    if (isExcluded(row.path)) continue;
    addAppFile(row.path, row.path);
  }

  // Required visitor-tools files.
  const visitorToolsPresent = {};
  for (const name of VISITOR_TOOLS) {
    const info = modeAtRef(commit, `public/${name}`);
    if (info) {
      if (info.mode === '120000') fail(`symlink not allowed: ${name}`);
      if (info.mode !== '100644' && info.mode !== '100755') {
        fail(`unsupported mode ${info.mode} for ${name}`);
      }
      visitorToolsPresent[name] = true;
      addAppFile(`public/${name}`, `public/${name}`);
    } else {
      fail(`required visitor tool missing at ${commit}: public/${name}`);
    }
  }

  // ---------- static HTML ----------

  const staticInfo = modeAtRef(staticCommit, STATIC_HTML_NAME);
  if (!staticInfo) fail(`static html missing at ref ${staticCommit}: ${STATIC_HTML_NAME}`);
  if (staticInfo.mode === '120000') fail(`symlink not allowed: ${STATIC_HTML_NAME}`);
  const staticHtmlBuf = readBlob(staticCommit, STATIC_HTML_NAME);
  let staticHtml = staticHtmlBuf.toString('utf8');

  // Inject visitor-tools tags. Fail if already injected (avoid double).
  const linkTag = '<link rel="stylesheet" href="/visitor-tools.css">';
  const scriptTag = `<script type="module" src="/visitor-tools.mjs" data-escrow-engagement data-analytics-endpoint='${ANALYTICS_ENDPOINT}'></script>`;

  if (staticHtml.includes('data-escrow-engagement') || staticHtml.includes('/visitor-tools.mjs') || staticHtml.includes('/visitor-tools.css')) {
    fail('static html already contains visitor-tools injection; refusing to double-inject');
  }

  const headCloseIdx = staticHtml.lastIndexOf('</head>');
  if (headCloseIdx === -1) fail('static html missing </head>');
  const bodyCloseIdx = staticHtml.lastIndexOf('</body>');
  if (bodyCloseIdx === -1) fail('static html missing </body>');

  // Insert link before </head>.
  staticHtml = staticHtml.slice(0, headCloseIdx) + linkTag + '\n' + staticHtml.slice(headCloseIdx);
  // Recompute body close index after insertion.
  const bodyCloseIdx2 = staticHtml.lastIndexOf('</body>');
  staticHtml = staticHtml.slice(0, bodyCloseIdx2) + scriptTag + '\n' + staticHtml.slice(bodyCloseIdx2);

  const staticHtmlOut = Buffer.from(staticHtml, 'utf8');

  // ---------- nginx ops files ----------

  const nginxFiles = []; // {srcPath, outPath, buf}
  const opsRows = listTracked(commit, 'ops/nginx');
  for (const name of ['escrow-engagement-http.conf', 'escrowglobal.io', 'admin.escrowglobal.io']) {
    if (!opsRows.some(row => row.path === `ops/nginx/${name}`)) fail(`required nginx config missing: ${name}`);
  }
  for (const row of opsRows) {
    if (row.mode === '120000') fail(`symlink not allowed: ${row.path}`);
    if (row.mode !== '100644' && row.mode !== '100755') {
      fail(`unsupported mode ${row.mode} for ${row.path}`);
    }
    if (isExcluded(row.path)) continue;
    const base = posix.basename(row.path);
    if (!base) continue;
    assertSafeRelPath(base);
    const buf = readBlob(commit, row.path);
    nginxFiles.push({ srcPath: row.path, outPath: base, buf });
  }

  // ---------- release package.json ----------

  // Read the committed package.json at ref for name/version/private/type.
  const pkgInfo = modeAtRef(commit, 'package.json');
  if (!pkgInfo) fail('package.json missing at ref');
  if (pkgInfo.mode === '120000') fail('package.json is a symlink');
  const pkgRaw = readBlob(commit, 'package.json').toString('utf8');
  let pkg;
  try { pkg = JSON.parse(pkgRaw); } catch (e) { fail(`package.json is not valid JSON: ${e.message}`); }

  const releasePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    engines: { node: '>=22.13.0' },
    scripts: { start: 'node server.mjs' },
  };
  // Only include name/version if present.
  if (releasePkg.name === undefined) delete releasePkg.name;
  if (releasePkg.version === undefined) delete releasePkg.version;
  const releasePkgBuf = Buffer.from(JSON.stringify(releasePkg, null, 2) + '\n', 'utf8');

  // ---------- write output ----------

  // Create output root exclusively; never overwrite an existing release.
  mkdirSync(outDir);
  ensureDir(join(outDir, 'app'));
  ensureDir(join(outDir, 'www'));
  ensureDir(join(outDir, 'nginx'));

  const manifestFiles = []; // {path, sha256, bytes}

  function writeOut(relPath, buf) {
    assertSafeRelPath(relPath);
    const abs = join(outDir, relPath);
    // Ensure parent dir exists.
    ensureDir(dirname(abs));
    writeFileSync(abs, buf);
    manifestFiles.push({ path: relPath, sha256: sha256(buf), bytes: buf.length });
  }

  // App files.
  for (const f of appFiles) {
    let output = f.buf;
    // The separately served journal is public too; preserve its committed page
    // while adding the same first-party chat and measurement assets.
    if (f.srcPath === 'public/blog.html') {
      const html = f.buf.toString('utf8');
      if (!html.includes('</head>') || !html.includes('</body>') || html.includes('data-escrow-engagement')) {
        fail('blog HTML cannot be safely instrumented');
      }
      output = Buffer.from(html.replace('</head>', `${linkTag}\n</head>`).replace('</body>', `${scriptTag}\n</body>`));
    }
    writeOut(posix.join('app', f.outPath), output);
  }

  // Override app/package.json with the minimal release package.
  // (If package.json was already written from ref, overwrite it.)
  // Remove any prior manifest entry for app/package.json to avoid duplicates.
  for (let i = manifestFiles.length - 1; i >= 0; i--) {
    if (manifestFiles[i].path === 'app/package.json') manifestFiles.splice(i, 1);
  }
  writeOut('app/package.json', releasePkgBuf);

  // Static HTML -> www/index.html
  writeOut('www/index.html', staticHtmlOut);

  // Visitor-tools files -> www/.
  for (const name of VISITOR_TOOLS) {
    if (!visitorToolsPresent[name]) continue;
    const buf = readBlob(commit, `public/${name}`);
    writeOut(posix.join('www', name), buf);
  }

  // www favicon if relevant (copy from app/public/favicon.svg if present).
  if (seen.has('public/favicon.svg')) {
    const buf = readBlob(commit, 'public/favicon.svg');
    writeOut('www/favicon.svg', buf);
  }

  // Nginx files.
  for (const f of nginxFiles) {
    writeOut(posix.join('nginx', f.outPath), f.buf);
  }
  const unitPath = 'ops/systemd/escrow-global-admin.service';
  const unit = modeAtRef(commit, unitPath);
  if (!unit || !['100644', '100755'].includes(unit.mode)) fail('required regular systemd unit missing');
  writeOut('systemd/escrow-global-admin.service', readBlob(commit, unitPath));

  // ---------- manifest ----------

  const manifest = {
    commit,
    staticCommit,
    builtAt: new Date().toISOString(),
    node: process.version,
    files: manifestFiles,
    staticBaselineSha256: sha256(staticHtmlBuf),
  };

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'manifest.json'), manifestBuf);

  // ---------- summary ----------

  const summary = {
    ok: true,
    out: outDir,
    commit,
    staticCommit,
    node: process.version,
    fileCount: manifestFiles.length,
    totalBytes: manifestFiles.reduce((a, f) => a + f.bytes, 0),
    staticBaselineSha256: manifest.staticBaselineSha256,
    visitorTools: {
      mjs: !!visitorToolsPresent[VISITOR_TOOLS_MJS],
      css: !!visitorToolsPresent[VISITOR_TOOLS_CSS],
    },
    nginxFileCount: nginxFiles.length,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main();
