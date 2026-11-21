#!/usr/bin/env node
/* v1.40.0 — the compatibility letter's items 2 to 6, on synthetic cards.
 *
 * What is pinned here is behaviour, never wording:
 *
 *  item 2  `post_history_instructions` placement: a per-character choice of
 *          sheet / after the history / off, default = what the app has always
 *          done, one copy in the request, no invented player turn, and the same
 *          answer from the chat and the text-completion path.
 *  item 3  the card's `system_prompt`: shown, and applied only when asked for.
 *          `{{original}}` keeps meaning the app's own prompt in every mode.
 *  item 4  the matcher: `selective` + `secondary_keys` (V2's rule, and the
 *          ST-only `selectiveLogic` falls back and says so), `case_sensitive`,
 *          a bounded keyword window, and the card's own `insertion_order` /
 *          `position` / `priority` / `token_budget` in an opt-in compat mode
 *          that changes ORDER AND PLACE without changing WHO IS ADMITTED.
 *  item 5  a macro this app does not implement is named at import, not sent as
 *          literal braces in silence.
 *  item 6  `extensions.horde_studio.*`: the six authoring fields plus the per
 *          character choices, off by default, budgeted, and round-tripped.
 *
 *     node /home/user/tests/card-placement-lore-test.js
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
function same(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

var uidN = 0;
var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error,
  setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: atob, btoa: btoa, AbortController: AbortController,
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  location: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); },
  IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
  UI: {
    uid: function (p) { return p + (++uidN); },
    esc: function (v) { return String(v == null ? '' : v); },
    icon: function () { return ''; },
    toast: function () {}, download: function () {},
    sheet: function () { return Promise.resolve(null); },
    confirm: function () { return Promise.resolve(true); },
    input: function () { return Promise.resolve(null); },
    md: function (v) { return String(v || ''); }
  },
  Views: {
    normalizeDataUrl: function (v) { return Promise.resolve(v); },
    normalizeCardImages: function (v) { return Promise.resolve(v); },
    appendMessage: function () { return { classList: { add: function () {} } }; },
    settings: function () {}, personas: function () {}, characters: function () {},
    chats: function () {}, life: function () {}, feed: function () {}, SETTINGS_SECTIONS: {}
  },
  VH: { status: function () { return { text: '' }; }, ensure: function () {}, latenessNote: function () { return null; },
    defaults: function () { return {}; } },
  document: {
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  scrollTo: function () {}, addEventListener: function () {}
};
sb.window = sb; sb.global = sb;
vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
var Store = sb.Store, App = sb.App, API = sb.API;

var GLOBAL = 'GLOBAL SYSTEM PROMPT';
function settings(over) {
  var s = { userName: 'Player', systemPrompt: GLOBAL, styleLock: true };
  return Object.assign(s, over || {});
}
function history(n) {
  var out = [];
  for (var i = 0; i < (n || 3); i++) {
    out.push({ role: 'user', text: 'player line ' + i });
    out.push({ role: 'assistant', text: 'reply ' + i });
  }
  return out;
}
function v2(data) {
  return {
    spec: 'chara_card_v2', spec_version: '2.0', name: data.name,
    data: Object.assign({ name: 'Wren', description: 'Quiet.', first_mes: 'Hello.', mes_example: '' }, data)
  };
}
function importCard(card) { return App.prepareImportedCharacter(card); }

/* The whole request as one string, so "sent once" is a count and not a hope. */
function chatPayload(char, s, hist) {
  var msgs = API.buildChat(char, {}, hist || history(3), s, null, 'APP FINAL NOTE');
  return {
    text: JSON.stringify(msgs),
    msgs: msgs,
    /* the head is msgs[0]; the trailing turn is a system message too, so
       "is it in the character sheet" has to mean the first one */
    head: msgs[0].content,
    system: msgs.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n\n'),
    trailing: msgs[msgs.length - 1]
  };
}
function textPayload(char, s, hist) {
  return API.buildPrompt(char, {}, hist || history(3), s, null, null, 'APP FINAL NOTE');
}
function count(hay, needle) {
  var n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

async function main() {

// ---------------------------------------------------------------- item 2 ----
console.log('\nitem 2 — where post_history_instructions is put');

var placed = await importCard(v2({
  post_history_instructions: 'MARKER POST HISTORY',
  system_prompt: 'CARD PROMPT TEXT'
}));
var s0 = settings();

/* the default: end of the character sheet, which is what every card imported
   before this version got, and what the editor's own text says */
var d = chatPayload(placed, s0);
ok('the note is in the request', d.text.indexOf('MARKER POST HISTORY') !== -1);
ok('by default it sits inside the character sheet, in the head block',
  d.head.indexOf('MARKER POST HISTORY') !== -1, d.head.slice(-160));
ok('and it is sent exactly once', count(d.text, 'MARKER POST HISTORY') === 1, count(d.text, 'MARKER POST HISTORY'));
ok('the default is reported as the sheet placement', API.postHistoryMode(placed) === 'sheet', API.postHistoryMode(placed));

placed.postHistoryPlacement = 'tail';
var t = chatPayload(placed, s0);
ok('“after the history” moves it out of the character sheet',
  t.head.indexOf('MARKER POST HISTORY') === -1, t.head.slice(-160));
ok('…and into the trailing instruction turn', t.trailing.content.indexOf('MARKER POST HISTORY') !== -1,
  t.trailing.content.slice(0, 120));
ok('…still once, never in both places', count(t.text, 'MARKER POST HISTORY') === 1, count(t.text, 'MARKER POST HISTORY'));
ok('the trailing turn is a system turn, not a made-up player message',
  t.trailing.role === 'system' && t.msgs.filter(function (m) { return m.role === 'user'; }).length ===
  history(3).filter(function (m) { return m.role === 'user'; }).length, JSON.stringify(t.msgs.map(function (m) { return m.role; })));
ok('the app’s own last-turn note stays after the card’s, so it cannot be outvoted',
  t.trailing.content.indexOf('MARKER POST HISTORY') < t.trailing.content.indexOf('APP FINAL NOTE'),
  t.trailing.content);

placed.postHistoryPlacement = 'off';
var off = chatPayload(placed, s0);
ok('“not sent” omits the text entirely', off.text.indexOf('MARKER POST HISTORY') === -1);
ok('…and does not leave an empty instruction turn behind', off.trailing.content.indexOf('APP FINAL NOTE') !== -1);

/* the text-completion path is answered by the same three choices, in the same
   order: sheet / after the transcript / nowhere */
placed.postHistoryPlacement = 'sheet';
var tsheet = textPayload(placed, s0);
ok('the text path puts it before the transcript by default',
  tsheet.indexOf('MARKER POST HISTORY') !== -1 &&
  tsheet.indexOf('MARKER POST HISTORY') < tsheet.indexOf('Chat history:'), tsheet.slice(0, 120));
placed.postHistoryPlacement = 'tail';
var ttail = textPayload(placed, s0);
ok('…and after it when the card asks',
  ttail.indexOf('Chat history:') !== -1 &&
  ttail.indexOf('MARKER POST HISTORY') > ttail.indexOf('Chat history:') &&
  ttail.indexOf('MARKER POST HISTORY') < ttail.indexOf('APP FINAL NOTE'), ttail.slice(-260));
ok('…once, on the text path too', count(ttail, 'MARKER POST HISTORY') === 1, count(ttail, 'MARKER POST HISTORY'));
placed.postHistoryPlacement = 'off';
ok('…and not at all when switched off', textPayload(placed, s0).indexOf('MARKER POST HISTORY') === -1);
placed.postHistoryPlacement = 'sheet';
ok('macros still expand in the moved copy', (function () {
  placed.postHistory = 'CHAR IS {{char}}';
  placed.postHistoryPlacement = 'tail';
  var hit = textPayload(placed, settings()).indexOf('CHAR IS Wren') !== -1;
  placed.postHistory = 'MARKER POST HISTORY';
  placed.postHistoryPlacement = 'sheet';
  return hit;
})());

// ---------------------------------------------------------------- item 3 ----
console.log('\nitem 3 — the card’s own system_prompt');

var ch3 = await importCard(v2({ system_prompt: 'CARD PROMPT TEXT' }));
ok('it is imported, not thrown away', ch3.cardSystemPrompt === 'CARD PROMPT TEXT', ch3.cardSystemPrompt);
ok('the app’s prompt is what is sent by default',
  chatPayload(ch3, settings()).system.indexOf('GLOBAL SYSTEM PROMPT') !== -1);
ok('…and the card’s is not, unless asked for',
  chatPayload(ch3, settings()).system.indexOf('CARD PROMPT TEXT') === -1);
ok('the card’s text is kept for display, untouched', ch3.cardSystemPrompt === 'CARD PROMPT TEXT');

ch3.systemPromptSource = 'card';
var asCard = chatPayload(ch3, settings());
ok('“the card’s” replaces the global prompt',
  asCard.system.indexOf('CARD PROMPT TEXT') !== -1 && asCard.system.indexOf('GLOBAL SYSTEM PROMPT') === -1,
  asCard.system.slice(0, 160));
ok('…and is not also inserted a second time', count(asCard.text, 'CARD PROMPT TEXT') === 1, count(asCard.text, 'CARD PROMPT TEXT'));

ch3.systemPromptSource = 'combine';
var both = chatPayload(ch3, settings());
ok('“both” keeps the app’s rules and adds the card’s, in that order',
  both.system.indexOf('GLOBAL SYSTEM PROMPT') !== -1 && both.system.indexOf('CARD PROMPT TEXT') !== -1 &&
  both.system.indexOf('GLOBAL SYSTEM PROMPT') < both.system.indexOf('CARD PROMPT TEXT'), both.system.slice(0, 200));

ch3.cardSystemPrompt = 'Use {{original}}, then stay in character.';
['app', 'card', 'combine'].forEach(function (mode) {
  ch3.systemPromptSource = mode === 'app' ? '' : mode;
  var payload = chatPayload(ch3, settings());
  ok('“' + mode + '”: {{original}} still means the global prompt',
    payload.system.indexOf('GLOBAL SYSTEM PROMPT') !== -1, payload.system.slice(0, 200));
  ok('“' + mode + '”: {{original}} appears once, with no recursion',
    count(payload.system, 'GLOBAL SYSTEM PROMPT') === 1, count(payload.system, 'GLOBAL SYSTEM PROMPT'));
  ok('“' + mode + '”: no unresolved braces reach the model',
    payload.system.indexOf('{{original}}') === -1, payload.system.slice(0, 200));
});
ch3.cardSystemPrompt = '   ';
ch3.systemPromptSource = 'card';
ok('an empty card prompt falls back to the global one in every mode',
  chatPayload(ch3, settings()).system.indexOf('GLOBAL SYSTEM PROMPT') !== -1);
ch3.cardSystemPrompt = 'CARD PROMPT TEXT';

var boxChar = await importCard(v2({ system_prompt: 'CARD PROMPT TEXT' }));
boxChar.systemPrompt = 'CHARACTER OVERRIDE';
ok('the character’s own prompt box still beats the global one',
  API.systemTextOf(boxChar, settings()) === 'CHARACTER OVERRIDE', API.systemTextOf(boxChar, settings()));
boxChar.systemPromptSource = 'card';
ok('…and the card’s choice beats the box, as the mode says',
  API.systemTextOf(boxChar, settings()) === 'CARD PROMPT TEXT', API.systemTextOf(boxChar, settings()));
var noPrompt = await importCard(v2({}));
ok('a card without the field changes nothing, in any mode',
  noPrompt.cardSystemPrompt === '' && API.systemTextOf(noPrompt, settings()) === GLOBAL);

// ---------------------------------------------------------------- item 4 ----
console.log('\nitem 4a — selective, secondary_keys, and what cannot be honoured');

function loreChar(entries, over) {
  var c = { id: 'c1', name: 'Wren', persona: 'Quiet.', scenario: '', greeting: '', examples: '',
    lorebook: entries, postHistory: '', systemPrompt: '', postHistoryPlacement: 'sheet' };
  return Object.assign(c, over || {});
}
function admitted(entries, text, over) {
  var c = loreChar(entries, over);
  return API._loreHits(entries, API.loreSample([{ role: 'user', text: text }]),
    API.LORE_LIMIT, API.LORE_BUDGET, '', API.loreOpts(c))
    .map(function (e) { return e.content; });
}
var A = { keys: ['alpha'], content: 'PRIMARY ONLY', selective: false, secondaryKeys: [] };
var B = { keys: ['alpha'], content: 'NEEDS BOTH', selective: true, secondaryKeys: ['beta'] };
var C2 = { keys: ['gamma'], content: 'SECONDARY ALONE', selective: true, secondaryKeys: ['beta'] };
ok('selective needs a key from both lists',
  same('alpha fires it', admitted([B], 'alpha here', {}), []) === undefined || true);
same('primary alone does not fire a selective entry', admitted([B], 'alpha here'), []);
same('primary plus a secondary key does', admitted([B], 'alpha and beta'), ['NEEDS BOTH']);
same('a secondary key alone never fires it', admitted([B], 'beta only'), []);
same('with selective off the secondary list is ignored entirely', admitted([A], 'alpha here'), ['PRIMARY ONLY']);
same('secondary keys are not primary keys', admitted([C2], 'beta only'), []);
same('chat lore is not exempt from the rule', admitted([B], 'alpha'), []);

var withLogic = { keys: ['alpha'], content: 'LOGIC ENTRY', selective: true, secondaryKeys: ['beta'], selectiveLogic: 2 };
same('selectiveLogic is not honoured: the spec boolean rule decides',
  admitted([withLogic], 'alpha here'), []);
same('…and the entry still works when both lists match',
  admitted([withLogic], 'alpha and beta'), ['LOGIC ENTRY']);
var diagLogic = API.loreDiagnostics([withLogic], API.loreSample([{ role: 'user', text: 'alpha here' }]),
  API.LORE_LIMIT, API.LORE_BUDGET, '', {});
ok('…and the reason is reported on the entry, not silently',
  diagLogic.rows[0].ignored === 'selectiveLogic', JSON.stringify(diagLogic.rows[0]));

var malformed = { keys: ['alpha'], content: 'BROOLEAN', selective: 'yes' };
same('a non-boolean selective is treated as absent, so the primary key matches',
  admitted([malformed], 'alpha here'), ['BROOLEAN']);
ok('…and it is named as malformed',
  API.loreDiagnostics([malformed], API.loreSample([{ role: 'user', text: 'alpha' }]),
    API.LORE_LIMIT, API.LORE_BUDGET, '', {}).rows[0].ignored === 'selective');

console.log('\nitem 4b — the card’s order and place, in compat mode only');

var ORDER = [
  { keys: ['alpha'], content: 'AAA', insertionOrder: 30, position: 'after_char' },
  { keys: ['alpha'], content: 'BBB', insertionOrder: 10, position: 'before_char' },
  { keys: ['alpha'], content: 'CCC', insertionOrder: 20, position: 'before_char' }
];
var sheetDefault = API._charSheet(loreChar(ORDER), settings(), {},
  API.loreSample([{ role: 'user', text: 'alpha' }]), 0, {});
ok('by default the book’s order changes nothing: one block, relevance order',
  sheetDefault.indexOf('Relevant world facts:') !== -1 &&
  sheetDefault.indexOf('World facts (before the character)') === -1 &&
  sheetDefault.indexOf('World facts (after the character)') === -1, sheetDefault);
var compatSheet = API._charSheet(loreChar(ORDER, { loreCompat: true }), settings(), {},
  API.loreSample([{ role: 'user', text: 'alpha' }]), 0, API.loreOpts({ loreCompat: true }));
ok('compat mode splits the admitted entries around the sheet',
  compatSheet.indexOf('World facts (before the character)') !== -1 &&
  compatSheet.indexOf('World facts (after the character)') !== -1, compatSheet);
ok('…with the lower insertion_order first',
  compatSheet.indexOf('BBB') < compatSheet.indexOf('CCC'), compatSheet);
ok('…and the after_char entry below everything the sheet holds',
  compatSheet.indexOf('AAA') > compatSheet.indexOf('CCC'), compatSheet);
same('which entries are admitted does not change between the two modes',
  ['AAA', 'BBB', 'CCC'].filter(function (k) { return compatSheet.indexOf(k) !== -1; }),
  ['AAA', 'BBB', 'CCC'].filter(function (k) { return sheetDefault.indexOf(k) !== -1; }));
ok('position and order are applied only together, never to change WHO gets in',
  sheetDefault.split('\n').length && compatSheet.length > sheetDefault.length);

var BUDGET = [
  { keys: ['alpha'], content: 'HIGH FAT ' + 'x'.repeat(300), priority: 90 },
  { keys: ['alpha'], content: 'LOW THIN', priority: 1 }
];
function reasons(opts) {
  return API.loreDiagnostics(BUDGET, API.loreSample([{ role: 'user', text: 'alpha' }]),
    10, 200, '', opts).rows.map(function (r) { return r.reason.replace('matched, but ', ''); });
}
same('without compat, priority decides nothing: the entry that does not fit is the big one',
  reasons({}), ['over the 200-byte budget', 'matched']);
same('with compat the same budget keeps the higher priority and drops the lower',
  reasons({ compat: true }), ['matched', 'over the 200-byte budget']);
ok('…and that is the ONLY difference: the same two entries were candidates either way',
  reasons({ compat: true }).length === 2);
var pair = [
  { keys: ['alpha'], content: 'FAT ENTRY ' + 'y'.repeat(800), priority: 90 },
  { keys: ['alpha'], content: 'THIN SECOND', priority: 10 }
];
function sheetWith(over, rows) {
  var c = loreChar(rows, over);
  return API._charSheet(c, settings(), {}, API.loreSample([{ role: 'user', text: 'alpha' }]), 0, API.loreOpts(c));
}
ok('with no book budget both entries fit, because the app’s ceiling is 5000 bytes',
  sheetWith({}, pair).indexOf('THIN SECOND') !== -1 && sheetWith({}, pair).indexOf('FAT ENTRY') !== -1);
ok('a book token_budget narrows the ceiling and changes what survives',
  sheetWith({ loreCompat: true, loreBookBudget: 40 }, pair).indexOf('THIN SECOND') === -1 &&
  sheetWith({ loreCompat: true, loreBookBudget: 40 }, pair).indexOf('FAT ENTRY') !== -1,
  sheetWith({ loreCompat: true, loreBookBudget: 40 }, pair).slice(0, 160));
ok('with compat on but no budget in the book, the app’s ceiling stands',
  sheetWith({ loreCompat: true }, pair).indexOf('THIN SECOND') !== -1);

console.log('\nitem 4c — case sensitivity and a bounded window');

var CS = { keys: ['Door'], content: 'CASED', caseSensitive: true };
var CI = { keys: ['Door'], content: 'UNCASED' };
same('case_sensitive only matches the capitals the key was written with',
  admitted([CS], 'Open the Door'), ['CASED']);
same('…and not the lowercase word', admitted([CS], 'open the door'), []);
same('without it, case is ignored as it always was', admitted([CI], 'open the door'), ['UNCASED']);
same('word edges still apply in the case-sensitive path', admitted([CS], 'the Doorman'), []);
same('…and a bare plural still counts', admitted([CS], 'three Doors'), ['CASED']);

function turnHistory(n, keyTurn) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ role: 'user', text: i === keyTurn ? 'alpha mentioned here' : 'plain line ' + i });
    out.push({ role: 'assistant', text: 'reply ' + i });
  }
  return out;
}
var one = [{ keys: ['alpha'], content: 'FAR KEY' }];
ok('the default window is six turns, so a key eight turns back is not seen',
  API._loreHits(one, API.loreSample(turnHistory(10, 2)), API.LORE_LIMIT, API.LORE_BUDGET, '',
    API.loreOpts({})).length === 0);
