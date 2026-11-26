#!/usr/bin/env node
/* A chat's memory can be the model's raw JSON answer, kept as prose.

   Reported from a screenshot of the Chats tab (v1.48.4): one row's description read

       THE DEATH T…        11/12/2026
       { "summary": "Blu …

   That is not a rendering fault. `Store` holds the whole JSON reply in
   `session.summary` — a shape stored before v1.39.106 taught the summariser's
   reader to salvage it, or typed into the Memory field, which keeps whatever it
   is given — and `Views.chats` prints `s.summary.slice(0, 90)` without asking
   what it is. The row is the only thing telling the player what that chat is
   about, so it said: braces, quotes, key names. Worse, the same string is
   injected into every later prompt as "the story so far".

   Two rules had to meet and did not. `API.proseOnly` has recognised this shape
   since v1.39.106 — it is how a cut-off answer is salvaged — while
   `API.memoryLooksBroken`, the one the Memory sheet consults to warn the
   player, only noticed text under 24 characters or a refusal. So the wreckage
   was long enough to pass as a summary and printed as one, everywhere.

   So the fix is one predicate both sides call, and this file keeps it that
   way: it asserts the PAIRING over a corpus (anything the salvage path would
   rewrite must be something the warning flags), that recovery hands back what
   is inside the wrapper without saving it, that the chats list falls back to
   the message count when the memory is unreadable — the real view rendered —
   and that the sheet's own text still explains itself to a human.

   Usage: node tests/memory-wreckage-test.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var APP = path.join(ROOT, 'horde-studio-mobile');
var JS = path.join(APP, 'js');
var apiSrc = stripComments(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'));
var appSrc = stripComments(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'));

function stripComments(t) {
  return String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}
function sliceSrc(src, head) {
  var start = src.indexOf(head);
  if (start === -1) return '';
  var end = src.indexOf('\n  }', start);
  return src.slice(start, end === -1 ? src.length : end);
}
/* a slice that ENDS somewhere specific: the sheet is one long expression, so
   "everything after the marker" would prove nothing about scope */
function between(src, startText, endText) {
  var a = src.indexOf(startText), b = src.indexOf(endText, a);
  if (a === -1 || b === -1) return '';
  return src.slice(a, b + endText.length);
}

