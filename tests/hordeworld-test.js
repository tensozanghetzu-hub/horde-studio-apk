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

var loreRun = HW.start(w);
var lore = HW.loreHits(w, loreRun, 'What does the company actually do here?');
ok('naming the company surfaces its lore', lore.length > 0, lore.length + ' entries');
ok('irrelevant chatter surfaces nothing', HW.loreHits(w, loreRun, 'zzz qqq').length === 0);

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

/* ================= v1.18.0: checks with real consequences ================= */

console.log('\nv1.18.0: the world resolves the referee\u2019s checks');

var twC = tinyWorld({
  gameRules: { dice: { sides: 20 }, checks: [
    { stat: 'DEX', name: 'Dexterity', dc: 10,
      on_success: { stats: { nerve: 1 } },
      on_failure: { stats: { nerve: -2 } } },
    { stat: 'STR', name: 'Strength', dc: 15,
      on_success: { stats: { nerve: 1 }, items: ['Wrench'],
                   quests: ['Find the lamp'], clock: 5, cash: 5 },
      on_failure: {} }
  ]},
  hudConfig: { stats: [{ id: 'nerve', name: 'Nerve', value: 50 }] }
});

/* --- the dice are seeded per run --- */

ok('a run gets its own dice seed', typeof HW.start(twC).seed === 'number');
var dA = HW.start(twC), dB = HW.start(twC);
dA.seed = 42; dB.seed = 42;
var rA = HW.applyTags(twC, dA, 'Roll.[[roll:1d20]]');
var rB = HW.applyTags(twC, dB, 'Roll.[[roll:1d20]]');
eq('same seed, same dice', rA.rolled.total, rB.rolled.total);
var dC = HW.start(twC); dC.seed = 43;
var rC = HW.applyTags(twC, dC, 'Roll.[[roll:1d20]]');
ok('the dice are actually random per seed (42 and 43 differ here)',
  rA.rolled.total !== rC.rolled.total || rA.rolled.rolls[0] !== rC.rolled.rolls[0]);

/* --- a check request is stripped, recorded, not rolled --- */

var cr1 = HW.applyTags(twC, HW.start(twC), 'I try.[[roll:1d20:check:Dexterity]]');
eq('the check tag is stripped from the prose', cr1.text, 'I try.');
eq('and the request is recorded', cr1.checkRequests.length, 1);
eq('with its spec and name',
  cr1.checkRequests[0].spec + ':' + cr1.checkRequests[0].name, '1d20:Dexterity');
ok('nothing is rolled or applied yet', cr1.rolled === null && cr1.changes.length === 0);
eq('and nothing is rejected yet either', cr1.rejections.length, 0);

/* --- resolution: same seed, same verdict --- */

var vA = HW.start(twC), vB = HW.start(twC);
vA.seed = 7; vB.seed = 7;
var aA = HW.applyTags(twC, vA, 'I try.[[roll:1d20:check:Dexterity]]');
var aB = HW.applyTags(twC, vB, 'I try.[[roll:1d20:check:Dexterity]]');
HW.commit(vA, 'I try.', aA.text, aA);
HW.commit(vB, 'I try.', aB.text, aB);
var resA = HW.resolveChecks(twC, vA, aA);
var resB = HW.resolveChecks(twC, vB, aB);
eq('one verdict per check', resA.list.length, 1);
eq('same seed -> same dice', resA.list[0].total, resB.list[0].total);
eq('same seed -> same outcome', resA.list[0].success, resB.list[0].success);
ok('the verdict says which way it went',
  resA.list[0].text.indexOf('\u2014 ' + (resA.list[0].success ? 'success' : 'failure')) !== -1,
  resA.list[0].text);
ok('the verdict is in the log, after the referee\u2019s line',
  vA.log[vA.log.length - 1].role === 'check' &&
  vA.log[vA.log.length - 1].content === resA.list[0].text,
  JSON.stringify(vA.log.slice(-2)));

/* --- the branch that matches the outcome is the only one applied --- */

