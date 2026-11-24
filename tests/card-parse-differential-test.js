#!/usr/bin/env node
/* v1.42.2 — the readers must agree with someone else's reader.
 *
 * The research handoff's §2.3 asked for fidelity to be checked against the source
 * bytes rather than asserted from parsed values. Every claim this app makes about
 * a card is built on V8's JSON.parse, which keeps the last of two duplicate keys
 * and turns 1e999 into Infinity; testing our reader against a fixture written by
 * the people who wrote the reader proves nothing.
 *
 * So: build synthetic PNGs, read each one twice — once with the app, once with
 * tests/fixtures/parse-oracle.py, which walks the file with struct/zlib and
 * parses it with json/decimal — and fail where the two disagree on which chunks
 * exist, which of them carry a card, how often a key repeats, how many numbers
 * there are, which of them a reader cannot hold, and what the parsed card is
 * worth. Where they agree, "nothing was lost" is a measurement and not a promise.
 *
 * No card content: every fixture is written in this file. python3 is needed for
 * the other half; without it the test says so instead of pretending to pass.
 *
 *   node /home/user/tests/card-parse-differential-test.js
 */
'use strict';
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var zlib = require('zlib');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var ORACLE = path.join(__dirname, 'fixtures', 'parse-oracle.py');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

if (!fs.existsSync(ORACLE)) { console.log('  SKIP  no ' + ORACLE); process.exit(0); }
try { cp.execFileSync('python3', ['--version'], { stdio: 'ignore' }); }
catch (e) {
  console.log('  SKIP  the differential test needs python3 for its independent reader; it did not run');
  console.log('\n0 passed, 0 failed, 1 SKIPPED');
  process.exit(0);
}

/* ---- PNG builder, byte by byte (as in card-container-test.js) -------- */
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
  return chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(text, 'utf8'))]));
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
    chunk('IHDR', Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]), Buffer.from([8, 6, 0, 0, 0])])),
    Buffer.concat(chunks),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function b64(text) { return Buffer.from(String(text), 'utf8').toString('base64'); }
/* one byte of the CRC, flipped: the PNG spec says a reader should reject this,
   and a tolerant reader should still find the card. The oracle is the strict one
   and the app is the tolerant one — asserting both, from two programs, is what
   makes the tolerance a recorded decision rather than an accident. */
function breakCrc(buf) { var b = Buffer.from(buf); b[b.length - 1] ^= 0xff; return b; }

/* ---- the app's own reader, in a browser-shaped sandbox -------------- */
function loadStore() {
  var uidN = 0;
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, Error: Error, console: console, RegExp: RegExp, Buffer: Buffer,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    /* the real inflate, so a compressed chunk is a fixture and not a sandbox
       artefact: without Blob/Response/DecompressionStream, zTXt would "fail" here
       and succeed for the oracle, and that difference would say nothing about the
       app. */
    Blob: typeof Blob === 'undefined' ? undefined : Blob,
    Response: typeof Response === 'undefined' ? undefined : Response,
    DecompressionStream: typeof DecompressionStream === 'undefined' ? undefined : DecompressionStream,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); },
      del: function () { return Promise.resolve(); } },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  return sb.Store;
}
var Store = loadStore();

/* Canonical JSON: key order carries no meaning, so both readers' output is
   compared with the keys sorted. Written here rather than lifted from store.js,
   so a bug in the app cannot excuse itself with its own helper. */
function hexd(v) {
  var u = new Uint8Array(new Float64Array([v]).buffer), s = '';
  for (var i = 0; i < 8; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
  return s;
}
/* The two things this app adds to what the file said, so they are set aside here
   and compared where they belong: `__png` (section 1) and a `char_x` holding the
   picture the file is itself. A card that carried its own char_x keeps it. */
function stripAdditions(v) {
  if (Array.isArray(v)) return v.map(stripAdditions);
  if (!v || typeof v !== 'object') return v;
  var out = {};
  Object.keys(v).forEach(function (k) {
    if (k === '__png') return;
    if (k === 'char_x' && typeof v[k] === 'string' && /^data:image\/png;base64,/.test(v[k])) return;
    out[k] = stripAdditions(v[k]);
  });
  return out;
}
function canon(v) {
  /* a number is its 64 bits, Infinity and all: Python prints 1.2345678901234567e+19
     and V8 prints 12345678901234567000 for one double, and both are correct */
  if (typeof v === 'number') return '{"__num":' + JSON.stringify(hexd(v)) + '}';
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + canon(v[k]);
  }).join(',') + '}';
}
function diffHead(a, b) {
  var i = 0;
  while (i < a.length && a.charAt(i) === b.charAt(i)) i++;
  return 'differ at char ' + i + ': app ' + JSON.stringify(a.slice(Math.max(0, i - 50), i + 70)) +
    ' / oracle ' + JSON.stringify(b.slice(Math.max(0, i - 50), i + 70));
}

