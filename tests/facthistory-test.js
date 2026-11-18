/* v1.39.100: facts keep a history.
 *
 * The failure this pins down: a run's memory was one flat list of strings,
 * replaced wholesale on every pass. A fact learned at turn 3 and its
 * replacement at turn 40 sat side by side with no ordering signal, so the
 * model chose between them — which is how a quest objective, a level or a
 * debt "changes back". Now a fact carries an id, the turn it was learned on,
 * the turn it stopped being true, and the id that replaced it. The prompt is
 * shown what is true now; the run keeps the rest.
 *
 * Generic: an invented world built here, no character card, no authored world.
 *
 *   node /home/user/tests/facthistory-test.js
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
    entities: [], hudConfig: { showClock: false, stats: [] },
    gameRules: { modules: { quests: false, commerce: false } }
  });
}
function fresh() {
  var w = world(), r = HW.start(w);
  r.turn = 0;
  return r;
}
/* What the referee is actually shown. */
function memoryBlock(run) {
  var b = HW.buildPrompt(world(), run, 'x').system;
  var i = b.indexOf('Story memory');
  if (i === -1) return '';
  var rest = b.slice(i);
  var cut = rest.search(/\n\n(?:Established lore|Rules:)/);
  return cut === -1 ? rest : rest.slice(0, cut);
}
function current(run) { return HW.currentFacts(run).map(function (f) { return f.text; }); }
function past(run) { return HW.pastFacts(run).map(function (f) { return f.text; }); }

console.log('\na fact has a life');

var r = fresh();
r.turn = 3;
HW.applyMemory(r, { summary: 'They crossed the yard.', facts: ['The gate key hangs in the hall'] });
var f = HW.currentFacts(r)[0];
ok('it has an id', /^f\d+$/.test(f.id), f.id);
eq('it was learned on the turn it arrived', f.from, 3);
eq('it is current', f.to, null);
eq('nothing has replaced it', f.by, null);
ok('the run says when memory was last written', r.memory.memTurn === 3, r.memory.memTurn);

console.log('\nsaying the same thing again changes nothing');

HW.applyMemory(r, { summary: 'They crossed the yard.', facts: ['the gate key hangs in the hall.'] });
eq('no duplicate', HW.factObjects(r).length, 1);
eq('...and the same fact stays', current(r)[0], 'The gate key hangs in the hall');

console.log('\nsaying something different about the same thing supersedes');

r.turn = 40;
HW.applyMemory(r, {
  summary: 'The key was moved.',
  facts: ['The gate key now hangs in the yard, on the nail by the pump']
});
var all = HW.factObjects(r);
eq('both statements are on the record', all.length, 2);
var oldF = all.filter(function (x) { return /hangs in the hall/.test(x.text); })[0];
var newF = all.filter(function (x) { return /by the pump/.test(x.text); })[0];
ok('the old one has stopped being true', oldF.to === 40, JSON.stringify(oldF));
eq('...from the turn that changed it', oldF.to, 40);
eq('...and it names what replaced it', oldF.by, newF.id);
eq('the replacement is current', newF.to, null);
eq('only the current one is offered as true', current(r).length, 1);
ok('...and it is the new one', /by the pump/.test(current(r)[0]));

console.log('\nthe prompt shows what is true now, and only that');

var block = memoryBlock(r);
ok('the old fact is not in the prompt', block.indexOf('hangs in the hall') === -1, block);
ok('the new fact is', block.indexOf('by the pump') !== -1, block);
ok('each fact is dated', /by the pump.*\[40\]/.test(block), block);
ok('the story so far is still there', /Story so far/.test(block));
ok('the ledger still outranks it', /the ledger above outranks/i.test(block));
ok('a superseded fact is nowhere in the block', past(r).length === 1);

console.log('\nnewest first, and no fact is ever silently dropped');

r.turn = 41;
HW.applyMemory(r, { summary: 'They waited.', facts: ['Corin Vale owes the player a lantern'] });
var lines = memoryBlock(r).split('\n').filter(function (l) { return /^- /.test(l); });
eq('two current facts', lines.length, 2);
ok('the newest is first', /owes the player a lantern/.test(lines[0]), lines[0]);
ok('the older follows', /by the pump/.test(lines[1]), lines[1]);

console.log('\nthe model may report a change, but only into a fact that exists');

var r2 = fresh();
r2.turn = 2;
HW.applyMemory(r2, { summary: 's', facts: ['The ferryman has been paid in full', 'The mill is closed for repairs'] });
r2.turn = 9;
HW.applyMemory(r2, {
  summary: 'The mill reopened.',
  facts: [],
  changed: ['The mill is closed for repairs']
});
var mill = HW.factObjects(r2).filter(function (x) { return /mill/.test(x.text); })[0];
eq('the named fact is retired', mill.to, 9);
eq('nothing else was touched', HW.currentFacts(r2).length, 1);
ok('the untouched fact is still the ferryman',
  /ferryman/.test(current(r2)[0]), current(r2)[0]);
ok('a retired fact is kept, not deleted',
  /mill/.test(String((HW.pastFacts(r2)[0] || {}).text || '')), JSON.stringify(HW.pastFacts(r2)));