var seen = { success: false, failure: false };
var baseNerve = 50;
for (var seed = 1; seed <= 25; seed++) {
  var rr = HW.start(twC); rr.seed = seed;
  var aa = HW.applyTags(twC, rr, 'I try.[[roll:1d20:check:Dexterity]]');
  HW.commit(rr, 'I try.', aa.text, aa);
  var before = { nerve: rr.stats.nerve, inv: rr.inventory.length,
                 cash: rr.stats[rr.cashId], quests: rr.quests.length,
                 minutes: rr.extraMinutes };
  var res = HW.resolveChecks(twC, rr, aa);
  var c = res.list[0];
  ok('seed ' + seed + ': the dice decide against the world\u2019s own DC',
    c.success === (c.total >= c.dc));
  if (c.success) {
    seen.success = true;
    eq('seed ' + seed + ': success applies exactly the success branch',
      rr.stats.nerve, before.nerve + 1);
  } else {
    seen.failure = true;
    eq('seed ' + seed + ': failure applies exactly the failure branch',
      rr.stats.nerve, before.nerve - 2);
  }
  ok('seed ' + seed + ': nothing else moved',
    rr.inventory.length === before.inv && rr.stats[rr.cashId] === before.cash &&
    rr.quests.length === before.quests && rr.extraMinutes === before.minutes);
  eq('seed ' + seed + ': no rejection for a clean check', res.rejections.length, 0);
}
ok('both branches were exercised', seen.success && seen.failure);

/* --- a branch can give things, take things, add time --- */

var twG = tinyWorld({
  gameRules: { dice: { sides: 20 }, checks: [
    { stat: 'STR', name: 'Strength', dc: 1,
      on_success: { stats: { nerve: 1 }, items: ['Wrench'],
                   quests: ['Find the lamp'], clock: 5, cash: 5 },
      on_failure: {} },
    { stat: 'DEX', name: 'Dexterity', dc: 21, on_failure: {} }
  ]},
  hudConfig: { stats: [{ id: 'nerve', name: 'Nerve', value: 50 }] }
});
var gr = HW.start(twG);
var ga = HW.applyTags(twG, gr, 'Lift it.[[roll:1d20:check:Strength]] ' +
  'Dodge.[[roll:1d20:check:Dexterity]]');
HW.commit(gr, 'Lift it.', ga.text, ga);
var gres = HW.resolveChecks(twG, gr, ga);
eq('dc 1 on 1d20 is always success', gres.list[0].success, true);
eq('dc 21 on 1d20 is always failure', gres.list[1].success, false);
ok('success gave the item', gr.inventory.indexOf('Wrench') !== -1);
ok('success added the task', gr.quests.some(function (q) { return q.text === 'Find the lamp' && !q.done; }));
ok('success spent the minutes', gr.extraMinutes === 5);
ok('success moved the purse', gr.stats[gr.cashId] === 5);
ok('success moved the stat', gr.stats.nerve === 51);
ok('the failed check (empty branch) changed nothing else',
  gres.list[1].text.indexOf('()') === -1);
ok('two checks, two verdicts, in order',
  gres.list.length === 2 && gr.log.filter(function (m) { return m.role === 'check'; }).length === 2);

/* --- the referee can request each check once per reply --- */

var dd = HW.start(twC);
var da = HW.applyTags(twC, dd, 'Twice.[[roll:1d20:check:Dexterity]][[roll:1d20:check:Dexterity]]');
HW.commit(dd, 'Twice.', da.text, da);
var dres = HW.resolveChecks(twC, dd, da);
eq('a repeated check resolves once', dres.list.length, 1);

/* --- unknown check: the dice show, the check is refused --- */

var un = HW.start(twC);
var ua = HW.applyTags(twC, un, 'Ghost.[[roll:1d20:check:Charisma]]');
HW.commit(un, 'Ghost.', ua.text, ua);
var ures = HW.resolveChecks(twC, un, ua);
eq('an unknown check is refused', ures.rejections.length, 1);
ok('...with the reason', ures.rejections[0].reason.indexOf('no check named') !== -1,
  JSON.stringify(ures.rejections));
ok('but the dice are still shown', ures.changes.length === 1 && ures.changes[0].indexOf('1d20') !== -1,
  JSON.stringify(ures.changes));
ok('and nothing is applied', ures.list.length === 0 && un.stats.nerve === 50);

/* --- malformed spec: refused at parse time, nothing rolled --- */

var mf = HW.applyTags(twC, HW.start(twC), 'Bad.[[roll:xx:check:Dexterity]]');
eq('a malformed check spec is refused', mf.rejections.length, 1);
ok('...and said so', mf.rejections[0].reason.indexOf('malformed roll') !== -1,
  JSON.stringify(mf.rejections));
eq('and no request is recorded', mf.checkRequests.length, 0);

/* --- opted-out worlds: the check suffix is just an unparsable roll --- */

var twCL = tinyWorld({ ledgerV2: false,
  gameRules: { checks: [{ stat: 'DEX', name: 'Dexterity', dc: 10 }] } });
