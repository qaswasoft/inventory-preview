/* Swift Inventory demo layer.
 * The pages are real server-rendered snapshots of the Laravel app. This script adds just enough behaviour
 * to make them feel alive without a server: role switching, login/logout, search + filters, delete dialogs,
 * form validation and "saving". Everything is kept in this browser's localStorage and can be reset. */
(function () {
  'use strict';
  var S = document.currentScript || document.querySelector('script[data-role]');
  var ROLE = S.dataset.role, PATH = S.dataset.path, ROOT = S.dataset.root;
  var PFX = 'swiftdemo:v1:';

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(PFX + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) {} },
    reset: function () { try { Object.keys(localStorage).filter(function (k) { return k.indexOf(PFX) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
  };
  var go = function (role, path) { location.href = ROOT + role + (path === '/' ? '' : path) + '/index.html'; };
  var listPath = PATH.replace(/\/(create|\d+\/edit)$/, '') || '/';

  function toast(text, variant) {
    try { if (window.Flux && window.Flux.toast) { window.Flux.toast({ text: text, variant: variant || 'success', duration: 3500 }); return; } } catch (e) {}
    var d = document.createElement('div'); d.className = 'demo-toast'; d.textContent = text; document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3500);
  }
  window.DemoToast = toast;
  function closeDialogs() { $$('dialog[open]').forEach(function (d) { try { d.close(); } catch (e) { d.removeAttribute('open'); } }); }
  function openDialog(modal) { var d = modal && $('dialog', modal); if (!d) return false; try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } return true; }

  /* ---------- demo bar (role switcher / reset / home) ---------- */
  function bar() {
    var b = document.createElement('div'); b.className = 'demo-bar';
    var roles = ['admin', 'manager', 'staff'];
    b.innerHTML = '<b>Demo</b>' +
      (ROLE === 'guest' ? '' : '<select aria-label="View as role">' + roles.map(function (r) { return '<option value="' + r + '"' + (r === ROLE ? ' selected' : '') + '>View as ' + r + '</option>'; }).join('') + '</select>') +
      '<button type="button" data-demo="reset" title="Forget everything stored in this browser">Reset data</button><a href="' + ROOT + 'index.html">Start</a><button type="button" class="demo-x" data-demo="min" aria-label="Collapse">×</button>';
    document.body.appendChild(b);
    var sel = $('select', b);
    if (sel) sel.addEventListener('change', function () {
      var r = sel.value;
      fetch(ROOT + 'manifest.json').then(function (x) { return x.json(); }).then(function (m) { var pages = (m.roles[r] || []); go(r, pages.indexOf(PATH) > -1 ? PATH : '/dashboard'); })
        .catch(function () { go(r, '/dashboard'); });
    });
    b.addEventListener('click', function (e) {
      var a = e.target.closest('[data-demo]'); if (!a) return;
      if (a.dataset.demo === 'reset') { store.reset(); toast('Demo data reset', 'success'); setTimeout(function () { location.reload(); }, 600); }
      else b.classList.toggle('min');
    });
  }

  /* ---------- deleted rows persist per list ---------- */
  var delKey = 'del:' + ROLE + ':' + listPath;
  function applyDeleted() {
    var ids = store.get(delKey, []);
    ids.forEach(function (id) { $$('tr[data-flux-row][wire\\:key="' + esc(id) + '"]').forEach(function (r) { r.remove(); }); });
  }
  var pending = null; // { id, row }

  /* ---------- table search + filters ---------- */
  var tableRows = function () { return $$('tbody[data-flux-rows] tr[data-flux-row]'); };
  var FILTERS = {
    '/products': [
      { label: 'All Categories', col: 'Category' },
      { label: 'All Status', options: ['Active', 'Inactive', 'Draft'] },
      { label: 'All Stock', options: ['Low Stock', 'Out of Stock'], stock: true }
    ]
  };
  var state = { q: '', filters: {} };
  function colIndex(name) { var th = $$('table thead th').filter(function (t) { return t.textContent.trim().toLowerCase() === name.toLowerCase(); })[0]; return th ? th.cellIndex : -1; }
  function applyFilters() {
    var rows = tableRows(); if (!rows.length && !$('tr.demo-empty')) return;
    var shown = 0, cfg = FILTERS[listPath] || [];
    rows.forEach(function (r) {
      var ok = !state.q || r.textContent.toLowerCase().indexOf(state.q) > -1;
      cfg.forEach(function (f, i) {
        var v = state.filters[i]; if (!v || !ok) return;
        if (f.stock) { var badge = $$('[data-flux-badge]', r).map(function (x) { return x.className; }).join(' '); ok = v === 'Low Stock' ? /yellow|amber/.test(badge) : /red/.test(badge); }
        else if (f.col) { var ci = colIndex(f.col); ok = ci > -1 && r.cells[ci] && r.cells[ci].textContent.trim() === v; }
        else ok = r.textContent.toLowerCase().indexOf(v.toLowerCase()) > -1;
      });
      r.style.display = ok ? '' : 'none'; if (ok) shown++;
    });
    var tb = $('tbody[data-flux-rows]'), empty = $('tr.demo-empty');
    if (tb && !shown && !empty) { var tr = document.createElement('tr'); tr.className = 'demo-empty'; tr.innerHTML = '<td colspan="' + ($$('table thead th').length || 1) + '">No records match your search.</td>'; tb.appendChild(tr); }
    else if (empty && shown) empty.remove();
  }
  function initSearch() {
    var inp = $('input[placeholder*="earch"][data-flux-control]'); if (!inp || !$('tbody[data-flux-rows]')) return;
    inp.addEventListener('input', function () { state.q = inp.value.trim().toLowerCase(); applyFilters(); });
  }
  function toggleFilters() {
    var cfg = FILTERS[listPath]; var ex = $('.demo-filters');
    if (ex) { ex.remove(); state.filters = {}; applyFilters(); return; }
    if (!cfg) { toast('Filters are not part of this demo page.', 'info'); return; }
    var p = document.createElement('div'); p.className = 'demo-filters';
    cfg.forEach(function (f, i) {
      var opts = f.options || (function () { var ci = colIndex(f.col), seen = {}; tableRows().forEach(function (r) { var t = r.cells[ci] && r.cells[ci].textContent.trim(); if (t && t !== '-') seen[t] = 1; }); return Object.keys(seen).sort(); })();
      var s = document.createElement('select'); s.setAttribute('aria-label', f.label);
      s.innerHTML = '<option value="">' + f.label + '</option>' + opts.map(function (o) { return '<option>' + o + '</option>'; }).join('');
      s.addEventListener('change', function () { state.filters[i] = s.value; applyFilters(); });
      p.appendChild(s);
    });
    var t = $('table'); var host = t && (t.closest('[data-flux-card]') || t.parentElement);
    if (host) host.parentElement.insertBefore(p, host);
  }

  /* ---------- forms ---------- */
  function fieldMsg(ctl) { return 'The ' + String(ctl.name || 'field').replace(/_/g, ' ').replace(/\.\d+/g, '') + ' field is required.'; }
  function validate(form) {
    var ok = true, first = null;
    $$('ui-field', form).forEach(function (f) {
      var lab = $('[data-flux-label]', f), ctl = $('[data-flux-control]', f), err = $('[data-flux-error]', f);
      if (!lab || !ctl || !err) return;
      var need = /\bRequired\b/.test(lab.textContent) || ctl.hasAttribute('required');
      var empty = ctl.type === 'checkbox' ? !ctl.checked : !String(ctl.value || '').trim();
      if (need && empty) { ok = false; err.textContent = fieldMsg(ctl); err.classList.remove('hidden'); ctl.classList.add('demo-invalid'); first = first || ctl; }
      else { err.textContent = ''; err.classList.add('hidden'); ctl.classList.remove('demo-invalid'); }
    });
    if (first) { try { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    return ok;
  }
  function values(form) {
    var o = {};
    $$('[name]', form).forEach(function (el) {
      if (el.name === '_token' || el.type === 'file' || el.type === 'password' || /^q-/.test(el.name)) return;
      if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
    });
    return o;
  }
  /* Livewire normally fills form fields from its own state (wire:snapshot) in the browser. Do the same here. */
  function unwrap(v) { return (Array.isArray(v) && v.length === 2 && v[1] && typeof v[1] === 'object' && 's' in v[1]) ? v[0] : v; }
  function dig(data, path) {
    var cur = data, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { cur = unwrap(cur); if (cur === null || typeof cur !== 'object') return undefined; cur = cur[parts[i]]; }
    return unwrap(cur);
  }
  function hydrate() {
    $$('[wire\\:snapshot]').forEach(function (root) {
      var data; try { data = JSON.parse(root.getAttribute('wire:snapshot')).data; } catch (e) { return; }
      $$('[name]', root).forEach(function (el) {
        if (el.closest('[wire\\:snapshot]') !== root || el.name === '_token' || /^q-/.test(el.name)) return;
        var v = dig(data, el.name); if (v === undefined || (v !== null && typeof v === 'object')) return;
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.type === 'radio') el.checked = String(el.value) === String(v);
        else if (el.type === 'file' || el.type === 'password') return;
        else el.value = v === null ? '' : String(v);
      });
    });
  }
  function mainForm() { return $('form[wire\\:submit]'); }
  function prefill() {
    var f = mainForm(); if (!f) return;
    var saved = store.get('form:' + ROLE + ':' + PATH); if (!saved) return;
    Object.keys(saved).forEach(function (n) {
      var el = $('[name="' + esc(n) + '"]', f); if (!el) return;
      if (el.type === 'checkbox') el.checked = !!saved[n]; else if (el.type === 'radio') { var r = $('[name="' + esc(n) + '"][value="' + esc(saved[n]) + '"]', f); if (r) r.checked = true; } else el.value = saved[n];
    });
  }
  function authSubmit(form) {
    if (PATH === '/login') {
      var em = ($('input[name="email"]', form) || {}).value || '', who = em.split('@')[0].toLowerCase();
      go(['admin', 'manager', 'staff'].indexOf(who) > -1 ? who : 'admin', '/dashboard');
    } else if (PATH === '/forgot-password') toast('If that email exists, a reset link is on its way. (Demo: no email is sent.)', 'info');
    else toast('Registration is disabled in the demo. Use the Start page to pick a role.', 'info');
  }
  function onSubmit(e) {
    var form = e.target; if (!(form instanceof HTMLFormElement)) return;
    e.preventDefault(); e.stopPropagation();
    if (form.getAttribute('action') === '#logout') { go('guest', '/login'); return; }
    if (ROLE === 'guest') { if (validate(form)) authSubmit(form); return; }
    if (!validate(form)) return;
    if (form.hasAttribute('wire:submit')) {
      // forms.js saves known entities to DemoDB; other forms keep their values per page as before.
      if (!(window.DemoForms && window.DemoForms.save(form))) store.set('form:' + ROLE + ':' + PATH, values(form));
      var edit = /\/edit$/.test(PATH), create = /\/create$/.test(PATH);
      toast(create ? 'Created. (Demo: stored in your browser only.)' : 'Changes saved. (Demo: stored in your browser only.)');
      if (create || edit) setTimeout(function () { go(ROLE, listPath); }, 700);
    } else toast('Saved. (Demo: nothing is sent to a server.)');
  }

  /* ---------- clicks ---------- */
  function onClick(e) {
    var t = e.target;
    var wc = t.closest && t.closest('[wire\\:click]');
    if (wc) {
      var a = wc.getAttribute('wire:click') || '', m;
      if ((m = /^confirmDelete\((.+?)\)/.exec(a))) {
        pending = { id: m[1].replace(/['"]/g, ''), row: wc.closest('tr') };
        var modal = $$('ui-modal').filter(function (x) { return /delete|cannot be undone/i.test(x.textContent); })[0];
        e.preventDefault(); if (!openDialog(modal)) toast('Delete is not available here.', 'info'); return;
      }
      if (a === 'delete' || /^delete\(/.test(a)) {
        e.preventDefault(); closeDialogs();
        if (pending) { if (pending.row) pending.row.remove(); var ids = store.get(delKey, []); ids.push(pending.id); store.set(delKey, ids); if (window.DemoList) window.DemoList.removed(pending.id); pending = null; applyFilters(); toast('Deleted. (Demo: only in your browser.)'); }
        return;
      }
      if (/\$set\('deleteId', null\)|cancel/i.test(a)) { e.preventDefault(); closeDialogs(); pending = null; return; }
      if (/showFilters/.test(a)) { e.preventDefault(); toggleFilters(); return; }
      if (/toggle/i.test(a)) { e.preventDefault(); toast('Status changed. (Demo)', 'success'); return; }
      return;
    }
    var link = t.closest && t.closest('a[href="#"]');
    if (link) { e.preventDefault(); toast('That page is not part of the demo.', 'info'); }
    var lo = t.closest && t.closest('a[href="#logout"]');
    if (lo) { e.preventDefault(); go('guest', '/login'); }
  }

  /* ---------- init ---------- */
  function init() {
    bar();
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', function (e) { var c = e.target; if (c.classList && c.classList.contains('demo-invalid')) { c.classList.remove('demo-invalid'); var er = c.closest('ui-field') && $('[data-flux-error]', c.closest('ui-field')); if (er) { er.textContent = ''; er.classList.add('hidden'); } } });
    if (ROLE === 'guest' && PATH === '/login') {
      var em = $('input[name="email"]'), pw = $('input[name="password"]');
      if (em && !em.value) em.value = 'admin@inventory.com'; if (pw && !pw.value) pw.value = 'password';
    }
    applyDeleted(); initSearch(); hydrate(); prefill();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
