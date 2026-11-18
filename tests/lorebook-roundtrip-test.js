#!/usr/bin/env node
/* A2, C3, C1, B1 — the round-trip and lorebook items from APK-ISSUES.md.
 *
 * A2: V3 expression portraits survive import AND export.
 * C3: a disabled lorebook entry stays disabled (SUSPECTED in the doc — it is
 *     correct; this pins it so it cannot regress).
 * C1: `constant` entries always join the prompt, still inside the budget.
 * B1: <START> separates example turns instead of being deleted.
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
    IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
    UI: { uid: function (p) { return p + (++uidN); } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  return sb.Store;
}
function loadApi() {
  var sb = { Promise, JSON, Object, Date, Array, Math, String, Error, console, RegExp,
    Uint8Array, DataView, TextEncoder, TextDecoder, atob, btoa, setTimeout: function () {},
    localStorage: { getItem: function () { return null; }, setItem: function () { } },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' }, fetch: function () { return Promise.reject(new Error('offline')); } };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}

var Store = loadStore();
var API = loadApi();

/* ------------------------------------------------------------------ */
console.log('A2 — V3 expression portraits survive a round trip');

function v3(extra) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: Object.assign({
    name: 'Sera', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: ''
  }, extra || {}) };
}
var portraits = [{ label: 'smile', keys: ['grin'], src: 'data:image/png;base64,AAA' }];
var v3card = v3({ extensions: { horde_studio: { expression_portraits: portraits } } });

var c = Store.cardToCharacter(v3card);
ok('the V3 branch imports them', Array.isArray(c.expressionPortraits) && c.expressionPortraits.length === 1,
  JSON.stringify(c.expressionPortraits));
same('…with the label intact', c.expressionPortraits[0].label, 'smile');

var out = Store.characterToCard(c);
var back = out.data.extensions && out.data.extensions.horde_studio &&
  out.data.extensions.horde_studio.expression_portraits;
ok('the export carries them', Array.isArray(back) && back.length === 1, JSON.stringify(back));
same('…unchanged', back && back[0].label, 'smile');

var again = Store.cardToCharacter(out);
ok('…and a second import still has them',
  again.expressionPortraits.length === 1 && again.expressionPortraits[0].label === 'smile');

/* ------------------------------------------------------------------ */
console.log('\nC3 — a dormant lorebook entry stays dormant (doc said SUSPECTED)');

var bookCard = { spec: 'chara_card_v2', data: {
  name: 'S', description: 'd', scenario: 's', first_mes: 'hi',
  character_book: { entries: [
    { keys: ['a'], content: 'live', enabled: true },
    { keys: ['b'], content: 'dormant', enabled: false }
  ] }
} };
var bc = Store.cardToCharacter(bookCard);
same('import keeps the disabled flag', bc.lorebook[1].enabled, false);
var bout = Store.characterToCard(bc);
same('export keeps it too', bout.data.character_book.entries[1].enabled, false);
same('…and a re-import is unchanged', Store.cardToCharacter(bout).lorebook[1].enabled, false);

/* ------------------------------------------------------------------ */
console.log('\nC1 — "constant" entries are always in play');

var entries = [
  { id: '1', keys: ['dragon'], content: 'DRAGON-FACT', enabled: true },
  { id: '2', keys: ['never-mentioned'], content: 'ALWAYS-FACT', enabled: true, constant: true },
  { id: '3', keys: ['never-mentioned'], content: 'OFF-FACT', enabled: false, constant: true }
];
var hits = API._loreHits(entries, 'nothing relevant here', 6, 1536, '');
var texts = hits.map(function (e) { return e.content; });
ok('a constant entry joins without a keyword', texts.indexOf('ALWAYS-FACT') !== -1, JSON.stringify(texts));
ok('a keyword entry still needs its keyword', texts.indexOf('DRAGON-FACT') === -1, JSON.stringify(texts));
ok('a disabled constant entry stays out', texts.indexOf('OFF-FACT') === -1, JSON.stringify(texts));

var withKey = API._loreHits(entries, 'a dragon appears', 6, 1536, '');
ok('with a keyword match both fire', withKey.length === 2, withKey.length);

/* the budget still binds, so constant cannot flood the prompt */
var big = [];
for (var i = 0; i < 6; i++) big.push({ keys: [], content: new Array(400).join('x'), enabled: true, constant: true });
ok('the byte budget still caps constant entries', API._loreHits(big, 'anything', 6, 1000, '').length < 6,
  API._loreHits(big, 'anything', 6, 1000, '').length);

/* stage gating still applies to constant entries */
var staged = [{ keys: [], content: 'S', enabled: true, constant: true, stage: 'late' }];
ok('stage still gates a constant entry', API._loreHits(staged, 'x', 6, 1536, 'early').length === 0);
ok('…and admits it at the right stage', API._loreHits(staged, 'x', 6, 1536, 'late').length === 1);

/* import/export carry the flag */
var constCard = { spec: 'chara_card_v2', data: {
  name: 'S', description: 'd', scenario: 's', first_mes: 'hi',
  character_book: { entries: [{ keys: [], content: 'C', constant: true }] }
} };
var cc = Store.cardToCharacter(constCard);
same('import keeps "constant"', cc.lorebook[0].constant, true);
same('export keeps "constant"', Store.characterToCard(cc).data.character_book.entries[0].constant, true);

/* ------------------------------------------------------------------ */
console.log('\nB1 — <START> separates example turns');

var char = { name: 'Nira', persona: '', scenario: '', greeting: '', examples: '' };
var s = { userName: 'Player', maxTokens: 600, temperature: 0.85, topP: 0.95 };

var ex = '<START>\n{{user}}: Good morning.\n{{char}}: You are early.\n<START>\n{{user}}: I could not sleep.';
var msgs = API.buildChat(char, { id: 'x', messages: [] },
  [{ role: 'user', text: 'hello' }], Object.assign({ systemPrompt: 'n' }, s), null, null, null);
/* read the parsed examples directly through the exported builder path */
var builtOut = API._examplesToMessages(ex, char, s);
ok('<START> does not survive as prose', JSON.stringify(builtOut).indexOf('<START>') === -1);
same('three turns parse out (user, char, user)', builtOut.length, 3);
same('the first is the player', builtOut[0].role, 'user');
same('the second is the character', builtOut[1].role, 'assistant');
same('turn text is clean', builtOut[0].content, 'Good morning.');
same('a second block starts fresh after the separator', builtOut[2].content, 'I could not sleep.');

var noStart = API._examplesToMessages('{{user}}: hi\n{{char}}: hello', char, s);
same('a card without separators still works', noStart.length, 2);

var dashes = API._examplesToMessages('{{user}}: a\n{{char}}: b\n---\n{{user}}: c', char, s);
same('--- is accepted as a separator too', dashes.length, 3);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
