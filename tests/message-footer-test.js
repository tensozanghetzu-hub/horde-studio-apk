#!/usr/bin/env node
/* The bubble footer must describe the bubble, and the header must say what
 * turn you are on.
 *
 * Reported from a screenshot: a finished reply carrying plenty of prose had
 * "0 words · cut" under it. The footer was rendered once, when the bubble was
 * created — before the first chunk arrived, when `_stream` was '' — and every
 * later update patched only `.mtext`. So the number under a reply was whatever
 * the streaming render happened to leave behind.
 *
 * The turn indicator is the other half of the report: nothing on screen said
 * where you were in the conversation.
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

/* ---- views.js, with just enough DOM to render one message ----------- */
function el() {
  return {
    innerHTML: '', outerHTML: '', className: '', hidden: false, children: [], parentNode: null,
    appendChild: function (c) { this.children.push(c); return c; },
    addEventListener: function () {}, querySelector: function () { return null; },
    querySelectorAll: function () { return []; }, getAttribute: function () { return null; },
    closest: function () { return null; }, classList: { add: function () {}, remove: function () {}, toggle: function () {} }
  };
}
function makeContext() {
  var ctx = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout,
    document: {
      createElement: el,
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    UI: {
      esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      md: function (s) { return String(s || ''); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      toast: function () {}
    },
    Store: { settings: { userName: 'Quinn', activePersona: '' } },
    App: {},
    API: {}
  };
  ctx.window = ctx;
  return ctx;
}
var ctx = makeContext();
vm.runInNewContext(fs.readFileSync(path.join(JS, 'views.js'), 'utf8'), ctx, { filename: 'views.js' });
var Views = ctx.Views;
var char = { id: 'c1', name: "Nira'veth", avatar: '' };

var REPLY = 'The salle is silent. The ventilation hums. Dust motes drift.\n\n' +
  'Her lekku shift against the mat. A slow, deliberate curl.';

console.log('the footer counts the text that is on screen');
var done = { id: 'm1', role: 'assistant', text: REPLY, alts: [] };
var html = Views.messageHtml(done, char, ctx.Store.settings);
ok('a finished message shows its real word count',
  /<div class="mstat"[^>]*>2[0-9] words/.test(html), html.match(/mstat[^>]*>[^<]*/));
ok('nothing says "0 words"', !/(^|[^0-9])0 words/.test(html),
  (html.match(/(^|[^0-9])0 words/) || [''])[0]);
ok('a finished sentence is not marked as cut', html.indexOf('cut') === -1);

console.log('\n…and a stale empty stream cannot lie about it');
/* the exact shape that produced the screenshot: built before the first chunk */
var stale = { id: 'm2', role: 'assistant', text: REPLY, alts: [], _stream: '' };
var staleHtml = Views.messageHtml(stale, char, ctx.Store.settings);
ok('an empty _stream falls back to the stored text', !/(^|[^0-9])0 words/.test(staleHtml),
  staleHtml.match(/mstat[^>]*>[^<]*/));
ok('…and the count comes from the text', /\b\d+ words/.test(staleHtml));

console.log('\nthe footer says which number it is');
ok('a complete reply says the count is of the reply',
  /20 words in this reply/.test(html), (html.match(/mstat[^>]*>[^<]*/) || [''])[0]);
ok('…and calls it complete', /in this reply \u00b7 complete/.test(html));
ok('the bare ambiguous "words · cut" wording is gone',
  !/\d+ words \u00b7 cut/.test(html));

console.log('\na reply that stopped early explains itself');
var cut = { id: 'm3', role: 'assistant', text: 'The salle is silent. The ventilation', alts: [], finishReason: 'length' };
ctx.Store.settings.maxTokens = 600;
var cutHtml = Views.messageHtml(cut, char, ctx.Store.settings);
ok('it names the reply-length number, not an omission', /6 words in this reply/.test(cutHtml),
  (cutHtml.match(/mstat[^>]*>[^<]*/) || [''])[0]);
ok('it says the model hit the limit', /the model hit your 600-token limit/.test(cutHtml));
ok('…that it stopped mid-thought', /stopped mid-thought/.test(cutHtml));
ok('…and points at Continue', /Continue finishes it/.test(cutHtml));
ok('nothing suggests text was withheld', !/\b(thrown away|discarded|omitted|hidden)\b/i.test(cutHtml));

var stopped = { id: 'm5', role: 'assistant', text: 'She began to', alts: [], finishReason: 'stop' };
ok('a model that chose to stop says that',
  /the model chose to stop before finishing/.test(Views.messageHtml(stopped, char, ctx.Store.settings)));

var unknown = { id: 'm6', role: 'assistant', text: 'She began to', alts: [] };
ok('an unknown stop says it stopped mid-sentence',
  /stopped mid-sentence/.test(Views.messageHtml(unknown, char, ctx.Store.settings)));

console.log('\nthe label never claims the wrong thing');
ok('the footer exports for direct testing', typeof Views.replyFooter === 'function');
ok('a complete reply has no "Continue" nudge',
  Views.replyFooter('All done here.', {}, ctx.Store.settings).indexOf('Continue') === -1);
ok('a cut reply always does',
  Views.replyFooter('Half a thought', { finishReason: 'length' }, ctx.Store.settings).indexOf('Continue') !== -1);

console.log('\na continuation says it continues');
var cont = { id: 'm4', role: 'assistant', text: 'around your wrist. The contact is light.', alts: [], continuationOf: 'm1' };
var contHtml = Views.messageHtml(cont, char, ctx.Store.settings);
ok('the continuation label is rendered', /continued from the reply above/.test(contHtml));
ok('…with a class the stylesheet can style', /class="mcont"/.test(contHtml));
ok('a normal reply has no such label', Views.messageHtml(done, char, ctx.Store.settings).indexOf('mcont') === -1);

console.log('\nthe bubble is rebuilt, never patched');
var viewsSrc = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
ok('Views.refreshMessage exists', /Views\.refreshMessage = function/.test(viewsSrc));
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
ok('the app calls it when a reply finishes', /Views\.refreshMessage\(char, msg\)/.test(appSrc));
/* the streaming hook legitimately writes .mtext on every chunk — that IS the
   live text. What must be gone is patching it to *finalise* a reply. */
/* `mt` is the live stream element and is meant to update on every chunk.
   Any OTHER variable patching .mtext is a completion path finalising a reply. */
var completionPatches = (appSrc.match(/([A-Za-z0-9_$]+)\.innerHTML = UI\.md/g) || [])
  .filter(function (m) { return m.indexOf('mt.innerHTML') !== 0; }).length;
ok('no completion path hand-patches .mtext any more', completionPatches === 0, completionPatches + ' left');
ok('the streaming hook still updates the live text',
  /var mt = el\.querySelector\('\.mtext'\)/.test(appSrc));

console.log('\nthe turn indicator');
var turnSrc = appSrc.slice(appSrc.indexOf('  App.chatTurn = function'),
  appSrc.indexOf('  App.refreshChatHead = function'));
ok('App.chatTurn exists', turnSrc.length > 0);
var sb = { console: console, Object: Object, Array: Array, String: String };
sb.window = sb; sb.App = {};
vm.runInNewContext(turnSrc + '\nthis.App = App;', sb, { filename: 'turn.js' });
var chatTurn = sb.App.chatTurn;
ok('no messages is turn 0', chatTurn([]) === 0);
ok('one exchange is turn 1', chatTurn([{ role: 'user' }, { role: 'assistant' }]) === 1);
ok('a continuation does not add a turn',
  chatTurn([{ role: 'user' }, { role: 'assistant' }, { role: 'assistant' }]) === 1);
ok('two player messages are turn 2',
  chatTurn([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }]) === 2);
ok('the greeting bubble is not a turn', chatTurn([{ role: 'assistant' }]) === 0);
ok('an autonomous message is not the player speaking',
  chatTurn([{ role: 'user' }, { role: 'assistant' }, { role: 'user', autonomous: true }]) === 1);

console.log('\nit is on screen, and kept current');
ok('the chat header uses it', /\$\('#bar-sub'\)\.textContent = App\.chatSubtitle\(\)/.test(appSrc));
ok('the subtitle carries the turn', /'turn ' \+ turn/.test(appSrc));
ok('…and says "opening" before the first message', /: 'opening'/.test(appSrc));
ok('sending a message refreshes it', /App\.refreshChatHead\(\);[\s\S]{0,120}stickToBottom/.test(appSrc));
ok('a finished reply refreshes it', /App\.refreshChatHead\(\);\s*\n\s*var thrF/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
