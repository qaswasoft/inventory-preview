/* Swift Inventory demo - forms without a server.
 *
 * 1. Create / edit forms of customers, products, suppliers, categories, warehouses and payment accounts save to
 *    DemoDB (demo.js calls DemoForms.save on submit) and prefill from it, so the record shows up in its list, in
 *    the search dropdowns and on the POS. Records added in the demo have no page of their own; their list rows
 *    link to a seeded record's edit page with ?id=<id>, which is read here.
 * 2. The invoice and purchase forms get their line items (the Blade rows are server-rendered): add from the
 *    product search, edit qty / price / discount / tax, remove; the page's own Alpine totals read DemoWire.items.
 *    Save as draft / send / paid (invoice) and place order / draft (purchase) store the document in DemoDB. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SCRIPT = $('script[data-path]');
  var PATH = (SCRIPT && SCRIPT.dataset.path) || '';
  var ROLE = (SCRIPT && SCRIPT.dataset.role) || 'admin';
  var ROOT = (SCRIPT && SCRIPT.dataset.root) || '../';
  var W = window.DemoWire, DB = window.DemoDB, DATA = window.DEMO_DATA || {};
  if (!DB) return;
  var CUR = (DATA.meta && DATA.meta.currency) || '$';
  var USER = { admin: 'Admin User', manager: 'Manager User', staff: 'Staff User' }[ROLE] || 'Admin User';
  var QS_ID = (/[?&]id=(\d+)/.exec(location.search) || [])[1];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  var money = function (n) { return CUR + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var toast = function (t, v) { if (window.DemoToast) window.DemoToast(t, v || 'success'); };
  var go = function (path) { setTimeout(function () { location.href = ROOT + ROLE + path + '/index.html'; }, 700); };

  /* ---------- 1. entity forms ---------- */
  var NUMS = ['cost', 'price', 'tax_rate', 'discount', 'stock', 'min_stock', 'purchase_unit_factor', 'credit_limit', 'order', 'category_id', 'supplier_id', 'parent_id', 'manager_id'];
  var ENTITIES = {
    customers: { table: 'customers', isNew: function (r) { r.member_no = 'MEM-' + String(r.id).padStart(6, '0'); r.orders = 0; r.spent = 0; r.balance = 0; } },
    suppliers: { table: 'suppliers', isNew: function (r) { r.products = 0; r.balance = 0; } },
    categories: { table: 'categories' },
    warehouses: { table: 'warehouses' },
    'payment-accounts': { table: 'accounts' },
    products: { table: 'products',
      toRec: { cost_price: 'cost', selling_price: 'price', quantity: 'stock', min_stock_level: 'min_stock' } }
  };
  var m = /^\/([\w-]+)\/(create|(\d+)\/edit)$/.exec(PATH);
  var ENT = m && ENTITIES[m[1]];
  var ENT_ID = m && (QS_ID || m[3]);

  function formValues(form) {
    var o = {};
    $$('[name]', form).forEach(function (el) {
      if (el.name === '_token' || /^q-/.test(el.name) || el.type === 'file' || el.type === 'password' || /[.:]/.test(el.name) || !('value' in el)) return;
      if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
    });
    return o;
  }
  function toRecord(vals) {
    var map = ENT.toRec || {}, r = {};
    Object.keys(vals).forEach(function (k) {
      var f = map[k] || k, v = vals[k];
      if (NUMS.indexOf(f) > -1) v = v === '' ? (/_id$/.test(f) ? null : 0) : num(v);
      r[f] = v;
    });
    return r;
  }
  function fillForm(form, rec) {
    var back = {}; Object.keys(ENT.toRec || {}).forEach(function (k) { back[ENT.toRec[k]] = k; });
    Object.keys(rec).forEach(function (f) {
      var el = $('[name="' + (back[f] || f) + '"]', form); if (!el || rec[f] === undefined || (rec[f] !== null && typeof rec[f] === 'object')) return;
      if (el.type === 'checkbox') el.checked = !!rec[f]; else el.value = rec[f] === null ? '' : rec[f];
    });
  }

  window.DemoForms = {
    // Called by demo.js after validation; true = stored in DemoDB.
    save: function (form) {
      if (!ENT) return false;
      var rec = toRecord(formValues(form)), existing = ENT_ID && DB.find(ENT.table, ENT_ID);
      if (existing) rec.id = existing.id;
      else {
        rec.id = DB.nextId(ENT.table);
        if (!('is_active' in rec)) rec.is_active = true;
        if (ENT.table === 'products' && !rec.status) rec.status = 'active';
        if (ENT.isNew) ENT.isNew(rec);
      }
      DB.save(ENT.table, rec);
      return true;
    }
  };
  function prefillEntity() {
    if (!ENT || !ENT_ID) return;
    var rec = DB.find(ENT.table, ENT_ID), form = $('form[wire\\:submit]');
    if (!rec || !form || !(rec.updated_at || QS_ID)) return;
    fillForm(form, rec);
    if (QS_ID) { // the page belongs to another record: fix the headline too
      var sub = $$('[data-flux-heading]').filter(function (h) { return /edit/i.test(h.textContent); })[0];
      var t = sub && sub.nextElementSibling; if (t && t.hasAttribute('data-flux-text')) t.textContent = rec.name || t.textContent;
    }
  }

  /* ---------- 2. line items (invoice + purchase) ---------- */
  var INV = /^\/invoices\/(create|\d+\/edit)$/.test(PATH), PO = /^\/purchases\/(create|\d+\/edit)$/.test(PATH);
  // Livewire snapshot values are [value, {s: 'arr'}] tuples, nested.
  function unwrapDeep(v) {
    if (Array.isArray(v) && v.length === 2 && v[1] && typeof v[1] === 'object' && 's' in v[1]) return unwrapDeep(v[0]);
    if (Array.isArray(v)) return v.map(unwrapDeep);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = unwrapDeep(v[k]); }); return o; }
    return v;
  }
  function snapshotData() {
    var root = $$('[wire\\:snapshot]').filter(function (r) { return /(invoice|purchase)-form/.test(r.getAttribute('wire:snapshot')); })[0];
    try { return unwrapDeep(JSON.parse(root.getAttribute('wire:snapshot')).data); } catch (e) { return {}; }
  }

  function lineItems() {
    var search = $('[data-placeholder^="Search product"]'), card = search && search.closest('[data-flux-card]') || search && search.closest('.p-6');
    var table = card ? $$('table', card).filter(function (t) { return /Product/.test(($('thead', t) || {}).textContent || ''); })[0] : null;
    var tbody = table && $('tbody', table); if (!tbody || !W) return;
    var editable = !!search;
    var snap = snapshotData();
    var items = Object.values(snap.items || {}).map(function (i) { return Object.assign({}, i); });
    ['discount', 'tax', 'courierCharge', 'courierCost', 'hasCourier'].forEach(function (k) { if (k in snap) W.set(k, snap[k]); });
    W.set('items', items);
    var serverRows = $$('tr', tbody), emptyRow = serverRows.filter(function (r) { return r.cells.length === 1; })[0];
    var sample = $('input[wire\\:model="discount"]') || $('input[type="number"]');
    var IN = (sample ? sample.className : 'w-full border rounded-lg block').replace(/\bh-10\b/, 'h-8').replace(/\bpy-2\b/, 'py-1.5') + ' text-right tabular-nums';
    var X = '<svg class="shrink-0 [:where(&)]:size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z"/></svg>';
    var BTN = 'relative items-center font-medium justify-center gap-2 whitespace-nowrap h-6 text-xs rounded-md w-6 inline-flex bg-transparent hover:bg-zinc-800/5 dark:hover:bg-white/15 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white';
    var stockAlert = $('[x-data*="shortages"]');
    var stockOf = function (id) { var p = DB.find('products', id); return p ? num(p.stock) : 0; };
    var FIELDS = INV ? ['quantity', 'unit_price', 'discount', 'tax_rate'] : ['quantity', 'unit_cost'];
    var net = function (i) { return INV ? num(i.quantity) * num(i.unit_price) - num(i.discount) * num(i.quantity) : num(i.quantity) * num(i.unit_cost); };
    var lineTotal = function (i) { return INV ? net(i) * (1 + num(i.tax_rate) / 100) : net(i); };

    function render() {
      var list = W.get('items') || [];
      if (stockAlert) { try { var st = {}; list.forEach(function (i) { st[i.product_id] = stockOf(i.product_id); }); window.Alpine.$data(stockAlert).stock = st; } catch (e) {} }
      if (!editable) return; // a placed purchase order keeps its server-rendered rows
      serverRows.forEach(function (r) { if (r !== emptyRow) r.remove(); });
      $$('tr.demo-line', tbody).forEach(function (r) { r.remove(); });
      if (emptyRow) emptyRow.style.display = list.length ? 'none' : '';
      list.forEach(function (it, i) {
        var tr = document.createElement('tr');
        tr.className = 'demo-line border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/30';
        var avail = stockOf(it.product_id), short = INV && num(it.quantity) > avail;
        tr.innerHTML = '<td class="px-2 py-3"><div class="font-medium text-zinc-900 dark:text-white">' + esc(it.name) + '</div><div class="mt-0.5 font-mono text-xs text-zinc-500">' + esc(it.sku) + '</div>' +
          (INV ? '<div class="mt-0.5 text-xs demo-avail ' + (short ? 'font-medium text-red-600 dark:text-red-400' : 'text-zinc-500') + '">' + (short ? 'Only ' + avail + ' in stock' : avail + ' in stock') + '</div>' : '') + '</td>' +
          FIELDS.map(function (f) {
            return '<td class="px-2 py-3' + (PO ? ' text-right' : '') + '"><input type="number" data-line="' + i + '" data-field="' + f + '" step="' + (f === 'quantity' ? (it.loose ? '0.001' : '1') : '0.01') + '" min="0" value="' + esc(it[f]) + '" class="' + IN + '">' +
              (PO && f === 'unit_cost' ? '<div class="mt-0.5 text-xs text-zinc-500">per ' + esc(it.unit || 'pcs') + '</div>' : '') + '</td>';
          }).join('') +
          '<td class="px-2 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white demo-linetotal">' + money(lineTotal(it)) + '</td>' +
          '<td class="px-2 py-3 text-right"><button type="button" data-remove-line="' + i + '" class="' + BTN + '" aria-label="Remove">' + X + '</button></td>';
        tbody.appendChild(tr);
      });
    }
    tbody.addEventListener('input', function (e) {
      var el = e.target; if (el.dataset.line === undefined) return;
      var list = (W.get('items') || []).map(function (x) { return Object.assign({}, x); }), it = list[+el.dataset.line];
      it[el.dataset.field] = el.value; W.set('items', list);
      var tr = el.closest('tr'); $('.demo-linetotal', tr).textContent = money(lineTotal(it));
      var av = $('.demo-avail', tr);
      if (av) { var a = stockOf(it.product_id), s = num(it.quantity) > a; av.textContent = s ? 'Only ' + a + ' in stock' : a + ' in stock'; av.className = 'mt-0.5 text-xs demo-avail ' + (s ? 'font-medium text-red-600 dark:text-red-400' : 'text-zinc-500'); }
    });
    tbody.addEventListener('click', function (e) {
      var b = e.target.closest('[data-remove-line]'); if (!b) return;
      var list = (W.get('items') || []).slice(); list.splice(+b.dataset.removeLine, 1); W.set('items', list); render();
    });

    function addProduct(id) {
      var p = DB.find('products', id); if (!p) return;
      var list = (W.get('items') || []).map(function (x) { return Object.assign({}, x); });
      var it = list.filter(function (x) { return String(x.product_id) === String(p.id); })[0];
      if (it) it.quantity = num(it.quantity) + 1;
      else if (INV) list.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, loose: p.unit !== 'pcs', quantity: 1, unit_price: num(p.price),
        discount: round2(p.discount_type === 'fixed' ? num(p.discount) : num(p.price) * num(p.discount) / 100), tax_rate: num(p.tax_rate) });
      else list.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, loose: p.unit !== 'pcs', quantity: 1, unit_cost: num(p.cost) });
      W.set('items', list); render();
    }

    // Inputs and the courier checkbox are wire:model bound; Livewire did that.
    ['discount', 'tax', 'courierCharge', 'courierCost'].forEach(function (k) {
      var el = $('input[wire\\:model="' + k + '"]'); if (!el) return;
      el.addEventListener('input', function () { W.set(k, el.value); });
      setTimeout(function () { if (W.get(k) !== undefined && W.get(k) !== null && W.get(k) !== '') el.value = W.get(k); }, 0);
    });
    var cb = $('ui-checkbox[wire\\:model="hasCourier"]');
    if (cb) cb.addEventListener('click', function () { setTimeout(function () { W.set('hasCourier', cb.hasAttribute('data-checked')); }, 0); });

    function totals() {
      var list = W.get('items') || [], sub = list.reduce(function (s, i) { return s + net(i); }, 0);
      var tax = (INV ? list.reduce(function (s, i) { return s + net(i) * num(i.tax_rate) / 100; }, 0) : 0) + num(W.get('tax'));
      var courier = W.get('hasCourier') ? num(W.get('courierCharge')) : 0;
      return { subtotal: sub, total: round2(Math.max(0, sub - num(W.get('discount')) + tax + courier)) };
    }
    var val = function (n) { var el = $('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
    var opt = function (n) { var el = $('select[name="' + n + '"]'); return el && el.selectedIndex > -1 && el.value ? el.options[el.selectedIndex].text.trim() : ''; };
    function need(fields) {
      var miss = fields.filter(function (f) { return !val(f[0]); })[0];
      if (miss) { toast('The ' + miss[1] + ' field is required.', 'danger'); var el = $('[name="' + miss[0] + '"]'); if (el) el.focus(); return false; }
      if (!(W.get('items') || []).length) { toast('Add at least one product.', 'danger'); return false; }
      return true;
    }
    var editId = (/^\/\w+\/(\d+)\/edit$/.exec(PATH) || [])[1];

    function saveInvoice(status) {
      if (!need([['customer_name', 'customer name'], ['invoice_date', 'invoice date']])) return;
      var list = W.get('items') || [], t = totals();
      if (status === 'paid') {
        var short = list.filter(function (i) { return num(i.quantity) > stockOf(i.product_id); })[0];
        if (short) { toast('Not enough stock for ' + short.name + '. Save a draft instead.', 'danger'); return; }
      }
      var existing = editId && DB.find('invoices', editId);
      var rec = { number: existing ? existing.number : DB.nextInvoiceNo(), created_by: existing ? existing.created_by : USER, customer: val('customer_name'), customer_phone: val('customer_phone'),
        customer_id: W.get('customer_id') || null, items: list.length, total: t.total, subtotal: round2(t.subtotal), discount: num(W.get('discount')), tax: num(W.get('tax')),
        paid: status === 'paid' ? t.total : 0, due: status === 'paid' ? 0 : t.total, date: val('invoice_date'), due_date: val('due_date'), payment_method: val('payment_method') || 'cash',
        status: status, editable: status !== 'paid', notes: val('notes'), source: 'form',
        lines: list.map(function (i) { return { product_id: i.product_id, name: i.name, sku: i.sku, quantity: num(i.quantity), unit: i.unit, price: num(i.unit_price), discount: num(i.discount), tax_rate: num(i.tax_rate) }; }) };
      if (existing) rec.id = existing.id;
      var saved = DB.save('invoices', rec);
      if (status === 'paid') list.forEach(function (i) { DB.adjustStock(i.product_id, -num(i.quantity)); });
      toast({ paid: 'Invoice ' + saved.number + ' saved and marked paid.', sent: 'Invoice ' + saved.number + ' saved and sent. (Demo: no email is sent.)', draft: 'Draft ' + saved.number + ' saved.' }[status]);
      go('/invoices');
    }
    function savePurchase(status) {
      if (!need([['supplier_id', 'supplier'], ['warehouse_id', 'warehouse'], ['order_date', 'order date']])) return;
      var list = W.get('items') || [], t = totals();
      var year = new Date().getFullYear(), seeded = 3; // PO-<year>-0001..0003 exist in the snapshots
      var n = DB.all('purchases').reduce(function (mx, p) { var k = parseInt(String(p.number).split('-').pop(), 10); return Math.max(mx, k || 0); }, seeded) + 1;
      var saved = DB.save('purchases', { number: 'PO-' + year + '-' + String(n).padStart(4, '0'), created_by: USER, supplier_id: num(val('supplier_id')), supplier: opt('supplier_id'),
        warehouse_id: num(val('warehouse_id')), warehouse: opt('warehouse_id'), items: list.length, total: t.total, paid: 0, date: val('order_date'), expected: val('expected_date'),
        status: status, notes: val('notes'),
        lines: list.map(function (i) { return { product_id: i.product_id, name: i.name, sku: i.sku, quantity: num(i.quantity), unit: i.unit, unit_cost: num(i.unit_cost) }; }) });
      toast(status === 'draft' ? 'Draft ' + saved.number + ' saved.' : 'Purchase order ' + saved.number + ' placed. Stock is added when you receive it.');
      go('/purchases');
    }

    W.define({ actions: {
      addProduct: addProduct,
      removeItem: function (i) { var list = (W.get('items') || []).slice(); list.splice(i, 1); W.set('items', list); render(); },
      saveDraft: function () { if (INV) saveInvoice('draft'); else savePurchase('draft'); },
      saveAndSend: function () { saveInvoice('sent'); },
      saveAsPaid: function () { saveInvoice('paid'); },
      placeOrder: function () { savePurchase('ordered'); }
    } });
    render();
  }

  // wire:click on the form pages (Livewire handled these). Only actions defined above; others fall through.
  document.addEventListener('click', function (e) {
    if (!(INV || PO) || !W) return;
    var b = e.target.closest && e.target.closest('[wire\\:click]'); if (!b) return;
    var mm = /^(\w+)(?:\((.*)\))?$/.exec(b.getAttribute('wire:click') || ''); if (!mm || typeof W.actions[mm[1]] !== 'function') return;
    e.preventDefault(); e.stopImmediatePropagation();
    W.actions[mm[1]].apply(W.api, mm[2] ? mm[2].split(',').map(function (s) { s = s.trim().replace(/^['"]|['"]$/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? +s : s; }) : []);
  }, true);

  function init() {
    if (INV || PO) lineItems();
    setTimeout(prefillEntity, 0); // after demo.js has filled the form from the page snapshot
  }
  if (window.Alpine && window.Alpine.version) init(); else document.addEventListener('alpine:initialized', init);
})();
