/* worldundo-test — v1.39.9: a slip of the thumb must not be a sentence.
   Chats can edit-and-resend; worlds could not take anything back, and a
   mistap committed coins, minutes and quests you never meant. Now the run
   carries ONE pre-turn snapshot (one level deep, never nested), an "Edit"
   chip shows on the LAST own bubble only, and taking the turn back restores
   the pre-turn state in place - then either returns your words to the box
   (Edit & resend) or leaves a clean field (take it back). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadHW() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp,
    Error, isNaN, parseFloat, parseInt, globalThis: null,
    fetch: f => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.runInNewContext(read('hordeworld.js'), sandbox, { filename: 'hordeworld.js' });
  return sandbox.HW;
}

function loadViews() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp,
    setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Store: { settings: { theme: 'midnight' }, characters: [], personas: [] },
    App: { state: {} },
    THEMES: { list: () => [], get: () => ({ tokens: {} }) },
    VH: {}
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  vm.runInNewContext(read('ui.js'), sandbox, { filename: 'ui.js' });
  vm.runInNewContext(
    'var HW = {};\n' +
    'HW.location = function () { return { id: "loc_a", name: "The Docks" }; };\n' +
    'HW.stripBriefingEcho = function (t) { return t; };\n' +
    'HW.clockOf = function () { return { text: "Monday 08:00" }; };',
    sandbox, { filename: 'stub-hw' });
  vm.runInNewContext(read('views.js'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const HW = loadHW();
    const Views = loadViews();
    const appSrc = read('app.js');
    const viewsSrc = read('views.js');
    const WORLD = { name: 'W', gameRules: { modules: {} } };

    console.log('A — the restore primitive, pure in hordeworld.js');
    ok('HW.adoptInto is exported', typeof HW.adoptInto === 'function');
    if (typeof HW.adoptInto === 'function') {
      const run = { id: 'r', turn: 12, stats: { cash: 0 }, log: [{ role: 'user', content: 'x' }], ghost: 1 };
      const pre = { id: 'r', turn: 11, stats: { cash: 5 }, log: [] };
      const same = HW.adoptInto(run, pre);
      ok('identity is PRESERVED (views keep their reference)', same === run && run.turn === 11 && run.stats.cash === 5);
      ok('keys the past lacks are swept', run.ghost === undefined);
      ok('the log is the pre-turn log', run.log.length === 0);
    }

    console.log('B — the snapshot travels with the run, one level deep');
    ok('the commit path stores the pre-turn snapshot', /\.lastTurnPre\s*=\s*pre/.test(appSrc));
    ok('...and strips any nested snapshot first (no towers)', /delete\s+pre\.lastTurnPre/.test(appSrc));
    ok('the undo restores through adoptInto', /HW\.adoptInto\(run,\s*snap|HW\.adoptInto\(run,\s*/.test(appSrc));
    ok('the undo clears the snapshot after use (one chance, not a loop)',
       /delete\s+run\.lastTurnPre/.test(appSrc));
    ok('the undo SAVES the rewound run', /worldUndo[\s\S]{0,1500}HW\.saveRun\(run\)/.test(appSrc));
    ok('the undo refuses mid-turn', /worldBusy[\s\S]{0,200}(Wait for the current|busy)/.test(appSrc));

    console.log('C — the two ways back, by name');
    ok('Edit & resend exists', /Edit & resend/.test(appSrc));
    ok('...and returns the words to the box, changed', /worldUndo[\s\S]{0,3000}UI\.input|UI\.input[\s\S]{0,2500}adoptInto/.test(appSrc));
    ok('a plain take-back path exists', /Take (this|the) turn back|take back/i.test(appSrc));

    console.log('D — only the LAST own bubble wears the pencil');
    const run = {
      locationId: 'loc_a', turn: 12, stats: { cash: 0 }, cashId: 'cash', quests: [],
      log: [
        { role: 'assistant', content: 'The yard waits.' },
        { role: 'user', content: 'You remain calm.' },
        { role: 'assistant', content: 'Silence answers.' },
        { role: 'user', content: 'Muscle memory kicks in.' }
      ]
    };
    ok('worldBubble takes an options bag', /function worldBubble\(m, world, opts\)/.test(viewsSrc));
    ok('the chip exists only for the editable tail turn',
       /opts && opts\.editable[\s\S]{0,200}wr-edit-turn|wr-edit-turn[\s\S]{0,200}opts\.editable/.test(viewsSrc));
    ok('the worldRun map computes the last own message', /lastUser|tail/i.test(
       (viewsSrc.match(/Views\.worldRun = function[\s\S]{0,1600}/) || [''])[0]));
    ok('...and gates on the snapshot', /Views\.worldRun = function[\s\S]{0,1600}lastTurnPre/.test(viewsSrc));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldundo-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
