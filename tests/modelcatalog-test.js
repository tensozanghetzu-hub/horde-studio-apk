/* v1.23.0 — model picker robustness, ported from upstream 18.3.6.
 *
 * What 18.3.6 fixed upstream, and the mobile port of each:
 *   - the catalog parser accepts three response shapes (bare array,
 *     {data: [...]}, {models: [...]}) — mobile handled two of the three
 *   - "a provider switch during discovery must not poison the next
 *     catalog" — mobile's hs-models cache had no source stamp: switch
 *     providers and the picker showed the previous provider's models
 *   - "your exact typed model ID is still accepted when saved" + model
 *     retention after refresh — mobile's picker hid the current model
 *     when it was absent from the catalog and offered no way to select
 *     an arbitrary ID unless the fetch failed
 *
 * Plus one mobile-specific picker bug the new tests surfaced: choosing
 * "Any available" (value '') never saved, because the sheet resolved
 * through `if (v && onPick)` and '' is falsy.
 *
 *   node /home/user/tests/modelcatalog-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 25); }); }

/* ------------------------------------------------------------------ */
/* 1. the catalog parser (api.js)                                      */
/* ------------------------------------------------------------------ */

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  setTimeout: setTimeout, clearTimeout: clearTimeout
};
sb.window = sb;
sb.global = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });

var SETTINGS = { provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'm' };

function withFetch(body, status) {
  sb.fetch = function () {
    return Promise.resolve({
      ok: status === undefined ? true : (status >= 200 && status < 300),
      status: status || 200,
      statusText: 'stub',
      json: function () { return Promise.resolve(body); }
    });
  };
}

var parserTests = Promise.resolve()
  .then(function () {
    withFetch([{ id: 'a' }, { id: 'b' }]);
    return sb.window.API.listModels(SETTINGS);
  })
  .then(function (r) {
    ok('parser: bare array', JSON.stringify(r) === '["a","b"]', JSON.stringify(r));
    withFetch({ data: [{ id: 'a' }, { name: 'fallback-name' }] });
    return sb.window.API.listModels(SETTINGS);
  })
  .then(function (r) {
    ok('parser: {data: [...]} with id-or-name', JSON.stringify(r) === '["a","fallback-name"]', JSON.stringify(r));
    withFetch({ models: [{ id: 'x' }, { id: 'y' }] });
    return sb.window.API.listModels(SETTINGS);
  })
  .then(function (r) {
    ok('parser: {models: [...]} (upstream 18.3.6 shape)', JSON.stringify(r) === '["x","y"]', JSON.stringify(r));
    withFetch({ models: ['plain-string-a', 'plain-string-b'] });
    return sb.window.API.listModels(SETTINGS);
  })
  .then(function (r) {
    ok('parser: {models: [strings]} tolerated', JSON.stringify(r) === '["plain-string-a","plain-string-b"]', JSON.stringify(r));
    withFetch({ data: 'not-an-array' });
    return sb.window.API.listModels(SETTINGS);
  })
  .then(function (r) {
    ok('parser: non-array data degrades to []', JSON.stringify(r) === '[]', JSON.stringify(r));
    withFetch({ error: { message: 'boom' } }, 401);
    return sb.window.API.listModels(SETTINGS).then(
      function () { ok('parser: non-ok rejects', false, 'resolved'); },
      function (e) { ok('parser: non-ok rejects with provider message', /boom/.test(e.message), e.message); }
    );
  });

/* ------------------------------------------------------------------ */
/* 2. the picker (app.js): cache source + current model + exact ID     */
/* ------------------------------------------------------------------ */

var APP_SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'app.js');

