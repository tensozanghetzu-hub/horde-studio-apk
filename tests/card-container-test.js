#!/usr/bin/env node
/* §K of APK-ISSUES-2.md — card containers, all five findings.
 *
 * Every fixture here is a real PNG built byte by byte, so the reader is tested
 * the way a file off the internet reaches it, not the way a mock pretends it
 * does.
 *
 *   K1  `ccv3` is base64 per the spec — it used to be parsed as raw text
 *   K2  `ccv3` beats `chara` regardless of file order
 *   K3  zTXt / compressed iTXt are inflated instead of parsed as plain text
 *   K4  a V3 tag with top-level fields is not an empty character
 *   K5  the reader sniffs bytes, not the file extension
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

/* ---- PNG builder ---------------------------------------------------- */

function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function tEXt(keyword, text) {
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')]));
}
function zTXt(keyword, text) {
  var comp = zlib.deflateSync(Buffer.from(text, 'utf8'));
  return chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]), comp]));
}
function iTXt(keyword, text, compress) {
  var body = Buffer.from(text, 'utf8');
  var flag = compress ? 1 : 0;
  if (compress) body = zlib.deflateSync(body);
  return chunk('iTXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'), Buffer.from([0, flag, 0]), Buffer.from([0]), Buffer.from([0]), body
  ]));
}
function png(chunks) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.concat([
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]),      /* 1x1 */
      Buffer.from([8, 6, 0, 0, 0])                 /* 8-bit RGBA */
    ])),
    Buffer.concat(chunks),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function b64(obj) { return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); }

/* ---- the store, in a sandbox that looks enough like a browser -------- */

function loadStore() {
  var uidN = 0;
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, Error: Error, console: console, RegExp: RegExp, Buffer: Buffer,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    Blob: Blob, Response: Response, DecompressionStream: DecompressionStream,
    FileReader: FileReaderStub,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb;
  sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  return { Store: sb.Store, sb: sb };
}

/* A FileReader that just hands back the bytes it was given — the app's only
   use of it is "read this file", and that part is not under test. */
function FileReaderStub() { }
FileReaderStub.prototype.readAsArrayBuffer = function (file) {
  var self = this;
  setTimeout(function () {
    self.result = file._buf.buffer.slice(file._buf.byteOffset, file._buf.byteOffset + file._buf.byteLength);
    if (self.onload) self.onload();
  }, 0);
};
function fakeFile(buf, name, type) {
  return { _buf: buf, name: name, type: type || '' };
}

var loaded = loadStore();
var Store = loaded.Store;

var V2 = {
  spec: 'chara_card_v2', spec_version: '2.0',
  name: 'Old Copy', description: 'A stale V2 description.',
  personality: '', scenario: '', first_mes: 'Old greeting.', mes_example: '',
  data: { name: 'Old Copy', description: 'A stale V2 description.', personality: '',
    scenario: '', first_mes: 'Old greeting.', mes_example: '' }
};
var V3 = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'Rhea', description: 'A cartographer of the drowned coast.',
    personality: 'Dry.', scenario: 'A storm over the ridge.',
    first_mes: 'The door bangs open.', mes_example: '', tags: ['fantasy'],
    character_book: { entries: [{ keys: ['ridge'], content: 'Dragons nest there.', enabled: true }] }
  }
};

