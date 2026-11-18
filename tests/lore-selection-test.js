/* v1.39.109: what a lorebook is allowed to put in front of the model.
 *
 * Reported from a real 66-turn chat. Three defects, all in the selection:
 *
 *   1. keyword scanning read the WHOLE history, so on turn 66 every proper
 *      noun ever mentioned still matched and the budget was spent on whatever
 *      the book happened to list first;
 *   2. there was no relevance ordering at all - entries were taken in book
 *      order, and cards list chapters before characters, so a scene from sixty
 *      turns ago beat the character the scene was about;
 *   3. the ceiling was 6 entries / 1536 bytes, small enough that three fat
 *      chapter summaries filled it completely.
 *
 * The fix is one selector. These tests pin what it decides, not how it is
 * worded: what gets in, what is excluded and why, and that the answer is the
 * same one the diagnostic reports.
 *
 * Generic: invented entries, no card content.
 *
 *   node /home/user/tests/lore-selection-test.js
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

function E(keys, content, over) {
  var e = { keys: keys, content: content, enabled: true, stage: '', constant: false };
  Object.keys(over || {}).forEach(function (k) { e[k] = over[k]; });
  return e;
}
function msgs(list) {
  return list.map(function (t, i) { return { role: i % 2 ? 'assistant' : 'user', text: t }; });
}

console.log('\n1 — scanning stops at the recent window');

var longHistory = msgs([
  'The gate is sealed and the key is in the hall.',      // ancient
  'We argued about the ferry toll all evening.',         // ancient
  'She says the mill wheel is broken.',                  // ancient
  'So the ledger was never signed.',                     // ancient
  'A horse crosses the yard.',                           // within window
  'Somebody is knocking at the door.',                   // within window
  'The lantern goes out.',                               // within window
  'The gate is sealed; help me with the bar.'            // newest
]);
var sample = API.loreSample(longHistory);
ok('the window is bounded, not the whole chat', API.LORE_SCAN_MESSAGES > 0 && API.LORE_SCAN_MESSAGES <= 40,
  API.LORE_SCAN_MESSAGES);
ok('the scan text holds the window', sample.text.indexOf('lantern') !== -1);
ok('the newest turn is carried separately', sample.newest.indexOf('sealed') !== -1, sample.newest);
ok('the per-message parts are carried for scoring', Array.isArray(sample.parts) && sample.parts.length === 8);
/* C2 (v1.39.74) must survive: something said earlier in the window still
   fires, it simply ranks below something said now. */
ok('a keyword mentioned earlier in the window still matches', (function () {
  var e = E(['ferry toll'], 'The ferry toll is two coppers.');
  return API._loreHits([e], sample, 10, 5000, '').length === 1;
})());
ok('a keyword outside the window does not', (function () {
  var e = E(['ferry toll'], 'The ferry toll is two coppers.');
  var far = msgs(new Array(30).join('filler ').split(' ').map(function (_, i) { return 'filler ' + i; }).concat(['nothing here']));
  return API._loreHits([e], API.loreSample(far), 10, 5000, '').length === 0;
})());
ok('a keyword in the window still matches', (function () {
  var e = E(['lantern'], 'A lantern is a lamp in a cage.');
  return API._loreHits([e], sample, 10, 5000, '').length === 1;
})());
eq('a plain string scan still works for old callers',
  API._loreHits([E(['gate'], 'The gate is iron.')], 'the gate is iron', 10, 5000, '').length, 1);

console.log('\n2 — relevance decides, not book order');

/* The reported shape: fat chapter entries listed first, the character the
   scene is actually about listed last. */
var book = [
  E(['sorting', 'house'], 'CHAPTER 7: ' + 'the sorting is described at length. '.repeat(12)),
  E(['potions', 'class'], 'CHAPTER 8: ' + 'lessons are described at length. '.repeat(12)),
  E(['halloween', 'troll'], 'CHAPTER 10: ' + 'the troll is described at length. '.repeat(12)),
  E(['draconica', 'malfoy'], 'DRACONICA: the character in this scene, and what she wants.')
];
var scene = API.loreSample(msgs([
  'I look at the sorting tables.',
  'Potions class was long.',
  'The halloween feast is over.',
  'I put my hand on Draconica shoulder and tell her it will be alright.'
]));
var got = API._loreHits(book, scene, 10, 5000, '');
ok('the character entry the scene is about gets in', got.some(function (e) { return e.content.indexOf('DRACONICA') === 0; }),
  got.map(function (e) { return e.content.slice(0, 14); }).join(' | '));
ok('...and something stale can be excluded while it is', (function () {
  /* with a tight budget the newest-match entries must win */
  var tight = API._loreHits(book, scene, 2, 200, '');
  return tight.length >= 1 && tight[0].content.indexOf('DRACONICA') === 0;
})(), JSON.stringify(API._loreHits(book, scene, 2, 200, '').map(function (e) { return e.content.slice(0, 12); })));

var ranked = API.loreRanks(book, scene, '');
eq('the newest match ranks first', ranked[0].index, 3);
eq('...and is scored as mentioned now', ranked[0].recency, 0);
ok('an older mention ranks below it', ranked[ranked.length - 1].recency > 0,
  ranked.map(function (r) { return r.index + ':' + r.recency; }).join(' '));
ok('closer mentions outrank distant ones', (function () {
  var mk = [
    E(['far'], 'FAR: mentioned early in the window.'),
    E(['near'], 'NEAR: mentioned in the newest message.')
  ];
  var sm = API.loreSample(msgs(['the far thing', 'a', 'b', 'the near thing']));
  var r = API.loreRanks(mk, sm, '');
  return r[0].index === 1 && r[0].recency < r[1].recency;
})());

