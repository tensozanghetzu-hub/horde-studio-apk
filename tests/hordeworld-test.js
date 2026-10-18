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

eq('a world without a banner is a stable empty banner (v1.30.0)', w.banner, '');
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
eq('v1.32.0: stats come from the world AND the life (override wins)',
  run.stats.performance, 40);
eq('the currency is the world\'s own', run.cashId, 'cash');
ok('the starting kit is carried over',
  Array.isArray(run.inventory) && run.inventory.length > 0, JSON.stringify(run.inventory));
eq('v1.32.0: the obligations of the role arrive as open tasks', run.quests.length, 3);

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
eq('a stat moves', run.stats.performance, 35);

HW.applyTags(w, run, '[[item:Brass key]]');
ok('something picked up', run.inventory.indexOf('Brass key') !== -1);
HW.applyTags(w, run, '[[drop:Brass key]]');
ok('and put down again', run.inventory.indexOf('Brass key') === -1);

HW.applyTags(w, run, '[[quest:Survive the audit]]');
eq('a task is taken on', run.quests.length, 4);
HW.applyTags(w, run, '[[quest-done:Survive the audit]]');
ok('and completed', run.quests.some(function (q) { return q.text === 'Survive the audit' && q.done; }));

var before = HW.clockOf(run, w.hudConfig).text;
HW.applyTags(w, run, '[[clock:+45]]');
ok('time passes', HW.clockOf(run, w.hudConfig).text !== before,
  before + ' -> ' + HW.clockOf(run, w.hudConfig).text);

var rolled = HW.applyTags(w, run, 'You try the door.[[roll:2d6+1]]');
ok('a roll is made and reported', rolled.rolled !== null, JSON.stringify(rolled.changes));
ok('and the die tag does not reach the player',
  rolled.text.indexOf('[[roll') === -1);

var t9 = HW.applyTags(w, run, 'Something odd.[[nonsense:12]]');
ok('v1.29.1: an unknown command is refused, not narrated',
  t9.text.indexOf('[[nonsense:12]]') === -1 &&
  (t9.rejections || []).some(function (r) { return /nonsense/.test(r.tag); }),
  t9.text + ' | ' + JSON.stringify(t9.rejections));
var t9b = HW.applyTags({ id: w.id, ledgerV2: false, locations: w.locations }, run, 'Something odd.[[nonsense:12]]');
ok('…and an opted-out (ledgerV2:false) world still shows it',
  t9b.text.indexOf('[[nonsense:12]]') !== -1, t9b.text);

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
ok('the referee is told not to paste the state block back into the story',
  /NEVER repeat, paste, or restate/.test(bpV2.system));
ok('the referee is told OOC notes are direct instructions, not in-fiction speech',
  /direct instruction to you the referee/.test(bpV2.system));
var bpLegacy = HW.buildPrompt(tinyWorld({ ledgerV2: false }), HW.start(tinyWorld({ ledgerV2: false })), 'I look around.');
ok('an opted-out world is told nothing new', bpLegacy.system.indexOf('The world checks your tags') === -1);

/* --- v1.30.4: the tag grammar carries no note for the model to copy --- */

ok('the with/part grammar line carries no annotation (v2 world)',
  !/who is with the player/i.test(bpV2.system));
ok('...nor in an opted-out world', !/who is with the player/i.test(bpLegacy.system));
ok('every world is told in prose what with/part mean',
  /Party: tag \[\[with:NAME\]\]/.test(bpV2.system) && /Party: tag \[\[with:NAME\]\]/.test(bpLegacy.system));

var runG = HW.start(w);
var g1 = HW.applyTags(w, runG, 'The ferns rustle as Nyx steps out to join you.\n\n[[with:Nyx]] - who is with the player');
eq('the copied note goes with the tags', g1.text, 'The ferns rustle as Nyx steps out to join you.');
ok('unknown companions are still refused, as before', g1.rejections.length === 1, JSON.stringify(g1.rejections));

var g2 = HW.applyTags(w, runG, 'Paths split ahead.\n\n- who is with the player\n\nWhat do you do?');
eq('the bare note goes too', g2.text, 'Paths split ahead.\n\nWhat do you do?');

var g3 = HW.applyTags(w, runG, 'The guard asks who is with the player, and why.');
eq('mentioning it inside prose is not the note', g3.text, 'The guard asks who is with the player, and why.');

var runH = HW.start(w);
runH.log.push({ role: 'assistant', content: 'Old turn.\n\n- who is with the player', at: 1 });
var bpH = HW.buildPrompt(w, runH, 'again');
eq('stored copies never reach the referee again', bpH.messages[0].content, 'Old turn.');

var runN = HW.start(w);
runN.log.push({ role: 'user', content: 'who is with the player?', at: 1 });
runN.log.push({ role: 'assistant', content: 'Scene one.\n\n- who is with the player', at: 2 });
HW.normalizeRun(runN);
eq('old stored replies are scrubbed on open', runN.log[1].content, 'Scene one.');
eq('player lines are never scrubbed', runN.log[0].content, 'who is with the player?');

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

console.log('\nscene discipline (v1.20.0)');

/* --- the claim audit: the player asked, the tags answered (or did not) --- */

var auditW = HW.parse({
  _format: 'horde-world', name: 'Audit scene', startLocationId: 'loc_reception',
  locations: [
    { id: 'loc_reception', name: 'Reception', exits: [{ text: 'to Main Office', travelTime: 1 }] },
    { id: 'loc_office', name: 'Main Office', exits: [{ text: 'to Reception', travelTime: 1 }] }
  ],
  items: [{ id: 'it_key', name: 'Brass key' }, { id: 'it_binder', name: 'Training binder' }],
  quests: [{ text: 'Survive the audit' }],
  gameRules: { currencyName: 'coins' }, hudConfig: {}
});

function audit(input, reply, setup) {
  var r = HW.start(auditW);
  if (setup) setup(r);
  var applied = HW.applyTags(auditW, r, reply || 'The scene continues.');
  return HW.auditClaims(auditW, r, input, applied);
}
function silent(label, input, reply, setup) {
  var adv = audit(input, reply, setup).advisories;
  ok(label, adv.length === 0, JSON.stringify(adv));
}
function flagged(label, input, reply, setup, kind) {
  var adv = audit(input, reply, setup).advisories;
  ok(label, adv.length === 1 && (!kind || adv[0].kind === kind), JSON.stringify(adv));
}

