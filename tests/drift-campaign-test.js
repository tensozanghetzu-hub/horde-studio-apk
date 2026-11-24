#!/usr/bin/env node
/* v1.42.2 — a scripted 60-turn campaign, asserted on the record (memory research §7).
 *
 * "Does the memory work?" cannot be answered by reading prose: a scene can read
 * beautifully and still have the referee holding a retired fact, and a scene can
 * read badly with the record perfectly intact. So this campaign never asks a
 * model anything. One synthetic world, one invented cast, 60 turns of scripted
 * play with planted facts, and the assertions are on what the engine holds and on
 * the briefing it would hand over at each turn:
 *
 *   - a name said only at turn 8 and taken up again at 55;
 *   - an item picked up at 12 and used at 44;
 *   - a debt opened at 20 and repaid at 50 - the CURRENT value must be "paid";
 *   - a task accepted at 15, advanced at 31, completed at 47;
 *   - a level at 33, and a purse that only ever moves by a logged delta;
 *   - a companion who parts at 26 and is not listed as present afterwards.
 *
 * The five LongMemEval question types are probed at turns 20 / 40 / 60:
 * extract, combine, temporal, update, abstain. Facts reach the run on the
 * engine's own memory cadence, and the run is cloned and normalised mid-campaign
 * the way a saved game is, so what survives a reload is what is asserted.
 *
 * Everything generic: no card, no authored world, no model. The extraction a real
 * turn gets from the referee is scripted here — that is deliberate. This measures
 * the ledger, the prompt built from it, and the counters, which is the half a
 * phone can regress and the half no benchmark on a paper covers.
 *
 *   node /home/user/tests/drift-campaign-test.js
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, String(got) === String(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadHW() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, globalThis: null,
    fetch: function () { return Promise.resolve({ ok: false }); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'hordeworld.js'), 'utf8'), sandbox,
    { filename: 'hordeworld.js' });
  return sandbox.HW;
}
var HW = loadHW();

function worldDef() {
  return HW.parse({
    _format: 'horde-world', name: 'The Tide Gate', ledgerV2: true,
    locations: [
      { id: 'quay', name: 'The Quay', synopsis: 'Ropes, salt, lamps.' },
      { id: 'ford', name: 'The Ford', synopsis: 'Cold water over stones.' },
      { id: 'temple', name: 'The Tide Temple', synopsis: 'A bell with a crack in it.' }
    ],
    startLocationId: 'quay',
    entities: [
      { id: 'bren', name: 'Bren', type: 'npc' },
      { id: 'verrin', name: 'Verrin', type: 'npc' },
      { id: 'maren', name: 'Maren', type: 'npc' }
    ],
    hudConfig: { showClock: false, stats: [{ id: 'grit', name: 'Grit', value: 3, min: 0, max: 12 }] },
    gameRules: { modules: { quests: true, commerce: true }, currencyName: 'coin' },
    /* the world's own lore format: a comma list in `keyword`, not the card
       book's `keys` array — an entry that does not name its keyword is not a
       match for anything, and would quietly leave the lore bucket at zero. */
    lorebook: [{ id: 'lb-lantern', keyword: 'lantern, ford',
      text: 'A lantern lit at the ford must be carried unlit after the crossing.' }]
  });
}
var WORLD = worldDef();
var EVERY = 6;                        // the memory cadence, on purpose, not every turn

/* ---- the script -------------------------------------------------------
   turn -> what the player asked, what the scene said, the tags that turn logs,
   and the facts the memory pass is told about from then on. */
var SCRIPT = {
  3:  { tags: '[[with:Bren]] [[with:Maren]]', say: 'Bren and Maren fall in behind you on the quay.' },
  5:  { tags: '[[cash:+40]]', say: 'The harbouress pays out for the crossing you made last week.' },
  8:  { facts: ['The lamplighter on the quay is named Verrin'], say: 'A thin man is splicing wick into a lamp.' },
  12: { tags: '[[item:Brass lantern]]', facts: ['The player borrowed a brass lantern from the quay store'],
        say: 'You take the brass lantern down off its hook.' },
  15: { tags: '[[quest:Carry the cracked bell to the tide temple]]',
        facts: ['The cracked bell must reach the tide temple before the next high water'],
        say: 'The bell is too heavy to leave where it is.' },
  18: { tags: '[[clock:soon]]', say: 'Someone says the time is soon, and the ledger does not accept it.' },
  20: { tags: '[[cash:-30]]', facts: ['the debt of 30 coin to Verrin stands open'],
        say: 'You borrow against the lantern and the lamp-lighter keeps the tally.' },
  26: { tags: '[[part:Bren]]', say: 'Bren turns back up the beach at the ford road and does not come further.' },
  30: { facts: ['The tide gate key is under the third stone at the ford'],
        say: 'You look under the third stone where no one can see you.' },
  31: { facts: ['The cracked bell is resting at the ford, halfway to the temple'],
        say: 'The bell waits by the water while you plan the crossing.' },
  33: { tags: '[[stat:grit:+1]]', say: 'You carry the bell a mile without setting it down.' },
  40: { say: 'The ford is quiet and the water is low.' },
  44: { facts: ['The brass lantern was lit at the ford before the crossing'],
        say: 'You light the lantern at the ford and the water turns copper.' },
  47: { tags: '[[questdone:Carry the cracked bell]]', say: 'The bell hangs in the temple niche, cracked and arrived.' },
  50: { tags: '[[cash:-30]]', facts: ['the debt of 30 coin to Verrin is paid'],
        say: 'You count out thirty coin on the barrel head and Verrin nods.' },
  55: { facts: ['Verrin the lamplighter mends the net by the pier at dusk'],
        say: 'Verrin is mending a net by the pier when you come back.' },
  58: { say: 'The tide turns and the quay empties.' }
};