async function main() {
  console.log('K1 — `ccv3` is base64, as the spec says');
  var ccv3only = png([tEXt('ccv3', b64(V3))]);
  var card = await Store.cardFromPngBytes(ccv3only.buffer.slice(ccv3only.byteOffset, ccv3only.byteOffset + ccv3only.byteLength));
  same('a spec-correct base64 `ccv3` card imports', card.data.name, 'Rhea');
  same('…with its greeting', card.data.first_mes, 'The door bangs open.');
  var c1 = Store.cardToCharacter(card);
  /* description + personality, as the sheet has always been built */
  same('…and becomes a character with a sheet', c1.persona, 'A cartographer of the drowned coast.\n\nDry.');

  /* raw JSON in ccv3 still works (older local fixtures) */
  var rawCcv3 = png([tEXt('ccv3', JSON.stringify(V3))]);
  var card2 = await Store.cardFromPngBytes(rawCcv3.buffer.slice(rawCcv3.byteOffset, rawCcv3.byteOffset + rawCcv3.byteLength));
  same('raw JSON in `ccv3` still reads', card2.data.name, 'Rhea');

  console.log('\nK1 — non-ASCII survives the base64 hop');
  var emoji = JSON.parse(JSON.stringify(V3));
  emoji.data.description = 'She draws the coast — “every inlet” 🌊.';
  var em = png([tEXt('ccv3', b64(emoji))]);
  var cardEm = await Store.cardFromPngBytes(em.buffer.slice(em.byteOffset, em.byteOffset + em.byteLength));
  same('curly quotes and emoji decode as UTF-8', cardEm.data.description, emoji.data.description);

  console.log('\nK2 — `ccv3` wins over `chara`, whatever the file order');
  var both = png([tEXt('chara', b64(V2)), tEXt('ccv3', b64(V3))]);
  var cardBoth = await Store.cardFromPngBytes(both.buffer.slice(both.byteOffset, both.byteOffset + both.byteLength));
  same('the V3 card wins even though chara comes first', cardBoth.data.name, 'Rhea');
  var v3first = png([tEXt('ccv3', b64(V3)), tEXt('chara', b64(V2))]);
  var cardV3First = await Store.cardFromPngBytes(v3first.buffer.slice(v3first.byteOffset, v3first.byteOffset + v3first.byteLength));
  same('…and in the other order too', cardV3First.data.name, 'Rhea');
  var onlyChara = png([tEXt('chara', b64(V2))]);
  var cardChara = await Store.cardFromPngBytes(onlyChara.buffer.slice(onlyChara.byteOffset, onlyChara.byteOffset + onlyChara.byteLength));
  same('a chara-only card still imports', cardChara.name, 'Old Copy');

  console.log('\nK3 — compressed chunks are inflated');
  var zt = png([zTXt('chara', b64(V2))]);
  var cardZt = await Store.cardFromPngBytes(zt.buffer.slice(zt.byteOffset, zt.byteOffset + zt.byteLength));
  same('a zTXt `chara` chunk reads', cardZt.name, 'Old Copy');
  var zt3 = png([zTXt('ccv3', b64(V3))]);
  var cardZt3 = await Store.cardFromPngBytes(zt3.buffer.slice(zt3.byteOffset, zt3.byteOffset + zt3.byteLength));
  same('a zTXt `ccv3` chunk reads', cardZt3.data.name, 'Rhea');
  var it = png([iTXt('ccv3', b64(V3), true)]);
  var cardIt = await Store.cardFromPngBytes(it.buffer.slice(it.byteOffset, it.byteOffset + it.byteLength));
  same('a compressed iTXt chunk reads', cardIt.data.name, 'Rhea');
  var itPlain = png([iTXt('ccv3', b64(V3), false)]);
  var cardItP = await Store.cardFromPngBytes(itPlain.buffer.slice(itPlain.byteOffset, itPlain.byteOffset + itPlain.byteLength));
  same('an uncompressed iTXt chunk reads', cardItP.data.name, 'Rhea');
  var zj = png([zTXt('ccv3', b64(emoji))]);
  var cardZj = await Store.cardFromPngBytes(zj.buffer.slice(zj.byteOffset, zj.byteOffset + zj.byteLength));
  same('compression does not mangle UTF-8', cardZj.data.description, emoji.data.description);

  console.log('\nK3 — a page with no card says so plainly');
  var empty = png([tEXt('Software', 'GIMP')]);
  var saidEmpty = '';
  await Store.cardFromPngBytes(empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength))
    .catch(function (e) { saidEmpty = e.message; });
  same('no card -> the old, honest error', saidEmpty, 'No character data embedded in this PNG');

  console.log('\nK4 — a V3 tag with top-level fields');
  var topLevelV3 = {
    spec: 'chara_card_v3', spec_version: '3.0',
    name: 'Ivo', description: 'A ferryman.', personality: 'Grumpy.',
    scenario: 'A river.', first_mes: 'Fare?', mes_example: ''
  };
  var iv = Store.cardToCharacter(topLevelV3);
  same('the name is read from the top level', iv.name, 'Ivo');
  same('the sheet is read too', iv.persona, 'A ferryman.\n\nGrumpy.');
  same('…and the greeting', iv.greeting, 'Fare?');
  same('…and the scenario', iv.scenario, 'A river.');
  var half = { spec: 'chara_card_v3', spec_version: '3.0', name: 'Half', first_mes: 'Hi.',
    description: 'Top-level sheet.', data: { name: 'Half' } };
  var hv = Store.cardToCharacter(half);
  same('a V3 tag whose data holds only the name still imports its sheet', hv.persona, 'Top-level sheet.');
  same('…and its greeting', hv.greeting, 'Hi.');
  /* data still wins where both exist — the spec's preference */
  var bothV3 = { spec: 'chara_card_v3', name: 'Top', description: 'top', first_mes: 'top',
    data: { name: 'Data', description: 'from data', first_mes: 'from data' } };
  var bv = Store.cardToCharacter(bothV3);
  same('when both are present, `data` wins', bv.persona, 'from data');

  console.log('\nK5 — the reader sniffs bytes, not extensions');
  var asJsonName = fakeFile(png([tEXt('ccv3', b64(V3))]), 'rhea.json', 'application/json');
  var fromPng = await Store.readCardsFile(asJsonName);
  same('a PNG named .json imports as a PNG', fromPng[0].data.name, 'Rhea');
  var asPngName = fakeFile(Buffer.from(JSON.stringify(V2), 'utf8'), 'old.png', 'image/png');
  var fromJson = await Store.readCardsFile(asPngName);
  same('a JSON named .png imports as JSON', fromJson[0].name, 'Old Copy');
  var junk = fakeFile(Buffer.from('<html>not a card</html>', 'utf8'), 'x.png', 'image/png');
  var said = '';
  await Store.readCardsFile(junk).catch(function (e) { said = e.message; });
  ok('a non-card file gets an honest error', /not a character card/.test(said), said);
  var brokenJson = fakeFile(Buffer.from('{"name": "x", ', 'utf8'), 'x.json', 'application/json');
  var said2 = '';
  await Store.readCardsFile(brokenJson).catch(function (e) { said2 = e.message; });
  ok('truncated JSON is named as truncated', /truncated/.test(said2), said2);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.error('card-container-test CRASHED\n' + (e && e.stack || e)); process.exit(1); });