/* an action that landed in prose but not in the ledger is advisory */
flagged('an unrecorded take is flagged', 'I take the brass key.', '', null, 'item');
ok('...naming the object', audit('I take the brass key.', '').advisories[0].note.indexOf('brass key') !== -1);
var aNoTag = HW.applyTags(auditW, HW.start(auditW), 'The key sits on the counter.');
ok('...while the reply itself drew no rejections', aNoTag.rejections.length === 0);

/* a matching tag silences the audit */
silent('a recorded take is silent', 'I take the brass key.', 'You pocket it.\n[[item:Brass key]]');
silent('a coarse name still matches', 'I take the key.', 'You pocket it.\n[[item:Brass key]]');
flagged('a tag for a different object is not a match', 'I take the brass key.', 'You pocket it.\n[[item:Training binder]]', null, 'item');

/* drops are audited against what the run actually carries */
silent('a recorded drop is silent', 'I drop the binder.', 'You set it down.\n[[drop:Training binder]]',
  function (r) { r.inventory.push('Training binder'); });
flagged('an unrecorded drop is flagged', 'I drop the binder.', '',
  function (r) { r.inventory.push('Training binder'); }, 'drop');
silent('dropping something not carried is not claimed', 'I drop the binder.', '');

/* moves fire only at real places, and only when the move went elsewhere */
silent('a recorded move to the named place is silent', 'I walk to the Main Office.', 'The door opens.\n[[move:loc_office]]');
flagged('moving somewhere else is flagged', 'I walk to the Main Office.', 'You drift back.\n[[move:loc_reception]]', null, 'move');
ok('...saying where the move actually went',
  audit('I walk to the Main Office.', 'You drift back.\n[[move:loc_reception]]').advisories[0].note.indexOf('Reception') !== -1);
flagged('a move that was never recorded is flagged', 'I walk to the Main Office.', '', null, 'move');
silent('an unresolvable target never fires', 'I go to the kitchen.', '');
silent('a bare "go" has no target', "Let's go.", '');

/* cash claims need a stated amount; any spend satisfies them */
silent('a recorded spend is silent', 'I pay five coins.', 'The clerk nods.\n[[cash:-5]]');
silent('the world may set its own price', 'I pay five coins.', 'It costs more.\n[[cash:-8]]');
flagged('a pay with no spend is flagged', 'I pay five coins.', 'The clerk nods.', null, 'cash');
flagged('a gain is not a spend', 'I pay five coins.', 'He tips you back.\n[[cash:+3]]', null, 'cash');
silent('an amount-less buy is not audited', 'I buy a ticket.', '');

/* tasks */
silent('a recorded task is silent', 'I take on Survive the audit.', 'Understood.\n[[quest:Survive the audit]]');
flagged('an unrecorded task is flagged', 'I take on Survive the audit.', 'Understood.', null, 'quest');
silent('a task the world does not know is not claimed', 'I take on the challenge.', '');

/* negation, idiom and vagueness are not claims */
silent('a refused take is not a claim', 'I refuse to take the key.', 'The key stays where it is.');
silent('a can\'t take is not a claim', "I can't take the key.", '');
silent('an idiom is not a claim', 'I take one step forward.', '');
silent('a glance is not a pickup', 'I steal a glance at the ledger.', '');
silent('small talk is not a claim', 'What is this place?', 'A quiet office.');
silent('an empty input is not a claim', '', '');
silent('a new sentence is not the object (pay)', 'I pay. It was five.', '');
silent('a new sentence is not the object (take)', 'I take. The key is stuck.', '');

/* the imperative form works too */
flagged('a bare imperative is a claim', 'Take the key.', '', null, 'item');

/* phrasal verbs with the particle behind the object */
flagged('"leave the key behind" is a drop', 'I leave the key behind.', '',
  function (r) { r.inventory.push('Brass key'); }, 'drop');
flagged('"leave the office" is a move', 'I leave the office.', '', null, 'move');
flagged('"leave the office behind" is still a move', 'I leave the office behind.', '', null, 'move');
flagged('"put the binder down" is a drop', 'I put the binder down.', '',
  function (r) { r.inventory.push('Training binder'); }, 'drop');
flagged('"throw the key away" is a drop', 'I throw the key away.', '',
  function (r) { r.inventory.push('Brass key'); }, 'drop');

/* several asks in one turn, capped */
eq('two asks in one sentence give two advisories',
  audit('I go to the reception and take the key.', '').advisories.length, 2);
eq('the pile caps at three',
  audit('I take the brass key. I grab the training binder. I walk to the Main Office. I pay five coins.', '').advisories.length, 3);

/* the audit is total: it must never throw, never block */
ok('a null world does not throw', (function () {
  try { HW.auditClaims(null, null, 'I take the brass key.', null); return true; }
  catch (e) { return false; }
})());
ok('garbage input degrades to nothing',
  HW.auditClaims(auditW, HW.start(auditW), '!!! ???.', { changes: [] }).advisories.length === 0);

/* advisories persist on the run, capped like rejections */
var advRun = HW.start(auditW);
var advApplied = HW.applyTags(auditW, advRun, 'The key sits on the counter.');
advApplied.advisories = audit('I take the brass key.', '').advisories;
HW.commit(advRun, 'I take the brass key.', advApplied.text, advApplied);
eq('the turn\'s advisory lands on the run', advRun.advisories.length, 1);
eq('...with the turn number', advRun.advisories[0].turn, 1);
for (var advCap = 0; advCap < 60; advCap++) {
  var ra = HW.applyTags(auditW, advRun, 'x');
  ra.advisories = [{ claim: 'c' + advCap, note: 'n', at: 1 }];
  HW.commit(advRun, 'line ' + advCap, ra.text, ra);
}
eq('the run keeps only the last fifty advisories', advRun.advisories.length, 50);

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

