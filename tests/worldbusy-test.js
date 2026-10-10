/* v1.21.0 — a manual "correct state" must not interleave with a world turn
 * that is still applying tags to the same run object.
 *
 * Ported from upstream 18.3.5 (destructive-op guards while a chat turn is in
 * progress): the HUD's correct-state button and the "Apply corrections"
 * button are refused while App.state.worldBusy is set, and the idle path is
 * unchanged (a real correction still applies and logs).
 *
 *   node /home/user/tests/worldbusy-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var HW_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'hordeworld.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');
var WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-panic.horde_world'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

var toasts = [], go = [], saves = 0;

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  UI: {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function (t) { toasts.push(String(t)); }
  },
  App: null,   /* filled after the world/run exist */
  Store: { settings: { userName: 'Tester' } },
  document: {
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(HW_SRC, 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });

var HW = sandbox.HW;
var Views = sandbox.Views;

var w = HW.parse(WORLD);
ok('the fixture world parses', !!w);
var run = HW.start(w, w.startingLives[0].id);
run.turn = 3;
run.stats.cash = 120;
run.quests = [{ text: 'Fix the copier before noon', done: false }];

sandbox.App = {
  state: { world: w, worldRun: run, worldBusy: false },
  go: function (s) { go.push(s); }
};
/* the corrected screen itself is rendered on device; here we only need the
   apply path to settle */
Views.worldRun = function () {};
HW.saveRun = function (r) { saves++; return Promise.resolve(r); };

function setBusy(b) { sandbox.App.state.worldBusy = b; }
function toastText() { return toasts.join(' | '); }

/* ---- the HUD button --------------------------------------------------- */
function makeHud() {
  var btn = { addEventListener: function (ev, fn) { if (ev === 'click') this._click = fn; } };
  return {
    _btn: btn,
    querySelectorAll: function (sel) { return sel === '[data-act=wr-correct]' ? [btn] : []; },
    querySelector: function () { return null; }
  };
}
var hud = makeHud();
Views.bindWorldHud(hud, w);

setBusy(true);
hud._btn._click();
ok('hud: refused while a turn is applying', /Wait for the current turn/.test(toastText()), toastText());
ok('hud: no navigation while busy', go.length === 0, JSON.stringify(go));

setBusy(false);
hud._btn._click();
ok('hud: opens the screen when idle', go[go.length - 1] === 'worldcorrect', JSON.stringify(go));

/* ---- the Apply-corrections button ------------------------------------- */
function makeBody() {
  var els = {};
  function el(id, extra) {
    var e = Object.assign({ id: id, value: '', innerHTML: '', textContent: '' }, extra || {});
    e.addEventListener = function (ev, fn) {
      if (ev === 'click') e._click = fn;
      if (ev === 'change') e._change = fn;
    };
    els[id] = e;
    return e;
  }
  el('wc-loc', { value: run.locationId });
  el('wc-loc-hint');
  el('wc-cash', { value: String(run.stats[run.cashId] !== undefined ? run.stats[run.cashId] : 0) });
  (w.hudConfig.stats || []).forEach(function (st) {
    el('wc-stat-' + st.id, { value: String(run.stats[st.id] !== undefined ? run.stats[st.id] : 0) });
  });
  el('wc-item', { value: '' });
  el('wc-item-add');
  el('wc-quest', { value: '' });
  el('wc-quest-add');
  el('wc-inv');
  el('wc-quests');
  el('wc-save');
  return {
    _els: els,
    innerHTML: '',
    querySelector: function (sel) { return els[sel.slice(1)] || null; },
    querySelectorAll: function (sel) { return sel[0] === '#' ? [els[sel.slice(1)]] : []; }
  };
}

function renderCorrect() {
  var body = makeBody();
  var root = { querySelector: function (sel) { return sel === '#world-correct-body' ? body : null; } };
  Views.worldCorrect(root);
  return body;
}

var st0 = (w.hudConfig.stats || [])[0];

/* busy: the edit is refused before anything is touched */
var statId = st0.id, statBefore = run.stats[statId];
setBusy(true);
var body1 = renderCorrect();
var logLen1 = run.log.length;
body1._els['wc-stat-' + statId].value = String(statBefore + 5);
body1._els['wc-save']._click();
ok('apply: refused while a turn is applying', /Wait for the current turn/.test(toastText()), toastText());
ok('apply: nothing saved while busy', saves === 0);
ok('apply: no navigation while busy', go.length === 1, JSON.stringify(go));
ok('apply: the run is untouched while busy',
  run.stats[statId] === statBefore && run.log.length === logLen1);

/* idle: the same edit goes through */
setBusy(false);
var body2 = renderCorrect();
var before = run.stats[statId], logLen2 = run.log.length;
body2._els['wc-stat-' + statId].value = String(before + 5);
body2._els['wc-save']._click();
setTimeout(function () {
  ok('apply: saved when idle', saves === 1);
  ok('apply: the correction is in the run', run.stats[statId] === before + 5,
    'before ' + before + ' now ' + run.stats[statId]);
  ok('apply: logged as a correction', run.log.length === logLen2 + 1 &&
    run.log[logLen2].role === 'correction', JSON.stringify(run.log.slice(-1)));
  ok('apply: back on the run screen', go[go.length - 1] === 'worldrun', JSON.stringify(go));
  ok('apply: success toasted', /World state corrected/.test(toastText()), toastText());

  console.log('');
  if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
  console.log('worldbusy-test: ' + pass + ' ok');
}, 20);
