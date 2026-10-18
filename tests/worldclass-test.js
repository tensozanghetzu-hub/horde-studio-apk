/* v1.38.0 — classwork: a begin sheet for worlds that declare classes.
 * The chain - life picker (if any) -> class picker (if any) -> begin -
 * is exercised against the real Views + App with an honest DOM and an
 * in-memory library; the decisions are captured at the App namespace.
 *
 *   node /home/user/tests/worldclass-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- a small honest DOM (worldturnbar pattern) ------------ */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '',
    scrollTop: 0, scrollHeight: 0,
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    addEventListener: function () {},
    getAttribute: function () { return null; },
    setAttribute: function () {},
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var els = {
  '#worlds-body': el(),
  '#wr-input': el(),
  '#wr-hud': el(),
  '#wr-thread': el(),
  '#wr-typing': el(),
  '#bar-title': el(),
  '#bar-sub': el(),
  '#btn-back': el(),
  '#btn-bar-action': el()
};
var documentStub = {
  addEventListener: function () {},
  querySelector: function (sel) { return els[sel] || null; },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return els['#' + id] || null; }
};

/* ---------------- fake IDB: real in-memory stores ---------------------- */
var stores = { worlds: {}, worldRuns: {} };
var fakeDb = {
  put: function (s, v) { stores[s][v.id] = v; return Promise.resolve(); },
  getAll: function (s) { return Promise.resolve(Object.keys(stores[s] || {}).map(function (k) { return stores[s][k]; })); },
  get: function (s, id) { return Promise.resolve((stores[s] || {})[id] || null); },
  del: function (s, id) { delete (stores[s] || {})[id]; return Promise.resolve(); }
};

/* ---------------- the world file with classes --------------------------- */
var CLASS_WORLD = {
  _format: 'horde-world', _version: '1.4',
  id: 'world_classwork', name: 'The Brine Courts',
  description: 'Salt-law, knife-law.',
  startLocationId: 'loc_quay',
  locations: [{ id: 'loc_quay', name: 'The Old Quay', description: 'Brine and bell.', exits: [] }],
  entities: [], factions: [], relationships: [],
  lorebook: [],
  startingLives: [{ id: 'origin_main', name: 'New Face', role: 'A stranger.',
    startLocationId: 'loc_quay', description: 'You arrive wet.', statOverrides: { grit: 6 },
    obligations: ['Find a name'], outfit: 'borrowed oilskins' }],
  skillsCatalog: [
    { id: 'skill_lockpicking', name: 'Lockpicking', description: 'Thin wire.', stat: 'finesse' }
  ],
  classes: [
    { id: 'cls_thief', name: 'Cutpurse', description: 'Fingers first, questions later.',
      statOverrides: { finesse: 8, grit: 12 }, skills: ['skill_lockpicking'],
      obligations: ['Repay the fence'], outfit: 'a coat with too many pockets' }
  ],
  gameRules: {}, startingQuests: [],
  hudConfig: { stats: [
    { id: 'finesse', name: 'Finesse', value: 5, min: 0, max: 10 },
    { id: 'grit', name: 'Grit', value: 4, min: 0, max: 10 }
  ]},
  intro: 'The quay gulls scatter.', dmPrompt: 'Be the law of salt.'
};
var TWO_LIVES_WORLD = JSON.parse(JSON.stringify(CLASS_WORLD));
TWO_LIVES_WORLD.id = 'world_twolives';
TWO_LIVES_WORLD.startingLives = [
  CLASS_WORLD.startingLives[0],
  { id: 'origin_sailor', name: 'Deck-Hand', role: 'An old hand.', startLocationId: 'loc_quay',
    description: 'You never left.', statOverrides: {}, obligations: [], outfit: 'salt-torn wool' }
];
var PLAIN_WORLD = JSON.parse(JSON.stringify(CLASS_WORLD));
PLAIN_WORLD.id = 'world_plain';
delete PLAIN_WORLD.classes;
delete PLAIN_WORLD.skillsCatalog;