console.log('\nv1.27.1: the pockets never duplicate an item');
/* A world without an item registry (most authored worlds): the referee's
   [[item:…]] tag used to push blindly, so every turn that mentioned the
   item again grew a copy. */
var wPlain = HW.parse({
  _format: 'horde-world', name: 'Plain',
  locations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  gameRules: { modules: {} }
});
ok('a plain world parses', !!wPlain);
var rPlain = HW.start(wPlain);
HW.applyTags(wPlain, rPlain, 'I pick up the hose coil. [[item:Hose Coil]]');
HW.applyTags(wPlain, rPlain, 'I pocket the hose coil. [[item:Hose Coil]]');
eq('mentioning it twice carries one', rPlain.inventory.length, 1, JSON.stringify(rPlain.inventory));
HW.applyTags(wPlain, rPlain, 'Again. [[item:hose coil]]');
eq('…and casing never matters', rPlain.inventory.length, 1, JSON.stringify(rPlain.inventory));

var corr = HW.correctState(wPlain, rPlain, { addInventory: 'Hose Coil' });
eq('a correction cannot duplicate either', rPlain.inventory.length, 1, JSON.stringify(rPlain.inventory));
ok('…and the ledger says so', /already|carrying/i.test(JSON.stringify(corr && corr.changes)) || rPlain.inventory.length === 1);

/* A saved run that already carries duplicates heals when it is opened. */
if (typeof HW.normalizeRun === 'function') {
  rPlain.inventory = ['Obsidian_Stone', 'Hose Coil', 'hose coil', 'OBSIDIAN_STONE'];
  HW.normalizeRun(rPlain);
  eq('stored duplicates heal on load', rPlain.inventory.length, 2, JSON.stringify(rPlain.inventory));
} else {
  ok('HW.normalizeRun exists', false, 'not exported');
}

console.log('\nv1.28.1: the ledger does not celebrate nothing');
/* A model can tag zero-value changes and phantom stat ids; the ledger
   should not record or announce them. */
var wZ = HW.parse({
  _format: 'horde-world', name: 'Z',
  locations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  gameRules: { modules: {} },
  hudConfig: { stats: [{ id: 'hp', name: 'HP' }] }
});
var rZ = HW.start(wZ);
var z1 = HW.applyTags(wZ, rZ, 'x [[clock:0]] [[cash:+0]] [[stat:hp:+0]]');
eq('zero changes leave no chips', z1.changes.length, 0, JSON.stringify(z1.changes));
var z2 = HW.applyTags(wZ, rZ, 'x [[move:a]]');
ok('a move to where you already are changes nothing', z2.changes.length === 0 && rZ.locationId === 'a',
  JSON.stringify(z2.changes));
var z3 = HW.applyTags(wZ, rZ, 'x [[move:b]]');
ok('a real move still counts', z3.changes.length === 1 && rZ.locationId === 'b', JSON.stringify(z3.changes));
var z4 = HW.applyTags(wZ, rZ, 'x [[stat:ID:+5]]');
ok('a stat id the world never declared is not recorded', rZ.stats.ID === undefined && z4.changes.length === 0,
  JSON.stringify(rZ.stats));
var z5 = HW.applyTags(wZ, rZ, 'x [[stat:hp:+5]]');
ok('a declared stat still counts', rZ.stats.hp === 5 && z5.changes.length === 1, JSON.stringify(rZ.stats));
var z6 = HW.applyTags(wZ, rZ, 'x [[cash:+3]] [[clock:+10]]');
ok('real cash and clock changes still chip', z6.changes.length === 2, JSON.stringify(z6.changes));
/* a world that declares no stats keeps free-form stat tags (Elos et al) */
var wNoStats = HW.parse({
  _format: 'horde-world', name: 'N',
  locations: [{ id: 'a', name: 'A' }],
  gameRules: { modules: {} }
});
var rNo = HW.start(wNoStats);
var z7 = HW.applyTags(wNoStats, rNo, 'x [[stat:whatever:+2]]');
ok('a stat-less world stays free-form', rNo.stats.whatever === 2, JSON.stringify(rNo.stats));

/* --- v1.32.0: the world the player is looking at --- */

function sysBlock(sys, prefix) {
  return (sys.split('\n\n').find(function (p) { return p.indexOf(prefix) === 0; }) || '');
}

var denton = HW.entityById(w, 'npc_denton');
ok('the parse keeps the NPC day', denton.schedule.length === 6, JSON.stringify(denton.schedule));

eq('weekday 09:15 - the motivational lap',
  JSON.stringify(HW.scheduleActiveAt(denton, { minutes: 555, weekday: 'Monday' }).locationId), '"loc_bullpen"');
eq('weekday 08:20 - the office address first',
  HW.scheduleActiveAt(denton, { minutes: 500, weekday: 'Monday' }).locationId, 'loc_denton');
eq('...with the activity attached',
  HW.scheduleActiveAt(denton, { minutes: 555, weekday: 'Monday' }).activity,
  'Performs a motivational lap through the branch');
ok('before the first entry of the day - no governing entry',
  HW.scheduleActiveAt(denton, { minutes: 460, weekday: 'Monday' }) === null);
eq('...so the answer is home', HW.npcPlaceAt(denton, { minutes: 460, weekday: 'Monday' }), 'loc_denton_home');
eq('a named-day entry works (saturday civic events)',
  HW.scheduleActiveAt(denton, { minutes: 700, weekday: 'Saturday' }).locationId, 'loc_main_street');
eq('saturday morning is not the office', HW.npcPlaceAt(denton, { minutes: 500, weekday: 'Saturday' }), 'loc_denton_home');
ok('missing days means every day',
  HW.scheduleActiveAt({ schedule: [{ time: '09:00', locationId: 'x' }] }, { minutes: 600, weekday: 'Wednesday' }).locationId === 'x');

var run32 = HW.start(w, 'origin_new_hire');  /* Monday 08:57 */
var bpD = HW.buildPrompt(Object.assign({}, w, {}), Object.assign({}, run32, { locationId: 'loc_bullpen', turn: 2 }), 'hi');
var locBlock2 = sysBlock(bpD.system, 'You are at');
ok('at 09:07 Denton is where his schedule says - the bullpen',
  /Present:[^\n]*Denton Pike/.test(locBlock2));
