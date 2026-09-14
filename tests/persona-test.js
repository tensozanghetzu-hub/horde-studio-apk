/* Personas — switchable player identities.
 *
 *   node /home/user/tests/persona-test.js
 *
 * Covers the parts that are easy to get quietly wrong:
 *   - an existing install must behave exactly as it did before 1.5.0
 *   - a persona's chats must be invisible to other personas
 *   - switching must swap the identity that every existing code path reads,
 *     because those paths all read settings.userName / settings.userPersona
 *   - switching away and back must not lose the default identity
 *   - editing identity in Settings must land on the right record
 *   - deleting a persona must take its chats with it, and nothing else
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

/* ---------------- fake IndexedDB ---------------- */
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

/* ================= 1. migration ================= */
function testMigration() {
  section('1. an existing install must not change behaviour');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'a blacksmith' } });
  return L.Store.init().then(function () {
    var s = L.Store.settings;
    eq('activePersona seeded to empty string', s.activePersona, '');
    eq('defaultName seeded from userName', s.defaultName, 'Marcus');
    eq('defaultPersona seeded from userPersona', s.defaultPersona, 'a blacksmith');
    eq('userName still what every code path reads', s.userName, 'Marcus');
    eq('userPersona unchanged', s.userPersona, 'a blacksmith');
    eq('no personas exist yet', L.Store.personas.length, 0);
    eq('personaLabel falls back to defaultName', L.Store.personaLabel(), 'Marcus');
    return L.Store.saveSettings();
  }).then(function () {
    /* the migration must persist, not just patch memory */
    var row = L.db.stores.kv.settings;
    eq('migration was written back to storage', row.value.defaultName, 'Marcus');
  });
}

/* ================= 2. fresh install ================= */
function testFresh() {
  section('2. a fresh install gets sane defaults');
  var L = load(null);
  return L.Store.init().then(function () {
    var s = L.Store.settings;
    eq('activePersona empty', s.activePersona, '');
    eq('defaultName is You by default', s.defaultName, 'You');
    eq('no personas', L.Store.personas.length, 0);
  });
}

/* ================= 3. session scoping ================= */
function testScoping() {
  section('3. each persona sees only its own chats');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'blacksmith' } });
  var elena, marcusChat, elenaChat, legacyChat;

  return L.Store.init()
    .then(function () {
      /* a chat that predates 1.5.0 — no personaId at all */
      legacyChat = L.Store.newSession('c1', 'legacy chat');
      delete legacyChat.personaId;
      return L.Store.putSession(legacyChat);
    })
    .then(function () {
      marcusChat = L.Store.newSession('c1', 'Marcus chat');
      eq("default session is stamped with ''", marcusChat.personaId, '');
      return L.Store.putSession(marcusChat);
    })
    .then(function () {
      elena = L.Store.blankPersona();
      elena.name = 'Elena';
      elena.text = 'a courier';
      return L.Store.putPersona(elena);
    })
    .then(function () { return L.Store.switchPersona(elena.id); })
    .then(function () {
      elenaChat = L.Store.newSession('c1', 'Elena chat');
      eq('session is stamped with the active persona', elenaChat.personaId, elena.id);
      return L.Store.putSession(elenaChat);
    })
    .then(function () {
      /* as Elena */
      return L.Store.getSessions('c1');
    })
    .then(function (list) {
      eq('Elena sees exactly one chat', list.length, 1);
      eq('and it is hers', list[0].title, 'Elena chat');
      return L.Store.switchPersona('');
    })
    .then(function () { return L.Store.getSessions('c1'); })
    .then(function (list) {
      eq('Marcus sees two chats', list.length, 2);
      var titles = list.map(function (s) { return s.title; }).sort();
      eq('his own plus the pre-1.5.0 one', titles.join('|'), 'Marcus chat|legacy chat');
      return L.Store.allSessions();
    })
    .then(function (list) {
      eq("allSessions is scoped the same way", list.length, 2);
    });
}

