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

/* ================= ledger v2: the tags are checked ================= */

console.log('\nledger v2: the world checks the referee\u2019s tags');

function tinyWorld(over) {
  over = over || {};
  return {
    id: 'wtiny', name: 'Tiny', startLocationId: 'a',
    locations: [
      { id: 'a', name: 'A', exits: over.aExits === undefined
        ? [{ text: 'to B', travelTime: 1, isOneWay: false }] : over.aExits,
        description: '', region: '' },
      { id: 'b', name: 'B', exits: [], description: '', region: '' },
      { id: 'c', name: 'C', exits: [], description: '', region: '' }
    ],
    entities: [], factions: [], relationships: [], lorebook: [],
    startingLives: [], gameRules: over.gameRules || {},
    hudConfig: over.hudConfig || { stats: [] },
    dmPrompt: '', authorNote: '', intro: '',
    items: over.items, quests: over.quests, ledgerV2: over.ledgerV2
  };
}

/* --- movement --- */

var tw = tinyWorld(), tr = HW.start(tw);
HW.applyTags(tw, tr, 'Walk on.[[move:b]]');
eq('a reachable move (by id) still applies', tr.locationId, 'b');

tr = HW.start(tw);
var mv1 = HW.applyTags(tw, tr, 'Warp.[[move:c]]');
eq('a one-move teleport is refused', tr.locationId, 'a');
eq('and nothing moved', mv1.moved, null);
ok('the refusal is recorded with a reason',
  mv1.rejections.length === 1 && mv1.rejections[0].reason.indexOf('in one move') !== -1,
  JSON.stringify(mv1.rejections));
ok('the bad tag does not reach the player', mv1.text.indexOf('[[move') === -1, mv1.text);

tr = HW.start(tw);
HW.applyTags(tw, tr, 'Hop to B.[[move:B]]');
HW.applyTags(tw, tr, 'B has no exits listed, so the map is lenient.[[move:a]]');
eq('from a place with no exits, connectivity is unspecified and stays lenient',
  tr.locationId, 'a');

tr = HW.start(tw);
var mv2 = HW.applyTags(tw, tr, 'Vanish.[[move:nowhere-at-all]]');
ok('an unknown place is refused (not just dropped)',
  mv2.rejections.length === 1 && mv2.rejections[0].reason.indexOf('no such place') !== -1,
  JSON.stringify(mv2.rejections));

var twLegacy = tinyWorld({ ledgerV2: false });
var trL = HW.start(twLegacy);
var mv3 = HW.applyTags(twLegacy, trL, 'Warp.[[move:c]]');
eq('ledgerV2:false keeps the old behaviour: the teleport goes through',
  trL.locationId, 'c');
eq('and nothing is reported as rejected', mv3.rejections.length, 0);

var ppRun = HW.start(w);
var recExits = HW.exits(w, 'loc_reception').filter(function (e) { return e.to; })
  .map(function (e) { return e.to; });
var far = null;
w.locations.forEach(function (l) {
  if (!far && l.id !== 'loc_reception' && recExits.indexOf(l.id) === -1) far = l;
});
ok('Policy Panic has a place not on reception\u2019s exits (test precondition)', !!far);
var mv4 = HW.applyTags(w, ppRun, 'Warp.[[move:' + far.id + ']]');
eq('the real world refuses the teleport too', ppRun.locationId, 'loc_reception');
ok('...with the reason', mv4.rejections.length === 1, JSON.stringify(mv4.rejections));
var wLegacy = HW.parse(JSON.parse(JSON.stringify(WORLD)));
wLegacy.ledgerV2 = false;
var ppLegacy = HW.start(wLegacy);
HW.applyTags(wLegacy, ppLegacy, 'Warp.[[move:' + far.id + ']]');
eq('the same world with ledgerV2:false still teleports (opt-out honored)',
  ppLegacy.locationId, far.id);

/* --- bounds --- */

var twB = tinyWorld({ gameRules: { statBound: 10 } }), trB = HW.start(twB);
var c1 = HW.applyTags(twB, trB, 'Loot![[cash:+50]]');
eq('a change beyond the bound is refused', trB.stats.cash, 0);
ok('...and said so', c1.rejections.length === 1 && c1.rejections[0].reason.indexOf('\u00B110') !== -1,
  JSON.stringify(c1.rejections));
HW.applyTags(twB, trB, 'A fair tip.[[cash:+10]]');
eq('within the bound it applies', trB.stats.cash, 10);

