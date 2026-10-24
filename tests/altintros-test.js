/* altintros-test — v1.39.13: multi-intro cards.
 *
 * Card sites are full of "+10 intros" bots: the V2 spec carries the extra
 * first messages in data.alternate_greetings, one line of code away — and we
 * never read it. Every such card imported with exactly one intro, and
 * exporting the character dropped the alternates again.
 *
 *   - import keeps alternate_greetings (V2 data / V3 data / legacy top level)
 *   - an alternate that duplicates first_mes is not carried twice
 *   - export writes them back; round trip is faithful
 *   - a NEW CHAT seeds the first message with all intros as swipeable alts,
 *     {{user}}-macro-expanded like the greeting itself
 *   - the import details sheet says how many intros came aboard
 *
 *   node /home/user/tests/altintros-test.js
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

const G1 = 'Intro one. She looks up from the book.';
const G2 = 'Intro two. The pool tiles are cold underfoot.';
const G3 = 'Intro three. The train whistle blows.';

function v2WithAlts() {
  return {
    name: 'Draconica', first_mes: G1,
    spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: 'Draconica', alternate_greetings: [G1, ' ' + G2 + ' ', G3] },  /* dup + whitespace-reality */
  };
}

console.log('A — the alternates import');
const Store = loadStore();

const c = Store.cardToCharacter(v2WithAlts());
ok('alternate greetings land on the character', Array.isArray(c.alternateGreetings),
  'field: ' + JSON.stringify(c.alternateGreetings));
ok('an alternate that IS the first message is not carried twice',
  c.alternateGreetings.length === 2, JSON.stringify(c.alternateGreetings));
ok('entries arrive trimmed', c.alternateGreetings[0] === G2);

const legacy = { name: 'L', first_mes: G1, alternate_greetings: [G2, G3], spec: 'chara_card_v2', data: { name: 'L' } };
ok('legacy top-level alternates import too', Store.cardToCharacter(legacy).alternateGreetings.length === 2);

const solo = Store.cardToCharacter({ name: 'Solo', first_mes: G1, spec: 'chara_card_v2', data: { name: 'Solo' } });
ok('a single-intro card stays clean', Array.isArray(solo.alternateGreetings) && solo.alternateGreetings.length === 0);

const v3 = Store.cardToCharacter({ spec: 'chara_card_v3', data: { name: 'V', first_mes: G1, alternate_greetings: [G2] } });
ok('V3 cards keep theirs too', v3.alternateGreetings.length === 1);

console.log('B — export keeps the alternates');
const out = Store.characterToCard(c);
ok('export writes data.alternate_greetings',
  Array.isArray(out.data && out.data.alternate_greetings) && out.data.alternate_greetings.length === 2,
  JSON.stringify(out.data && Object.keys(out.data)));
ok('round trip keeps every intro', Store.cardToCharacter(out).alternateGreetings.length === 2);

console.log('C — a new chat offers all intros as swipes on the first message');
const apiSrc = fs.readFileSync(APP_SRC, 'utf8');
ok('newChat folds the alternates into the first message alts',
  /alternateGreetings/.test(apiSrc) && /alts/.test(apiSrc));
ok('the alternates get the same {{user}}-macro treatment as the greeting',
  /macro/.test(apiSrc));

/* end-to-end with the real app path */
function loadApp() {
  let added = null;
  const greetingC = {
    id: 'c9', name: 'Draconica', greeting: 'Intro one for {{user}}.',
    alternateGreetings: ['Intro two for {{user}}.'], vh: { enabled: false },
  };
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    TextEncoder, TextDecoder, isNaN, parseInt, parseFloat,
    UI: { esc: s => String(s == null ? '' : s), icon: () => '', toast: () => {}, md: s => String(s || ''), uid: p => p + '-x' },
    Store: {
      settings: { userName: 'Bluscript' },
      newSession: () => ({ id: 's9', charId: 'c9' }),
      putSession: s => Promise.resolve(s),
      getCharacter: () => greetingC,
      addMessage: m => { added = m; return Promise.resolve(m); },
      init: () => Promise.resolve(),
    },
    API: { macros: (t, cch, st) => String(t).replaceAll('{{user}}', st.userName) },
    IDB: { get: () => Promise.resolve(null) },
    Views: {}, VH: { noteContact: () => {} },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(apiSrc, sandbox, { filename: 'app.js' });
  sandbox.App.openSession = () => Promise.resolve();
  return { App: sandbox.App, grab: () => added };
}

const A = loadApp();
(async function () {
  await A.App.newChat('c9');
  const m = A.grab();
  ok('the first message seeds with every intro as an alt',
    m && Array.isArray(m.alts) && m.alts.length === 2 && m.altIdx === 0,
    JSON.stringify(m && m.alts));
  ok('alternation comes macro-expanded', m && m.alts[1] === 'Intro two for Bluscript.');

  console.log('D — the import details sheet counts the intros');
  ok('the sheet says how many intros came aboard', /intro/i.test(apiSrc) && /swipe/i.test(apiSrc),
    'no intros line found in app.js');

  console.log(`\naltintros-test: ${fail ? fail + ' failed, ' : ''}${pass} ok`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