/* ================= 4. switching swaps the live identity ================= */
function testSwitching() {
  section('4. switching swaps what every existing code path reads');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'blacksmith' } });
  var elena;

  return L.Store.init()
    .then(function () {
      elena = L.Store.blankPersona();
      elena.name = 'Elena';
      elena.text = 'a courier';
      return L.Store.putPersona(elena);
    })
    .then(function () {
      return L.Store.switchPersona(elena.id);
    })
    .then(function () {
      /* these two are what api.js, vhuman.js and views.js all read */
      eq('settings.userName became the persona', L.Store.settings.userName, 'Elena');
      eq('settings.userPersona became the persona', L.Store.settings.userPersona, 'a courier');
      eq('activePersona points at the persona', L.Store.settings.activePersona, elena.id);
      eq('personaLabel reports the persona', L.Store.personaLabel(), 'Elena');
      /* and the default was stashed, not lost */
      eq('default identity was stashed', L.Store.settings.defaultName, 'Marcus');
      eq('default persona was stashed', L.Store.settings.defaultPersona, 'blacksmith');
      return L.Store.switchPersona('');
    })
    .then(function () {
      eq('switching back restores userName', L.Store.settings.userName, 'Marcus');
      eq('switching back restores userPersona', L.Store.settings.userPersona, 'blacksmith');
      eq('activePersona cleared', L.Store.settings.activePersona, '');
      /* the persona record itself must be untouched by the round trip */
      var p = L.Store.personas.find(function (x) { return x.id === elena.id; });
      eq('persona record survives the round trip', p && p.name, 'Elena');
      return L.Store.switchPersona(elena.id);
    })
    .then(function () {
      eq('and we can go forward again', L.Store.settings.userName, 'Elena');
      eq('bonds key on this name', L.Store.settings.userName, 'Elena');
    });
}

/* ================= 5. editing identity in Settings ================= */
function testSetIdentity() {
  section('5. Settings edits land on the right record');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'blacksmith' } });
  var elena;

  return L.Store.init()
    .then(function () {
      return L.Store.setIdentity({ name: 'Marcus Aurelius' });
    })
    .then(function () {
      eq('with no persona, default name updates', L.Store.settings.defaultName, 'Marcus Aurelius');
      eq('and the live name updates too', L.Store.settings.userName, 'Marcus Aurelius');
      elena = L.Store.blankPersona();
      elena.name = 'Elena';
      elena.text = 'a courier';
      return L.Store.putPersona(elena);
    })
    .then(function () { return L.Store.switchPersona(elena.id); })
    .then(function () { return L.Store.setIdentity({ name: 'Elena Vance', text: 'a tired courier' }); })
    .then(function () {
      var p = L.Store.personas.find(function (x) { return x.id === elena.id; });
      eq('persona record got the new name', p.name, 'Elena Vance');
      eq('persona record got the new text', p.text, 'a tired courier');
      eq('live name follows', L.Store.settings.userName, 'Elena Vance');
      /* the default must NOT have been clobbered by a persona edit */
      eq('default identity untouched by persona edit', L.Store.settings.defaultName, 'Marcus Aurelius');
      return L.Store.switchPersona('');
    })
    .then(function () {
      eq('back to default, default is intact', L.Store.settings.userName, 'Marcus Aurelius');
    });
}

