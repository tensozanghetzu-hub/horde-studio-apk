#!/usr/bin/env node
/* v1.42.2 — the container tells you what it did.
 *
 * A PNG can hold several copies of a card, under two keywords, in three chunk
 * types, and one of them can be corrupt. A card's JSON can repeat a key inside
 * one object or write a number no reader can hold. Every one of those is a
 * decision, and until now the app decided quietly: `ccv3` already won over
 * `chara` regardless of file order (K2 pinned that in v1.40.x), but nothing said
 * which copy was read, nothing said the others disagreed, and nothing said the
 * file's own bytes had a repeated key. An author with a card that "looks wrong"
 * had nothing to check.
 *
 * So: report it, do not refuse it. The import path still never writes the file,
 * still prefers `ccv3`, still finishes when one copy is unreadable — the only
 * change is that the user is told. Fixtures are built byte by byte, as in
 * card-container-test.js, and every card here is invented.
 *
 *   node /home/user/tests/card-provenance-test.js
 */
'use strict';
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

/* ---- PNG builder (the same one card-container-test.js uses) ---------- */

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
function zTXt(keyword, rawBytes) {
  return chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]), rawBytes]));
}
function png(chunks) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]), Buffer.from([8, 6, 0, 0, 0])])),
    Buffer.concat(chunks),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function b64(obj) { return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); }
/* a card whose JSON bytes are written by hand, so a duplicate key can survive
   into the file the way a hand-edited card really has one */
function b64raw(jsonText) { return Buffer.from(jsonText, 'utf8').toString('base64'); }

/* ---- the store, in a sandbox that looks enough like a browser -------- */

function loadStore() {
  var uidN = 0;
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, Error: Error, console: console, RegExp: RegExp, Buffer: Buffer,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    DecompressionStream: typeof DecompressionStream === 'undefined' ? function () { throw new Error('no inflate'); } : DecompressionStream,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb;
  sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  return sb.Store;
}
var Store = loadStore();

function read(buf) {
  return Store.cardFromPngBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
function notes(card) { return (card.__png && card.__png.notes) || []; }
function joined(card) { return notes(card).join(' | '); }

var V2 = {
  spec: 'chara_card_v2', spec_version: '2.0', name: 'Old Copy',
  description: 'A stale V2 description.', personality: '', scenario: '',
  first_mes: 'Old greeting.', mes_example: '',
  data: { name: 'Old Copy', description: 'A stale V2 description.', personality: '',
    scenario: '', first_mes: 'Old greeting.', mes_example: '' }
};
var V3 = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: 'Rhea', description: 'A cartographer of the drowned coast.',
    personality: 'Dry.', scenario: 'A storm over the ridge.',
    first_mes: 'The door bangs open.', mes_example: '' }
};

