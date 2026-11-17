#!/usr/bin/env node
/* "Chat health" closed the menu and did nothing.
 *
 * The sheet called `IDB.all('messages')`. No such method has ever existed —
 * the store exposes `getAll` and `getAllByIndex`. The throw happened while the
 * `Promise.all([...])` argument array was being *built*, which is synchronous,
 * so the `.catch()` chained after it never ran: no sheet, no toast, no error.
 * The menu had already called `close()`, so the visible result was a menu that
 * vanished.
 *
 * This test fails on any call to an IDB method that does not exist, anywhere
 * in the app — the class of bug, not just this instance — and it drives the
 * sheet end to end against a fake IDB.
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

/* ---- 1. the class of bug -------------------------------------------- */
console.log('every IDB call names a method that exists');

var idbSrc = fs.readFileSync(path.join(JS, 'idb.js'), 'utf8');
var defined = {};
(idbSrc.match(/^\s{4}(\w+): function/gm) || []).forEach(function (m) {
  defined[m.trim().split(':')[0]] = true;
});
ok('the store defines its methods', Object.keys(defined).length >= 8,
  Object.keys(defined).join(', '));
ok('getAll exists', !!defined.getAll);
ok('all does NOT exist (that was the bug)', !defined.all);

var offenders = [];
fs.readdirSync(JS).forEach(function (f) {
  if (!/\.js$/.test(f)) return;
  /* comments mention the old call on purpose — scan code only */
  var src = fs.readFileSync(path.join(JS, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  var re = /\bIDB\.(\w+)\s*\(/g, m;
  while ((m = re.exec(src))) {
    if (!defined[m[1]]) {
      var line = src.slice(0, m.start).split('\n').length;
      offenders.push(f + ':' + line + ' IDB.' + m[1] + '()');
    }
  }
});
ok('no file calls a method the store does not define', offenders.length === 0,
  offenders.join('; '));

/* ---- 2. the sheet, end to end --------------------------------------- */
console.log('\nthe sheet opens with real numbers');

var sheetOpts = null, toasts = [];
var msgs = [
  { id: 'm1', sessionId: 's1', role: 'user', text: 'hi', createdAt: 1 },
  { id: 'm2', sessionId: 's1', role: 'assistant', text: 'one two three four', alts: ['a', 'b'], createdAt: 2 },
  { id: 'm3', sessionId: 's1', role: 'assistant', text: 'five six', alts: ['x'], createdAt: 3 }
];
var session = { id: 's1', title: 'First Night on Coruscant', messageCount: 3, summary: '', facts: [] };

var sb = {
  console: console, JSON: JSON, Promise: Promise, Object: Object, Array: Array,
  String: String, Number: Number, Math: Math, Date: Date, RegExp: RegExp, Error: Error,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  setTimeout: function (fn) { return fn && fn(); }, clearTimeout: function () { },
  setInterval: function () { return 0; }, clearInterval: function () { },
  Store: {
    settings: { contextMessages: 40, memoryEvery: 14 },
    getMessages: function (sid) { return Promise.resolve(msgs.filter(function (m) { return m.sessionId === sid; })); },
    characters: [], personas: []
  },
  IDB: {
    get: function (store, key) { return Promise.resolve(store === 'sessions' ? session : null); },
    getAll: function () { return Promise.resolve([]); },
    getAllByIndex: function () { return Promise.resolve(msgs); }
  },
  UI: {
    sheet: function (opts) { sheetOpts = opts; return Promise.resolve(null); },
    toast: function (t) { toasts.push(t); },
    esc: function (s) { return String(s == null ? '' : s); },
    icon: function () { return ''; }
  },
  document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () { } },
  App: {}
};
sb.window = sb;
/* only the two functions under test, lifted out of app.js */
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
function extract(name) {
  var start = appSrc.indexOf('  App.' + name + ' = function');
  var end = appSrc.indexOf('\n  };', start) + 4;
  return appSrc.slice(start, end);
}
vm.runInNewContext(
  'var Store = this.Store, IDB = this.IDB, UI = this.UI;\n' +
  'var App = {};\n' + extract('chatHealth') + '\n' + extract('chatHealthSheet') +
  '\nthis.App = App;', sb, { filename: 'health.js' });

sb.App.chatHealthSheet('s1');

setTimeout(function () {
  ok('a sheet was opened', !!sheetOpts, toasts.join('; ') || 'nothing opened, no toast');
  ok('…titled Chat health', sheetOpts && sheetOpts.title === 'Chat health');
  var body = (sheetOpts && sheetOpts.body) || '';
  ok('it counts the messages', /Messages<\/span><b>3<\/b>/.test(body));
  ok('it counts the replies', /Replies from the character<\/span><b>2<\/b>/.test(body));
  ok('it averages the words (4 and 2 -> 3)', /Average reply length<\/span><b>3 words<\/b>/.test(body));
  ok('it counts the rerolls spent', /Rerolls spent<\/span><b>1<\/b>/.test(body));
  ok('it shows the prompt weight', /Prompt weight[^<]*<\/span><b>~<\d+>|Prompt weight \(estimate\)<\/span><b>~\d+ tokens<\/b>/.test(body),
    body.match(/Prompt weight[^€]{0,60}/));
  ok('no error toast', toasts.length === 0, toasts.join('; '));

  /* ---- 3. the turn indicator is not what gets truncated ------------- */
  console.log('\nthe turn is at the front of the header line');
  var sub = appSrc.slice(appSrc.indexOf('  App.chatSubtitle = function'),
    appSrc.indexOf('  App.refreshChatHead = function'));
  ok('the turn is prefixed, not appended', /var lead = turn \? 'turn ' \+ turn : 'opening';\s*\n\s*return lead \+ ' · ' \+ sub;/.test(sub),
    sub.slice(sub.indexOf('var turn')));
  ok('it no longer ends with the turn', !/sub \+ ' · ' \+ \(turn \?/.test(sub));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 20);
