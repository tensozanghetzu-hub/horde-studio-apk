/* v1.29.0 — card images: pictures a character card carries besides the
 *  avatar.
 *
 *   - import finds them: V3 cards may stash extra pictures in arbitrary
 *     data fields (data-URLs and image web URLs), at the top level or
 *     nested a couple of levels deep. They are collected as
 *     c.images = [{name, src}] — char_x itself and avatar duplicates
 *     are excluded, non-image strings are ignored, and the haul is
 *     capped at 8 pictures
 *   - the import glue normalizes data-URL images like the avatar
 *     (512px long edge); web URLs pass through untouched
 *   - the details screen shows them (contract: the editor renders a
 *     "Card images" group wired to the lightbox)
 *   - export re-embeds them so a round trip keeps them
 *
 *   node /home/user/tests/cardimages-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');
var APP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

/* ---------------- fakes (card-avatar-test pattern) --------------------- */

function makeDb() {
  var stores = {};
  function st(n) { return stores[n] || (stores[n] = {}); }
  function rows(s) { return Object.keys(st(s)).map(function (k) { return st(s)[k]; }); }
  return {
    get: function (s, k) { return Promise.resolve(st(s)[k]); },
    getAll: function (s) { return Promise.resolve(rows(s)); },
    getAllByIndex: function (s, idx, key) {
      return Promise.resolve(rows(s).filter(function (r) { return r[idx] === key; }));
    },
    put: function (s, v) { st(s)[v.id !== undefined ? v.id : v.key] = v; return Promise.resolve(); },
    putMany: function (s, vals) { vals.forEach(function (v) { st(s)[v.id] = v; }); return Promise.resolve(); },
    del: function (s, k) { delete st(s)[k]; return Promise.resolve(); },
    deleteByIndex: function (s, idx, key) {
      rows(s).forEach(function (r) { if (r[idx] === key) delete st(s)[r.id]; }); return Promise.resolve();
    },
    clear: function (s) { stores[s] = {}; return Promise.resolve(); }
  };
}

