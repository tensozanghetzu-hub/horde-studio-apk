/* v1.45.0 display scripts: a rule can change what the screen shows and nothing else.
 *
 * The engine lives in api.js and is called from exactly one place in views.js. That
 * boundary is the whole design: a prompt-affecting script stage can quietly rewrite
 * the story, and a user cannot undo that by turning a switch off. So these tests
 * pin three things - that the rules do what they say, that a rule which would hang
 * the screen is refused by shape rather than by stopwatch, and that the stored text,
 * the assembled prompt, the transcript export and the read-aloud path never see them.
 *
 * Generic: invented patterns, no character card.
 *
 *   node /home/user/tests/regex-scripts-test.js
 */
'use strict';

var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function read(f) { return fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'); }

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  document: { addEventListener: function () {} },
  navigator: { userAgent: 'node' },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Store: { settings: {}, characters: [], personas: [] }
};
sb.window = sb; sb.global = sb;
vm.runInNewContext(read('api.js'), sb, { filename: 'api.js' });
var API = sb.API;

/* the patterns are what a person would actually type in the Find box */
function S(list, on) {
  return { regexOn: on === undefined ? true : on, regexScripts: list };
}
function rule(pattern, replacement, flags, enabled) {
  var o = { id: 'r', name: 'test', pattern: pattern, replacement: replacement, flags: flags || 'gi' };
  if (enabled === false) o.enabled = false;
  return o;
}

console.log('\nA — what runs, and in what order');

eq('master switch off: nothing is touched',
  API.applyDisplayScripts('Hi *there*', S([rule('\\*([^*]+)\\*', '$1')], false)), 'Hi *there*');
eq('switch on with no rules: unchanged', API.applyDisplayScripts('Hi *there*', S([])), 'Hi *there*');
eq('one rule strips the emphasis',
  API.applyDisplayScripts('Hi *there* friend', S([rule('\\*([^*]+)\\*', '$1')])), 'Hi there friend');
eq('order is honoured: the second rule sees the first one’s output',
  API.applyDisplayScripts('a *b* c', S([rule('\\*([^*]+)\\*', '[$1]'), rule('\\[(b)\\]', '($1)')])), 'a (b) c');
eq('a disabled rule is skipped',
  API.applyDisplayScripts('a *b* c', S([rule('\\*([^*]+)\\*', '$1', 'gi', false)])), 'a *b* c');
eq('a rule with an empty pattern is skipped', API.applyDisplayScripts('abc', S([rule('', 'x')])), 'abc');
eq('a pattern that will not compile is skipped, not fatal',
  API.applyDisplayScripts('keep (me', S([rule('(', 'x'), rule('keep', 'KEEP')])), 'KEEP (me');
eq('i is honoured', API.applyDisplayScripts('Said ALICE loudly', S([rule('alice', 'bo')])), 'Said bo loudly');
eq('g is on even when the user leaves it out', API.applyDisplayScripts('a a a', S([rule('a', 'b', '')])), 'b b b');
eq('nonsense flags are dropped rather than trusted', API.applyDisplayScripts('a a', S([rule('a', 'b', 'z')])), 'b b');
eq('an empty replacement deletes', API.applyDisplayScripts('x  y', S([rule(' {2,}', ' ')])), 'x y');
eq('$& puts the whole match back', API.applyDisplayScripts('cat', S([rule('a', '($&)')])), 'c(a)t');
eq('a numbered group that is not there is left as written, not thrown',
  API.applyDisplayScripts('abc', S([rule('b', '$9')])), 'a$9c');
eq('null text returns a string, not a crash', API.applyDisplayScripts(null, S([rule('a', 'b')])), '');
eq('undefined settings changes nothing', API.applyDisplayScripts('abc', undefined), 'abc');

var big = '*x*'.repeat(20001);
ok('a reply longer than the ceiling is shown raw',
  API.applyDisplayScripts(big, S([rule('\\*x\\*', 'y')])).indexOf('*x*') === 0,
  'length ' + API.applyDisplayScripts(big, S([rule('\\*x\\*', 'y')])).length);
ok('…and the ceiling is the exported number', big.length > API.SCRIPT_MAX_CHARS,
  big.length + ' vs ' + API.SCRIPT_MAX_CHARS);
eq('the switch has to be exactly true, not merely present',
  API.applyDisplayScripts('a *b*', S([rule('\\*([^*]+)\\*', '$1')], 1)), 'a *b*');

console.log('\nB — a rule has to pass a test before it is kept');

var t;
t = API.scriptTest('', '$1', 'gi', 'sample');
ok('an empty pattern is refused, and says why it is dangerous', t.ok === false && /matches everywhere/.test(t.why), t.why);
t = API.scriptTest('(', '', 'gi', 'sample');
ok('an uncompilable pattern is refused', t.ok === false && /regular expression/.test(t.why), t.why);
t = API.scriptTest('(a+)+', 'x', 'gi', 'a'.repeat(40) + 'b');
ok('the exponential shape is refused', t.ok === false && t.evil === true, JSON.stringify(t).slice(0, 80));
t = API.scriptTest('(a*)*b', 'x', 'gi', 'aaaa');
eq('…both spellings of it', !!t.evil, true);
t = API.scriptTest('\\*([^*]+)\\*', '$1', 'gi', 'a *b* c');
ok('the rule everybody actually writes is not refused for its shape', t.ok === true, t.why);
ok('…and the test reports the change it makes', t.ok === true && t.changed === true &&
  t.before.indexOf('*b*') !== -1 && t.after.indexOf('*b*') === -1, JSON.stringify(t).slice(0, 120));
