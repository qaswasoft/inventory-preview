 # HANDOFF: make the demo interactive (search, dropdowns, light localStorage)

Written so a fresh Claude (free account, no memory of earlier chats) can continue. Read this whole file,
do the FIRST unchecked task, tick it, append a line to the Progress log, then stop and report in 3 lines.

## Context
- Goal: a client-demo preview (CodeCanyon / vibe69 style) of "Swift Inventory" (Laravel 13 + Livewire 4 +
  Flux UI v2 + Tailwind v4). Static site on GitHub Pages. No server, no database.
- Claude can only access `E:\Project Works`. Two folders:
  - Laravel app (ground truth for behaviour): `E:\Project Works\inventory-management`
    (`app\Livewire\*`, `resources\views\livewire\*`, `app\Services\*`, `database\seeders\*`)
  - This demo: `E:\Project Works\inventory-management-demo`
- How it is built: `tools/crawl.mjs` saves the real rendered pages of the running app to `tools/raw`.
  `tools/build.mjs` rewrites them to `<role>/<route>/index.html` (roles: admin, manager, staff, guest) using
  the app's compiled CSS + `flux/flux.js`; Livewire scripts are removed. `index.html` and `demo/` are
  hand-written and never touched by the build.
- NEVER hand-edit generated folders (`admin/ manager/ staff/ guest/ build/ flux/`). Change `tools/build.mjs`
  and re-run `node tools/build.mjs`. Put behaviour in new files under `demo/`.
- `demo/demo.js` already does: role switcher bar, delete dialogs, row text-search, one products filter,
  required-field validation, "saved" toasts. localStorage prefix is `swiftdemo:v1:` (the Reset button clears it,
  so keep using this prefix).
- Seed data in the snapshots: 3 users, 2 warehouses, 5 categories, 13 products, 3 customers, 3 suppliers,
  6 payment accounts, 4 member rewards, 6 invoices, 3 purchase orders. Edit pages exist for ids
  (products 1-13, customers 1-3, suppliers 1-3, payment-accounts 1-6, warehouses 1-2, categories 1-5).

## What is broken (diagnosis)
- Livewire is gone, so every search / picker that the real app answers from the server shows nothing:
  POS product search, POS customer search, product and customer pickers in the invoice, purchase,
  stock adjust/transfer/count and return forms, and the `wire:model.live` filter selects on lists.
- Alpine expressions call `$wire` (POS 37 uses, invoice form 18) and throw errors.
- Unhandled POS actions: completeSale, openPaymentModal, setPaymentMethod, enableSplit, newSale, openHoldModal,
  confirmWeight, holdSale, registerCustomer. Invoice form: saveDraft, saveAsPaid, saveAndSend.
- Lists do not sort or paginate; created or edited records never appear.
- Alpine is loaded from the jsDelivr CDN (a client demo should not depend on it).

## Rules
1. One task per turn. Tick the box and add a Progress-log line when done.
2. Pages are 300-400 KB. Never read one whole. Copy it to the sandbox (`copy_file_user_to_claude`) and grep,
   or use `read_text_file` with `head`/`tail`. Find markup with `placeholder=`, `wire:model`, `wire:click`, `x-data`.
3. Keep the snapshot approach (pixel-exact markup). Reuse the app's own classes so the look does not change.
4. Keep business rules minimal and plausible; match the totals shown in the snapshots. References:
   `app\Livewire\Pos\PosTerminal.php`, `app\Services\PricingService.php`, `app\Services\InventoryService.php`.
5. Test in headless Chromium in the Claude sandbox (Playwright is installed, there is NO internet, so no CDN).
   Every page you touch must have zero console errors.
6. Keep replies short. Ask at most one question.

## Tasks
- [x] **T0 (user, once)** Download Alpine locally (PowerShell):
  ```powershell
  cd "E:\Project Works\inventory-management-demo"; mkdir demo\vendor -Force
  $v="3.14.9"
  iwr "https://cdn.jsdelivr.net/npm/alpinejs@$v/dist/cdn.min.js" -OutFile demo\vendor\alpine.min.js
  foreach($n in "persist","focus","collapse","anchor"){ iwr "https://cdn.jsdelivr.net/npm/@alpinejs/$n@$v/dist/cdn.min.js" -OutFile "demo\vendor\alpine-$n.min.js" }
  ```
