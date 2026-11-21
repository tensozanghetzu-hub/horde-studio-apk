/* v1.39.99: the NOW anchor — the run's state restated immediately before
 * the newest turn.
 *
 * The briefing lives at the top of the system prompt. On a long run the
 * transcript sits between it and the player's words, and the middle of a
 * long context is where recall is weakest, so the numbers a run is
 * supposed to be honouring were the ones easiest to lose. These checks pin
 * the block's position, its contents, its terseness and its absence when
 * there is nothing true to say.
 *
 * Generic: a toy world built here, no character card, no authored world.
 *
 *   node /home/user/tests/nowbrief-test.js
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

/* A minimal world: two rooms, one wall clock, one sheet stat that matters,
 * a purse, a known item, a known task, one person who stands in the hall. */
function toyWorld(over) {
  var w = {
    _format: 'horde-world', name: 'The Lamplighters', ledgerV2: true,
    startLocationId: 'hall',
    locations: [
      { id: 'hall', name: 'The Hall', exits: [{ to: 'yard', label: 'the yard', minutes: 2 }] },
      { id: 'yard', name: 'The Yard' }
    ],
    entities: [{ id: 'npc_caretaker', name: 'Corin Vale', type: 'npc', homeLocation: 'hall' }],
    hudConfig: {
      stats: [{ id: 'vigour', name: 'Vigour', value: 10, max: 12 }],
      timeStep: 5
    },
    gameRules: {
      currencyStatId: 'cash', currencyName: 'coin', statBound: 3,
      modules: { health: true }, vitalStatId: 'vigour'
    },
    items: [{ id: 'lamp', name: 'Brass Lamp' }],
    startingQuests: ['Bring the lamp to the yard']
  };
  Object.keys(over || {}).forEach(function (k) { w[k] = over[k]; });
  return HW.parse(w);
}

console.log('\nthe anchor exists, at the end of the turn');

var world = toyWorld();
ok('the toy world parses', !!world, 'parse returned null');
var run = HW.start(world);
var built = HW.buildPrompt(world, run, 'I look around.');
ok('buildPrompt hands back a note', !!built.note, JSON.stringify(built.note || ''));
ok('the note names where things stand', /Where things stand right now/.test(built.note));
ok('the note says what to do with it', /not from an earlier moment/.test(built.note));
ok('the player\'s line is still the last message',
  built.messages[built.messages.length - 1].content === 'I look around.');
ok('the anchor is not a system message competing with the briefing',
  built.messages[built.messages.length - 1].role === 'user');

console.log('\nit carries the state, from the run, not from a template');

ok('the place', built.note.indexOf('The Hall') !== -1, built.note);
ok('the person standing there', built.note.indexOf('Corin Vale') !== -1, built.note);
ok('the vital number with its ceiling', /Vigour 10\/12/.test(built.note), built.note);
ok('the purse, named the way the world names it', /Money: 0 coin/.test(built.note), built.note);
ok('the open task, in the world\'s own words',
  built.note.indexOf('Bring the lamp to the yard') !== -1, built.note);
ok('the hour', /\d{1,2}:\d{2}/.test(built.note), built.note);

console.log('\nit follows the run as the run changes');

run.stats.cash = 27;
run.quests[0].done = true;
run.quests.push({ text: 'Pay the ferryman', done: false });
run.companions = [{ id: 'npc_caretaker', name: 'Corin Vale', since: 1 }];
var moved = HW.buildPrompt(world, run, 'I go out.').note;
ok('the purse is the current one', /Money: 27 coin/.test(moved), moved);
ok('a finished task is no longer open', moved.indexOf('Bring the lamp to the yard') === -1, moved);
ok('the next task is', moved.indexOf('Pay the ferryman') !== -1, moved);
ok('a traveller with the player is named once, as a companion',
  moved.split('Corin Vale').length - 1 === 1, moved);

console.log('\nit is a reminder, not a second briefing');

