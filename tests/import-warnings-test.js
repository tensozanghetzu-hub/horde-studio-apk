/* v1.39.112 — five warn-only import/prompt fixes, pinned.
 *
 * 1. bulk import no longer drops the notes it computed: the batch aggregates
 *    them into a toast, and every card keeps its own, readable from its menu
 * 2. importLossNotes names every discarded lorebook field, not just two
 * 3. the asterisk register is named at import, where the player can act on it
 * 4. {{original}} resolves to the global system prompt instead of reaching the
 *    model as literal braces
 * 5. when the style lock fires, the player is told once per chat — what
 *    happened, and nothing about whose fault it was
 *
 * Generic: invented cards. No card content.
 *
 *   node /home/user/tests/import-warnings-test.js
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

var toasts = [];
var sheets = [];
var savedSessions = [];

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  AbortController: AbortController,
  UI: {
    esc: function (s) { return String(s == null ? '' : s); },
    icon: function () { return ''; },
    md: function (s) { return String(s || ''); },
    uid: function (p) { return p + '-test'; },
    toast: function (t) { toasts.push(String(t)); },
    confirm: function () { return Promise.resolve(true); },
    input: function () { return Promise.resolve(null); },
    sheet: function (o) { sheets.push(o); return Promise.resolve(null); },
    download: function () {}
  },
  Store: {
    settings: { provider: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm', userName: 'Sam', systemPrompt: 'GLOBAL PROMPT' },
    putSession: function (s) { savedSessions.push(s); return Promise.resolve(s); },
    putCharacter: function (c) { return Promise.resolve(c); },
    getCharacter: function () { return Promise.resolve(null); },
    getSessions: function () { return Promise.resolve([]); },
    cardToCharacter: function (card) {
      return {
        id: 'c-test', name: (card && card.name) || 'Test', persona: '', scenario: '',
        greeting: '', examples: '', postHistory: '', lorebook: [],
        /* the real cardToCharacter attaches the preserved source; without it
           prepareImportedCharacter would report every card as too large to
           preserve, and this file would be testing its own stub */
        cardSource: { top: {}, body: {}, imgs: [] },
        alternateGreetings: [], expressionPortraits: [], avatar: null, images: []
      };
    },
    personaLabel: function () { return 'Sam'; },
    characters: [], personas: [], sessions: []
  },
  Views: {
    normalizeDataUrl: function (v) { return Promise.resolve(v); },
    normalizeCardImages: function (v) { return Promise.resolve(v); },
    appendMessage: function () {
      return { classList: { add: function () {} }, querySelector: function () { return null; } };
    },
    chats: function () {}, characters: function () {}, settings: function () {},
    personas: function () {}, life: function () {}, feed: function () {}
  },
  VH: { status: function () { return { text: '' }; }, latenessNote: function () { return null; }, ensure: function () {} },
  IDB: { get: function () { return Promise.resolve(null); } },
  document: {
    querySelector: function () {
      return { hidden: false, textContent: '', innerHTML: '', style: {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {} },
        querySelector: function () { return null; }, querySelectorAll: function () { return []; },
        addEventListener: function () {}, setAttribute: function () {}, appendChild: function () {} };
    },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  fetch: function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); },
  scrollTo: function () {}, addEventListener: function () {}
};
sb.window = sb; sb.global = sb;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), sb, { filename: 'app.js' });
var API = sb.API, App = sb.App;
/* generateReply's lock check runs before the request; a generate that never
   resolves keeps the test synchronous and side-effect free. */
API.generate = function () { return new Promise(function () {}); };

function cardWith(bookEntries, extra) {
  var c = {
    name: 'Test Card',
    data: {
      name: 'Test Card',
      character_book: { entries: bookEntries || [] }
    }
  };
  if (extra) Object.assign(c.data, extra);
  return c;
}

console.log('\n2 — every discarded lorebook field is named');

var notes = App.importLossNotes(cardWith([
  { keys: ['a'], content: 'x', position: 'before_character', priority: 5, scan_depth: 3 },
  { keys: ['b'], content: 'y', use_regex: true, comment: 'hi' }
]));
var droppedNote = notes.filter(function (n) { return n.indexOf('does not use (') !== -1; })[0];
ok('a note names the dropped fields', !!droppedNote, JSON.stringify(notes));
/* v1.40.0: position and priority are READ now (placement and the compat-mode
   budget cut), so naming them as unused would be a false warning. The fields
   still unread are the ones the note must keep naming. */
ok('...but position is read now, so it is not listed',
  droppedNote && droppedNote.indexOf('position') === -1, droppedNote);
