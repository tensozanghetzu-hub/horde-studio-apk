#!/usr/bin/env node
/* H2 (APK-ISSUES.md) — export shape.
 *
 * The V2 spec asks for the character fields both at the top level and under
 * `data`, and different tools read different halves. Exporting them top-level
 * only meant a card from this app looked truncated everywhere else. The values
 * are the same on both sides, so our own import reads exactly what it did.
 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) { ok(name, got === want, JSON.stringify(got) + ' != ' + JSON.stringify(want)); }

var uidN = 0;
function loadStore() {
  var sb = {
    Promise, JSON, Object, Date, Array, Math, String, Error, console,
    Uint8Array, DataView, TextEncoder, TextDecoder, atob, btoa,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    IDB: {
      getAll: function () { return Promise.resolve([]); },
      put: function () { return Promise.resolve(); },
      del: function () { return Promise.resolve(); }
    },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  return sb.Store;
}
var Store = loadStore();

var c = {
  id: 'c1', name: 'Rhea', persona: 'A cartographer.', scenario: 'A storm over the ridge.',
  greeting: 'The door bangs open.', examples: 'Hi.\n<START>\nHello.',
  postHistory: 'Always mention the rain.', tags: ['fantasy'], lorebook: []
};
var card = Store.characterToCard(c);

console.log('H2 — the exported card carries both halves');
same('description is top level', card.description, 'A cartographer.');
same('…and under data', card.data.description, card.description);
same('scenario is under data', card.data.scenario, 'A storm over the ridge.');
same('first_mes is under data', card.data.first_mes, 'The door bangs open.');
same('mes_example is under data', card.data.mes_example, c.examples);
same('tags are under data', (card.data.tags || []).join(','), 'fantasy');
same('creatorcomment is under data', card.data.creatorcomment, card.creatorcomment);
same('the name is still in data', card.data.name, 'Rhea');
ok('spec markers stay top level (that is where the spec puts them)',
  card.spec === 'chara_card_v2' && card.spec_version === '2.0');

console.log('\nH2 — the intentional blank');
/* A single persona string cannot be split back into description+personality.
   Copying the same text into both would double it for any tool that joins
   them, which is worse than an empty field. */
same('personality is empty, not a duplicate of description', card.data.personality, '');
ok('description is not repeated into personality', card.personality !== card.description);

console.log('\nH2 — our own import is unchanged by the mirror');
var back = Store.cardToCharacter(card);
same('the persona survives the round trip', back.persona, 'A cartographer.');
same('the scenario survives', back.scenario, 'A storm over the ridge.');
same('the greeting survives', back.greeting, 'The door bangs open.');
same('the examples survive', back.examples, c.examples);
same('the post-history note survives', back.postHistory, 'Always mention the rain.');
same('the tags survive', back.tags.join(','), 'fantasy');

console.log('\nH2 — a card written by another tool still imports');
var foreign = {
  spec: 'chara_card_v2', spec_version: '2.0',
  data: { name: 'Ivo', description: 'A ferryman.', personality: 'Grumpy.', scenario: 'A river.',
    first_mes: 'Fare?', mes_example: '', tags: [] }
};
var iv = Store.cardToCharacter(foreign);
same('both halves of the sheet are kept', iv.persona, 'A ferryman.\n\nGrumpy.');
same('the name comes from data when the top level is absent', iv.name, 'Ivo');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
