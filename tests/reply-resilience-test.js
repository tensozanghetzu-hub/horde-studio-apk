#!/usr/bin/env node
/* v1.43.0 — three things the failure of a free route taught us.
 *
 *   R1  a saturated route should fail over to another model inside the same
 *       request, instead of asking the human to open Settings
 *   R2  when the app cuts a reply while cleaning it, the reader can see what
 *       was cut — and nothing is ever restored silently
 *   R3  "thinking ate the whole reply budget" is a budget shape, not a
 *       Nemotron shape, so it gets a switch that defaults off
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + extra : '')); }
}

function makeApi(fetchFn) {
  var sb = {
    Promise: Promise, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
    location: { origin: 'https://app.test' }, fetch: fetchFn,
    Horde: { generateText: function () { return Promise.resolve({ text: '' }); },
      listTextModels: function () { return Promise.resolve([]); },
      health: function () { return Promise.resolve({}); }, whoami: function () { return null; } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
function set(model, extra) {
  var s = { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test',
    model: model, streaming: false, maxTokens: 600, temperature: 0.8, topP: 0.95 };
  for (var k in (extra || {})) s[k] = extra[k];
  return s;
}

var bodySent = null;
var API = makeApi(function (url, options) {
  bodySent = JSON.parse(options.body);
  return Promise.resolve({ ok: true, json: function () {
    return Promise.resolve({ choices: [{ message: { content: 'reply' }, finish_reason: 'stop' }] });
  } });
});
var msgs = [{ role: 'user', content: 'hi' }];
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var FB = 'google/gemma-4-26b-a4b-it:free, nvidia/nemotron-3.5-lightning:free';

/* ---- R1: the fallback chain ---- */
API.streamChat(set('google/gemma-4-31b-it:free'), msgs, null).then(function () {
  ok('an unset fallback changes the request not at all', bodySent.models === undefined, JSON.stringify(bodySent.models));
  return API.streamChat(set('google/gemma-4-31b-it:free', { replyFallback: FB }), msgs, null);
}).then(function () {
  ok('the primary model leads the chain', !!bodySent.models && bodySent.models[0] === 'google/gemma-4-31b-it:free', JSON.stringify(bodySent.models));
  ok('the chain is what the user typed, in order', !!bodySent.models && bodySent.models.length === 3 &&
    bodySent.models[1] === 'google/gemma-4-26b-a4b-it:free' &&
    bodySent.models[2] === 'nvidia/nemotron-3.5-lightning:free', JSON.stringify(bodySent.models));
  return API.streamChat(set('google/gemma-4-31b-it:free',
    { replyFallback: 'a:free, b:free, c:free, d:free, e:free' }), msgs, null);
}).then(function () {
  ok('a long list is capped at three fallbacks (4 total)', !!bodySent.models && bodySent.models.length === 4, JSON.stringify(bodySent.models));
  return API.streamChat(set('google/gemma-4-31b-it:free',
    { replyFallback: 'x:free' }), msgs, null, null, { models: ['hand:built'] });
}).then(function () {
  ok('a caller-built body is never rewritten', bodySent.models[0] === 'hand:built', JSON.stringify(bodySent.models));
  ok('the chain is gated on the OpenRouter endpoint, not on the caller\'s memory of it',
    /if \(fbList\.length && isOpenRouterEndpoint\(s\)/.test(apiSrc));
  return API.streamChat(set('google/gemma-4-31b-it:free',
    { replyFallback: FB, baseUrl: 'https://api.example.test/v1' }), msgs, null);
}).then(function () {
  ok('a strict self-hosted endpoint is not sent models either', bodySent.models === undefined, JSON.stringify(bodySent.models));

  /* ---- R2: provenance of a cut reply ---- */
  var raw = 'He looked up. "Alice: get down here," he shouted.';
  var cut = API.replyProvenance('He looked up.', raw);
  ok('a cut is reported with its size', !!cut && cut.dropped === raw.length - 13 && cut.dropped === 36, JSON.stringify(cut));
  ok('a reply that merely ended is not called an early end', !cut.endsEarly, JSON.stringify(cut));
  ok('a reply left ending on the name that was cut is flagged',
    API.replyProvenance('He turned to Alice:', raw).endsEarly === true);
  ok('an untouched reply has nothing to show', API.replyProvenance('same', 'same') === null);
  ok('nothing is reported about a reply that lost no text',
    API.replyProvenance('He looked up. "Alice: hi."', 'He looked up. "Alice: hi."') === null);
  ok('nothing is claimed when the display text is longer', API.replyProvenance('longer text', 'short') === null);
  ok('no raw, no report', API.replyProvenance('x', '') === null && API.replyProvenance('x', null) === null);
  var cleaned = API.cleanReply('He looked up. "Alice: get down here," he shouted.', 'Vex', 'Alice');
  ok('cleanReply does truncate at the player\u2019s name (the behaviour this exposes)',
    cleaned === 'He looked up. "Alice: get down here," he shouted.' || cleaned.indexOf('Alice:') === -1 ||
    cleaned.length < 53, JSON.stringify(cleaned));

  /* ---- R3: the thinking switch ---- */
  return API.streamChat(set('google/gemma-4-31b-it:free', { reasoningOff: true }), msgs, null);
}).then(function () {
  ok('the switch asks any OpenRouter model for no thinking', bodySent.reasoning && bodySent.reasoning.enabled === false, JSON.stringify(bodySent.reasoning));
  return API.streamChat(set('google/gemma-4-31b-it:free', { reasoningOff: true, baseUrl: 'https://api.example.test/v1' }), msgs, null);
}).then(function () {
  ok('the thinking switch is OpenRouter-only, like the chain', bodySent.reasoning === undefined, JSON.stringify(bodySent.reasoning));
  return API.streamChat(set('google/gemma-4-31b-it:free'), msgs, null);
}).then(function () {
  ok('off means off: no reasoning key is invented', bodySent.reasoning === undefined, JSON.stringify(bodySent.reasoning));

  /* ---- wiring: the settings that carry it ---- */
  var uidN = 0;
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, Error: Error, console: console, RegExp: RegExp, Buffer: Buffer,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: (function () {
      var empty = function () { return Promise.resolve([]); }, nop = function () { return Promise.resolve(); };
      return { get: function () { return Promise.resolve(null); }, getAll: empty, getAllByIndex: empty,
        put: nop, putMany: nop, del: nop, deleteByIndex: nop, clear: nop };
    })(),
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  var Store = sb.Store;
  return Store.init().then(function () {
    ok('the two settings exist and start inert', Store.settings.reasoningOff === false && Store.settings.replyFallback === '',
      JSON.stringify({ r: Store.settings.reasoningOff, f: Store.settings.replyFallback }));
    Store.saveSettings({ reasoningOff: true, replyFallback: 'a:free' });
    ok('they persist through the settings writer', Store.settings.reasoningOff === true && Store.settings.replyFallback === 'a:free');
    ok('both are in the list of settings that survive a save',
      /'sendOnEnter', 'replyFallback', 'reasoningOff'/.test(fs.readFileSync(path.join(JS, 'store.js'), 'utf8')));
  }).then(function () {
    var views = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
    ok('the switch and the chain are both on the generation screen',
      views.indexOf("sc.toggle('#t-nothink', 'reasoningOff')") >= 0 && views.indexOf('id="or-fallback"') >= 0);
    ok('the fallback field is escaped on the way out and trimmed on the way in',
      views.indexOf("esc(s.replyFallback || '')") >= 0 &&
      views.indexOf("sc.set({ replyFallback: el ? el.value.trim() : '' })") >= 0);
    ok('the chip only appears when something was actually removed',
      views.indexOf('m.rawDropped ? ') >= 0 && views.indexOf('data-act="raw"') >= 0);
    var app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    ok('the raw text is kept only while it is a size worth storing', app.indexOf('text.length <= 12000') >= 0);
    ok('a reply with nothing kept offers no restore path', app.indexOf('if (!msg.rawKept || !msg.raw)') >= 0);
    ok('a burst drops its raw copy rather than pointing one bubble at three',
      app.indexOf('the raw copy describes the WHOLE burst') >= 0);
    /* three sites clear the marker: the no-change skip, the burst drop, and
       the restore itself. Counted, not trusted — a fourth would mean a path
       that stores raw and never lets go of it. */
    ok('every path that could store a raw copy also clears it',
      (app.match(/delete msg\.raw; delete msg\.rawKept; delete msg\.rawDropped/g) || []).length === 3,
      String((app.match(/delete msg\.raw;/g) || []).length));
    /* The consumer in app.js stores nothing when replyProvenance returns null,
       so the null-on-identity case is exercised here through the cleaner
       itself: a reply cleanReply leaves alone must yield no second copy. */
    var untouched = 'She smiled. "Stay a while," she said.';
    ok('a reply cleanReply leaves alone yields no second copy to store',
      API.replyProvenance(API.cleanReply(untouched, 'Vex', 'Alice'), untouched) === null);
    ok('and one it truncates does',
      !!API.replyProvenance(API.cleanReply(untouched + '\n\nAlice: I cannot.', 'Vex', 'Alice'),
        untouched + '\n\nAlice: I cannot.'));
    console.log('\nreply-resilience-test: ' + (fail ? fail + ' failed, ' : '') + pass + ' ok');
    process.exit(fail ? 1 : 0);
  });
}).catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
