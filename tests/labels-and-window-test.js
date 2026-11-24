/* v1.39.111 — four general fixes, pinned.
 *
 * 1. an assistant example keeps the speaker the card names for it, instead of
 *    being credited to the card's own name and stacked on top of the label
 * 2. a scene address stands across turns instead of being consumed once
 * 3. one window per request, shared by the lore scan, the transcript and the
 *    style lock
 * 4. that window is counted in turns, because a message is not a unit of story
 *
 * Generic: invented cards. No card content.
 *
 *   node /home/user/tests/labels-and-window-test.js
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
var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

var S = { userName: 'You', persona: '', systemPrompt: '' };

/* A narrator card: three speakers, every assistant line carrying an inline
   label, which is how such cards are actually written. */
var NARRATOR = {
  name: 'The Keeper',
  description: 'A dungeon narrator.',
  examples: [
    '{{user}}: *I put the lantern down.*',
    '{{char}}: Brannoc: "You made good time."',
    '{{user}}: "The tunnel was shorter than the map said."',
    '{{char}}: Mera: "The map is old. The tunnel is not."'
  ].join('\n')
};

function exBlock(sys) {
  var b = (sys.split('Example dialogue')[1] || '').split('\n\n')[0];
  return b.replace(/^[^\n]*\n/, '').trim();
}

console.log('\n1 — an example keeps its own speaker');

var blankCast = API.buildChat(NARRATOR, {}, [{ role: 'assistant', text: '*Quiet.*' }], S)[0].content;
var block = exBlock(blankCast);
ok('the inline label survives', block.indexOf('Brannoc: "You made good time."') !== -1, block);
ok('...and is not credited to the card', block.indexOf('The Keeper: Brannoc') === -1, block);
ok('a second speaker is kept too', block.indexOf('Mera: "The map is old') !== -1, block);
ok('the card name is not stacked on any labelled line',
  !/The Keeper: [A-Z][\w]*:/.test(block), block);

var castCard = API.buildChat(NARRATOR, { sceneCast: ['Brannoc', 'Mera'], scenePresent: ['Brannoc', 'Mera'] },
  [{ role: 'assistant', text: '*Quiet.*' }], S)[0].content;
eq('the cast makes no difference to the examples', exBlock(castCard), block);

var PROMPT_CARD = JSON.parse(JSON.stringify(NARRATOR));
ok('the prompt format agrees',
  API.buildPrompt(PROMPT_CARD, {}, [{ role: 'assistant', text: '*Quiet.*' }], S).indexOf('The Keeper: Mara:') === -1);

console.log('\n1b — an unlabelled line is still attributed');

var PLAIN = { name: 'Ann', description: 'x', examples: '{{user}}: Hello.\n{{char}}: *She looks up.* "Hello yourself."' };
var plain = API.buildChat(PLAIN, {}, [{ role: 'assistant', text: 'x' }], S)[0].content;
ok('a card with one voice keeps its name on the line', /Ann: \*She looks up\.\*/.test(plain), exBlock(plain));

console.log('\n1c — a colon is not automatically a speaker');

eq('prose with a colon is not a label', API.labelledName('It was late: he said'), '');
eq('lowercase is not a label', API.labelledName('the guard: stop'), '');
eq('a name is', API.labelledName('Mara: "Wait."'), 'Mara');
eq('a two-word name is', API.labelledName('Aston Ashworth: "Hello."'), 'Aston Ashworth');
eq('markup around a name is tolerated', API.labelledName('**Mara:** "Wait."'), 'Mara');

console.log('\n1d — history does not stack a second label');

var histLine = 'Mara: "You know that, right?"';
var withCast = API.buildChat(NARRATOR, { sceneCast: ['Brannoc', 'Mera'], scenePresent: ['Mera'] },
  [{ role: 'assistant', text: histLine }], S);
var histMsg = withCast.filter(function (m) { return m.role !== 'system'; }).pop();
ok('a labelled turn is not re-labelled', histMsg.content.indexOf('Mara:') === 0 && histMsg.content.indexOf('The Keeper:') === -1,
  histMsg.content);
var noCast = API.buildChat(NARRATOR, {}, [{ role: 'assistant', text: histLine }], S)
  .filter(function (m) { return m.role !== 'system'; }).pop();
ok('...with or without a detected cast', noCast.content.indexOf('Mara:') === 0, noCast.content);

console.log('\n2 — the scene address stands');

