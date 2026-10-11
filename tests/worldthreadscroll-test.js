/* The world thread: a finished turn must land at the START of the reply.
 *
 * Regression (user report, v1.24.1): "After you type in your message, the
 * response scrolls you to its end. Then you need to scroll back up to its
 * start so you can read it from its beginning."
 *
 * A world reply is a whole scene that appears at once (no streaming). The
 * turn-completion re-render (Views.worldRun with a changes arg) scrolled to
 * the bottom of the thread - the END of the scene. The reader is stranded
 * at the last line, having to scroll back up to read from the beginning.
 *
 * The fix: when a turn finishes, anchor the scroll at the top of the reply
 * that just arrived (the last non-player message). Check lines and
 * correction notes that follow the reply in the log don't move the anchor.
 * Opening a run and sending a message still land at the bottom, as before.
 *
 *   node /home/user/tests/worldthreadscroll-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }
var WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-panic.horde_world'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- a fake thread with an honest layout ----------------
 * Every top-level row is ROW px tall; offsetTop is cumulative, exactly as
 * against the position:relative .thread in the real CSS. */
var ROW = 400;
function fakeThread() {
  var t = {
    _html: '',
    children: [],
    scrollTop: 0,
    clientHeight: 500,
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(t, 'innerHTML', {
    get: function () { return this._html; },
    set: function (html) {
      this._html = html;
      var starts = [], re = /<div class="(?:msg(?: |")|wr-note"|wr-check-line )/g, m;
      while ((m = re.exec(html))) starts.push(m.index);
      var kids = [];
      for (var i = 0; i < starts.length; i++) {
        var seg = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);
        (function (off, s) {
          var isMsg = /^<div class="msg( |")/.test(s);
          var isMe = /class="msg me"/.test(s);
          kids.push({
            offsetTop: off,
            classList: {
              contains: function (c) {
                if (c === 'msg') return isMsg;
                if (c === 'me') return isMe;
                return false;
              }
            }
          });
        })(i * ROW, seg);
      }
      this.children = kids;
    }
  });
  Object.defineProperty(t, 'scrollHeight', { get: function () { return this.children.length * ROW; } });
  return t;
}

var thread = fakeThread();
var hud = { hidden: true, innerHTML: '', querySelector: function () { return null; }, querySelectorAll: function () { return []; } };

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  fetch: function () { return Promise.resolve({ ok: false }); },
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; }
  },
  Store: { settings: { userName: 'Tester' } },
  document: {
    querySelector: function (sel) {
      if (sel === '#wr-hud') return hud;
      if (sel === '#wr-thread') return thread;
      return null;
    },
    querySelectorAll: function () { return []; }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });

var HW = sandbox.HW;
var Views = sandbox.Views;

var world = HW.parse(WORLD);
var run = HW.start(world, null);
var LONG = 'The rain starts as you cross the square. You walk for a while. The street ' +
  'narrowing, the signs fading, the town giving way to field and tree, the sky ' +
  'going the color of wet slate. You keep walking, and then the fields end at ' +
  'the bank of the river, wide and low and moving fast with the weather.';
var HUD = { changes: ['5 minutes pass'], rejections: [], advisories: [], checks: [] };

function atBottom(t) { return t.scrollTop === t.scrollHeight; }

console.log('\nopening and sending still land at the bottom');

run.log = [{ role: 'assistant', content: LONG, at: 1 }];
thread = fakeThread(); sandbox.document.querySelector = function (s) {
  if (s === '#wr-hud') return hud; if (s === '#wr-thread') return thread; return null;
};
Views.worldRun(world, run);
ok('fresh open → bottom', atBottom(thread), 'scrollTop=' + thread.scrollTop);

run.log = [{ role: 'assistant', content: LONG, at: 1 }, { role: 'user', content: 'Head north', at: 2 }];
thread = fakeThread(); sandbox.document.querySelector = function (s) {
  if (s === '#wr-hud') return hud; if (s === '#wr-thread') return thread; return null;
};
Views.worldRun(world, run);
ok('sending a message → bottom (the player\'s own line)', atBottom(thread), 'scrollTop=' + thread.scrollTop);

console.log('\na finished turn lands at the start of the reply');

run.log = [
  { role: 'assistant', content: LONG, at: 1 },
  { role: 'user', content: 'Head north', at: 2 },
  { role: 'assistant', content: LONG, at: 3 }   /* the reply that just arrived: row 2 */
];
thread = fakeThread(); sandbox.document.querySelector = function (s) {
  if (s === '#wr-hud') return hud; if (s === '#wr-thread') return thread; return null;
};
Views.worldRun(world, run, HUD);
eq('the reader is at the top of the reply, not the end of it', thread.scrollTop, 2 * ROW);
ok('…and not at the bottom', !atBottom(thread), 'scrollTop=' + thread.scrollTop);

console.log('\nlines after the reply do not move the anchor');

run.log = [
  { role: 'user', content: 'Try to cross', at: 1 },
  { role: 'assistant', content: LONG, at: 2 },  /* the reply: row 1 */
  { role: 'check', content: 'Crossing the ford — success (8 vs 6)', at: 3 }
];
thread = fakeThread(); sandbox.document.querySelector = function (s) {
  if (s === '#wr-hud') return hud; if (s === '#wr-thread') return thread; return null;
};
Views.worldRun(world, run, HUD);
eq('a check line after the reply → still anchored at the reply', thread.scrollTop, ROW);

run.log = [
  { role: 'user', content: 'Go west', at: 1 },
  { role: 'assistant', content: LONG, at: 2 },  /* the reply: row 1 */
  { role: 'correction', content: 'Move corrected by the player.', at: 3 }
];
thread = fakeThread(); sandbox.document.querySelector = function (s) {
  if (s === '#wr-hud') return hud; if (s === '#wr-thread') return thread; return null;
};
Views.worldRun(world, run, { changes: ['Moved to the bank'], rejections: [] });
eq('a correction note after the reply → still anchored at the reply', thread.scrollTop, ROW);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
