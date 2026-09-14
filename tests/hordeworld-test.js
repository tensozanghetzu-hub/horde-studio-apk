/* Authored worlds: import, the cast, the clock, dice, and the referee's tags.
 *
 * Driven by the real upstream world (Policy Panic at Bramble & Pike) with the
 * art stripped, so this exercises the actual shipped data rather than a toy.
 *
 *   node /home/user/tests/hordeworld-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'hordeworld.js');
var WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-panic.horde_world'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadHW() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, globalThis: null,
    fetch: function (f) {
      var file = path.join(__dirname, '..', 'horde-studio-mobile', String(f));
      if (!fs.existsSync(file)) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
      } });
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'hordeworld.js' });
  return sandbox.HW;
}
var HW = loadHW();

console.log('\nimporting a .horde_world');

var w = HW.parse(WORLD);
ok('the real world parses', !!w);
eq('name', w.name, 'Policy Panic at Bramble & Pike');
eq('every location kept', (w.locations || []).length, 23);
eq('every person kept', (w.entities || []).length, 8);
eq('every faction kept', (w.factions || []).length, 6);
eq('every lorebook entry kept', (w.lorebook || []).length, 15);
eq('every starting role kept', (w.startingLives || []).length, 7);
eq('every relationship kept', (w.relationships || []).length, 14);

ok('the base64 banner is dropped', w.banner === undefined);
ok('embedded media is dropped', w.mediaAssets === undefined);
ok('per-location artwork is dropped',
  (w.locations || []).every(function (l) { return l.visuals === undefined; }));
ok('per-person artwork is dropped',
  (w.entities || []).every(function (e) { return e.visuals === undefined; }));

ok('a file that is not a world is refused', HW.parse({ hello: 1 }) === null);
ok('null is refused', HW.parse(null) === null);
ok('a world with nowhere in it is refused', HW.parse({ _format: 'horde-world', locations: [] }) === null);

var sum = HW.summarise(w);
eq('the summary counts the locations', sum.locations, 23);
eq('and the people', sum.people, 8);

console.log('\nplaces and people');

var reception = HW.location(w, 'loc_reception');
ok('the world opens in reception', !!reception, w.startLocationId);

var ex = HW.exits(w, 'loc_reception');
ok('reception has exits', ex.length > 0, ex.length + ' exits');
ok('exits resolve to real places by their name',
  ex.filter(function (e) { return e.to; }).length > 0,
  JSON.stringify(ex.map(function (e) { return e.label + '->' + e.to; })));
ok('and carry a travel time in minutes',
  ex.some(function (e) { return e.minutes !== null && e.minutes > 0; }));

var here = HW.npcsAt(w, 'loc_reception');
ok('someone is in reception', here.length > 0, here.map(function (n) { return n.name; }).join(', '));
ok('they bring their persona', here.every(function (n) { return !!n.persona; }));

var lore = HW.loreHits(w, 'What does the company actually do here?');
ok('naming the company surfaces its lore', lore.length > 0, lore.length + ' entries');
ok('irrelevant chatter surfaces nothing', HW.loreHits(w, 'zzz qqq').length === 0);

console.log('\ndice');

var r = HW.roll('2d6+3');
ok('2d6+3 rolls two dice', r && r.rolls.length === 2, JSON.stringify(r));
ok('and lands in range', r && r.total >= 5 && r.total <= 15, r ? String(r.total) : '?');
var d20 = HW.roll('1d20');
ok('1d20 lands between 1 and 20', d20 && d20.total >= 1 && d20.total <= 20);
ok('a bare d20 works too', HW.roll('d20') !== null);
ok('rubbish is refused', HW.roll('banana') === null);
ok('an absurd number of dice is refused', HW.roll('99d6') === null);
ok('a one-sided die is refused', HW.roll('1d1') === null);

console.log('\nstarting a run');

var life = w.startingLives[0];
var run = HW.start(w, life.id);
eq('it begins where the role says', run.locationId, 'loc_reception');
ok('the role is remembered', run.lifeName && run.lifeName.length > 0, String(run.lifeName));
eq('stats come from the world', run.stats.performance, 50);
eq('the currency is the world\'s own', run.cashId, 'cash');
ok('the starting kit is carried over',
  Array.isArray(run.inventory) && run.inventory.length > 0, JSON.stringify(run.inventory));
eq('no tasks yet', run.quests.length, 0);

var clock = HW.clockOf(run, w.hudConfig);
eq('the world clock starts when the world says', clock.text, 'Monday 08:57');
run.turn = 4;
eq('and advances by the world\'s own step',
  HW.clockOf(run, w.hudConfig).text, 'Monday 09:17');   // 4 turns x 5 minutes
run.turn = 0;

console.log('\nthe referee reports what changed');

var t1 = HW.applyTags(w, run, 'You head for the bullpen.[[move:loc_bullpen]]');
ok('moving by id works', t1.moved && t1.moved.id === 'loc_bullpen', JSON.stringify(t1.changes));
eq('and changes where you are', run.locationId, 'loc_bullpen');
ok('the tag is stripped from what the player reads',
  t1.text.indexOf('[[move') === -1, t1.text);

ok('the world sets a starting purse, rather than assuming zero',
  run.stats.cash > 0, String(run.stats.cash));
var purse = run.stats.cash;
var t2 = HW.applyTags(w, run, 'The coffee costs five dollars.[[cash:-5]]');
eq('money is spent', run.stats.cash, purse - 5);

var t3 = HW.applyTags(w, run, 'That rattled you.[[stat:performance:-5]]');
eq('a stat moves', run.stats.performance, 45);

HW.applyTags(w, run, '[[item:Brass key]]');
ok('something picked up', run.inventory.indexOf('Brass key') !== -1);
HW.applyTags(w, run, '[[drop:Brass key]]');
ok('and put down again', run.inventory.indexOf('Brass key') === -1);

HW.applyTags(w, run, '[[quest:Survive the audit]]');
eq('a task is taken on', run.quests.length, 1);
HW.applyTags(w, run, '[[quest-done:Survive the audit]]');
eq('and completed', run.quests[0].done, true);

var before = HW.clockOf(run, w.hudConfig).text;
HW.applyTags(w, run, '[[clock:+45]]');
ok('time passes', HW.clockOf(run, w.hudConfig).text !== before,
  before + ' -> ' + HW.clockOf(run, w.hudConfig).text);

var rolled = HW.applyTags(w, run, 'You try the door.[[roll:2d6+1]]');
ok('a roll is made and reported', rolled.rolled !== null, JSON.stringify(rolled.changes));
ok('and the die tag does not reach the player',
  rolled.text.indexOf('[[roll') === -1);

var t9 = HW.applyTags(w, run, 'Something odd.[[nonsense:12]]');
ok('an unknown tag is left visible rather than silently eaten',
  t9.text.indexOf('[[nonsense:12]]') !== -1, t9.text);

var t10 = HW.applyTags(w, run, 'Nowhere.[[move:loc_does_not_exist]]');
ok('a move to somewhere that is not in the world is ignored', t10.moved === null);

console.log('\nwhat the model is told');

var built = HW.buildPrompt(w, run, 'I look around the bullpen.');
ok('there is a system prompt', built.system.length > 200, built.system.length + ' chars');
ok('it names where you are', built.system.indexOf('bullpen') !== -1 ||
   built.system.toLowerCase().indexOf('bullpen') !== -1);
ok('it lists the world\'s own location ids', built.system.indexOf('loc_bullpen') !== -1);
ok('it tells the model how to report changes', built.system.indexOf('[[move:') !== -1);
ok('it reports the time', built.system.indexOf('Monday') !== -1);
ok('it reports the stats', built.system.indexOf('Performance') !== -1);
eq('the turn is the last message', built.messages[built.messages.length - 1].content,
   'I look around the bullpen.');
eq('and it is from the player', built.messages[built.messages.length - 1].role, 'user');

var lorePrompt = HW.buildPrompt(w, run, 'What is Bramble & Pike?');
ok('naming the company puts its lore in the prompt',
  lorePrompt.system.indexOf('Established lore') !== -1);

console.log('\nthe run keeps its history');

var applied = HW.applyTags(w, run, 'You sit down.');
HW.commit(run, 'I look around.', applied.text, applied);
eq('a turn is recorded', run.turn, 1);
eq('both sides are logged', run.log.length, 2);
eq('the player spoke first', run.log[0].role, 'user');

console.log('\nthe world that ships with the install');

HW.bundled().then(function (shipped) {
  ok('the build offers a world to install', shipped.length > 0, shipped.length + ' offered');
  if (!shipped.length) { finish(); return null; }
  var entry = shipped[0];
  ok('it names itself', !!entry.name, entry.name);
  ok('and says what is in it', entry.places > 0 && entry.people > 0,
     entry.places + ' places, ' + entry.people + ' people');
  ok('it carries attribution', !!entry.attribution, String(entry.attribution).slice(0, 60));

  return HW.installBundled(entry.id).then(function (installed) {
    ok('installing parses it', !!installed);
    eq('under the catalogue id, so it is not offered twice', installed.id, entry.id);
    eq('and it really is the same world', installed.name, entry.name);
    eq('with its places', (installed.locations || []).length, entry.places);
    ok('with no artwork left in it', installed.banner === undefined);
    finish();
  });
}).catch(function (e) { ok('bundled install', false, e && e.message); finish(); });

function finish() {
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
}
