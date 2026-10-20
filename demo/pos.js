/* Swift Inventory demo - the POS terminal without a server (stand-in for app/Livewire/Pos/PosTerminal.php).
 *
 * The page's own Alpine code already derives every total from $wire.cart / discount / tax / courier, so this
 * file keeps that state in DemoWire, draws the cart rows (the Blade loop is server-side), and implements the
 * actions: quickAdd, qty +/-, remove, clear, weigh (loose goods), register member, hold / resume, the payment
 * modal (cash / card / mobile / bank, sell on due) and completeSale, which saves an invoice to DemoDB and takes
 * the sold quantities off product stock. The open order lives in localStorage (swiftdemo:v1:db:pos_state). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SCRIPT = $('script[data-path]');
  var PATH = (SCRIPT && SCRIPT.dataset.path) || '';
  var ROLE = (SCRIPT && SCRIPT.dataset.role) || 'admin';
  var ROOT = (SCRIPT && SCRIPT.dataset.root) || '../';
  if (!/^\/pos/.test(PATH)) return;

  var W = window.DemoWire, DB = window.DemoDB, DATA = window.DEMO_DATA || {};
  if (!W || !DB) return;
  var CUR = (DATA.meta && DATA.meta.currency) || '$';
  var USER = { admin: 'Admin User', manager: 'Manager User', staff: 'Staff User' }[ROLE] || 'Admin User';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  var money = function (n) { return CUR + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var fmtQty = function (n) { return (Math.round(num(n) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); };
  var toast = function (t, v) { if (window.DemoToast) window.DemoToast(t, v || 'success'); };
  var memberNo = function (c) { return c.member_no || 'MEM-' + String(c.id).padStart(6, '0'); };

  /* ---------- state ---------- */
  var KEEP = ['cart', 'discount', 'tax', 'hasCourier', 'courierCharge', 'courierCost', 'customer_id'];
  var pay = { method: 'cash', payLater: false };
  var weighing = null, lastInvoice = null, successAt = 0;
  function save() { var o = {}; KEEP.forEach(function (k) { o[k] = W.get(k); }); DB.set('pos_state', JSON.parse(JSON.stringify(o))); }
  function cart() { return (W.get('cart') || []).map(function (i) { return Object.assign({}, i); }); }
  function setCart(items) { W.set('cart', items); save(); render(); }

  // Same formulas as the page's Alpine `totals` (and PosTerminal's computed properties).
  function totals() {
    var items = cart(), net = function (i) { return num(i.price) * num(i.quantity) - num(i.discount) * num(i.quantity); };
    var subtotal = items.reduce(function (s, i) { return s + net(i); }, 0);
    var tax = items.reduce(function (s, i) { return s + net(i) * num(i.tax_rate) / 100; }, 0) + num(W.get('tax'));
    var courier = W.get('hasCourier') ? num(W.get('courierCharge')) : 0;
    return { subtotal: subtotal, tax: tax, courier: courier, total: round2(Math.max(0, subtotal - num(W.get('discount')) - num(W.get('membershipDiscount')) + tax + courier)) };
  }
  // Per-unit discount, as PricingService::productDiscount() (no promotions in the demo data).
  function unitDiscount(p) { return p.discount_type === 'fixed' ? num(p.discount) : num(p.price) * num(p.discount) / 100; }
  var isLoose = function (p) { return p.unit && p.unit !== 'pcs'; };

  /* ---------- modals ---------- */
  var MODALS = { payment: 'showPaymentModal', register: 'showRegisterCustomer', weigh: 'showWeighModal', hold: 'showHoldModal', held: 'showHeldList', success: 'showSuccessModal' };
  var dialog = function (k) { var m = $('ui-modal[wire\\:model\\.self="' + MODALS[k] + '"]'); return m && $('dialog', m); };
  function openModal(k) {
    var d = dialog(k); if (!d) return null;
    W.set(MODALS[k], true);
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
    return d;
  }
  function closeModal(k) { var d = dialog(k); W.set(MODALS[k], false); if (d && d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } } }
  Object.keys(MODALS).forEach(function (k) { var d = dialog(k); if (d) d.addEventListener('close', function () { W.set(MODALS[k], false); }); });
  var anyModal = function () { return Object.keys(MODALS).some(function (k) { var d = dialog(k); return d && d.open; }); };

  /* ---------- cart rendering (markup of the Blade cart loop) ---------- */
  var BTN_XS = 'relative items-center font-medium justify-center gap-2 whitespace-nowrap disabled:opacity-75 disabled:cursor-default disabled:pointer-events-none h-6 text-xs rounded-md w-6 inline-flex bg-transparent hover:bg-zinc-800/5 dark:hover:bg-white/15 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white';
  var MICRO = function (d) { return '<svg class="shrink-0 [:where(&)]:size-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="' + d + '"/></svg>'; };
  var I_MINUS = MICRO('M3.75 7.25a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z');
  var I_PLUS = MICRO('M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z');
  var I_X = MICRO('M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z');
  var I_TRASH = MICRO('M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5Z');
  var NUM_IN = 'border-0 bg-transparent p-0 text-sm font-semibold tabular-nums text-zinc-900 focus:outline-none focus:ring-0 dark:text-white [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

  var heading = $$('[data-flux-heading]').filter(function (h) { return h.textContent.trim() === 'Current Order'; })[0];
  var header = heading && heading.closest('.h-13');
  var itemsBox = header && header.nextElementSibling;
  var emptyState = itemsBox && itemsBox.firstElementChild;
  var cartHost = document.createElement('div');
  if (itemsBox) itemsBox.appendChild(cartHost);
  var headExtra = document.createElement('span'); headExtra.className = 'contents';
  if (heading) heading.parentElement.appendChild(headExtra);
  var clearBtn = document.createElement('button');
  clearBtn.type = 'button'; clearBtn.className = BTN_XS.replace(' w-6', ' px-2'); clearBtn.innerHTML = I_TRASH + 'Clear';
  clearBtn.addEventListener('click', function () { actions.clearCart(); });
  if (header) header.appendChild(clearBtn);
  var itemsCount = $$('span').filter(function (s) { return s.textContent.trim() === 'Items' && s.nextElementSibling; }).map(function (s) { return s.nextElementSibling; })[0];
  var checkoutBtn = $('button[wire\\:click="openPaymentModal"]');

  function render() {
    var items = cart();
    if (emptyState) emptyState.style.display = items.length ? 'none' : '';
    clearBtn.style.display = items.length ? '' : 'none';
    headExtra.innerHTML = items.length ? '<div data-flux-badge class="inline-flex items-center font-medium whitespace-nowrap text-xs py-0.5 px-1.5 rounded-md bg-zinc-400/15 text-zinc-700 dark:bg-zinc-400/40 dark:text-zinc-200">' + items.length + '</div>' : '';
    if (itemsCount) itemsCount.textContent = items.length;
    if (checkoutBtn) { if (items.length) checkoutBtn.removeAttribute('disabled'); else checkoutBtn.setAttribute('disabled', 'disabled'); }
    if (!items.length) { cartHost.innerHTML = ''; return; }
    cartHost.innerHTML = '<table class="w-full text-sm"><thead><tr class="border-b border-zinc-200 text-[0.6875rem] uppercase tracking-wider text-zinc-500 dark:border-zinc-800">' +
      '<th class="sticky top-0 bg-zinc-50 px-4 py-2 text-left font-semibold dark:bg-zinc-900">Product</th>' +
      '<th class="sticky top-0 w-36 bg-zinc-50 px-2 py-2 text-center font-semibold dark:bg-zinc-900">Qty</th>' +
      '<th class="sticky top-0 w-24 bg-zinc-50 px-2 py-2 text-right font-semibold dark:bg-zinc-900">Price</th>' +
      '<th class="sticky top-0 w-28 bg-zinc-50 px-2 py-2 text-right font-semibold dark:bg-zinc-900">Total</th>' +
      '<th class="sticky top-0 w-12 bg-zinc-50 dark:bg-zinc-900"></th></tr></thead><tbody>' +
      items.map(function (it, i) {
        var net = num(it.price) * num(it.quantity) - num(it.discount) * num(it.quantity), line = net * (1 + num(it.tax_rate) / 100);
        var qty = it.loose
          ? '<div class="mx-auto flex w-fit items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-700"><input type="number" step="0.001" min="0.001" max="' + it.max_quantity + '" value="' + it.quantity + '" data-qty="' + i + '" class="w-16 text-right ' + NUM_IN + '"><span class="text-xs text-zinc-500">' + esc(it.unit) + '</span></div>'
          : '<div class="mx-auto flex w-fit items-center gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"><button type="button" data-dec="' + i + '" class="' + BTN_XS + '" aria-label="Less">' + I_MINUS + '</button>' +
            '<input type="number" min="1" max="' + it.max_quantity + '" value="' + it.quantity + '" data-qty="' + i + '" class="w-11 text-center ' + NUM_IN + '">' +
            '<button type="button" data-inc="' + i + '" class="' + BTN_XS + '" aria-label="More">' + I_PLUS + '</button></div>';
        return '<tr class="border-b border-zinc-100 transition-colors last:border-0 dark:border-zinc-800/70 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">' +
          '<td class="px-4 py-3"><div class="font-medium text-zinc-900 dark:text-white">' + esc(it.name) + '</div><div class="mt-0.5 font-mono text-xs text-zinc-500">' + esc(it.sku) + '</div>' +
          (num(it.discount) > 0 ? '<div class="mt-0.5 text-xs text-green-600 dark:text-green-400">−' + money(it.discount) + (it.loose ? '/' + esc(it.unit) : ' each') + '</div>' : '') + '</td>' +
          '<td class="px-2 py-3">' + qty + '</td>' +
          '<td class="px-2 py-3 text-right tabular-nums text-zinc-500">' + money(it.price) + (it.loose ? '<span class="text-xs">/' + esc(it.unit) + '</span>' : '') + '</td>' +
          '<td class="px-2 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">' + money(line) + '</td>' +
          '<td class="px-2 py-3 text-right"><button type="button" data-remove="' + i + '" class="' + BTN_XS + '" aria-label="Remove">' + I_X + '</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  cartHost.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.inc !== undefined) setQty(+b.dataset.inc, cart()[+b.dataset.inc].quantity + 1);
    else if (b.dataset.dec !== undefined) { var i = +b.dataset.dec, it = cart()[i]; if (it.quantity > 1) setQty(i, it.quantity - 1); else actions.removeFromCart(i); }
    else if (b.dataset.remove !== undefined) actions.removeFromCart(+b.dataset.remove);
  });
  cartHost.addEventListener('change', function (e) { if (e.target.dataset.qty !== undefined) setQty(+e.target.dataset.qty, e.target.value); });

  // Clamped to stock like PosTerminal::updateQty(): loose goods to 3 decimals, counted goods whole.
  function setQty(i, value) {
    var items = cart(), it = items[i]; if (!it) return;
    var want = it.loose ? Math.round(num(value) * 1000) / 1000 : Math.trunc(num(value));
    var q = it.loose ? Math.max(0.001, Math.min(want || 0.001, it.max_quantity)) : Math.max(1, Math.min(want || 1, it.max_quantity));
    if (want > it.max_quantity) toast('Only ' + fmtQty(it.max_quantity) + ' ' + it.unit + ' of ' + it.name + ' in stock.', 'warning');
    it.quantity = q; setCart(items);
  }
  function addProduct(p, qty) {
    var items = cart(), stock = num(p.stock), it = items.filter(function (x) { return String(x.product_id) === String(p.id); })[0];
    var have = it ? it.quantity : 0;
    if (stock <= 0) { toast(p.name + ' is out of stock.', 'danger'); return false; }
    if (have + qty > stock) { toast('Only ' + fmtQty(stock) + ' ' + (p.unit || 'pcs') + ' of ' + p.name + ' in stock.', 'warning'); qty = Math.max(0, stock - have); if (!qty) return false; }
    if (it) it.quantity = Math.round((have + qty) * 1000) / 1000;
    else items.push({ product_id: p.id, name: p.name, sku: p.sku, price: num(p.price), discount: Math.min(unitDiscount(p), num(p.price)), tax_rate: num(p.tax_rate),
      quantity: qty, unit: p.unit || 'pcs', loose: isLoose(p), max_quantity: stock, is_gift: false, promotion_label: null });
    setCart(items); return true;
  }

  /* ---------- payment modal ---------- */
  var payDlg = dialog('payment');
  var SEL = 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900';
  var UNSEL = 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
  var swap = function (el, off, on) { off.split(' ').forEach(function (c) { el.classList.remove(c); }); on.split(' ').forEach(function (c) { el.classList.add(c); }); };
  var cashBox = payDlg && $('input[wire\\:model="amountReceived"]', payDlg) && $('input[wire\\:model="amountReceived"]', payDlg).closest('[x-data]');
  var dueSwitch = payDlg && $('ui-switch[wire\\:model\\.live="payLater"]', payDlg);
  var dueBox = dueSwitch && dueSwitch.closest('.rounded-xl');
  var SELECT_CLS = 'appearance-none w-full ps-3 pe-10 block h-10 py-2 text-base sm:text-sm leading-[1.375rem] rounded-lg shadow-xs border bg-white dark:bg-white/10 text-zinc-700 dark:text-zinc-300 border-zinc-200 border-b-zinc-300/80 dark:border-white/10';
  var INPUT_CLS = cashBox ? $('input', cashBox).className : 'w-full border rounded-lg block h-10 ps-3 pe-3 text-sm';
  var LABEL = '<div class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">%s</div>';
  var accountField = document.createElement('div'), laterBox = document.createElement('div');
  laterBox.className = 'mt-3 space-y-3';
  if (dueBox) { dueBox.parentElement.insertBefore(accountField, dueBox); dueBox.appendChild(laterBox); }

  var ACCOUNT_TYPES = { card: ['card'], mobile_banking: ['mobile_banking', 'mobile'], bank_transfer: ['bank'] };
  function drawPayment() {
    if (!payDlg) return;
    var t = totals(), items = cart();
    var amount = $$('div', payDlg).filter(function (d) { return /text-4xl/.test(d.className); })[0];
    if (amount) amount.textContent = money(t.total);
    var countTxt = amount && amount.nextElementSibling;
    if (countTxt) countTxt.textContent = items.length + ' ' + (items.length === 1 ? 'item' : 'items');
    $$('button[wire\\:click^="setPaymentMethod"]', payDlg).forEach(function (b) {
      var on = b.getAttribute('wire:click').indexOf("'" + pay.method + "'") > -1;
      swap(b, on ? UNSEL : SEL, on ? SEL : UNSEL);
    });
    var types = ACCOUNT_TYPES[pay.method];
    if (types) {
      var accts = DB.all('accounts').filter(function (a) { return a.is_active !== false && types.indexOf(a.type) > -1; });
      var label = { card: 'Card', mobile_banking: 'Wallet' }[pay.method] || 'Account';
      accountField.innerHTML = LABEL.replace('%s', label) + (accts.length
        ? '<select data-demo-account class="' + SELECT_CLS + '">' + accts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + (a.account_number ? ' ••' + esc(String(a.account_number).slice(-4)) : '') + '</option>'; }).join('') + '</select>'
        : '<div class="text-sm text-amber-600 dark:text-amber-400">No active accounts for this method.</div>') +
        (pay.method === 'mobile_banking' ? '<div class="mt-3">' + LABEL.replace('%s', 'Transaction ID') + '<input data-demo-ref class="' + INPUT_CLS + '" placeholder="e.g. 9BG7KX2LPQ"></div>' : '');
    } else accountField.innerHTML = '';
    if (dueSwitch) { if (pay.payLater) dueSwitch.setAttribute('data-checked', ''); else dueSwitch.removeAttribute('data-checked'); }
    laterBox.style.display = pay.payLater ? '' : 'none';
    if (pay.payLater && !laterBox.innerHTML) {
      laterBox.innerHTML = '<div data-demo-needcust class="text-xs text-amber-600 dark:text-amber-400">Select a customer before completing a due sale.</div>' +
        '<div>' + LABEL.replace('%s', 'Paying now') + '<input type="number" step="0.01" min="0" data-demo-paidnow class="' + INPUT_CLS + '" value="0"></div>' +
        '<div class="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30"><span class="text-sm font-medium text-red-700 dark:text-red-300">Due</span><span data-demo-due class="font-semibold tabular-nums text-red-700 dark:text-red-400"></span></div>';
      $('[data-demo-paidnow]', laterBox).addEventListener('input', drawDue);
    }
    drawDue();
    if (cashBox) {
      cashBox.style.display = pay.method === 'cash' && !pay.payLater ? '' : 'none';
      try { var d = window.Alpine.$data(cashBox); d.total = t.total; } catch (e) {}
    }
  }
  function drawDue() {
    var n = $('[data-demo-needcust]', laterBox); if (n) n.style.display = W.get('customer_id') ? 'none' : '';
    var p = $('[data-demo-paidnow]', laterBox), d = $('[data-demo-due]', laterBox);
    if (d) d.textContent = Math.max(0, totals().total - num(p && p.value)).toFixed(2);
  }
  if (dueSwitch) dueSwitch.addEventListener('click', function () { setTimeout(function () { pay.payLater = !pay.payLater; drawPayment(); }, 0); });

  /* ---------- sale ---------- */
  function completeSale() {
    var items = cart(); if (!items.length) { toast('Add a product first.', 'warning'); return; }
    var t = totals(), method = pay.method, paid = t.total, change = 0, received = null;
    var acct = $('[data-demo-account]', accountField);
    if (ACCOUNT_TYPES[method] && !acct) { toast('Add an active account for this payment method first.', 'danger'); return; }
    if (pay.payLater) {
      if (!W.get('customer_id')) { toast('Select a customer before completing a due sale.', 'danger'); return; }
      paid = Math.min(t.total, Math.max(0, num(($('[data-demo-paidnow]', laterBox) || {}).value)));
    } else if (method === 'cash') {
      var inp = cashBox && $('input', cashBox), raw = inp ? inp.value.trim() : '';
      received = raw === '' ? t.total : num(raw);
      if (received + 0.005 < t.total) { toast('Amount received is less than the total.', 'danger'); if (inp) inp.focus(); return; }
      change = round2(received - t.total);
    }
    var cust = W.get('customer_id') ? DB.find('customers', W.get('customer_id')) : null;
    var due = round2(t.total - paid);
    var inv = DB.save('invoices', {
      number: DB.nextInvoiceNo(), created_by: USER, customer: cust ? cust.name : 'Walk-in Customer', customer_phone: cust ? cust.phone || '' : '', customer_id: cust ? cust.id : null,
      items: items.length, subtotal: round2(t.subtotal), tax: round2(t.tax), discount: num(W.get('discount')), courier: t.courier,
      total: t.total, paid: round2(paid), due: due, change: change, received: received, payment_method: method, account_id: acct ? +acct.value : null,
      reference: ($('[data-demo-ref]', accountField) || {}).value || '', date: new Date().toISOString().slice(0, 10),
      status: due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'sent', editable: false, source: 'pos',
      lines: items.map(function (i) { return { product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unit: i.unit, price: i.price, discount: i.discount, tax_rate: i.tax_rate }; })
    });
    items.forEach(function (i) { DB.adjustStock(i.product_id, -i.quantity); });
    lastInvoice = inv;
    resetOrder();
    closeModal('payment');
    showSuccess(inv);
  }
  var OUTLINE = 'relative inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 border-b-zinc-300/80 bg-white px-4 text-sm font-medium text-zinc-800 shadow-xs hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600/75';
  var OUT_ICON = function (d) { return '<svg class="shrink-0 size-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="' + d + '"/></svg>'; };
  var I_RECEIPT = OUT_ICON('m9 14.25 6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185ZM9.75 9h.008v.008H9.75V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm4.125 4.5h.008v.008h-.008V13.5Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z');
  var I_DOC = OUT_ICON('M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z');
  var METHOD = { cash: 'Cash', card: 'Card', mobile_banking: 'Mobile banking', bank_transfer: 'Bank transfer' };
  function showSuccess(inv) {
    successAt = Date.now();
    var d = openModal('success'); if (!d) { toast('Sale completed: ' + inv.number); return; }
    var host = $('.demo-success', d);
    if (!host) { var h = $$('[data-flux-heading]', d)[0]; host = document.createElement('div'); host.className = 'demo-success'; if (h) h.parentElement.insertBefore(host, h.nextSibling); }
    host.innerHTML = '<div class="mt-1 font-mono text-sm text-zinc-500">' + esc(inv.number) + '</div>' +
      '<div class="mt-5 mb-5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-left">' +
      '<div class="flex items-center justify-between px-4 py-3"><span class="text-sm text-zinc-500">' + (inv.due > 0 ? 'Paid now' : 'Total paid') + '</span><span class="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">' + money(inv.paid) + '</span></div>' +
      (inv.due > 0 ? '<div class="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800"><span class="text-sm text-zinc-500">Due</span><span class="text-sm font-semibold text-red-600 dark:text-red-400">' + money(inv.due) + '</span></div>' : '') +
      (inv.change > 0 ? '<div class="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800"><span class="text-sm text-zinc-500">Change</span><span class="text-sm font-medium text-zinc-900 dark:text-white">' + money(inv.change) + '</span></div>' : '') +
      '<div class="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800"><span class="text-sm text-zinc-500">Method</span><span class="text-sm font-medium text-zinc-900 dark:text-white">' + METHOD[inv.payment_method] + '</span></div></div>' +
      // Same pair as the app: Receipt (opens the 80 mm slip, which prints itself) and Invoice.
      '<div class="mb-3 grid grid-cols-2 gap-2">' +
      '<a href="' + (window.DemoReceipt ? window.DemoReceipt.url(inv.id) : '#') + '" target="_blank" data-demo-receipt class="' + OUTLINE + '">' + I_RECEIPT + 'Receipt</a>' +
      '<a href="' + ROOT + ROLE + '/invoices/index.html" class="' + OUTLINE + '">' + I_DOC + 'Invoices</a></div>';
  }
  function resetOrder() {
    W.set('discount', 0); W.set('tax', 0); W.set('hasCourier', false); W.set('courierCharge', 0); W.set('courierCost', '');
    syncInputs();
    pay.payLater = false; pay.method = 'cash';
    var cb = $('[wire\\:key="search-customerSearch-input"]'), chip = cb && cb.parentElement.querySelector('.demo-chip');
    if (chip) chip.click(); else W.set('customer_id', null);
    setCart([]);
  }

  /* ---------- held sales ---------- */
  var heldBtn = $('button[wire\\:click="$set(\'showHeldList\', true)"]');
  function drawHeld() {
    var held = DB.get('held_sales', []);
    if (heldBtn) {
      var b = $('.demo-held-count', heldBtn);
      if (!b) { b = document.createElement('span'); b.className = 'demo-held-count ml-1 inline-flex items-center rounded-md bg-amber-400/25 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-400/40 dark:text-amber-100'; heldBtn.appendChild(b); }
      b.textContent = held.length; b.style.display = held.length ? '' : 'none';
    }
    var d = dialog('held'), list = d && $('.mt-4.space-y-2', d); if (!list) return;
    var PRIMARY = 'relative inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium h-6 text-xs rounded-md px-2 bg-[var(--color-accent)] hover:bg-[color-mix(in_oklab,_var(--color-accent),_transparent_10%)] text-[var(--color-accent-foreground)] border border-black/10 dark:border-0';
    list.innerHTML = held.length ? held.map(function (h) {
      var mins = Math.max(0, Math.round((Date.now() - new Date(h.created_at)) / 60000));
      return '<div class="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><div class="min-w-0">' +
        '<div class="truncate font-medium text-zinc-900 dark:text-white">' + esc(h.label) + '</div><div class="text-xs text-zinc-500">' + h.cart.length + ' ' + (h.cart.length === 1 ? 'item' : 'items') + ' · ' + money(h.total) +
        ' · ' + (mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : Math.round(mins / 60) + ' h ago') + ' · ' + esc(h.by) + '</div></div>' +
        '<div class="flex shrink-0 gap-1"><button type="button" data-resume="' + h.id + '" class="' + PRIMARY + '">Resume</button><button type="button" data-discard="' + h.id + '" class="' + BTN_XS + '" aria-label="Discard">' + I_TRASH + '</button></div></div>';
    }).join('') : '<div class="py-8 text-center text-sm text-zinc-400">No held sales. Press <kbd class="rounded border px-1">F4</kbd> during a sale to hold it.</div>';
  }
  (function () {
    var d = dialog('held'); if (!d) return;
    d.addEventListener('click', function (e) {
      var r = e.target.closest('[data-resume]'), x = e.target.closest('[data-discard]');
      if (r) actions.resumeHeld(+r.dataset.resume);
      if (x && window.confirm('Discard this held sale?')) actions.discardHeld(+x.dataset.discard);
    });
  })();

  /* ---------- inputs bound with wire:model (Livewire did this) ---------- */
  var BOUND = ['discount', 'tax', 'courierCharge', 'courierCost', 'weighQuantity'];
  function syncInputs() {
    BOUND.forEach(function (k) { var el = $('input[wire\\:model="' + k + '"]'); if (el && document.activeElement !== el) el.value = W.get(k) === 0 || W.get(k) == null ? (k === 'courierCost' || k === 'weighQuantity' ? '' : '0') : W.get(k); });
    var cb = $('ui-checkbox[wire\\:model="hasCourier"]');
    if (cb) { if (W.get('hasCourier')) cb.setAttribute('data-checked', ''); else cb.removeAttribute('data-checked'); }
  }
  BOUND.forEach(function (k) { var el = $('input[wire\\:model="' + k + '"]'); if (el) el.addEventListener('input', function () { W.set(k, el.value); if (k !== 'weighQuantity') save(); }); });
  (function () {
    var cb = $('ui-checkbox[wire\\:model="hasCourier"]'); if (!cb) return;
    cb.addEventListener('click', function () { setTimeout(function () { W.set('hasCourier', cb.hasAttribute('data-checked')); save(); }, 0); });
  })();

  /* ---------- actions ($wire.x(), wire:click="x" and wire:submit="x") ---------- */
  var actions = {
    quickAdd: function (id) {
      var p = DB.find('products', id); if (!p) return;
      if (isLoose(p)) { actions.openWeigh(p); return; }
      addProduct(p, 1);
    },
    openWeigh: function (p) {
      if (num(p.stock) <= 0) { toast(p.name + ' is out of stock.', 'danger'); return; }
      weighing = p; W.set('weighQuantity', '');
      var d = openModal('weigh'); if (!d) return;
      var h = $('[data-flux-heading]', d); if (h) h.textContent = p.name;
      var txt = h && h.nextElementSibling;
      if (!txt || !txt.hasAttribute('data-flux-text')) { txt = document.createElement('div'); txt.setAttribute('data-flux-text', ''); txt.className = 'mt-1 text-sm text-zinc-500 dark:text-white/70'; h.parentElement.appendChild(txt); }
      txt.textContent = money(p.price) + ' per ' + p.unit + ' · put it on the scale and type the weight.';
      var box = $('[x-data*="price"]', d); try { window.Alpine.$data(box).price = num(p.price); } catch (e) {}
      var w = $('input[wire\\:model="weighQuantity"]', d); if (w) { w.value = ''; setTimeout(function () { w.focus(); }, 50); }
    },
    confirmWeight: function () {
      var q = Math.round(num(W.get('weighQuantity')) * 1000) / 1000;
      if (!weighing) return;
      if (q <= 0) { toast('Type the weight first.', 'warning'); return; }
      if (addProduct(weighing, q)) closeModal('weigh');
    },
    removeFromCart: function (i) { var items = cart(); items.splice(i, 1); setCart(items); },
    // Esc also reaches here from the page's window shortcut; an open modal takes that Esc instead.
    clearCart: function () { if (cart().length && !anyModal()) setCart([]); },
    openPaymentModal: function () {
      if (!cart().length) { toast('Add a product first.', 'warning'); return; }
      drawPayment(); openModal('payment');
      var inp = cashBox && $('input', cashBox);
      if (inp && pay.method === 'cash') { inp.value = ''; try { window.Alpine.$data(cashBox).received = ''; } catch (e) {} setTimeout(function () { inp.focus(); }, 50); }
    },
    setPaymentMethod: function (m) { if (!payDlg || !payDlg.open) return; pay.method = m; drawPayment(); },
    enableSplit: function () { toast('Split payments are not part of this demo. Pick one method.', 'info'); },
    disableSplit: function () {},
    completeSale: completeSale,
    // The Enter that completed the sale also reaches the success modal's Enter shortcut; ignore that one.
    newSale: function () { var d = dialog('success'); if (!d || !d.open || Date.now() - successAt < 400) return; closeModal('success'); var s = $('[data-placeholder^="Scan barcode"]'); if (s) s.focus(); },
    openHoldModal: function () {
      if (!cart().length) { toast('Nothing to hold yet.', 'warning'); return; }
      var d = openModal('hold'), l = d && $('input[wire\\:model="holdLabel"]', d); if (l) { l.value = ''; setTimeout(function () { l.focus(); }, 50); }
    },
    holdSale: function () {
      var items = cart(); if (!items.length) return;
      var held = DB.get('held_sales', []), l = $('input[wire\\:model="holdLabel"]'), cust = W.get('customer_id') ? DB.find('customers', W.get('customer_id')) : null;
      var id = held.reduce(function (m, h) { return Math.max(m, h.id); }, 0) + 1;
      held.push({ id: id, label: (l && l.value.trim()) || (cust ? cust.name : 'Held sale #' + id), cart: items, total: totals().total, customer_id: cust ? cust.id : null, by: USER, created_at: new Date().toISOString() });
      DB.set('held_sales', held);
      closeModal('hold'); resetOrder(); drawHeld();
      toast('Sale held. Resume it from Held.');
    },
    resumeHeld: function (id) {
      if (cart().length) { toast('Finish or hold the current sale first.', 'warning'); return; }
      var held = DB.get('held_sales', []), h = held.filter(function (x) { return x.id === id; })[0]; if (!h) return;
      // Resuming re-checks today's stock, like the real terminal.
      var items = h.cart.map(function (i) { var p = DB.find('products', i.product_id); if (!p) return null; i.max_quantity = num(p.stock); i.price = num(p.price); i.quantity = Math.min(i.quantity, i.max_quantity); return i.quantity > 0 ? i : null; }).filter(Boolean);
      DB.set('held_sales', held.filter(function (x) { return x.id !== id; }));
      setCart(items);
      if (h.customer_id) selectCustomerById(h.customer_id);
      closeModal('held'); drawHeld();
      if (items.length < h.cart.length) toast('Some items are out of stock now and were left out.', 'warning');
    },
    discardHeld: function (id) { DB.set('held_sales', DB.get('held_sales', []).filter(function (x) { return x.id !== id; })); drawHeld(); },
    openRegisterCustomer: function (q) {
      var d = openModal('register'); if (!d) return;
      var ph = $('input[wire\\:model="newCustomerPhone"]', d), nm = $('input[wire\\:model="newCustomerName"]', d);
      q = String(q || '').trim();
      if (ph) ph.value = /^[\d+\s-]+$/.test(q) ? q : '';
      if (nm) nm.value = /^[\d+\s-]+$/.test(q) ? '' : q;
      setTimeout(function () { (ph && !ph.value ? ph : nm || ph).focus(); }, 50);
    },
    registerCustomer: function (form) {
      var ph = $('input[wire\\:model="newCustomerPhone"]', form), nm = $('input[wire\\:model="newCustomerName"]', form);
      var phone = ph ? ph.value.trim() : '', name = nm ? nm.value.trim() : '';
      if (!phone || !name) { toast('Phone and name are required.', 'danger'); (phone ? nm : ph).focus(); return; }
      if (DB.all('customers').some(function (c) { return String(c.phone).replace(/\D/g, '') === phone.replace(/\D/g, ''); })) { toast('A customer with this phone already exists.', 'danger'); ph.focus(); return; }
      var c = DB.save('customers', { name: name, phone: phone, email: '', city: '', country: 'Bangladesh', is_active: true, orders: 0, spent: 0, balance: 0 });
      c = DB.save('customers', { id: c.id, member_no: memberNo(c) });
      closeModal('register');
      selectCustomerById(c.id);
      toast(name + ' registered as a member.');
    },
    selectCustomer: function (id) { W.set('customer_id', id); save(); drawDue(); },
    clearCustomer: function () { W.set('customer_id', null); save(); drawDue(); }
  };
  function selectCustomerById(id) {
    var c = DB.find('customers', id), el = $('[data-placeholder*="ustomer"]'), s = el && el._demoSearch;
    if (c && s) s.pick(c); else if (c) actions.selectCustomer(id);
  }
  W.define({ actions: actions });

  // wire:click on server-rendered buttons (Livewire handled these).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[wire\\:click]'); if (!b) return;
    var a = b.getAttribute('wire:click'), m;
    if ((m = /^\$set\('(\w+)',\s*(true|false)\)$/.exec(a))) {
      e.preventDefault(); e.stopImmediatePropagation();
      var k = Object.keys(MODALS).filter(function (x) { return MODALS[x] === m[1]; })[0];
      if (k === 'held' && m[2] === 'true') { drawHeld(); openModal('held'); } else if (k) { if (m[2] === 'true') openModal(k); else closeModal(k); }
      return;
    }
    if ((m = /^(\w+)(?:\((.*)\))?$/.exec(a)) && actions[m[1]]) {
      e.preventDefault(); e.stopImmediatePropagation();
      var args = m[2] ? m[2].split(',').map(function (s) { s = s.trim().replace(/^['"]|['"]$/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? +s : s; }) : [];
      actions[m[1]].apply(null, args);
    }
  }, true);
  // wire:submit forms in the modals. Window capture runs before demo.js's document listener.
  window.addEventListener('submit', function (e) {
    var f = e.target, a = f.getAttribute && f.getAttribute('wire:submit');
    if (!a || !actions[a]) return;
    e.preventDefault(); e.stopPropagation();
    actions[a](f);
  }, true);

  /* ---------- shift: roles crawled with no open shift get the terminal from build.mjs, hidden ---------- */
  var openCard = $('[data-demo-openshift]'), terminal = $('[data-demo-terminal]');
  function showTerminal(shift) {
    if (!terminal) return;
    if (openCard) openCard.style.display = 'none';
    terminal.style.display = 'contents';
    var walker = document.createTreeWalker(terminal, NodeFilter.SHOW_TEXT), t;
    while ((t = walker.nextNode())) {
      if (/Shift SH-[\d-]+/.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(/SH-[\d-]+/, shift.number);
      else if (/^\s*since \d/.test(t.nodeValue)) t.nodeValue = 'since ' + shift.since;
    }
  }
  actions.openShift = function (form) {
    var cash = $('input[name="openingCash"]', form), n = DB.get('shift_seq', 1) + 1, d = new Date();
    if (cash && cash.value.trim() === '') { toast('Enter the cash in the drawer (0 if empty).', 'danger'); cash.focus(); return; }
    var h = d.getHours() % 12 || 12;
    var shift = { number: 'SH-' + d.getFullYear() + '-' + String(n).padStart(4, '0'), since: String(h).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'),
      opening_cash: num(cash && cash.value), opened_at: d.toISOString(), by: USER };
    DB.set('shift_seq', n); DB.set('shift_' + ROLE, shift);
    showTerminal(shift);
    toast('Shift ' + shift.number + ' opened. Happy selling!');
    var s = $('[data-placeholder^="Scan barcode"]'); if (s) setTimeout(function () { s.focus(); }, 50);
  };

  /* ---------- start: restore the open order ---------- */
  function start() {
    if (terminal && DB.get('shift_' + ROLE, null)) showTerminal(DB.get('shift_' + ROLE));
    var st = DB.get('pos_state', null);
    if (st) KEEP.forEach(function (k) { if (k in st && k !== 'customer_id') W.set(k, st[k]); });
    // Prices and stock may have changed since (another sale, an edit): refresh the lines.
    setCart(cart().map(function (i) { var p = DB.find('products', i.product_id); if (p) { i.max_quantity = num(p.stock); i.quantity = Math.min(i.quantity, i.max_quantity); } return p && i.quantity > 0 ? i : null; }).filter(Boolean));
    // demo.js fills inputs from the Livewire snapshot after this runs; put the order's values back afterwards.
    syncInputs(); setTimeout(syncInputs, 0); drawHeld();
    if (st && st.customer_id) selectCustomerById(st.customer_id);
  }
  if (window.Alpine && window.Alpine.version) start(); else document.addEventListener('alpine:initialized', start);
})();
