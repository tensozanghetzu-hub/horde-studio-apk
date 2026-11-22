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

var html = {};          /* id -> last innerHTML written (reset per render) */
var nodes = {};         /* selector -> the one node for it, like a document would have (reset per render) */
/* A registry, not a fresh object per lookup: the point of this file grew past
   "did it render" into "what does the shipped handler do when it is fired", and
   a handler wired to a node that is thrown away after the query cannot be fired.
   The node also records its listeners, so a test can click what the app clicked. */
function el(id) {
  if (nodes[id]) return nodes[id];
  var attr = /^\[([\w-]+)=?([^\]]*)\]$/.exec(id) || [];
  var node = {
    _id: id,
    set innerHTML(v) { html[id] = String(v); node.__html = String(v); },
    get innerHTML() { return html[id] || ''; },
    value: '', textContent: '', hidden: false, style: {}, dataset: {},
    __listeners: {}, __attrs: attr.length ? [[attr[1], attr[2] || '']] : [],
    getAttribute: function (name) {
      var found = node.__attrs.filter(function (kv) { return kv[0] === name; })[0];
      return found ? found[1] : null;
    },
    classList: {
      _on: {},
      add: function (c) { this._on[c] = true; },
      remove: function (c) { delete this._on[c]; },
      toggle: function (c) { if (this._on[c]) delete this._on[c]; else this._on[c] = true; },
      contains: function (c) { return !!this._on[c]; }
    },
    appendChild: function () {}, removeChild: function () {}, insertBefore: function () {},
    addEventListener: function (ev, fn) { (node.__listeners[ev] || (node.__listeners[ev] = [])).push(fn); },
    removeEventListener: function () {},
    querySelector: function (sel) { return el(String(sel || (id + ' > ?'))); },
    /* one node per selector, and the same one every time — enough for the
       wiring the editor does with `on(root, '[data-act=…]')` */
    querySelectorAll: function (sel) { return sel ? [el(String(sel))] : [] },
    closest: function () { return el(id + ' ^'); },
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 10, height: 10 }; },
    focus: function () {}, blur: function () {}, click: function () {}, dispatchEvent: function () {},
    remove: function () {}, scrollTo: function () {}, setAttribute: function () {},
    insertAdjacentHTML: function () {}, cloneNode: function () { return el(id + "'"); },
    files: [], parentNode: null, children: [], scrollTop: 0, scrollIntoView: function () {}
  };
  var proxy = new Proxy(node, {
    get: function (t, k) {
      if (k in t) return t[k];
      return function () { return el(id + '.' + String(k)); };
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
  nodes[id] = proxy;          /* the caching this whole file depends on */
  return proxy;
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
      if (k === 'querySelectorAll') return function (sel) { return sel ? [el(sel)] : []; };
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
  function note(name, good, detail) {
    if (good) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); process.exitCode = 1; }
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
    /* A real render replaces the DOM: textareas come back with the markup's own
       values and each control has exactly one handler. Without the wipe the
       registry would carry the previous sheet's typing, and every render would
       add a second save handler to the same node, so one click would save N
       drafts and the assertion would be about the harness rather than the app. */
    nodes = {}; html = {};
    try { Views.editor(el('#screen'), char); } catch (e) {
      console.log('THREW: ' + (e && e.stack || e)); process.exit(1);
    }
    var b = html['#editor-body'] || '';
    /* Seed what the markup carries, so a field the test never touches starts at
       the value the character actually has rather than at an empty string — which
       is the difference between testing the app and testing the harness. */
    var re = /<(textarea|input)\b[^>]*\bid="([^"]+)"[^>]*>/g, m;
    while ((m = re.exec(b))) {
      var tag = m[0], id = m[2];
      var vm2 = /\bvalue="([^"]*)"/.exec(tag);
      var val = null;
      if (m[1] === 'textarea') {
        var open = b.indexOf('>', m.index), close = b.indexOf('</textarea>', open);
        val = open === -1 || close === -1 ? '' : b.slice(open + 1, close);
      } else if (vm2) val = vm2[1];
      if (val === null) continue;
      el('#' + id).value = unesc(val);
    }
    return b;
  }
  function unesc(t) {
    return String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
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
  /* ---------------------------------------------------------------- A and B ----
     Findings A and B from the v1.41.0 review were about the HANDLERS, not the
     markup: the switch dropped typing and the save collapsed the halves. So fire
     the shipped handlers and read what they leave behind. */
  console.log('\nthe persona switch and the save path (v1.41.1)');
  var saved = [];
  sb.App.saveCharacter = function (c) { saved.push(c); return Promise.resolve(); };
  function fire(sel, ev, e) {
    var node = nodes[sel] || el(sel);
    if (!node) { note('found ' + sel + ' to fire', false); return false; }
    var hs = (node.__listeners[ev] || []).concat(node['on' + ev] ? [node['on' + ev]] : []);
    if (!hs.length) { note('a ' + ev + ' handler on ' + sel, false); return false; }
    hs.forEach(function (h) { h.call(node, e || { target: node, preventDefault: function () {} }); });
    return true;
  }
  function clickSeg(sel, value) {
    var btn = { getAttribute: function () { return value; }, closest: function () { return btn; },
      classList: { remove: function () {}, add: function () {} } };
    return fire(sel, 'click', { target: { closest: function () { return btn; } } });
  }
  function textareaOf(name) {
    var b = html['#editor-body'] || '';
    var at = b.indexOf('id="' + name + '"');
    if (at === -1) return null;
    var open = b.indexOf('>', at), close = b.indexOf('</textarea>', open);
    return open === -1 || close === -1 ? null : b.slice(open + 1, close);
  }
  function boxVal(sel) { var x = nodes[sel]; return x ? String(x.value || '') : null; }

  var D = 'Original description', P = 'Original personality';
  var joined2 = D + '\n\n' + P;
  var typed = joined2 + '\nNEW UNSAVED TEXT';
  var halved = { id: 'c2', name: 'Wren', persona: joined2, descText: D, persText: P,
    personaSplit: false, greeting: 'You made it.', scenario: '', examples: '',
    postHistory: '', postHistoryPlacement: 'sheet', tags: [], lorebook: [],
    directives: {}, images: [], expressionPortraits: [], alternateGreetings: [],
    scenarioList: [], state: {}, importNotes: [] };

  render(halved);
  note('a fresh import seeds the card’s halves into the split boxes, not the merged text',
    textareaOf('e-desc') === D && textareaOf('e-pers') === P,
    JSON.stringify({ d: textareaOf('e-desc'), p: textareaOf('e-pers') }));

  /* A: typing in the one box, then opening the two fields */
  el('#e-persona').value = typed;
  fire('#e-persona', 'input');
  clickSeg('#e-persona-mode', 'split');
  note('switching to the two fields keeps the unsaved sentence instead of dropping it',
    boxVal('#e-desc') === typed && boxVal('#e-pers') === '',
    JSON.stringify({ d: boxVal('#e-desc'), p: boxVal('#e-pers') }));
  note('…and says that it had to merge, and why',
    /could not be split back into two fields/.test(html['#e-persona-merge'] || ''),
    (html['#e-persona-merge'] || '').slice(0, 90));
  note('…while the card’s halves are still there to go back to',
    /Use the card/.test(html['#e-persona-merge'] || ''));
  clickSeg('#e-persona-mode', 'one');
  note('…and switching back does not overwrite the typing with the stale halves',
    boxVal('#e-persona') === typed, JSON.stringify(boxVal('#e-persona')));

  /* A, the other direction: typing in the halves survives a look at the one box */
  render(halved);
  el('#e-persona').value = joined2;
  el('#e-desc').value = D; el('#e-pers').value = P;
  clickSeg('#e-persona-mode', 'split');
  el('#e-pers').value = P + ' — and tired';
  fire('#e-pers', 'input');
  clickSeg('#e-persona-mode', 'one');
  note('typing in the halves shows up in the one box, joined',
    boxVal('#e-persona') === D + '\n\n' + P + ' — and tired', JSON.stringify(boxVal('#e-persona')));
  clickSeg('#e-persona-mode', 'split');
  note('…and going back to the halves keeps the edit, not the import’s text',
    boxVal('#e-pers') === P + ' — and tired', JSON.stringify(boxVal('#e-pers')));

  /* A, the reversible part */
  render(halved);
  el('#e-persona').value = typed;
  fire('#e-persona', 'input');
  clickSeg('#e-persona-mode', 'split');
  fire('#e-persona-restore', 'click');
  note('“use the card’s two fields instead” puts both halves back',
    boxVal('#e-desc') === D && boxVal('#e-pers') === P && boxVal('#e-persona') === joined2,
    JSON.stringify({ d: boxVal('#e-desc'), p: boxVal('#e-pers'), one: boxVal('#e-persona') }));
  note('…and the warning goes away with it',
    !/could not be split/.test(html['#e-persona-merge'] || ''));

  /* B: save an unrelated field, persona untouched */
  render(halved);
  el('#e-persona').value = joined2;
  el('#e-desc').value = D; el('#e-pers').value = P;
  el('#e-name').value = 'Wren'; el('#e-tagline').value = ''; el('#e-tags').value = '';
  el('#e-scenario').value = ''; el('#e-greeting').value = 'A new greeting.';
  saved.length = 0;
  fire('[data-act=save]', 'click');
  var keep = saved[0] || {};
  note('saving an unrelated field keeps the two halves as the card wrote them',
    saved.length === 1 && keep.descText === D && keep.persText === P && keep.persona === joined2,
    JSON.stringify({ d: keep.descText, p: keep.persText, persona: keep.persona }));
  note('…and does not silently switch the character out of the split shape',
    keep.personaSplit === false, JSON.stringify(keep.personaSplit));
  render(keep);
  note('…so reopening in the two fields still shows both original halves',
    textareaOf('e-desc') === D && textareaOf('e-pers') === P,
    JSON.stringify({ d: textareaOf('e-desc'), p: textareaOf('e-pers') }));

  /* the deliberate merge, still there and still what it was */
  render(halved);
  el('#e-persona').value = joined2 + '\nOne-box edit.';
  fire('#e-persona', 'input');
  saved.length = 0;
  fire('[data-act=save]', 'click');
  var merged = saved[0] || {};
  note('editing the one box still merges, as the screen says it will',
    merged.personaSplit === false && merged.descText === joined2 + '\nOne-box edit.' &&
    merged.persText === '', JSON.stringify({ d: merged.descText, p: merged.persText }));

  /* editing in the two-field mode saves as two fields */
  render(halved);
  el('#e-persona').value = joined2;
  el('#e-desc').value = D; el('#e-pers').value = P;
  clickSeg('#e-persona-mode', 'split');
  el('#e-desc').value = D + ' Rewritten.';
  fire('#e-desc', 'input');
  saved.length = 0;
  fire('[data-act=save]', 'click');
  var splitSave = saved[0] || {};
  note('and editing a half saves the shape as two fields',
    splitSave.personaSplit === true && splitSave.descText === D + ' Rewritten.' &&
    splitSave.persText === P, JSON.stringify({ s: splitSave.personaSplit, d: splitSave.descText, p: splitSave.persText }));

  /* cancel must persist nothing */
  var store = JSON.stringify(halved), before = saved.length;
  render(halved);
  el('#e-persona').value = 'TYPED AND ABANDONED';
  clickSeg('#e-persona-mode', 'split');
  note('closing without saving writes nothing at all',
    saved.length === before && JSON.stringify(halved) === store,
    JSON.stringify({ saved: saved.length - before }));

  console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
}, 30);