/* ================= 6. deleting a persona ================= */
function testDelete() {
  section('6. deleting a persona takes its chats, and only its chats');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'blacksmith' } });
  var elena, other;

  return L.Store.init()
    .then(function () {
      elena = L.Store.blankPersona(); elena.name = 'Elena';
      other = L.Store.blankPersona(); other.name = 'Sam';
      return L.Store.putPersona(elena);
    })
    .then(function () { return L.Store.putPersona(other); })
    .then(function () { return L.Store.switchPersona(elena.id); })
    .then(function () {
      return L.Store.putSession(L.Store.newSession('c1', 'Elena c1'))
        .then(function () { return L.Store.putSession(L.Store.newSession('c2', 'Elena c2')); });
    })
    .then(function () { return L.Store.switchPersona(other.id); })
    .then(function () { return L.Store.putSession(L.Store.newSession('c1', 'Sam c1')); })
    .then(function () { return L.Store.delPersona(elena.id); })
    .then(function (n) {
      eq('reported how many chats went', n, 2);
      /* Elena was NOT the active persona here, so we must stay on Sam */
      eq('deleting an inactive persona leaves you where you were', L.Store.settings.activePersona, other.id);
      eq('identity unchanged', L.Store.settings.userName, 'Sam');
      return L.Store.allSessions();
    })
    .then(function (list) {
      eq('only Sam’s chat remains', list.length, 1);
      eq('and it is Sam’s', list[0].title, 'Sam c1');
      eq('the other persona is untouched', L.Store.personas.length, 1);
      eq('it is the right one', L.Store.personas[0].name, 'Sam');
    })
    /* now delete the persona we are actually using — that must fall back */
    .then(function () { return L.Store.delPersona(other.id); })
    .then(function () {
      eq('deleting the active persona falls back to default', L.Store.settings.activePersona, '');
      eq('identity restored to the default', L.Store.settings.userName, 'Marcus');
      eq('no personas left', L.Store.personas.length, 0);
      return L.Store.allSessions();
    })
    .then(function (list) {
      eq('and all its chats went too', list.length, 0);
    });
}

/* ================= 7. backup round trip ================= */
function testBackup() {
  section('7. backup and restore carry personas');
  var L = load({ key: 'settings', value: { userName: 'Marcus', userPersona: 'blacksmith' } });
  var elena, json;

  return L.Store.init()
    .then(function () {
      elena = L.Store.blankPersona(); elena.name = 'Elena'; elena.text = 'a courier';
      return L.Store.putPersona(elena);
    })
    .then(function () { return L.Store.switchPersona(elena.id); })
    .then(function () { return L.Store.putSession(L.Store.newSession('c1', 'Elena chat')); })
    .then(function () { return L.Store.exportAll(); })
    .then(function (text) {
      json = JSON.parse(text);
      eq('backup carries the personas', json.personas.length, 1);
      eq('and the right one', json.personas[0].name, 'Elena');
      eq('settings carry the active persona', json.settings.activePersona, elena.id);
      eq('credentials are stripped', json.settings.apiKey, undefined);
      var R = load(null);
      return R.Store.importAll(text).then(function (counts) {
        eq('import counted the persona', counts.personas, 1);
        return R.Store.init();
      }).then(function () {
        eq('restored persona list', R.Store.personas.length, 1);
        eq('restored persona name', R.Store.personas[0].name, 'Elena');
        /* Settings were never part of a backup (pre-1.5.0 behaviour, kept), so
           the restored install starts on the default identity, not on Elena. */
        eq('restored install starts on default identity', R.Store.settings.activePersona, '');
        return R.Store.getSessions('c1');
      }).then(function (list) {
        eq('Elena’s chat is not visible to the default identity', list.length, 0);
        /* switching to her must reveal it — that is the whole point */
        var p = R.Store.personas[0];
        return R.Store.switchPersona(p.id).then(function () { return R.Store.getSessions('c1'); });
      }).then(function (list) {
        eq('switching to the restored persona reveals her chat', list.length, 1);
        eq('right chat', (list[0] || {}).title, 'Elena chat');
        eq('identity followed the switch', R.Store.settings.userName, 'Elena');
      });
    });
}

/* ================= 8. wipe ================= */
function testWipe() {
  section('8. wiping data clears personas');
  var L = load({ key: 'settings', value: { userName: 'Marcus' } });
  return L.Store.init()
    .then(function () {
      var p = L.Store.blankPersona(); p.name = 'Elena';
      return L.Store.putPersona(p);
    })
    .then(function () { return L.Store.wipe(); })
    .then(function () {
      eq('personas cleared', L.Store.personas.length, 0);
      return L.Store.personas;
    })
    .then(function () {
      ok('wipe resolved to an array', Array.isArray(L.Store.personas));
    });
}

/* ================= run ================= */
testMigration()
  .then(testFresh)
  .then(testScoping)
  .then(testSwitching)
  .then(testSetIdentity)
  .then(testDelete)
  .then(testBackup)
  .then(testWipe)
  .then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) {
    console.log('\nCRASH ' + (e && e.stack || e));
    process.exit(1);
  });
