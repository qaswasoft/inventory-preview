// Step 2 of 2: turn tools/raw (saved by crawl.mjs) into the final static site in the repo root.
//
//   node tools/build.mjs        (no Laravel needed - can be re-run any time)
//
// Writes  <role>/<path>/index.html  for guest, admin, manager, staff,  build/  (compiled CSS, fonts, JS)
// and  flux/flux.js.  index.html and demo/ (landing page + interactivity) are hand-written and never touched.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const RAW = path.join(here, 'raw');
const ALPINE = '3.14.9';
const PRODUCT = 'Inventory'; // product name shown in tab titles and the mobile header (the app's APP_NAME)

const exists = async p => { try { await fs.access(p); return true; } catch { return false; } };
// Alpine: use demo/vendor/* when present (offline, no CDN), otherwise fall back to jsDelivr.
const alpineSrc = (toRoot, ctx, pkg, local) => ctx.vendor ? `${toRoot}demo/vendor/${local}.min.js` : `https://cdn.jsdelivr.net/npm/${pkg}@${ALPINE}/dist/cdn.min.js`;
const fileFor = (base, role, p) => path.join(base, role, ...(p === '/' ? [] : p.split('/').filter(Boolean)), 'index.html');

function transform(html, role, p, saved, ctx) {
  const depth = p === '/' ? 0 : p.split('/').filter(Boolean).length;
  const toRole = depth ? '../'.repeat(depth) : './', toRoot = '../'.repeat(depth + 1);
  const base = ctx.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let missing = 0;
  html = html
    // Product name: tab titles end in APP_NAME, so pages crawled with Laravel's default (or the old name) get it here.
    .replace(/(<title>[\s\S]*?)\bLaravel(\s*<\/title>)/i, '$1' + PRODUCT + '$2')
    .replace(/Swift Inventory/g, PRODUCT)
    // dev-server (Vite) tags -> built files
    // dev-only tooling (Laravel Boost browser logger) and the Vite dev client
    .replace(/<script[^>]*id="browser-logger-active"[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*@vite\/client[^>]*>\s*<\/script>/gi, '')
    .replace(/<(?:link|script)[^>]*resources\/css\/app\.css[^>]*>(?:\s*<\/script>)?/gi, `<link rel="stylesheet" href="${toRoot}build/${ctx.css}"><link rel="stylesheet" href="${toRoot}build/${ctx.fonts}">`)
    .replace(/<script[^>]*resources\/js\/app\.js[^>]*>\s*<\/script>/gi, `<script type="module" src="${toRoot}build/${ctx.js}"></script>`)
    .replace(/<link[^>]*rel="preload"[^>]*(?:5173|__laravel_vite_plugin__)[^>]*>\s*/gi, '')
    .replace(/@font-face\s*\{[^}]*__laravel_vite_plugin__[^}]*\}\s*/g, '')
    // Livewire cannot run without a server
    .replace(/<script[^>]*livewire[^>]*>\s*<\/script>/gi, '')
    .replace(/<script>\s*window\.livewireScriptConfig[\s\S]*?<\/script>/gi, '')
    // Flux needs Alpine (normally bundled with Livewire)
    // demo/wire.js (the $wire stand-in) must come BEFORE Alpine so its magic is registered in time.
    .replace(/<script[^>]*\/flux\/flux[^>]*>\s*<\/script>/gi, () =>
      (ctx.demoFiles.includes('wire.js') ? `<script defer src="${toRoot}demo/wire.js"></script>` : '') +
      ['persist', 'focus', 'collapse', 'anchor'].map(n => `<script defer src="${alpineSrc(toRoot, ctx, '@alpinejs/' + n, 'alpine-' + n)}"></script>`).join('') +
      `<script src="${toRoot}flux/flux.js"></script><script defer src="${alpineSrc(toRoot, ctx, 'alpinejs', 'alpine')}"></script>`)
    .replace(/(href|src)="(?:[^"]*?)\/build\/(assets\/[^"]*)"/g, `$1="${toRoot}build/$2"`)
    .replace(new RegExp(`(href|src)="(?:${base})?/(favicon[^"]*|apple-touch-icon[^"]*)"`, 'g'), `$1="${toRoot}$2"`)
    // page links -> relative links to the saved pages
    .replace(new RegExp(`(href|action)="(?:${base})?(/[^"#?]*)(?:\\?[^"#]*)?(#[^"]*)?"`, 'g'), (all, attr, pth, hash) => {
      const q = pth.replace(/\/$/, '') || '/';
      if (q === '/logout') return `${attr}="#logout"`;
      if (attr === 'action') return `${attr}="#"`;
      if (saved.has(q)) return `${attr}="${toRole}${q === '/' ? '' : q.slice(1) + '/'}index.html${hash || ''}"`;
      missing++;
      return `${attr}="#"`;
    });
  const head = `<link rel="stylesheet" href="${toRoot}demo/demo.css">`;
  // Optional demo modules (added by later tasks); each one is injected only if the file exists.
  const extra = ['data.js', 'store.js', 'receipt.js', 'search.js', 'lists.js', 'pos.js', 'forms.js'].filter(f => ctx.demoFiles.includes(f)).map(f => `<script defer src="${toRoot}demo/${f}"></script>`).join('');
  const tail = extra + `<script defer src="${toRoot}demo/demo.js" data-role="${role}" data-path="${p}" data-root="${toRoot}"></script>`;
  html = html.includes('</head>') ? html.replace('</head>', head + '</head>') : head + html;
  html = html.includes('</body>') ? html.replace('</body>', tail + '</body>') : html + tail;
  return {html, missing};
}