var la = HW.applyTags(twCL, HW.start(twCL), 'Ghost.[[roll:1d20:check:Dexterity]]');
eq('opt-out: the whole tag is silently dropped, as before',
  la.rejections.length + la.changes.length + la.checkRequests.length, 0);

/* --- the referee is told which checks exist and what they do --- */

var bpC = HW.buildPrompt(twC, HW.start(twC), 'I try.');
ok('the prompt names the checks', bpC.system.indexOf('Checks the world resolves') !== -1);
ok('...with their DCs', bpC.system.indexOf('Dexterity (DC 10)') !== -1);
ok('...and their consequences', bpC.system.indexOf('on success: nerve +1') !== -1 &&
  bpC.system.indexOf('on failure: nerve -2') !== -1);
ok('...and the request format', bpC.system.indexOf('[[roll:SPEC:check:NAME]]') !== -1);
ok('...with the one rule that matters: do not narrate the outcome',
  bpC.system.indexOf('never narrate') !== -1);
ok('a world without checks is told nothing about them',
  HW.buildPrompt(twS, HW.start(twS), 'x').system.indexOf('Checks the world resolves') === -1);

var pc = HW.start(twC);
var pca = HW.applyTags(twC, pc, 'I try.[[roll:1d20:check:Dexterity]]');
HW.commit(pc, 'I try.', pca.text, pca);
HW.resolveChecks(twC, pc, pca);
var bpAfter = HW.buildPrompt(twC, pc, 'I try again.');
/* the engine keeps the 'check' role; the API layer maps it to assistant */
ok('the verdict is in the referee\u2019s context for the next turn',
  bpAfter.messages.some(function (m) {
    return m.role === 'check' && m.content.indexOf('check:') !== -1;
  }));

/* ================= v1.19.0: the world knows what NPCs know ================= */

console.log('\nv1.19.0: knowledge gating');

function gateWorld() {
  return {
    id: 'wgate', name: 'Gate', startLocationId: 'a',
    locations: [
      { id: 'a', name: 'A', exits: [{ text: 'to B', travelTime: 1 }], description: '', region: '' },
      { id: 'b', name: 'B', exits: [], description: '', region: '' }
    ],
    entities: [
      { id: 'bob', name: 'Bob', type: 'npc', isMajor: false, factionId: 'fac_x',
        startLocation: 'a', homeLocation: 'a', description: '', persona: '', goal: '', secrets: '' },
      { id: 'cy', name: 'Cy', type: 'npc', isMajor: false, factionId: null,
        startLocation: 'b', homeLocation: 'b', description: '', persona: '', goal: '', secrets: '' }
    ],
    factions: [{ id: 'fac_x', name: 'X' }],
    relationships: [],
    lorebook: [
      { id: 'l1', keyword: 'alpha', text: 'open knowledge', knownBy: '' },
      { id: 'l2', keyword: 'bravo', text: 'faction insider', knownBy: 'faction:fac_x' },
      { id: 'l3', keyword: 'charlie', text: 'bob knows this', knownBy: 'npc:bob' },
      { id: 'l4', keyword: 'delta', text: 'locked secret', knownBy: 'secret' },
      { id: 'l5', keyword: 'echo', text: 'quest-unlocked', knownBy: 'secret',
        unlockQuest: 'Find the lamp' },
      { id: 'l6', keyword: 'foxtrot', text: 'witness-unlocked', knownBy: 'secret',
        unlockNpc: 'bob' }
    ],
    startingLives: [], gameRules: {}, hudConfig: {},
    dmPrompt: '', authorNote: '', intro: ''
  };
}

var gw = gateWorld(), gr2 = HW.start(gw);
gr2.reputation = [{ factionId: 'fac_x', score: 5 }];

