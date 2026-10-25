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
  setTimeout: setTimeout, clearTimeout: clearTimeout,
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

console.log('\nanchored re-renders (edit / delete mid-thread)');

/* A thread that carries real children: the anchor mechanism is only
   exercised when the previous DOM has message elements to measure. */
function kid(mid, top, bottom) {
  return {
    mid: mid, offsetTop: top, offsetHeight: bottom - top,
    getAttribute: function (n) { return n === 'data-mid' ? this.mid : null; }
  };
}
function fakeImg() {
  var img = {
    complete: false,
    addEventListener: function (t, cb) { (this['_ev_' + t] = this['_ev_' + t] || []).push(cb); },
    fire: function (t) { (this['_ev_' + t] || []).forEach(function (cb) { cb(); }); }
  };
  return img;
}
function anchoredThread(oldKids, newKids, imgs) {
  var t = fakeThread();
  t.children = oldKids;
  t.querySelector = function (sel) {
    var mm = /^\[data-mid="(.*)"\]$/.exec(sel);
    if (!mm) return null;
    for (var i = 0; i < newKids.length; i++) if (newKids[i].mid === mm[1]) return newKids[i];
    return null;
  };
  t.querySelectorAll = function (sel) { return sel === 'img' ? (imgs || []) : []; };
  return t;
}

/* 1) the anchor mechanism itself: a mid-thread re-render restores the
      reader at the same message, same offset into it */
thread = anchoredThread(
  [kid('m1', 0, 1500), kid('m2', 1500, 3000), kid('m3', 3000, 4500)],
  [kid('m1', 0, 1500), kid('m2', 1500, 3000), kid('m3', 3000, 4500)],
  []
);
thread.scrollTop = 1600; // reading 100px into m2 (top 1500, dy 100)
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? thread : null; };
Views.thread(char, null, msgs.concat([{ sessionId: 's1', id: 'm3', role: 'user', text: 'more', createdAt: 3 }]));
/* v1.39.18: SAME pixel, not "anchor snapped into view" (offsetTop + dy) */
ok('mid-thread re-render restores the anchored position', thread.scrollTop === 1600, 'scrollTop=' + thread.scrollTop);

/* 2) the reported bug: accept an edit and the view jumps up. The rebuilt
      thread measures zero-height until its avatars load, so the anchor
      lands near the top; once the images settle the anchor must be
      re-applied or the reader is stranded up the thread. */
var imgs = [fakeImg(), fakeImg(), fakeImg()];
var collapsed = [kid('m1', 0, 100), kid('m2', 100, 200), kid('m3', 200, 300)];
var expanded = [kid('m1', 0, 1500), kid('m2', 1500, 3000), kid('m3', 3000, 4500)];
var t2 = anchoredThread(
  [kid('m1', 0, 1500), kid('m2', 1500, 3000), kid('m3', 3000, 4500)],
  collapsed, imgs
);
t2.scrollTop = 1600;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? t2 : null; };
Views.thread(char, null, msgs.concat([{ sessionId: 's1', id: 'm3', role: 'user', text: 'more', createdAt: 3 }]));
ok('collapsed first layout: the anchor is at least applied once',
  t2.scrollTop === 200, 'scrollTop=' + t2.scrollTop);   /* collapsed m2: top 100 + dy 100 */
/* the avatars land and the content grows back to full height */
collapsed[0].offsetTop = 0; collapsed[0].offsetHeight = 1500;
collapsed[1].offsetTop = 1500; collapsed[1].offsetHeight = 1500;
collapsed[2].offsetTop = 3000; collapsed[2].offsetHeight = 1500;
imgs.forEach(function (im) { im.fire('load'); });
ok('after the images settle, the reader is back at the anchored position', t2.scrollTop === 1600, 'scrollTop=' + t2.scrollTop);

/* 3) but if the reader has deliberately scrolled away in the meantime,
      the re-apply must not yank them back */
