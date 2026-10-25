/* editanchor-test — v1.39.18: confirming an edit must not jump the thread.
 *
 * Reported live: edit an ASSISTANT reply, press OK, and the view pops a few
 * messages UP. The thread re-render anchors on the scroll position it reads
 * AT RENDER TIME — but by then the edit sheet just gave up the on-screen
 * keyboard, the viewport is mid-reflow, and scrollTop already drifted.
 * Anchoring on a corrupted position restores the corruption.
 *
 * Player-message edits didn't show it because edit-and-resend pins the
 * bottom by design. The assistant path uses the mid-thread anchor.
 *
 * Fix: the app captures the anchor when the edit sheet OPENS (keyboard not
 * out yet) and hands it to Views.thread as `preAnchor`; the re-render
 * restores THAT position instead of trusting the current one.
 *
 *   node /home/user/tests/editanchor-test.js
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

/* a message element stub with geometry */
function msgEl(mid, top, height) {
  return {
    _mid: mid, offsetTop: top, offsetHeight: height,
    getAttribute: function (n) { return n === 'data-mid' ? this._mid : null; }
  };
}

function fakeThread(children, clientHeight) {
  var t = {
    innerHTML: '',
    scrollTop: 0,
    clientHeight: clientHeight || 500,
    children: children || [],
    querySelector: function (sel) {
      var m = /data-mid="([^"]+)"/.exec(sel);
      if (m) {
        for (var i = 0; i < t.children.length; i++) if (t.children[i]._mid === m[1]) return t.children[i];
      }
      return null;
    },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(t, 'scrollHeight', { get: function () { return this.innerHTML ? 5000 : 0; } });
  return t;
}

function loadViews(thread) {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    fetch: function () { return Promise.resolve({ ok: false }); },
    UI: {
      esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      md: function (s) { return String(s || ''); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; }
    },
    Store: { settings: { userName: 'Tester' } },
    document: {
      querySelector: function (sel) { return sel === '#thread' ? thread : null; },
      querySelectorAll: function () { return []; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

var char = { id: 'c1', name: 'Vera', avatar: null, systemPrompt: '' };
function sixMsgs() {
  return [1, 2, 3, 4, 5, 6].map(function (i) {
    return { sessionId: 's1', id: 'm' + i, role: i % 2 ? 'user' : 'assistant', text: 'message ' + i, createdAt: i };
  });
}
function sixEls(topShift) {
  return [1, 2, 3, 4, 5, 6].map(function (i) {
    return msgEl('m' + i, (i - 1) * 400 + (topShift && i >= (topShift.at || 99) ? topShift.by : 0), 400);
  });
}

console.log('A — documents the failure the user saw (no pre-anchor: the drift sticks)');
var els = sixEls();
var thread = fakeThread(els);
thread.scrollTop = 2050;            /* reading message 6 (top 2000), 50px in */
var Views = loadViews(thread);
var preAnchor = Views.threadAnchor(thread.children, thread.scrollTop);
ok('the captured anchor points at message 6, 50px down',
  preAnchor && preAnchor.mid === 'm6' && preAnchor.dy === 50, JSON.stringify(preAnchor));

/* keyboard closes mid-sheet: at render time the position already drifted.
   (After the dy-sign fix, a correct anchor on the drifted position just
   restores THE DRIFT — hence the pre-capture.) */
thread.scrollTop = 1000;
Views.thread(char, null, sixMsgs());       /* old call shape — what the app used to do */
ok('without a pre-anchor the corrupted position is restored (the bug)',
  thread.scrollTop === 1000 && thread.scrollTop !== 2050, 'scrollTop=' + thread.scrollTop);

console.log('\nB — a pre-captured anchor overrides the drifted position');
els = sixEls(); thread = fakeThread(els);
thread.scrollTop = 2050;
Views = loadViews(thread);
preAnchor = Views.threadAnchor(thread.children, thread.scrollTop);
thread.scrollTop = 1000;                 /* the drift between sheet-open and confirm */
Views.thread(char, null, sixMsgs(), null, false, preAnchor);
ok('confirming the edit lands back where the reader was (m6, 50px in)',
  thread.scrollTop === 2050, 'scrollTop=' + thread.scrollTop);

console.log('\nC — the edited message ABOVE the reader changed height: anchor still lands');
els = sixEls(); thread = fakeThread(els);
thread.scrollTop = 2050;
Views = loadViews(thread);
preAnchor = Views.threadAnchor(thread.children, thread.scrollTop);
thread.scrollTop = 1000;
/* the edit made an earlier message taller: everything from m4 down shifts 160px */
thread.children = sixEls({ at: 4, by: 160 });
Views.thread(char, null, sixMsgs(), null, false, preAnchor);
ok('restore follows the shifted layout (m6 top is now 2160, dy 50)',
  thread.scrollTop === 2160 + 50, 'scrollTop=' + thread.scrollTop);

console.log('\nD — established callers are untouched');
els = sixEls(); thread = fakeThread(els);
thread.scrollTop = 2050;
Views = loadViews(thread);
var anchor = Views.threadAnchor(thread.children, thread.scrollTop);
Views.thread(char, null, sixMsgs(), null, true, anchor);
ok('forceBottom (edit-and-resend) still pins the bottom, preAnchor or not',
  thread.scrollTop === 5000, 'scrollTop=' + thread.scrollTop);
els = sixEls(); thread = fakeThread(els);
thread.scrollTop = 2050;
Views = loadViews(thread);
Views.thread(char, null, sixMsgs(), 'm6', false, anchor);
ok('an in-flight reply still keeps the bottom pin', thread.scrollTop === 5000, 'scrollTop=' + thread.scrollTop);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