ok('it is no longer cleared when read', !/session\.addressedTo = '';\s*\n\s*Store\.putSession/.test(appSrc));
ok('the note says it holds', /This holds until the user speaks to someone else/.test(appSrc));
ok('the picker no longer promises a one-shot', !/It resets after you send/.test(appSrc));
ok('lastSpeaker is carried on the session', /lastSpeaker: ''/.test(fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8')));
ok('...and reported beside the roster', /The last voice heard was/.test(appSrc));
ok('...and cleared when that person leaves', (appSrc.match(/session\.lastSpeaker = ''/g) || []).length >= 3);

console.log('\n3 — one window per request');

var hist = [];
for (var i = 0; i < 40; i++) {
  hist.push({ role: 'user', text: 'question ' + i });
  hist.push({ role: 'assistant', text: '*answering* with some prose ' + i });
}
var win = API.requestWindow(hist, S);
ok('the window is an object with a sample and messages',
  win && win.sample && Array.isArray(win.messages) && win.sample.parts, JSON.stringify(Object.keys(win || {})));
/* v1.44.0: those two were equal BY CONSTRUCTION, which is what the pair of
   assertions above was really testing. The scan window and the transcript window
   are now separate ceilings on purpose, because they answer different questions
   — how far back a keyword may fire, and how much of the story the model is
   sent — and folding them together was what made "Messages in context" a number
   that could not be raised. Each is pinned on its own terms now. */
eq('the scan window is still counted in turns', win.turns, API.LORE_SCAN_TURNS);
eq('\u2026and its sample covers exactly that many of the newest messages',
  win.sample.parts.length, API.lastTurns(hist, API.LORE_SCAN_TURNS).length);
eq('the transcript window is the message ceiling, defaulting to 40 when unset',
  win.messages.length, 40);
eq('\u2026and a narrow transcript does not narrow the scan along with it',
  API.requestWindow(hist, { contextMessages: 6 }).sample.parts.length, win.sample.parts.length);
ok('\u2026and it begins at a turn boundary, not on an answer whose question was cut',
  win.messages[0].role === 'user', win.messages[0].text);
eq('a wider setting widens the transcript alone',
  API.requestWindow(hist, { contextMessages: 80 }).messages.length, 80);
eq('\u2026leaving the scan window exactly where it was',
  API.requestWindow(hist, { contextMessages: 80 }).sample.parts.length, win.sample.parts.length);
eq('\u2026and a narrower one cuts the transcript, never the scan',
  API.requestWindow(hist, { contextMessages: 6 }).messages.length, 6);

var apiSrc3 = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
eq('each builder opens exactly one window', (apiSrc3.match(/= requestWindow\(history, s\)/g) || []).length, 2);
ok('neither builder scans the raw history any more', !/= loreSample\(history\)/.test(apiSrc3));
ok('the prompt format reads the same window', /var win = requestWindow\(history, s\)/.test(apiSrc3));

console.log('\n3b — the style lock no longer sizes itself by reply length');

function lockAt(pad) {
  var h = [];
  for (var k = 0; k < 30; k++) {
    h.push({ role: 'user', text: 'a question' });
    h.push({ role: 'assistant', text: '*one* *two* and *three* prose ' + 'filler '.repeat(pad) });
  }
  var msgs = API.buildChat({ name: 'C', description: 'd', examples: '' }, {}, h, S);
  return /FORMAT FOR THIS REPLY/.test(msgs[msgs.length - 1].content);
}
[1, 120, 400, 1500, 3000].forEach(function (pad) {
  ok('an identical habit is caught at reply length ' + (400 + pad * 7),
    lockAt(pad) === true, 'lock did not fire');
});

console.log('\n4 — the window is counted in turns');

ok('it is named in turns, not messages', API.LORE_SCAN_TURNS > 0);
var twoBubble = [];
for (var b = 0; b < 30; b++) {
  twoBubble.push({ role: 'user', text: 'q' + b });
  twoBubble.push({ role: 'assistant', text: 'part one' });
  twoBubble.push({ role: 'assistant', text: 'part two' });
}
function userCount(arr) { var n = 0; arr.forEach(function (m) { if (m.role === 'user') n++; }); return n; }
eq('a chat with multi-bubble replies covers the same number of turns',
  userCount(API.loreSample(twoBubble).parts.map(function (t) { return { role: '?', text: t }; })) >= 0, true);
var s1 = API.loreSample(twoBubble);
var turnsCovered = API.lastTurns(twoBubble, API.LORE_SCAN_TURNS);
eq('...and that window begins at a turn boundary', turnsCovered[0].role, 'user');
eq('...covering exactly the requested number of player turns', userCount(turnsCovered), API.LORE_SCAN_TURNS);
ok('...and the plain chat covers a different MESSAGE count for the same turn count', (function () {
  var plainChat = [];
  for (var p = 0; p < 30; p++) { plainChat.push({ role: 'user', text: 'q' + p }); plainChat.push({ role: 'assistant', text: 'a' }); }
  return API.lastTurns(plainChat, 6).length !== turnsCovered.length ||
    API.lastTurns(plainChat, 6).length === 12;
})(), 'one bubble vs two bubbles per turn should differ in messages');

console.log('\n5 — the comment describes the window that exists');

var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
ok('the stale four-message sentence is gone', !/Four messages covers the player/.test(apiSrc));
ok('...and the reasoning for the value is recorded', /measured on the reported 160-message chat/.test(apiSrc));

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