t = API.scriptTest('zebra', 'x', 'gi', 'nothing here');
ok('a rule that matches nothing is accepted with changed:false', t.ok === true && t.changed === false,
  JSON.stringify(t).slice(0, 90));
t = API.scriptTest('(a)', '$<nope>', 'gi', 'aaa');
ok('a named group that is not there is not a crash: the preview shows it as written',
  t.ok === true && t.after.indexOf('$<nope>') === 0, JSON.stringify(t).slice(0, 110));
t = API.scriptTest('a', 'a', 'gi', 'a'.repeat(9000));
ok('the preview is capped, so a sheet cannot be filled with a novel', t.after.length <= 900, t.after.length);
ok('the timing guard is still there, with a real deadline',
  /ms > 500/.test(read('api.js')) && /slow: true/.test(read('api.js')));

console.log('\nC — the slow shape is refused where it is stored, not only in the sheet');

eq('the detector flags a quantified group inside a quantified group', API.scriptLooksEvil('(a+)+'), true);
eq('…flags alternation inside one too', API.scriptLooksEvil('(a+|b)+'), true);
eq('…does not flag a plain group repeat', API.scriptLooksEvil('(a|b)*'), false);
eq('…does not flag a bracket class that merely contains *', API.scriptLooksEvil('\\*([^*]+)\\*'), false);
eq('…does not flag an escaped parenthesis', API.scriptLooksEvil('\\(a\\+\\)\\+'), false);
eq('a saved rule of that shape never reaches the bubble',
  API.applyDisplayScripts('a'.repeat(60) + 'b', S([rule('(a+)+', 'x')])), 'a'.repeat(60) + 'b');

console.log('\nD — the boundary: display only, and off until asked for');

/* the prompt builder must not see the rules, even with the switch on */
var built = API.buildChat(
  { id: 'c1', name: 'Nadia', persona: 'A lighthouse keeper.', greeting: '*She looks up.*' },
  { id: 's1', charId: 'c1', title: 'T', summary: '', facts: [] },
  [{ role: 'user', text: 'a *bold* claim' },
   { role: 'assistant', text: 'Nadia: *She nods.* a *bold* answer' }],
  { userName: 'Quinn', systemPrompt: 'x', maxTokens: 400, regexOn: true,
    regexScripts: [rule('\\*([^*]+)\\*', '$1')] }
);
var wire = built.map(function (m) { return String(m.content); }).join('\n');
ok('the assembled prompt keeps the emphasis a script would strip',
  /\*bold\* claim/.test(wire) && /\*bold\* answer/.test(wire), wire.slice(0, 200));
ok('…and the card’s own words are not scripted either',
  /A lighthouse keeper\./.test(wire), wire.slice(0, 160));

/* store.js, loaded the way genreset loads it: DEFAULTS is private, so the factory
   values are read through the one door the reset uses */
var sb2 = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
  isNaN, parseFloat, parseInt, setTimeout, clearTimeout,
  navigator: { onLine: true },
  document: { addEventListener: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; } },
  IDB: { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); }, all: function () { return Promise.resolve([]); } }
};
sb2.window = sb2; sb2.global = sb2;
vm.runInNewContext(
  'var UI = {}; window.UI = UI;\nvar Views = {}; var API = {};\nSandbox = { issue: function () {} };\n' + read('store.js'),
  sb2, { filename: 'store.js' });
var gdef = sb2.Store.generationDefaults();
eq('the switch is off for a new install and after a generation reset', gdef.regexOn, false);
ok('the rules list is declared in DEFAULTS, so settings always carry an array',
  /regexScripts: \[\]/.test(read('store.js')));
ok('a generation reset does not delete the rules — they are text, not a knob',
  Object.keys(gdef).indexOf('regexScripts') === -1, Object.keys(gdef).join(','));
ok('the reset patch still carries only generation keys',
  Object.keys(gdef).every(function (k) {
    return ['temperature', 'maxTokens', 'topP', 'contextMessages', 'streaming', 'autoFinish',
      'stripThinking', 'bursts', 'sendOnEnter', 'replyFallback', 'reasoningOff', 'regexOn'].indexOf(k) !== -1;
  }), Object.keys(gdef).join(','));

/* where the engine is allowed to be called from */
var apiSrc = read('api.js'), viewsSrc = read('views.js'), appSrc = read('app.js'), storeSrc = read('store.js');
function count(hay, needle) { return hay.split(needle).length - 1; }
eq('api.js has one definition and no other caller', count(apiSrc, 'applyDisplayScripts('), 1);
eq('views.js calls the engine exactly once', count(viewsSrc, 'API.applyDisplayScripts('), 1);
ok('…inside the guarded helper, not inline in the markup',
  /function shownText\(body, s\)/.test(viewsSrc) && /md\(shownText\(body, s\)\)/.test(viewsSrc));
ok('the helper survives a throwing rule by returning the text',
  /catch \(e\) \{ return body; \}/.test(viewsSrc));
eq('app.js never calls it: the export is the model’s own words', count(appSrc, 'applyDisplayScripts('), 0);
eq('store.js never writes one back', count(storeSrc, 'applyDisplayScripts('), 0);
ok('the chat list prints stored text, not styled text',
  viewsSrc.indexOf('applyDisplayScripts') > viewsSrc.indexOf('Views.chats = function') &&
  !/applyDisplayScripts/.test(viewsSrc.slice(0, viewsSrc.indexOf('function shownText'))));
ok('the reply footer counts what the model sent, not what the screen showed',
  /replyFooter\(body, m, s\)/.test(viewsSrc) && !/replyFooter\(shownText/.test(viewsSrc));

console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