/* ---- what "the model received" means, measured on the prompt itself --- */
function briefing(run, input) { return HW.buildPrompt(WORLD, run, input || 'What now?'); }
function memBlockOf(sys) {
  var i = sys.indexOf('Story memory');
  if (i === -1) return '';
  var rest = sys.slice(i);
  var cut = rest.search(/\n\n(?:Established lore|Rules:)/);
  return cut === -1 ? rest : rest.slice(0, cut);
}
function companionsLine(sys) {
  var i = sys.indexOf('Companions - with the player right now:');
  if (i === -1) return '';
  var cut = sys.indexOf('\n\n', i);
  return cut === -1 ? sys.slice(i) : sys.slice(i, cut);
}
function current(run) { return HW.currentFacts(run).map(function (f) { return f.text; }); }
function sumDeltas(upto, kind) {
  var n = 0;
  Object.keys(SCRIPT).forEach(function (t) {
    if (Number(t) > upto) return;
    String(SCRIPT[t].tags || '').replace(/\[\[(cash|stat):([^\]]*)\]\]/g, function (_w, k, arg) {
      if (k !== kind) return '';
      var v = parseFloat(kind === 'cash' ? arg : String(arg).split(':')[1]);
      if (!isNaN(v)) n += v;
      return '';
    });
  });
  return n;
}
function itemsTo(upto) {
  var out = [];
  Object.keys(SCRIPT).forEach(function (t) {
    if (Number(t) > upto) return;
    String(SCRIPT[t].tags || '').replace(/\[\[(item|drop):([^\]]*)\]\]/g, function (_w, k, arg) {
      var name = String(arg).trim();
      var at = out.map(function (x) { return x.toLowerCase(); }).indexOf(name.toLowerCase());
      if (k === 'item' && at === -1) out.push(name);
      if (k === 'drop' && at !== -1) out.splice(at, 1);
      return '';
    });
  });
  return out;
}

/* ---- play it ---------------------------------------------------------- */
var R = HW.start(WORLD);
R.turn = 0;
var cash0 = R.stats[R.cashId || 'cash'], grit0 = R.stats.grit;
var fedThrough = 0, reloaded = false, minGrit = grit0, gritRegressed = 0;
var violations = [], factHistory = [];