- [x] **T1 build.mjs** (code done; browser check pending until T0 + rebuild) Replace the CDN `<script>` tags with `demo/vendor/*` (plugins first, then `flux.js`, then
  core, all as today). Inject `demo/data.js`, `demo/store.js`, `demo/search.js`, `demo/pos.js`, `demo/forms.js`
  (only those that exist) before `demo.js`. Add an Alpine `$wire` shim (`Alpine.magic('wire', ...)`: property
  reads/writes go to a per-page state object, method calls go to handlers registered by the page scripts) so
  existing expressions stop throwing. Done when: pages load offline with no console errors.
- [x] **T2 data** (script written and tested on real sample pages; user must run it once) Write `tools/extract-data.mjs`: read `tools/raw/admin/<entity>/<id>/edit/index.html`, parse the
  `wire:snapshot` JSON (`data`; values may be `[value, {s:...}]`, see `unwrap()` in demo.js), fall back to input
  values, and add stock/prices from the products list table and invoices from the invoices list. Output
  `demo/data.js` = `window.DEMO_DATA = {products, customers, suppliers, accounts, warehouses, categories, invoices}`.
  Done when: 13 products, 3 customers, 3 suppliers, 6 accounts, 6 invoices with name/sku/barcode/price/stock.
- [x] **T3 store** `demo/store.js` (`DemoDB`): get/set under `swiftdemo:v1:db:*`, seeded from `DEMO_DATA`,
  `nextInvoiceNo()` -> `INV-<year>-0001` style, change events. Done when: Reset restores the seed.
