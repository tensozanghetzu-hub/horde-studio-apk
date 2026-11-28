#!/usr/bin/env node
/* v1.48.9: the transcript can answer "did the level system work?".

   A player runs 38 turns of a card with its own `[Level: 2] [Exp: 40/60]` lines in
   the prose, exports the chat, and the file shows … the prose. That is what the
   export used to contain: `transcriptParts` carried `who`, `text`, `image` and the
   memory, and nothing else — so the ledger's facts (what was approved, on which
   reply, what is still unreviewed, what was refused) were invisible exactly where
   they were needed, and "it seemed to work and then it didn't" could not be told
   apart from "it never ran".

   So the export now reads the ledger the sheet reads. This file drives the real
   `App.transcriptParts` / `renderTranscriptMd` / `renderTranscriptTxt` over rows
   that hold an award, a pending proposal, a dismissal, an XP-less approval, a
   hand-written level line and a leaked tag, and checks what the player ends up
   holding. The point is not that a line exists; it is that the line says the true
   number — so every figure asserted here is compared against what `API.rpgLedger`
   and `API.rpgAwardText` say, never against a number written into this file.

   Usage: node tests/transcript-rpg-test.js
*/
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function has(needle, inWhat) { return String(inWhat).indexOf(needle) !== -1; }