for (var t = 1; t <= 60; t++) {
  var s = SCRIPT[t] || {};
  var reply = (s.say || 'The hour passes on the quay.') + (s.tags ? '\n' + s.tags : '');
  var applied = HW.applyTags(WORLD, R, reply);
  HW.commit(R, s.ask || ('turn ' + t + ' of the campaign'), reply, applied);

  /* the memory pass, on the engine's own cadence, told only what is new */
  if (HW.memoryDue(R, EVERY)) {
    var fresh = [];
    Object.keys(SCRIPT).forEach(function (k) {
      var n = Number(k);
      if (n <= fedThrough || n > R.turn) return;
      (SCRIPT[k].facts || []).forEach(function (f) { fresh.push(f); });
    });
    fedThrough = R.turn;
    HW.applyMemory(R, { summary: 'Turn ' + R.turn + ' of the campaign at the tide gate.', facts: fresh });
  }

  /* mid-campaign, the run goes through a save: clone, normalise, continue */
  if (t === 40 && !reloaded) {
    var wasNow = current(R).join(' | '), wasCash = R.stats[R.cashId || 'cash'];
    var wasGrit = R.stats.grit, wasInv = R.inventory.join(',');
    R = HW.normalizeRun(HW.cloneRun(R));
    reloaded = true;
    if (current(R).join(' | ') !== wasNow) violations.push('turn 40: a save lost or changed a current fact');
    if (R.stats[R.cashId || 'cash'] !== wasCash) violations.push('turn 40: a save changed the purse');
    if (R.stats.grit !== wasGrit) violations.push('turn 40: a save changed a stat');
    if (R.inventory.join(',') !== wasInv) violations.push('turn 40: a save changed what is carried');
  }

  /* the four invariants that "drift" actually means, checked on every turn */
  var built = briefing(R, 'turn ' + t);
  var block = memBlockOf(built.system);
  HW.currentFacts(R).forEach(function (f) {
    if (block.indexOf(f.text) === -1) violations.push('turn ' + t + ': a current fact is missing from the briefing: ' + f.text);
  });
  HW.pastFacts(R).forEach(function (f) {
    if (built.system.indexOf(f.text) !== -1) violations.push('turn ' + t + ': a SUPERSEDED fact is in the briefing: ' + f.text);
  });
  var purseWant = cash0 + sumDeltas(t, 'cash');
  if (R.stats[R.cashId || 'cash'] !== purseWant) {
    violations.push('turn ' + t + ': the purse is ' + R.stats[R.cashId || 'cash'] + ', the logged deltas say ' + purseWant);
  }
  if (R.inventory.slice().sort().join(',') !== itemsTo(t).sort().join(',')) {
    violations.push('turn ' + t + ': carrying is [' + R.inventory.join(', ') + '] but the tags say [' + itemsTo(t).join(', ') + ']');
  }
  minGrit = Math.min(minGrit, R.stats.grit);
  if (R.stats.grit < minGrit) gritRegressed++;
  factHistory.push({ turn: t, now: HW.currentFacts(R).length, past: HW.pastFacts(R).length });
}

console.log('\n1 — 60 turns, and nothing drifted on the way');
eq('the whole campaign ran', R.turn, 60);
eq('no turn broke an invariant', violations.length, 0);
if (violations.length) console.log('       ' + violations.slice(0, 6).join('\n       '));
eq('the level never went backwards after the turn it was earned', grit0 + sumDeltas(60, 'stat'), R.stats.grit);
eq('…and it never regressed at any point', gritRegressed, 0);
eq('the purse moved only by logged deltas', cash0 + sumDeltas(60, 'cash'), R.stats[R.cashId || 'cash']);
ok('the ledger refused exactly the one illegal tag, and said which',
  R.rejections.length === 1 && /minutes/.test(R.rejections[0].reason), JSON.stringify(R.rejections));

console.log('\n2 — extract (turn 20): a name said once, at turn 8');
var at20 = factHistory.filter(function (h) { return h.turn === 20; })[0];
ok('it was on the record by turn 20', at20 && at20.now >= 2, JSON.stringify(at20));
ok('…and the briefing the referee was shown carried it',
  (function () {
    var probe = HW.buildPrompt(WORLD, R, 'Who tends the lamps here?');
    return memBlockOf(probe.system).indexOf('Verrin') !== -1;
  })(), 'no Verrin in the block');
ok('…while the memory pass that recorded it ran on the cadence, not every turn',
  R.memory.memTurn % EVERY === 0, 'memTurn ' + R.memory.memTurn);

console.log('\n3 — combine (turn 40): two facts from different turns, in one briefing');
var b40 = memBlockOf(briefing(R, 'The ford, the lantern, the bell.').system);
ok('the lantern is in the record and in the sheet it came from',
  R.inventory.indexOf('Brass lantern') !== -1 && b40.indexOf('brass lantern') !== -1, b40);
ok('…and the fact about halfway with the bell is there at the same time',
  /halfway to the temple/.test(b40), b40);
ok('…so a combine question has both halves to combine',
  /lit at the ford/.test(b40) && /halfway/.test(b40), b40);

console.log('\n4 — temporal: the date on a fact means something');
var debt = HW.factObjects(R).filter(function (f) { return /stands open/.test(f.text); })[0];
var paid = HW.currentFacts(R).filter(function (f) { return /is paid/.test(f.text); })[0];
ok('the retired debt fact keeps the turn it stopped being true',
  debt && debt.to !== null && debt.to > 0, JSON.stringify(debt));
ok('…and the current one is later than that', paid && paid.from > debt.to,
  JSON.stringify({ paid: paid && paid.from, open: debt && debt.to }));
ok('…the block labels its bracket as the turn last relied on, which is what the number is',
  /last relied on/.test(briefing(R, 'x').system), 'the legend still says "learned on"');

console.log('\n5 — update (turn 60): the debt is repaid, and the old value is gone from the prompt');
eq('exactly one fact about the debt is current', HW.currentFacts(R).filter(function (f) {
  return /debt/.test(f.text);
}).length, 1);
ok('…and it is the repaid one', (HW.currentFacts(R).filter(function (f) {
  return /debt/.test(f.text);
})[0].text || '').indexOf('is paid') !== -1, JSON.stringify(current(R)));
ok('…the superseded wording is nowhere in the briefing',
  memBlockOf(briefing(R, 'Where do we stand with Verrin?').system).indexOf('stands open') === -1,
  memBlockOf(briefing(R, 'x').system));