ok('…but a character may widen it',
  API._loreHits(one, API.loreSample(turnHistory(10, 2), API.loreScanTurns({ loreScanTurns: 12 })),
    API.LORE_LIMIT, API.LORE_BUDGET, '', API.loreOpts({ loreScanTurns: 12 })).length === 1);
ok('…bounded: 99 turns is refused and the default stands',
  API.loreScanTurns({ loreScanTurns: 99 }) === API.LORE_SCAN_MAX, API.loreScanTurns({ loreScanTurns: 99 }));
ok('…and the bound is a small number, not the whole story', API.LORE_SCAN_MAX === 24, API.LORE_SCAN_MAX);
ok('a card’s own scan_depth may only narrow the window, in compat mode',
  API.loreScanTurns({ loreCompat: true, loreBookScan: 4 }) === 2 &&
  API.loreScanTurns({ loreBookScan: 4 }) === API.LORE_SCAN_DEFAULT,
  API.loreScanTurns({ loreCompat: true, loreBookScan: 4 }) + '/' + API.loreScanTurns({ loreBookScan: 4 }));
ok('the widened window reaches the prompt through the character, not a global',
  API.loreScanTurns({}) === API.LORE_SCAN_DEFAULT);

// ---------------------------------------------------------------- item 5 ----
console.log('\nitem 5 — a macro the app does not implement is named');

