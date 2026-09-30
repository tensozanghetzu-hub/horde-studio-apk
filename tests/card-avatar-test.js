/* Character card avatars (char_x, the SillyTavern convention).
 *
 *   - import keeps the card's avatar: data: image URIs and web URLs pass
 *     through, a relative path from another SillyTavern install is rejected
 *     (it would be a broken <img>) — v2 and v3 cards alike
 *   - a PNG-embedded card IS its own avatar: when the embedded JSON has no
 *     usable char_x, the PNG file itself is attached
 *   - export carries the avatar back out (char_x) for a round trip
 *   - the app-level import glue normalizes data-URI avatars (512px long
 *     edge, PNG only with real transparency); web URLs, unknown types and
 *     decode failures pass through unchanged — the card's bytes are never
 *     lost
 *
 *   node /home/user/tests/card-avatar-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function same(label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- fake IndexedDB (persona-test pattern) --------------- */

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

/* ---------------- fake PNG with a ccv3 tEXt chunk ---------------------- */

function pngWithCard(json) {
  var sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, payload) {
    var t = new TextEncoder().encode(type);
    var out = new Uint8Array(12 + payload.length);
    new DataView(out.buffer).setUint32(0, payload.length);
    out.set(t, 4);
    out.set(payload, 8);
    return out;
  }
  var parts = [sig, chunk('IHDR', new Uint8Array(13))];
  if (json != null) parts.push(chunk('tEXt', new TextEncoder().encode('ccv3\0' + json)));
  parts.push(chunk('IEND', new Uint8Array(0)));
  var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
  var all = new Uint8Array(total);
  var off = 0;
  parts.forEach(function (p) { all.set(p, off); off += p.length; });
  return all.buffer;
}

function makeFileReader(arrayBuffer, dataUrl) {
  return function FileReader() {
    var self = this;
    this.result = null;
    this.readAsArrayBuffer = function () {
      setTimeout(function () { self.result = arrayBuffer; if (self.onload) self.onload(); }, 0);
    };
    this.readAsDataURL = function () {
      setTimeout(function () { self.result = dataUrl; if (self.onload) self.onload(); }, 0);
    };
    this.readAsText = function () {
      setTimeout(function () { self.result = ''; if (self.onload) self.onload(); }, 0);
    };
  };
}

var uidN = 0;
function loadStore(arrayBuffer, dataUrl) {
  var sandbox = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array,
    Math: Math, String: String, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder,
    TextDecoder: TextDecoder, atob: atob,
    FileReader: arrayBuffer ? makeFileReader(arrayBuffer, dataUrl) : function () { throw new Error('no FileReader'); },
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: makeDb(),
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(STORE_SRC, 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

var PNG_DATA_URL = 'data:image/png;base64,THEPNGBYTES';
var AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA';
var AVATAR_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg';
var WEB_URL = 'https://cdn.example.com/avatars/sera.png';
var REL_PATH = 'charx/1720000000000.png';

/* ---------------- normalizeDataUrl DOM mocks --------------------------- */

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

function v3(name, extra) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: Object.assign({
    name: name, description: 'desc', personality: 'pers',
    scenario: 'S', first_mes: 'hi there', mes_example: 'me: x\nc: y'
  }, extra || {}) };
}
function v2(name, extra) {
  return Object.assign({
    name: name, description: 'desc', personality: 'pers',
    scenario: 'S', first_mes: 'hello'
  }, extra || {});
}