var gl = HW.loreHits(gw, gr2, 'alpha bravo charlie delta echo foxtrot');
var gIds = gl.map(function (e) { return e.id; });
ok('open lore is visible', gIds.indexOf('l1') !== -1);
ok('faction lore is visible with standing', gIds.indexOf('l2') !== -1);
ok('npc lore is visible with the npc present', gIds.indexOf('l3') !== -1);
ok('a locked secret stays locked', gIds.indexOf('l4') === -1);
ok('a secret unlocks when its quest is open', (function () {
  var q = HW.start(gateWorld()); q.reputation = [{ factionId: 'fac_x', score: 0 }];
  q.quests.push({ text: 'Find the lamp', done: false });
  var ids = HW.loreHits(gateWorld(), q, 'echo').map(function (e) { return e.id; });
  return ids.indexOf('l5') !== -1;
})());
ok('a secret unlocks when its quest is done too', (function () {
  var q = HW.start(gateWorld()); q.reputation = [{ factionId: 'fac_x', score: 0 }];
  q.quests.push({ text: 'Find the lamp', done: true });
  var ids = HW.loreHits(gateWorld(), q, 'echo').map(function (e) { return e.id; });
  return ids.indexOf('l5') !== -1;
})());
ok('a witness unlocks a secret when they are here', gIds.indexOf('l6') !== -1);
var grFar = HW.start(gw);
grFar.reputation = [{ factionId: 'fac_x', score: 5 }];
HW.applyTags(gw, grFar, 'On to B.[[move:b]]');
var glFar = HW.loreHits(gw, grFar, 'charlie foxtrot');
ok('npc lore closes when the npc leaves', glFar.every(function (e) { return e.id !== 'l3'; }));
ok('witness secrets close with the witness', glFar.every(function (e) { return e.id !== 'l6'; }));
var grNoFaction = HW.start(gw);
ok('faction lore closes without standing',
  HW.loreHits(gw, grNoFaction, 'bravo').every(function (e) { return e.id !== 'l2'; }));

/* --- scoring: best matches first, within the byte budget --- */

var sw = {
  id: 'wsc', name: 'Score', startLocationId: 'a',
  locations: [{ id: 'a', name: 'A', exits: [], description: '', region: '' }],
  entities: [], factions: [], relationships: [], startingLives: [],
  lorebook: [
    { id: 's1', keyword: 'alpha', text: 'first mention', knownBy: '' },
    { id: 's2', keyword: 'alpha, alpha, alpha', text: 'alpha mentioned three times', knownBy: '' }
  ],
  gameRules: {}, hudConfig: {}, dmPrompt: '', authorNote: '', intro: ''
};
var sHits = HW.loreHits(sw, HW.start(sw), 'alpha alpha alpha');
eq('repeated matches outrank single ones', sHits[0].id, 's2');
ok('and the single one still comes through', sHits.length === 2);

var big = {
  id: 'wbig', name: 'Big', startLocationId: 'a',
  locations: [{ id: 'a', name: 'A', exits: [], description: '', region: '' }],
  entities: [], factions: [], relationships: [], startingLives: [],
  lorebook: [
    { id: 'b1', keyword: 'omaha', text: new Array(500).join('x'), knownBy: '' },
    { id: 'b2', keyword: 'omaha, omaha, omaha', text: new Array(500).join('y'), knownBy: '' },
    { id: 'b3', keyword: 'omaha, omaha, omaha, omaha', text: new Array(500).join('z'), knownBy: '' }
  ],
  gameRules: {}, hudConfig: {}, dmPrompt: '', authorNote: '', intro: ''
};
var bRun = HW.start(big);
var bHits = HW.loreHits(big, bRun, 'omaha omaha omaha omaha', 8, 1000);
ok('the byte budget stops the pile', bHits.length < 3, bHits.length + ' injected');
var total = bHits.reduce(function (a, e) { return a + e.text.length; }, 0);
ok('...and it is respected (single entries may exceed it alone)', total <= 1500, total + ' chars');
var lone = HW.loreHits({ lorebook: [{ id: 'z', keyword: 'kayak', text: new Array(2000).join('q') }] },
  bRun, 'kayak', 8, 1000);
eq('a lone match still gets in', lone.length, 1);

/* --- the old matcher finds exactly the entries the new one does --- */

function oldLore(w, text) {
  var t = String(text || '').toLowerCase();
  return (w.lorebook || []).filter(function (e) {
    return String(e.keyword || '').split(',').some(function (k) {
      k = String(k).trim().toLowerCase();
      return k.length > 2 && t.indexOf(k) !== -1;
    });
  }).map(function (e) { return e.id; });
}
['I look at the audit files.', 'What is Maplebridge?',
 'Tell me about Bramble & Pike.', 'boiler, gossip and the gala'].forEach(function (q, i) {
  var oldSet = oldLore(w, q).sort();
  var newSet = HW.loreHits(w, HW.start(w), q, 15, 100000).map(function (e) { return e.id; }).sort();
  eq('query ' + (i + 1) + ': the old and new matchers agree (set)',
    JSON.stringify(oldSet), JSON.stringify(newSet));
});

