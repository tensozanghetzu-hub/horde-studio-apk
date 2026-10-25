/* pngutf8-test — v1.39.14: a PNG card is UTF-8 all the way down.
 *
 * readCardFile decoded the standard `chara` tEXt chunk with a bare
 * atob(): atob hands you a BINARY string, and JSON.parse on bytes-as-chars
 * mangles every multibyte sequence — 🐍 arrived as ðý®, the em-dash as
 * â€"". ASCII cards masked it for months. plainText/repairMojibake was
 * quietly band-aiding the greeting and the sheet at import, but the NAME,
 * the alternate greetings (and any field not washed on entry) went into
 * storage already broken: broken header, broken swipe intro em-dashes.
 *
 * The ccv3 branch in the same reader gets this right (TextDecoder): the
 * chara branch must do the same byte-dance.
 *
 *   node /home/user/tests/pngutf8-test.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};

/* smallest legal PNG carrying a chara tEXt chunk */
function pngWithCard(cardObj) {
  const crc32 = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ pngWithCard.table[(c ^ buf[i]) & 0xff];
    }
    return (~c) >>> 0;
  };
  const payload = Buffer.from(JSON.stringify(cardObj), 'utf8');
  const kw = Buffer.concat([Buffer.from('chara\x00'), payload.toString('base64') && Buffer.from(payload.toString('base64'), 'ascii')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk(Buffer.from('IHDR'), Buffer.alloc(13)),
    chunk(Buffer.from('tEXt'), kw),
    chunk(Buffer.from('IEND'), Buffer.alloc(0)),
  ]);
  function chunk(type, data) {
    const head = Buffer.concat([type, data]);
    return Buffer.concat([
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(data.length); return b; })(),
      head,
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(crc32(head)); return b; })(),
    ]);
  }
}
pngWithCard.table = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function makeFileReader(arrayBuffer, dataUrl) {
  return function FileReader() {
    const self = this;
    this.result = null;
    this.readAsArrayBuffer = () => setTimeout(() => {
      self.result = arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
      if (self.onload) self.onload();
    }, 0);
    this.readAsDataURL = () => setTimeout(() => { self.result = dataUrl; if (self.onload) self.onload(); }, 0);
    this.readAsText = () => setTimeout(() => { self.result = ''; if (self.onload) self.onload(); }, 0);
  };
}

const UNICODE = {
  emoji: '🐍 Draconica 💚',
  dash: 'Choose wisely — I am rarely wrong.',
  quotes: '“Hand it over.”  «Sorry»,  l’école,  Œuvre, €5',
};

(async function () {
  const card = {
    name: UNICODE.emoji,
    first_mes: UNICODE.dash,
    mes_example: UNICODE.quotes,
    spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: UNICODE.emoji, alternate_greetings: [UNICODE.dash] },
  };
  const png = pngWithCard(card);

  const sandbox = {
    Promise, JSON, Object, Date, Array, Math, String, Error, console,
    Uint8Array, DataView, TextEncoder, TextDecoder, atob,
    FileReader: makeFileReader(new Uint8Array(png), 'data:image/png;base64,x'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    IDB: new Proxy({}, { get: () => () => Promise.reject(new Error('no db')) }),
    UI: { uid: p => p + '-1' },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(STORE_SRC, 'utf8'), sandbox, { filename: 'store.js' });

  console.log('A — a real PNG card round-trips its text byte for byte');
  let parsed;
  try {
    parsed = await sandbox.Store.readCardFile({ name: 'card.png', type: 'image/png' });
  } catch (e) { parsed = null; ok('PNG parses at all', false, String(e && e.message || e)); }
  if (parsed) ok('PNG parses at all', true);

  const name = parsed && (parsed.name || '');
  ok('emoji survive the hop', name === UNICODE.emoji, JSON.stringify(name));
  const fm = parsed && (parsed.first_mes || '');
  ok('the em-dash is a dash, not â€""', fm === UNICODE.dash, JSON.stringify(fm));
  const mx = parsed && (parsed.mes_example || '');
  ok('mixed diacritics / euro / curly quotes all survive',
    mx === UNICODE.quotes, JSON.stringify(mx.slice(0, 40)));
  const alts = parsed && parsed.data && parsed.data.alternate_greetings;
  ok('alternate greetings come through clean too',
    Array.isArray(alts) && alts[0] === UNICODE.dash, JSON.stringify(alts && alts[0]));

  console.log(`\npngutf8-test: ${fail ? fail + ' failed, ' : ''}${pass} ok`);
  process.exit(fail ? 1 : 0);
})();
