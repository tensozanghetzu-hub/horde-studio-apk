/* worldfold-test — v1.39.5: on a phone the world HUD's task ledger ate half
   the screen whenever two or three threads were open. The tasks now live in
   their own block under the head, foldable through an "N tasks ▸/▾" pill,
   and the fold choice PERSISTS on the run (run.hudTasksOpen). Old runs
   default open: nothing anyone relies on vanishes without a tap. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

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
    'HW.clockOf = function () { return { text: "Monday 08:00" }; };\n' +
    'HW.vitalStat = function () { return null; };\n' +
    'HW.equipmentSlots = function () { return []; };\n' +
    'HW.saveRun = function () { return Promise.resolve(true); };',
    sandbox, { filename: 'stub-hw' });
  vm.runInNewContext(read('views.js'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

const WORLD = { gameRules: { modules: {}, currencyName: 'coins' }, hudConfig: { stats: [] }, name: 'W' };
function mkRun(extra) {
  return Object.assign({
    locationId: 'loc_a', turn: 3, stats: { cash: 12 }, cashId: 'cash',
    inventory: [], quests: [
      { text: 'Find the rune broker', done: false },
      { text: 'Pay the ferry toll', done: false },
      { text: 'Finished errand', done: true }
    ]
  }, extra || {});
}

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const Views = loadViews();
    const viewsSrc = read('views.js');

    console.log('A — the task ledger folds');
    const h = Views.worldHud(WORLD, mkRun());
    ok('a fold pill exists when tasks are open', /data-act="wr-hud-fold"/.test(h), h.slice(0, 300));
    ok('the pill counts the open tasks (2, not the done one)', /2 tasks/.test(h));
    ok('tasks live in their own full-width block, not in the head row',
       h.indexOf('wr-hud-tasks') !== -1 &&
       h.indexOf('wr-hud-row') !== -1 && h.indexOf('wr-hud-tasks') > h.indexOf('wr-hud-row'));
    ok('the head row no longer inlines the task texts',
       !(/wr-hud-row[\s\S]{0,400}Find the rune broker/.test(h.split('wr-hud-tasks')[0])));
    ok('each open task is rendered in the fold', /Find the rune broker/.test(h) && /Pay the ferry toll/.test(h));
    ok('done tasks stay out of the ledger', !/Finished errand/.test(h));

    console.log('B — the fold choice is remembered on the run');
    const closed = Views.worldHud(WORLD, mkRun({ hudTasksOpen: false }));
    ok('a closed run renders the fold hidden', /wr-hud-tasks[^>]*hidden/.test(closed));
    ok('...but the pill still shows the count (peek without reveal)', /2 tasks/.test(closed));
    const open = Views.worldHud(WORLD, mkRun({ hudTasksOpen: true }));
    ok('an open run shows the ledger', !/wr-hud-tasks[^>]*hidden/.test(open));
    ok('old-shape runs (no marker) default to open', !/wr-hud-tasks[^>]*hidden/.test(h));

    console.log('C — the fold never hides the essentials');
    ok('location stays visible when folded', /The Docks/.test(closed));
    ok('clock and turn stay visible when folded', /Monday 08:00/.test(closed) && /turn 3/.test(closed));
    ok('purse stays visible when folded', /12<\/b> coins|<b>12<\/b>/.test(closed), closed.slice(0, 200));
    ok('correct-state button stays in the head when folded', /data-act="wr-correct"/.test(closed));

    console.log('D — tidy edges and the wiring');
    ok('no pill when no tasks are open', !/data-act="wr-hud-fold"/.test(Views.worldHud(WORLD, mkRun({ quests: [] }))));
    ok('the binder handles the fold click', /data-act=wr-hud-fold/.test(viewsSrc));
    ok('the binder flips the run marker', /hudTasksOpen\s*=\s*!/.test(viewsSrc));
    ok('...and persists it (HW.saveRun)', /hudTasksOpen[\s\S]{0,200}saveRun|saveRun[\s\S]{200}hudTasksOpen/.test(viewsSrc));
    ok('the binder receives the run (signature change)', /bindWorldHud\s*=\s*function\s*\(hud,\s*world,\s*run\)/.test(viewsSrc) &&
        /bindWorldHud\(hud,\s*world,\s*run\)/.test(viewsSrc));
    ok('styling pinned for the new block', /\.wr-hud-tasks/.test(fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'css', 'app.css'), 'utf8')));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldfold-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