var uidN = 0;
function loadStore() {
  var sandbox = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array,
    Math: Math, String: String, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder,
    TextDecoder: TextDecoder, atob: atob,
    FileReader: function () { throw new Error('no FileReader'); },
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: makeDb(),
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(STORE_SRC, 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

var imgState = { w: 800, h: 600, fail: false, alpha: false };
function ImageMock() {
  var self = this;
  this.naturalWidth = 0; this.naturalHeight = 0;
  Object.defineProperty(this, 'src', {
    set: function () {
      setTimeout(function () {
        if (imgState.fail) { if (self.onerror) self.onerror(); return; }
        self.naturalWidth = imgState.w; self.naturalHeight = imgState.h;
        if (self.onload) self.onload();
      }, 0);
    }
  });
}

function loadViews() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setTimeout: setTimeout, Uint8ClampedArray: Uint8ClampedArray,
    Image: ImageMock,
    fetch: function () { return Promise.resolve({ ok: false }); },
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      md: function (s) { return String(s || ''); },
      icon: function (name) { return '<i data-icon="' + name + '"></i>'; }
    },
    Store: { settings: {} },
    document: {
      createElement: function (tag) {
        if (tag !== 'canvas') return {};
        return {
          width: 0, height: 0,
          getContext: function () {
            return {
              drawImage: function () {},
              getImageData: function (x, y, w, h) {
                var d = new Uint8ClampedArray(w * h * 4).fill(255);
                if (imgState.alpha) d[3] = 128;
                return { data: d };
              }
            };
          },
          toDataURL: function (mime) { return 'data:' + mime + ';base64,R' + this.width + 'x' + this.height; }
        };
      },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

/* ---------------- fixture images --------------------------------------- */

var AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA';
var IMG_A = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAe2ImgAA';
var IMG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAA';
var WEB_A = 'https://cdn.example.com/gallery/cover.png';
var WEB_B = 'https://cdn.example.com/gallery/alt.jpg?sig=xyz';

function v3Card(extra) {
  var data = {
    name: 'Sera',
    description: 'A lighthouse keeper who collects broken clocks.',
    char_x: AVATAR,
    first_mes: 'You found my door.'
  };
  if (extra) Object.keys(extra).forEach(function (k) { data[k] = extra[k]; });
  return { spec: 'chara_card_v3', spec_version: '3.0', data: data };
}

/* ------------------------------------------------------------------ */
/* 1. import finds the card's pictures                                 */
/* ------------------------------------------------------------------ */

console.log('\nimport finds the card\'s pictures');

var Store = loadStore();
var c = Store.cardToCharacter(v3Card({
  gallery: { cover: IMG_A, alt: IMG_B },   /* nested two levels */
  portrait: WEB_A,                          /* web URL, top level */
  caption: 'not an image',                   /* text: must be ignored */
  site: 'https://example.com'                /* URL without image extension */
}));
ok('the avatar is still char_x', c.avatar === AVATAR);
ok('it carries the extra pictures', Array.isArray(c.images) && c.images.length === 3,
  'images=' + JSON.stringify(c.images));
var byName = {};
(c.images || []).forEach(function (im) { byName[im.name] = im.src; });
ok('nested pictures are found with their field names',
  byName.gallery_cover === IMG_A && byName.gallery_alt === IMG_B,
  JSON.stringify(byName));
ok('web-URL pictures are kept as-is', byName.portrait === WEB_A);
ok('plain text and non-image URLs are not pictures', !byName.caption && !byName.site);

/* the avatar is not duplicated into the image list */
c = Store.cardToCharacter(v3Card({ main_image: AVATAR, other: IMG_A }));
ok('a field duplicating the avatar is not listed twice',
  (c.images || []).length === 1 && c.images[0].src === IMG_A, JSON.stringify(c.images));

/* v2 cards: same deal at the root level */
c = Store.cardToCharacter({
  name: 'Old V2', description: 'd', char_x: AVATAR, first_mes: 'hi',
  extra_picture: IMG_B
});
ok('v2 cards yield their pictures too',
  (c.images || []).length === 1 && c.images[0].src === IMG_B, JSON.stringify(c.images));

/* a card without extras */
c = Store.cardToCharacter(v3Card());
ok('a card without extras has no images', Array.isArray(c.images) && c.images.length === 0,
  JSON.stringify(c.images));

/* the haul is capped: 12 pictures in, 8 out (first eight, key order) */
var many = {};
for (var i = 0; i < 12; i++) many['pic_' + i] = 'data:image/png;base64,pic' + i;
c = Store.cardToCharacter(v3Card(many));
ok('the haul is capped at 8', (c.images || []).length === 8, 'got ' + (c.images || []).length);
ok('…and the first eight win, in order',
  c.images[0].name === 'pic_0' && c.images[7].name === 'pic_7');

/* ------------------------------------------------------------------ */
/* 2. the import glue normalizes data-URL images like the avatar       */
/* ------------------------------------------------------------------ */

console.log('\nthe import glue normalizes data-URL images like the avatar');

var Views = loadViews();
ok('normalizeCardImages exists', typeof Views.normalizeCardImages === 'function');

Views.normalizeCardImages([
  { name: 'a', src: IMG_A },
  { name: 'w', src: WEB_B },
  { name: 'x', src: AVATAR }
]).then(function (imgs) {
  ok('data-URL pictures are downsized like the avatar',
    imgs[0].src !== IMG_A && /^data:image\//.test(imgs[0].src), imgs[0].src.slice(0, 40));
  ok('web URLs pass through untouched', imgs[1].src === WEB_B, imgs[1].src);
  ok('…and it resolves with the (mutated) list', imgs.length === 3);
  glue();
});

function glue() {
  /* the app's import flow must actually run it (source contract) */
  var src = fs.readFileSync(APP_SRC, 'utf8');
  var at = src.indexOf('App.importCard = function');
  var body = src.slice(at, at + 3000);
  ok('importCard runs normalizeCardImages', /normalizeCardImages/.test(body));
  finish();
}

/* ------------------------------------------------------------------ */
/* 3. the details screen shows them (source contract)                  */
/* ------------------------------------------------------------------ */

function finish() {
  console.log('\nthe details screen shows them');
  var vsrc = fs.readFileSync(VIEWS_SRC, 'utf8');
  var at = vsrc.indexOf('Views.editor = function');
  var body = vsrc.slice(at, at + 14000);
  ok('the editor renders a "Card images" group', /Card images/.test(body));
  ok('…from char.images, wired to the lightbox',
    /char\.images/.test(body) && /data-lightbox/.test(body));
  ok('…only when the character actually has them',
    /char\.images\s*&&\s*char\.images\.length/.test(body) ||
    /char\.images \?/.test(body) || /if \(char\.images/.test(body),
    'editor must guard on images being present');

  /* export re-embeds them (round trip) */
  console.log('\nexport keeps them for a round trip');
  var S2 = loadStore();
  var withImgs = S2.cardToCharacter(v3Card({ gallery: { cover: IMG_A }, portrait: WEB_A }));
  var card = S2.characterToCard(withImgs);
  var back = S2.cardToCharacter(JSON.parse(JSON.stringify(card)));
  var srcs = (back.images || []).map(function (i) { return i.src; }).sort();
  ok('the exported card carries the pictures out', srcs.length === 2,
    JSON.stringify(srcs));
  ok('re-importing the export finds them again',
    srcs.indexOf(IMG_A) !== -1 && srcs.indexOf(WEB_A) !== -1, JSON.stringify(srcs));
  ok('…and the avatar still rides in char_x', back.avatar === AVATAR);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