/* ---- the fixtures ---------------------------------------------------- */
var V3 = {
  spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: 'Rhea', description: 'A cartographer of the drowned coast.',
    personality: 'Dry, patient.', scenario: 'A storm over the ridge.',
    first_mes: 'The door bangs open.', mes_example: '', tags: ['fantasy', 'mapping'],
    character_book: { name: 'Ridge', entries: [
      { keys: ['ridge'], content: 'Dragons nest there.', enabled: true, extensions: {} }
    ] },
    extensions: { horde_studio: { color: '#4aa3ff' }, stable_horde: { anything: [1, 2, 3] } }
  }
};
var V1 = {
  name: 'Old Ones', description: 'A V1 card, flat at the top.',
  personality: '', scenario: '', first_mes: 'Who goes?', mes_example: '',
  alternate_greetings: ['Who goes?', 'Who goes there?'],
  character_book: { entries: [{ key: 'gate', keys: ['gate'], content: 'Salt on the sill.', enabled: true }] }
};
var DUP_JSON = '{"spec":"chara_card_v3","spec_version":"3.0","data":{"name":"First Name","name":"Last Name",' +
  '"description":"d","personality":"","scenario":"","first_mes":"hi","mes_example":"",' +
  '"character_book":{"entries":[{"keys":["k"],"content":"c","enabled":true,"enabled":false}]}}}';
var NUM_JSON = '{"spec":"chara_card_v3","data":{"name":"N","description":"d","personality":"","scenario":"",' +
  '"first_mes":"hi","mes_example":"","lucky":1e999,"count":12345678901234567890,"again":1.0,' +
  '"also":1e3,"zero":-0,"tenth":0.1,"deep":[1e-323,9007199254740993,1.5]}}';

var FIXTURES = [
  { name: 'v3-plain', png: png([tEXt('ccv3', b64(JSON.stringify(V3)))]) },
  { name: 'v1-flat-in-chara', png: png([tEXt('chara', b64(JSON.stringify(V1)))]) },
  { name: 'dup-key', png: png([tEXt('ccv3', b64(DUP_JSON))]), json: DUP_JSON },
  { name: 'numbers', png: png([tEXt('ccv3', b64(NUM_JSON))]), json: NUM_JSON },
  { name: 'two-copies', png: png([tEXt('chara', b64(JSON.stringify(V1))), tEXt('ccv3', b64(JSON.stringify(V3)))]) },
  { name: 'compressed', png: png([zTXt('chara', b64(JSON.stringify(V1)))]) },
  { name: 'iTXt-plain', png: png([iTXt('ccv3', b64(JSON.stringify(V3)), false)]) },
  { name: 'iTXt-zip', png: png([iTXt('ccv3', b64(JSON.stringify(V3)), true)]) },
  { name: 'stray-keyword', png: png([tEXt('chara_v2', b64(JSON.stringify(V1))), tEXt('ccv3', b64(JSON.stringify(V3)))]) },
  { name: 'bad-crc', png: png([breakCrc(tEXt('ccv3', b64(JSON.stringify(V3))) )]) },
  { name: 'hostile-tail', png: Buffer.concat([
    png([tEXt('ccv3', b64(JSON.stringify(V3)))]).slice(0, -12),
    Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('tEXt', 'latin1'), Buffer.from('chara', 'latin1')
  ]) }
];

var DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-differential-'));
var files = FIXTURES.map(function (fx) {
  var p = path.join(DIR, fx.name + '.png');
  fs.writeFileSync(p, fx.png);
  return p;
});
var oracle = JSON.parse(cp.execFileSync('python3', [ORACLE].concat(files),
  { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
var byName = {};
FIXTURES.forEach(function (fx, i) { byName[fx.name] = oracle[i]; });

function cardFor(name) {
  var fx = byFixture(name);
  var buf = fx.png.buffer.slice(fx.png.byteOffset, fx.png.byteOffset + fx.png.byteLength);
  return Store.cardFromPngBytes(buf);
}
function byFixture(name) { return FIXTURES.filter(function (x) { return x.name === name; })[0]; }
function joined(card) { return ((card && card.__png && card.__png.notes) || []).join(' | '); }
/* what an independent walk calls a readable card copy, in the same order the
   file holds them, with the app's own preference applied: first `ccv3`, else the
   first readable copy. Stated here because the app's rule and the oracle's
   classification have to be compared, not assumed equal. */
function okRecs(rep) { return (rep.cardChunks || []).filter(function (r) { return r.state === 'card'; }); }
function chosenRec(rep) { return okRecs(rep).filter(function (r) { return r.keyword === 'ccv3'; })[0] || okRecs(rep)[0]; }
/* python cannot see a path (its hook is per object), so the app's list of
   (path, key, count) is reduced to the same shape before comparing */
function oursAsMap(list) {
  var m = {};
  (list || []).forEach(function (d) { m[d.key] = Math.max(m[d.key] || 0, d.count || 2); });
  return Object.keys(m).sort().map(function (k) { return k + '×' + m[k]; }).join(',');
}
function pyAsMap(obj) {
  return Object.keys(obj || {}).sort().map(function (k) { return k + '×' + obj[k]; }).join(',');
}

async function main() {
  console.log('\n1 — the file walk: the same chunks, the same framing');
  for (var w = 0; w < FIXTURES.length; w++) {
    var fx = FIXTURES[w], rep = byName[fx.name];
    var card = null, err = null;
    try { card = await cardFor(fx.name); } catch (e) { err = e; }
    ok(fx.name + ': both readers see a PNG here', rep.sig === true && !/Not a PNG/.test(String(err && err.message)),
      String(err && err.message));
    if (!card) {
      ok(fx.name + ': the app failed to read a card exactly where the oracle did too',
        okRecs(rep).length === 0, 'oracle read ' + okRecs(rep).length + ', app threw ' + String(err && err.message));
      continue;
    }
    same(fx.name + ': the app counted as many text chunks as an independent walk finds',
      card.__png.chunks, rep.totals.chunks);
    same(fx.name + ': the chunks that hold a readable card are the same chunks for both',
      card.__png.readable, rep.tally.readable);
    same(fx.name + ': a keyword the spec does not define is a stray for both readers',
      card.__png.unknownKeys.length, rep.tally.stray);
    same(fx.name + ': damage is counted as damage by both, and never as an absent file',
      card.__png.unreadable, rep.tally.unreadable);
    same(fx.name + ': and both of them account for every chunk in the file',
      card.__png.readable + card.__png.unreadable + card.__png.unknownKeys.length, rep.totals.chunks);
  }

  console.log('\n1b — a broken CRC: the strict reader sees it, the app imports anyway');
  var bad = await cardFor('bad-crc');
  same('the oracle rejects the chunk\'s checksum', byName['bad-crc'].tally.badCrc, 1);
  same('…and the card is still read, because a checksum is not the content', bad.data.name, byName['bad-crc'].cardChunks[0].keyword === 'ccv3' ? 'Rhea' : '?');

  console.log('\n2 — duplicate keys: python sees them from the pairs, we see them from the bytes');
  var dupRep = byName['dup-key'], dupCard = await cardFor('dup-key');
  same('the same keys are repeated, the same number of times',
    oursAsMap(Store.jsonAnomalies(chosenRec(dupRep).rawJson).dupKeys), pyAsMap(chosenRec(dupRep).json.dupKeys));
  ok('…so the note this app can write matches what an independent parser found',
    /repeats 2 keys/.test(joined(dupCard)), joined(dupCard).slice(0, 320));
  ok('…and the app keeps the LAST copy, which is what the oracle kept too',
    dupCard.data.name === chosenRec(dupRep).json.value.data.name,
    dupCard.data.name + ' vs ' + JSON.stringify(chosenRec(dupRep).json.value.data.name));
  same('…even for a field the app never reads (the second `enabled`)',
    dupCard.data.character_book.entries[0].enabled,
    chosenRec(dupRep).json.value.data.character_book.entries[0].enabled);
  ok('…and the path in the note is where the file really repeats it',
    /data\.name ×2/.test(joined(dupCard)), joined(dupCard).slice(0, 320));

  console.log('\n3 — numbers a reader cannot hold, decided twice, from different sides');
  var numRep = byName['numbers'], numCard = await cardFor('numbers');
  var numJson = chosenRec(numRep).rawJson, mine = Store.jsonAnomalies(numJson);
  same('both readers counted every number literal in the file', mine.numberCount, chosenRec(numRep).json.numbers.length);
  same('and the app calls unholdable exactly the numbers Python\'s Decimal does',
    (mine.lostNumbers || []).map(function (n) { return n.token; }).sort().join(','),
    chosenRec(numRep).json.lossy.map(function (n) { return n.token; }).sort().join(','));
  same('…as the same bits, because the two runtimes spell one double differently and both are right',
    mine.lostNumbers.map(function (n) { return hexd(Number(n.as)); }).sort().join(','),
    chosenRec(numRep).json.lossy.map(function (n) { return n.hex; }).sort().join(','));
  ok('…and the set is not empty, so the check above cannot pass by finding nothing',
    chosenRec(numRep).json.lossy.length > 0, JSON.stringify(chosenRec(numRep).json.lossy));
  ok('…while 1.0, 1e3, -0 and 0.1 are re-spelled, not lost, per both',
    ['1.0', '1e3', '-0', '0.1'].every(function (t) {
      return chosenRec(numRep).json.lossy.every(function (n) { return n.token !== t; });
    }), JSON.stringify(chosenRec(numRep).json.lossy.map(function (n) { return n.token; })));
  ok('…and the user is told, at import, in words', /cannot be held/.test(joined(numCard)),
    joined(numCard).slice(0, 320));

  console.log('\n4 — the parsed card, field for field, against an independent parse');
  var names = ['v3-plain', 'v1-flat-in-chara', 'two-copies', 'compressed', 'iTXt-plain', 'iTXt-zip',
    'dup-key', 'numbers', 'stray-keyword'];
  for (var k2 = 0; k2 < names.length; k2++) {
    var nm = names[k2], card2 = await cardFor(nm), rep2 = byName[nm];
    var chosen = chosenRec(rep2);
    if (!card2 || !chosen || chosen.json.error) { ok(nm + ': compared', false, 'no comparable parse'); continue; }
    var mineC = canon(stripAdditions(card2)), theirsC = canon(chosen.json.value);
    ok(nm + ': the card this app holds is the value the other reader got, field for field',
      mineC === theirsC, diffHead(mineC, theirsC));
    if (nm === 'v3-plain') {
      ok('…and the one thing the app added is the picture the file is itself',
        /^data:image\/png;base64,/.test(card2.data.char_x || ''), JSON.stringify(card2.data.char_x).slice(0, 60));
      ok('…and nothing else was added, so that comparison above cannot be hiding a new field',
        Object.keys(card2).sort().join(',') === '__png,data,spec,spec_version', Object.keys(card2).join(','));
    }
  }

  console.log('\n5 — from the file to the character sheet, and back out');
  var v3 = await cardFor('v3-plain'), pyVal = chosenRec(byName['v3-plain']).json.value;
  var ch = Store.cardToCharacter(v3);
  same('the name is what the file said', ch.name, pyVal.data.name);
  same('…and the greeting', ch.greeting, pyVal.data.first_mes);
  ok('…and the description survived the trip through the app',
    JSON.stringify(ch).indexOf(pyVal.data.description) !== -1, JSON.stringify(ch).slice(0, 200));
  same('…and an unknown field keeps its type', JSON.stringify(v3.data.extensions.stable_horde.anything), '[1,2,3]');
  var out = Store.characterToCard(ch);
  same('…so the export writes it back as it arrived',
    JSON.stringify(out.data.extensions.stable_horde.anything), '[1,2,3]');
  ok('…and the provenance this app recorded never becomes the card\'s own text',
    JSON.stringify(out).indexOf('__png') === -1, JSON.stringify(out).slice(0, 160));

  console.log('\n6 — the hostile file, read twice');
  var host = await cardFor('hostile-tail'), hostRep = byName['hostile-tail'];
  same('the good copy is the card for the app', host.data.name, chosenRec(hostRep).json.value.data.name);
  ok('…the damaged tail reads as damaged to the oracle and is reported by us',
    hostRep.tally.unreadable >= 1 && host.__png.unreadable >= 1,
    JSON.stringify({ ours: host.__png.unreadable, oracle: hostRep.tally }));
  same('…and neither reader stopped early enough to hide a chunk', hostRep.totals.chunks, host.__png.chunks);

  console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
  fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.error('threw: ' + (e && e.stack || e)); process.exit(1); });
