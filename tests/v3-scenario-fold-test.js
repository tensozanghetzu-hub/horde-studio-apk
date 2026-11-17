#!/usr/bin/env node
/* A1 + H1 — the V3 scenario fold and the lossy export.
 *
 * A1: a V3 card must not carry its scenario twice (persona + "Current
 *     situation:"). The V2 branch never folded; V3 did.
 * H1: characters already damaged by the old fold must export clean, and the
 *     repair must not eat a persona that merely mentions the scenario.
 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var STORE = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, got === want, JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

var uidN = 0;
function loadStore() {
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array,
    Math: Math, String: String, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, atob: atob, btoa: btoa,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(STORE, 'utf8'), sb, { filename: 'store.js' });
  return sb.Store;
}
var Store = loadStore();

var SCENARIO = 'SCENARIO-SENTINEL-TEXT';
var PERSONA = 'PERSONA-SENTINEL-TEXT';

function v3(extra) {
  return {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: Object.assign({
      name: 'Sera', description: PERSONA, personality: 'p', scenario: SCENARIO,
      first_mes: 'hi', mes_example: ''
    }, extra || {})
  };
}
function v2(extra) {
  return {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: Object.assign({
      name: 'Sera', description: PERSONA, personality: 'p', scenario: SCENARIO,
      first_mes: 'hi', mes_example: ''
    }, extra || {})
  };
}

console.log('A1 — a V3 import no longer duplicates the scenario');

var c3 = Store.cardToCharacter(v3());
ok('the persona does not contain the scenario', c3.persona.indexOf(SCENARIO) === -1, c3.persona);
ok('the persona still contains the description', c3.persona.indexOf(PERSONA) !== -1);
same('the scenario lands in its own field', c3.scenario, SCENARIO);

var c2 = Store.cardToCharacter(v2());
ok('V2 and V3 now agree on the persona shape', c3.persona === c2.persona,
  JSON.stringify([c3.persona, c2.persona]));

console.log('\nH1 — an already-damaged character exports clean');

/* exactly what the old importer produced: persona with the scenario folded in */
var damaged = Store.cardToCharacter(v2());
damaged.persona = PERSONA + '\n\n' + SCENARIO;
var out = Store.characterToCard(damaged);
ok('description no longer carries the scenario', out.description.indexOf(SCENARIO) === -1, out.description);
same('description keeps the persona text', out.description, PERSONA);
same('the scenario is still written to its own field', out.scenario, SCENARIO);

/* the thing the doc calls permanent: three import/export cycles */
var trip = damaged;
for (var i = 0; i < 3; i++) {
  trip = Store.cardToCharacter(Store.characterToCard(trip));
}
ok('three round trips do not grow a second copy', trip.persona.split(SCENARIO).length - 1 === 0,
  trip.persona);
same('…and the scenario survives each cycle', trip.scenario, SCENARIO);

console.log('\nH1 — the repair is narrow, not a fuzzy strip');

var legit = Store.cardToCharacter(v2());
/* a persona that MENTIONS the scenario but does not end with it */
legit.persona = PERSONA + ' The situation described below is ' + SCENARIO + ' and that matters.';
var kept = Store.characterToCard(legit);
ok('a mid-sentence mention is kept', kept.description.indexOf(SCENARIO) !== -1, kept.description);

/* a persona ending with text that merely resembles the scenario */
var lookalike = Store.cardToCharacter(v2());
lookalike.persona = PERSONA + '\n\n' + SCENARIO + ' (alternate)';
var kept2 = Store.characterToCard(lookalike);
ok('a near-miss tail is kept', kept2.description.indexOf(SCENARIO) !== -1, kept2.description);

console.log('\nH1 — exporter edge cases');
same('an empty persona stays empty', Store.stripDuplicateScenario('', SCENARIO), '');
same('no scenario leaves the persona alone',
  Store.stripDuplicateScenario(PERSONA, ''), PERSONA);
same('a persona that IS the scenario exports empty',
  Store.stripDuplicateScenario(SCENARIO, SCENARIO), '');
same('whitespace is not mistaken for a duplicate block',
  Store.stripDuplicateScenario(PERSONA + ' ' + SCENARIO, SCENARIO), PERSONA + ' ' + SCENARIO);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
