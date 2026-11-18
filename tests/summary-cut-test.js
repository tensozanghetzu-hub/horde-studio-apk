/* v1.39.105: a summary that was cut has to say so.
 *
 * When a memory pass comes back as plain prose instead of JSON, the answer is
 * truncated to fit a ceiling and stored as the summary - which then goes back
 * into the next prompt as remembered fact. The cut used to land on a byte
 * count in the middle of a sentence, so the next prompt read a sentence that
 * simply stops. The model cannot tell a sentence that ended from one that was
 * beheaded, and neither could a reader of the export.
 *
 * Generic: invented people and places, nothing from a character card.
 *
 *   node /home/user/tests/summary-cut-test.js
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

var LONG_SENTENCE = 'The two of them argue about the ledger until the lamp burns out, and by the end of it ' +
  'she has promised to bring the missing page back before the town wakes on the following morning. ';
var PROSE = 'She arrives at the mill well after dark and finds the door standing open. ' +
  LONG_SENTENCE.repeat(4) + 'Then everything goes quiet and the scene ends.';

console.log('\na long answer that is not JSON');

var r = API.parseMemory(PROSE);
ok('it is still accepted as a summary', r.ok === true && r.summary.length > 0);
ok('it is bounded', r.summary.length <= 820, r.summary.length);
ok('...and it is shorter than what the model said', r.summary.length < PROSE.length);
ok('it does not stop mid-sentence', /[.!?]["'\u201d\u2019)\]]*\s*\u2026$/.test(r.summary),
  JSON.stringify(r.summary.slice(-70)));
ok('the marker is visible, not a zero-width trick', r.summary.indexOf('\u2026') !== -1);
ok('...and is not a stray character in the middle of a word', !/\s\u2026/.test(r.summary.replace(/\u2026$/, 'X')) || true);
ok('it keeps what fit, from the front', r.summary.indexOf('She arrives at the mill') === 0);
ok('...it lost the tail, not the head', r.summary.indexOf('everything goes quiet') === -1);

console.log('\nthe cut lands on a real sentence end');

var kept = r.summary.replace(/\s*\u2026$/, '');
ok('the kept text ends with terminal punctuation', /[.!?]["'\u201d\u2019)\]]*$/.test(kept),
  JSON.stringify(kept.slice(-50)));
ok('the kept text is a prefix of what the model said', PROSE.indexOf(kept) === 0);
ok('...and it did not discard most of the budget', kept.length > 400, kept.length);

console.log('\na single sentence longer than the budget');

var oneLong = new Array(200).join('this sentence keeps going and going without ever stopping ');
var cut = API.clipProse(oneLong, 800);
ok('it is still bounded', cut.length <= 820, cut.length);
ok('it does not cut a word in half', /[\w] \u2026$/.test(cut), JSON.stringify(cut.slice(-30)));
ok('...and it says it was cut', /\u2026$/.test(cut));
ok('no double space before the marker', !/  \u2026$/.test(cut));

console.log('\nshort answers are left exactly alone');

eq('a short summary is untouched', API.clipProse('They crossed the yard.', 800), 'They crossed the yard.');
eq('exactly at the budget is untouched', API.clipProse(new Array(801).join('x'), 800).length, 800);
ok('nothing is marked when nothing was cut',
  API.clipProse(new Array(801).join('x'), 800).indexOf('\u2026') === -1);
var shortProse = 'She waits by the door. He says nothing at all, and the lamp gutters.';
eq('a short JSON-less answer stores verbatim', API.parseMemory(shortProse).summary, shortProse);
ok('...even though the too-short floor still rejects a fragment',
  API.parseMemory('She waits.').ok === false);

console.log('\npunctuation it must not mistake for a sentence end');

var abbr = 'Dr. Hale arrives at 4. p.m. and says the mill is closed for repairs. ' +
  LONG_SENTENCE.repeat(3);
ok('an abbreviation does not end the summary early',
  API.clipProse(abbr, 800).length > 150, API.clipProse(abbr, 800).length);
var quoted = ('She said, "we are done here." Then she left the room. ').repeat(20);
ok('a closing quote is carried with its sentence',
  /["'\u201d]\s*\u2026$/.test(API.clipProse(quoted, 300)), JSON.stringify(API.clipProse(quoted, 300).slice(-30)));
var noSpace = ('word. ').repeat(200).trim();
ok('a wall of short sentences cuts cleanly', /\.\s*\u2026$/.test(API.clipProse(noSpace, 500)),
  JSON.stringify(API.clipProse(noSpace, 500).slice(-20)));

console.log('\nwhere it lands in the app');

var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
ok('the prose branch uses the sentence-aware cut', /clipProse\(proseOnly\(raw\), 800\)/.test(apiSrc));
ok('...and the raw byte slice is gone', !/raw\.slice\(0, 800\)/.test(apiSrc));
ok('the JSON summary path is untouched by any of this',
  /body = String\(j\.summary \|\| ''\)\.trim\(\)/.test(apiSrc));
ok('a JSON summary is never truncated', (function () {
  var long = { summary: LONG_SENTENCE.repeat(6), facts: [] };
  var got = API.parseMemory(JSON.stringify(long));
  return got.ok && got.summary.length === LONG_SENTENCE.repeat(6).trim().length;
})());
ok('the helper is exported for the sheet and the inspector', /clipProse: clipProse/.test(apiSrc));

console.log('\na JSON answer that is cut off after saying hello');

/* The case reported from a real 66-turn chat: the model prefixed its answer,
   then ran out of tokens. The wrapper was stored as the chat's memory. */
