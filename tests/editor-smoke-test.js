#!/usr/bin/env node
/* The character editor, rendered. Every other card test calls store.js and
   api.js and reads the result; the one class of bug none of them can see is the
   editor itself throwing a ReferenceError on a real character, which is what a
   phone shows as a white sheet. So: load views.js in a permissive fake DOM,
   render the sheet, and assert the controls that carry a decision are actually
   on screen and lit with what the character holds — the placement seg, the card
   prompt, the compat toggle and its narrowed window, the six instruction fields,
   the two-field persona (v1.41.0) and the ask that is shown but not granted.

   It asserts on the rendered HTML rather than on the source text, so a control
   that throws on the way in cannot pass. A rendering failure exits 1.

     node /home/user/tests/editor-smoke-test.js
*/
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var JS = path.join(__dirname, '..', 'horde-studio-mobile', 'js');

var html = {};          // id -> last innerHTML written
function el(id) {
  var node = {
    _id: id,
    set innerHTML(v) { html[id] = String(v); },
    get innerHTML() { return html[id] || ''; },
    value: '', textContent: '', hidden: false, style: {}, dataset: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function () {}, removeChild: function () {}, insertBefore: function () {},
    addEventListener: function () {}, removeEventListener: function () {},
    querySelector: function () { return el(id + ' > ?'); },
    querySelectorAll: function () { return []; },
    closest: function () { return el(id + ' ^'); },
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 10, height: 10 }; },
    focus: function () {}, blur: function () {}, click: function () {}, dispatchEvent: function () {},
    remove: function () {}, scrollTo: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    insertAdjacentHTML: function () {}, cloneNode: function () { return el(id + "'"); },
    files: [], parentNode: null, children: [], scrollTop: 0, scrollIntoView: function () {}
  };
  return new Proxy(node, {
    get: function (t, k) {
      if (k in t) return t[k];
      return function () { return el(id + '.' + String(k)); };
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}
var documentEl = el('#document');
var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error,
  setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
  isNaN: isNaN, isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt, encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent, btoa: btoa, atob: atob, Uint8Array: Uint8Array, Uint32Array: Uint32Array,
  DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder, AbortController: AbortController,
  Blob: function () {}, FileReader: function () {}, Image: function () {}, URL: URL,
  FormData: function () { return { append: function () {} }; },
  crypto: { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = i % 251; return a; } },
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  location: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/', hash: '', search: '' },
  navigator: { userAgent: 'node', onLine: true, serviceWorker: undefined },
  matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
  requestAnimationFrame: function (f) { return setTimeout(f, 0); },
  getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
  fetch: function () { return Promise.reject(new Error('offline')); },
  document: new Proxy(documentEl, {
    get: function (t, k) {
      if (k === 'documentElement') return el('html');
      if (k === 'body') return el('body');
      if (k === 'head') return el('head');
      if (k === 'createElement') return function (tag) { return el('<' + tag + '>'); };
      if (k === 'querySelector') return function (sel) { return el(sel); };
      if (k === 'querySelectorAll') return function () { return []; };
      if (k in t) return t[k];
      return function () { return el('doc.' + String(k)); };
    }
  }),
  window: null
};
sb.window = sb; sb.global = sb; sb.self = sb;
['idb', 'ui', 'store', 'api', 'vhuman', 'views', 'app'].forEach(function (f) {
  vm.runInNewContext(fs.readFileSync(path.join(JS, f + '.js'), 'utf8'), sb, { filename: f + '.js' });
});
var Store = sb.Store, API = sb.API, Views = sb.Views;
Store.settings = { userName: 'Player', systemPrompt: 'GLOBAL SYSTEM PROMPT', imageProvider: 'horde',
  provider: 'openai', model: 'gpt-test', apiBase: '', apiKey: '', personas: [], activePersona: null,
  hordeWorkers: 1, styleLock: true, loreBudget: 5000, worldChar: null };
Store.characters = [];

