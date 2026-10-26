/* msgtail-test — v1.39.22: a finished "wall of text" must land the reader on
 * the reply's FIRST line, not its last.
 *
 * Reported live: with a long reply, generation completes with the thread
 * pinned to the bottom (the message's tail), so the reader has to scroll
 * back up to the beginning to read it. stickToBottom's near-bottom follow
 * is right for short bubbles and wrong for ones taller than the screen.
 *
 * Views.followReply(thread, el):
 *   A — tall bubble + reader at/near bottom → land on el.offsetTop (head)
 *   B — short bubble + reader at bottom → classic bottom pin (unchanged)
 *   C — reader up-thread → never yanked at all
 *   D — el missing → classic stickToBottom semantics
 * and at the app level:
 *   E — a completed generateReply hands the finished bubble element to
 *       Views.followReply; suites' old Views stubs (no followReply) fall
 *       back to stickToBottom — additive, nothing breaks.
 *
 *   node /home/user/tests/msgtail-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');
var APP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

/* ---------------- views.js, real ---------------- */

function loadViews() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    fetch: function () { return Promise.resolve({ ok: false }); },
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      md: function (s) { return String(s || ''); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; }
    },
    Store: { settings: { userName: 'Tester' } },
    document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sb, { filename: 'views.js' });
  return sb.Views;
}

var Views = loadViews();

function fakeThread(scrollTop) {
  /* 5000px conversation in a 500px viewport */
  var t = { scrollTop: scrollTop, clientHeight: 500 };
  Object.defineProperty(t, 'scrollHeight', { get: function () { return 5000; } });
  return t;
}

console.log('A — a reply taller than the screen lands on its first line');
var t1 = fakeThread(4500); /* sitting at the very bottom */
var tall = { offsetTop: 3500, offsetHeight: 900 };
Views.followReply(t1, tall);
ok('head-anchored to the bubble top', t1.scrollTop === tall.offsetTop - 8, 'scrollTop=' + t1.scrollTop);
ok('…not marooned at the message tail', t1.scrollTop !== 5000, 'scrollTop=' + t1.scrollTop);

console.log('\nB — a short reply keeps the classic bottom pin');
var t2 = fakeThread(4500);
var short = { offsetTop: 4700, offsetHeight: 200 };
Views.followReply(t2, short);
ok('bottom pin preserved for short replies', t2.scrollTop === 5000, 'scrollTop=' + t2.scrollTop);

console.log('\nC — a reader up-thread is never yanked');
var t3 = fakeThread(1000);
Views.followReply(t3, tall);
ok('scroll position untouched', t3.scrollTop === 1000, 'scrollTop=' + t3.scrollTop);

console.log('\nD — no bubble element → classic semantics');
var t4 = fakeThread(4500);
Views.followReply(t4, null);
ok('falls back to bottom follow', t4.scrollTop === 5000, 'scrollTop=' + t4.scrollTop);
var t5 = fakeThread(1000);
Views.followReply(t5, null);
ok('…and still respects a reader up-thread', t5.scrollTop === 1000, 'scrollTop=' + t5.scrollTop);

console.log('\nG — a CONTINUED message anchors at the seam, not the start');
var t6 = fakeThread(4400); /* reader sat at the cut, near bottom (100px from the end) */
/* merged bubble: starts at 3000, old text was 700px tall (the seam), total 1200 */
var merged = { offsetTop: 3000, offsetHeight: 1200 };
Views.followReply(t6, merged, 700);
ok('lands at the seam (start of the NEW prose)', t6.scrollTop === 3000 + 700 - 90 - 8, 'scrollTop=' + t6.scrollTop);
ok('…not dragged back to the start of the merged message', t6.scrollTop !== 3000 - 8, 'scrollTop=' + t6.scrollTop);
ok('…and not marooned at the tail either', t6.scrollTop !== 5000, 'scrollTop=' + t6.scrollTop);

/* ---------------- app.js finish path ---------------- */