function world(session, msgs) {
  var sb = {
    console: console, JSON: JSON, Promise: Promise, Object: Object, Array: Array,
    String: String, Number: Number, Math: Math, Date: Date, RegExp: RegExp, Error: Error,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite,
    setTimeout: function (fn) { return fn && fn(); }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    /* The engine is real: a second implementation of the arithmetic here would let
       the export and the app disagree and both look green. */
    Store: {
      settings: { userName: 'Blu' }, characters: [], personas: [],
      init: function () { return Promise.resolve(); },
      getMessages: function () { return Promise.resolve(msgs); },
      putSession: function (s) { return Promise.resolve(s); }
    },
    IDB: {
      get: function () { return Promise.resolve(session); },
      getAll: function () { return Promise.resolve([]); },
      getAllByIndex: function () { return Promise.resolve(msgs); }
    },
    Views: { thread: function () {}, appendMessage: function () { return {}; }, stickToBottom: function () {} },
    UI: {
      toast: function () {}, sheet: function () { return Promise.resolve(null); },
      esc: function (s) { return String(s == null ? '' : s); }, icon: function () { return ''; },
      confirm: function () { return Promise.resolve(true); }, download: function () {}
    },
    document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {}, getElementById: function () { return null; } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
  sb.App.state = { char: { id: 'c1', name: 'Solo Leveling RPG' }, session: session, messages: msgs, busy: false };
  return { App: sb.App, API: sb.API, session: session, msgs: msgs };
}

/* A run like the one that prompted this: the card kept its own counters in the
   prose, the ledger recorded one approved change, one proposal was never reviewed,
   one was refused, one approval moved no XP, and one reply still holds a tag. */
function CURVE(extra) {
  return Object.assign({
    enabled: true, level: '2', xp: 30, xpToNext: null, xpBase: null, rule: '20 max:40',
    attributes: { Fatigue: '14' }, skills: [], inventory: [], notes: [],
    declined: [{ label: '+40 XP for a C-rank kill', at: 12 }], suggestionsEnabled: true
  }, extra || {});
}
function rows(opts) {
  opts = opts || {};
  return [
    { id: 'm1', sessionId: 's1', role: 'assistant', createdAt: 1, text: 'You step up to the crystal. [Level: 1] [Exp: 0/20]' },
    { id: 'm2', sessionId: 's1', role: 'user', createdAt: 2, text: 'I stab the goblin.' },
    {
      id: 'm3', sessionId: 's1', role: 'assistant', createdAt: 3,
      text: 'Two fall before the third turns. [Level: 2] [Exp: 30/20]',
      rpgAward: opts.keepAward === false ? undefined : { xp: 30, from: 0, at: 3, reason: 'Two goblins down', label: '+30 XP', speaker: 'Solo Leveling RPG' },
      rpgStatusProposal: { state: 'applied', reason: 'Two goblins down', changes: [{ field: 'xp', op: 'add', value: 30 }] }
    },
    {
      id: 'm4', sessionId: 's1', role: 'assistant', createdAt: 4,
      text: 'The dragon waits. [Level: 2] [Exp: 30/20]',
      rpgStatusProposal: { state: 'pending', reason: 'Wound the dragon', changes: [{ field: 'xp', op: 'add', value: 80 }] }
    },
    {
      id: 'm5', sessionId: 's1', role: 'assistant', createdAt: 5, text: 'You sit down and breathe.',
      rpgStatusProposal: { state: 'dismissed', reason: 'Fatigue drops', changes: [{ field: 'attributes', op: 'set', key: 'Fatigue', value: '9' }] }
    },
    {
      id: 'm6', sessionId: 's1', role: 'assistant', createdAt: 6, text: 'The meditation holds.',
      rpgStatusProposal: { state: 'applied', reason: 'A skill earned', changes: [{ field: 'skills', op: 'add', value: 'Combat meditation' }] }
    }
  ].concat(opts.leak ? [{ id: 'm7', sessionId: 's1', role: 'assistant', createdAt: 7, text: 'Raw: <rpg_update>{"reason":"x","changes":[{"field":"xp","op":"add","value":1}]}</rpg_update>' }] : []);
}

function build(status, opts) {
  var w = world({ id: 's1', charId: 'c1', title: 'Blu\u2019s Secret S-Rank Awakening', createdAt: 1, rpgStatus: status }, rows(opts));
  var parts = w.App.transcriptParts(w.session, { id: 'c1', name: 'Solo Leveling RPG' }, w.msgs);
  var ledger = w.API.rpgLedger(status || {}, w.msgs);
  return {
    w: w, parts: parts, ledger: ledger,
    md: w.App.renderTranscriptMd(parts, w.session.title, 'Solo Leveling RPG'),
    txt: w.App.renderTranscriptTxt(parts, w.session.title, 'Solo Leveling RPG')
  };
}

console.log('\nthe head of the file says what the ledger is');
var run = build(CURVE());
var head = run.parts.rpgLines.join('\n');
ok('the curve is quoted as the player typed it', has('curve 20 max:40', head), head.split('\n')[0]);
ok('with the level, the total, what is left and the cap', has('level 2', head) && has('30 XP', head) &&
  has('10 to go', head) && has('at most 40 XP a turn', head), head.split('\n')[0]);
ok('the total in the header is the one the log adds up to, not the cached one',
  has('\u00b7 ' + run.ledger.expected + ' XP \u00b7', head) || has('\u00b7 ' + run.ledger.expected + ' XP\n', head),
  'expected ' + run.ledger.expected + ' / ' + head.split('\n')[0]);
ok('and every count the run earned is named once', has('1 approved change logged on replies', head) &&
  has('1 proposal still waiting to be reviewed', head) && has('1 dismissed here', head) &&
  has('1 applied with no XP to log', head), head.split('\n')[1]);
ok('the floor is shown as the player left it', has('your own 0 XP, then +30 from the log', head), head.split('\n')[1]);
/* Two lines only when they are true: no leak, so no leak sentence, and no
   disagreement between the log and the cache, so no repair sentence. A diagnostic
   that narrates nothing is a diagnostic nobody reads. */
ok('nothing is invented for a fact that is not true',
  !has('raw <rpg_update>', head) && !has('disagree', head) && head.split('\n').length === 3, head);

console.log('\na reply says what it changed');
var award = run.w.msgs[2].rpgAward;
var line = run.parts.turns[2].note;
ok('the award line is the sheet\u2019s own sentence, then the running total', has(run.w.API.rpgAwardText(award), line) &&
  has('30 XP', line) && has('level 2', line), line);
ok('the pending one names its reason so the player knows what they skipped',
  has('a status change was proposed here and never reviewed: Wound the dragon', run.parts.turns[3].note), run.parts.turns[3].note);
ok('the dismissed one says it is on the record',
  has('the model is told not to offer it again', run.parts.turns[4].note), run.parts.turns[4].note);
ok('an approval that moved no XP still says so, instead of looking untouched',
  has('it moved no XP, so there is nothing to log', run.parts.turns[5].note), run.parts.turns[5].note);
ok('a reply with neither says nothing at all', run.parts.turns[0].note === '' && run.parts.turns[1].note === '',
  JSON.stringify([run.parts.turns[0].note, run.parts.turns[1].note]));
ok('markdown puts it under the reply, txt without the markup', has('\n\n*(' + line + ')*', run.md) &&
  has('(ledger: ' + line + ')', run.txt));

console.log('\nthe diagnosis an export exists for');
ok('it counts the replies printing their own level lines', has('3 replies print a `[Level:`-style line of their own', run.md));
ok('and says whose number is the app\u2019s', has('The app\u2019s number is the one above', run.md));
var leaky = build(CURVE(), { leak: true });
ok('a raw tag still in a stored reply is called out, singular', has('1 reply still carries a raw <rpg_update> block', leaky.md), leaky.parts.rpgLines[2] || '');
var clean = build(CURVE({ xp: 30 }), {});
ok('and the line is absent when the tag was stripped as usual', !has('raw <rpg_update>', clean.md));
var poisoned = build(CURVE({ xp: 999 }));
ok('a cached total the log contradicts is reported, not hidden', has('The log and the stored total disagree', poisoned.md) &&
  has(String(poisoned.ledger.expected), poisoned.md), poisoned.parts.rpgLines[2] || '');
var quiet = build(CURVE(), { keepAward: false });
ok('a chat that approved nothing says the plain thing', has('0 approved changes logged on replies', quiet.md) &&
  !has('The log and the stored total disagree', quiet.md), quiet.parts.rpgLines[1]);

console.log('\nand when tracking was never on');
var off = build(null);
ok('the file says no proposal was read', has('RPG tracking: off', off.md) && has('No proposal was read in this chat', off.md), off.parts.rpgLines[0]);
ok('and that the level lines below are prose', has('any level or XP line below is prose the model wrote', off.md));
var plain = world({ id: 's1', charId: 'c1', title: 'Plain', createdAt: 1, rpgStatus: null },
  [{ id: 'p1', sessionId: 's1', role: 'assistant', createdAt: 1, text: 'Just prose.' }]);
var plainMd = plain.App.renderTranscriptMd(plain.App.transcriptParts(plain.session, { id: 'c1', name: 'Nadia' }, plain.msgs), 'Plain', 'Nadia');
ok('a chat that never used the ledger gets no section about it', !has('RPG tracking', plainMd) && !has('(ledger:', plainMd), plainMd.slice(-120));
var offLate = build({ enabled: false, level: '2', xp: 30, rule: '20', xpBase: null });
ok('a ledger switched off after awards says which of the two it was',
  has('1 approved change', offLate.md) && has('still on the replies below', offLate.md), offLate.parts.rpgLines[0]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