var r3 = fresh();
r3.turn = 2;
HW.applyMemory(r3, { summary: 's', facts: ['The ferryman has been paid in full'] });
r3.turn = 5;
HW.applyMemory(r3, { summary: 's', facts: [], changed: ['everything is different now'] });
eq('a vague report retires nothing', HW.currentFacts(r3).length, 1);
eq('...and is not itself stored as a fact', HW.factObjects(r3).length, 1);

r3.turn = 6;
HW.applyMemory(r3, { summary: 's', facts: [], changed: ['The ferryman has been paid in full', 'a rumour nobody can place'] });
eq('an exact restatement works too', HW.currentFacts(r3).length, 0);
eq('an unknown report is dropped', HW.factObjects(r3).length, 1);

console.log('\na summary-only pass keeps what is already known');

var r4 = fresh();
r4.turn = 4;
HW.applyMemory(r4, { summary: 's1', facts: ['A lamp is missing'] });
r4.turn = 18;
HW.applyMemory(r4, { summary: 's2', facts: [] });
eq('the facts survive', HW.currentFacts(r4).length, 1);
ok('...and the summary moved on', /s2/.test(r4.memory.summary));

console.log('\nold runs migrate without losing anything');

var legacy = { turn: 12, memory: { summary: 'old', facts: ['A lamp is missing', 'Corin Vale is trusted'] }, memAt: 10 };
var migrated = HW.factObjects(legacy);
eq('both are read', migrated.length, 2);
ok('each gets an id', /^f\d+$/.test(migrated[0].id), migrated[0].id);
eq('each is current', migrated.filter(function (x) { return x.to === null; }).length, 2);
eq('the best date the run still has is used', migrated[0].from, 0);
eq('the prompt accepts them', HW.currentFacts(legacy).length, 2);

console.log('\nthe ceilings retire, they do not delete');

var r5 = fresh();
r5.turn = 1;
var subjects = ['the hall lamp', 'the yard gate', 'the north road', 'the mill wheel', 'the ferry toll',
  'the cellar stairs', 'the watch roster', 'the bell rope', 'the east window', 'the coal shed',
  'the well cover', 'the sign above the door', 'the back stair', 'the ledger cabinet', 'the stable roof',
  'the pump handle', 'the boundary stone', 'the market awning', 'the keeper of keys', 'the winter stores'];
var verbs = ['is mended', 'needs paint', 'was counted twice', 'belongs to the town', 'is watched',
  'is locked at night', 'smells of smoke', 'is missing', 'was promised away', 'is spoken for'];
var many = subjects.map(function (sub, i) { return 'How it stands with ' + sub + ': ' + verbs[i % verbs.length]; });
HW.applyMemory(r5, { summary: 's', facts: many });
eq('twelve are current', HW.currentFacts(r5).length, 12);
ok('the rest are on the record', HW.factObjects(r5).length === 20, HW.factObjects(r5).length + '');
eq('none is lost', HW.factObjects(r5).length, 20);

var r6 = fresh();
r6.turn = 1;
for (var t = 1; t <= 40; t++) {
  r6.turn = t;
  HW.applyMemory(r6, { summary: 's', facts: ['Fact learned at turn ' + t] });
}
ok('a very long run stays bounded', HW.factObjects(r6).length <= 24, HW.factObjects(r6).length + '');
ok('...and still knows what is true now', HW.currentFacts(r6).length >= 1);

console.log('\nwhat is cited stays young');

var r7 = fresh();
r7.turn = 2;
HW.applyMemory(r7, { summary: 's', facts: ['Corin Vale keeps the ledger'] });
r7.turn = 30;
HW.applyMemory(r7, { summary: 's', facts: ['A lamp is missing'] });
memoryBlock(r7);
var cited = HW.currentFacts(r7).filter(function (x) { return /ledger/.test(x.text); })[0];
eq('a fact shown in the prompt is re-dated to now', cited.from, 30);

console.log('\nthe sheet can show the history');

var views = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
ok('the sheet lists what is true', views.indexOf('What the world holds true') !== -1);
ok('the sheet lists what stopped being true', views.indexOf('No longer true') !== -1);
ok('...and says the referee is not shown them', /not shown these as current/.test(views));
ok('the sheet reads them from the engine, not from the raw list',
  /HW\.currentFacts\(run\)/.test(views) && /HW\.pastFacts\(run\)/.test(views));

console.log('\nthe summariser is told how to report a change');

var api = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
ok('the world summariser asks for "changed"', /"changed":\["<a fact from the LIST BELOW/.test(api));
ok('...and explains what belongs there', /makes any fact in the LIST BELOW untrue/.test(api));
ok('...and warns against restating on a guess', /Do not change a fact on a guess/.test(api));
ok('the stored facts reach it as text, not as objects',
  /typeof f === 'object'\) \? \(f\.text \|\| ''\) : f/.test(api));
ok('the parser carries the list through', /out\.changed = \(j\.changed \|\| j\.superseded/.test(api));
ok('and starts empty so a missing list is not "undefined"',
  /changed: \[\], ok: false, reason: ''/.test(api));

console.log('\ndeterministic: the same run gives the same answer every time');

var a1 = memoryBlock(r), a2 = memoryBlock(r);
eq('the same prompt twice', a1, a2);

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
