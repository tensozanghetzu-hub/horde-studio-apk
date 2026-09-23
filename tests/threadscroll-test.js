/* Opening a chat must land on the last message, not the first.
 *
 * The renderer half pinned here: Views.thread scrolls to the bottom when
 * (a) the thread is freshly opened (forceBottom — regardless of where the
 * previous content's scroll position was), (b) the user was already near the
 * bottom on a re-render, or (c) a reply is streaming. A mid-scroll re-render
 * (edit/delete) must keep the user's position.
 *
 * The layout half — .screen-chat being a fixed height so .thread is the
 * actual scroller (min-height let long threads scroll the window, which is
 * why the old code landed at the top) — is CSS and verified on device.
 *
 *   node /home/user/tests/threadscroll-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function fakeThread() {
  var t = {
    innerHTML: '',
    scrollTop: 0,
    clientHeight: 500,
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  /* empty thread = no overflow; any content = a 5000px-tall conversation */
  Object.defineProperty(t, 'scrollHeight', { get: function () { return this.innerHTML ? 5000 : 0; } });
  return t;
}

var thread = fakeThread();
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  fetch: function () { return Promise.resolve({ ok: false }); },
  UI: {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    md: function (s) { return String(s || ''); },
    icon: function (name) { return '<svg data-icon="' + name + '"></svg>'; }
  },
  Store: { settings: { userName: 'Tester' } },
  document: {
    querySelector: function (sel) { return sel === '#thread' ? thread : null; },
    querySelectorAll: function () { return []; }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });

var Views = sandbox.Views;
var char = { id: 'c1', name: 'Vera', avatar: null, systemPrompt: '' };
var msgs = [{ sessionId: 's1', id: 'm1', role: 'user', text: 'hello', createdAt: 1 },
  { sessionId: 's1', id: 'm2', role: 'assistant', text: 'hi', createdAt: 2 }];
var BOTTOM = 5000;

console.log('\nfresh open (app restart) lands on the last message');

thread = fakeThread();
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs, null, true);
ok('empty previous thread → bottom', thread.scrollTop === BOTTOM, 'scrollTop=' + thread.scrollTop);

thread = fakeThread();
thread.innerHTML = 'old content';      // user was at the very top of a long previous chat
thread.scrollTop = 0;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs, null, true);
ok('top of a long previous chat → still bottom', thread.scrollTop === BOTTOM, 'scrollTop=' + thread.scrollTop);

console.log('\nre-renders keep their rules');

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 1000;               // mid-scroll: the user is reading
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs);
ok('mid-scroll re-render (no forceBottom) keeps the position', thread.scrollTop === 1000, 'scrollTop=' + thread.scrollTop);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4500;               // already near the bottom of the old content
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs);
ok('near-bottom re-render follows the content', thread.scrollTop === BOTTOM, 'scrollTop=' + thread.scrollTop);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 0;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs, 'm2');
ok('a streaming reply scrolls to the bottom', thread.scrollTop === BOTTOM, 'scrollTop=' + thread.scrollTop);

console.log('\nincoming text must not fight a reader');

/* The reported bug: scrolled up to read a reply from its start, and a
   finished reply yanked the view to the last word. */
thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4500;               // at the bottom, watching
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
ok('at the bottom: incoming text follows', Views.stickToBottom(thread) === true && thread.scrollTop === BOTTOM);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4400;               // 100px up — still effectively at the bottom
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
ok('slightly scrolled up (<260px): still follows', Views.stickToBottom(thread) === true && thread.scrollTop === BOTTOM);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4000;               // 500px up — the user is reading
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
ok('reading (scrolled up): a finished reply does NOT yank the view',
  Views.stickToBottom(thread) === false && thread.scrollTop === 4000, 'scrollTop=' + thread.scrollTop);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4000;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
ok('…unless forced (opening a chat)', Views.stickToBottom(thread, true) === true && thread.scrollTop === BOTTOM);

console.log('\nappending a message');

/* appendMessage needs createElement */
var created = { _h: '' };
Object.defineProperty(created, 'innerHTML', {
  set: function (h) { this._h = h; this.firstElementChild = { html: h }; },
  get: function () { return this._h; }
});
thread.appendChild = function () {};
sandbox.document.createElement = function () { return created; };
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 1000;               // the user is reading mid-history
thread.appendChild = function () {};
Views.appendMessage(char, { sessionId: 's1', id: 'm9', role: 'assistant', text: 'a new message', createdAt: 9 });
ok('an incoming message keeps a reader where they are', thread.scrollTop === 1000, 'scrollTop=' + thread.scrollTop);

thread = fakeThread();
thread.innerHTML = 'old content';
thread.scrollTop = 4500;               // the user is at the bottom
thread.appendChild = function () {};
Views.appendMessage(char, { sessionId: 's1', id: 'm10', role: 'assistant', text: 'a new message', createdAt: 10 });
ok('an incoming message follows when the user is at the bottom', thread.scrollTop === BOTTOM, 'scrollTop=' + thread.scrollTop);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
