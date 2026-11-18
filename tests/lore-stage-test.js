/* v1.39.110: a staged entry that is dark, and why.
 *
 * Reported as a general finding, not a card problem: a stage-gated lorebook is
 * invisible in every chat whose stage is blank - and blank is the default. The
 * author sets up staging, tests in an ordinary chat, sees "3 of 28 in the
 * prompt" with every row disagreeing, and concludes the lorebook is broken.
 *
 * The engine was already excluding those entries correctly. What was missing
 * was the app SAYING so: the Lore screen counted them as "wrong stage" among
 * everything else, and never mentioned that no stage was set.
 *
 * Also pinned here: the Lore screen had its own copies of the ceilings and
 * kept reporting 6 / 1536 after the prompt moved to 10 / 5000, so it claimed
 * entries were over budget that the request was happily carrying.
 *
 * Generic: invented entries, no card content.
 *
 *   node /home/user/tests/lore-stage-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}
function eq(label, got, want) { ok(label, got === want, JSON.stringify(got) + ' vs ' + JSON.stringify(want)); }

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  TextEncoder: TextEncoder, TextDecoder: TextDecoder
};
sb.window = sb; sb.global = sb;
sb.fetch = function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });
var API = sb.API;
var viewsSrc = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');

function E(keys, content, stage) {
  return { keys: keys, content: content, enabled: true, stage: stage || '', constant: false };
}
var SAMPLE = API.loreSample([
  { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' },
  { role: 'user', text: 'c' }, { role: 'assistant', text: 'the gate is shut' }
]);
var BOOK = [
  E(['gate'], 'ACT ONE: the gate is sealed.', 'act one'),
  E(['gate'], 'ACT TWO: the gate stands open.', 'act two'),
  E(['gate'], 'UNSTAGED: a gate exists.')
];

console.log('\nblank stage hides a staged book — and says so');

var blank = API.loreDiagnostics(BOOK, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, '');
eq('the unstaged entry is the only one admitted', blank.admitted, 1);
eq('two entries are dark for stage reasons', blank.stageSkipped, 2);
eq('the readout knows the chat has no stage', blank.stageBlank, true);
eq('...and knows both were dark because of that', blank.stageDarkWithoutStage, 2);
ok('a blank-stage row does not say "wrong stage"',
  blank.rows.filter(function (r) { return r.stageDark; }).every(function (r) { return !/^wrong stage/.test(r.reason); }),
  blank.rows[0].reason);
ok('...it says no stage is set', /no stage set/.test(blank.rows[0].reason), blank.rows[0].reason);
ok('...and names the stage the entry needs', /act one/.test(blank.rows[0].reason), blank.rows[0].reason);

console.log('\na matching stage');

var match = API.loreDiagnostics(BOOK, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, 'act two');
eq('the matching entry and the unstaged one are admitted', match.admitted, 2);
eq('one entry is still dark', match.stageSkipped, 1);
eq('the chat is not blank', match.stageBlank, false);
eq('none are dark for want of a stage', match.stageDarkWithoutStage, 0);
ok('the other act is reported as a wrong stage, not a missing one',
  /wrong stage/.test(match.rows[0].reason) && /act two/.test(match.rows[0].reason), match.rows[0].reason);
ok('...and does not claim no stage is set', !/no stage set/.test(match.rows[0].reason));

console.log('\na different stage');

var other = API.loreDiagnostics(BOOK, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, 'act three');
eq('two entries are dark', other.stageSkipped, 2);
eq('...but none for want of a stage', other.stageDarkWithoutStage, 0);
eq('the unstaged entry still fires', other.admitted, 1);

console.log('\nnothing staged means nothing to report');

var plain = [E(['gate'], 'A gate.'), E(['door'], 'A door.')];
var p = API.loreDiagnostics(plain, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, '');
eq('no stage-skips on an unstaged book', p.stageSkipped, 0);
eq('...and no blank-stage warning', p.stageDarkWithoutStage, 0);
eq('...even though the chat is blank', p.stageBlank, true);

console.log('\nthe Lore screen reports it');

ok('the screen reads the ceilings from the engine',
  /API\.loreDiagnostics\(c\.lorebook \|\| \[\], sample, API\.LORE_LIMIT, API\.LORE_BUDGET, stage\)/.test(viewsSrc));
ok('...and no longer carries its own copies', !/loreDiagnostics\(c\.lorebook \|\| \[\], sample, 6, 1536/.test(viewsSrc));
ok('it reports entries hidden by staging', /diag\.stageSkipped/.test(viewsSrc));
ok('it distinguishes a blank stage from a wrong one', /diag\.stageBlank/.test(viewsSrc));
ok('...and tells the author what to do about it',
  /open Chat continuity/i.test(viewsSrc) && /clear the stage/i.test(viewsSrc));
ok('a wrong stage names the chat’s own stage', /this chat is in <b>/.test(viewsSrc) || /diag\.stage/.test(viewsSrc));

console.log('\nthe screen and the prompt agree');

/* The regression this pins: the screen used 6/1536 while the prompt used
   10/5000, so it described a selection the request never made. */
var many = [];
for (var i = 0; i < 20; i++) many.push(E(['gate'], 'entry ' + i + ' ' + 'x'.repeat(300)));
var screenDecision = API.loreDiagnostics(many, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, '');
var promptDecision = API._loreHits(many, SAMPLE, API.LORE_LIMIT, API.LORE_BUDGET, '');
eq('the diagnostic admits the same number as the prompt', screenDecision.admitted, promptDecision.length);
ok('the old ceilings would have disagreed', (function () {
  var old = API.loreDiagnostics(many, SAMPLE, 6, 1536, '');
  return old.admitted !== screenDecision.admitted;
})(), 'if this fails the fixtures no longer separate the two ceilings');

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