function makeWorld(modelsFor) {
  var calls = { fetches: 0, sheets: [], toasts: [], saved: [] };
  var storage = {};
  /* like a real DOM: the same row objects persist until innerHTML changes */
  var rowsCache = [], rowsCacheHtml = null;
  var listEl = {
    innerHTML: '',
    querySelectorAll: function () {
      if (rowsCacheHtml !== listEl.innerHTML) {
        rowsCache = [];
        var re = /data-m="([^"]*)"/g, m;
        while ((m = re.exec(listEl.innerHTML))) rowsCache.push({
          _v: m[1], onclick: null,
          getAttribute: function (n) { return n === 'data-m' ? this._v : null; }
        });
        rowsCacheHtml = listEl.innerHTML;
      }
      return rowsCache;
    }
  };
  var mfEl = { value: '', oninput: null, style: {} };
  var activeResolve = null;

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    setInterval: setInterval, clearInterval: clearInterval,
    AbortController: AbortController,
    location: { origin: 'https://app.test', href: 'https://app.test/' },
    localStorage: {
      getItem: function (k) { return k in storage ? storage[k] : null; },
      setItem: function (k, v) { storage[k] = String(v); },
      removeItem: function (k) { delete storage[k]; }
    },
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      toast: function (t) { calls.toasts.push(String(t)); },
      closeSheet: function (val) { if (activeResolve) { activeResolve(val); activeResolve = null; } },
      input: function () { return Promise.resolve(null); },
      sheet: function (o) {
        calls.sheets.push(o);
        var p;
        p = new Promise(function (res) { activeResolve = res; });
        o.onMount({
          querySelector: function (sel) {
            return sel === '#mf' ? mfEl : (sel === '#mlist' ? listEl : null);
          }
        }, function (val) {
          if (activeResolve) { activeResolve(val); activeResolve = null; }
        });
        return p;
      }
    },
    Store: {
      settings: {
        provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k',
        model: 'current-model', hordeTextModel: '', hordeModel: ''
      },
      saveSettings: function (patch) { calls.saved.push(patch); return Promise.resolve(); }
    },
    Views: { settings: function () {} },
    Horde: {
      listTextModels: function () { return Promise.resolve(modelsFor.hordeRows || []); },
      listImageModels: function () { return Promise.resolve(modelsFor.hordeRows || []); }
    },
    API: {
      listModels: function (s) {
        calls.fetches++;
        return Promise.resolve(modelsFor.byProvider[s.provider + '|' + (s.baseUrl || '')] || modelsFor.fallback || []);
      }
    }
  };
    sandbox.window = sandbox;
    sandbox.$ = function () { return {}; };
    sandbox.document = {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    };
    vm.runInNewContext(fs.readFileSync(APP_SRC, 'utf8'), sandbox, { filename: 'app.js' });

  var w = {
    App: sandbox.App, sb: sandbox, calls: calls, storage: storage, listEl: listEl,
    renderedValues: function () { return listEl.querySelectorAll().map(function (e) { return e._v; }); },
    click: function (value) {
      var rows = listEl.querySelectorAll();
      for (var i = 0; i < rows.length; i++) if (rows[i]._v === value) { rows[i].onclick(); return true; }
      return false;
    },
    filter: function (q) { mfEl.value = q; mfEl.oninput.call(mfEl); }
  };
  return w;
}

function openModelSheet(w) {
  return w.App.chooseModel(false).catch(function () { return null; });
}

/* The sheet's promise only settles on interaction, so "the sheet is up"
   must be detected from the UI.sheet call count, not the promise. */
function sheetMounted(w, n) {
  return new Promise(function (resolve, reject) {
    var t0 = Date.now();
    (function poll() {
      if (w.calls.sheets.length >= n) return resolve();
      if (Date.now() - t0 > 3000) return reject(new Error('sheet ' + n + ' did not mount; fetches=' + w.calls.fetches + ' toasts=' + JSON.stringify(w.calls.toasts)));
      setTimeout(poll, 10);
    })();
  });
}

