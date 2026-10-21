/* The world run's top bar: "turn N" must follow the run.
 *
 * Regression (user report, v1.24.0): the header sat at "turn 0" through an
 * entire session and only showed the real count after exiting and reentering
 * the world. The label is written by App.go('worldrun') - i.e. on navigation
 * only. A turn finishing re-renders the screen (Views.worldRun) but never
 * the bar, so the count froze at whatever the last navigation showed.
 *
 * The fix lives in App.worldTurn's finishTurn: after HW.commit (which is
 * where run.turn increments) the bar is refreshed - guarded so a turn that
 * finishes after the player has navigated away cannot write a turn count
 * onto another screen's bar.
 *
 *   node /home/user/tests/worldturnbar-test.js
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

/* ---------------- a small honest DOM ---------------- */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '',
    scrollTop: 0, scrollHeight: 0,
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    addEventListener: function () {},
    getAttribute: function () { return null; },
    setAttribute: function () {},
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var els = {
  '#wr-input': el(),
  '#wr-hud': el(),
  '#wr-thread': el(),
  '#wr-typing': el(),
  '#bar-title': el(),
  '#bar-sub': el(),
  '#btn-back': el(),
  '#btn-bar-action': el()
};
var documentStub = {
  addEventListener: function () {},
  querySelector: function (sel) { return els[sel] || null; },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return els['#' + id] || null; }
};

/* ---------------- the referee's script ---------------- */
var replies = [];           /* API.generate returns these in order          */
var pending = null;         /* a turn the test controls by hand             */
var API = {
  generate: function () {
    if (pending) { var p = pending; pending = null; return p.promise; }
    return Promise.resolve(replies.shift() || '…');
  }
};

var sandbox = {
  AbortController: AbortController,
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  fetch: function () { return Promise.resolve({ ok: false }); },
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function () {},
    sheet: function () {}
  },
  Store: { settings: { provider: 'horde' } },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: API
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

var HW = sandbox.HW;
var App = sandbox.App;
var bar = els['#bar-sub'];

var world = HW.parse(WORLD);
var run = HW.start(world, null);
App.state.world = world;
App.state.worldRun = run;

function settle(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

/* ---------------- run ---------------- */
(async function () {
  console.log('\nthe bar opens with the real count');
  App.go('worldrun');
  eq('the bar shows turn 0 for a fresh run', bar.textContent, 'turn 0');

  console.log('\nthe bar follows each finished turn');
  els['#wr-input'].value = 'Head toward the river';
  replies.push('The path west opens toward the water. [[clock:+5]]');
  App.worldTurn();
  await settle(30);
  eq('the run itself counted the turn', run.turn, 1);
  eq('the bar now says turn 1', bar.textContent, 'turn 1');

  els['#wr-input'].value = 'Keep going';
  replies.push('On, then, along the bank. [[clock:+10]]');
  App.worldTurn();
  await settle(30);
  eq('the second turn counts too', run.turn, 2);
  eq('the bar now says turn 2', bar.textContent, 'turn 2');

  console.log('\na turn that finishes after the player left is silent');
  els['#wr-input'].value = 'Look for the bridge';
  var deferred = {};
  deferred.promise = new Promise(function (res) { deferred.resolve = res; });
  pending = deferred;
  App.worldTurn();
  App.state.screen = 'chats';          /* walked away while the referee writes */
  bar.textContent = '';                /* whatever the chats bar shows */
  deferred.resolve('A bridge, upstream. [[clock:+5]]');
  await settle(30);
  ok('the finished turn did not write onto another screen\'s bar', bar.textContent === '',
    'got ' + JSON.stringify(bar.textContent));
  eq('…but the run still counted', run.turn, 3);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
