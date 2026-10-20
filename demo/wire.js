/* Swift Inventory demo: client-side stand-in for Livewire's `$wire` magic.
 *
 * The real POS and invoice screens run Alpine code such as `this.$wire.cart[i]` or `$wire.completeSale()`.
 * Livewire (the server round-trip) does not exist on a static site, so those calls used to throw.
 * This file gives Alpine a `$wire` that reads and writes one shared, reactive, client-side state object.
 *
 * Page scripts add real behaviour with:
 *   DemoWire.define({ state: { cart: [] }, actions: { completeSale() { ... } } });
 * Read and write state with DemoWire.get(name) / DemoWire.set(name, value).
 *
 * build.mjs loads this BEFORE Alpine so the magic is registered in time. */
(function () {
  'use strict';

  // Properties the real screens read. Types matter: `$wire.cart[i]` must not hit undefined.
  var DEFAULTS = {
    cart: [], items: [],
    tax: 0, discount: 0, membershipDiscount: 0,
    hasCourier: false, courierCharge: 0, courierCost: '',
    weighQuantity: '', customer_id: null,
    search: '', customerSearch: '', productSearch: '',
    showWeighModal: false, showRegisterCustomer: false, showHoldModal: false, showHeldList: false, showPaymentModal: false
  };

  // Names that are clearly actions. Unknown ones become harmless no-ops instead of throwing.
  var ACTION_NAME = /^(open|close|toggle|add|remove|clear|complete|new|save|confirm|hold|resume|register|enable|disable|apply|select|update|delete|set[A-Z]|print|reset|submit|load|refresh|cancel|go)/;

  var W = (window.DemoWire = { state: Object.assign({}, DEFAULTS), actions: {} });

  W.define = function (spec) {
    spec = spec || {};
    Object.keys(spec.state || {}).forEach(function (k) { W.state[k] = spec.state[k]; });
    Object.keys(spec.actions || {}).forEach(function (k) { W.actions[k] = spec.actions[k]; });
  };
  W.get = function (name) { return W.state[name]; };
  W.set = function (name, value) { W.state[name] = value; };

  // $wire.$watch('prop', (value, previous) => ...)
  function watch(name, callback) {
    var Alpine = window.Alpine, previous = W.state[name], first = true;
    if (!Alpine || !Alpine.effect) return function () {};
    Alpine.effect(function () {
      var value = W.state[name]; // read first so the effect tracks it
      if (first) { first = false; return; }
      var before = previous; previous = value;
      setTimeout(function () { callback(value, before); }, 0);
    });
    return function () {};
  }

  var api = new Proxy({}, {
    get: function (_, key) {
      if (typeof key === 'symbol') return undefined;
      if (key === 'get' || key === '$get') return W.get;
      if (key === 'set' || key === '$set') return W.set;
      if (key === '$watch') return watch;
      if (key === 'call' || key === '$call') {
        return function (name) {
          var fn = W.actions[name], args = Array.prototype.slice.call(arguments, 1);
          return Promise.resolve(typeof fn === 'function' ? fn.apply(api, args) : undefined);
        };
      }
      if (key === '$refresh' || key === '$dispatch' || key === '$on' || key === '$commit') return function () {};
      if (key === '$entangle' || key === 'entangle') return function (name) { return W.state[name]; };
      if (typeof W.actions[key] === 'function') {
        return function () { return W.actions[key].apply(api, arguments); };
      }
      if (key in W.state) return W.state[key];
      if (ACTION_NAME.test(key)) {
        return function () { if (window.console && console.debug) console.debug('[demo] "' + key + '" is not wired up yet'); };
      }
      return undefined;
    },
    set: function (_, key, value) { W.state[key] = value; return true; }
  });
  W.api = api;

  document.addEventListener('alpine:init', function () {
    W.state = window.Alpine.reactive(W.state);
    window.Alpine.magic('wire', function () { return api; });
  });
})();