ok('...nor priority', droppedNote && droppedNote.indexOf('priority') === -1, droppedNote);
ok('...scan_depth', droppedNote && droppedNote.indexOf('scan_depth') !== -1, droppedNote);
ok('...use_regex', droppedNote && droppedNote.indexOf('use_regex') !== -1, droppedNote);
ok('...comment', droppedNote && droppedNote.indexOf('comment') !== -1, droppedNote);
ok('...and says what entries fire on',
  droppedNote && droppedNote.indexOf('keys, content, constant, stage') !== -1, droppedNote);

var plainNotes = App.importLossNotes(cardWith([{ keys: ['a'], content: 'x', enabled: true }]));
ok('a plain keys/content book gets no dropped-fields note',
  !plainNotes.some(function (n) { return n.indexOf('does not use (') !== -1; }),
  JSON.stringify(plainNotes));

var secNotes = App.importLossNotes(cardWith([{ keys: ['a'], content: 'x', secondary_keys: ['b'], selective: true }]));
ok('secondary keys are matched now, so they are no longer a warning',
  !secNotes.some(function (n) { return n.indexOf('secondary') !== -1; }), JSON.stringify(secNotes));
var logicNotes = App.importLossNotes(cardWith([{ keys: ['a'], content: 'x', selective: true, selectiveLogic: 2 }]));
var logicNote = logicNotes.filter(function (n) { return n.indexOf('selectiveLogic') !== -1; })[0];
ok('selectiveLogic — a SillyTavern field with no spec definition — is named',
  !!logicNote, JSON.stringify(logicNotes));
ok('...and the note states the rule applied instead',
  logicNote && logicNote.indexOf('key from both lists') !== -1, logicNote);
var malformedNotes = App.importLossNotes(cardWith([{ keys: ['a'], content: 'x', selective: 'true' }]));
ok('a non-boolean selective is called malformed, not silently off',
  malformedNotes.some(function (n) { return n.indexOf('malformed') !== -1; }), JSON.stringify(malformedNotes));

console.log('\n3 — the asterisk register is named at import');

function starredCard(starLines, totalLines) {
  var lines = [];
  for (var i = 0; i < totalLines; i++) lines.push(i < starLines ? '*She looks up.* "Hello."' : 'Plain prose line ' + i + '.');
  return cardWith([], { first_mes: lines.join('\n'), mes_example: '' });
}
var starNotes = App.importLossNotes(starredCard(8, 10));
var starNote = starNotes.filter(function (n) { return n.indexOf('opening lines') !== -1; })[0];
ok('an asterisk-heavy card is named', !!starNote, JSON.stringify(starNotes));
ok('...with the count', starNote && starNote.indexOf('8 of 10') !== -1, starNote);
ok('...and the remedy', starNote && starNote.indexOf('Strip the `*` pairs') !== -1, starNote);

var quietNotes = App.importLossNotes(starredCard(1, 10));
ok('a card under 15% gets no asterisk note',
  !quietNotes.some(function (n) { return n.indexOf('opening lines') !== -1; }), JSON.stringify(quietNotes));

var edgeNotes = App.importLossNotes(starredCard(3, 20));
ok('exactly 15% is named', edgeNotes.some(function (n) { return n.indexOf('3 of 20') !== -1; }),
  JSON.stringify(edgeNotes));

var exNotes = App.importLossNotes(cardWith([], {
  first_mes: 'Plain opening.',
  mes_example: '{{user}}: Hi.\n{{char}}: *waves* "Hey."\n{{user}}: Bye.\n{{char}}: *bows* "Bye."'
}));
ok('examples count too, not just the greeting',
  exNotes.some(function (n) { return n.indexOf('opening lines') !== -1; }), JSON.stringify(exNotes));

console.log('\n4 — {{original}} resolves to the global system prompt');

eq('{{original}} becomes the global prompt',
  API.macros('{{original}}, then continue.', { name: 'Ann' }, { userName: 'You', systemPrompt: 'GLOBAL PROMPT' }),
  'GLOBAL PROMPT, then continue.');
eq('...with spaces inside the braces',
  API.macros('{{ original }}', { name: 'Ann' }, { userName: 'You', systemPrompt: 'G' }), 'G');
eq('...and is empty when there is no global prompt',
  API.macros('{{original}}', { name: 'Ann' }, { userName: 'You', systemPrompt: '' }), '');
eq('...and a $ in the prompt is not read as a pattern',
  API.macros('{{original}}', { name: 'Ann' }, { userName: 'You', systemPrompt: 'cost $&5' }), 'cost $&5');