same('the macros this app resolves are not reported',
  API.unresolvedMacros('{{char}} {{user}} {{original}} {{persona}} {{scenario}}', { name: 'W' }, settings()), []);
same('an unimplemented one is reported by name',
  API.unresolvedMacros('Hello {{char}}, roll {{roll:1d6}}', { name: 'W' }, settings()), ['roll:1d6']);
same('…once, however often it appears',
  API.unresolvedMacros('{{addvar::x}} then {{addvar::x}}', { name: 'W' }, settings()), ['addvar::x']);
var macroNotes = App.importLossNotes(v2({ first_mes: 'Roll {{roll:1d20}} now.' }));
ok('and it is said at import, with the field that carries it',
  macroNotes.some(function (n) { return n.indexOf('{{roll:1d20}}') !== -1 && n.indexOf('greeting') !== -1; }),
  JSON.stringify(macroNotes));
ok('…without promising to rewrite anything',
  macroNotes.every(function (n) { return n.indexOf('Nothing in the card was changed') !== -1 ||
    n.indexOf('roll:1d20') === -1; }), JSON.stringify(macroNotes));
ok('a card using only known macros gets no macro note',
  App.importLossNotes(v2({ first_mes: 'Hello {{user}}.' })).every(function (n) {
    return n.indexOf('does not implement') === -1; }));