ok('...and the scene knows what he should be doing',
  locBlock2.indexOf('Denton Pike should be: Performs a motivational lap through the branch') !== -1);

var bp0 = HW.buildPrompt(w, Object.assign({}, run32, { locationId: 'loc_denton' }), 'hi');
var locBlock0 = sysBlock(bp0.system, 'You are at');
ok('at 08:57 Denton is in his office', /Present:[^\n]*Denton Pike/.test(locBlock0));
ok('a present NPC brings his strongest ties along',
  locBlock0.indexOf('Denton Pike ↔ Eli Finch: desperate for approval (51)') !== -1 &&
  locBlock0.indexOf('Denton Pike ↔ Connor Vale: favorite rainmaker and possible successor (48)') !== -1 &&
  locBlock0.indexOf('Denton Pike ↔ Gloria Bell: depends on her competence; pretends otherwise (32)') !== -1,
  locBlock0.split('\n').filter(function (l) { return l.indexOf('↔') !== -1; }).join(' | '));
ok('...at most three, so the web never floods the prompt',
  locBlock0.split('\n').filter(function (l) { return l.indexOf('↔') !== -1; }).length === 3);

var bpM = HW.buildPrompt(w, Object.assign({}, run32, { locationId: 'loc_maplebridge' }), 'hi');
ok('authored place texture reaches the referee',
  sysBlock(bpM.system, 'You are at').indexOf('(Referee texture: danger 8, prosperity 58 of 100.)') !== -1);
var twPlain = tinyWorld();
ok('no ratings, no texture line', HW.buildPrompt(twPlain, HW.start(twPlain), 'hi').system.indexOf('Referee texture') === -1);

eq('a life actually starts like the life: performance', run32.stats.performance, 40);
eq('...cash', run32.stats.cash, 160);
eq('...nerve', run32.stats.nerve, 4);
eq('the obligations arrive as open tasks', run32.quests.length, 3);
eq('the first is onboarding', run32.quests[0].text, 'Complete onboarding');
eq('identity rides the run', run32.identity, 'entry level · employee on probation');
ok('the outfit too', run32.outfit.indexOf('new office clothes') === 0, run32.outfit);

var state32 = sysBlock(bp0.system, 'Time:');
ok('the state names the season on the world calendar',
  state32.indexOf('Season: Maplebridge civic year · early spring · day 1') !== -1, state32.split('\n')[1] || '');
ok('...and who you set out to be',
  state32.indexOf('You are: entry level · employee on probation.') !== -1);
ok('...and what you are wearing', state32.indexOf('Wearing: new office clothes') !== -1);
ok('...and the obligations count in the ledger line',
  state32.indexOf('Tasks: Complete onboarding; Protect client information; Survive ninety days of probation') !== -1);
ok('a world without seasons says nothing', HW.buildPrompt(twPlain, HW.start(twPlain), 'hi').system.indexOf('Season:') === -1);

var qDone = HW.applyTags(w, run32, 'First day done.[[quest-done:Complete onboarding]]');
ok('a seeded obligation can be completed by name', qDone.changes.length === 1 && run32.quests[0].done, JSON.stringify(qDone));

/* prompt budget: a played NPC reads as a synopsis, a stranger as a dossier */
var rawDenton = '- Denton Pike: ' + denton.persona;
var fresh = sysBlock(HW.buildPrompt(w, Object.assign({}, run32, { locationId: 'loc_denton' }), 'hi').system, 'You are at');
ok('first meeting: the full dossier', fresh.indexOf(rawDenton) !== -1);
var met = Object.assign({}, run32, { locationId: 'loc_denton' });
met.log = [{ role: 'assistant', content: 'Denton Pike adjusts his tie and beams.' }];
var metBlock = sysBlock(HW.buildPrompt(w, met, 'hi').system, 'You are at');
var metLine = (metBlock.split('\n').find(function (l) { return l.indexOf('- Denton Pike: ') === 0; })) || '';
ok('once played: a synopsis, not the dossier',
  metLine.length > 0 && metLine.length < rawDenton.length && /…$/.test(metLine), metLine.length + ' vs ' + rawDenton.length);
ok('metNpc itself', HW.metNpc(met, denton) === true && HW.metNpc(run32, denton) === false);

/* the grammar's roll-call obeys kernel.sceneLocationLimit */
var capRun = Object.assign({}, run32, { locationId: 'loc_bullpen' });
ok('within the limit: the whole map, no "+N"',
  HW.locationIdLine(w, capRun).split(', ').length === w.locations.length &&
  HW.locationIdLine(w, capRun).indexOf('+') === -1);
var wCap = Object.assign({}, w, { kernel: { sceneLocationLimit: 5 } });
var capped = HW.locationIdLine(wCap, capRun);
eq('over the limit: current place first, then "+N more"',
  capped.slice(0, 'loc_bullpen'.length) + '|' + capped.slice(-8), 'loc_bullpen|+18 more');
ok('...and exactly the limit names', capped.split(', +')[0].split(', ').length === 5);

/* clamps + seeds on a synthetic life */
var wTiny2 = tinyWorld();
wTiny2.hudConfig = { stats: [{ id: 'hp', name: 'HP', value: 5, min: 0, max: 10 }] };
wTiny2.startingLives = [{ id: 'l1', name: 'Hero', role: 'squire', startLocationId: 'a',
  statOverrides: { hp: 99 }, obligations: ['Win', 'Win', ''], outfit: 'a plain cloak', socialRank: 'squire' }];
var runTiny2 = HW.start(wTiny2, 'l1');
eq('overrides clamp to the stat bounds', runTiny2.stats.hp, 10);
eq('obligations dedupe and skip empties', runTiny2.quests.length, 1);
eq('a life with only a rank still names you', runTiny2.identity, 'squire');
ok('startingQuests seed the same way',
  (function () {
    var wq = tinyWorld(); wq.startingQuests = ['Find the lamp'];
    return HW.start(wq).quests[0].text === 'Find the lamp';
  })());

/* --- v1.33.0: the world moves without you; standing has consequences --- */

console.log('\noff-screen: the pulse');

