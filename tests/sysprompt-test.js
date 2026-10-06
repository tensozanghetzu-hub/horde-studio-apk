/* Default system prompt — the v1.16.0 formatting line.
 *
 *   node /home/user/tests/sysprompt-test.js
 *
 * Covers the one-time migration: the default prompt gained a
 * dialogue/thought formatting line. The rules that matter:
 *   - a fresh install gets the new default
 *   - an existing install that never edited the prompt (it still holds the
 *     old default verbatim) is upgraded, and the upgrade is persisted
 *   - an existing install that ever edited the prompt, even one character,
 *     is left completely untouched — their words, not ours
 *   - "Reset to default" must use the real default (Store.defaultSystem),
 *     not a stale copy
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'store.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function contains(label, got, sub) {
  ok(label, typeof got === 'string' && got.indexOf(sub) !== -1, 'missing ' + JSON.stringify(sub));
}

/* The pre-v1.16.0 default, verbatim — the migration keys on an exact match. */
var LEGACY = 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
  'advancing the scene with concrete detail, action and dialogue. Never speak for {{user}}. ' +
  'Keep replies focused on what just happened and leave room for {{user}} to respond. ' +
  'Write only what {{char}} does and says: never include reasoning, planning, notes, ' +
  'outlines, or commentary about the prompt or the character card.';

var FMT_LINE = 'Use double quotes for spoken dialogue and asterisk italics (*like this*) for thoughts and actions.';

/* ---------------- fake IndexedDB (same shape as persona-test) ------------- */
function makeDb() {
  var stores = {};
  function st(n) { return stores[n] || (stores[n] = {}); }
  function rows(s) { return Object.keys(st(s)).map(function (k) { return st(s)[k]; }); }
  return {
    stores: stores,
    get: function (s, k) { return Promise.resolve(st(s)[k]); },
    getAll: function (s) { return Promise.resolve(rows(s)); },
    getAllByIndex: function (s, idx, key) {
      return Promise.resolve(rows(s).filter(function (r) { return r[idx] === key; }));
    },
    put: function (s, v) {
      st(s)[v.id !== undefined ? v.id : v.key] = v;
      return Promise.resolve();
    },
    putMany: function (s, vals) {
      vals.forEach(function (v) { st(s)[v.id] = v; });
      return Promise.resolve();
    },
    del: function (s, k) { delete st(s)[k]; return Promise.resolve(); },
    deleteByIndex: function (s, idx, key) {
      rows(s).forEach(function (r) { if (r[idx] === key) delete st(s)[r.id]; });
      return Promise.resolve();
    },
    clear: function (s) { stores[s] = {}; return Promise.resolve(); },
    countByIndex: function (s, idx, key) {
      return Promise.resolve(rows(s).filter(function (r) { return r[idx] === key; }).length);
    }
  };
}

var uidN = 0;
function load(settingsRow) {
  var db = makeDb();
  if (settingsRow) db.put('kv', settingsRow);
  var sandbox = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array,
    Math: Math, String: String, Error: Error, console: console,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: db,
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
  return { Store: sandbox.Store, db: db };
}

function section(t) { console.log('\n' + t); }

/* ================= 1. the new default ================= */
function testDefault() {
  section('1. the default prompt carries the formatting line');
  var L = load(null);
  return L.Store.init().then(function () {
    contains('fresh install: default has the formatting line', L.Store.settings.systemPrompt, FMT_LINE);
    contains('default still speaks for the character', L.Store.settings.systemPrompt, 'You are {{char}}.');
    eq('Store.defaultSystem is exported for the reset button', L.Store.defaultSystem, L.Store.settings.systemPrompt);
  });
}

/* ================= 2. never edited: upgraded ================= */
function testLegacyUpgraded() {
  section('2. an install holding the old default verbatim is upgraded');
  var L = load({ key: 'settings', value: { userName: 'Marcus', systemPrompt: LEGACY } });
  return L.Store.init().then(function () {
    contains('prompt now has the formatting line', L.Store.settings.systemPrompt, FMT_LINE);
    eq('prompt is the new default', L.Store.settings.systemPrompt, L.Store.defaultSystem);
    ok('everything else preserved', L.Store.settings.userName === 'Marcus');
    var row = L.db.stores.kv.settings;
    contains('upgrade was persisted, not just patched in memory', row.value.systemPrompt, FMT_LINE);
  });
}

/* ================= 3. edited: untouched ================= */
function testEditedUntouched() {
  section('3. an install that ever edited the prompt is left alone');

  /* one character changed — still recognisably the old default */
  var L1 = load({ key: 'settings', value: { systemPrompt: LEGACY.replace('immersive', 'immersive,') } });
  var r1 = L1.Store.init().then(function () {
    eq('one-char edit: prompt byte-identical to what they saved', L1.Store.settings.systemPrompt, LEGACY.replace('immersive', 'immersive,'));
  });

  /* a fully custom prompt */
  var CUSTOM = 'Keep it short. She is shy and never raises her voice.';
  var L2 = load({ key: 'settings', value: { systemPrompt: CUSTOM } });
  var r2 = L2.Store.init().then(function () {
    eq('custom prompt: untouched', L2.Store.settings.systemPrompt, CUSTOM);
  });

  return Promise.all([r1, r2]);
}

Promise.all([testDefault(), testLegacyUpgraded(), testEditedUntouched()])
  .then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) {
    console.error('suite crashed: ' + (e && e.stack || e));
    process.exit(1);
  });
