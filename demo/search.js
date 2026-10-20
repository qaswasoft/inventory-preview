/* Swift Inventory demo - live search dropdowns (stand-in for the Livewire search results).
 *
 * DemoSearch.attach(el, cfg) turns a search box (the app's contenteditable <x-search-select> or a plain <input>)
 * into a live-results dropdown: name / SKU / barcode / phone matching, arrow keys + Enter, click to pick,
 * Esc / click outside to close, "no results" row. Markup and classes copy resources/views/components/search-select.
 *
 * Picking a row calls the matching Livewire action when a page script registered it with DemoWire.define
 * (quickAdd, addProduct, selectCustomer, selectProduct, selectInvoice); otherwise a toast confirms the pick.
 * Every pick also fires a 'demo:pick' event on window ({detail: {model, table, record}}).
 *
 * It also makes the list-page filter selects (statusFilter, typeFilter, ...) hide non-matching table rows. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ROLE_SCRIPT = $('script[data-path]');
  var PATH = (ROLE_SCRIPT && ROLE_SCRIPT.dataset.path) || location.pathname;
  var DATA = window.DEMO_DATA || {};
  var CUR = (DATA.meta && DATA.meta.currency) || '$';

  var db = function (table) { return window.DemoDB ? window.DemoDB.all(table) : (DATA[table] || []); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return CUR + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var loose = function (p) { return p.unit && p.unit !== 'pcs'; };
  var qty = function (n, unit) { n = Math.round((+n || 0) * 1000) / 1000; return n.toLocaleString('en-US', { maximumFractionDigits: 3 }) + (unit && unit !== 'pcs' ? ' ' + unit : ''); };
  var memberNo = function (c) { return c.member_no || 'MEM-' + String(c.id).padStart(6, '0'); };
  var CUBE = '<div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800"><svg class="size-4 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg></div>';

  function toast(text) {
    if (window.DemoToast) return window.DemoToast(text, 'success');
    var d = document.createElement('div'); d.className = 'demo-toast'; d.textContent = text;
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500);
  }
  // Run a Livewire-style action a page script defined; true when one existed.
  function action(name, args) {
    var W = window.DemoWire, fn = W && W.actions[name];
    if (typeof fn !== 'function') return false;
    fn.apply(W.api, args || []); return true;
  }

  /* ---------- matching ---------- */
  // Every typed word must appear in one of the fields; exact code hits first, then name prefix, then the rest.
  function match(rows, q, fields, codes) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
    return rows.map(function (r) {
      var hay = fields.map(function (f) { return String(r[f] == null ? '' : r[f]).toLowerCase(); }).join(' \u0001 ');
      if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return null;
      var ql = q.toLowerCase().trim(), name = String(r[fields[0]] || '').toLowerCase();
      var exact = (codes || []).some(function (f) { return String(r[f] || '').toLowerCase() === ql; });
      return { r: r, s: exact ? 0 : name.indexOf(ql) === 0 ? 1 : name.indexOf(ql) > -1 ? 2 : 3 };
    }).filter(Boolean).sort(function (a, b) { return a.s - b.s || String(a.r[fields[0]]).localeCompare(String(b.r[fields[0]])); })
      .map(function (x) { return x.r; });
  }
  var S = {
    products: function (q) { return match(db('products').filter(function (p) { return p.status !== 'inactive'; }), q, ['name', 'sku', 'barcode'], ['sku', 'barcode']); },
    customers: function (q) { return match(db('customers').filter(function (c) { return c.is_active !== false; }), q, ['name', 'phone', 'alternative_phone', 'email', 'member_no'], ['phone', 'member_no']); },
    suppliers: function (q) { return match(db('suppliers'), q, ['name', 'phone', 'email', 'company'], ['phone']); },
    invoices: function (q) { return match(db('invoices'), q, ['number', 'customer', 'customer_phone'], ['number', 'customer_phone']); },
    // Exact barcode / SKU hit (scanner input), or null.
    code: function (q) { q = q.trim().toLowerCase(); return q ? db('products').filter(function (p) { return String(p.barcode).toLowerCase() === q || String(p.sku).toLowerCase() === q; })[0] || null : null; }
  };

  /* ---------- the dropdown ---------- */
  var open = [];
  document.addEventListener('mousedown', function (e) { open.forEach(function (c) { if (!c.host.contains(e.target)) c.close(); }); });

  function attach(el, cfg) {
    if (!el || el._demoSearch) return el && el._demoSearch;
    var isInput = 'value' in el && el.tagName !== 'DIV';
    var host = cfg.host || el.closest('.relative') || el.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var list = document.createElement('div');
    list.className = 'absolute z-20 mt-1.5 max-h-80 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900';
    list.setAttribute('role', 'listbox'); list.hidden = true; list.style.left = '0';
    host.appendChild(list);
    var items = [], hi = 0, min = cfg.min || 1;
    var emptyRow = function (q) {
      var msg = esc((cfg.empty || 'No results for "%s".').replace('%s', q)), act = cfg.emptyAction && cfg.emptyAction();
      if (!act) return '<div class="px-3 py-3 text-sm text-zinc-500">' + msg + '</div>';
      return '<div class="flex items-center justify-between gap-2 px-3 py-2 text-xs"><span class="text-zinc-500">' + msg + '</span>' +
        '<button type="button" data-demo-empty-action class="relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium h-6 text-xs rounded-md px-2 bg-[var(--color-accent)] hover:bg-[color-mix(in_oklab,_var(--color-accent),_transparent_10%)] text-[var(--color-accent-foreground)] border border-black/10 dark:border-0">' + esc(act.label) + '</button></div>';
    };
    var text = function () { return (isInput ? el.value : el.textContent).trim(); };
    var c = {
      el: el, host: host, list: list,
      close: function () { list.hidden = true; el.setAttribute('aria-expanded', 'false'); open = open.filter(function (x) { return x !== c; }); },
      clear: function () { if (isInput) el.value = ''; else el.innerHTML = ''; if (window.DemoWire && cfg.model) window.DemoWire.set(cfg.model, ''); c.close(); },
      refresh: function () {
        var q = text();
        if (q.length < min) { items = []; c.close(); return; }
        items = cfg.source(q).slice(0, cfg.limit || 8); hi = 0;
        list.innerHTML = items.length ? items.map(function (r, i) {
          var o = cfg.render(r);
          return '<button type="button" data-search-result data-i="' + i + '" role="option" class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors data-[active=true]:bg-zinc-100 dark:data-[active=true]:bg-zinc-800" data-active="' + (i === 0) + '">' +
            (o.leading || '') + '<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-zinc-900 dark:text-white">' + esc(o.label) + '</div>' +
            (o.description ? '<div class="mt-0.5 truncate text-xs text-zinc-500">' + esc(o.description) + '</div>' : '') + '</div>' +
            (o.value ? '<span class="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">' + esc(o.value) + '</span>' : '') + '</button>';
        }).join('') : emptyRow(q);
        list.hidden = false; el.setAttribute('aria-expanded', 'true');
        if (open.indexOf(c) < 0) open.push(c);
      },
      move: function (d) {
        if (!items.length) return;
        hi = (hi + d + items.length) % items.length;
        $$('[data-search-result]', list).forEach(function (b, i) { b.setAttribute('data-active', i === hi); if (i === hi) b.scrollIntoView({ block: 'nearest' }); });
      },
      pick: function (r) {
        c.close();
        window.dispatchEvent(new CustomEvent('demo:pick', { detail: { model: cfg.model, table: cfg.table, record: r } }));
        cfg.pick(r, c);
      }
    };
    el._demoSearch = c;
    el.addEventListener('input', function () { if (window.DemoWire && cfg.model) window.DemoWire.set(cfg.model, text()); c.refresh(); });
    el.addEventListener('focus', function () { if (text().length >= min) c.refresh(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) c.refresh(); else c.move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Escape') c.close();
      else if (e.key === 'Enter') {
        e.preventDefault();
        var q = text(), hit = cfg.exact && cfg.exact(q);
        if (hit) c.pick(hit);
        else if (!list.hidden && items[hi]) c.pick(items[hi]);
        else { c.refresh(); if (items[0]) c.pick(items[0]); }
      }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the box
    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-demo-empty-action]')) { var act = cfg.emptyAction && cfg.emptyAction(), q = text(); c.close(); if (act) act.run(q); return; }
      var b = e.target.closest('[data-search-result]'); if (b) c.pick(items[+b.dataset.i]); });
    list.addEventListener('mousemove', function (e) { var b = e.target.closest('[data-search-result]'); if (b && +b.dataset.i !== hi) c.move(+b.dataset.i - hi); });
    return c;
  }

  /* Swap an <x-search-select> box for the "picked" chip (same markup as the component), with its clear button. */
  function chip(c, title, hint, onClear) {
    var wrap = c.el.closest('[wire\\:key$="-input"]') || c.el.parentElement;
    var old = wrap.parentElement.querySelector('.demo-chip'); if (old) old.remove();
    var tall = /\bh-12\b/.test(c.el.className);
    var d = document.createElement('div');
    d.className = 'demo-chip flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 shadow-xs dark:border-white/10 dark:bg-white/10 cursor-pointer transition-colors hover:border-zinc-300 dark:hover:border-white/20 ' + (tall ? 'h-12' : 'h-10');
    d.setAttribute('role', 'button'); d.tabIndex = 0; d.title = 'Change';
    d.innerHTML = '<div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[0.6875rem] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">' + esc(String(title).slice(0, 2)) + '</div>' +
      '<div class="min-w-0 flex-1 leading-tight"><div class="truncate text-sm font-medium text-zinc-900 dark:text-white">' + esc(title) + '</div>' +
      (hint ? '<div class="truncate text-xs text-zinc-500">' + esc(hint) + '</div>' : '') + '</div>' +
      '<span class="inline-flex size-6 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-800 dark:hover:text-white" aria-hidden="true"><svg class="size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></span>';
    var clear = function () { d.remove(); wrap.style.display = ''; c.clear(); if (onClear) onClear(); c.el.focus(); };
    d.addEventListener('click', clear);
    d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); clear(); } });
    wrap.style.display = 'none';
    wrap.parentElement.insertBefore(d, wrap);
  }

  /* ---------- row renderers ---------- */
  var R = {
    posProduct: function (p) { return { label: p.name, leading: CUBE, value: money(p.price), description: p.sku + ' · ' + qty(p.stock, p.unit) + ' in stock' + (loose(p) ? ' · per ' + p.unit : '') }; },
    saleProduct: function (p) { return { label: p.name, value: money(p.price), description: p.sku + ' · ' + qty(p.stock, p.unit) + ' in stock' }; },
    costProduct: function (p) { return { label: p.name, value: money(p.cost), description: p.sku }; },
    stockProduct: function (p) { return { label: p.name, value: qty(p.stock, p.unit), description: p.sku }; },
    labelProduct: function (p) { return { label: p.name, value: money(p.price) + (loose(p) ? ' / ' + p.unit : ''), description: 'SKU ' + p.sku + (p.barcode ? ' · ' + p.barcode : '') }; },
    customer: function (c) { return { label: c.name, description: (c.phone || '') + ' · ' + memberNo(c) }; },
    invoice: function (i) { return { label: i.number, value: money(i.total), description: i.date + ' · ' + i.customer + (i.customer_phone ? ' · ' + i.customer_phone : '') }; }
  };

  /* ---------- what each picker does ---------- */
  function addLine(name, msg) {
    return function (p, c) { c.clear(); if (!action(name, [p.id])) toast(msg.replace('%s', p.name)); c.el.focus(); };
  }
  function selectCustomer(c0) {
    return function (cust, c) {
      if (window.DemoWire) { window.DemoWire.set('customer_id', cust.id); window.DemoWire.set('customerSearch', cust.name); }
      if (!action('selectCustomer', [cust.id])) {
        // Invoice form: copy the customer into the bill-to fields like the real selectCustomer() does.
        var form = c.el.closest('form') || document;
        [['customer_name', cust.name], ['customer_phone', cust.phone], ['customer_email', cust.email], ['customer_address', cust.address]].forEach(function (f) {
          var inp = $('[name="' + f[0] + '"]', form); if (inp && f[1] != null) { inp.value = f[1]; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      }
      chip(c, cust.name, 'Member · ' + memberNo(cust), function () {
        if (window.DemoWire) window.DemoWire.set('customer_id', null);
        action('clearCustomer');
        if (c0) c0();
      });
    };
  }
  function selectStockProduct(p, c) {
    if (window.DemoWire) window.DemoWire.set('product_id', p.id);
    action('selectProduct', [p.id]);
    chip(c, p.name, p.sku, function () { if (window.DemoWire) window.DemoWire.set('product_id', null); });
  }

  var box = function (model) { return $('[wire\\:key="search-' + model + '-input"] [contenteditable]'); };
  var input = function (model) { return $('input[wire\\:model\\.live\\.debounce\\.300ms="' + model + '"]'); };
  var page = function (re) { return re.test(PATH); };

  function wirePickers() {
    if (page(/^\/pos/)) {
      attach(box('search'), { model: 'search', table: 'products', source: S.products, exact: S.code, render: R.posProduct, empty: 'No products match "%s".', pick: addLine('quickAdd', '%s added to the cart') });
      attach(box('customerSearch'), { model: 'customerSearch', table: 'customers', source: S.customers, render: R.customer, empty: 'No customer found.', pick: selectCustomer(),
        emptyAction: function () { var W = window.DemoWire; return W && W.actions.openRegisterCustomer ? { label: 'Register', run: function (q) { W.actions.openRegisterCustomer(q); } } : null; } });
    }
    if (page(/^\/invoices\/(create|\d+\/edit)/)) {
      attach(box('customerSearch'), { model: 'customerSearch', table: 'customers', source: S.customers, render: R.customer, empty: 'No customer found.', pick: selectCustomer() });
      attach(box('productSearch'), { model: 'productSearch', table: 'products', source: S.products, exact: S.code, render: R.saleProduct, empty: 'No products match "%s".', pick: addLine('addProduct', '%s added to the invoice') });
    }
    if (page(/^\/purchases/)) attach(box('productSearch'), { model: 'productSearch', table: 'products', source: S.products, exact: S.code, render: R.costProduct, empty: 'No products match "%s".', pick: addLine('addProduct', '%s added to the purchase') });
    if (page(/^\/stock\/(adjust|transfer)/)) attach(box('search'), { model: 'search', table: 'products', source: S.products, exact: S.code, render: R.stockProduct, empty: 'No products match "%s".', pick: selectStockProduct });
    if (page(/^\/returns/)) attach(input('search'), { model: 'search', table: 'invoices', min: 2, source: S.invoices, render: R.invoice, empty: 'No sale matches "%s".', pick: function (inv, c) { c.el.value = inv.number; if (!action('selectInvoice', [inv.id])) toast('Selected ' + inv.number); } });
    if (page(/^\/products\/labels/)) attach(input('search'), { model: 'search', table: 'products', source: S.products, exact: S.code, render: R.labelProduct, empty: 'No products match "%s".', pick: addLine('addProduct', '%s added to the label sheet') });
  }

  /* ---------- list filter selects ---------- */
  var FILTER_SEL = ['statusFilter', 'typeFilter', 'roleFilter', 'basisFilter', 'methodFilter', 'categoryFilter', 'supplierFilter', 'warehouseFilter', 'userFilter', 'partnerFilter', 'status', 'type', 'kind']
    .map(function (m) { return 'select[wire\\:model\\.live="' + m + '"]'; }).join(',');
  function wireFilters() {
    var tbody = $('tbody[data-flux-rows]'); if (!tbody) return;
    var sels = $$(FILTER_SEL); if (!sels.length) return;
    var st = document.createElement('style'); st.textContent = 'tr.demo-fhide{display:none!important}'; document.head.appendChild(st);
    var words = function (s) { return new RegExp('(^|[^a-z0-9])' + s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s_-]+/g, '[\\s_-]+') + '($|[^a-z0-9])', 'i'); };
    function apply() {
      var tests = sels.filter(function (s) { return s.value !== '' && s.value != null; }).map(function (s) {
        var o = s.options[s.selectedIndex]; return [words(o ? o.text.trim() : s.value), words(String(s.value))];
      });
      var rows = $$('tr[data-flux-row]', tbody), shown = 0;
      rows.forEach(function (r) {
        var t = r.textContent, ok = tests.every(function (x) { return x[0].test(t) || x[1].test(t); });
        r.classList.toggle('demo-fhide', !ok);
        if (ok && r.style.display !== 'none') shown++;
      });
      var empty = $('tr.demo-empty', tbody);
      if (!shown && !empty) { var tr = document.createElement('tr'); tr.className = 'demo-empty'; tr.innerHTML = '<td colspan="' + ($$('table thead th').length || 1) + '">No records match your filters.</td>'; tbody.appendChild(tr); }
      else if (shown && empty) empty.remove();
    }
    sels.forEach(function (s) { s.addEventListener('change', apply); });
    document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('input[placeholder*="earch"]')) setTimeout(apply, 0); });
  }

  window.DemoSearch = { attach: attach, chip: chip, sources: S, renderers: R, money: money, qty: qty };

  function init() { wirePickers(); wireFilters(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