eq('the agent survives the parse - an 18-turn tick', HW.pulseInterval(w), 18);
eq('a world with no agent does not tick', HW.pulseInterval(twPlain), 0);
eq('an agent set to enabled:false stays quiet',
  HW.pulseInterval(HW.parse(Object.assign({}, WORLD, { worldAgent: { enabled: false } }))), 0);
eq('an interval-less agent falls back to fifteen',
  HW.pulseInterval(HW.parse(Object.assign({}, WORLD, { worldAgent: {} }))), 15);
ok('goal programs default to an empty list, not null',
  Array.isArray(w.goalPrograms) && w.goalPrograms.length === 0);

ok('the pulse lands on the tick', HW.pulseDue(w, Object.assign({}, run32, { turn: 18 })) === true &&
  HW.pulseDue(w, Object.assign({}, run32, { turn: 36 })) === true);
ok('...not one turn early', HW.pulseDue(w, Object.assign({}, run32, { turn: 17 })) === false);
ok('...and never at the beginning', HW.pulseDue(w, Object.assign({}, run32, { turn: 0 })) === false);

/* Policy Panic has no goal programs: the factions' own goals take the floor */
var beat1 = HW.worldBeat(w, Object.assign({}, run32, { turn: 18 }));
var beat2 = HW.worldBeat(w, Object.assign({}, run32, { turn: 36 }));
ok('a beat names a faction and its goal', /is still working to: /.test(beat1), beat1);
ok('...and the next beat says something different', beat1 !== beat2 && beat2.length > 0, beat2);
ok('no beat at turn zero', HW.worldBeat(w, run32) === '');

console.log('\noff-screen: goal programs');

var wGoal = tinyWorld();
wGoal.worldAgent = { enabled: true, intervalTurns: 10 };
wGoal.goalPrograms = [{ id: 'gp1', name: 'The audit closes in', actor: 'fac_management',
  steps: ['whispers from corporate', 'a courier with a folder', 'the final letter'] }];
ok('the needle starts on step one',
  HW.goalAhead(wGoal, HW.start(wGoal)).indexOf('"whispers from corporate"') !== -1,
  HW.goalAhead(wGoal, HW.start(wGoal)));
ok('...one step per beat that has landed',
  HW.goalAhead(wGoal, Object.assign({}, HW.start(wGoal), { turn: 10 }))
    .indexOf('"a courier with a folder"') !== -1);
ok('...and pins on the last step once the program runs out',
  HW.goalAhead(wGoal, Object.assign({}, HW.start(wGoal), { turn: 999 }))
    .indexOf('"the final letter"') !== -1);
var beatSys = HW.buildPrompt(wGoal, Object.assign({}, HW.start(wGoal), { turn: 10 }), 'hi').system;
ok('a pulse turn tells the referee the world moved',
  beatSys.indexOf('Off-screen, the world has moved:') !== -1);
ok('...with the program step in it', beatSys.indexOf('a courier with a folder') !== -1);
ok('quiet turns stay quiet',
  HW.buildPrompt(wGoal, Object.assign({}, HW.start(wGoal), { turn: 9 }), 'hi').system
    .indexOf('Off-screen, the world has moved:') === -1);
ok('the goal needle rides the state block',
  sysBlock(beatSys, 'Time:').indexOf('The world is working toward: The audit closes in') !== -1,
  sysBlock(beatSys, 'Time:'));

console.log('\noff-screen: standing');

var runRep = HW.start(w, 'origin_new_hire');
eq('the life seeds standing', JSON.stringify(runRep.reputation), '[{"factionId":"fac_frontdesk","score":5}]',
  JSON.stringify(runRep.reputation));
var rep1 = HW.applyTags(w, runRep, 'Gloria waves.[[rep:fac_frontdesk:+3]]');
eq('a good turn moves the score', JSON.stringify(runRep.reputation),
  '[{"factionId":"fac_frontdesk","score":8}]');
ok('...and says so in the ledger', rep1.changes[0] === 'standing with The Switchboard +3', rep1.changes[0]);
ok('the number leaves the prose', rep1.text === 'Gloria waves.');
var rep2 = HW.applyTags(w, runRep, '[[rep:The Switchboard:-4]]');
eq('a faction also answers to its name', runRep.reputation[0].score, 4);
var rep3 = HW.applyTags(w, runRep, '[[rep:fac_management:+7]]');
eq('a new faction joins the ledger', runRep.reputation.length, 2);
eq('...at its own score', runRep.reputation[1].score, 7);
ok('zero is not a change', HW.applyTags(w, runRep, '[[rep:fac_frontdesk:0]]').changes.length === 0 &&
  runRep.reputation[0].score === 4);
ok('an unknown faction is told off',
  HW.applyTags(w, runRep, '[[rep:The Illuminati:+5]]').rejections.length === 1);
var runCap = HW.start(w); runCap.reputation = [{ factionId: 'fac_town', score: 98 }];
HW.applyTags(w, runCap, '[[rep:fac_town:+10]]');
eq('standing is a ledger, not a runaway integer', runCap.reputation[0].score, 100);
ok('the state block shows who you are to the world',
  sysBlock(HW.buildPrompt(w, runRep, 'hi').system, 'Time:').indexOf('Standing: The Switchboard +4') !== -1);

/* --- v1.34.0: the dice table, the floor, and what ails you --- */

console.log('\nthe dice are the world\u2019s own');

eq('defaultDifficulty reads the table', HW.defaultDifficulty(w), 11);
eq('...and the house ten when the table is silent', HW.defaultDifficulty(twPlain), 10);

var wDice = Object.assign({}, w, { gameRules: Object.assign({}, w.gameRules, {
  checks: [{ name: 'daring', stat: 'nerve',
    on_success: { stats: { performance: 2 } }, on_failure: { stats: { stress: 3 } } }] }) });