/* ---------------- the engine, loaded for real ---------------- */
var sb = {
  Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
  String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
  setTimeout: function () {},
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  location: { hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
sb.window = sb;
vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
var API = sb.API;

var WRECK = [
  /* the shape in the screenshot: pretty-printed, spaces after the braces */
  '{ "summary": "Blu confesses in the hallway and Mika does not pull away.", "facts": [ "Mika sleeps on the third floor" ] }',
  '{"summary":"Blu admits it under the stairlight.","facts":["Mika is the stepsister"]}',
  '```json\n{"summary":"They argue by the door until the hallway light goes out.","facts":[]}\n```',
  'Here is the summary: {"summary":"The gate holds through the night and nobody is thanked for it.","facts":[]}',
  /* cut off by the token ceiling: the summary is whole, the facts are not */
  '{"summary":"Mika packs in the dark and Blu listens from the other side of the door.","facts":["The train is at six'
];
var PROSE = [
  'The gate holds through the night and nobody is thanked for it.',
  'Here is a summary: the mill burned, and they both pretended that was the weather.',
  'Mira: leans on the doorframe. "He is late."',
  'No transcript was provided, so there is nothing to summarize here at all.'   /* a refusal, not a wrapper */
];

console.log('\none question, asked once, about a stored memory');
ok('the engine answers it for a wrapper', WRECK.every(function (t) { return API.memoryIsWrapper(t); }));
ok('…and never for prose, not even prose that mentions a summary',
  PROSE.every(function (t) { return !API.memoryIsWrapper(t); }));
ok('the warning is the same call, not a paraphrase of it',
  /memoryIsWrapper\(t\)/.test(sliceSrc(apiSrc, 'function memoryLooksBroken')),
  sliceSrc(apiSrc, 'function memoryLooksBroken'));
ok('…and an ordinary summary is never called broken by it',
  PROSE.slice(0, 3).every(function (t) { return API.memoryLooksBroken(t) === false; }),
  PROSE.slice(0, 3).filter(function (t) { return API.memoryLooksBroken(t); }).join(' | '));
/* the pairing that actually broke: anything the reader would rewrite had to be
   something the warning flags, or the wreckage reaches the screen unseen */
var disagree = [];
WRECK.concat(PROSE).concat(['', '{}', '[]', 'Okay.', '{"summary":""}']).forEach(function (t) {
  var rewritten = String(t || '').trim() !== '' && API.proseOnly(t) !== String(t).trim();
  var salvageThinksItsWreckage = rewritten || API.memoryIsWrapper(t);
  if (salvageThinksItsWreckage && !API.memoryLooksBroken(t)) disagree.push(t.slice(0, 40));
});
ok('nothing the salvage path rewrites is allowed to look fine to the warning',
  disagree.length === 0, disagree.join(' | '));
ok('…and the reader calls the shared test instead of keeping its own copy',
  /if \(!memoryIsWrapper\(t\)\) return t;/.test(sliceSrc(apiSrc, 'function proseOnly(')),
  sliceSrc(apiSrc, 'function proseOnly(').slice(0, 220));


console.log('\nrecovering gives back what was inside, and writes nothing');
var r0 = API.recoverMemory(WRECK[0]);
same('the pretty-printed wrapper yields its summary',
  r0.text, 'Blu confesses in the hallway and Mika does not pull away.');
same('…and its facts', r0.facts.length, 1);
ok('…marked whole, because the answer closed', r0.ok === true && !r0.salvaged);
var r1 = API.recoverMemory(WRECK[4]);
ok('a cut-off wrapper still yields its summary',
  /listens from the other side of the door/.test(r1.text), JSON.stringify(r1.text));
ok('…marked as recovered from an unfinished answer', r1.salvaged === true);
same('…and keeps no half-written fact', r1.facts.length, 0);
ok('the preamble case yields only the prose, not the key',
  API.recoverMemory(WRECK[3]).text.indexOf('summary"') === -1,
  JSON.stringify(API.recoverMemory(WRECK[3]).text));
PROSE.slice(0, 3).forEach(function (t) {
  var r = API.recoverMemory(t);
  same('prose is left alone — nothing is claimed to be recovered from it', r.ok, false);
  ok('…and the reason says so', /not a JSON wrapper/.test(r.reason), r.reason);
});
same('an empty memory recovers to nothing', API.recoverMemory('').ok, false);
var rEmpty = API.recoverMemory('{"summary":"","facts":[]}');
same('a wrapper that holds nothing says so', rEmpty.ok, false);
ok('…without inventing a summary', rEmpty.text === '', JSON.stringify(rEmpty.text));
same('the whole answer is never returned as its own summary',
  API.recoverMemory('{"summary":"The gate holds.","facts":[]}').text, 'The gate holds.');

console.log('\nthe memory sheet names the shape and offers the repair');
(function () {
  var field = between(appSrc,
    "(typeof API !== 'undefined' && API.memoryLooksBroken && API.memoryLooksBroken(s.summary)",
    "id=\"clearbad\">Clear it</button></div>'");
  ok('the warning still explains itself', /does not read like a summary/.test(field));
  ok('…and when the text is a wrapper, it says it is the raw answer',
    /raw answer/.test(field) && /memoryIsWrapper/.test(field), field.slice(0, 160));
  ok('…with a recover button next to the clear one',
    /id="recoverbad"/.test(field) && /id="clearbad"/.test(field));
  var handler = between(appSrc, "var recoverBad = body.querySelector('#recoverbad')",
    "var clearBad = body.querySelector('#clearbad')");
  ok('the recover handler was found at all', handler.length > 60, JSON.stringify(handler.slice(0, 60)));
  ok('the button asks the engine, not a copy of its rules', /API\.recoverMemory\(s\.summary\)/.test(handler),
    handler.slice(0, 120));
  ok('…and puts the result in the field the player is editing',
    /body\.querySelector\('#sum'\)\.value = r\.text/.test(handler), handler.slice(0, 240));
  ok('…without saving anything behind their back',
    !/putSession/.test(handler), 'the recover handler must not write to the store');
  ok('a failed recovery says what the engine said, and stops there',
    /if \(!r\.ok\) \{ UI\.toast\('Nothing to recover — ' \+ r\.reason\); return; \}/.test(handler),
    (handler.match(/if \(!r\.ok\)[^\n]*/) || ['not found'])[0]);
  var failBranch = /if \(!r\.ok\) \{([^}]*)\}/.exec(handler);
  ok('…and the failure path never touches the field or the store',
    !!failBranch && failBranch[1].indexOf('#sum') === -1 && failBranch[1].indexOf('putSession') === -1,
    failBranch ? failBranch[1] : 'the failure branch was not found at all');
  var clear = between(appSrc, "if (clearBad) clearBad.onclick = function ()",
    "body.querySelector('#addfact')");
  ok('clearing still clears', /body\.querySelector\('#sum'\)\.value = ''/.test(clear), clear.slice(0, 120));
})();

console.log('\nthe chats list does not print wreckage as a description');
function node() {
  var n = { innerHTML: '', outerHTML: '', textContent: '', value: '', hidden: false, className: '',
    style: { setProperty: function () {} },
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function (c) { return c; }, addEventListener: function () {},
    querySelector: function () { return node(); }, querySelectorAll: function () { return []; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    closest: function () { return null; }, remove: function () {}, focus: function () {}, click: function () {},
    insertAdjacentHTML: function (_, s) { this.innerHTML += s; }, scrollIntoView: function () {} };
  return n;
}
function settle(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 8); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  return p;
}
(function () {
  var sessions = [
    { id: 'wreck', charId: 'cA', title: 'The Death Game', messageCount: 34, updatedAt: 9,
      summary: WRECK[0] },
    { id: 'good', charId: 'cA', title: 'Normal', messageCount: 40, updatedAt: 8,
      summary: 'Mika packs in the dark while Blu listens from the other side of the door.' },
    { id: 'empty', charId: 'cA', title: 'Just the greeting', messageCount: 1, updatedAt: 7 }
  ];
  var captured = {};
  function grab(key) { if (!captured[key]) captured[key] = node(); return captured[key]; }
  var doc = {
    hidden: false, body: grab('body'), documentElement: node(),
    querySelector: function (s) { return grab(String(s)); },
    getElementById: function (i) { return grab('#' + i); },
    querySelectorAll: function () { return []; },
    createElement: function () { return node(); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  /* the SAME API object the engine uses, so the view cannot pass a rule of its own */
  sb.document = doc;
  sb.Store = {
    characters: [{ id: 'cA', name: 'Mika', avatar: '' }], settings: { userName: 'Blu' }, personas: [],
    allSessions: function () { return Promise.resolve(sessions); },
    sessionTotal: function () { return Promise.resolve(sessions.length); },
    personaLabel: function () { return 'Blu'; },
    getCharacter: function () { return Promise.resolve(sb.Store.characters[0]); }
  };
  sb.App = { state: { showArchived: false, chatSearch: '', search: null }, go: function () {}, openSession: function () {} };
  sb.Views = {};
  sb.Logs = { push: function () {} };
  sb.UI = sb.UI || { esc: function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
    icon: function () { return '<svg></svg>'; }, fmtTime: function () { return '2h ago'; },
    toast: function () {}, uid: function (p) { return p + '-1'; } };
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'views.js'), 'utf8'), sb, { filename: 'views.js' });
  sb.Views.chats(doc.querySelector('#screen'));
  return settle(10).then(function () {
    var out = String(grab('#chat-list').innerHTML);
    function row(id) {
      var parts = out.split('data-open="' + id + '"');
      return parts.length < 2 ? '' : parts[1].split('data-open=')[0];
    }
    var w = row('wreck');
    ok('the wrecked chat does not show its JSON to the player',
      w.indexOf('{ "summary"') === -1 && w.indexOf('summary') === -1, JSON.stringify(w.slice(0, 200)));
    ok('…it shows what the count says, and says the memory is what needs looking at',
      /34 messages · memory needs a look/.test(w), JSON.stringify(w.slice(0, 200)));
    var g = row('good');
    ok('a chat with a real summary still leads with it',
      /Mika packs in the dark while Blu listens/.test(g), JSON.stringify(g.slice(0, 200)));
    ok('…and is not nagged about its memory', /memory needs a look/.test(g) === false);
    var e = row('empty');
    ok('a greeting-only chat reads 1 message, and nothing about memory',
      /1 message/.test(e) && /memory needs a look/.test(e) === false, JSON.stringify(e.slice(0, 200)));
  });
})().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  ok('the suite ran', false, String((e && e.stack) || e));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});
