/* Swift Inventory demo - DemoDB: a tiny record store in localStorage, seeded from window.DEMO_DATA (demo/data.js).
 * Keys: swiftdemo:v1:db:<table>. The Reset button in demo.js removes every swiftdemo:v1: key, so the next read
 * falls back to the seed again. Changes fire a 'demodb:change' event on window ({detail: {table, action, record}}). */
(function () {
  'use strict';
  var PFX = 'swiftdemo:v1:db:';
  var SEED = window.DEMO_DATA || {};
  var mem = {}; // fallback when localStorage is unavailable (private mode, file:// quirks)

  var clone = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
  function read(table) {
    try { var v = localStorage.getItem(PFX + table); if (v !== null) return JSON.parse(v); } catch (e) {}
    if (table in mem) return clone(mem[table]);
    return clone(SEED[table]);
  }
  function write(table, value) {
    mem[table] = clone(value);
    try { localStorage.setItem(PFX + table, JSON.stringify(value)); } catch (e) {}
  }
  function emit(table, action, record) {
    try { window.dispatchEvent(new CustomEvent('demodb:change', { detail: { table: table, action: action, record: clone(record) } })); } catch (e) {}
  }
  var same = function (a, b) { return String(a) === String(b); };

  var DemoDB = {
    tables: function () { return Object.keys(SEED).filter(function (k) { return Array.isArray(SEED[k]); }); },
    meta: function () { return clone(SEED.meta || {}); },
    all: function (table) { var v = read(table); return Array.isArray(v) ? v : []; },
    find: function (table, id) { return DemoDB.all(table).filter(function (r) { return same(r.id, id); })[0] || null; },
    where: function (table, fn) { return DemoDB.all(table).filter(fn); },
    get: function (key, dflt) { var v = read(key); return v === undefined || v === null ? dflt : v; },
    set: function (key, value) { write(key, value); emit(key, 'set', value); return value; },
    nextId: function (table) { return DemoDB.all(table).reduce(function (m, r) { return Math.max(m, +r.id || 0); }, 0) + 1; },

    /* Insert (no id or unknown id) or merge-update by id. Returns the stored record. */
    save: function (table, record) {
      var rows = DemoDB.all(table), rec = clone(record) || {}, i = -1;
      if (rec.id !== undefined && rec.id !== null && rec.id !== '') rows.forEach(function (r, k) { if (same(r.id, rec.id)) i = k; });
      var action = i > -1 ? 'update' : 'create';
      rec.updated_at = new Date().toISOString(); // lists.js only rewrites rows of records that have this
      if (i > -1) { rec = Object.assign({}, rows[i], rec); rows[i] = rec; }
      else {
        if (rec.id === undefined || rec.id === null || rec.id === '') rec.id = DemoDB.nextId(table);
        rec.created_at = rec.created_at || new Date().toISOString();
        rows.push(rec);
      }
      write(table, rows); emit(table, action, rec);
      return clone(rec);
    },
    remove: function (table, id) {
      var rows = DemoDB.all(table), gone = rows.filter(function (r) { return same(r.id, id); })[0];
      if (!gone) return false;
      write(table, rows.filter(function (r) { return !same(r.id, id); })); emit(table, 'delete', gone);
      return true;
    },
    /* Add (or subtract with a negative qty) product stock. */
    adjustStock: function (productId, qty) {
      var p = DemoDB.find('products', productId); if (!p) return null;
      return DemoDB.save('products', { id: p.id, stock: Math.round(((+p.stock || 0) + (+qty || 0)) * 1000) / 1000 });
    },

    /* Next document number, e.g. nextNo('invoices', 'number', 'INV') -> INV-2026-0007 (per-year sequence). */
    nextNo: function (table, field, prefix) {
      var year = new Date().getFullYear(), head = prefix + '-' + year + '-', max = 0;
      DemoDB.all(table).forEach(function (r) {
        var n = String(r[field] || '');
        if (n.indexOf(head) === 0) max = Math.max(max, parseInt(n.slice(head.length), 10) || 0);
      });
      return head + String(max + 1).padStart(4, '0');
    },
    nextInvoiceNo: function () { return DemoDB.nextNo('invoices', 'number', 'INV'); },

    /* Drop stored tables so reads fall back to the seed (the toolbar Reset clears these keys too). */
    reset: function () {
      mem = {};
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf(PFX) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
      emit('*', 'reset', null);
    },
    on: function (fn, table) {
      var h = function (e) { if (!table || e.detail.table === table || e.detail.table === '*') fn(e.detail); };
      window.addEventListener('demodb:change', h);
      return function () { window.removeEventListener('demodb:change', h); };
    }
  };

  // Other tabs: turn storage events for our keys into the same change event.
  window.addEventListener('storage', function (e) {
    if (e.key === null) { mem = {}; emit('*', 'reset', null); }
    else if (e.key.indexOf(PFX) === 0) { delete mem[e.key.slice(PFX.length)]; emit(e.key.slice(PFX.length), 'sync', null); }
  });

  window.DemoDB = DemoDB;
})();