function freshWorld(followFn) {
  var calls = { follow: [], stick: 0, els: [] };
  var input = { value: '', style: {} };
  var threadStub = { id: 'thread' };
  var el = {
    mtext: { innerHTML: '' },
    offsetHeight: 640,   /* the cut message's height when Continue was pressed */
    classList: { add: function () {}, remove: function () {} },
    querySelector: function (s) { return s === '.mtext' ? el.mtext : null; },
    remove: function () {}
  };
  var views = {
    thread: function () {},
    appendMessage: function () { return el; },
    stickToBottom: function () { calls.stick++; },
    chats: function () {}
  };
  if (followFn) views.followReply = function (thread, e, fromPx) { calls.follow.push({ thread: thread, el: e, fromPx: fromPx }); };
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setInterval: setInterval, clearInterval: clearInterval,
    AbortController: AbortController,
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      md: function (s) { return String(s || ''); },
      uid: function (p) { return p + '-1'; },
      toast: function () {},
      confirm: function () { return Promise.resolve(true); },
      input: function () { return Promise.resolve(null); },
      sheet: function () { return { close: function () {} }; }
    },
    Store: {
      settings: { provider: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm', maxTokens: 300, userName: 'Sam' },
      addMessage: function (m) { return Promise.resolve(Object.assign({ id: 'm9' }, m)); },
      updateMessage: function (m) { return Promise.resolve(m); },
      putSession: function () { return Promise.resolve(); },
      putCharacter: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    API: {
      generate: function (opts) {
        opts.onDelta('a reply', 'a reply');
        return Promise.resolve('a reply');
      },
      parseState: function () { return null; },
      stripState: function (t) { return t; },
      splitBurst: function (t) { return [t]; }
    },
    IDB: { get: function () { return Promise.resolve(null); } },
    Views: views,
    VH: {
      noteContact: function () {}, replyDelay: function () { return 0; },
      isAsleep: function () { return false; }, activity: function () { return ''; },
      ensure: function (c) { return c.vh || (c.vh = { enabled: false }); }
    },
    document: {
      querySelector: function (s) {
        if (s === '#input') return input;
        if (s === '#thread') return threadStub;
        return null;
      },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(APP_SRC, 'utf8'), sb, { filename: 'app.js' });
  sb.App.setStop = function () {};
  sb.App.go = function () {};
  sb.App.afterReply = function () { return Promise.resolve(); };
  sb.App.state = {
    busy: false,
    char: { id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: false } },
    session: { id: 's1', charId: 'c1', pending: null },
    messages: [], screen: 'chat'
  };
  return { App: sb.App, calls: calls, el: el, threadStub: threadStub };
}

console.log('\nE — the finished bubble is handed to followReply');
var w1 = freshWorld(true);
w1.App.generateReply();
tick(60)
  .then(function () {
    ok('followReply called once at finish', w1.calls.follow.length === 1, JSON.stringify(w1.calls.follow.length));
    ok('…with the actual thread element', w1.calls.follow[0] && w1.calls.follow[0].thread === w1.threadStub);
    ok('…and the finished reply bubble', w1.calls.follow[0] && w1.calls.follow[0].el === w1.el);

    console.log('\nH — a Continue hands followReply the seam height');
    var w3 = freshWorld(true);
    w3.App.state.messages = [{ id: 'm1', sessionId: 's1', role: 'assistant', text: 'cut off mid', alts: ['cut off mid'], altIdx: 0, createdAt: 5 }];
    w3.App.generateReply({ continueFor: w3.App.state.messages[0] });
    return tick(60).then(function () {
      ok('followReply got the seam offset for a continuation', w3.calls.follow[0] && w3.calls.follow[0].fromPx === 640, JSON.stringify(w3.calls.follow));
    }).then(function () {
    console.log('\nF — old Views stubs without followReply still work (additive)');
    var w2 = freshWorld(false);
    w2.App.generateReply();
    return tick(60)
      .then(function () {
        ok('falls back to stickToBottom, no crash', w2.calls.stick >= 1, 'stick=' + w2.calls.stick);
        console.log('\n' + pass + ' passed, ' + fail + ' failed');
        process.exit(fail ? 1 : 0);
      });
  })
  })
  .catch(function (e) { console.error(e); process.exit(1); });
