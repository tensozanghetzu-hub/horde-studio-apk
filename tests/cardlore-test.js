/* cardlore-test — v1.39.11: do lorebooks actually travel with the card?
 *
 * SillyTavern's V2 spec lets a card embed a whole lorebook
 * (data.character_book.entries). Our importer only carried it for
 * chara_card_v3 cards — the common V2 shape had its book silently dropped,
 * and our own exporter dropped every book on the way out, so a
 * round trip (import → export) lost it even for V3. On top of that the
 * import details sheet said nothing when a card carried no book, so an
 * absent pill was indistinguishable from a lost import.
 *
 *   - V2 (and legacy top-level) character_book imports alongside the card
 *   - V3 behaviour unchanged
 *   - export writes data.character_book, and import(export(c)) keeps it
 *   - the import details sheet says explicitly whether a book is aboard
 *
 *   node /home/user/tests/cardlore-test.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');
const APP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};

let uidN = 0;
function loadStore() {
  const sandbox = {
    Promise, JSON, Object, Date, Array, Math, String, Error, console,
    Uint8Array, DataView, TextEncoder, TextDecoder, atob,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    IDB: new Proxy({}, { get: () => () => Promise.reject(new Error('no db')) }),
    UI: { uid: p => p + (++uidN) },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(STORE_SRC, 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

const BOOK = { name: 'Millow Ridge', entries: [
  { keys: ['bramble', 'Bramble & Pike'], content: 'Bramble & Pike Mutual insures offices and omens alike.', enabled: true },
  { keys: ['ledger'], content: 'The black ledger never leaves the vault.', enabled: false },
] };

function v2Card() {
  return {
    name: 'Miriam Voss', description: 'A claim adjuster who audits miracles.',
    first_mes: 'Sign here.', spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: 'Miriam Voss', character_book: JSON.parse(JSON.stringify(BOOK)) },
  };
}
function v3Card() {
  return {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { name: 'Adjuster', description: 'Audits.', first_mes: 'Hello.',
      character_book: JSON.parse(JSON.stringify(BOOK)) },
  };
}

console.log('A — importing a card imports its lorebook');
const Store = loadStore();

const c2 = Store.cardToCharacter(v2Card());
ok('V2 card imports its embedded book', c2.lorebook.length === 2, 'got ' + c2.lorebook.length);
same: {
  const hit = c2.lorebook[0] || {};
  ok('keys and content survive the hop',
    JSON.stringify(hit.keys) === '["bramble","Bramble & Pike"]' &&
    /audits miracles/.test(hit.content || '') === false &&
    /insures offices/.test(hit.content || ''),
    JSON.stringify({ keys: hit.keys, content: (hit.content || '').slice(0, 40) }));
}
ok('disabled state survives…', c2.lorebook[1] && c2.lorebook[1].enabled === false);
ok('…and a missing flag defaults to enabled', c2.lorebook[0] && c2.lorebook[0].enabled === true);

const legacy = v2Card();
delete legacy.data.character_book;
legacy.character_book = JSON.parse(JSON.stringify(BOOK));   /* V1-ish, top level */
const cl = Store.cardToCharacter(legacy);
ok('a legacy top-level book imports too', cl.lorebook.length === 2, 'got ' + cl.lorebook.length);

const bare = Store.cardToCharacter({ name: 'No Book', spec: 'chara_card_v2', data: { name: 'No Book' } });
ok('a card without a book imports clean (empty, not broken)',
  Array.isArray(bare.lorebook) && bare.lorebook.length === 0);

const c3 = Store.cardToCharacter(v3Card());
ok('V3 cards keep working exactly as before', c3.lorebook.length === 2);

console.log('B — exporting keeps the book in the card');
const out = Store.characterToCard(c2);
const outBook = out.data && out.data.character_book;
ok('export writes a character_book', !!outBook && Array.isArray(outBook.entries) && outBook.entries.length === 2,
   JSON.stringify(outBook ? Object.keys(outBook) : null));
ok('round trip: export → import keeps every entry',
  Store.cardToCharacter(out).lorebook.length === 2);
ok('a character without a book exports clean (no empty book)', !Store.characterToCard(bare).data.character_book);

console.log('C — the import details sheet says whether a book is aboard');
const app = fs.readFileSync(APP_SRC, 'utf8');
ok('the sheet tells you when a book comes with the card', /This card carries.*lorebook entr/s.test(app));
ok('…and tells you when it does not', /No lorebook embedded in this card/.test(app));

console.log(`\ncardlore-test: ${fail ? fail + ' failed, ' : ''}${pass} ok`);
process.exit(fail ? 1 : 0);
