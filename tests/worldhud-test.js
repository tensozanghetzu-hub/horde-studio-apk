/* World HUD: the sheet folds, and the input is never buried under it.
 *
 * Regression for the phone screen where a 75-line character sheet (an FF14
 * job grid) rendered a HUD taller than several viewports, stuck at the top,
 * with the "What do you do?" input unreachable below it. The HUD must:
 *   - render a one-line summary (place, time/turn, purse, tasks, chips)
 *   - fold large sheets behind a toggle, collapsed by default
 *   - keep small sheets flat, exactly as before
 *   - flip in place on toggle (no re-render, so the change chips survive)
 *
 * Note: the CSS half of the fix (max-height:45vh + internal scroll) is
 * layout, and is verified on device, not here.
 *
 *   node /home/user/tests/worldhud-test.js
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
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  fetch: function (f) {
    var file = path.join(ROOT, 'horde-studio-mobile', String(f));
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
    } });
  },
  UI: {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; }
  },
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
var life = w.startingLives[0];
var run = HW.start(w, life.id);
run.turn = 3;
run.stats.cash = 120;
run.quests = [{ text: 'Fix the copier before noon', done: false }];
var loc = HW.location(w, run.locationId);
var clockText = HW.clockOf(run, w.hudConfig).text;

console.log('\na large sheet (7 stats) folds');

eq('the fixture is just over the fold line', (w.hudConfig.stats || []).length, 7);
Views.wrHudOpen(false);
var html = Views.worldHud(w, run, ['dollars +10']);

ok('the summary names the place', html.indexOf(loc.name) >= 0, html.slice(0, 120));
ok('the summary shows the world clock', html.indexOf(clockText) >= 0, clockText);
ok('the summary shows the turn', html.indexOf('turn 3') >= 0);
ok('the summary shows the purse', html.indexOf('<b>120</b> dollars') >= 0);
ok('the summary shows open tasks', html.indexOf('tasks: Fix the copier before noon') >= 0);
ok('the sheet is folded by default', /<div class="wr-hud-more" hidden>/.test(html));
ok('the toggle offers the sheet with a count', html.indexOf('sheet (7)') >= 0);
ok('the folded sheet still holds the stats',
  html.indexOf('Performance <b>' + run.stats.performance + '</b>/100') >= 0 &&
  html.indexOf('Nerve <b>' + run.stats.nerve + '</b>/10') >= 0);
ok('the folded sheet still holds the inventory',
  html.indexOf(escLite(run.inventory[0])) >= 0);
ok('the change chips sit outside the fold',
  html.indexOf('wr-changes') > html.indexOf('wr-hud-more'));
ok('the last-turn chip is visible while folded', html.indexOf('dollars +10') >= 0);

function escLite(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

console.log('\nthe toggle expands and collapses');

Views.wrHudOpen(true);
var openHtml = Views.worldHud(w, run, null);
ok('expanded: the sheet is not hidden', openHtml.indexOf('wr-hud-more" hidden') < 0);
ok('expanded: the label flips', openHtml.indexOf('hide sheet') >= 0);

function fakeHud() {
  var btn = { textContent: 'sheet (7)' };
  btn.addEventListener = function (ev, fn) { if (ev === 'click') this._click = fn; };
  var more = { hidden: true };
  return {
    hidden: false,
    innerHTML: '',
    _btn: btn,
    _more: more,
    querySelectorAll: function (sel) {
      return sel === '[data-act=wr-hud-toggle]' ? [btn] : [];
    },
    querySelector: function (sel) {
      if (sel === '.wr-hud-more') return more;
      if (sel === '[data-act=wr-hud-toggle]') return btn;
      return null;
    }
  };
}

Views.wrHudOpen(false);
var hud = fakeHud();
hud.innerHTML = Views.worldHud(w, run, ['dollars +10']);
Views.bindWorldHud(hud, w);
ok('the handler is attached', typeof hud._btn._click === 'function');
hud._btn._click();
eq('one click opens the sheet', hud._more.hidden, false);
eq('the label says hide', hud._btn.textContent, 'hide sheet');
hud._btn._click();
eq('the next click folds it back', hud._more.hidden, true);
eq('the label offers the count again', hud._btn.textContent, 'sheet (7)');
ok('a re-render after the toggle keeps the state',
  Views.worldHud(w, run, null).indexOf('wr-hud-more" hidden') >= 0);
ok('re-binding does not double-flip (fresh element per render)',
  (function () {
    var h2 = fakeHud();
    h2.innerHTML = Views.worldHud(w, run, null);
    Views.bindWorldHud(h2, w);
    h2._btn._click();
    return h2._more.hidden === false;
  })());

console.log('\na small sheet stays flat');

var small = HW.parse(WORLD);
small.hudConfig.stats = small.hudConfig.stats.slice(0, 4);
var smallRun = HW.start(small, life.id);
var flat = Views.worldHud(small, smallRun, null);
ok('no toggle on a small sheet', flat.indexOf('wr-hud-toggle') < 0);
ok('its stats are visible, not hidden',
  /<div class="wr-hud-more">/.test(flat) &&
  flat.indexOf('Performance <b>' + smallRun.stats.performance + '</b>/100') >= 0 &&
  flat.indexOf('wr-hud-more" hidden') < 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
