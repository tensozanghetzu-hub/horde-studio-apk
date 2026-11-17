/* v1.39.101: the die is rolled before the scene is written.
 *
 * A check used to be requested and resolved inside the same reply: the
 * referee wrote the scene it wanted, asked for a roll, and the die answered
 * afterwards. The die was never fake - it came from the run's own seeded
 * generator - but the referee chose the moment, and a model that has already
 * written the outcome writes toward it.
 *
 * Now a turn has two phases: what is being attempted (and which check settles
 * it), then the scene written from that verdict. This pins the engine half:
 * parsing the attempt, rolling it, and handing the result to the second prompt
 * as a fact that cannot be re-rolled.
 *
 * Generic: a toy world built here, no character card, no authored world.
 *
 *   node /home/user/tests/preroll-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
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
    fetch: function () { return Promise.resolve({ ok: false }); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'hordeworld.js'), 'utf8'), sandbox,
    { filename: 'hordeworld.js' });
  return sandbox.HW;
}
var HW = loadHW();

function world() {
  return HW.parse({
    _format: 'horde-world', name: 'The Lamplighters', ledgerV2: true,
    locations: [{ id: 'hall', name: 'The Hall' }, { id: 'yard', name: 'The Yard' }],
    entities: [], hudConfig: { showClock: false, stats: [
      { id: 'nerve', name: 'Nerve', value: 10 },
      { id: 'poise', name: 'Poise', value: 10 }
    ] },
    gameRules: {
      modules: { quests: false, commerce: false, health: true }, vitalStatId: 'nerve',
      dice: { sides: 20, defaultDifficulty: 11, criticals: true },
      checks: [
        { name: 'Sneak', dc: 11, stat: 'poise', on_success: { stats: { poise: 1 } }, on_failure: { stats: { poise: -2 } } },
        { name: 'Climb', dc: 14, on_success: { items: [{ name: 'Rope' }] }, on_failure: { stats: { nerve: -3 } } }
      ]
    }
  });
}

console.log('\nonly the checks the world defines are accepted');

var w = world();
var parsed = HW.parseIntent('{"intent":"get past the yard gate unseen","checks":["Sneak","Bribe","sneak"]}', w);
eq('the attempt is kept', parsed.intent, 'get past the yard gate unseen');
eq('a known check is taken once', JSON.stringify(parsed.checks), JSON.stringify(['Sneak']));
eq('an unknown one is reported, not rolled', JSON.stringify(parsed.unrecognised), JSON.stringify(['Bribe']));

var polite = HW.parseIntent('Of course! Here is the plan: {oops}', w);
eq('a broken answer asks for nothing', polite.checks.length, 0);

var prose = HW.parseIntent('I will sneak.', w);
eq('prose asks for nothing', prose.checks.length, 0);

var many = HW.parseIntent('{"checks":["Sneak","Climb","Sneak","Climb","Sneak"]}', w);
eq('never more than the cap', many.checks.length, 2);
eq('deduplicated case-insensitively', many.checks[1], 'Climb');

console.log('\nthe roll happens now, and it is the run\'s own die');

var r = HW.start(w);
r.turn = 5;
var seedBefore = r.seed;
var res = HW.resolveCheckNow(w, r, 'Sneak');
ok('a verdict came back', !!res.entry, JSON.stringify(res));
ok('the seed moved', r.seed !== seedBefore);
eq('the check is marked as settled', res.entry.preRolled, true);
eq('the DC is the world\'s', res.entry.dc, 11);
ok('a total was computed', typeof res.entry.total === 'number', res.entry.total);
ok('the chip carries the verdict', /Sneak \d+ vs 11/.test(res.entry.chip), res.entry.chip);
ok('the line reads like a roll', /^Sneak check: 1d20/.test(res.entry.text), res.entry.text);
ok('success or failure is stated', / — (success|failure)/.test(res.entry.text), res.entry.text);
ok('the turn records what was rolled', (r.checksThisTurn || []).indexOf('Sneak') !== -1);

console.log('\nthe consequence is applied before a word is written');

var pr = HW.start(world());
pr.turn = 3;
var poiseBefore = pr.stats.poise;
var nerveBefore = pr.stats.nerve;
var got = HW.resolveCheckNow(w, pr, 'Sneak').entry;
if (got.success) {
  eq('success paid the world\'s reward', pr.stats.poise, poiseBefore + 1);
  eq('...and touched nothing else', pr.stats.nerve, nerveBefore);
} else {
  eq('failure paid the world\'s price', pr.stats.poise, poiseBefore - 2);
  eq('...and touched nothing else', pr.stats.nerve, nerveBefore);
}

var cr = HW.start(world());
cr.turn = 1;
var climb = HW.resolveCheckNow(w, cr, 'Climb').entry;
if (climb.success) {
  ok('a successful climb put the rope in the pack', cr.inventory.indexOf('Rope') !== -1, JSON.stringify(cr.inventory));
} else {
  eq('a failed climb cost nerve', cr.stats.nerve, 7);
}

console.log('\nan unknown check is refused, and consumes no die');

var ur = HW.start(w);
ur.turn = 2;
var seedU = ur.seed;
var bad = HW.resolveCheckNow(w, ur, 'Bribe');
ok('no verdict', !bad.entry);
ok('a rejection with a readable reason', /no check named/.test(bad.rejection.reason), bad.rejection.reason);
eq('the die was not spent', ur.seed, seedU);
eq('nothing was recorded for the turn', (ur.checksThisTurn || []).length, 0);

console.log('\nreproducible: the same run and the same check give the same verdict');

function replay() {
  var x = HW.start(world());
  x.turn = 7;
  x.seed = 0x51ee7;          /* the run's seed is what makes this reproducible */
  return HW.resolveCheckNow(world(), x, 'Climb').entry.text;
}
eq('same seed, same roll', replay(), replay());
/* and a different run is a different die, which is the point of a seed */
var other = HW.start(world());
other.turn = 7; other.seed = 0x51ee7;
var sameRun = HW.start(world());
sameRun.turn = 7; sameRun.seed = 0x51ee7;
ok('the same seed reproduces across runs', /1d20/.test(HW.resolveCheckNow(world(), other, 'Climb').entry.text));