trB = HW.start(twB);
var c2 = HW.applyTags(twB, trB, 'Odds.[[stat:mood:15]]');
eq('stats are bound too', trB.stats.mood, undefined);
eq('and a default world caps at \u00B1100', (function () {
  var tr2 = HW.start(tinyWorld());
  HW.applyTags(tinyWorld(), tr2, 'Big.[[stat:mood:150]]');
  return tr2.stats.mood === undefined;
})(), true);
trB = HW.start(twB);
var c3 = HW.applyTags(twB, trB, 'Muddle.[[clock:soon]]');
ok('a non-number clock is refused', c3.rejections.length === 1, JSON.stringify(c3.rejections));
var c4 = HW.applyTags(twB, trB, 'Muddle.[[stat:mood]]');
ok('a stat tag without a number is refused', c4.rejections.length === 1, JSON.stringify(c4.rejections));
var c5 = HW.applyTags(twB, trB, 'Muddle.[[cash:lots]]');
ok('a non-number purse change is refused', c5.rejections.length === 1, JSON.stringify(c5.rejections));

/* --- items --- */

var twI = tinyWorld({ items: [{ name: 'Lantern' }, { name: 'Rope' }] }), trI = HW.start(twI);
HW.applyTags(twI, trI, 'Take it.[[item:Lantern]]');
ok('a listed item is picked up by its canonical name', trI.inventory.indexOf('Lantern') !== -1);
var i1 = HW.applyTags(twI, trI, 'Sword![[item:Sword of Destiny]]');
eq('an unlisted item is refused', trI.inventory.length, 1);
ok('...and said so', i1.rejections.length === 1 && i1.rejections[0].reason.indexOf('no item named') !== -1,
  JSON.stringify(i1.rejections));
var i2 = HW.applyTags(twI, trI, 'Again.[[item:lantern]]');
ok('carrying it twice is refused', i2.rejections.length === 1 && i2.rejections[0].reason.indexOf('already carrying') !== -1,
  JSON.stringify(i2.rejections));
var i3 = HW.applyTags(twI, trI, 'Drop the rope.[[drop:Rope]]');
ok('dropping what you do not carry is refused', i3.rejections.length === 1 && i3.rejections[0].reason.indexOf('not carrying') !== -1,
  JSON.stringify(i3.rejections));
HW.applyTags(twI, trI, 'Lay it down.[[drop:lantern]]');
eq('dropping what you carry still works (case-insensitive)', trI.inventory.length, 0);

trI = HW.start(tinyWorld());
HW.applyTags(tinyWorld(), trI, 'Take it.[[item:Whatever]]');
ok('a world with no item list stays free-form', trI.inventory.indexOf('Whatever') !== -1);
var twIL = tinyWorld({ items: [{ name: 'Lantern' }], ledgerV2: false });
var trIL = HW.start(twIL);
HW.applyTags(twIL, trIL, 'Take it.[[item:Sword of Destiny]]');
ok('opt-out: an unlisted item is fine when ledgerV2 is false', trIL.inventory.length, 1);

/* --- tasks --- */

var twQ = tinyWorld({ quests: [{ text: 'Find the lamp' }, { text: 'Pay the toll' }] }),
  trQ = HW.start(twQ);
HW.applyTags(twQ, trQ, 'On it.[[quest:Find the lamp]]');
eq('a known task is taken on', trQ.quests.length, 1);
var q1 = HW.applyTags(twQ, trQ, 'Also.[[quest:Bake a cake]]');
eq('a task the world does not know is refused', trQ.quests.length, 1);
ok('...and said so', q1.rejections.length === 1 && q1.rejections[0].reason.indexOf('no such task') !== -1,
  JSON.stringify(q1.rejections));
var q2 = HW.applyTags(twQ, trQ, 'Done![[quest-done:Bake a cake]]');
ok('finishing a task that is not open is refused', q2.rejections.length === 1 && q2.rejections[0].reason.indexOf('no open task') !== -1,
  JSON.stringify(q2.rejections));
HW.applyTags(twQ, trQ, 'Done for real.[[quest-done:Find the lamp]]');
eq('finishing a real open task still works', trQ.quests[0].done, true);

trQ = HW.start(tinyWorld());
HW.applyTags(tinyWorld(), trQ, 'On it.[[quest:Anything]]');
ok('a world with no task list stays free-form', trQ.quests.length, 1);
var q3 = HW.applyTags(tinyWorld({ ledgerV2: false }), trQ, 'Done![[quest-done:Ghost task]]');
eq('opt-out: finishing a ghost task is silently dropped, not rejected', q3.rejections.length, 0);

/* --- rolls --- */

var r1 = HW.applyTags(twB, HW.start(twB), 'Fumble.[[roll:2d]]');
ok('a malformed roll is refused on a v2 world', r1.rejections.length === 1 && r1.rejections[0].reason.indexOf('malformed roll') !== -1,
  JSON.stringify(r1.rejections));
var r2 = HW.applyTags(twB, HW.start(twB), 'Fumble.[[roll:2d]]');
eq('...and is silently dropped on an opted-out world (old behaviour)',
  (function () { var trR = HW.start(tinyWorld({ ledgerV2: false }));
    var rr = HW.applyTags(tinyWorld({ ledgerV2: false }), trR, 'Fumble.[[roll:2d]]');
    return rr.rejections.length; })(), 0);