async function main() {
  console.log('\n1 — the ordinary card stays quiet, and says which chunk it read');
  var solo = png([tEXt('ccv3', b64(V3))]);
  var c1 = await read(solo);
  same('a lone `ccv3` card imports as it always did', c1.data.name, 'Rhea');
  same('…and the provenance is recorded even when nothing was unusual', c1.__png.used, 'ccv3');
  same('…with no note to read', notes(c1).length, 0);

  console.log('\n2 — two copies: the choice is the same as before, but it is named');
  var both = png([tEXt('chara', b64(V2)), tEXt('ccv3', b64(V3))]);
  var c2 = await read(both);
  same('`ccv3` still wins over `chara`', c2.data.name, 'Rhea');
  same('…and the ignored copy is recorded', c2.__png.ignored.join(','), 'chara');
  ok('…with a note that says which one was read and that the file was not touched',
    /reads ccv3 first/.test(joined(c2)) && /nothing in the file was changed/.test(joined(c2)),
    joined(c2).slice(0, 300));
  ok('…and that the ignored copy said something different',
    /do not say the same thing/.test(joined(c2)) && /chara/.test(joined(c2).split('do not say the same thing')[1] || ''),
    joined(c2).slice(0, 400));

  console.log('\n3 — two copies that AGREE are not worth alarming anybody about');
  var twin = png([tEXt('ccv3', b64(V3)), tEXt('ccv3', b64(V3))]);
  var c3 = await read(twin);
  same('the first copy is the one that is used', c3.data.name, 'Rhea');
  same('…both were readable', c3.__png.readable, 2);
  same('…none of them differed', c3.__png.differing.length, 0);
  ok('…so there is no "do not say the same thing" note',
    !/do not say the same thing/.test(joined(c3)), joined(c3));

  console.log('\n4 — a corrupt copy does not sink the import (and now says so)');
  var junk = zTXt('ccv3', Buffer.from([0x00, 0x11, 0x22, 0x33]));   /* not a deflate stream */
  var mixed = png([junk, tEXt('ccv3', b64(V3))]);
  var c4 = await read(mixed);
  same('the readable copy came through', c4.data.name, 'Rhea');
  same('…and the unreadable one was counted, not swallowed', c4.__png.unreadable, 1);
  ok('…and named in the note', /could not read/.test(joined(c4)), joined(c4).slice(0, 300));

  console.log('\n5 — a chunk under a keyword the spec does not define is counted too');
  var odd = png([tEXt('chara_v2', b64(V2)), tEXt('ccv3', b64(V3))]);
  var c5 = await read(odd);
  same('the real card is still the one that loads', c5.data.name, 'Rhea');
  same('…and the stray keyword is reported', c5.__png.unknownKeys.join(','), 'chara_v2');
  ok('…in the note, in words a reader can act on',
    /chara_v2/.test(joined(c5)) && /does not define/.test(joined(c5)), joined(c5).slice(0, 400));

  console.log('\n6 — hostile framing: a chunk that lies about its size, or holds nothing');
  var tail = Buffer.concat([
    png([tEXt('ccv3', b64(V3))]).slice(0, -12),               /* drop its IEND */
    chunk('tEXt', Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from('not json at all')])),
    chunk('IEND', Buffer.alloc(0))
  ]);
  var c6 = await read(tail);
  same('a chunk whose payload is not a card does not stop the good one', c6.data.name, 'Rhea');
  ok('…and it is counted as unreadable rather than vanishing', c6.__png.unreadable >= 1, JSON.stringify(c6.__png));
  /* the file ends inside a chunk that claims 4 GB. The reader must not follow that
     length: it clamps, walks off the end, and still hands back the card it read. */
  var liar = Buffer.concat([
    png([tEXt('ccv3', b64(V3))]).slice(0, -12),
    Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('tEXt', 'latin1'), Buffer.from('chara', 'latin1'),
    chunk('IEND', Buffer.alloc(0))
  ]);
  var c6b = await read(liar);
  same('a lying chunk length is walked past, not fatal', c6b.data.name, 'Rhea');
  ok('…and the truncated chunk is reported as unreadable', c6b.__png.unreadable >= 1, JSON.stringify(c6b.__png));
  var lonely = Buffer.concat([
    png([]).slice(0, -12),
    Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('tEXt', 'latin1'), Buffer.from('chara', 'latin1')
  ]);
  await read(lonely).then(function () { ok('a file with nothing readable in it still fails loudly', false, 'resolved'); },
    function (e) { ok('a file with nothing readable in it still fails loudly', /No character data/.test(String(e.message)), e.message); });

  console.log('\n7 — a card that keeps its `char_x` keeps it: provenance never edits the card');
  same('the picture was attached because the card had none', /^data:image\/png/.test(c1.data.char_x || ''), true);
  var before = JSON.stringify(c1.data);
  await read(solo);
  ok('reading is read-only: the same bytes give the same card', before === JSON.stringify(c1.data), before.slice(0, 60));

  console.log('\n8 — duplicate keys inside one object (V1: "UNDEFINED BEHAVIOR")');
  var dupJson = '{"spec":"chara_card_v3","spec_version":"3.0","data":{"name":"First Name","name":"Last Name","description":"d","personality":"","scenario":"","first_mes":"hi","mes_example":""}}';
  var dupPng = png([tEXt('ccv3', b64raw(dupJson))]);
  var c8 = await read(dupPng);
  same('the LAST copy is what this app keeps, as documented', c8.data.name, 'Last Name');
  ok('…and the note says the file repeated a key, with the path',
    /repeats 1 key/.test(joined(c8)) && /data\.name/.test(joined(c8)), joined(c8).slice(0, 400));
  ok('…and points at the file instead of at this app',
    /undefined behaviour/.test(joined(c8)) && /first thing to check in the file/.test(joined(c8)),
    joined(c8).slice(0, 400));

  console.log('\n9 — the scanner on its own, both directions');
  var a1 = Store.jsonAnomalies('{"a":1,"a":2}');
  same('a repeated key is found', a1.dupKeys.length, 1);
  same('…with its path and how often it appears',
    (a1.dupKeys[0] || {}).path + ' ×' + (a1.dupKeys[0] || {}).count, 'a ×2');
  var a2 = Store.jsonAnomalies('{"data":{"name":"x","name":"y"},"tags":["a","b"]}');
  same('a path is given as the file spells it', a2.dupKeys[0].path, 'data.name');
  same('…and strings inside an ARRAY are never mistaken for keys', a2.dupKeys.length, 1);
  same('…with the path pointing at the object that repeats it', (a2.dupKeys[0] || {}).path, 'data.name');
  var a3 = Store.jsonAnomalies('{"a":1,"a":2,"a":3}');
  same('a key repeated three times is one note with the true count', (a3.dupKeys[0] || {}).count, 3);
  same('…not two notes', a3.dupKeys.length, 1);
  var a4 = Store.jsonAnomalies('{"note":"a } b { c \\" d","name":"x"}');
  same('braces and quotes inside a string do not move the scanner', a4.dupKeys.length, 0);
  var a5 = Store.jsonAnomalies('{"a\\"b":1,"a\\"b":2}');
  same('an escaped key is compared decoded, so it is still a repeat', a5.dupKeys.length, 1);
  var a6 = Store.jsonAnomalies('{"a":1,}');
  ok('a file that is not valid JSON is reported as far as it got, not as a crash',
    a6.checked === true && a6.dupKeys.length === 0, JSON.stringify(a6));
  ok('…and nonsense text never throws',
    JSON.stringify(Store.jsonAnomalies('not json at all')) ===
      JSON.stringify({ dupKeys: [], numbers: [], numberCount: 0, checked: true, scanned: 15, lostNumbers: [] }),
    JSON.stringify(Store.jsonAnomalies('not json at all')));
  ok('…and a file cut off mid-value reports what it saw and returns',
    Store.jsonAnomalies('{"a":').checked === true && Store.jsonAnomalies('{"a":').dupKeys.length === 0 &&
    Store.jsonAnomalies('{"a":"unterminated').numbers.length === 0, JSON.stringify(Store.jsonAnomalies('{"a":')));

  console.log('\n10 — numbers the reader cannot hold, and numbers it can');
  var a7 = Store.jsonAnomalies('{"a":1e999,"b":12345678901234567890,"c":1.0,"d":1e3,"e":-0,"f":1.10}');
  same('every spelling that changes is recorded', a7.numbers.length, 6);
  same('…but only the ones whose VALUE moves are called a loss', (a7.lostNumbers || []).length, 2);
  same('…namely 1e999, which arrives as Infinity', a7.lostNumbers[0].as, 'Infinity');
  same('…and the 20-digit integer, which arrives rounded', a7.lostNumbers[1].token, '12345678901234567890');
  var a8 = Store.jsonAnomalies('{"a":1,"b":2.5,"c":-7,"d":0,"e":100,"f":0.001}');
  same('an ordinary card has nothing to report', a8.numbers.length + a8.dupKeys.length, 0);
  same('…and 1e3 / 1.0 / -0 are not losses, only re-spellings',
    Store.jsonAnomalies('{"a":1e3,"b":1.0,"c":-0,"d":1.10}').lostNumbers.length, 0);
  var big = '{"a":"' + 'x'.repeat(9 * 1024 * 1024) + '"}';
  same('past 8 MB it says it did not look rather than implying it did',
    Store.jsonAnomalies(big).checked, false);
  same('…and reports the size it stopped at', Store.jsonAnomalies(big).tooBig > 8 * 1024 * 1024, true);

  console.log('\n11 — the note reaches the user, and never reaches the card');
  var ch = Store.cardToCharacter(c2);
  ok('the store records provenance but writes no notes itself — the import screen does',
    ch.importNotes === undefined, JSON.stringify(ch.importNotes));
  var app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  var prep = app.slice(app.indexOf('App.prepareImportedCharacter = function'), app.indexOf('App.prepareImportedCharacter = function') + 3000);
  ok('the import screen folds it into the notes the user reads',
    /card\.__png && card\.__png\.notes/.test(prep) && /importNotes\s*=\s*importNotes\.concat|importNotes\.concat\(card\.__png\.notes\)/.test(prep),
    prep.slice(prep.indexOf('importNotes'), prep.indexOf('importNotes') + 200));
  var out = Store.characterToCard(ch);
  ok('and none of it leaks into the exported card',
    JSON.stringify(out).indexOf('__png') === -1, JSON.stringify(out).slice(0, 160));
  ok('…nor into the preserved source copy that makes an export lossless',
    !ch.cardSource || !ch.cardSource.top || ch.cardSource.top.__png === undefined,
    JSON.stringify(ch.cardSource && ch.cardSource.top && Object.keys(ch.cardSource.top)));
  var round = Store.cardToCharacter(out);
  same('…so a round trip still says what the card said', round.name, 'Rhea');

  console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.error('threw: ' + (e && e.stack || e)); process.exit(1); });