ok('…but the record still holds it, because nothing is deleted', !!debt, JSON.stringify(HW.pastFacts(R)));

console.log('\n6 — abstain: what was never established stays out');
ok('no fact mentions a ferry-toll, because none was ever said',
  HW.factObjects(R).every(function (f) { return !/ferry-toll/.test(f.text); }),
  JSON.stringify(current(R)));
ok('…and the briefing invents none', briefing(R, 'What is the ferry-toll for a horse?').system.indexOf('ferry-toll') === -1, '');
ok('a companion who parted at turn 26 is not listed as present at 60',
  companionsLine(briefing(R, 'x').system).indexOf('Bren') === -1 &&
  !R.companions.some(function (c) { return c.name === 'Bren'; }),
  companionsLine(briefing(R, 'x').system));
ok('…while one who never left still is',
  companionsLine(briefing(R, 'x').system).indexOf('Maren') !== -1, companionsLine(briefing(R, 'x').system));
ok('…and what was learned at 30, after Bren went, is only on the player\'s record',
  HW.currentFacts(R).some(function (f) { return /third stone/.test(f.text); }) &&
  R.memory.facts.every(function (f) { return !/Bren knows/.test((f && f.text) || ''); }),
  'the record should not claim Bren witnessed it');

console.log('\n7 — the task: open, advanced, completed, and never reopened');
var q = R.quests[0];
ok('the quest is done', q && q.done === true, JSON.stringify(R.quests));
ok('…and no open task is left behind', R.quests.every(function (x) { return x.done; }), JSON.stringify(R.quests));

console.log('\n8 — the counters the research asked to be visible (§7)');
var cntRun = briefing(R, 'the lantern is lit at the ford');
var cnt = HW.sessionCounters(WORLD, R, cntRun);
eq('the run says how many facts are in memory now', cnt.facts, HW.currentFacts(R).length);
eq('…how many are superseded', cnt.superseded, HW.pastFacts(R).length);
ok('…and that both numbers are real, not zeros', cnt.facts > 3 && cnt.superseded >= 1, JSON.stringify(cnt));
eq('…the turn the world refused something, counted once per refusal', cnt.rejections, 1);
ok('…and the refusals still shown in the HUD are named by the same count',
  cnt.rejectionsShown === cnt.rejections, JSON.stringify({ shown: cnt.rejectionsShown, total: cnt.rejections }));
ok('the last turn\'s cost is split into what an author could change',
  cnt.costs.state > 0 && cnt.costs.memory > 0 && cnt.costs.history > 0 && cnt.costs.total > 0,
  JSON.stringify(cnt.costs));
eq('…and the buckets add up to the system prompt, not past it',
  cnt.costs.state + cnt.costs.memory + cnt.costs.lore + cnt.costs.other, cnt.costs.total);
ok('lore is its own bucket when a chapter fired', cnt.costs.lore > 0, JSON.stringify(cnt.costs));
ok('…and it is the world chapter the input touched, not a guess',
  /Established lore[\s\S]*carried unlit/.test(cntRun.system), JSON.stringify(cnt.costs));
ok('…while a turn that says nothing about it spends nothing there',
  HW.sessionCounters(WORLD, R, briefing(R, 'the quay is empty tonight')).costs.lore === 0 ||
  /lantern|ford/.test('the quay is empty tonight'), '');

console.log('\n9 — the counters reach the screen, and cost nothing when there is nothing to say');
var hud = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
ok('the world HUD renders them', /HW\.sessionCounters\(world, run\)/.test(hud) && /wr-counters/.test(hud), '');
ok('…through the engine, not a second calculation in the view',
  (hud.match(/HW\.sessionCounters\(/g) || []).length === 1 &&
  !/factObjects\(run\)|currentFacts\(run\)/.test(hud.slice(hud.indexOf('wr-counters') - 2200, hud.indexOf('wr-counters') + 400)),
  'calls: ' + (hud.match(/HW\.sessionCounters\(/g) || []).length);
var blank = HW.sessionCounters(WORLD, HW.normalizeRun(HW.start(worldDef())), null);
ok('a run that has never been played reports zeros rather than throwing',
  blank.facts === 0 && blank.superseded === 0 && blank.costs.total === 0 && blank.rejections === 0,
  JSON.stringify(blank));
var noBuild = HW.sessionCounters(WORLD, R);
ok('…and the same counters work without a built prompt (the HUD has no prompt in hand)',
  noBuild.facts === cnt.facts && noBuild.costs.total === 0, JSON.stringify(noBuild.costs));

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
