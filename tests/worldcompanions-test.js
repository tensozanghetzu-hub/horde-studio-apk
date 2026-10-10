/* v1.24.0 - the companion ledger (option C).
 *
 * A world run tracks which NPCs travel WITH the player. The referee records
 * it with tags: [[with:NAME]] when an NPC joins, [[part:NAME]] when they
 * part. The ledger validates names against the world's cast (one name per
 * tag, comma lists split), caps the party, and the prompt then tells the
 * model who is with the player and what they have witnessed - so two men
 * who went to the elder with you cannot both come home and ask what the
 * elder said.
 *
 *   node /home/user/tests/worldcompanions-test.js
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
var HW = sandbox.HW;

var world = HW.parse(WORLD);
function freshRun() {
  var run = HW.start(world, null);
  run.turn = 7;
  return run;
}

console.log('\njoining and leaving');

var run = freshRun();
var r1 = HW.applyTags(world, run, 'The men fall in step behind you. [[with:Denton Pike]] [[with:Eli Finch]]');
ok('two companions join', (run.companions || []).length === 2, JSON.stringify(run.companions));
ok('joined with the canonical name', (run.companions || [{}])[0].name === 'Denton Pike', JSON.stringify(run.companions));
ok('joined at the current place, on this turn',
  (run.companions || [{}])[0].at === run.locationId && (run.companions || [{}])[0].since === 7,
  JSON.stringify(run.companions));
ok('the HUD gets a human change line', r1.changes.join(' | ').indexOf('Denton Pike joins the party') !== -1, JSON.stringify(r1.changes));
ok('no rejections for a clean join', r1.rejections.length === 0, JSON.stringify(r1.rejections));

var r2 = HW.applyTags(world, run, 'You part ways at the gate. [[part:Denton Pike]]');
ok('a companion leaves', (run.companions || []).length === 1 && run.companions[0].name === 'Eli Finch', JSON.stringify(run.companions));
ok('the HUD says who left', r2.changes.join(' | ').indexOf('Denton Pike leaves the party') !== -1, JSON.stringify(r2.changes));

console.log('\nthe ledger keeps the party honest');

var run2 = freshRun();
var r3 = HW.applyTags(world, run2, '[[with:Bob the Stranger]]');
ok('an unknown name is refused', (run2.companions || []).length === 0, JSON.stringify(run2.companions));
ok('…with a reason that names the cast',
  r3.rejections.length === 1 && /no one named/i.test(r3.rejections[0].reason) && /Gloria Bell/.test(r3.rejections[0].reason),
  JSON.stringify(r3.rejections));

var r4 = HW.applyTags(world, run2, '[[with:Gloria Bell]] [[with:Gloria Bell]]');
ok('a double-join is refused, once', (run2.companions || []).length === 1, JSON.stringify(run2.companions));
ok('…as a rejection, not a silent no-op', r4.rejections.length === 1 && /already with/i.test(r4.rejections[0].reason), JSON.stringify(r4.rejections));

var run3 = freshRun();
var r5 = HW.applyTags(world, run3, '[[part:Wade Greeley]]');
ok('parting with someone who is not along is refused', (run3.companions || []).length === 0 && r5.rejections.length === 1,
  JSON.stringify(r5.rejections));

/* comma lists: one tag, several names */
var run4 = freshRun();
var r6 = HW.applyTags(world, run4, '[[with:Mara Voss, Prudence Kettle]]');
ok('a comma list joins everyone named', (run4.companions || []).length === 2, JSON.stringify(run4.companions));

/* the party has a cap */
var run5 = freshRun();
var cast = world.entities.filter(function (e) { return !e.type || e.type === 'npc'; });
for (var i = 0; i < 6; i++) HW.applyTags(world, run5, '[[with:' + cast[i].name + ']]');
var r7 = HW.applyTags(world, run5, '[[with:' + cast[6].name + ']]');
ok('the party caps at six', (run5.companions || []).length === 6, (run5.companions || []).length);
ok('the seventh is refused with a reason', r7.rejections.length === 1 && /full/i.test(r7.rejections[0].reason), JSON.stringify(r7.rejections));

/* names as the model wrote them: case-insensitive */
var run6 = freshRun();
HW.applyTags(world, run6, '[[with:gloria bell]]');
ok('name matching is case-insensitive, stored canonically',
  (run6.companions || []).length === 1 && run6.companions[0].name === 'Gloria Bell', JSON.stringify(run6.companions));

console.log('\nthe referee prompt');

var run7 = freshRun();
HW.applyTags(world, run7, '[[with:Denton Pike, Eli Finch]]');
run7.log.push({ role: 'user', content: 'we go to the elder together', at: Date.now() });
var p = HW.buildPrompt(world, run7, 'what now?');
ok('the prompt lists the companions', /Companions/i.test(p.system) && p.system.indexOf('Denton Pike') !== -1 && p.system.indexOf('Eli Finch') !== -1, p.system.slice(0, 400));
ok('the prompt states what they have witnessed', /witnessed every scene since/i.test(p.system), p.system.slice(0, 600));
ok('the prompt bars the redundant question', /at most one/i.test(p.system) || /ask about/i.test(p.system), p.system.slice(0, 600));

var run8 = freshRun();
var p2 = HW.buildPrompt(world, run8, 'what now?');
ok('no companion section when the party is empty', p2.system.indexOf('Companions -') === -1, p2.system.slice(0, 300));

ok('the rules teach the grammar', /with:NAME/.test(p2.system) && /part:NAME/.test(p2.system), p2.system.slice(0, 800));

console.log('\ntags still coexist, old runs still work');

var run9 = freshRun();
delete run9.companions; /* a run saved before this feature */
var loc = 'loc_bullpen'; /* a real one-move neighbor of the opening place */
var r9 = HW.applyTags(world, run9, 'You head out together. [[move:' + loc + ']] [[clock:+10]] [[with:Nisha Patel]]');
ok('move + clock + companion in one reply', run9.locationId === loc && r9.changes.length === 3 && (run9.companions || []).length === 1,
  JSON.stringify({ loc: run9.locationId, changes: r9.changes, comps: run9.companions }));

var run10 = freshRun();
var r10 = HW.applyTags(world, run10, 'A tag nobody knows: [[frob:stuff]] and prose.');
ok('unknown tags stay visible (unchanged rule)', r10.text.indexOf('[[frob:stuff]]') !== -1, r10.text);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