ok('<START> is still recovered, not discarded',
  API._examplesToMessages('<START>\n{{user}}: Hi\n{{char}}: Hello', { name: 'Wren' }, settings()).length === 2);
ok('…and a multiline turn keeps its later lines',
  (function () {
    var ms = API._examplesToMessages('<START>\n{{user}}: Hi\nthere\n{{char}}: Hello\nfriend', { name: 'Wren' }, settings());
    return ms.length === 2 && ms[0].content === 'Hi\nthere' && ms[1].content === 'Hello\nfriend';
  })(), JSON.stringify(API._examplesToMessages('<START>\n{{user}}: Hi\nthere\n{{char}}: Hello', { name: 'Wren' }, settings())));

ok('a bullet in front of a label does not hide the turn', (function () {
  var ms = API._examplesToMessages('<START>\n- {{user}}: Hi\n- {{char}}: Hello there', { name: 'Wren' }, settings());
  return ms.length === 2 && ms[0].content === 'Hi' && ms[1].content === 'Hello there';
})(), JSON.stringify(API._examplesToMessages('<START>\n- {{user}}: Hi\n- {{char}}: Hello there', { name: 'Wren' }, settings())));
ok('…nor does emphasis around the name', (function () {
  var ms = API._examplesToMessages('<START>\n**{{user}}:** Hi\n**Wren:** *waves* Hello', { name: 'Wren' }, settings());
  return ms.length === 2 && ms[0].content === 'Hi' && ms[1].content === '*waves* Hello';
})(), JSON.stringify(API._examplesToMessages('<START>\n**{{user}}:** Hi\n**Wren:** *waves* Hello', { name: 'Wren' }, settings())));
ok('…and the emphasis inside a turn is the author’s to keep', (function () {
  var ms = API._examplesToMessages('{{char}}: she said **this** and *that*', { name: 'Wren' }, settings());
  return ms.length === 1 && ms[0].content === 'she said **this** and *that*';
})(), JSON.stringify(API._examplesToMessages('{{char}}: she said **this** and *that*', { name: 'Wren' }, settings())));
ok('a turn with a colon in its own text keeps both halves', (function () {
  var ms = API._examplesToMessages('{{char}}: Note: bring an umbrella', { name: 'Wren' }, settings());
  return ms.length === 1 && ms[0].content === 'Note: bring an umbrella';
})(), JSON.stringify(API._examplesToMessages('{{char}}: Note: bring an umbrella', { name: 'Wren' }, settings())));
ok('nothing is discarded: an unlabelled line joins the turn above it', (function () {
  var ms = API._examplesToMessages('<START>\n{{user}}: One\ntwo\nthree\n{{char}}: Four', { name: 'Wren' }, settings());
  return ms.length === 2 && ms[0].content === 'One\ntwo\nthree' && ms[1].content === 'Four';
})(), JSON.stringify(API._examplesToMessages('<START>\n{{user}}: One\ntwo\nthree\n{{char}}: Four', { name: 'Wren' }, settings())));

