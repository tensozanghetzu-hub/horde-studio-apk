/* Character cards with several starting scenarios (scenario_list, the
 * SillyTavern convention).
 *
 *   - import keeps the list and picks the card's declared default scenario
 *     (or the first listed one) into the `scenario` field — the field the
 *     prompt already injects, so choosing works with zero prompt changes
 *   - the card's default that is not in the list is appended, never lost
 *   - export carries the list back out for a round trip
 *   - the editor shows a picker chip only when there is more than one
 *
 *   node /home/user/tests/scenarios-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function same(label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- fake IndexedDB (persona-test pattern) --------------- */

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
    put: function (s, v) { st(s)[v.id !== undefined ? v.id : v.key] = v; return Promise.resolve(); },
    putMany: function (s, vals) { vals.forEach(function (v) { st(s)[v.id] = v; }); return Promise.resolve(); },
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
function loadStore() {
  var sandbox = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array,
    Math: Math, String: String, Error: Error, console: console,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: makeDb(),
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(STORE_SRC, 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

function v3(name, scenario, list, extra) {
  var data = Object.assign({
    name: name, description: 'desc', personality: 'pers',
    scenario: scenario, first_mes: 'hi there', mes_example: 'me: x\nc: y'
  }, extra || {});
  if (list) data.scenario_list = list;
  return { spec: 'chara_card_v3', spec_version: '3.0', data: data };
}
function v2(name, scenario, list) {
  var data = { name: name, description: 'desc', personality: 'pers', scenario: scenario, first_mes: 'hello' };
  if (list) data.scenario_list = list;
  return data;
}

(async function main() {
  var Store = loadStore();

  console.log('\nscenarioList normalizer');

  same('trims, drops empties, dedupes, keeps order',
    Store.scenarioList({ scenario_list: ['  A ', 'B', 'A', '', '   '] }), ['A', 'B']);
  same('card default not in the list is appended',
    Store.scenarioList({ scenario: 'C', scenario_list: ['A', 'B'] }), ['A', 'B', 'C']);
  same('card default already in the list is not duplicated',
    Store.scenarioList({ scenario: 'B', scenario_list: ['A', 'B'] }), ['A', 'B']);
  same('a lone default becomes a one-item list',
    Store.scenarioList({ scenario: 'W' }), ['W']);
  same('no scenario at all is an empty list',
    Store.scenarioList({}), []);
  same('a non-array scenario_list is ignored',
    Store.scenarioList({ scenario: 'W', scenario_list: 'not a list' }), ['W']);

  console.log('\nv3 import keeps the choices and picks the default');

  var c = Store.cardToCharacter(v3('Sera', 'S1', ['S1', 'S2']));
  same('list survives the import', c.scenarioList, ['S1', 'S2']);
  same('the card default is the chosen scenario', c.scenario, 'S1');
  ok('persona still merges description, personality and scenario (unchanged v3 rule)',
    c.persona.indexOf('desc') !== -1 && c.persona.indexOf('pers') !== -1 && c.persona.indexOf('S1') !== -1, c.persona);
  ok('greeting and examples untouched', c.greeting === 'hi there' && c.examples === 'me: x\nc: y');

  c = Store.cardToCharacter(v3('Sera', 'S0', ['S2', 'S3']));
  same('a default missing from the list is appended at the end', c.scenarioList, ['S2', 'S3', 'S0']);
  same('…and the card author\'s declared default still wins the choice', c.scenario, 'S0');

  c = Store.cardToCharacter(v3('Sera', '', ['S2', 'S3']));
  same('no declared default → the first listed one', c.scenario, 'S2');

  c = Store.cardToCharacter(v3('Sera', '', null));
  same('a card with no scenarios at all is unchanged (empty list)', c.scenarioList, []);
  ok('…and an empty scenario, as before', c.scenario === '');

  console.log('\nv2 import');

  c = Store.cardToCharacter(v2('Milo', '', ['X', 'Y']));
  same('empty scenario + list → first listed', c.scenario, 'X');
  same('list kept', c.scenarioList, ['X', 'Y']);

  c = Store.cardToCharacter(v2('Milo', 'Z', ['Y', 'Z']));
  same('declared scenario in the list wins', c.scenario, 'Z');
  same('list order preserved', c.scenarioList, ['Y', 'Z']);

  c = Store.cardToCharacter(v2('Milo', 'W', null));
  same('no list → just the scenario', c.scenario, 'W');
  same('…as a one-item list', c.scenarioList, ['W']);

  c = Store.cardToCharacter(v2('Milo', '', null));
  same('no scenario, no list → both empty', [c.scenario, c.scenarioList], ['', []]);

  console.log('\nexport round trip');

  var out = Store.characterToCard({ name: 'Sera', persona: 'p', scenario: 'S2', scenarioList: ['S1', 'S2'], greeting: 'g', examples: 'e' });
  same('the list goes out with the card', out.scenario_list, ['S1', 'S2']);
  ok('the chosen scenario rides along', out.scenario === 'S2');
  var reimport = Store.cardToCharacter(out);
  same('re-importing the export keeps the choices', reimport.scenarioList, ['S1', 'S2']);

  out = Store.characterToCard({ name: 'Plain', scenario: 'only', greeting: 'g' });
  ok('a character without a list exports without one', !('scenario_list' in out));

  console.log('\neditor chip');

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    fetch: function () { return Promise.resolve({ ok: false }); },
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      md: function (s) { return String(s || ''); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; }
    },
    Store: { settings: { userName: 'T' } },
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  var Views = sandbox.Views;

  ok('no list → no chip', Views.scenarioChip(null) === '' && Views.scenarioChip([]) === '');
  ok('a single scenario → no chip', Views.scenarioChip(['only one']) === '');
  var chip = Views.scenarioChip(['a', 'b']);
  ok('two scenarios → a picker chip with the count',
    chip.indexOf('data-act="scenarios"') !== -1 && chip.indexOf('Card scenarios (2)') !== -1, chip);
  ok('…and the number follows the list', Views.scenarioChip(['a', 'b', 'c', 'd']).indexOf('Card scenarios (4)') !== -1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