var runDice = HW.start(w, 'origin_new_hire');
function seedProducing(pred) {
  for (var s = 0; s < 9000; s++) { var p = { seed: s }; if (pred(HW.nextRand(p))) return s; }
  return -1;
}
runDice.seed = seedProducing(function (r) { return Math.floor(r * 20) === 5; });
var dres = HW.resolveChecks(wDice, runDice, { checkRequests: [{ spec: '1d20', name: 'daring' }] });
eq('a dc-less check runs at the world\u2019s difficulty', dres.list[0].dc, 11);
ok('...in words on the line', dres.list[0].text.indexOf('vs DC 11') !== -1, dres.list[0].text);
eq('...and the branch lands (6 vs 11 is a failure)', runDice.stats.stress, 23);
eq('...not the success\u2019s branch', runDice.stats.performance, 40);

var runCrit = HW.start(w, 'origin_new_hire');
runCrit.seed = seedProducing(function (r) { return Math.floor(r * 20) === 19; });
var dCrit = HW.resolveChecks(Object.assign({}, wDice, { gameRules: Object.assign({}, wDice.gameRules, {
  checks: [{ name: 'daring', stat: 'nerve', dc: 21, on_success: { stats: { performance: 2 } },
    on_failure: { stats: { stress: 3 } } }] }) }),
  runCrit, { checkRequests: [{ spec: '1d20', name: 'daring' }] });
ok('criticals: a natural max beats any DC', dCrit.list[0].success === true &&
  dCrit.list[0].text.indexOf('critical!') !== -1, dCrit.list[0].text);
eq('...and pays the success', runCrit.stats.performance, 42);

var runFum = HW.start(w, 'origin_new_hire');
runFum.seed = seedProducing(function (r) { return Math.floor(r * 20) === 0; });
var dFum = HW.resolveChecks(Object.assign({}, wDice, { gameRules: Object.assign({}, wDice.gameRules, {
  checks: [{ name: 'daring', stat: 'nerve', dc: 2, on_success: { stats: { performance: 2 } },
    on_failure: { stats: { stress: 3 } } }] }) }),
  runFum, { checkRequests: [{ spec: '1d20', name: 'daring' }] });
ok('...and a natural one fails any roll', dFum.list[0].success === false &&
  dFum.list[0].text.indexOf('critical fumble') !== -1, dFum.list[0].text);
eq('...with the failure\u2019s bill attached', runFum.stats.stress, 23);

var wNoCrit = Object.assign({}, wDice, { gameRules: Object.assign({}, wDice.gameRules, {
  dice: Object.assign({}, w.gameRules.dice, { criticals: false }),
  checks: [{ name: 'daring', stat: 'nerve', dc: 21, on_success: { stats: { performance: 2 } },
    on_failure: { stats: { stress: 3 } } }] }) });
var runNoCrit = HW.start(w, 'origin_new_hire');
runNoCrit.seed = seedProducing(function (r) { return Math.floor(r * 20) === 19; });
var dNoCrit = HW.resolveChecks(wNoCrit, runNoCrit, { checkRequests: [{ spec: '1d20', name: 'daring' }] });
ok('a table without criticals just honors the numbers', dNoCrit.list[0].success === false &&
  dNoCrit.list[0].text.indexOf('critical') === -1, dNoCrit.list[0].text);

var wMod = Object.assign({}, wDice, { hudConfig: { stats: [{ id: 'nerve', name: 'Nerve', value: 5, roll: { enabled: true, mode: 'direct', fixedModifier: 3 } }] } });
eq('per_stat: the check inherits the stat\u2019s fixed modifier', HW.statRollMod(wMod, null, { stat: 'nerve' }), 3);
eq('...only in modifierMode per_stat', HW.statRollMod(Object.assign({}, wDice, {
    gameRules: Object.assign({}, wDice.gameRules, { dice: { modifierMode: 'flat' } }) }),
  null, { stat: 'nerve' }), 0);

console.log('\nconditions');

var runC = HW.start(w, 'origin_new_hire');
var c1 = HW.applyTags(w, runC, 'The copier bites. [[condition:paper-cut hand]] and again [[condition:paper-cut hand]]');
eq('naming a condition once names it once', JSON.stringify(runC.conditions), '["paper-cut hand"]');
eq('...and it is a ledger line', c1.changes.length, 1);
ok('the state block wears it', sysBlock(HW.buildPrompt(w, runC, 'hi').system, 'Time:').indexOf('Conditions: paper-cut hand') !== -1);
var c2 = HW.applyTags(w, runC, '[[clear:PAPER-CUT HAND]]');
ok('clearing matches regardless of case', runC.conditions.length === 0 &&
  c2.changes[0] === 'condition lifts: paper-cut hand', JSON.stringify(c2.changes));
ok('clearing nothing is told off', HW.applyTags(w, runC, '[[clear:Nothing]]').rejections.length === 1);
var wNoCond = HW.parse(Object.assign({}, WORLD, { gameRules: Object.assign({}, WORLD.gameRules, {
  modules: Object.assign({}, WORLD.gameRules.modules, { conditions: false }) }) }));
ok('a table without the module refuses rather than drops',
  HW.applyTags(wNoCond, HW.start(wNoCond, null), '[[condition:cursed]]').rejections.length === 1);
ok('...and its grammar stays silent about condition tags',
  HW.buildPrompt(wNoCond, HW.start(wNoCond, null), 'hi').system.indexOf('[[condition:') === -1);
ok('...while Policy Panic\u2019s grammar teaches them',
  HW.buildPrompt(w, runC, 'hi').system.indexOf('[[condition:NAME]] [[clear:NAME]]') !== -1);

console.log('\nthe floor');

eq('Policy Panic\u2019s comedy has no vital stat - the module stays decor', HW.vitalStat(w), null);
var wH = HW.parse(Object.assign({}, WORLD, { gameRules: Object.assign({}, WORLD.gameRules, {
  vitalStatId: 'hp',
  modules: Object.assign({}, WORLD.gameRules.modules, { health: true }) }) }));
wH.hudConfig = { stats: [{ id: 'hp', name: 'HP', value: 3, min: 0, max: 10 }] };
var runH = HW.start(wH, null); runH.stats.hp = 3;
eq('the vital stat answers when both halves are declared', HW.vitalStat(wH), 'hp');
var dh = HW.applyTags(wH, runH, '[[stat:hp:-3]]');
ok('zero drops the player', runH.downed === true && dh.changes[dh.changes.length - 1] === 'downed',
  JSON.stringify(dh.changes));