/* --- npc secrets: hint flows, truth is gated --- */

function secretWorld(unlock) {
  return {
    id: 'wsec', name: 'Sec', startLocationId: 'a',
    locations: [{ id: 'a', name: 'A', exits: [], description: '', region: '' },
                { id: 'b', name: 'B', exits: [], description: '', region: '' }],
    entities: [{
      id: 'ned', name: 'Ned', type: 'npc', isMajor: true, factionId: null,
      startLocation: 'a', homeLocation: 'a', description: '', persona: '',
      goal: '', secrets: [
        { label: 'The Second Ledger',
          hint: 'Ned counts cash twice at closing time.',
          truth: 'Ned has been skimming the branch for six years.' },
        { label: 'The Locked Drawer',
          hint: 'A drawer in his desk never opens.',
          truth: 'It holds the original audit from 1998.' }
      ],
      secretUnlock: unlock
    }],
    factions: [], relationships: [],
    lorebook: [], startingLives: [],
    gameRules: {}, hudConfig: {}, dmPrompt: '', authorNote: '', intro: ''
  };
}

var secW = secretWorld(null), secR = HW.start(secW);
var secLoc = HW.buildPrompt(secW, secR, 'x').system;
ok('a present npc\u2019s hints reach the referee', secLoc.indexOf('counts cash twice at closing time') !== -1);
ok('the truth stays out of the prompt', secLoc.indexOf('skimming the branch') === -1);
ok('and the referee is told to keep it there', secLoc.indexOf('Do not reveal the truth') !== -1);
var secElse = HW.start(secretWorld(null));
HW.applyTags(secretWorld(null), secElse, 'On to B.[[move:b]]');
ok('secrets travel with the npc, not the place',
  HW.buildPrompt(secretWorld(null), secElse, 'x').system.indexOf('counts cash twice') === -1);

var qW = secretWorld({ quest: 'Survive the audit' }), qR = HW.start(qW);
ok('before the quest: still locked',
  HW.buildPrompt(qW, qR, 'x').system.indexOf('skimming the branch') === -1);
qR.quests.push({ text: 'Survive the audit', done: false });
ok('the quest reached: the truth is revealed',
  HW.buildPrompt(qW, qR, 'x').system.indexOf('is revealed to the player: Ned has been skimming') !== -1);
ok('...marked so the player may discover it now',
  HW.buildPrompt(qW, qR, 'x').system.indexOf('revealed to the player') !== -1);

var stW = secretWorld({ stat: { id: 'trust', min: 5 } }), stR = HW.start(stW);
stR.stats.trust = 3;
ok('below the stat threshold: locked',
  HW.buildPrompt(stW, stR, 'x').system.indexOf('skimming the branch') === -1);
stR.stats.trust = 5;
ok('at the stat threshold: revealed',
  HW.buildPrompt(stW, stR, 'x').system.indexOf('is revealed to the player') !== -1);

/* --- the bundled world: its secrets stop being dead text --- */

var ppW = HW.parse(WORLD);
var ppR = HW.start(ppW);
var ppLoc = null;
ppW.entities.forEach(function (e) {
  if (e.secrets && !ppLoc) ppLoc = e.startLocation;
});
ok('test precondition: a secret-keeping npc exists with a start location', !!ppLoc);
ppR.locationId = ppLoc;
var ppPrompt = HW.buildPrompt(ppW, ppR, 'I look around.').system;
ok('Policy Panic now tells the referee about kept secrets',
  ppPrompt.indexOf('keeps a secret') !== -1);
ok('...with the hints, not the truths',
  ppPrompt.indexOf('closes the blinds for calls from corporate') !== -1 &&
  ppPrompt.indexOf('Corporate will close or absorb the branch') === -1);
ok('and tells it to hold the truths', ppPrompt.indexOf('Do not reveal the truth') !== -1);
var noSecretLoc = null;
ppW.locations.forEach(function (l) {
  if (noSecretLoc) return;
  var keeper = ppW.entities.some(function (e) {
    return e.secrets && (e.startLocation === l.id || e.homeLocation === l.id);
  });
  if (!keeper) noSecretLoc = l.id;
});
ok('test precondition: a place exists with no secret-keepers', !!noSecretLoc);
var ppQuiet = HW.start(ppW);
ppQuiet.locationId = noSecretLoc;
ok('in a place with no secret-keepers, nothing secret appears',
  HW.buildPrompt(ppW, ppQuiet, 'I look around.').system.indexOf('keeps a secret') === -1);

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
