/* Swift Inventory demo - list pages: column sort, 15-per-page pagination and rows kept in step with DemoDB.
 *
 * Works on every table whose body is <tbody data-flux-rows>. Row visibility from the other scripts is respected:
 * demo.js search sets style.display, search.js filter selects add .demo-fhide; this file only adds .demo-phide
 * for rows outside the current page. Records saved through DemoDB (they carry updated_at) rewrite their row,
 * new records get a row cloned from an existing one, and seeded records deleted from DemoDB lose their row. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SCRIPT = $('script[data-path]');
  var PATH = (SCRIPT && SCRIPT.dataset.path) || location.pathname;
  var DATA = window.DEMO_DATA || {};
  var CUR = (DATA.meta && DATA.meta.currency) || '$';
  var PER_PAGE = 15;
  var DB = function () { return window.DemoDB; };

  var money = function (n) { return CUR + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var dmy = function (iso) { var d = new Date(iso); return isNaN(d) ? String(iso || '') : String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
  var title = function (s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '); };
  var active = function (r) { return r.is_active === false ? 'Inactive' : 'Active'; };
  var num = function (n) { return (Math.round((+n || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); };
  var SVG = function (d) { return '<svg class="shrink-0 [:where(&)]:size-4" data-flux-icon xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-slot="icon"><path fill-rule="evenodd" d="' + d + '" clip-rule="evenodd"/></svg>'; };
  var ICON = {
    up: SVG('M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06Z'),
    down: SVG('M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z'),
    left: SVG('M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z'),
    right: SVG('M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z')
  };

  /* ---------- how a record fills a row, per list page (keys are column headers) ---------- */
  var nameOf = function (table, id) { var r = DB() && DB().find(table, id); return r ? r.name : undefined; };
  var level = function (p) { return (+p.stock || 0) <= 0 ? 0 : (+p.stock || 0) <= (+p.min_stock || 0) ? 1 : 2; };
  var LISTS = {
    '/products': { table: 'products', fill: function (p) {
      return { Product: [p.name, p.barcode || ''], SKU: [p.sku], Category: [nameOf('categories', p.category_id) || '-'],
        Price: [money(p.price), 'Cost: ' + money(p.cost)], Stock: [num(p.stock) + ' ' + (p.unit || 'pcs')], Status: [title(p.status || 'active')] };
    }, badgeKey: { Stock: function (p) { return 'lvl' + level(p); } } },
    '/customers': { table: 'customers', fill: function (c) {
      return { Customer: [c.name, (c.member_no || 'MEM-' + String(c.id).padStart(6, '0')) + (c.city ? ' · ' + c.city : '')], Contact: [c.phone || '-'],
        'Total Orders': [c.orders], 'Total Spent': [c.spent === undefined ? undefined : money(c.spent)], Balance: [c.balance === undefined ? undefined : money(c.balance)], Status: [active(c)] };
    } },
    '/suppliers': { table: 'suppliers', fill: function (s) {
      return { Supplier: [s.name, s.company_name || undefined], Contact: [s.phone || s.email || '-'], Location: [[s.city, s.country].filter(Boolean).join(', ') || '-'],
        Products: [s.products], Balance: [s.balance === undefined ? undefined : money(s.balance)], Status: [active(s)] };
    } },
    '/categories': { table: 'categories', fill: function (c) {
      return { Name: [c.name, c.slug || ''], Parent: [nameOf('categories', c.parent_id) || 'Root'], Order: [String(c.order == null ? 0 : c.order)], Status: [active(c)] };
    } },
    '/warehouses': { table: 'warehouses', fill: function (w) {
      return { Warehouse: [w.name], Code: [w.code], Location: [[w.city, w.country].filter(Boolean).join(', ') || '-'], Capacity: [w.capacity ? String(w.capacity) : '-'], Status: [active(w)] };
    } },
    '/payment-accounts': { table: 'accounts', fill: function (a) {
      var tail = a.account_number ? ' ••' + String(a.account_number).slice(-4) : '';
      return { Account: [a.name + (a.type === 'cash' ? '' : tail)], Type: [title(a.type === 'mobile_banking' ? 'mobile' : a.type)], 'Bank / Provider': [a.bank_name || '-'], Holder: [a.holder_name || '-'], Status: [active(a)] };
    } },
    '/invoices': { table: 'invoices', newestFirst: true, fill: function (i) {
      return { 'Invoice #': [i.number, i.created_by || undefined], Customer: [i.customer || 'Walk-in Customer'], Items: [String(i.items || 0)], Total: [money(i.total)],
        Due: [(+i.due || 0) > 0 ? money(i.due) : 'Paid'], Date: [dmy(i.date)], Status: [title(i.status)] };
    } },
    '/purchases': { table: 'purchases', newestFirst: true, fill: function (p) {
      return { 'Order #': [p.number, p.created_by || undefined], Supplier: [p.supplier || '-'], Warehouse: [p.warehouse || '-'], Items: [(p.items || 0) + (p.items === 1 ? ' item' : ' items')],
        Total: [money(p.total), 'Paid: ' + money(p.paid)], 'Order Date': [dmy(p.date), p.expected ? 'Expected: ' + dmy(p.expected) : undefined], Status: [title(p.status || 'ordered')] };
    } }
  };
  var LIST = LISTS[PATH];

  /* ---------- row helpers ---------- */
  var tbodyOf = function (t) { return $('tbody[data-flux-rows]', t); };
  var rowsOf = function (t) { return $$('tbody[data-flux-rows] > tr[data-flux-row]', t); };
  var headers = function (t) { return $$('thead th', t); };
  function colIndex(t, name) { var h = headers(t).filter(function (th) { return th.textContent.trim().toLowerCase() === name.toLowerCase(); })[0]; return h ? h.cellIndex : -1; }
  // The text-bearing elements of a cell, in order (Flux text and badges), not nested in each other.
  function slots(cell) { return $$('[data-flux-text], [data-flux-badge]', cell).filter(function (el) { return !el.parentElement.closest('[data-flux-badge]'); }); }

  function fillRow(t, row, rec) {
    var map = LIST.fill(rec);
    Object.keys(map).forEach(function (col) {
      var ci = colIndex(t, col), cell = ci > -1 && row.cells[ci]; if (!cell) return;
      var els = slots(cell);
      map[col].forEach(function (text, i) {
        var el = els[i]; if (!el || text === undefined) return;
        el.textContent = text; el.style.display = text === null || text === '' && i > 0 ? 'none' : '';
        if (el.hasAttribute('data-flux-badge')) recolor(t, ci, el, row, col, rec);
      });
    });
  }
  // Give a badge the colours of another row's badge in the same column with the same meaning.
  function recolor(t, ci, el, row, col, rec) {
    var key = LIST.badgeKey && LIST.badgeKey[col];
    var want = key ? key(rec) : el.textContent.trim();
    rowsOf(t).some(function (r) {
      if (r === row) return false;
      var other = r.cells[ci] && slots(r.cells[ci]).filter(function (x) { return x.hasAttribute('data-flux-badge'); })[0]; if (!other) return false;
      var o = key ? (DB().find(LIST.table, r.getAttribute('wire:key')) || null) : null;
      if ((key ? o && key(o) : other.textContent.trim()) !== want) return false;
      el.className = other.className; return true;
    });
  }
  // Point a cloned row's links and actions at another id. Pages only exist for seeded ids, so a new record
  // reuses the template's page with ?id=<new id> (forms.js reads it).
  function retarget(row, fromId, toId, seeded) {
    row.setAttribute('wire:key', toId);
    $$('[href]', row).forEach(function (a) {
      var h = a.getAttribute('href'), re = new RegExp('/' + fromId + '/((?:edit/)?index\\.html)');
      if (re.test(h)) a.setAttribute('href', seeded ? h.replace(re, '/' + toId + '/$1') : h.replace(re, '/' + fromId + '/$1') .replace(/(\?.*)?$/, '?id=' + toId));
    });
    $$('[wire\\:click]', row).forEach(function (b) { b.setAttribute('wire:click', b.getAttribute('wire:click').replace(new RegExp('\\(' + fromId + '\\)'), '(' + toId + ')')); });
  }

  function syncRows(t) {
    if (!LIST || !DB()) return;
    var tb = tbodyOf(t), rows = rowsOf(t); if (!tb) return;
    var recs = DB().all(LIST.table), seededIds = (DATA[LIST.table] || []).map(function (r) { return String(r.id); });
    var byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
    // Seeded records removed from the store lose their row.
    if (DATA[LIST.table]) rows.forEach(function (r) { var id = r.getAttribute('wire:key'); if (seededIds.indexOf(id) > -1 && !byId[id]) r.remove(); });
    rows = rowsOf(t);
    var template = rows.filter(function (r) { return !$('img', r); })[0] || rows[0];
    recs.forEach(function (rec) {
      if (!rec.updated_at) return;
      var id = String(rec.id), row = rows.filter(function (r) { return r.getAttribute('wire:key') === id; })[0];
      if (!row) {
        if (!template) return;
        row = template.cloneNode(true);
        $$('img', row).forEach(function (im) { im.remove(); });
        retarget(row, template.getAttribute('wire:key'), id, seededIds.indexOf(id) > -1);
        // A demo invoice has no invoice page; "View / Print" opens its receipt instead.
        if (LIST.table === 'invoices' && seededIds.indexOf(id) < 0 && window.DemoReceipt) $$('a[href*="/invoices/"]', row).forEach(function (a) { a.setAttribute('href', window.DemoReceipt.url(id)); a.setAttribute('target', '_blank'); });
        row.classList.add('demo-new');
        if (LIST.newestFirst) tb.insertBefore(row, tb.firstChild); else tb.appendChild(row);
      }
      fillRow(t, row, rec);
    });
  }

  /* ---------- sorting ---------- */
  var SKIP = /^(image|photo|logo|icon|actions?|)$/i;
  function sortKey(cell) {
    if (!cell) return '';
    var el = slots(cell)[0], s = (el ? el.textContent : cell.textContent).trim();
    if (s === '-' || s === '') return null;
    if (/^\d{1,2} [A-Z][a-z]{2} \d{4}/.test(s)) { var d = Date.parse(s); if (!isNaN(d)) return d; }
    var m = /^[^\d-]{0,3}(-?[\d,]+(?:\.\d+)?)(\s|$|[a-z%])/i.exec(s);
    if (m && !/[A-Z]{2,}-\d/.test(s)) return parseFloat(m[1].replace(/,/g, ''));
    return s.toLowerCase();
  }
  function compare(a, b) {
    if (a === null) return b === null ? 0 : 1; if (b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  function setupSort(t, st) {
    var ths = headers(t), flux = ths.filter(function (th) { return $('[data-flux-table-sortable]', th); });
    var sortable = flux.length ? flux : ths.filter(function (th) { return !SKIP.test(th.textContent.trim()); });
    sortable.forEach(function (th) {
      var btn = $('[data-flux-table-sortable]', th), icon = btn && btn.lastElementChild, orig = icon && icon.innerHTML;
      if (!btn) { th.style.cursor = 'pointer'; th.classList.add('select-none'); icon = document.createElement('span'); icon.className = 'demo-sort inline-flex align-middle ms-1 text-zinc-400'; (th.firstElementChild || th).appendChild(icon); orig = ''; }
      th._demoIcon = function (dir) { icon.innerHTML = dir ? ICON[dir === 'asc' ? 'up' : 'down'] : orig; };
      th.addEventListener('click', function (e) {
        e.preventDefault();
        st.dir = st.col === th.cellIndex ? (st.dir === 'asc' ? 'desc' : st.dir === 'desc' ? null : 'asc') : 'asc';
        st.col = st.dir ? th.cellIndex : null;
        sortable.forEach(function (h) { h._demoIcon(h === th ? st.dir : null); });
        applySort(t, st); st.page = 1; paginate(t, st);
      });
    });
  }
  function applySort(t, st) {
    var tb = tbodyOf(t), rows = rowsOf(t);
    rows.forEach(function (r, i) { if (r._demoIdx === undefined) r._demoIdx = i; }); // first call = page order (new rows already placed)
    var keyed = rows.map(function (r) { return { r: r, k: st.col === null ? null : sortKey(r.cells[st.col]) }; });
    keyed.sort(function (a, b) {
      if (st.col === null) return a.r._demoIdx - b.r._demoIdx;
      var c = compare(a.k, b.k); if (a.k !== null && b.k !== null && st.dir === 'desc') c = -c;
      return c || a.r._demoIdx - b.r._demoIdx;
    });
    keyed.forEach(function (x) { tb.appendChild(x.r); });
    var empty = $('tr.demo-empty', tb); if (empty) tb.appendChild(empty);
  }

  /* ---------- pagination (Flux's own markup) ---------- */
  var BTN = 'flex justify-center items-center size-6 rounded-[6px] text-zinc-400 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/20 hover:text-zinc-800 dark:hover:text-white';
  var OFF = 'flex justify-center items-center size-6 rounded-[6px] text-zinc-300 dark:text-zinc-500';
  function pagerHost(t) {
    var after = t.closest('ui-table-scroll-area') || t, p = after.nextElementSibling;
    if (p && p.matches('[data-flux-pagination]')) return p;
    p = document.createElement('div');
    p.className = '@container pt-3 border-t border-zinc-100 dark:border-zinc-700 flex justify-between items-center gap-3 shrink-0';
    p.setAttribute('data-flux-pagination', '');
    after.parentElement.insertBefore(p, after.nextSibling);
    return p;
  }
  function paginate(t, st) {
    var rows = rowsOf(t), shown = rows.filter(function (r) { return r.style.display !== 'none' && !r.classList.contains('demo-fhide'); });
    var pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
    st.page = Math.min(Math.max(1, st.page), pages);
    var from = (st.page - 1) * PER_PAGE;
    rows.forEach(function (r) { r.classList.add('demo-phide'); });
    shown.slice(from, from + PER_PAGE).forEach(function (r) { r.classList.remove('demo-phide'); });
    var p = st.pager || (st.pager = pagerHost(t));
    var info = shown.length ? '<div class="text-zinc-500 dark:text-zinc-400 text-xs font-medium whitespace-nowrap">Showing ' + (from + 1) + ' to ' + Math.min(from + PER_PAGE, shown.length) + ' of ' + shown.length + ' results</div>' : '<div></div>';
    var nav = '';
    if (pages > 1) {
      var b = function (pg, html, label) { return '<button type="button" data-demo-page="' + pg + '" aria-label="' + label + '" class="' + BTN + '">' + html + '</button>'; };
      nav = '<div class="flex items-center bg-white border border-zinc-200 rounded-[8px] p-[1px] dark:bg-white/10 dark:border-white/10">' +
        (st.page > 1 ? b(st.page - 1, ICON.left, 'Previous') : '<div aria-disabled="true" class="' + OFF + '">' + ICON.left + '</div>');
      for (var i = 1; i <= pages; i++) {
        nav += i === st.page ? '<div aria-current="page" class="cursor-default flex justify-center items-center text-xs h-6 px-2 rounded-[6px] font-medium dark:text-white text-zinc-800">' + i + '</div>'
          : '<button type="button" data-demo-page="' + i + '" class="text-xs h-6 px-2 rounded-[6px] text-zinc-400 font-medium dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/20 hover:text-zinc-800 dark:hover:text-white">' + i + '</button>';
      }
      nav += (st.page < pages ? b(st.page + 1, ICON.right, 'Next') : '<div aria-disabled="true" class="' + OFF + '">' + ICON.right + '</div>') + '</div>';
    }
    p.innerHTML = info + nav;
  }

  /* ---------- wiring ---------- */
  var tables = [];
  function refresh(resetPage) {
    tables.forEach(function (x) { if (resetPage) x.st.page = 1; paginate(x.t, x.st); });
  }
  function init() {
    if (/\/(create|edit)$/.test(PATH)) return;
    var st = document.createElement('style'); st.textContent = 'tr.demo-phide{display:none!important}'; document.head.appendChild(st);
    $$('table').forEach(function (t) {
      if (!tbodyOf(t) || !rowsOf(t).length) return;
      var x = { t: t, st: { col: null, dir: null, page: 1, pager: null } };
      tables.push(x);
      if (tables.length === 1) syncRows(t);
      setupSort(t, x.st);
      applySort(t, x.st);
    });
    if (!tables.length) return;
    refresh(false);
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-demo-page]'); if (!b) { setTimeout(function () { refresh(false); }, 0); return; }
      var x = tables.filter(function (y) { return y.st.pager && y.st.pager.contains(b); })[0]; if (!x) return;
      x.st.page = +b.dataset.demoPage; paginate(x.t, x.st);
    });
    ['input', 'change'].forEach(function (ev) { document.addEventListener(ev, function () { setTimeout(function () { refresh(true); }, 0); }); });
  }

  window.DemoList = {
    refresh: refresh,
    // demo.js calls this when a row is deleted, so the record leaves the store too.
    removed: function (id) { if (LIST && DB()) DB().remove(LIST.table, id); setTimeout(function () { refresh(false); }, 0); },
    lists: LISTS
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
