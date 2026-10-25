/* posthistory-test — v1.39.16: a card's post_history_instructions survives import.
 *
 * chara_card_v2's data.post_history_instructions is the author's
 * "always remember" line — some cards lean on it for tone and safety
 * locks. We accepted the field on the sheet (Always-remember note) but the
 * importer hardcoded it to '' — any card carrying one arrived silent.
 *
 *   - V2 import maps data.post_history_instructions → character.postHistory
 *   - V3 import (data under card.data) does the same
 *   - it goes through the plainText wash on import like the other fields
 *   - a card without the field imports with an empty note (no undefined)
 *   - export writes a non-empty note back out as post_history_instructions
 *
 *   node /home/user/tests/posthistory-test.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'store.js');

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

const NOTE = 'The characters are eleven in the early era; every era stays non-sexual.';

console.log('A — V2 import keeps the note');
const Store = loadStore();
let c = Store.cardToCharacter({
  spec: 'chara_card_v2', spec_version: '2.0',
  data: { name: 'D', first_mes: 'hi', post_history_instructions: NOTE },
});
ok('postHistory carries the card note', c.postHistory === NOTE, JSON.stringify(c.postHistory));

console.log('\nB — V3 import does the same');
c = Store.cardToCharacter({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: 'D', scenario: 's', first_mes: 'hi', post_history_instructions: NOTE },
});
ok('postHistory carries the card note', c.postHistory === NOTE, JSON.stringify(c.postHistory));

console.log('\nC — absent / junk fields degrade to an empty note');
c = Store.cardToCharacter({ spec: 'chara_card_v2', data: { name: 'X', first_mes: 'hi' } });
ok('missing field → ""', c.postHistory === '' && typeof c.postHistory === 'string', JSON.stringify(c.postHistory));

console.log('\nD — export writes the note back');
const out = Store.characterToCard({ name: 'D', persona: 'p', greeting: 'g', postHistory: NOTE });
ok('post_history_instructions on the exported card', out.data && out.data.post_history_instructions === NOTE,
  JSON.stringify(out.data && out.data.post_history_instructions));
const bare = Store.characterToCard({ name: 'D', persona: 'p', greeting: 'g' });
ok('no note → field not emitted', !(bare.data && 'post_history_instructions' in bare.data));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