/* among equal matches, the one with more distinct keys wins */
var two = [
  E(['lantern'], 'A lantern, generic.'),
  E(['lantern', 'door'], 'A lantern by the door, specific.')
];
var rank2 = API.loreRanks(two, API.loreSample(msgs(['a horse', 'a dog', 'a cat', 'the lantern by the door'])), '');
eq('more matched keys wins a tie', rank2[0].index, 1);

console.log('\nconstant entries lead, and are never crowded out');

var constBook = [
  E(['unrelated'], 'a big ordinary entry '.repeat(40)),
  E([], 'SCOPE: this story covers one year only.', { constant: true })
];
var withConst = API._loreHits(constBook, API.loreSample(msgs(['one', 'two', 'three', 'four'])), 10, 5000, '');
eq('a constant entry is admitted without a keyword', withConst.length, 1);
eq('...and it is the constant one', withConst[0].constant, true);
ok('a constant entry is admitted first even with a tiny budget',
  API._loreHits(constBook, API.loreSample(msgs(['a', 'b', 'c', 'd'])), 1, 60, '')[0].constant === true);

console.log('\nstage gating still works');

var staged = [
  E(['gate'], 'Chapter six wording.', { stage: 'act one' }),
  E(['gate'], 'Chapter seven wording.', { stage: 'act two' })
];
eq('the wrong stage is excluded', API._loreHits(staged, API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), 10, 5000, 'act two').length, 1);
eq('...and it is the right one', API._loreHits(staged, API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), 10, 5000, 'act two')[0].content, 'Chapter seven wording.');
eq('with no stage set, staged entries are hidden', API._loreHits(staged, API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), 10, 5000, '').length, 0);
eq('a disabled entry is never admitted', API._loreHits([E(['gate'], 'x', { enabled: false })],
  API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), 10, 5000, '').length, 0);

console.log('\n3 — the ceiling leaves room for the relevant thing');

eq('the entry limit is ten', API.LORE_LIMIT, 10);
eq('the byte budget is 5000', API.LORE_BUDGET, 5000);
ok('ten entries can be admitted', (function () {
  var many = [];
  for (var i = 0; i < 14; i++) many.push(E(['gate'], 'entry ' + i + ' ' + 'x'.repeat(100)));
  return API._loreHits(many, API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), API.LORE_LIMIT, API.LORE_BUDGET, '').length >= 10;
})());
ok('the budget still stops a flood', (function () {
  var many = [];
  for (var i = 0; i < 14; i++) many.push(E(['gate'], 'entry ' + i + ' ' + 'x'.repeat(900)));
  var out = API._loreHits(many, API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), API.LORE_LIMIT, API.LORE_BUDGET, '');
  var bytes = out.reduce(function (n, e) { return n + e.content.length; }, 0);
  return bytes <= API.LORE_BUDGET;
})());
ok('a lone entry larger than the budget is still admitted', (function () {
  var huge = E(['gate'], 'y'.repeat(9000));
  return API._loreHits([huge], API.loreSample(msgs(['a', 'b', 'c', 'the gate'])), API.LORE_LIMIT, API.LORE_BUDGET, '').length === 1;
})());

console.log('\nthe diagnostic reports the same decision the prompt makes');

var diagBook = [
  E(['sorting'], 'CHAPTER 7: ' + 'long text '.repeat(60)),
  E(['potions'], 'CHAPTER 8: ' + 'long text '.repeat(60)),
  E(['draconica'], 'DRACONICA: the one the scene is about.')
];
var diagSample = API.loreSample(msgs([
  'I wait by the sorting tables.', 'The potions lesson ends.', 'Nobody speaks.', 'I speak to Draconica.'
]));
var d = API.loreDiagnostics(diagBook, diagSample, API.LORE_LIMIT, API.LORE_BUDGET, '');
var hits = API._loreHits(diagBook, diagSample, API.LORE_LIMIT, API.LORE_BUDGET, '');
eq('the diagnostic admits the same count', d.admitted, hits.length);
ok('...and names the same entries', diagBook.every(function (e, i) {
  var inHits = hits.indexOf(e) !== -1;
  var saysAdmitted = d.rows[i].reason === 'matched' || d.rows[i].reason === 'always (constant)';
  return inHits === saysAdmitted;
}));
eq('it reports the ceiling it used', d.cap, API.LORE_BUDGET);
eq('it reports the limit it used', d.limit, API.LORE_LIMIT);
ok('every rejected entry is given a reason', d.rows.every(function (r) { return r.reason !== ''; }));
ok('a ranked entry reports its rank', d.rows.some(function (r) { return r.rank >= 0; }));

console.log('\nthe prompt carries the result');

var char = {
  name: 'Narrator', persona: 'A voice.', scenario: '', examples: '',
  lorebook: [E(['draconica'], 'DRACONICA: she is here, and she matters.'),
             E(['sorting'], 'CHAPTER 7: ' + 'far too long. '.repeat(200))]
};
var session = {};
var settings = { userName: 'Player', systemPrompt: 'You are {{char}}.', maxTokens: 400, contextMessages: 40 };
var out = API.buildChat(char, session, msgs([
  'we walk on', 'the hall is quiet', 'a door shuts', 'I turn to Draconica.'
]), settings, null, null);
var sys = out[0].content;
ok('the relevant entry is in the prompt', sys.indexOf('DRACONICA') !== -1);
ok('the oversized irrelevant one is not', sys.indexOf('far too long') === -1);
ok('the block is still labelled', /Relevant world facts/.test(sys));

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