var imgs2 = [fakeImg()];
var collapsed2 = [kid('m1', 0, 100), kid('m2', 100, 200), kid('m3', 200, 300)];
var t3 = anchoredThread(
  [kid('m1', 0, 1500), kid('m2', 1500, 3000), kid('m3', 3000, 4500)],
  collapsed2, imgs2
);
t3.scrollTop = 1600;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? t3 : null; };
Views.thread(char, null, msgs.concat([{ sessionId: 's1', id: 'm3', role: 'user', text: 'more', createdAt: 3 }]));
t3.scrollTop = 500; // the reader chose to move
collapsed2[1].offsetTop = 1500; collapsed2[1].offsetHeight = 1500;
imgs2.forEach(function (im) { im.fire('load'); });
ok('a reader who scrolled away is not yanked back', t3.scrollTop === 500, 'scrollTop=' + t3.scrollTop);

console.log('\nv1.28.3: a bottom-pinned re-render survives images landing below the fold');

/* The reported bug: accept an edit, the thread is re-rendered pinned to
   the bottom, then the recreated images (avatars, generated art) load and
   grow the content below the viewport. A one-time bottom jump leaves the
   reader stranded up the thread, above the edited message and its fresh
   reply. Every image landing must re-pin the bottom - for a forced open
   AND a natural near-bottom pin - and must never fight a reader who
   moved on their own. */

function bottomThread(imgs) {
  var t = {
    innerHTML: 'x',
    scrollTop: 0,
    clientHeight: 500,
    querySelector: function () { return null; },
    querySelectorAll: function (sel) { return sel === 'img' ? imgs : []; }
  };
  Object.defineProperty(t, 'scrollHeight', {
    get: function () { return this._sh; },
    set: function (v) { this._sh = v; },
    configurable: true
  });
  t._sh = 1000;                          /* before the images load */
  return t;
}

var b1 = bottomThread([fakeImg(), fakeImg()]);
b1.scrollTop = 0;
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? b1 : null; };
Views.thread(char, null, msgs, null, true);   /* the edit-and-resend re-render (forced) */
ok('a forced bottom open pins to the bottom', b1.scrollTop === 1000, 'scrollTop=' + b1.scrollTop);
b1.scrollHeight = 1400;                        /* the images land: content grows 400px */
b1.querySelectorAll('img')[0].fire('load');
ok('…and an image landing re-pins the bottom', b1.scrollTop === 1400, 'scrollTop=' + b1.scrollTop);
b1.scrollTop = 200;                            /* the reader scrolls up to read (distance 700) */
b1.scrollHeight = 1700;
b1.querySelectorAll('img')[1].fire('load');
ok('…but never yanks a reader who moved on', b1.scrollTop === 200, 'scrollTop=' + b1.scrollTop);

/* the same protection for a NATURAL bottom pin: a re-render while the
   reader is already near the bottom (no force) must re-pin too */
var b2 = bottomThread([fakeImg()]);
b2.scrollTop = 900;                            /* distance = 1000-900-500 → within 260px */
sandbox.document.querySelector = function (sel) { return sel === '#thread' ? b2 : null; };
Views.thread(char, null, msgs);                /* no forceBottom */
ok('a near-bottom re-render pins to the bottom', b2.scrollTop === 1000, 'scrollTop=' + b2.scrollTop);
b2.scrollHeight = 1500;
b2.querySelectorAll('img')[0].fire('load');
ok('…and an image landing re-pins a natural pin too', b2.scrollTop === 1500, 'scrollTop=' + b2.scrollTop);

/* the edit flow itself: the accept-edit re-render must be the forced
   kind, so the pinning (and its image re-pin) applies */
var appSrc = fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/app.js'), 'utf8');
var es = appSrc.indexOf('App.editAndResend = function');
var editSrc = appSrc.slice(es, es + 2200);
var editCall = (editSrc.match(/Views\.thread\([^;]+?\);/) || [''])[0];
ok('the edit-and-resend re-render is pinned to the bottom',
   /Views\.thread\([^;]*true\s*\);/.test(editSrc), editCall.slice(0, 120));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