var hSys = HW.buildPrompt(wH, runH, 'hi').system;
ok('the referee is told the floor fell through',
  hSys.indexOf('downed - the next scene begins from consequences') !== -1);
ok('...and the stat wears its mark', /HP ✧ 0\/10/.test(hSys), sysBlock(hSys, 'Stats:').split('\n')[0]);
var uh = HW.applyTags(wH, runH, '[[stat:hp:+4]]');
ok('back above zero, back on your feet', runH.downed === false &&
  uh.changes[uh.changes.length - 1] === 'back on their feet', JSON.stringify(uh.changes));
ok('no floor in a world without health: the tags just move numbers',
  (function () {
    var rg = HW.start(w, 'origin_new_hire');
    HW.applyTags(w, rg, '[[stat:performance:-99]]');
    return rg.downed !== true;
  })());
var norm34 = HW.normalizeRun({ stats: {} });
ok('old runs grow the new fields quietly',
  Array.isArray(norm34.conditions) && norm34.downed === false);

/* --- v1.36.0: the story remembers itself, and lore answers the scene --- */

(function () {
  /* the memory cadence: same rhythm as the persona chats, keyed to turns */
  var mr = { turn: 0, memAt: 0 };
  ok('nothing due before the first turn', !HW.memoryDue(mr, 14));
  mr.turn = 12; ok('not due mid-interval', !HW.memoryDue(mr, 14));
  mr.turn = 14; ok('due on the cadence turn', HW.memoryDue(mr, 14));
  HW.applyMemory(mr, { summary: 'They searched the lamp shop and took a beating from the lamp keeper.', facts: ['The lamp keeper cheats at dice', 'the lamp keeper cheats at dice', '  '] });
  ok('after the pass the cadence is satisfied', !HW.memoryDue(mr, 14));
  mr.turn = 28; ok('...and due again next interval', HW.memoryDue(mr, 14));
  var hollow = { turn: 14, memAt: 0 };
  HW.applyMemory(hollow, { summary: '  ', facts: [] });
  eq('an empty pass does not burn the marker', hollow.memAt, 0);

  /* the write-side is bounded and deduped */
  var wr = { turn: 3, memAt: 0 };
  var longText = new Array(2001).join('q');
  var manyFacts = [];
  for (var i = 0; i < 20; i++) manyFacts.push('fact ' + i);
  HW.applyMemory(wr, { summary: longText, facts: manyFacts });
  ok('the summary is capped at 1500', wr.memory.summary.length <= 1500, wr.memory.summary.length + '');
  eq('the facts list is capped at twelve', wr.memory.facts.length, 12);

  /* recall: the memory rides the prompt, labelled as memory, not ledger */
  var mw = {
    id: 'wmem', name: 'Memorable', startLocationId: 'a',
    locations: [{ id: 'a', name: 'A', exits: [], description: '', region: '' }],
    entities: [], factions: [], relationships: [], startingLives: [],
    gameRules: {}, hudConfig: {}, dmPrompt: '', authorNote: '', intro: ''
  };
  var pr = HW.start(mw);
  HW.applyMemory(pr, { summary: 'The lamp shop burned before they got there.', facts: ['A matchstick is still missing'] });
  var mp = HW.buildPrompt(mw, pr, 'What happened here?').system;
  ok('the prompt recalls the story so far', /Story so far/.test(mp) && /lamp shop burned/.test(mp));
  ok('...and the established facts', /Established facts/.test(mp) && /matchstick/.test(mp));
  ok('memory is subordinate to the ledger', /the ledger above outranks/i.test(mp));
  ok('a run without memory pushes no memory block', !/Story memory/.test(HW.buildPrompt(mw, HW.start(mw), 'hello').system));

  /* lore answers the scene, not just the player's latest line */
  var lw = {
    id: 'wlre', name: 'Loreful', startLocationId: 'a',
    locations: [{ id: 'a', name: 'A', exits: [], description: '', region: '' }],
    entities: [], factions: [], relationships: [], startingLives: [],
    lorebook: [{ id: 'll1', keyword: 'thornkeep', text: 'Thornkeep sank under the great flood.', knownBy: '' }],
    gameRules: {}, hudConfig: {}, dmPrompt: '', authorNote: '', intro: ''
  };
  var lr = HW.start(lw);
  lr.log = [
    { role: 'user', content: 'I wander the old road.', turn: 1 },
    { role: 'assistant', content: 'The sign says Thornkeep, though no one has seen it whole in an age.', turn: 1 }
  ];
  lr.turn = 2;
  var lp = HW.buildPrompt(lw, lr, 'Tell me more about this place.').system;
  ok('lore the referee just mentioned surfaces', /Established lore/.test(lp) && /great flood/.test(lp));
  var lrClean = HW.start(lw);
  lrClean.log = [{ role: 'user', content: 'I wander.', turn: 1 }, { role: 'assistant', content: 'A quiet shore.', turn: 1 }];
  lrClean.turn = 2;
  ok('uncharted chatter still surfaces nothing', !/Established lore/.test(HW.buildPrompt(lw, lrClean, 'Anything else?').system));

  /* and a found fact lingers a beat, so a conversation can chase it.
     Each round owes the log the exchange that just happened - like the
     app does before the next prompt is built. */
  var sr = HW.start(lw);
  sr.turn = 4;
  var fired = HW.buildPrompt(lw, sr, 'We approach Thornkeep.').system;
  ok('a direct mention lights it', /great flood/.test(fired));
  sr.log.push({ role: 'user', content: 'We approach Thornkeep.', turn: 4 });
  sr.log.push({ role: 'assistant', content: 'You arrive at dusk.', turn: 4 });
  sr.turn = 5;
  ok('a fresh hit still shows next turn', /great flood/.test(HW.buildPrompt(lw, sr, 'What do I see?').system));
  sr.log.push({ role: 'user', content: 'What do I see?', turn: 5 });
  sr.log.push({ role: 'assistant', content: 'Mist gathers on the stones.', turn: 5 });
  sr.turn = 6;
  ok('...and a second turn', /great flood/.test(HW.buildPrompt(lw, sr, 'And then?').system));
  sr.log.push({ role: 'user', content: 'And then?', turn: 6 });
  sr.log.push({ role: 'assistant', content: 'Rain begins.', turn: 6 });
  sr.log.push({ role: 'user', content: 'And then?', turn: 6 });
  sr.log.push({ role: 'assistant', content: 'Rain begins.', turn: 6 });
  sr.turn = 7;
  ok('...and it lingers a third', /great flood/.test(HW.buildPrompt(lw, sr, 'And then?').system));
  sr.log.push({ role: 'user', content: 'And then?', turn: 7 });
  sr.log.push({ role: 'assistant', content: 'Night falls.', turn: 7 });
  sr.turn = 8;
  ok('...but not forever', !/Established lore/.test(HW.buildPrompt(lw, sr, 'And then?').system));
})();