(async function main() {
  var Store = loadStore();

  console.log('\ncardAvatar');

  same('data: png URI passes', Store.cardAvatar(AVATAR), AVATAR);
  same('data: jpeg URI passes', Store.cardAvatar(AVATAR_JPEG), AVATAR_JPEG);
  same('web URL passes', Store.cardAvatar(WEB_URL), WEB_URL);
  same('relative path from another install is rejected', Store.cardAvatar(REL_PATH), '');
  same('missing avatar is empty', Store.cardAvatar(undefined), '');
  same('whitespace around a data URI is trimmed and kept',
    Store.cardAvatar('  ' + AVATAR + '  '), AVATAR);

  console.log('\nv3 import keeps the avatar');

  var c = Store.cardToCharacter(v3('Sera', { char_x: AVATAR }));
  same('data URI survives the import', c.avatar, AVATAR);
  same('a relative char_x is dropped, not stored broken',
    Store.cardToCharacter(v3('Sera', { char_x: REL_PATH })).avatar, '');
  same('no char_x → no avatar', Store.cardToCharacter(v3('Sera')).avatar, '');

  console.log('\nv2 import keeps the avatar');

  same('v2 data URI survives', Store.cardToCharacter(v2('Sera', { char_x: AVATAR_JPEG })).avatar, AVATAR_JPEG);
  same('v2 web URL survives', Store.cardToCharacter(v2('Sera', { char_x: WEB_URL })).avatar, WEB_URL);

  console.log('\nPNG-embedded card is its own avatar');

  var json = JSON.stringify(v3('Sera'));
  var Store2 = loadStore(pngWithCard(json), PNG_DATA_URL);
  var pngCard = await Store2.readCardFile({ name: 'sera.png' });
  same('no char_x in the JSON → the PNG file itself is attached (v3: in data)', pngCard.data.char_x, PNG_DATA_URL);

  var jsonOwn = JSON.stringify(v3('Sera', { char_x: AVATAR }));
  var Store3 = loadStore(pngWithCard(jsonOwn), PNG_DATA_URL);
  var pngCard2 = await Store3.readCardFile({ name: 'sera.png' });
  same('the JSON\'s own char_x wins over the file', pngCard2.data.char_x, AVATAR);

  var v2Json = JSON.stringify(v2('Sera'));
  var Store4 = loadStore(pngWithCard(v2Json), PNG_DATA_URL);
  var pngCard3 = await Store4.readCardFile({ name: 'sera-v2.png' });
  same('v2-embedded JSON gets char_x at the top level', pngCard3.char_x, PNG_DATA_URL);

  var c2 = Store.cardToCharacter(v3('Sera', { char_x: PNG_DATA_URL }));
  same('a full-file data URI passes through the importer', c2.avatar, PNG_DATA_URL);

  console.log('\nexport carries the avatar back out');

  c = Store.cardToCharacter(v3('Sera', { char_x: AVATAR }));
  same('characterToCard writes char_x', Store.characterToCard(c).char_x, AVATAR);
  c = Store.cardToCharacter(v3('Sera'));
  ok('no avatar → no char_x key', !('char_x' in Store.characterToCard(c)),
    JSON.stringify(Store.characterToCard(c).char_x));

  console.log('\nnormalizeDataUrl (import glue)');

  var Views = loadViews();
  var src = 'data:image/png;base64,BIGORIGINAL';

  imgState = { w: 800, h: 600, fail: false, alpha: false };
  same('oversized flat art is downscaled to 512x384 as JPEG',
    await Views.normalizeDataUrl(src, 512), 'data:image/jpeg;base64,R512x384');

  imgState = { w: 800, h: 600, fail: false, alpha: true };
  same('transparency is kept lossless as PNG',
    await Views.normalizeDataUrl(src, 512), 'data:image/png;base64,R512x384');

  imgState = { w: 100, h: 50, fail: false, alpha: false };
  same('already under the cap → the original bytes are kept',
    await Views.normalizeDataUrl(src, 512), src);

  imgState = { w: 800, h: 600, fail: false, alpha: false };
  same('web URLs pass through untouched', await Views.normalizeDataUrl(WEB_URL, 512), WEB_URL);
  same('non-image data URIs pass through untouched',
    await Views.normalizeDataUrl('data:text/plain;base64,SGVsbG8=', 512), 'data:text/plain;base64,SGVsbG8=');
  imgState.fail = true;
  same('a decode failure keeps the original bytes',
    await Views.normalizeDataUrl('data:image/png;base64,BROKEN', 512), 'data:image/png;base64,BROKEN');
  imgState = { w: 800, h: 600, fail: false, alpha: false };

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
