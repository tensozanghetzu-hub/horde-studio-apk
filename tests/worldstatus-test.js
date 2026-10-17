/* World status: a button anywhere in the conversation that brings up the
 * whole run's state - the phone's answer to the desktop sidebar.
 *
 * The desktop app tracks the world's stats in a side panel. On a phone the
 * HUD line at the top of the world screen is all most runs get, and it sits
 * above the thread - mid-scene, the numbers are off in a corner or folded.
 *
 * The feature: the top bar's action button (always visible, whatever the
 * thread has scrolled to) opens a sheet with the run's full state -
 * place + exits, time + turn, every stat, purse, pockets, tasks, and the
 * party (the companion ledger). While the sheet is open, a finishing turn
 * re-renders it, so it never shows stale numbers.
 *
 *   node /home/user/tests/worldstatus-test.js
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

/* ---------------- fake DOM ---------------- */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '',
    children: [],
    classList: {
      _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c) { this._s[c] = !this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    addEventListener: function () {},
    appendChild: function (c) { this.children.push(c); return c; },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    querySelector: function () { return null; },
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var els = {
  '#wr-input': el(),
  '#wr-hud': el(),
  '#wr-thread': el({ scrollTop: 0, scrollHeight: 0 }),
  '#wr-typing': el(),
  '#bar-title': el(),
  '#bar-sub': el(),
  '#btn-back': el(),
  '#btn-bar-action': el(),
  '#toast': el()
};
var byId = {
  'sheet-wrap': el(),
  'sheet-title': el(),
  'sheet-body': el(),
  'sheet-actions': el(),
  'toast': els['#toast']
};
/* the sheet-actions element tracks its children through innerHTML resets */
Object.defineProperty(byId['sheet-actions'], 'innerHTML', {
  get: function () { return this._h || ''; },
  set: function (v) { this._h = v; this.children = []; }
});

function deepFake() {
  var e = el();
  e.querySelector = function () { return deepFake(); };
  e.querySelectorAll = function () { return []; };
  return e;
}
var bootListener = null;
/* The real DOM has one section per screen, and
   document.querySelector('.screen') returns the FIRST one in document
   order. The correction body lives in its own section, so a view that
   looks for it *inside the first .screen* finds nothing and the screen
   renders blank on the device. The fake must be honest about that. */
var screenFirst = el();
var correctBody = el();
correctBody.querySelector = function (sel) {
  if (sel && sel.indexOf('#wc-') === 0) return el();
  return null;
};
var documentStub = {
  documentElement: { style: { setProperty: function () {} } },
  addEventListener: function (ev, fn) { if (ev === 'DOMContentLoaded') bootListener = fn; },
  querySelector: function (sel) {
    if (sel === '.screen') return screenFirst;
    if (sel === '#world-correct-body') return correctBody;
    if (els[sel]) return els[sel];
    /* global id lookups (bindGlobal, the correction screen, boot) get a
       fresh honest fake; only class/attribute selectors return null */
    if (sel && sel.charAt(0) === '#') return el();
    return null;
  },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return byId[id] || (id ? el() : null); },
  createElement: function () { return el(); }
};