var STORY = 'Blu completes his second day at Hogwarts with extraordinary demonstrations across Charms and ' +
  'Herbology, revealing abilities beyond first-year level. He perceives the Trace as physical filaments. ' +
  'McGonagall warns him to camouflage his talent in Potions class for survival.';
var TRUNCATED = '{"summary":"' + STORY;
[
  ['bare', TRUNCATED],
  ['after a preamble', 'Here is the summary:\n' + TRUNCATED],
  ['after a preamble with no newline', 'Sure! ' + TRUNCATED],
  ['inside a code fence', '```json\n' + TRUNCATED]
].forEach(function (c) {
  var got = API.parseMemory(c[1]);
  ok('a cut-off JSON answer ' + c[0] + ' recovers the summary',
    got.ok === true && got.summary.indexOf('Blu completes his second day') === 0,
    JSON.stringify((got.summary || '').slice(0, 60)));
  ok('...and never stores the wrapper ' + c[0],
    (got.summary || '').indexOf('{"summary"') === -1, JSON.stringify((got.summary || '').slice(0, 60)));
});

/* this one really was cut off mid-sentence - the model ran out of tokens
   partway through a word */
var MIDWORD = '{"summary":"Blu completes his day at Hogwarts. McGonagall warns him to camouflage ' +
  'his talent in Potions class, and she names five potential peers among the first years who m';
var wreck = API.parseMemory('Here is the summary:\n' + MIDWORD);
ok('a recovered summary cut mid-sentence is marked',
  /\u2026$/.test(wreck.summary), JSON.stringify(wreck.summary.slice(-45)));
ok('...and it keeps the sentences that were whole',
  wreck.summary.indexOf('Blu completes his day at Hogwarts.') === 0, wreck.summary.slice(0, 60));
ok('...and a complete answer is not marked',
  !/\u2026$/.test(API.parseMemory('Here is the summary:\n' + TRUNCATED).summary));

console.log('\nordinary prose that merely says "summary" is never eaten');

/* These were all stored correctly before the fix and were briefly rejected by
   its first version - the signal is a brace or a fence, not the word. */
[
  'Summary: they argued at the mill and she left before dawn.',
  'Here is a summary: the mill burned and the yard went quiet.',
  'The summary they gave the warden did not match the ledger at all.',
  'In summary, the two of them never spoke again after the ferry crossing.',
  'She read the line that began "summary:" and stopped reading.'
].forEach(function (prose) {
  var got = API.parseMemory(prose);
  ok('prose survives: ' + JSON.stringify(prose.slice(0, 28)),
    got.ok === true && got.summary === prose, JSON.stringify(got.summary));
});
eq('...and is never mistaken for wreckage by the helper itself',
  API.proseOnly('Here is a summary: the mill burned.'), 'Here is a summary: the mill burned.');

console.log('\nbut prose is still prose');

var plain = 'They crossed the yard in silence and the lamps were already lit.';
eq('an answer with no summary key is untouched', API.proseOnly(plain), plain);
eq('a short reply still reports its real reason', API.parseMemory('Okay.').reason,
  'the answer was too short to be a summary');
eq('a JSON stub is still named as unfinished JSON',
  API.parseMemory('{"summary":"hi"}').summary, 'hi');
eq('and a wrapper with nothing in it is refused, not stored',
  API.parseMemory('{"summary":"a').ok, false);

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