/* ---------------- sandbox ---------------------------------------------- */
var toasts = [];
var records = [];
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  fetch: function (f) {
    var file = path.join(ROOT, 'horde-studio-mobile', String(f));
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
    } });
  },
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function (m) { toasts.push(String(m)); },
    sheet: function () {}
  },
  Store: { settings: { provider: 'horde' }, personas: [] },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: { generate: function () { return Promise.resolve(''); } },
  IDB: fakeDb
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });
var HW = sandbox.HW, Views = sandbox.Views, App = sandbox.App;

/* the library holds the parsed worlds the way the phone keeps them */
stores.worlds.world_classwork = HW.parse(JSON.parse(JSON.stringify(CLASS_WORLD)));
stores.worlds.world_twolives = HW.parse(JSON.parse(JSON.stringify(TWO_LIVES_WORLD)));
stores.worlds.world_plain = HW.parse(JSON.parse(JSON.stringify(PLAIN_WORLD)));

/* finish at the door: we capture the final open instead of rendering it */
var opened = [];
App.openWorldRun = function (runId) { opened.push(runId); return Promise.resolve(); };

function reset() {
  els['#worlds-body'].innerHTML = '';
  opened.length = 0;
  stores.worldRuns = {};
}

/* flush the fire-and-forget chains: fake idb resolves synchronously, so one
   macrotask sweeps every queued microtask */
var tickC = 0;
function tick(fn) {
  return Promise.resolve(fn()).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  });
}

Promise.resolve().then(function () {
  console.log('\nclasswork - the begin sheet for worlds that declare classes\n');

  reset();
  return tick(function () { App.startWorld('world_classwork'); }).then(function () {
    var h = els['#worlds-body'].innerHTML;
    ok('a classed world asks who you are', /Cutpurse/.test(h), h.slice(0, 80));
    ok('...and tells what the class brings', /too many pockets|Repay the fence|Lockpicking/.test(h));
    ok('...and offers the no-class door', /No class/.test(h));
    ok('and it does not begin before you answer', opened.length === 0);
  });
}).then(function () {
  /* picking a class walks to beginWorld with it */
  reset();
  return tick(function () { App.beginWorld('world_classwork', 'origin_main', 'cls_thief'); }).then(function () {
    var rid = opened[0], run = rid && stores.worldRuns[rid];
    ok('beginning saves the run', !!run, JSON.stringify(opened));
    eq('...with the chosen class', run && run.classId, 'cls_thief');
    eq('...its gifted skill at level one', run && run.skills.skill_lockpicking, 1);
    eq('...its class-shaped stats', run && run.stats.finesse, 8);
    ok('...and both wardrobes', run && /oilskins/.test(run.outfit) && /pockets/.test(run.outfit));
  });
}).then(function () {
  /* the no-class door is an ordinary begin */
  reset();
  return tick(function () { App.beginWorld('world_classwork', 'origin_main', null); }).then(function () {
    var rid = opened[0], run = rid && stores.worldRuns[rid];
    ok('walking past the classes keeps the run classless', run && !run.classId);
    eq("...and the life's own numbers stand", run && run.stats.finesse, 5);
  });
}).then(function () {
  /* the roles sheet walks into the classes sheet */
  reset();
  var se = fs.readFileSync(src('js/views.js'), 'utf8');
  return tick(function () { App.startWorld('world_twolives'); }).then(function () {
    var h = els['#worlds-body'].innerHTML;
    ok('a many-lived, classed world asks for the life first', /New Face/.test(h) && /Deck-Hand/.test(h));
    ok('...and the roles sheet hands over to the class gate',
      /beginOrPickClass/.test(se), 'roles flow: ' + (/App\.beginWorld/.test(se) ? 'still begins directly' : 'rewired'));
  });
}).then(function () {
  /* a plain world never sees the sheet */
  reset();
  return tick(function () { App.startWorld('world_plain'); }).then(function () {
    ok('an ordinary world begins without being quizzed',
      opened.length === 1 && els['#worlds-body'].innerHTML.indexOf('Cutpurse') === -1,
      'opened=' + JSON.stringify(opened));
  });
}).then(function () {
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL threw ' + (e && e.stack || e));
  process.exit(1);
});