var pickerTests = Promise.resolve()
  /* ---- cache: first open + same-provider reuse --------------------- */
  .then(function () {
    var w = makeWorld({
      byProvider: {
        'openrouter|https://openrouter.ai/api/v1': ['or-model-1', 'or-model-2'],
        'ollama|http://192.168.1.50:11434/v1': ['llama-local']
      }
    });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      ok('cache: first open fetches the catalog', w.calls.fetches === 1, 'fetches=' + w.calls.fetches);
      w.click('or-model-1'); // settle the sheet so a fresh one can open
      return tick().then(function () {
        openModelSheet(w);
        return sheetMounted(w, 2).then(function () {
          ok('cache: same provider reuses the cache', w.calls.fetches === 1, 'fetches=' + w.calls.fetches);
          w.click('or-model-1');
          return tick();
        });
      });
    });
  })
  /* ---- cache: a provider switch must not poison the next list ------ */
  .then(function () {
    var w = makeWorld({
      byProvider: {
        'openrouter|https://openrouter.ai/api/v1': ['or-model-1', 'or-model-2'],
        'ollama|http://192.168.1.50:11434/v1': ['llama-local']
      }
    });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      w.click('or-model-1');
      return tick();
    }).then(function () {
      w.sb.Store.settings.provider = 'ollama';
      w.sb.Store.settings.baseUrl = 'http://192.168.1.50:11434/v1';
      w.calls.fetches = 0;
      openModelSheet(w);
      return sheetMounted(w, 2).then(function () {
        ok('cache: a provider switch does not show the old catalog',
          w.calls.fetches === 1 && w.listEl.innerHTML.indexOf('llama-local') !== -1 &&
          w.listEl.innerHTML.indexOf('or-model-1') === -1,
          'fetches=' + w.calls.fetches + ' html=' + w.listEl.innerHTML.slice(0, 300));
        w.click('llama-local');
        return tick().then(function () {
          w.calls.fetches = 0;
          openModelSheet(w);
          return sheetMounted(w, 3).then(function () {
            ok('cache: re-open on the new provider reuses the new cache', w.calls.fetches === 0, 'fetches=' + w.calls.fetches);
          });
        });
      });
    });
  })
  /* ---- cache: legacy bare-array entries are stale ------------------- */
  .then(function () {
    var w = makeWorld({ byProvider: { 'openrouter|https://openrouter.ai/api/v1': ['fresh-1'] } });
    w.storage['hs-models'] = JSON.stringify(['stale-from-old-format']);
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      ok('cache: legacy bare-array cache is treated as stale',
        w.calls.fetches === 1 && w.listEl.innerHTML.indexOf('fresh-1') !== -1,
        'fetches=' + w.calls.fetches + ' html=' + w.listEl.innerHTML.slice(0, 200));
    });
  })
  /* ---- current model always visible (retention) -------------------- */
  .then(function () {
    var w = makeWorld({ byProvider: { 'openrouter|https://openrouter.ai/api/v1': ['catalog-a', 'catalog-b'] } });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      var vals = w.renderedValues();
      ok('picker: current model absent from the catalog is pinned first',
        vals.length && vals[0] === 'current-model', JSON.stringify(vals));
      ok('picker: the pinned row is marked as the current model',
        /current model/i.test(w.listEl.innerHTML), w.listEl.innerHTML.slice(0, 300));
      w.click('current-model');
      return tick().then(function () {
        ok('picker: the pinned current model is selectable',
          w.calls.saved.length === 1 && w.calls.saved[0].model === 'current-model',
          JSON.stringify(w.calls.saved));
      });
    });
  })
  .then(function () {
    var w = makeWorld({ byProvider: { 'openrouter|https://openrouter.ai/api/v1': ['catalog-a', 'current-model', 'catalog-b'] } });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      var n = w.renderedValues().filter(function (v) { return v === 'current-model'; }).length;
      ok('picker: a model already in the catalog appears exactly once', n === 1, JSON.stringify(w.renderedValues()));
    });
  })
  /* ---- exact typed IDs are accepted -------------------------------- */
  .then(function () {
    var w = makeWorld({ byProvider: { 'openrouter|https://openrouter.ai/api/v1': ['catalog-a', 'catalog-b'] } });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      w.filter('my-typed-model-id');
      var html = w.listEl.innerHTML;
      ok('picker: an unmatched filter offers the exact ID',
        /Use exactly/.test(html) && html.indexOf('my-typed-model-id') !== -1, html.slice(0, 400));
      w.click('my-typed-model-id');
      return tick().then(function () {
        ok('picker: the exact typed ID is selectable and saved as-is',
          w.calls.saved.length === 1 && w.calls.saved[0].model === 'my-typed-model-id',
          JSON.stringify(w.calls.saved));
      });
    });
  })
  .then(function () {
    var w = makeWorld({ byProvider: { 'openrouter|https://openrouter.ai/api/v1': ['catalog-a', 'catalog-b'] } });
    openModelSheet(w);
    return sheetMounted(w, 1).then(function () {
      w.filter('catalog-a');
      var n = w.listEl.innerHTML.split('Use exactly').length - 1;
      ok('picker: a filter that matches a listed model adds no duplicate row', n === 0, w.listEl.innerHTML.slice(0, 400));
    });
  })
  /* ---- horde picker: same retention rule --------------------------- */
  .then(function () {
    var w = makeWorld({
      hordeRows: [{ name: 'horde-model-a', count: 3, eta: 12 }, { name: 'horde-model-b', count: 0 }]
    });
    w.sb.Store.settings.hordeTextModel = 'retired-horde-model';
    w.App.chooseHordeModel('text', false).catch(function () {});
    return sheetMounted(w, 1).then(function () {
      var vals = w.renderedValues();
      ok('horde picker: a current model missing from the list is pinned first',
        vals.length && vals[0] === 'retired-horde-model', JSON.stringify(vals));
      w.click('retired-horde-model');
      return tick().then(function () {
        ok('horde picker: the pinned model is selectable',
          w.calls.saved.length === 1 && w.calls.saved[0].hordeTextModel === 'retired-horde-model',
          JSON.stringify(w.calls.saved));
      });
    });
  })
  .then(function () {
    var w = makeWorld({ hordeRows: [{ name: 'horde-model-a', count: 3, eta: 12 }] });
    w.sb.Store.settings.hordeTextModel = 'horde-model-a';
    w.App.chooseHordeModel('text', false).catch(function () {});
    return sheetMounted(w, 1).then(function () {
      var n = w.renderedValues().filter(function (v) { return v === 'horde-model-a'; }).length;
      ok('horde picker: a listed current model appears exactly once', n === 1, JSON.stringify(w.renderedValues()));
    });
  })
  .then(function () {
    var w = makeWorld({ hordeRows: [{ name: 'horde-model-a', count: 3, eta: 12 }] });
    w.sb.Store.settings.hordeTextModel = 'horde-model-a';
    w.App.chooseHordeModel('text', false).catch(function () {});
    return sheetMounted(w, 1).then(function () {
      var picked = w.click('');
      return tick().then(function () {
        ok('horde picker: "Any available" actually clears the filter (value \'\')',
          picked === true && w.calls.saved.length === 1 && w.calls.saved[0].hordeTextModel === '',
          'picked=' + picked + ' saved=' + JSON.stringify(w.calls.saved));
      });
    });
  });

Promise.all([parserTests, pickerTests]).then(function () {
  console.log('');
  if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
  console.log('modelcatalog-test: ' + pass + ' ok');
}).catch(function (e) {
  console.log('  FAIL threw ' + (e && e.stack || e));
  process.exit(1);
});
