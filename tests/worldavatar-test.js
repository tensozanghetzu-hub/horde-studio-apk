/* v1.30.0 — worlds keep their face: the banner the PC version shows as the
 * world's avatar must survive import and be shown on the phone.
 *
 * The PC version (upstream app.js) renders `world.banner` as the world's
 * avatar in the library and the DM header, with a fallback when absent.
 * The APK's HW.parse used to strip it (it was in MEDIA_KEYS, and any
 * top-level data: URI went with it). Now:
 *   - parse keeps `banner` (the ONE image a world carries) and still
 *     strips every other top-level data: URI and the bulk media keys
 *   - the import path diets the banner (512px long edge, like card
 *     images) before it is stored, so a 2.5 MB world still arrives small
 *   - the worlds screen shows the avatar on installed-world and
 *     in-progress cards (initials fallback when there is no banner)
 *   - the run's status sheet shows the world's face at the top
 *
 *   node /home/user/tests/worldavatar-test.js
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

/* ---------------- a small honest DOM (worldturnbar pattern) ------------ */
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
  '#worlds-body': el(),
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

/* ---------------- fake IDB: real in-memory stores ---------------------- */
var stores = { worlds: {}, worldRuns: {} };
var fakeDb = {
  put: function (s, v) {
    if (!stores[s]) return Promise.resolve();
    stores[s][v.id] = v;
    return Promise.resolve();
  },
  getAll: function (s) {
    return Promise.resolve(Object.keys(stores[s] || {}).map(function (k) { return stores[s][k]; }));
  },
  get: function (s, id) { return Promise.resolve((stores[s] || {})[id] || null); },
  del: function (s, id) { delete (stores[s] || {})[id]; return Promise.resolve(); }
};

/* ---------------- the file "the user imports" --------------------------- */
var BANNER = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVzd/';
var OTHER_ART = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA';
var FILE_WORLD = {
  _format: 'horde-world', _version: '1.4',
  id: 'world_lantern', name: 'The Lantern Marches',
  description: 'A river town that keeps its debts in light.',
  startLocationId: 'loc_guild',
  locations: [{ id: 'loc_guild', name: 'The Guild Hall', description: 'Lanterns on the rail.' }],
  entities: [{ id: 'e_bram', name: 'Bram Kest', type: 'npc', description: 'The broker.' }],
  factions: [], relationships: [], lorebook: [],
  gameRules: {}, hudConfig: {}, startingLives: [],
  intro: 'The hall is quiet.', dmPrompt: 'Be the ledger.',
  banner: BANNER,
  artwork: OTHER_ART,                    /* another top-level data: URI */
  mediaAssets: [{ id: 'a1', src: OTHER_ART }],
  _mediaManifest: { count: 1 },
  presentation: { mode: 'classic' },
  visuals: [{ id: 'v1' }],
  kernel: { note: 'pass-through unknown' },
  worldAgent: { enabled: true }
};

var toasts = [];
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  fetch: function (f) {
    var file = path.join(ROOT, 'horde-studio-mobile', String(f));
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
    } });
  },
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function (m) { toasts.push(String(m)); },
    sheet: function () {}
  },
  Store: { settings: { provider: 'horde' } },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: { generate: function () { return Promise.resolve(''); } },
  IDB: fakeDb
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

var HW = sandbox.HW;
var Views = sandbox.Views;
var App = sandbox.App;

function fileText() { return JSON.stringify(FILE_WORLD); }
/* the import path reads through Views.pickFile; hand it the file */
Views.pickFile = function () {
  return Promise.resolve({ text: function () { return Promise.resolve(fileText()); } });
};

function settledWorld(id) { return HW.get(id); }

