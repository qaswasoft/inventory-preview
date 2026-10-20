// Step 3 (optional, after crawl.mjs): extract the seeded records into demo/data.js.
//
//   node tools/extract-data.mjs        (no app needed; reads tools/raw, writes demo/data.js)
//
// Products, customers, suppliers, payment accounts, warehouses, categories and member rewards are read from the
// Livewire snapshot (`wire:snapshot`) on each record's edit page. Invoices have no form, so they are read from the
// invoice list table. The result is `window.DEMO_DATA`, used by the demo's search, POS and forms.
// No npm packages. Needs Node 18+.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(here, 'raw', 'admin');
const OUT = path.join(here, '..', 'demo', 'data.js');

// output key -> folder under tools/raw/admin (each has <id>/edit/index.html)
const ENTITIES = {
  products: 'products',
  customers: 'customers',
  suppliers: 'suppliers',
  accounts: 'payment-accounts',
  warehouses: 'warehouses',
  categories: 'categories',
  rewards: 'member-rewards',
};

const read = async p => { try { return await fs.readFile(p, 'utf8'); } catch { return null; } };
const decode = s => s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = s => decode(s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const num = v => { const n = Number(v); return v === '' || v === null || v === undefined || Number.isNaN(n) ? 0 : n; };

function snapshots(html) {
  const out = [];
  for (const m of html.matchAll(/wire:snapshot="([^"]*)"/g)) {
    try { out.push(JSON.parse(decode(m[1]))); } catch { /* ignore */ }
  }
  return out;
}

/** Livewire wraps values as [value, {s: type}]; turn them back into plain JSON. */
function unwrap(v) {
  if (Array.isArray(v) && v.length === 2 && v[1] && typeof v[1] === 'object' && !Array.isArray(v[1]) && 's' in v[1]) return unwrap(v[0]);
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
}

function recordFrom(snap, id) {
  const rec = {id};
  for (const [key, raw] of Object.entries(snap.data || {})) {
    const isModel = Array.isArray(raw) && raw[1] && raw[1].s === 'mdl'; // the bound Eloquent model
    if (isModel || /^show[A-Z]/.test(key)) continue;                   // not record data
    rec[key] = unwrap(raw);
  }
  return rec;
}

const product = r => ({
  id: r.id, name: r.name, sku: r.sku, barcode: r.barcode || '', description: r.description || '',
  category_id: r.category_id, supplier_id: r.supplier_id, media_id: r.media_id,
  cost: num(r.cost_price), price: num(r.selling_price), tax_rate: num(r.tax_rate),
  discount: num(r.discount), discount_type: r.discount_type || 'fixed',
  stock: num(r.quantity), min_stock: num(r.min_stock_level),
  unit: r.unit || 'pcs', purchase_unit: r.purchase_unit || '', purchase_unit_factor: num(r.purchase_unit_factor) || 1,
  track_expiry: !!r.track_expiry, weight: r.weight || '', dimensions: r.dimensions || '', status: r.status || 'active',
});

async function loadEntity(folder) {
  let ids = [];
  try {
    ids = (await fs.readdir(path.join(RAW, folder), {withFileTypes: true}))
      .filter(d => d.isDirectory() && /^\d+$/.test(d.name)).map(d => Number(d.name)).sort((a, b) => a - b);
  } catch { /* folder missing */ }
  const rows = [];
  for (const id of ids) {
    const html = await read(path.join(RAW, folder, String(id), 'edit', 'index.html'));
    if (!html) continue;
    const snap = snapshots(html).find(s => /-form$/.test(s.memo?.name || ''));
    if (!snap) { console.warn(`  ! ${folder}/${id}: no form snapshot`); continue; }
    rows.push(recordFrom(snap, id));
  }
  return rows;
}

/** Invoices: no form, so read the list table. Columns: Invoice #, Customer, Items, Total, Due, Date, Status, Actions. */
function parseInvoices(html) {
  const tbody = /<tbody[\s\S]*?<\/tbody>/.exec(html)?.[0] || '';
  const money = s => Number(s.replace(/[^\d.]/g, '')) || 0;
  const symbol = s => (/[^\d\s.,-]/.exec(s) || [''])[0];
  const out = [];
  let currency = '';
  for (const row of tbody.matchAll(/<tr[^>]*data-flux-row[^>]*>([\s\S]*?)<\/tr>/g)) {
    const id = Number(/\/invoices\/(\d+)/.exec(row[1])?.[1]);
    const c = [...row[1].matchAll(/<td[\s\S]*?<\/td>/g)].map(m => text(m[0]));
    if (!id || c.length < 7) continue;
    const number = /INV-\d{4}-\d+/.exec(c[0])?.[0] || '';
    const phone = /\s(\+?\d[\d\s-]{6,})$/.exec(c[1])?.[1] || '';
    const date = new Date(c[5] + ' UTC');
    currency = currency || symbol(c[3]);
    out.push({
      id, number, created_by: c[0].replace(number, '').trim(),
      customer: phone ? c[1].slice(0, c[1].length - phone.length).trim() : c[1], customer_phone: phone,
      items: Number(c[2]) || 0, total: money(c[3]), due: /paid/i.test(c[4]) ? 0 : money(c[4]),
      date: Number.isNaN(date.getTime()) ? c[5] : date.toISOString().slice(0, 10),
      status: c[6], editable: /edit/i.test(c[7] || ''),
    });
  }
  return {invoices: out, currency};
}

async function main() {
  try { await fs.access(RAW); } catch { throw new Error('tools/raw/admin not found. Run "node tools/crawl.mjs" first.'); }

  const data = {};
  for (const [key, folder] of Object.entries(ENTITIES)) {
    data[key] = await loadEntity(folder);
    console.log(`${key.padEnd(11)} ${data[key].length}`);
  }
  data.products = data.products.map(product);

  const invoiceHtml = await read(path.join(RAW, 'invoices', 'index.html'));
  const inv = invoiceHtml ? parseInvoices(invoiceHtml) : {invoices: [], currency: ''};
  data.invoices = inv.invoices;
  console.log(`${'invoices'.padEnd(11)} ${data.invoices.length}`);

  data.meta = {currency: inv.currency || '$', generatedAt: new Date().toISOString().slice(0, 10)};

  const banner = '/* Generated by tools/extract-data.mjs from the seeded app. Do not edit by hand; re-run the script instead. */\n';
  await fs.mkdir(path.dirname(OUT), {recursive: true});
  await fs.writeFile(OUT, banner + 'window.DEMO_DATA = ' + JSON.stringify(data, null, 1) + ';\n');
  console.log(`\nWrote ${path.relative(process.cwd(), OUT) || OUT}`);
  console.log('Next: node tools/build.mjs (it injects demo/data.js automatically).');
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
