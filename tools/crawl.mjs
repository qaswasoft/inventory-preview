// Step 1 of 2: save the RAW server-rendered pages of the running Laravel app.
//
//   cd inventory-management-demo
//   node tools/crawl.mjs        (app must be running: php artisan serve / composer run dev)
//   node tools/build.mjs        (turns tools/raw into the final static site; no app needed)
//
// Logs in as each seeded role (admin / manager / staff), follows every same-site link and every
// GET route from `php artisan route:list` (route parameters are filled with 1), and stores each
// HTML page untouched in tools/raw/<role>/<path>/index.html.
//
// Optional env vars: BASE (default http://127.0.0.1:8000), PROJECT (path to the Laravel project),
//                    PASSWORD (default "password"), MAX (max pages per role, default 500)
// Needs Node 18+. No npm packages.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(here, process.env.PROJECT || '../../inventory-management');
const OUT = path.join(here, 'raw');
const PASSWORD = process.env.PASSWORD || 'password';
const MAX = Number(process.env.MAX || 500);
const USERS = {admin: 'admin@inventory.com', manager: 'manager@inventory.com', staff: 'staff@inventory.com'};
const SKIP = /^\/(logout|build|flux|livewire|storage|up|sanctum|api)(\/|$)|\.(png|jpe?g|gif|svg|ico|css|js|pdf|webp|woff2?)$/i;
const ORIGIN = new URL(BASE).origin;

class Jar {
  c = {};
  set(res) {
    for (const s of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const kv = s.split(';')[0], i = kv.indexOf('=');
      this.c[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
  }
  get() { return Object.entries(this.c).map(([k, v]) => k + '=' + v).join('; '); }
}

async function req(jar, url, opt = {}) {
  let u = url, r;
  for (let n = 0; n < 8; n++) {
    r = await fetch(u, {redirect: 'manual', ...opt, headers: {cookie: jar.get(), 'user-agent': 'Mozilla/5.0 (demo crawler)', accept: 'text/html,*/*', ...(opt.headers || {})}});
    jar.set(r);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).href; opt = {method: 'GET'}; continue; }
    break;
  }
  return {r, url: u};
}

async function login(jar, email) {
  const {r} = await req(jar, BASE + '/login');
  const token = /name="_token"\s+value="([^"]+)"/.exec(await r.text())?.[1];
  if (!token) throw new Error('Could not find the CSRF token on /login. Is the app running at ' + BASE + '?');
  const {url} = await req(jar, BASE + '/login', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({_token: token, email, password: PASSWORD, remember: 'on'}).toString(),
  });
  if (/\/login\/?$/.test(new URL(url).pathname)) throw new Error('Login failed for ' + email + ' (check the password / seeders).');
}

function routeSeeds() {
  try {
    const out = execFileSync('php', ['artisan', 'route:list', '--json', '--method=GET'], {cwd: PROJECT, encoding: 'utf8', maxBuffer: 50e6, stdio: ['ignore', 'pipe', 'ignore']});
    const rows = JSON.parse(out.slice(out.indexOf('[')));
    const seeds = rows.map(r => '/' + String(r.uri).replace(/^\//, ''))
      .filter(u => !/^\/(api|sanctum|livewire|storage|flux|up|_)/.test(u) && !/logout/.test(u))
      .map(u => u.replace(/\/\{[^}]+\?\}/g, '').replace(/\{[^}]+\}/g, '1').replace(/\/$/, '') || '/');
    return [...new Set(seeds)];
  } catch (e) {
    console.warn('(php artisan route:list unavailable - relying on link following only)');
    return [];
  }
}

const fileFor = (role, p) => path.join(OUT, role, ...(p === '/' ? [] : p.split('/').filter(Boolean)), 'index.html');

async function crawl(role, email, seeds) {
  const jar = new Jar(), pages = {}, skipped = [];
  if (email) await login(jar, email);
  const queue = email ? ['/dashboard', ...seeds] : ['/login', '/register', '/forgot-password'], seen = new Set();
  while (queue.length && Object.keys(pages).length < MAX) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    let res;
    try { res = await req(jar, BASE + p); } catch (e) { skipped.push(`${p} (${e.message})`); continue; }
    const {r, url} = res, finalPath = new URL(url).pathname.replace(/\/$/, '') || '/', ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/html')) { skipped.push(`${p} -> ${ct || r.status}`); continue; }
    const html = await r.text();
    seen.add(finalPath);
    if (r.status !== 200) { skipped.push(`${p} -> HTTP ${r.status}`); continue; }
    if (email && /^\/(login|register|forgot-password)$/.test(finalPath)) { skipped.push(`${p} -> redirected to ${finalPath}`); continue; }
    if (pages[finalPath]) continue;
    pages[finalPath] = 200;
    const f = fileFor(role, finalPath);
    await fs.mkdir(path.dirname(f), {recursive: true});
    await fs.writeFile(f, html);
    console.log(`[${role}] ${finalPath}${finalPath !== p ? '  (from ' + p + ')' : ''}`);
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      let h;
      try { h = new URL(m[1].replace(/&amp;/g, '&'), url); } catch { continue; }
      const q = h.pathname.replace(/\/$/, '') || '/';
      if (h.origin === ORIGIN && !SKIP.test(q) && !seen.has(q)) queue.push(q);
    }
    await new Promise(ok => setTimeout(ok, 30));
  }
  return {pages, skipped};
}

async function main() {
  const buildDir = path.join(PROJECT, 'public', 'build');
  try { await fs.access(buildDir); } catch { throw new Error('Cannot find ' + buildDir + ' - set PROJECT=... or run "npm run build" in the Laravel project first.'); }
  await fs.rm(OUT, {recursive: true, force: true});
  await fs.mkdir(path.join(OUT, '_assets'), {recursive: true});
  const seeds = routeSeeds();
  console.log(`Seeds from route:list: ${seeds.length}`);
  const manifest = {base: BASE, roles: {}};
  for (const [role, email] of [['guest', null], ...Object.entries(USERS)]) {
    try {
      const {pages, skipped} = await crawl(role, email, seeds);
      manifest.roles[role] = {pages: Object.keys(pages), skipped};
      console.log(`[${role}] saved ${Object.keys(pages).length} pages, skipped ${skipped.length}`);
    } catch (e) { console.error(`[${role}] FAILED: ${e.message}`); manifest.roles[role] = {error: e.message}; }
  }
  // Flux's JavaScript (served by the app at /flux/flux.js) + the compiled assets
  try {
    const dash = await fs.readFile(fileFor('admin', '/dashboard'), 'utf8');
    const src = /src="([^"]*\/flux\/flux[^"]*\.js[^"]*)"/.exec(dash)?.[1];
    if (src) {
      const r = await fetch(new URL(src, BASE).href);
      await fs.writeFile(path.join(OUT, '_assets', 'flux.js'), Buffer.from(await r.arrayBuffer()));
      console.log('Saved flux.js');
    } else console.warn('Could not find the flux.js script tag in the admin dashboard.');
  } catch (e) { console.warn('Could not save flux.js: ' + e.message); }
  await fs.cp(buildDir, path.join(OUT, '_assets', 'build'), {recursive: true});
  for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    try { await fs.copyFile(path.join(PROJECT, 'public', f), path.join(OUT, '_assets', f)); } catch {}
  }
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nDone. Raw pages are in tools/raw. Next: node tools/build.mjs');
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