- [x] **T4 search + dropdowns (user's top complaint)** `demo/search.js`: one generic live-results dropdown
  (name / SKU / barcode, keyboard up/down/Enter, click to pick, "no results") styled with the app's classes.
  Wire it to: POS product search (Enter on an exact barcode adds it), POS customer search, line-item product
  pickers (invoice, purchase, stock adjust/transfer/count, returns), customer pickers, and list filter selects.
  Done when: typing "oil" in the POS shows matching products and picking one works.
- [x] **T5 lists** DOM-based column sort, 15-per-page pagination, filters on every list page; records created or
  edited (from the store) appear by cloning a row. Done when: sort, page and search work on products, customers,
  suppliers, invoices, purchases.
- [x] **T6 POS** `demo/pos.js`: cart, qty +/-, remove, discount, totals, payment modal (cash / card / mobile /
  bank), complete sale -> invoice saved to the store + product stock reduced, hold and resume, cart kept in
  localStorage. Done when: a sale made in the POS shows up in the Invoices list.
- [x] **T7 forms** `demo/forms.js`: line items and live totals in the invoice and purchase forms; create and edit
  forms save to the store and prefill from it. Done when: a new customer appears in the Customers list and in the
  POS customer search.
- [x] **T8 QA + polish** Playwright sweep of every page for admin, manager and staff (zero console errors, mobile
  width OK). Update README. Delete the stale `snapshots/` folder and the empty `css/` and `js/` folders.
  Optional: shift seeded relative dates to the visitor's today; add the viewer role and 403/404 pages.

## Progress log
- T0: NOT done yet (no `demo/vendor/` folder). Build falls back to the CDN until it exists.
- T1: done. Added `demo/wire.js` (`$wire` stand-in with `DemoWire.define/get/set`, unit-tested with a mock Alpine),
  `tools/build.mjs` now loads local Alpine from `demo/vendor/` (CDN fallback), puts `wire.js` before Alpine, and
  auto-injects `demo/{data,store,search,pos,forms}.js` when those files exist. NEXT: user runs T0, then
  `node tools/build.mjs`; then copy `demo/vendor/*.min.js` into the sandbox and verify in Chromium that POS and
  invoice pages have zero console errors. Then T2.
- T2: done. `tools/extract-data.mjs` reads `tools/raw/admin/<entity>/<id>/edit/index.html` (form snapshot) for products,
  customers, suppliers, accounts, warehouses, categories, rewards, plus the invoice list table, and writes
  `demo/data.js` (`window.DEMO_DATA`, products normalized to {id,name,sku,barcode,cost,price,tax_rate,discount,
  discount_type,stock,min_stock,unit,status,...}; invoices {id,number,customer,customer_phone,items,total,due,date,
  status,editable}; meta.currency). Tested on product 1, customer 1 and the invoice list only; user runs it for all.
  Product `stock` is the total quantity (no per-warehouse split). NEXT: T3 `demo/store.js`. POS and invoice search boxes are `contenteditable` elements that call
  `$wire.set('search'|'customerSearch'|'productSearch', text)` and `$wire.$watch(...)`; their result lists and the
  cart rows are server-rendered Blade (`resources/views/livewire/pos/pos-terminal.blade.php`), so results/rows must
  be built client-side. Totals are already computed client-side in Alpine from `$wire.cart[i]` / `$wire.items[i]`
  (fields: quantity, is_gift, tax_rate, plus net()/lineTax() helpers).
- T0: done (2026-10-20). `demo/vendor/` now has alpine.min.js 3.14.9 + persist/focus/collapse/anchor plugins.
  NEXT: run `node tools/build.mjs` so pages use the local files and check T1 in the browser, then T3.
- T3: done (2026-10-20). Ran `tools/extract-data.mjs` (13/3/3/6/2/5/4/6) and rebuilt. `demo/store.js` = `window.DemoDB`:
  all/find/where/save(insert or merge by id)/remove/get/set/nextId/adjustStock/nextNo/nextInvoiceNo
  (-> INV-2026-0007)/reset/on(fn, table); keys `swiftdemo:v1:db:<table>`, falls back to the seed when a key is
  missing, so toolbar Reset restores the seed (Node-tested). Fires `demodb:change` {table, action, record}.
  T1 browser check passed: admin pos, invoices/create, products, dashboard and staff pos have 0 console errors in
  headless Edge over HTTP (`file://` blocks the app's module script by CORS, so always test over HTTP).
  Playwright is not installed on this machine. NEXT: T4 search.js.
- T4: done (2026-10-20). `demo/search.js` = `window.DemoSearch.attach(el, cfg)`: a generic dropdown (search-select
  classes, arrow keys / Enter / click / Esc / click-outside, "no results" row, exact barcode or SKU + Enter picks).
  Wired: POS product + customer, invoice customer (fills customer_name/phone) + product, purchase product, stock
  adjust/transfer product (chip), returns invoice search, label-print product, plus list filter selects
  (statusFilter/typeFilter/... hide rows with class `demo-fhide`). A pick fires `demo:pick` and calls the
  DemoWire action when defined (quickAdd, addProduct, selectCustomer, clearCustomer, selectProduct,
  selectInvoice); otherwise it shows a toast, so T6/T7 only need `DemoWire.define({actions})`. Also: `$wire.call()`
  in wire.js and `window.DemoToast` in demo.js. Tested with playwright-core + installed Edge
  (`channel:'msedge'`, installed into the scratchpad): "oil" shows 2 products, every picker picks, the invoices
  Paid filter shows 4 of 6 rows, 0 console errors on 15 pages. Stock count has no picker (only a row filter,
  left for T5). NEXT: T5 lists.
- T5: done (2026-10-20). `demo/lists.js` (`window.DemoList`, injected by build.mjs after search.js): every
  `tbody[data-flux-rows]` table gets header sort (Flux sortable headers, else every non-image/action header;
  asc -> desc -> original; numbers, money, dates, text), 15-per-page paging in Flux's pagination markup
  (`.demo-phide`; respects demo.js search `style.display` and search.js `.demo-fhide`), and on products,
  customers, suppliers, categories, warehouses, payment-accounts, invoices and purchases the rows follow DemoDB:
  records with `updated_at` (store.js now stamps it on every save) rewrite their row, new ones are cloned from an
  existing row (badge colours copied from a matching row; links become `<seeded id page>?id=<new id>`,
  newest first on invoices/purchases), deleted seeded records lose their row. demo.js delete now also calls
  `DemoList.removed(id)` -> `DemoDB.remove`. Tested: sorting on 5 lists, 19 products -> 2 pages, search "demo"
  -> 6, a stored invoice shows at the top of Invoices, 0 console errors. Purchases have no seed table in
  data.js (T7 saves new ones as `purchases`). NEXT: T6 POS.
- T6: done (2026-10-20). `demo/pos.js` (POS pages only) keeps the order in DemoWire state (the page's own Alpine
  totals read it) and in `swiftdemo:v1:db:pos_state`; draws the "Current Order" item table with the Blade
  markup (qty +/-, typed qty, loose-goods weight, remove, Clear, count badge); handles every POS `wire:click`,
  `$set('showX', ...)` and modal `wire:submit` (window-capture, so demo.js doesn't treat them as page forms).
  Picked products go straight into the item table (user asked for this: no separate "cart"). Pricing: per-unit
  discount from the product (fixed / percent), tax_rate per line; stock-capped quantities. Loose goods open the
  weigh modal. Payment modal: cash (received / change / short), card / mobile / bank (account select, mobile
  TrxID), sell on due (needs a customer; paid now + due), split -> "not in demo" toast. completeSale saves an
  invoice (number, lines, totals, method, paid/due, status paid/partial/sent) and reduces stock, then shows the
  success modal. Hold (F4) / Held list / Resume (re-checks stock) / Discard in `db:held_sales`. Register member
  from the customer search's "Register" button (search.js `emptyAction`). Fixed: Enter that completes a sale no
  longer also closes the success modal; new list rows keep page order. Tested: sale shows at the top of
  Invoices, product 1 stock 144 -> 142, due sale "Partial", 0 console errors on admin/manager/staff POS.
  NEXT: T7 forms.
- T7: done (2026-10-20). `demo/forms.js` (`window.DemoForms`): create/edit forms of customers, products,
  suppliers, categories, warehouses, payment-accounts save to DemoDB (demo.js onSubmit calls
  `DemoForms.save(form)`; product fields map cost_price/selling_price/quantity/min_stock_level ->
  cost/price/stock/min_stock) and prefill from it, including `?id=<new id>` pages. Invoice and purchase forms:
  items start from the page snapshot (edit pages), product search adds lines (invoice: price, per-unit discount,
  tax %, "N in stock" / "Only N in stock"; purchase: unit cost), editable inputs, remove; the page's Alpine
  totals read DemoWire.items. Save as Draft / Save & Send / Save & Mark Paid (paid checks and reduces stock),
  Place Order / Save Draft (purchases, PO-<year>-0004 onwards, stock not changed until received). Tested: new
  customer appears in Customers and in the POS customer search, editing it via ?id works, new product row,
  invoice of 2 lines marked paid ($1,290.00, egg stock 40 -> 37), new PO at the top of Purchases, 0 console
  errors. Not done: receiving stock / payments on existing POs, invoice view page for new invoices. NEXT: T8 QA.
- T8: done (2026-10-20). Sweep of all 259 pages (admin 110, manager 97, staff 49, guest 3) at 1400px and 390px
  in headless Edge: 0 console errors. 43 pages scrolled sideways on phones (app markup: header button rows,
  segmented radios, long labels, Mushak table); fixed with mobile-only rules in `demo/demo.css` (desktop
  unchanged), now 0. README rewritten (what works, local serving over HTTP, extract-data step, demo/ files).
  Deleted the unused `snapshots/` (273 files, git-ignored, referenced nowhere) and the empty `css/`, `js/`;
  dropped `snapshots/` from .gitignore. Optional items (shift seeded dates to today, viewer role, 403/404) not
  done. Test scripts lived in the Claude scratchpad (playwright-core 1.48.2 driving installed Edge,
  `channel:'msedge'`); they are not part of the repo. ALL TASKS DONE.
- Follow-up (2026-10-20, user: "print receipt is missing on checkout"): `demo/receipt.js` (`window.DemoReceipt`,
  injected after store.js) redraws a seeded receipt page (`/invoices/<seed>/receipt?id=<id>`) from DemoDB,
  following `resources/views/pdf/receipt.blade.php`, including a JS port of `App\Services\Barcode\Code128`
  (its SVG matches the app's for INV-2026-0006). The POS "Sale Completed" modal now has Receipt (new tab,
  auto-print like the app) and Invoices buttons; demo invoices' "View / Print" in the Invoices list opens the
  receipt. 0 console errors.
- Follow-up (2026-10-20, user: staff POS "stuck on first page"): manager and staff had no open shift when crawled,
  so their POS snapshot is only the "Open your shift" card. build.mjs `withTerminal()` copies the admin POS
  terminal (shift bar -> order summary) into those pages, hidden; pos.js `openShift` shows it, numbers the shift
  (SH-<year>-0002...), keeps it per role in `db:shift_<role>`. Tested staff + manager: open shift, sale, reload.
  Product name is now "Inventory" (build.mjs `PRODUCT`; app APP_NAME, sidebar, seeders updated).