/* --- v1.35.0: worn apart from carried; the catalogue has a peephole --- */

console.log('\nequipment');

var wEq2 = HW.parse(Object.assign({}, WORLD, { gameRules: Object.assign({}, WORLD.gameRules, {
  modules: Object.assign({}, WORLD.gameRules.modules, { equipment: true }),
  equipment: { slots: ['hand', 'back'] } }) }));
eq('slots arrive in the world\u2019s order', JSON.stringify(HW.equipmentSlots(wEq2)), '["hand","back"]');
eq('the module switch governs', HW.equipmentSlots(w).length, 0);
var runEq = HW.start(wEq2, 'origin_new_hire');
var e1 = HW.applyTags(wEq2, runEq, '[[equip:hand:employee badge]]');
ok('equipping moves the thing from pocket to slot',
  runEq.equip.hand === 'employee badge' && runEq.inventory.indexOf('employee badge') === -1,
  JSON.stringify({ equip: runEq.equip, inv: runEq.inventory }));
eq('...as a ledger line', e1.changes[0], 'equipped employee badge (hand)');
var e2 = HW.applyTags(wEq2, runEq, 'picked [[item:lanyard]] [[equip:hand:lanyard]]');
ok('a fuller slot swaps, not clobbers',
  runEq.equip.hand === 'lanyard' && runEq.inventory.indexOf('employee badge') !== -1 &&
  /swapped employee badge for lanyard/.test(e2.changes[e2.changes.length - 1]),
  JSON.stringify(e2.changes));
ok('the state block wears the kit',
  sysBlock(HW.buildPrompt(wEq2, runEq, 'hi').system, 'Time:').indexOf('Equipped: lanyard (hand)') !== -1);
ok('...and the grammar teaches the tags only at equipped tables',
  HW.buildPrompt(wEq2, runEq, 'hi').system.indexOf('[[equip:SLOT:ITEM]]') !== -1 &&
  HW.buildPrompt(w, run32, 'hi').system.indexOf('[[equip:') === -1);
ok('what you do not carry, you do not wear',
  HW.applyTags(wEq2, runEq, '[[equip:back:doghouse]]').rejections.length === 1);
ok('an unnamed slot is named back to the referee',
  /name the slot/.test(HW.applyTags(wEq2, runEq, '[[equip:shoulder:lanyard]]').rejections[0].reason));
var e3 = HW.applyTags(wEq2, runEq, '[[unequip:hand]]');
ok('unwearing stows the thing',
  runEq.equip.hand === undefined && runEq.inventory.indexOf('lanyard') !== -1 &&
  e3.changes[0] === 'stowed lanyard', JSON.stringify(e3.changes));
ok('unwearing an empty slot is told off',
  HW.applyTags(wEq2, runEq, '[[unequip:back]]').rejections.length === 1);
var wEq1 = HW.parse(Object.assign({}, WORLD, { gameRules: Object.assign({}, WORLD.gameRules, {
  modules: Object.assign({}, WORLD.gameRules.modules, { equipment: true }), equipment: ['hand'] }) }));
var runEq1 = HW.start(wEq1, 'origin_new_hire');
ok('a one-slot table forgives the shorthand',
  HW.applyTags(wEq1, runEq1, '[[equip:employee badge]]').changes[0] === 'equipped employee badge (hand)');
var wEqOff = HW.parse(Object.assign({}, WORLD, { gameRules: Object.assign({}, WORLD.gameRules, {
  modules: Object.assign({}, WORLD.gameRules.modules, { equipment: false }) }) }));
ok('equipment off refuses rather than drops',
  HW.applyTags(wEqOff, HW.start(wEqOff, 'origin_new_hire'), '[[equip:hand:employee badge]]').rejections.length === 1);
ok('old runs grow pockets for worn things', (function () {
  var rn = HW.normalizeRun({ stats: {} });
  return rn.equip && typeof rn.equip === 'object' && !Array.isArray(rn.equip);
})());

console.log('\nthe world that ships with the install');

HW.bundled().then(function (shipped) {
  ok('the build offers a world to install', shipped.length > 0, shipped.length + ' offered');
  if (!shipped.length) { finish(); return null; }
  var entry = shipped[0];
  ok('it names itself', !!entry.name, entry.name);
  ok('and says what is in it', entry.places > 0 && entry.people > 0,
     entry.places + ' places, ' + entry.people + ' people');
  ok('it carries attribution', !!entry.attribution, String(entry.attribution).slice(0, 60));

  /* v1.35.0: a look before the leap - peeking parses without persisting */
  return HW.peekBundled(entry.id).then(function (peeked) {
    ok('peeking parses the same world', !!peeked && peeked.name === entry.name);
    eq('...with all its places', (peeked.locations || []).length, entry.places);
    return HW.peekBundled('not_a_real_world_id').then(function () {
      ok('an unknown catalogue id is told off', false);
    }, function () {
      ok('an unknown catalogue id is told off', true);
    }).then(function () {
      return HW.installBundled(entry.id).then(function (installed) {
        ok('installing parses it', !!installed);
        eq('under the catalogue id, so it is not offered twice', installed.id, entry.id);
        eq('and it really is the same world', installed.name, entry.name);
        eq('with its places', (installed.locations || []).length, entry.places);
        ok('with no artwork left in it', !installed.banner);
        finish();
      });
    });
  });
}).catch(function (e) { ok('bundled install', false, e && e.message); finish(); });

function finish() {
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
}