/* ---------------- the referee's script ---------------- */
var replies = [];
var API = { generate: function () { return Promise.resolve(replies.shift() || '…'); } };

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
  addEventListener: function () {},
  fetch: function () { return Promise.resolve({ ok: false }); },
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  Store: { settings: { provider: 'horde', userName: 'Tester' }, characters: [], personas: [], init: function () { return Promise.resolve(); } },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: API
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/themes.js'), 'utf8'), sandbox, { filename: 'themes.js' });
vm.runInNewContext(fs.readFileSync(src('js/ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

var HW = sandbox.HW;
var UI = sandbox.UI;
var Views = sandbox.Views;
var App = sandbox.App;

var world = HW.parse(WORLD);
var run = HW.start(world, null);
run.turn = 3;
run.stats.cash = 120;
run.inventory = ['brass lantern', 'wet map'];
run.quests = [{ text: 'Find the ferryman', done: false }, { text: 'Pay the toll', done: true }];
run.companions = [{ name: 'Nisha Patel', since: 2, at: run.locationId }];
var loc = HW.location(world, run.locationId);

function settle(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
function closeSheet() { UI.closeSheet(); }

(async function () {
  console.log('\nthe sheet renders the whole run');
  var html = Views.worldStatusSheet(world, run);
  ok('where you are', html.indexOf(loc.name) !== -1, html.slice(0, 120));
  ok('clock + turn', html.indexOf(HW.clockOf(run, world.hudConfig).text) !== -1 && /turn\s*3/.test(html));
  (world.hudConfig.stats || []).forEach(function (st) {
    if (run.stats[st.id] === undefined) return;
    ok('stat: ' + st.name + ' ' + run.stats[st.id], html.indexOf(st.name) !== -1 && html.indexOf(String(run.stats[st.id])) !== -1);
  });
  ok('purse with the world\'s currency', /120/.test(html) && html.indexOf(world.gameRules.currencyName || 'cash') !== -1);
  ok('pockets', html.indexOf('brass lantern') !== -1 && html.indexOf('wet map') !== -1);
  ok('open task only', html.indexOf('Find the ferryman') !== -1 && html.indexOf('Pay the toll') === -1);
  ok('the party', html.indexOf('Nisha Patel') !== -1 && /joined at/.test(html));

  console.log('\nthe calendar and the life on the sheet (v1.32.0)');
  var runLife = HW.start(world, 'origin_new_hire');
  var lifeHtml = Views.worldStatusSheet(world, runLife);
  ok('season on the world calendar',
    lifeHtml.indexOf('Season: Maplebridge civic year · early spring · day 1') !== -1);
  ok('who you set out to be', lifeHtml.indexOf('You are: entry level · employee on probation') !== -1);
  ok('what you are wearing', /Wearing: new office clothes/.test(lifeHtml));
  var wNoSeas = Object.assign({}, world, { sandboxConfig: {} });
  ok('a season-less world shows no season line',
    Views.worldStatusSheet(wNoSeas, HW.start(wNoSeas, null)).indexOf('Season:') === -1 &&
    lifeHtml.indexOf('Season:') !== -1);

  console.log('\nempty corners say so, quietly');
  var bare = HW.start(world, null);
  bare.stats.cash = 0;
  var bareHtml = Views.worldStatusSheet(world, bare);
  ok('no party → a quiet line', /no one|alone|no companions/i.test(bareHtml), bareHtml.slice(0, 200));
  ok('no pockets → a quiet line', /empty|nothing/i.test(bareHtml));

  console.log('\nthe button lives in the top bar, wherever you are');
  bootListener();          /* app boot: bindGlobal wires the bar button */
  await settle(10);
  App.state.world = world;
  App.state.worldRun = run;
  App.go('worldcorrect');
  eq('hidden off the world screen', els['#btn-bar-action'].hidden, true);
  App.go('worldrun');
  eq('visible on the world screen', els['#btn-bar-action'].hidden, false);
  App.go('worldcorrect');
  eq('…and hidden again when you leave', els['#btn-bar-action'].hidden, true);
  App.go('worldrun');

  console.log('\npushing it brings up the status');
  els['#btn-bar-action'].onclick();
  eq('the sheet is open', byId['sheet-wrap'].hidden, false);
  ok('titled with the world', byId['sheet-title'].innerHTML.indexOf(UI.esc(world.name)) !== -1, byId['sheet-title'].innerHTML);
  ok('body carries the state', byId['sheet-body'].innerHTML.indexOf(loc.name) !== -1 &&
    byId['sheet-body'].innerHTML.indexOf('Nisha Patel') !== -1);

  console.log('\na finishing turn refreshes an open sheet');
  els['#wr-input'].value = 'Head toward the river';
  replies.push('On, then, along the bank. [[clock:+10]]');
  App.worldTurn();
  await settle(30);
  eq('the run counted', run.turn, 4);
  ok('…and the open sheet shows the new turn', /turn\s*4/.test(byId['sheet-body'].innerHTML),
    byId['sheet-body'].innerHTML.slice(0, 200));

  console.log('\nclosing and correcting');
  var actions = byId['sheet-actions'].children;
  var correct = null, close = null;
  actions.forEach(function (b) {
    if (String(b.textContent).toLowerCase().indexOf('correct') !== -1) correct = b;
    if (String(b.textContent).toLowerCase().indexOf('close') !== -1) close = b;
  });
  ok('a correct-state action is offered', !!correct, actions.map(function (b) { return b.textContent; }).join(' | '));
  if (correct) {
    correct.onclick();
    await settle(5);
    eq('it goes to the correction screen', App.state.screen, 'worldcorrect');
    /* the device bug: the view resolved its body against the wrong screen
       and rendered nothing. The body element must actually be filled. */
    ok('…and the correction screen actually renders',
       String(correctBody.innerHTML).indexOf('Apply corrections') !== -1,
       String(correctBody.innerHTML).slice(0, 60));
    ok('…with a Party section (v1.28.0)',
       /Party/.test(correctBody.innerHTML) && correctBody.innerHTML.indexOf('id="wc-companion"') !== -1,
       String(correctBody.innerHTML).slice(0, 120));
    App.go('worldrun');
  }
  els['#btn-bar-action'].onclick();           /* open again */
  await settle(5);
  byId['sheet-actions'].children
    .filter(function (b) { return String(b.textContent).toLowerCase().indexOf('close') !== -1; })[0].onclick();
  eq('the sheet closes', byId['sheet-wrap'].hidden, true);
  await settle(5);
  eq('…and the app knows it is closed', !!App.state.worldStatusOpen, false);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