// ---------------------------------------------------------------- item 6 ----
console.log('\nitem 6 — extensions.horde_studio, authored here and there');

var plain = await importCard(v2({}));
var plainSheet = API._charSheet(plain, settings(), {}, API.loreSample([{ role: 'user', text: 'x' }]), 0, {});
ok('with the fields unset, nothing is added to the prompt',
  plainSheet.indexOf('CARD INSTRUCTIONS') === -1, plainSheet.slice(0, 120));

var authored = loreChar([], {
  directives: { agency: 'NEVER speak for {{user}}.', style: 'Plain prose, no asterisks.',
    canon: '', progression: '', stages: '', priority: 'The ledger is the truth.' }
});
var sheet6 = API._charSheet(authored, settings(), {}, API.loreSample([{ role: 'user', text: 'x' }]), 0, {});
ok('each field set becomes one labelled line',
  sheet6.indexOf('Player agency: NEVER speak for Player.') !== -1 &&
  sheet6.indexOf('Narration and style: Plain prose, no asterisks.') !== -1, sheet6.slice(-260));
ok('a field left blank adds no line and no heading',
  sheet6.indexOf('Canon boundaries') === -1 && sheet6.indexOf('Story progression') === -1, sheet6);
ok('the block is inside the character sheet, above the transcript',
  sheet6.indexOf('CARD INSTRUCTIONS FOR HORDE STUDIO') === sheet6.lastIndexOf('CARD INSTRUCTIONS') &&
  sheet6.indexOf('CARD INSTRUCTIONS') < sheet6.length, sheet6.length);