ok('no stat dump - the sheet above already has it', moved.indexOf('Stats:') === -1, moved);
ok('no carrying list', moved.indexOf('Carrying:') === -1, moved);
ok('no lore, no memory: those have their own slots', moved.indexOf('Established lore') === -1);
ok('short enough to be read', moved.length < 500, moved.length + ' chars');
ok('the anchor itself is five lines at most',
  moved.split('\n').length <= 7, moved.split('\n').length + ' lines');

/* Three open tasks are shown; the rest wait their turn, so a run with a
   long task list cannot turn its own reminder into a briefing. */
var many = HW.start(toyWorld());
for (var q = 0; q < 7; q++) many.quests.push({ text: 'Job number ' + q, done: false });
var manyNote = HW.buildPrompt(world, many, 'x').note;
var openLine = manyNote.split('\n').filter(function (l) { return /^Open:/.test(l); })[0] || '';
eq('never more than three tasks', openLine.split(';').length, 3);

console.log('\nsilence when there is nothing to say');

var bare = HW.parse({
  _format: 'horde-world', name: 'Bare', ledgerV2: true,
  locations: [{ id: 'a', name: 'A' }],
  hudConfig: { showClock: false, stats: [] },
  gameRules: { modules: { quests: false, commerce: false } }
});
var bareRun = HW.start(bare);
var bareNote = HW.buildPrompt(bare, bareRun, 'x').note;
ok('a bare run still says where the player is', bareNote.indexOf('Where: at A') !== -1, bareNote);
ok('...and claims nothing it does not know',
  bareNote.indexOf('Money:') === -1 && bareNote.indexOf('Vital:') === -1 &&
  bareNote.indexOf('Open:') === -1 && bareNote.indexOf('Who is here:') === -1, bareNote);
var noQuests = HW.parse({
  _format: 'horde-world', name: 'NoQuest', ledgerV2: true,
  locations: [{ id: 'a', name: 'A' }],
  hudConfig: { showClock: false, stats: [] },
  gameRules: { modules: { quests: false } }
});
var nqNote = HW.buildPrompt(noQuests, HW.start(noQuests), 'x').note;
ok('a world that opts out of quests is not told about tasks',
  nqNote.indexOf('Open:') === -1, nqNote);

console.log('\nthe key is inert for callers that do not ask for it');

var promptOnly = HW.buildPrompt(world, run, 'x');
ok('the system prompt is unchanged by the anchor',
  promptOnly.system.indexOf('Where things stand right now') === -1);
ok('the anchor does not leak into the transcript',
  promptOnly.messages.every(function (m) { return m.content.indexOf('Where things stand') === -1; }));

console.log('\nthe app passes it to the model as the last thing read');

var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
/* v1.39.101: the anchor rides both passes of a turn - the attempt pass and
   the narration pass - because both are answered by the same referee. */
eq('the turn sends it', (app.match(/finalNote: built\.note \|\| null/g) || []).length, 2);
eq('so does a repaired turn', (app.match(/finalNote: prompt2\.note \|\| null/g) || []).length, 1);

var api = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
var joined = 'Chat history:\\n' + "' + h.join('\\n'),";
/* v1.39.108: the tail turn now carries the style lock as well as the note, so
   the assertion is on the intent - the note is joined after the transcript and
   pushed as the trailing system turn - rather than on one exact expression. */
/* v1.39.111: the style lock reads the one request window, so its argument is
   styleLock(win.messages). Position is what this asserts, not the argument. */
var joinAt = api.indexOf(joined), noteAt = api.indexOf("finalNote || '', styleLock(win.messages), character.name + ':'");
/* v1.40.0: the card's post-history text may now sit in this tail as well, so
   the check is on the shape of the expression - style lock, then optionally the
   card's instructions, then the note - not on two adjacent literals. */
var tailAt = api.indexOf("var tail = [styleLock(win.messages),");
ok('a prompt-format provider joins it after the transcript',
  joinAt !== -1 && noteAt !== -1 && noteAt > joinAt, joinAt + ' / ' + noteAt);
ok('a chat-format provider appends it as a trailing system turn',
  tailAt !== -1 && /if \(tail\) msgs\.push\(\{ role: 'system', content: tail \}\)/.test(api));
ok('...and the note is still part of that tail', /styleLock\(win\.messages\), (tailPost, )?finalNote/.test(api));

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
