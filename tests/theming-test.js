/* Themes: a persisted appearance setting that re-skins the whole app.
 *
 * The app is built on CSS custom properties (184 var() sites); a theme is a
 * token set. THEMES.apply(name) re-colors document.documentElement,
 * Store.settings.theme persists the pick, Settings → Appearance lists all
 * of them, and App.chooseTheme is the one action the rows call.
 *
 *   node /home/user/tests/theming-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

var REQUIRED = ['--bg','--bg-2','--surface','--surface-2','--line','--line-soft',
  '--text','--muted','--dim','--accent','--accent-2','--accent-deep','--accent-tint',
  '--accent-soft','--glow-1','--glow-2','--bar-bg','--ok','--warn','--err'];
var HEX = /^#[0-9a-fA-F]{3,8}$/;
var RGBA = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[0-9.]+\s*)?\)$/;

/* ---------------- fake DOM ---------------- */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '', children: [],
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
    querySelectorAll: function () { return []; },
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
function deepFake() {
  var e = el();
  e.querySelector = function () { return deepFake(); };
  e.querySelectorAll = function () { return []; };
  return e;
}
var docElStyle = {};
var savedSettings = [];
/* The real settings section views write into the static #settings-x-body,
   so the view under test gets one element to write into and read back. */
var settingsBody = el();
var documentStub = {
  documentElement: { style: { setProperty: function (k, v) { docElStyle[k] = v; } } },
  addEventListener: function () {},
  querySelector: function (sel) {
    if (sel === '.screen') return { querySelector: function () { return deepFake(); } };
    if (sel === '#settings-x-body') return settingsBody;
    if (sel && sel.charAt(0) === '#') return el();
    return null;
  },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return id === 'settings-x-body' ? settingsBody : el(); },
  createElement: function () { return el(); }
};

var Store = {
  settings: { provider: 'horde', userName: 'Tester', theme: 'midnight' },
  characters: [], personas: [],
  saveSettings: function () { savedSettings.push(Object.assign({}, Store.settings)); return Promise.resolve(); }
};

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
  Store: Store,
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: { generate: function () { return Promise.resolve('…'); } }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/themes.js'), 'utf8'), sandbox, { filename: 'themes.js' });
vm.runInNewContext(fs.readFileSync(src('js/ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

var THEMES = sandbox.THEMES;
var Views = sandbox.Views;
var App = sandbox.App;

(async function () {
  console.log('\nthe registry');
  var ids = THEMES.list();
  eq('sixteen themes', ids.length, 16);
  ok('midnight is among them', ids.indexOf('midnight') !== -1, ids.join(','));
  ids.forEach(function (id) {
    var t = THEMES.get(id);
    ok(id + ' has a display name', !!(t && t.name && t.name.length), JSON.stringify(t && t.name));
    var missing = REQUIRED.filter(function (k) { return !t.tokens[k]; });
    ok(id + ' has every required token', !missing.length, missing.join(','));
    var bad = Object.keys(t.tokens).filter(function (k) {
      return !HEX.test(t.tokens[k]) && !RGBA.test(t.tokens[k]);
    });
    ok(id + ' token values are colors', !bad.length, bad.join(','));
  });
  eq('unknown id falls back to midnight', THEMES.get('nope').name, THEMES.get('midnight').name);

  console.log('\napply re-colors the document');
  THEMES.apply('abyss');
  eq('--accent becomes abyss blue', docElStyle['--accent'], '#38bdf8');
  eq('every token landed', Object.keys(docElStyle).length, REQUIRED.length);
  THEMES.apply('porcelain');
  eq('light theme applies its light bg', docElStyle['--bg'], '#f2f5f8');
  THEMES.apply('nope');
  eq('an unknown name applies midnight, not nothing', docElStyle['--accent'], THEMES.get('midnight').tokens['--accent']);

  console.log('\nchoosing a theme persists it');
  await App.chooseTheme('loam');
  eq('the setting holds the pick', Store.settings.theme, 'loam');
  eq('the document wears it', docElStyle['--accent'], '#34d399');
  ok('settings were saved', savedSettings.length === 1 && savedSettings[0].theme === 'loam',
    JSON.stringify(savedSettings.map(function (s) { return s.theme; })));
  await App.chooseTheme('bogus-theme');
  eq('a bogus pick falls back to midnight', Store.settings.theme, 'midnight');
  eq('…and the document follows', docElStyle['--accent'], THEMES.get('midnight').tokens['--accent']);

  console.log('\nthe Appearance screen lists them all, and marks the pick');
  Store.settings.theme = 'crimson';
  Views.settingsAppearance();
  var body = settingsBody;
  ids.forEach(function (id) {
    var t = THEMES.get(id);
    ok('row for ' + t.name, body.innerHTML.indexOf(t.name) !== -1);
  });
  var onRows = (body.innerHTML.match(/class="theme-row on" data-th="([a-z-]+)"/g) || [])
    .map(function (m) { return m.match(/data-th="([a-z-]+)"/)[1]; });
  eq('exactly one row is marked on', onRows.length, 1, onRows.join(','));
  eq('…and it is the current one', onRows[0], 'crimson');
  eq('…sixteen rows total', (body.innerHTML.match(/class="theme-row/g) || []).length, 16);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