var r3 = HW.applyTags(twB, HW.start(twB), 'Roll.[[roll:2d6+1]]');
ok('a well-formed roll still rolls', r3.rolled !== null);

/* --- rejections are kept on the run, and capped --- */

var trCap = HW.start(twB);
for (var ci = 0; ci < 60; ci++) {
  var ca = HW.applyTags(twB, trCap, 'Greed.[[cash:+50]]');
  HW.commit(trCap, 'turn ' + ci, ca.text, ca);
}
ok('rejections are recorded on the run', (trCap.rejections || []).length > 0);
eq('and capped so a run cannot bloat', (trCap.rejections || []).length, 50);
ok('the recorded rejection names the turn', trCap.rejections[0].turn > 0);

/* --- commit: the player\u2019s line is logged once --- */

var trC = { log: [], turn: 0, stats: {}, cashId: 'cash', quests: [], inventory: [] };
trC.log.push({ role: 'user', content: 'I go in.', at: Date.now() });   // the app\u2019s optimistic push
HW.commit(trC, 'I go in.', 'It is dark.', { text: 'It is dark.', changes: [], rejections: [] });
eq('the optimistic line is not duplicated', trC.log.length, 2);
eq('and the reply follows it', trC.log[1].content, 'It is dark.');
var trC2 = { log: [], turn: 0, stats: {}, cashId: 'cash', quests: [], inventory: [] };
HW.commit(trC2, 'Cold open.', 'Night.', { text: 'Night.', changes: [], rejections: [] });
eq('with no optimistic line, commit still writes both sides', trC2.log.length, 2);

/* --- the player corrects the ledger by hand --- */

var twS = tinyWorld({ gameRules: { statBound: 10 }, hudConfig: { stats: [{ id: 'nerve', name: 'Nerve', value: 50 }] } }),
  trS = HW.start(twS);
trS.inventory.push('Umbrella');
trS.quests.push({ text: 'Pay the toll', done: false });

var ch1 = HW.correctState(twS, trS, { locationId: 'b' });
eq('set the place', trS.locationId, 'b');
ok('and it is said so', ch1.length === 1 && ch1[0].indexOf('set to B') !== -1, JSON.stringify(ch1));

var ch2 = HW.correctState(twS, trS, { cash: 77 });
eq('set the purse', trS.stats.cash, 77);

var ch3 = HW.correctState(twS, trS, { stats: { nerve: 61 } });
eq('set a stat', trS.stats.nerve, 61);

var ch4 = HW.correctState(twS, trS, { addInventory: 'Lantern' });
ok('add to the pockets', trS.inventory.indexOf('Lantern') !== -1, JSON.stringify(trS.inventory));

var ch5 = HW.correctState(twS, trS, { removeInventory: 'umbrella' });
ok('and remove from them (case-insensitive)', trS.inventory.indexOf('Umbrella') === -1);

var ch6 = HW.correctState(twS, trS, { addQuest: 'Find the lamp' });
eq('add a task', trS.quests.length, 2);

var ch7 = HW.correctState(twS, trS, { doneQuestText: 'Pay the toll' });
ok('and finish one', trS.quests[0].done === true);

eq('nothing changed -> no changes', HW.correctState(twS, trS, {}).length, 0);
ok('every correction is kept on the run',
  (trS.corrections || []).length >= 7, String((trS.corrections || []).length));

/* --- the referee is told the rules it must keep --- */

var bpV2 = HW.buildPrompt(twI, HW.start(twI), 'I look around.');
ok('a v2 world tells the model its tags will be checked',
  bpV2.system.indexOf('The world checks your tags') !== -1);
ok('and lists the items the world has', bpV2.system.indexOf('Items the world has: Lantern, Rope') !== -1);
ok('and the tasks it knows',
  HW.buildPrompt(twQ, HW.start(twQ), 'x').system.indexOf('Tasks the world knows: Find the lamp; Pay the toll') !== -1);
var bpLegacy = HW.buildPrompt(tinyWorld({ ledgerV2: false }), HW.start(tinyWorld({ ledgerV2: false })), 'I look around.');
ok('an opted-out world is told nothing new', bpLegacy.system.indexOf('The world checks your tags') === -1);

var trP = HW.start(twS);
trP.log.push({ role: 'user', content: 'I try the door.' });
trP.log.push({ role: 'correction', content: 'State corrected: set to B' });
var bpCorr = HW.buildPrompt(twS, trP, 'I keep trying.');
ok('a correction note stays out of the referee\u2019s context',
  bpCorr.messages.every(function (m) { return m.role !== 'correction' && m.content.indexOf('State corrected') === -1; }));

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