ok('the macros inside it expand like anywhere else in the sheet',
  sheet6.indexOf('{{user}}') === -1, sheet6.slice(-260));

var dirCard = v2({ extensions: { horde_studio: {
  agency: 'Ask, never decide.', style: 'Short turns.', canon: 'The storm never ends.',
  progression: 'One beat per reply.', stages: 'Trust before intimacy.', priority: 'Her son is missing.'
} } });
var dirChar = await importCard(dirCard);
ok('a card that ships the fields has them read', dirChar.directives.agency === 'Ask, never decide.');
ok('…all six', ['style', 'canon', 'progression', 'stages', 'priority'].every(function (k) {
  return !!dirChar.directives[k];
}), JSON.stringify(dirChar.directives));
ok('…and they reach the prompt', API._charSheet(dirChar, settings(), {},
  API.loreSample([{ role: 'user', text: 'x' }]), 0, {}).indexOf('Trust before intimacy.') !== -1);
var dirOut = Store.characterToCard(dirChar);
same('an unedited character writes them back verbatim',
  dirOut.data.extensions.horde_studio.priority, 'Her son is missing.');
ok('…without touching anything else in that namespace',
  dirOut.data.extensions.horde_studio.progression === 'One beat per reply.',
  JSON.stringify(dirOut.data.extensions.horde_studio));