eq('other macros still resolve beside it',
  API.macros('{{char}}: {{original}}', { name: 'Ann' }, { userName: 'You', systemPrompt: 'G' }), 'Ann: G');

console.log('\n1 — bulk import keeps its notes');

toasts = [];
var batch = [
  /* v1.40.0: `position` is modelled now, so it is no longer a silent loss. This
     card keeps a note by carrying a field the app genuinely does not read. */
  cardWith([{ keys: ['a'], content: 'x', scan_depth: 2 }]),
  cardWith([], { system_prompt: 'own prompt' }),
  cardWith([])
];
App.importMany(batch).then(function () {
  var agg = toasts.filter(function (t) { return t.indexOf('carry import notes') !== -1; })[0];
  ok('the batch toast aggregates the notes', !!agg, JSON.stringify(toasts));
  ok('...with the count', agg && agg.indexOf('2 of 3') !== -1, agg);
  ok('...and points at the characters', agg && agg.indexOf('open each character') !== -1, agg);

  toasts = [];
  return App.importMany([cardWith([])]);
}).then(function () {
  ok('a clean batch keeps the plain toast',
    toasts.some(function (t) { return t === 'Imported 1 characters'; }), JSON.stringify(toasts));

  /* the notes are readable from the character menu */
  sheets = [];
  sb.Store.getCharacter = function () {
    return Promise.resolve({ id: 'c1', name: 'Noted', importNotes: ['note one', 'note two'] });
  };
  App.openCharacter('c1');
  return new Promise(function (r) { setTimeout(r, 30); });
}).then(function () {
  var body = sheets.length ? sheets[0].body : '';
  ok('the character menu offers the notes', body.indexOf('Import notes (2)') !== -1, body.slice(0, 200));
  sheets = [];
  sb.Store.getCharacter = function () { return Promise.resolve({ id: 'c2', name: 'Plain' }); };
  App.openCharacter('c2');
  return new Promise(function (r) { setTimeout(r, 30); });
}).then(function () {
  var body2 = sheets.length ? sheets[0].body : '';
  ok('...and only when there are notes', body2.indexOf('Import notes') === -1, body2.slice(0, 200));

  console.log('\n5 — the style lock tells the user, once per chat');

  function historyWith(starsPerReply, turns) {
    var h = [];
    for (var i = 0; i < turns; i++) {
      h.push({ role: 'user', text: 'question ' + i, id: 'u' + i, createdAt: i * 2 });
      var stars = '';
      for (var k = 0; k < starsPerReply; k++) stars += '*x* ';
      h.push({ role: 'assistant', text: stars + 'prose', id: 'a' + i, createdAt: i * 2 + 1 });
    }
    return h;
  }
  function drive(messages, session) {
    App.state = {
      busy: false, screen: 'chat', messages: messages.slice(),
      char: { id: 'c1', name: 'Ann', systemPrompt: '', temperature: null, maxTokens: null, vh: { enabled: false } },
      session: session, groupCharacters: []
    };
    App.generateReply();
    App.state.busy = false;
  }

  toasts = [];
  var sess = { id: 's1', title: 't', sceneCast: [], scenePresent: [], addressedTo: '' };
  drive(historyWith(10, 3), sess);
  var lockToast = toasts.filter(function (t) { return t.indexOf('Style lock:') === 0; })[0];
  ok('the lock firing toasts', !!lockToast, JSON.stringify(toasts));
  ok('...with the asterisk count', lockToast && lockToast.indexOf('60 asterisks') !== -1, lockToast);
  ok('...and says what happened', lockToast && lockToast.indexOf('asked for in plain prose') !== -1, lockToast);
  ok('...without attributing it to the card', lockToast && lockToast.indexOf('Ann') === -1, lockToast);
  eq('the flag is set on the session', sess.styleLockNotified, true);

  toasts = [];
  drive(historyWith(10, 3), sess);
  ok('a second reply does not toast again',
    !toasts.some(function (t) { return t.indexOf('Style lock:') === 0; }), JSON.stringify(toasts));

  toasts = [];
  var sess2 = { id: 's2', title: 't', sceneCast: [], scenePresent: [], addressedTo: '' };
  drive(historyWith(1, 3), sess2);
  ok('a quiet history does not toast',
    !toasts.some(function (t) { return t.indexOf('Style lock:') === 0; }), JSON.stringify(toasts));
  eq('...and the flag stays unset', sess2.styleLockNotified, undefined);

  console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('FAIL harness: ' + (e && e.stack || e));
  process.exit(1);
});