/* ====================================================================== */
(async function () {

  console.log('\nA. the parser keeps the face');
  var w = HW.parse(JSON.parse(JSON.stringify(FILE_WORLD)));
  ok('a .horde_world with a banner parses', !!w);
  eq('the banner survives, byte for byte', w.banner, BANNER);
  eq('any OTHER top-level data: URI is still art, stripped', w.artwork, undefined);
  ok('the bulk media keys are still stripped',
    w.mediaAssets === undefined && w._mediaManifest === undefined &&
    w.presentation === undefined && w.visuals === undefined,
    JSON.stringify({ m: w.mediaAssets, p: w.presentation }));
  ok('unknown keys still pass through (kernel, worldAgent)',
    w.kernel && w.worldAgent, JSON.stringify(Object.keys(w)));
  var bare = HW.parse({ _format: 'horde-world', name: 'Plain', locations: [{ id: 'a', name: 'A' }] });
  eq('a world without a banner gets an empty one (stable shape)', bare.banner, '');

  console.log('\nB. import stores the face (dieted)');
  Views.pickFile = function () {
    return Promise.resolve({ text: function () { return Promise.resolve(fileText()); } });
  };
  App.importWorld();
  await new Promise(function (r) { setTimeout(r, 120); });
  var saved = await HW.get('world_lantern');
  ok('the world was saved', !!saved);
  ok('…with its banner', saved && !!saved.banner, saved ? (saved.banner || 'none').slice(0, 40) : 'no world');
  ok('the banner is still a jpeg data-URL (diet or untouched)',
    saved && saved.banner.indexOf('data:image/jpeg') === 0, saved && saved.banner.slice(0, 30));
  ok('the import said what it did', toasts.some(function (t) { return /imported the lantern marches/i.test(t); }),
    JSON.stringify(toasts));
  var savedUrl = null;
  Views.pickFile = function () {
    var d = JSON.parse(fileText()); d.banner = 'https://example.com/world-face.png'; d.id = 'world_web';
    return Promise.resolve({ text: function () { return Promise.resolve(JSON.stringify(d)); } });
  };
  App.importWorld();
  await new Promise(function (r) { setTimeout(r, 80); });
  savedUrl = await HW.get('world_web');
  ok('a web-URL banner is kept untouched (no diet needed)',
    savedUrl && savedUrl.banner === 'https://example.com/world-face.png',
    savedUrl && savedUrl.banner);
  ok('a diet is available for the import path', typeof Views.dietDataUrl === 'function');
  var dietedEmpty = await Views.dietDataUrl('', 512);
  eq('…and it is safe on an empty banner', dietedEmpty, '');

  console.log('\nC. the worlds screen shows the face');
  Views.worlds();
  await new Promise(function (r) { setTimeout(r, 40); });
  var page = els['#worlds-body'].innerHTML;
  ok('the installed world wears its banner', page.indexOf('data:image/jpeg') !== -1, page.slice(0, 120));
  ok('the web-URL world wears its web face', page.indexOf('https://example.com/world-face.png') !== -1);
  /* a run for the banner world, so the In-progress card shows a face too */
  var run = HW.start(w, null);
  run.worldId = w.id; run.worldName = w.name;
  await HW.saveRun(run);
  Views.worlds();
  await new Promise(function (r) { setTimeout(r, 40); });
  page = els['#worlds-body'].innerHTML;
  var prog = page.indexOf('In progress');
  ok('there is an In-progress group', prog !== -1);
  ok('…and its card wears the world\'s banner',
    page.slice(prog, page.indexOf('Installed worlds', prog)).indexOf('data:image/jpeg') !== -1);
  /* a world with no banner falls back to initials, not a broken image */
  Views.pickFile = function () {
    return Promise.resolve({ text: function () { return Promise.resolve(JSON.stringify({
      _format: 'horde-world', id: 'world_bare', name: 'Bare Fields',
      locations: [{ id: 'a', name: 'A' }], banner: ''
    })); } });
  };
  App.importWorld();
  await new Promise(function (r) { setTimeout(r, 80); });
  Views.worlds();
  await new Promise(function (r) { setTimeout(r, 40); });
  page = els['#worlds-body'].innerHTML;
  var bareCard = page.slice(page.indexOf('Bare Fields') - 400, page.indexOf('Bare Fields'));
  ok('a bannerless world gets initials, not a blank img',
    bareCard.indexOf('class="ph"') !== -1 && bareCard.indexOf('<img') === -1, bareCard.slice(0, 200));

  console.log('\nD. the status sheet shows the face');
  var sheet = Views.worldStatusSheet(w, run);
  ok('the sheet wears the banner at the top', sheet.indexOf('data:image/jpeg') !== -1, sheet.slice(0, 160));
  var plain = HW.parse({ _format: 'horde-world', name: 'Bare Fields', locations: [{ id: 'a', name: 'A' }] });
  var plainRun = HW.start(plain, null);
  var sheet2 = Views.worldStatusSheet(plain, plainRun);
  ok('…and initials when there is no banner',
    sheet2.indexOf('class="ph"') !== -1 && /Bare/.test(sheet2), sheet2.slice(0, 160));
  ok('the sheet still has its sections',
    sheet.indexOf('Where you are') !== -1 && sheet.indexOf('Time') !== -1 && sheet.indexOf('Party') !== -1);

  console.log('\nE. the face survives the round trips');
  var again = HW.parse(JSON.parse(JSON.stringify(saved)));
  ok('parse → JSON → parse keeps the banner (export shape)',
    !!saved && again.banner === saved.banner);
  var fromDb = await HW.get('world_lantern');
  ok('and the saved copy keeps it across a reload', fromDb.banner === saved.banner);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('ERR', e);
  process.exit(1);
});