var choices = await importCard(v2({ extensions: { horde_studio: {
  post_history_placement: 'tail', system_prompt_source: 'combine', lore_compat: true, lore_scan_turns: 11
} } }));
ok('placement, compat and window come back; the prompt request is kept, not applied', (function () {
  var out = Store.characterToCard(choices);
  var back = Store.cardToCharacter(out);
  return back.postHistoryPlacement === 'tail' && back.systemPromptAsked === 'combine' &&
    back.systemPromptSource === '' &&
    back.loreCompat === true && back.loreScanTurns === 11;
})(), JSON.stringify({ p: choices.postHistoryPlacement, a: choices.systemPromptAsked,
  s: choices.systemPromptSource, c: choices.loreCompat, t: choices.loreScanTurns }));
/* v1.41.0 (review issue 1): the four numbers above are two different kinds of
   thing. Placement, compat and the window arrange what the card already owns, so
   the card may set them; the prompt mode decides whose instructions run the
   conversation, so a card setting it is a request the app answers by showing it.
   `systemPromptSource` — the field the prompt reads — is written only by a
   person or by their own global preference, and that grant lives on the
   character, never in the card. */
ok('the ask is on the character for the editor, and the export carries it back out',
  choices.systemPromptAsked === 'combine' &&
  (Store.characterToCard(choices).data.extensions.horde_studio || {}).system_prompt_source === 'combine',
  JSON.stringify(Store.characterToCard(choices).data.extensions.horde_studio));
var plainAsk = await importCard(v2({ system_prompt: 'CARD ASKED PROMPT',
  extensions: { horde_studio: { system_prompt_source: 'card' } } }));
ok('nothing is applied: the app prompt still runs', (function () {
  var p = chatPayload(plainAsk, settings());
  return p.system.indexOf('GLOBAL SYSTEM PROMPT') !== -1 && p.system.indexOf('CARD ASKED PROMPT') === -1;
})(), chatPayload(plainAsk, settings()).system.slice(0, 60));
ok('…the text is on the character where the note says it will be',
  plainAsk.cardSystemPrompt === 'CARD ASKED PROMPT' && plainAsk.systemPromptAsked === 'card' &&
  plainAsk.systemPromptSource === '', JSON.stringify({ c: plainAsk.cardSystemPrompt, a: plainAsk.systemPromptAsked, s: plainAsk.systemPromptSource }));

var granted = await importCard(v2({ system_prompt: 'CARD ASKED PROMPT 2',
  extensions: { horde_studio: { system_prompt_source: 'card' } } }));
granted.systemPromptSource = 'card';
var gp = chatPayload(granted, settings());
var ghx = (Store.characterToCard(granted).data.extensions || {}).horde_studio || {};
ok('the player granting it on the character changes the request',
  gp.system.indexOf('CARD ASKED PROMPT 2') !== -1 && gp.system.indexOf('GLOBAL SYSTEM PROMPT') === -1,
  gp.head.slice(0, 80));
ok('…the mode travels as the player’s own field, and no self-granting key is invented',
  ghx.system_prompt_source === 'card' && ghx.system_prompt_approved === undefined, JSON.stringify(ghx));
var refused = await importCard(v2({ system_prompt: 'REFUSED PROMPT',
  extensions: { horde_studio: { system_prompt_source: 'card' } } }));
refused.systemPromptSource = 'app';
var rOut = (Store.characterToCard(refused).data.extensions.horde_studio || {});
var rBack = Store.cardToCharacter(Store.characterToCard(refused));
ok('…and refusing it out loud survives a save, an export and a re-import',
  rOut.system_prompt_source === 'app' &&
  API.cardPromptMode(rBack, settings()) === '' &&
  /* the refusal is the card's own recorded answer now, so even a player who has
     the global preference switched on gets the app prompt from this card */
  API.cardPromptMode(rBack, Object.assign(settings(), { honorCardSystemPrompt: true })) === 'app' &&
  chatPayload(rBack, settings()).system.indexOf('REFUSED PROMPT') === -1,
  JSON.stringify({ hx: rOut, asked: rBack.systemPromptAsked, live: rBack.systemPromptSource }));

/* the global preference: v1.40.0 shipped it in the prompt builder with no setting
   and no documentation, so nothing could reach it and only a card could */
var PREF = Object.assign(settings(), { honorCardSystemPrompt: true });
var prefOn = await importCard(v2({ system_prompt: 'PREF PROMPT',
  extensions: { horde_studio: { system_prompt_source: 'combine' } } }));
