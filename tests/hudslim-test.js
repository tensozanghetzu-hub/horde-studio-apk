/* hudslim-test — v1.39.8: the world HUD ends at the "correct state" button.
   Order: location, clock/turn, coins, the tasks pill, correct-state - and
   NOTHING below it. The sheet (stats chips, inventory line, conditions,
   equipment) used to eat the play field on a phone; its data still lives in
   the Life tab and the correct-state dialog, but the HUD keeps only what a
   turn needs. Retires worldhud-test, whose folded-sheet contract the user
   renegotiated by hand: hide it, don't fold it. */
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
    'HW.vitalStat = function () { return "hp"; };\n' +
    'HW.equipmentSlots = function () { return ["hand"]; };\n' +
    'HW.stripBriefingEcho = function (t) { return t; };\n' +
    'HW.saveRun = function () { return Promise.resolve(true); };',
    sandbox, { filename: 'stub-hw' });
  vm.runInNewContext(read('views.js'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

const WORLD = { gameRules: { modules: { commerce: true, inventory: true, conditions: true, equipment: true }, currencyName: 'coins' },
  hudConfig: { stats: [{ id: 'hp', name: 'Health', max: 10 }, { id: 'mana', name: 'Mana' }] }, name: 'W' };
const RUN = {
  locationId: 'loc_a', turn: 5, stats: { cash: 3, hp: 8, mana: 2 }, cashId: 'cash',
  inventory: ['lamp', 'rope'], conditions: ['hungry'], equip: { hand: 'knife' },
  quests: [{ text: 'Open errand', done: false }]
};

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const Views = loadViews();
    const viewsSrc = read('views.js');
    const hud = Views.worldHud(WORLD, RUN);

    console.log('A — the HUD ends at the correct-state button');
    ok('renders at all', typeof hud === 'string' && hud.length > 0);
    ok('the head row is there', hud.indexOf('wr-hud-row') !== -1);
    ok('place, clock, coins all present', hud.indexOf('The Docks') !== -1 &&
       hud.indexOf('Monday 08:00') !== -1 && hud.indexOf('coins') !== -1);
    ok('the tasks pill survives', hud.indexOf('wr-hud-fold') !== -1 && hud.indexOf('1 tasks') !== -1);
    ok('correct-state survives, and LAST in the head', hud.indexOf('wr-correct-btn') !== -1 &&
       hud.indexOf('wr-correct-btn') > hud.indexOf('wr-hud-fold'));

    console.log('B — the sheet is GONE, not folded');
    ok('no sheet container is emitted', hud.indexOf('wr-hud-more') === -1);
    ok('no sheet toggle button is emitted', hud.indexOf('wr-hud-toggle') === -1 &&
       hud.indexOf('sheet (') === -1);
    ok('no stat value leaks into the HUD', hud.indexOf('Mana') === -1 && hud.indexOf('Health') === -1 &&
       hud.indexOf('✧') === -1);
    ok('no inventory line leaks', hud.indexOf('lamp') === -1 && hud.indexOf('rope') === -1);
    ok('no condition chip leaks', hud.indexOf('hungry') === -1);
    ok('no equipment line leaks', hud.indexOf('knife') === -1);

    console.log('C — the fold of the TASK ledger still works (untouched)');
    ok('open tasks still show their block', hud.indexOf('wr-hud-tasks') !== -1 &&
       hud.indexOf('Open errand') !== -1);

    console.log('D — transient feedback still lands below');
    const hud2 = Views.worldHud(WORLD, RUN, { changes: ['took 2 coins'], rejections: ['rejected tag — nope'] });
    ok('change chips still render', hud2.indexOf('wr-changes') !== -1 && hud2.indexOf('took 2 coins') !== -1);
    ok('rejections still render', hud2.indexOf('wr-rejections') !== -1);

    console.log('E — the dead machinery is swept out of the source');
    ok('no sheet-fold state remains in views.js', viewsSrc.indexOf('wrHudOpen') === -1);
    ok('no sheet-fold handler remains', viewsSrc.indexOf('wr-hud-toggle') === -1);
    ok('no sheet row emission remains', viewsSrc.indexOf('wr-hud-more') === -1);
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nhudslim-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