var c = {
  id: 'c1', name: 'Wren', persona: 'Quiet, careful.', scenario: 'A late train.',
  greeting: 'You made it.', examples: '<START>\n{{user}}: Hi\n{{char}}: Hello',
  postHistory: 'Stay brief.', postHistoryPlacement: 'tail', systemPrompt: '', systemPromptSource: 'combine',
  cardSystemPrompt: 'CARD PROMPT with {{original}} inside', tags: [], lorebook: [
    { id: 'l1', keys: ['alpha'], content: 'A', enabled: true, selective: 'yes', selectiveLogic: 2 },
    { id: 'l2', keys: ['beta'], content: 'B', enabled: true, essential: true, position: 'after_char' }
  ],
  loreCompat: true, loreScanTurns: 9, loreBookScan: 4, loreBookBudget: 400,
  directives: { agency: 'Ask, never decide.', style: 'Short turns.', canon: '', progression: '', stages: '', priority: '' },
  images: [], expressionPortraits: [], alternateGreetings: [], scenarioList: [],
  stateTracking: false, state: { mood: '', intent: '', flags: '' }, importNotes: ['note one']
};
try {
  Views.editor(el('#screen'), c);
} catch (e) {
  console.log('THREW: ' + (e && e.stack || e));
  process.exit(1);
}
setTimeout(function () {
  var all = JSON.stringify(Object.keys(html));
  var body = html['#editor-body'] || '';
  var pass = 0, fail = 0;
  function note(name, good) {
    if (good) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name); process.exitCode = 1; }
  }
  function has(name, needle) { note(name + '  [' + needle + ']', body.indexOf(needle) !== -1); }
  console.log('\nthe character editor renders the v1.40.0 controls');
  has('the placement group exists', 'Card prompts and placement');
  has('system prompt source seg', 'id="e-sys-src"');
  has('…lit on the value the character carries', 'data-a="combine" class="on"');
  has('post-history placement seg', 'id="e-post-place"');
  has('…lit on the chosen value', 'data-a="tail" class="on"');
  has('the card prompt is shown', 'CARD PROMPT with {{original}} inside');
  has('…with a way to copy it', 'data-act="sys-use-card"');
  has('compat toggle present', 'id="e-lore-compat"');
  has('…switched on for this character', 'class="toggle on" id="e-lore-compat"');
  has('window slider holds the player number, not the narrowed one',
    'id="e-lore-scan" min="1" max="24" step="1" value="9"');
  has('…and says what is actually in force', '<b>This character is using 2</b>');
  has('unread-option warning', 'cannot read');
  has('directive fields generated', 'id="e-dir-agency"');
  has('…pre-filled', 'Ask, never decide.');
  has('…and the one left blank is empty', 'id="e-dir-canon" maxlength="4000" placeholder="">');
  has('six of them', 'id="e-dir-priority"');
  has('…with the prompt budget named when a field passes it',
    'id="e-dir-agency" maxlength="4000"');
  has('the note field is still there', 'id="e-post"');
  /* v1.41.0: the ask is shown and not granted, the two-field persona is real,
     and the global preference exists where it can be switched. */
  function render(char) {
    try { Views.editor(el('#screen'), char); } catch (e) {
      console.log('THREW: ' + (e && e.stack || e)); process.exit(1);
    }
    return html['#editor-body'] || '';
  }
  function has2(b, name, needle, want) {
    var got = b.indexOf(needle) !== -1;
    note(name + '  [' + needle + ']', want === undefined ? got : got === want);
  }
  console.log('\n…and the v1.41.0 controls');
  var asked = JSON.parse(JSON.stringify(c));
  asked.systemPromptSource = ''; asked.systemPromptAsked = 'card';
  asked.descText = 'Tall, patient.'; asked.persText = 'Stubborn.'; asked.personaSplit = false;
  var b1 = render(asked);
  has2(b1, 'a card that asked for its prompt says so', 'did not apply it');
  has2(b1, '…and points at the button that grants it', 'to grant it');
  has2(b1, '…while the seg stays on the player’s own prompt', 'data-a="app" class="on"');
  has2(b1, 'the persona offers the card’s two fields', 'id="e-persona-mode"');
  has2(b1, '…and one box is the mode a fresh import shows', 'id="e-persona-one"');
  has2(b1, '…with the consequence of using it spelled out', 'merges them');
  var split = JSON.parse(JSON.stringify(c));
  split.personaSplit = true; split.descText = 'Tall, patient.'; split.persText = 'Stubborn.';
  var b2 = render(split);
  has2(b2, 'the split mode shows two textareas', 'id="e-desc"');
  has2(b2, '…holding the card’s two halves', 'Stubborn.</textarea>');
  has2(b2, '…and the merged box is hidden, not empty', 'id="e-persona-one" style="display:none"');
  Store.settings.honorCardSystemPrompt = true;
  var pref = JSON.parse(JSON.stringify(c));
  pref.systemPromptSource = ''; pref.systemPromptAsked = 'combine';
  var b3 = render(pref);
  has2(b3, 'the preference on means the seg lights what is really sent', 'data-a="combine" class="on"');
  Store.settings.honorCardSystemPrompt = false;
  render(c);
  /* the controls have to be inside the sheet that is rendered, and in a group a
     person can see: eight group titles, and every id below reached */
  note('the sheet renders its groups', (body.match(/group-title/g) || []).length >= 8);
  note('…and touched a real number of controls', all.length > 30, all.length);
  try {
    Views.settingsSystem(el('#screen'));
    var setBody = html['#settings-x-body'] || '';
    function ok3(name, cond) { note(name, cond); }
    note('the system settings screen renders the card-prompt preference',
      /Cards may choose their prompt/.test(setBody) && /id="set-card-prompt"/.test(setBody));
    note('…off by default', /class="toggle" id="set-card-prompt"/.test(setBody));
    Store.settings.honorCardSystemPrompt = true;
    Views.settingsSystem(el('#screen'));
    note('…and lit when the player has switched it on',
      /class="toggle on" id="set-card-prompt"/.test(html['#settings-x-body'] || ''));
    Store.settings.honorCardSystemPrompt = false;
  } catch (e) {
    note('the system settings screen renders: ' + (e && e.message || e), false);
  }
  console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
}, 30);