// A role with no open shift was crawled on the "Open your shift" screen, so its POS page has no terminal at all.
// Copy the terminal (shift bar + order + summary) from the admin POS, which has a shift open, into the page,
// hidden; demo/pos.js shows it when the cashier opens a shift, as the app does.
async function withTerminal(raw) {
  const OPEN = '<div class="mx-auto mt-10 max-w-md">', END = '<!--[if ENDBLOCK]><![endif]-->';
  if (!raw.includes(OPEN)) return raw;
  const admin = await fs.readFile(fileFor(RAW, 'admin', '/pos'), 'utf8').catch(() => '');
  const modal = s => s.lastIndexOf('<ui-modal', s.indexOf('wire:model.self="showPaymentModal"'));
  const from = admin.indexOf('<div class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border'), to = admin.lastIndexOf(END, modal(admin));
  if (from < 0 || to < from) { console.warn('WARNING: no POS terminal in tools/raw/admin/pos to copy; non-admin POS stays on "Open your shift".'); return raw; }
  const at = raw.lastIndexOf(END, modal(raw));
  return raw.slice(0, at).replace(OPEN, '<div class="mx-auto mt-10 max-w-md" data-demo-openshift>') +
    '<div data-demo-terminal style="display:none">' + admin.slice(from, to) + '</div>' + raw.slice(at);
}

async function main() {
  if (!(await exists(path.join(RAW, 'manifest.json')))) throw new Error('tools/raw/manifest.json not found. Run "node tools/crawl.mjs" first.');
  const manifest = JSON.parse(await fs.readFile(path.join(RAW, 'manifest.json'), 'utf8'));
  const buildSrc = path.join(RAW, '_assets', 'build');
  const vite = JSON.parse(await fs.readFile(path.join(buildSrc, 'manifest.json'), 'utf8'));
  const ctx = {
    base: manifest.base,
    css: vite['resources/css/app.css'].file,
    js: vite['resources/js/app.js'].file,
    fonts: (Object.values(vite).find(e => /^assets\/fonts-.*\.css$/.test(e.file)) || {}).file || '',
  };
  if (!ctx.fonts) console.warn('WARNING: no fonts-*.css found in the Vite manifest; text will fall back to system fonts.');
  ctx.vendor = await exists(path.join(ROOT, 'demo', 'vendor', 'alpine.min.js'));
  ctx.demoFiles = (await fs.readdir(path.join(ROOT, 'demo'))).filter(f => f.endsWith('.js'));
  console.log(ctx.vendor ? 'Alpine: using demo/vendor (offline).' : 'WARNING: demo/vendor/alpine.min.js not found, so Alpine loads from the jsDelivr CDN (see HANDOFF.md, T0).');
  console.log('Demo scripts found: ' + ctx.demoFiles.join(', '));

  for (const d of ['admin', 'manager', 'staff', 'guest', 'build', 'flux']) await fs.rm(path.join(ROOT, d), {recursive: true, force: true});

  // compiled assets (make font URLs relative so they work under a GitHub Pages sub-path)
  await fs.cp(buildSrc, path.join(ROOT, 'build'), {recursive: true});
  const assets = path.join(ROOT, 'build', 'assets');
  for (const f of await fs.readdir(assets)) {
    if (!f.endsWith('.css')) continue;
    const css = await fs.readFile(path.join(assets, f), 'utf8');
    await fs.writeFile(path.join(assets, f), css.replace(/url\((["']?)\/build\/assets\//g, 'url($1./'));
  }
  if (await exists(path.join(RAW, '_assets', 'flux.js'))) {
    await fs.mkdir(path.join(ROOT, 'flux'), {recursive: true});
    await fs.copyFile(path.join(RAW, '_assets', 'flux.js'), path.join(ROOT, 'flux', 'flux.js'));
  } else console.warn('WARNING: tools/raw/_assets/flux.js missing - dropdowns and dialogs will not work.');
  for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    if (await exists(path.join(RAW, '_assets', f))) await fs.copyFile(path.join(RAW, '_assets', f), path.join(ROOT, f));
  }

  const report = {};
  for (const [role, info] of Object.entries(manifest.roles)) {
    if (!info.pages) continue;
    const saved = new Set(info.pages);
    let n = 0, missing = 0;
    for (const p of saved) {
      let raw = await fs.readFile(fileFor(RAW, role, p), 'utf8');
      if (p === '/pos') raw = await withTerminal(raw);
      const out = transform(raw, role, p, saved, ctx);
      const f = fileFor(ROOT, role, p);
      await fs.mkdir(path.dirname(f), {recursive: true});
      await fs.writeFile(f, out.html);
      n++; missing += out.missing;
    }
    report[role] = {pages: n, linksToUnsavedPages: missing};
  }
  await fs.writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify({roles: Object.fromEntries(Object.entries(manifest.roles).map(([r, i]) => [r, i.pages || []]))}, null, 1));
  console.table(report);
  console.log('Done. Open index.html in a browser (or push to GitHub and enable Pages).');
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