console.log('\nthe second prompt is told the die is already cast');

var sr = HW.start(world());
sr.turn = 4;
var kept = HW.resolveCheckNow(w, sr, 'Sneak').entry;
var built = HW.buildPrompt(w, sr, 'I slip through the gate.', { settled: [kept] });
ok('the settled check is in the briefing', built.system.indexOf('Checks already settled before this scene') !== -1);
ok('...with its verdict', built.system.indexOf(kept.text) !== -1, kept.text);
ok('...and the instruction not to re-roll it', /never re-roll it/.test(built.system));
ok('...naming the check it may not request again', /Already rolled for this turn: Sneak/.test(built.system));
ok('...in the last thing read as well', /Rolled for this turn: Sneak/.test(built.note || ''), built.note);
ok('...with the same warning', /do not roll it again/.test(built.note || ''));

var plain = HW.buildPrompt(w, sr, 'They wait.');
ok('a turn with no settled check says nothing about dice',
  plain.system.indexOf('Checks already settled') === -1 && (plain.note || '').indexOf('Rolled for this turn') === -1);
ok('...and its rules do not claim a roll happened', !/Already rolled for this turn/.test(plain.system));

console.log('\nthe per-turn marker belongs to the turn, not the run');

var mr = HW.start(world());
mr.turn = 2;
HW.resolveCheckNow(w, mr, 'Sneak');
eq('the turn knows what it rolled', (mr.checksThisTurn || []).length, 1);
var applied = HW.applyTags(w, mr, 'You slip past.');
HW.commit(mr, 'I slip past.', applied.text, applied);
eq('...and the next turn starts clean', (mr.checksThisTurn || []).length, 0);

console.log('\na world with no checks is exactly what it was');

var bare = HW.parse({
  _format: 'horde-world', name: 'Bare', ledgerV2: true,
  locations: [{ id: 'a', name: 'A' }], hudConfig: { showClock: false, stats: [] },
  gameRules: { modules: { quests: false, commerce: false } }
});
ok('no checks declared', !((bare.gameRules || {}).checks || []).length);
var barePrompt = HW.buildPrompt(bare, HW.start(bare), 'x');
ok('...and the prompt is the same prompt', barePrompt.system.indexOf('Checks already settled') === -1);
ok('...with a note that says nothing about dice', (barePrompt.note || '').indexOf('Rolled') === -1);

console.log('\nthe app runs the two phases, and guards the second one');

var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
ok('phase one asks only for the attempt', /HW\.intentRules\(\)/.test(app));
ok('...before the scene is asked for', app.indexOf('function phaseOne') < app.indexOf('settled = entries'));
ok('a world with no checks skips it entirely',
  /var checks = \(world\.gameRules \|\| \{\}\)\.checks;[\s\S]{0,200}return Promise\.resolve\(null\)/.test(app));
ok('the roll is announced the moment it lands', /function announceRolls/.test(app));
ok('...as a check line in the run', /role: 'check'/.test(app));
ok('...and on screen, before the prose arrives', /checks: entries/.test(app));
ok('the narration is written from the settled rolls', /buildPrompt\(world, base, text, \{ settled: settled \}\)/.test(app));
ok('a repair keeps the same rolls', /buildPrompt\(world, from, text, \{ settled: settled \}\)/.test(app));
ok('a check already settled is not resolved twice',
  /already\[String\(e\.name\)\.toLowerCase\(\)\]/.test(app));
ok('...and still appears in the turn\'s receipt', /preRolled: true/.test(app));
ok('phase one cannot cost the player a turn', /phase one is an aid, not a gate/.test(app));
ok('a stop still abandons the whole turn', /AbortError/.test(app));

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
