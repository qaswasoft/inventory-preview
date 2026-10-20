/* Swift Inventory demo - printable receipts for sales made in the demo.
 *
 * Invoices created in the browser (POS sale, invoice form) have no page of their own, so their receipt opens a
 * seeded receipt page with ?id=<invoice id> and this file redraws it from DemoDB, following
 * resources/views/pdf/receipt.blade.php (80 mm thermal layout, amounts without the currency symbol except TOTAL,
 * Code 128 barcode of the invoice number, which the Returns screen can scan). The page's own script then opens
 * the print dialog on load, as in the app.
 *
 * DemoReceipt.url(invoiceId) gives the link for the current role. */
(function () {
  'use strict';
  var SCRIPT = document.querySelector('script[data-path]');
  var PATH = (SCRIPT && SCRIPT.dataset.path) || '';
  var ROLE = (SCRIPT && SCRIPT.dataset.role) || 'admin';
  var ROOT = (SCRIPT && SCRIPT.dataset.root) || '../';
  var DB = window.DemoDB, DATA = window.DEMO_DATA || {};
  var CUR = (DATA.meta && DATA.meta.currency) || '$';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  var amt = function (n) { return num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var qty = function (n) { return (Math.round(num(n) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // A seeded invoice whose receipt page exists for every role.
  var seedId = function () { var s = (DATA.invoices || [])[0]; return s ? s.id : 1; };
  window.DemoReceipt = { url: function (id) { return ROOT + ROLE + '/invoices/' + seedId() + '/receipt/index.html?id=' + id; } };

  /* ---------- Code 128 (subsets B and C), port of App\Services\Barcode\Code128 ---------- */
  var PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ');
  function encode(data) {
    var values = [], set = null, i = 0, n = data.length;
    while (i < n) {
      var run = 0; while (i + run < n && /\d/.test(data[i + run])) run++;
      if (run >= 4 && (run >= 6 || i === 0 || i + run === n)) {
        if (set !== 'C') { values.push(set === null ? 105 : 99); set = 'C'; }
        for (var p = 0, pairs = Math.floor(run / 2); p < pairs; p++, i += 2) values.push(parseInt(data.substr(i, 2), 10));
        continue;
      }
      if (set !== 'B') { values.push(set === null ? 104 : 100); set = 'B'; }
      var o = data.charCodeAt(i); values.push((o >= 32 && o <= 126 ? o : 63) - 32); i++;
    }
    if (!values.length) values.push(104);
    var sum = values[0]; for (var k = 1; k < values.length; k++) sum += values[k] * k;
    values.push(sum % 103, 106);
    return values;
  }
  function barcode(data, height, mw) {
    var x = 10, rects = '';
    encode(data).forEach(function (v) {
      PATTERNS[v].split('').forEach(function (w, idx) {
        w = +w; if (idx % 2 === 0) rects += '<rect x="' + +(x * mw).toFixed(3) + '" y="0" width="' + +(w * mw).toFixed(3) + '" height="' + height + '"/>';
        x += w;
      });
    });
    var width = +((x + 10) * mw).toFixed(2);
    return '<svg xmlns="http://www.w3.org/2000/svg" class="code128" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="' + esc(data) + '"><g fill="#000">' + rects + '</g></svg>';
  }
  window.DemoReceipt.barcode = barcode;

  /* ---------- redraw the receipt ---------- */
  var m = /^\/invoices\/\d+\/receipt$/.exec(PATH), id = (/[?&]id=(\d+)/.exec(location.search) || [])[1];
  if (!m || !id || !DB) return;
  var inv = DB.find('invoices', id);
  if (!inv) { document.body.innerHTML = '<p style="padding:8mm;font-family:sans-serif">This receipt is not in this browser any more (the demo data was reset).</p>'; return; }

  var created = new Date(inv.created_at || inv.date), d = new Date(inv.date || created);
  var dateStr = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(created.getHours()) + ':' + pad(created.getMinutes());
  var lines = inv.lines || [];
  var wh = DB.all('warehouses').filter(function (w) { return w.is_default; })[0];
  var cust = inv.customer_id ? DB.find('customers', inv.customer_id) : null;
  var acct = inv.account_id ? DB.find('accounts', inv.account_id) : null;
  var row = function (a, b, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + a + '</td><td>' + b + '</td></tr>'; };
  var $ = function (s) { return document.querySelector(s); };

  document.title = 'Receipt ' + inv.number;
  var meta = $('table.meta');
  if (meta) meta.innerHTML = '<tr><td>Receipt</td><td class="bold">' + esc(inv.number) + '</td></tr>' +
    row('Date', dateStr) + row('Cashier', esc(inv.created_by || 'Admin User')) + (wh ? row('Outlet', esc(wh.name)) : '') +
    row('Customer', esc(inv.customer || 'Walk-in')) + (inv.customer_phone ? row('Phone', esc(inv.customer_phone)) : '') +
    (cust ? row('Member', esc(cust.member_no || 'MEM-' + String(cust.id).padStart(6, '0'))) : '');

  var tb = $('table.items tbody');
  if (tb) tb.innerHTML = lines.map(function (l) {
    var net = num(l.price) * num(l.quantity) - num(l.discount) * num(l.quantity), sub = net * (1 + num(l.tax_rate) / 100);
    return '<tr><td colspan="3" class="item-name bold">' + esc(l.name) + '</td></tr><tr><td class="muted">' + amt(l.price) +
      (num(l.discount) > 0 ? ' − ' + amt(l.discount) : '') + (num(l.tax_rate) > 0 ? ' (+' + +num(l.tax_rate).toFixed(2) + '%)' : '') +
      '</td><td class="r">× ' + qty(l.quantity) + '</td><td class="r bold">' + amt(sub) + '</td></tr>';
  }).join('');

  var totals = document.querySelectorAll('table.totals');
  // totals[0] = breakdown, [1] = grand total, [2] = payment
  if (totals[0]) totals[0].innerHTML = row('Subtotal', amt(inv.subtotal)) + (num(inv.discount) > 0 ? row('Discount', '−' + amt(inv.discount)) : '') +
    (num(inv.tax) > 0 ? row('Tax', amt(inv.tax)) : '') + (num(inv.courier) > 0 ? row('Courier', amt(inv.courier)) : '');
  if (totals[1]) totals[1].innerHTML = row('TOTAL', CUR + amt(inv.total));
  var method = String(inv.payment_method || 'Paid').replace(/_/g, ' ');
  method = method.charAt(0).toUpperCase() + method.slice(1);
  if (acct) method += ' (' + esc(acct.name) + (acct.account_number ? ' ••' + esc(String(acct.account_number).slice(-4)) : '') + ')';
  if (totals[2]) totals[2].innerHTML = row(method, amt(inv.paid)) + (num(inv.due) > 0 ? row('Balance Due', amt(inv.due), 'bold') : '');

  var footer = $('.thanks') && $('.thanks').parentElement;
  if (footer) {
    var count = lines.reduce(function (s, l) { return s + num(l.quantity); }, 0);
    var muted = footer.querySelectorAll('.muted');
    if (muted[0]) muted[0].textContent = qty(count) + ' ' + (count === 1 ? 'item' : 'items') + ' · ' + pad(created.getDate()) + ' ' + MONTHS[created.getMonth()] + ' ' + created.getFullYear() + ', ' + pad(created.getHours()) + ':' + pad(created.getMinutes());
    var svg = footer.querySelector('svg.code128'); if (svg) svg.outerHTML = barcode(inv.number, 34, 1.2);
    if (muted[1]) muted[1].textContent = inv.number;
  }
})();
