/* v1.39.108: stop the asterisks being generated, not just hidden.
 *
 * Reported: the habit appears in every long chat and gets so dense the replies
 * are unreadable - 55 of 94 replies in one export carried more asterisks than
 * words. Two causes, both in the app:
 *
 *   1. the shipped default system prompt asked for them ("asterisk italics
 *      for thoughts and actions"), which the model reads as its own style;
 *   2. the transcript then teaches them far better than any system message
 *      can forbid them, because each starred reply is fed back as an example.
 *
 * Fix 1 removes the request. Fix 2 puts a plain-prose instruction after the
 * transcript - the last thing read before the reply - and only for chats whose
 * history actually shows the habit. This pins both, and pins that a chat
 * without the habit is not given an instruction it does not need.
 *
 * Generic: no card content, no character names.
 *
 *   node /home/user/tests/style-lock-test.js
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

var storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

function constantOf(name) {
  var i = storeSrc.indexOf('var ' + name + ' = ');
  if (i === -1) return null;
  var j = storeSrc.indexOf(';\n', i);
  var sb = {};
  vm.runInNewContext(storeSrc.slice(i, j + 1) + '\nthis.out = ' + name + ';', sb, {});
  return sb.out;
}

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  TextEncoder: TextEncoder, TextDecoder: TextDecoder
};
sb.window = sb; sb.global = sb;
sb.fetch = function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); };
vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
var API = sb.API;

console.log('\nfix 1 — the default prompt no longer asks for asterisks');

var DEF = constantOf('DEFAULT_SYSTEM');
var OLD = constantOf('LEGACY_SYSTEM');
var STARRED = constantOf('LEGACY_SYSTEM_STARRED');

ok('the default exists', typeof DEF === 'string' && DEF.length > 40);
ok('it does not request asterisk italics', !/asterisk italics/i.test(DEF), DEF.match(/[^.]*asterisk[^.]*/i));
ok('it forbids markers outright', /no asterisks/i.test(DEF));
ok('it names the transcript as the amplifier', /not\s*\n?\s*a style guide/i.test(DEF.replace(/\s+/g, ' ')) ||
  /transcript is not/.test(DEF.replace(/\s+/g, ' ')));
ok('it keeps the dialogue convention', /double quotation marks/.test(DEF));
ok('it keeps the {{char}} anchor', /^You are \{\{char\}\}/.test(DEF));
ok('it keeps the never-speak-for-the-player rule', /Never speak for \{\{user\}\}/.test(DEF));
ok('it keeps the no-commentary rule', /never include reasoning, planning, notes/.test(DEF));
ok('the shipped string contains no stray asterisks', (DEF.match(/\*/g) || []).length === 0,
  (DEF.match(/\*/g) || []).length);

console.log('\nfix 1b — installs holding the old default are upgraded, edits are not');

ok('the starred old default is kept for comparison', /asterisk italics/.test(STARRED || ''));
ok('the pre-format default is kept for comparison', typeof OLD === 'string' && OLD !== DEF);
ok('the migration compares against both', /systemPrompt === LEGACY_SYSTEM \|\| s\.systemPrompt === LEGACY_SYSTEM_STARRED/.test(storeSrc));
ok('...and writes the new default', /s\.systemPrompt = DEFAULT_SYSTEM/.test(storeSrc));
ok('an edited prompt is left alone', (function () {
  var edited = STARRED.replace('immersive', 'emersive');
  return !(edited === OLD || edited === STARRED);
})());

console.log('\nfix 2 — a style lock, after the transcript, only when needed');

ok('the lock exists', typeof API.styleLock === 'function');
eq('a clean chat gets nothing', API.styleLock([
  { role: 'user', text: 'I look around.' },
  { role: 'assistant', text: 'The hall is quiet. "Stay close," she says.' }
]), '');
eq('an empty history gets nothing', API.styleLock([]), '');
eq('a chat where only the player writes markers gets nothing', API.styleLock([
  { role: 'user', text: '*Thought: I should leave.*' },
  { role: 'assistant', text: 'She waits by the door.' }
]), '');

var lock = API.styleLock([
  { role: 'user', text: 'I wait.' },
  { role: 'assistant', text: '*The *hall *is *quiet *and *still *tonight. *Nobody *speaks *for *a *long *moment.' }
]);
ok('a starred history gets the lock', lock.length > 0, lock);
ok('...it asks for plain prose', /plain prose/.test(lock));
ok('...it names asterisks', /no asterisks/.test(lock));
ok('...it forbids the per-word shape', /not on words, not between them/.test(lock));
ok('...it calls the history the habit to break', /habit to break/.test(lock));
ok('...and forbids announcing it', /Do not mention or apologise/.test(lock));
ok('...and it is short', lock.length < 330, lock.length);

console.log('\nfix 2b — it lands where a model actually obeys');

var char = { name: 'Narrator', persona: 'p', scenario: '', examples: '', lorebook: [] };
var s = { systemPrompt: 'You are {{char}}. Write naturally.', userName: 'Player', temperature: 0.8, maxTokens: 400, contextMessages: 40 };
function lastMessage(hist, finalNote) {
  var out = API.buildChat(char, {}, hist, s, null, finalNote || null);
  return out[out.length - 1].content;
}
var starredHist = [
  { role: 'user', text: 'I wait.' },
  { role: 'assistant', text: '*The *hall *is *quiet *and *still *tonight. *Nobody *speaks *for *a *long *moment.' }
];
ok('the lock is the last thing in the request', /^FORMAT FOR THIS REPLY/.test(lastMessage(starredHist)));
ok('a clean chat is unchanged', !/FORMAT FOR THIS REPLY/.test(lastMessage([
  { role: 'user', text: 'I wait.' }, { role: 'assistant', text: 'She nods.' }])));
var withNote = lastMessage(starredHist, 'Where things stand right now: act two.');
ok('it survives alongside a final note', /FORMAT FOR THIS REPLY/.test(withNote) && /Where things stand/.test(withNote));
ok('...and is read before the note', withNote.indexOf('FORMAT FOR THIS REPLY') < withNote.indexOf('Where things stand'));
ok('the text-completion path has it too', /styleLock\(history\)/.test(apiSrc));

console.log('\nthe lock does not leak into anything else');

ok('it is not added to the system message', (function () {
  var out = API.buildChat(char, {}, starredHist, s, null, null);
  return out[0].content.indexOf('FORMAT FOR THIS REPLY') === -1;
})());
ok('providers that never see asterisks are unaffected', API.styleLock([
  { role: 'assistant', content: 'plain prose only' }
]) === '');
ok('the wire shape (content) is understood too', API.styleLock([
  { role: 'assistant', content: '*The *hall *is *quiet *and *still *tonight. *Nobody *speaks *and *nothing *moves *at *all.' }
]).length > 0);

console.log('\na first turn that italicises one line is not a habit');

eq('one italic pair in a greeting earns nothing', API.styleLock([
  { role: 'assistant', text: 'Opening\n\n*A car pulls into the driveway.*\n\n"Look who we have here!"' }
]), '');
eq('...and neither does a handful', API.styleLock([
  { role: 'assistant', text: '*She smiles.* "Come in." *The door closes.*' },
  { role: 'assistant', text: '*He nods.* "Thanks."' }
]), '');
ok('...but a reply that has started to run away does', API.styleLock([
  { role: 'assistant', text: '*He *nods *and *says *nothing *for *a *moment *at *all *tonight *in *the *hall.' }
]).length > 0);

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
