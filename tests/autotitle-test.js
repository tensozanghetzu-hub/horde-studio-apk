/* autotitle-test — v1.39.26: the auto-titler must refuse an echo.
 *
 * Reported live: a chat's name became "The user wants me to name this
 * conversation in at most five" — Nemotron answered the one-shot "Name
 * this conversation…" prompt by repeating the TASK, and the app saved the
 * first 60 characters as the title. An invalid candidate must be skipped
 * (retried on a later turn, never saved), not believed.
 *
 * App.validAutoTitle(raw) → cleaned title or null:
 *   - strips quotes / "Title:" prefix / trailing period / collapses space
 *   - null for: empty, instruction echoes ("the user wants…", "name this
 *     conversation", "at most five words"), meta prefaces ("sure, here"),
 *     anything over 10 words (a title, not a sentence)
 * maybeAutoTitle: invalid candidate → _titleFails++ and NO title written;
 * after 3 misses it gives up quietly (marks titleAuto, keeps old title)
 * instead of burning one API call per reply forever.
 *
 *   node /home/user/tests/autotitle-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'app.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

function loadApp(genText) {
  var saved = [];
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, setTimeout: setTimeout, clearTimeout: clearTimeout,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    AbortController: AbortController,
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function () { return ''; },
      md: function (s) { return String(s || ''); },
      uid: function (p) { return p + '-1'; },
      toast: function () {}, confirm: function () { return Promise.resolve(true); },
      input: function () { return Promise.resolve(null); },
      sheet: function () { return { close: function () {} }; }
    },
    Store: {
      settings: { provider: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm', userName: 'Sam' },
      putSession: function (s) { saved.push(s); return Promise.resolve(s); },
      refreshCharacters: function () { return Promise.resolve([]); }
    },
    API: { generateFree: function () { return Promise.resolve(genText); } },
    IDB: { get: function () { return Promise.resolve(null); } },
    Views: { chats: function () {} },
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'app.js' });
  sb.App.state = {
    busy: false, screen: 'chats',
    char: { id: 'c1', name: 'Draconica', avatar: null, systemPrompt: '', vh: { enabled: false } },
    session: { id: 's1', charId: 'c1', title: 'New chat' },
    messages: [
      { role: 'user', text: 'hi there', createdAt: 1 }, { role: 'assistant', text: 'the library alcove', createdAt: 2 },
      { role: 'user', text: 'toast?', createdAt: 3 }, { role: 'assistant', text: 'crusts off', createdAt: 4 },
      { role: 'user', text: 'jam', createdAt: 5 }, { role: 'assistant', text: 'seeded strawberry', createdAt: 6 }
    ]
  };
  return { App: sb.App, saved: saved, session: sb.App.state.session };
}

console.log('A — validAutoTitle cleaning');
var w = loadApp('"The Midnight Owl"');
var V = function (x) { return w.App.validAutoTitle ? w.App.validAutoTitle(x) : '(missing)'; };
ok('quoted title cleaned', V('"The Midnight Owl"') === 'The Midnight Owl', JSON.stringify(V('"The Midnight Owl"')));
ok('Title: prefix stripped', V('Title: Alcove at Midnight\nnext line') === 'Alcove at Midnight', JSON.stringify(V('Title: Alcove at Midnight\nnext line')));
ok('trailing period trimmed', V('Breakfast Protocols.') === 'Breakfast Protocols', JSON.stringify(V('Breakfast Protocols.')));

console.log('\nB — echoes and meta are refused, never saved');
var ECHO = 'The user wants me to name this conversation in at most five words.';
ok('the exact reported echo → null', V(ECHO) === null, JSON.stringify(V(ECHO)));
ok('"Name this conversation: …" echo → null', V('Name this conversation in at most five words') === null, JSON.stringify(V('Name this conversation in at most five words')));
ok('meta preface + answer → keeps the answer part', V('Sure, here is a title: The Midnight Owl') === 'The Midnight Owl', JSON.stringify(V('Sure, here is a title: The Midnight Owl')));
ok('a whole sentence (>10 words) → null', V('A girl learns that toast protocols are binding contracts between two stubborn hearts') === null);
ok('empty → null', V('   ') === null);

console.log('\nC — maybeAutoTitle behavior');
var bad = loadApp(ECHO);
bad.App.maybeAutoTitle();
tick(40).then(function () {
  ok('an echo writes NO title', bad.session.title === 'New chat' && bad.saved.length === 0, JSON.stringify({ title: bad.session.title, saved: bad.saved.length }));
  ok('…and counts the miss for a later retry', bad.session._titleFails === 1, JSON.stringify(bad.session._titleFails));

  var good = loadApp('"Alcove of Unbroken Lines"');
  good.App.maybeAutoTitle();
  return tick(40).then(function () {
    ok('a real title saves once, marked auto', good.session.title === 'Alcove of Unbroken Lines' && good.session.titleAuto === true, JSON.stringify(good.session));
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
}).catch(function (e) { console.error(e); process.exit(1); });