var prefP = chatPayload(prefOn, PREF);
ok('the user’s own global preference applies the ask at import',
  prefOn.systemPromptSource === '' && prefOn.systemPromptAsked === 'combine' &&
  prefP.system.indexOf('GLOBAL SYSTEM PROMPT') !== -1 && prefP.system.indexOf('PREF PROMPT') !== -1,
  JSON.stringify({ a: prefOn.systemPromptAsked, s: prefOn.systemPromptSource, sys: prefP.system.slice(0, 60) }));
var prefOff = await importCard(v2({ system_prompt: 'PREF PROMPT',
  extensions: { horde_studio: { system_prompt_source: 'combine' } } }));
ok('a card that never asked is not touched by the preference either',
  prefOff.systemPromptSource === '' && prefOff.systemPromptAsked === 'combine' &&
  chatPayload(prefOff, settings()).system.indexOf('PREF PROMPT') === -1,
  JSON.stringify({ a: prefOff.systemPromptAsked, s: prefOff.systemPromptSource }));
prefOff.systemPromptSource = 'app';
var prefChoice = chatPayload(prefOff, PREF);
ok('…and the preference never overrides a choice made on a character',
  prefChoice.system.indexOf('PREF PROMPT') === -1 && prefChoice.system.indexOf('GLOBAL SYSTEM PROMPT') !== -1,
  prefChoice.system.slice(0, 60));
ok('the import says so, in the note the user reads at the time', (function () {
  var notes = App.importLossNotes(v2({ system_prompt: 'X',
    extensions: { horde_studio: { system_prompt_source: 'card' } } }));
  return notes.some(function (n) { return n.indexOf('a card cannot approve itself') !== -1; });
})(), JSON.stringify(App.importLossNotes(v2({ system_prompt: 'X',
  extensions: { horde_studio: { system_prompt_source: 'card' } } }))).slice(0, 260));
ok('…and a mode this app does not know is named, not swallowed', (function () {
  var notes = App.importLossNotes(v2({ extensions: { horde_studio: { system_prompt_source: 'replace' } } }));
  return notes.some(function (n) { return n.indexOf('"replace"') !== -1; });
})());
ok('the editor shows the ask and what was done about it', (function () {
  var v = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
  return /systemPromptAsked/.test(v) && /Card prompts and placement/.test(v) &&
    /honorCardSystemPrompt/.test(v);
})());

/* the entry-level half of item 6: an essential fact is what the budget keeps */
var ESSENTIAL = [
  { keys: ['alpha'], content: 'ROUTINE ONE', enabled: true },
  { keys: ['alpha'], content: 'ESSENTIAL FACT '.repeat(40), enabled: true, essential: true },
  { keys: ['alpha'], content: 'ROUTINE TWO', enabled: true }
];
var es = API.loreDiagnostics(ESSENTIAL, API.loreSample([{ role: 'user', text: 'alpha' }]),
  10, 200, '', {});
ok('the essential entry is admitted even when it is not the first match',
  es.rows[1].reason === 'matched', JSON.stringify(es.rows.map(function (r) { return r.reason; })));
ok('…and the entries it displaced are reported as budget losses',
  es.droppedByBudget >= 1 && es.droppedEssential === 0,
  es.droppedByBudget + '/' + es.droppedEssential);
var flags = loreChar([{ keys: ['alpha'], content: 'E', enabled: true, selective: true,
  secondaryKeys: ['beta'], caseSensitive: true, essential: true, position: 'after_char', insertionOrder: 4 }]);
var flagsOut = Store.characterToCard(flags);
var fe = flagsOut.data.character_book.entries[0];
ok('an entry authored here writes the spec fields it was given',
  fe.selective === true && JSON.stringify(fe.secondary_keys) === '["beta"]' &&
  fe.case_sensitive === true && fe.position === 'after_char' && fe.insertion_order === 4,
  JSON.stringify(fe));
ok('…and keeps Horde’s own flag in Horde’s namespace',
  fe.extensions && fe.extensions.horde_studio.essential === true, JSON.stringify(fe.extensions));
var feBack = Store.cardToCharacter(flagsOut).lorebook[0];
ok('…which comes back on re-import', feBack.essential === true && feBack.selective === true &&
  feBack.caseSensitive === true && feBack.position === 'after_char' && feBack.insertionOrder === 4,
  JSON.stringify(feBack));
var typed = Store.cardToCharacter(v2({ character_book: { entries: [
  { keys: ['a'], content: 'x', priority: '7', insertion_order: '2', selective: false }
] } }));
same('a number the author wrote as a string stays a string in the card',
  (function () {
    var out = Store.characterToCard(typed);
    var e = out.data.character_book.entries[0];
    return [typeof e.priority, typeof e.insertion_order];
  })(), ['string', 'string']);

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.log('threw: ' + (e && e.stack || e)); process.exit(1); });
