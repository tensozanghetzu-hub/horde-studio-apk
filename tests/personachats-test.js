/* Persona-aware Chats screen (v1.14.0).
 *
 * Every persona keeps its own chats with every character. A new persona
 * starts with none, so the Chats screen went blank and looked like data
 * loss. The fix is UI-side (a persona bar on the Chats screen, like Cast's,
 * plus an empty state that says "nothing was lost — your other identities
 * have conversations"), and this suite covers the data layer behind it:
 *
 *   - allSessions() only ever sees the active persona's threads
 *   - sessionTotal() sees everything, so the "nothing was lost" hint can
 *     fire exactly when another identity holds the conversations
 *   - deleting a persona removes its chats from both counts
 *
 *   node /home/user/tests/personachats-test.js
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

/* ---------------- fake IndexedDB (same harness as persona-test) ---------- */
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

(async function main() {
  section('1. an empty install: both counts agree at zero');
  var L = load({ key: 'settings', value: { userName: 'Marcus' } });
  await L.Store.init();
  eq('no sessions at all', await L.Store.sessionTotal(), 0);
  eq('active identity sees none', (await L.Store.allSessions()).length, 0);

  section('2. two personas, two chats each, one default chat');
  var elena = L.Store.blankPersona(); elena.name = 'Elena';
  var rin = L.Store.blankPersona(); rin.name = 'Rin';
  await L.Store.putPersona(elena);
  await L.Store.putPersona(rin);

  await L.Store.switchPersona(elena.id);
  await L.Store.putSession(L.Store.newSession('c1', 'With Sera'));
  await L.Store.putSession(L.Store.newSession('c2', 'With Bram'));
  await L.Store.switchPersona(rin.id);
  await L.Store.putSession(L.Store.newSession('c1', 'Rin meets Sera'));
  await L.Store.putSession(L.Store.newSession('c2', 'Rin meets Bram'));
  await L.Store.switchPersona('');
  await L.Store.putSession(L.Store.newSession('c1', 'Default chat'));

  eq('total across all identities is five', await L.Store.sessionTotal(), 5);

  section('3. the scared moment: a persona with no chats');
  await L.Store.switchPersona(rin.id);
  eq('the active identity sees only its own two', (await L.Store.allSessions()).length, 2);
  var noChats = L.Store.blankPersona(); noChats.name = 'Newbie';
  await L.Store.putPersona(noChats);
  await L.Store.switchPersona(noChats.id);
  eq('a brand-new persona sees zero', (await L.Store.allSessions()).length, 0);
  eq('…but the total still says five — the chats exist elsewhere',
    await L.Store.sessionTotal(), 5);
  ok('the hint condition fires: active empty, total non-empty',
    (await L.Store.allSessions()).length === 0 && (await L.Store.sessionTotal()) > 0);

  section('4. switching back, the old chats are exactly where they were');
  await L.Store.switchPersona(elena.id);
  eq('Elena sees her two again', (await L.Store.allSessions()).length, 2);
  await L.Store.switchPersona('');
  eq('the default identity sees its one', (await L.Store.allSessions()).length, 1);
  eq('total unchanged by all that switching', await L.Store.sessionTotal(), 5);

  section('5. deleting a persona removes its chats from both counts');
  var removed = await L.Store.delPersona(elena.id);
  eq('deleting Elena reports her two chats', removed, 2);
  eq('total drops to three', await L.Store.sessionTotal(), 3);
  await L.Store.switchPersona(rin.id);
  eq('Rin is unaffected', (await L.Store.allSessions()).length, 2);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
