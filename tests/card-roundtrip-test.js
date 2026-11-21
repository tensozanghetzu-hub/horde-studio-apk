#!/usr/bin/env node
/* v1.39.113 — opening a card must not damage it (compatibility letter, item 1).

   A card carries far more than this app models. Import used to drop what it did
   not understand, so exporting from the APK produced a diminished card and
   re-importing that made the loss permanent. The source is now kept and export
   overlays the user's edits onto it.

   Pinned here:
   1. an unedited card comes back out as it came in - value AND type, with
      description and personality still separate fields
   2. editing one field moves that field and nothing else
   3. lorebook entry properties follow the entry through reorder, delete, add,
      and past duplicate or absent source ids
   4. a top-level / data disagreement is left alone until the user edits, then
      both copies change
   5. V1, V2 and V3 all round-trip
   6. a character imported before this version exports exactly as it always did
   7. pictures come back where the app carries them, and the export says so
      where it does not
   8. preserved text never becomes prompt text

   Synthetic cards only - no real card content, per the repo rule.

     node /home/user/tests/card-roundtrip-test.js
 */
'use strict';

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
function same(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

var uidN = 0;
var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error,
  setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: atob, btoa: btoa, AbortController: AbortController,
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  location: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); },
  IDB: { getAll: function () { return Promise.resolve([]); }, put: function () { return Promise.resolve(); }, del: function () { return Promise.resolve(); } },
  UI: {
    uid: function (p) { return p + (++uidN); },
    esc: function (v) { return String(v == null ? '' : v); },
    icon: function () { return ''; },
    toast: function () {}, download: function () {},
    sheet: function () { return Promise.resolve(null); },
    confirm: function () { return Promise.resolve(true); },
    input: function () { return Promise.resolve(null); },
    md: function (v) { return String(v || ''); }
  },
  Views: {
    normalizeDataUrl: function (v) { return Promise.resolve(v); },
    normalizeCardImages: function (v) { return Promise.resolve(v); },
    appendMessage: function () { return { classList: { add: function () {} } }; },
    settings: function () {}, personas: function () {}, characters: function () {},
    chats: function () {}, life: function () {}, feed: function () {}, SETTINGS_SECTIONS: {}
  },
  VH: { status: function () { return { text: '' }; }, ensure: function () {}, latenessNote: function () { return null; },
    defaults: function () { return {}; } },
  document: {
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  scrollTo: function () {}, addEventListener: function () {}
};
sb.window = sb; sb.global = sb;
/* api.js first, so store.js can use the real plainText when it decides whether
   a field was edited. A stub here would quietly change the answer. */
vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
var Store = sb.Store, App = sb.App, API = sb.API;

function v2(over) {
  var data = Object.assign({
    name: 'Wren', description: 'Quiet, careful.', personality: 'Dry humour.',
    scenario: 'A late train.', first_mes: 'You made it.',
    mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello',
    post_history_instructions: 'Stay brief.'
  }, over || {});
  return { spec: 'chara_card_v2', spec_version: '2.0', name: data.name, data: data };
}
async function importCard(card) { return await App.prepareImportedCharacter(card); }
async function roundTrip(card, edit) {
  var c = await importCard(card);
  if (edit) edit(c);
  return { c: c, out: Store.characterToCard(c) };
}

async function main() {

console.log('\n1 — an unedited card exports as it came in');

var odd = v2({
  nickname: 'Wren N.',                     /* V3 field, no Horde equivalent */
  creation_date: '2024-01-02T00:00:00Z',
  system_prompt: 'AUTHOR PROMPT',          /* kept, deliberately not applied */
  talkativeness: '0.9',                    /* a string, and it stays one */
  fav: true,
  creatorcomment: 'written by hand',
  alternate_greetings: ['Second way in.', 'Third way in.'],
  extensions: {
    stable_diffusion: { model: 'x', seed: 7 },       /* somebody else's namespace */
    horde_studio: { note_for_other_clients: 1 }
  },
  character_book: {
    name: 'Wren world', description: 'book desc', scan_depth: 4, token_budget: 900,
    recursion_depth: 2, extensions: { other: true },
    entries: [
      { id: 1, keys: ['train'], content: 'Runs late.', enabled: true, constant: false,
        position: 'before_char', insertion_order: 5, priority: 3, use_regex: false,
        selective: false, secondary_keys: ['platform'], scan_depth: 2, comment: 'author note',
        extensions: { chub: { source: 1 } } },
      { id: 1, keys: ['ticket'], content: 'Checked.', enabled: true },   /* duplicate id */
      { keys: ['luggage'], content: 'Lost.', enabled: true }             /* no id at all */
    ]
  }
});
var plain = await roundTrip(odd);
var o = plain.out, od = o.data;

same('description survives untouched', od.description, 'Quiet, careful.');
same('…and personality stays a separate field', od.personality, 'Dry humour.');
same('…and the top level says the same thing, so a reader that looks there ' +
  'finds the author\'s text rather than the joined persona string',
  o.description, 'Quiet, careful.');
same('V3 nickname survives', od.nickname, 'Wren N.');
same('creation_date survives', od.creation_date, '2024-01-02T00:00:00Z');
same('the card system prompt is preserved', od.system_prompt, 'AUTHOR PROMPT');
same('…and still not applied by the app', plain.c.systemPrompt, '');
same('a string field is not turned into a number', od.talkativeness, '0.9');
same('a boolean stays a boolean', od.fav, true);
same('the author comment is not overwritten by our banner', od.creatorcomment, 'written by hand');
same('alternate greetings keep their exact text', od.alternate_greetings, ['Second way in.', 'Third way in.']);
same('another client namespace is untouched', od.extensions.stable_diffusion, { model: 'x', seed: 7 });
same('and our own namespace keeps its other keys', od.extensions.horde_studio.note_for_other_clients, 1);
ok('no second top-level extensions is invented', o.extensions === undefined, JSON.stringify(o.extensions));

same('book-level settings survive', [od.character_book.name, od.character_book.description], ['Wren world', 'book desc']);
same('…scan_depth', od.character_book.scan_depth, 4);
same('…token_budget', od.character_book.token_budget, 900);
same('…recursion_depth', od.character_book.recursion_depth, 2);
same('…its own extensions', od.character_book.extensions, { other: true });
var e1 = od.character_book.entries[0];
same('an entry keeps its source id', e1.id, 1);
same('…position', e1.position, 'before_char');
same('…insertion_order', e1.insertion_order, 5);
same('…priority', e1.priority, 3);
same('…scan_depth', e1.scan_depth, 2);
same('…use_regex', e1.use_regex, false);
same('…selective', e1.selective, false);
same('…secondary_keys', e1.secondary_keys, ['platform']);
same('…comment', e1.comment, 'author note');
same('…entry extensions', e1.extensions, { chub: { source: 1 } });
same('…and the app fields', [e1.keys, e1.content, e1.enabled], [['train'], 'Runs late.', true]);
ok('constant:false is not turned into true and not deleted',
  e1.constant === false, JSON.stringify(e1.constant));
same('a duplicate source id loses nothing',
  od.character_book.entries.map(function (e) { return e.keys[0]; }), ['train', 'ticket', 'luggage']);
same('an entry with no id keeps none', od.character_book.entries[2].id, undefined);

console.log('\n2 — editing one field moves that field and nothing else');

var edited = await roundTrip(odd, function (c) { c.persona = 'Rewritten persona.'; });
same('description takes the edit', edited.out.data.description, 'Rewritten persona.');
same('…and lands in both representations', edited.out.description, 'Rewritten persona.');
same('personality is emptied rather than left holding the old half',
  edited.out.data.personality, '');
same('the greeting was not touched', edited.out.data.first_mes, 'You made it.');
same('the scenario was not touched', edited.out.data.scenario, 'A late train.');
same('nickname still there', edited.out.data.nickname, 'Wren N.');
same('the book is still there', edited.out.data.character_book.entries.length, 3);
same('example block untouched, markup and all', edited.out.data.mes_example,
  '<START>\n{{user}}: Hi\n{{char}}: Hello');
ok('the runtime persona is still the sanitized one the app shows',
  edited.c.persona === 'Rewritten persona.', '');

var greetEdit = await roundTrip(odd, function (c) { c.greeting = 'New opening.'; });
same('a greeting edit leaves the persona split as it was',
  [greetEdit.out.data.description, greetEdit.out.data.personality], ['Quiet, careful.', 'Dry humour.']);
same('…and the greeting in both places',
  [greetEdit.out.data.first_mes, greetEdit.out.first_mes], ['New opening.', 'New opening.']);

var postEdit = await roundTrip(odd, function (c) { c.postHistory = 'Longer, please.'; });
same('the post-history edit is written', postEdit.out.data.post_history_instructions, 'Longer, please.');
same('…in the top level too', postEdit.out.post_history_instructions, 'Longer, please.');

console.log('\n3 — entry properties follow the entry, not the array slot');

var moved = await roundTrip(odd, function (c) {
  var b = c.lorebook.slice();
  b.unshift(b.pop());                                  /* luggage to the front */
  b[1].content = 'Checked at the gate.';               /* edit the train entry */
  b[1].keys = ['ticket', 'counter'];
  b.push({ id: 'l-brand-new', keys: ['platform'], content: 'Added here.',
    enabled: true, stage: '', constant: false });      /* an entry the card never had */
  c.lorebook = b;
});
var me = moved.out.data.character_book.entries;
same('the order the user made is kept', me.map(function (e) { return e.content; }),
  ['Lost.', 'Checked at the gate.', 'Checked.', 'Added here.']);
same('the entry moved to the front has no author fields of its own',
  [me[0].id, me[0].position, me[0].comment], [undefined, undefined, undefined]);
same('…and did not inherit its neighbour\'s',
  [me[0].insertion_order, me[0].priority], [undefined, undefined]);
same('the edited entry kept its own comment', me[1].comment, 'author note');
same('…its own position', me[1].position, 'before_char');
same('…its own source id', me[1].id, 1);
same('…and took both edits', [me[1].content, me[1].keys], ['Checked at the gate.', ['ticket', 'counter']]);
same('the duplicate-id entry kept its own id', me[2].id, 1);
same('…and nothing it never had', [me[2].position, me[2].comment], [undefined, undefined]);
var fresh = me[3];
same('a new entry exports what the app has', [fresh.keys, fresh.content, fresh.enabled],
  [['platform'], 'Added here.', true]);
ok('a new entry does not inherit a neighbour\'s unknowns',
  fresh.position === undefined && fresh.comment === undefined, JSON.stringify(fresh));
ok('a new entry gets no constant flag invented for it', fresh.constant === undefined,
  JSON.stringify(fresh.constant));
ok('the app\'s own entry id never leaks into the card',
  fresh.id === undefined || String(fresh.id).indexOf('l-') !== 0, JSON.stringify(fresh.id));

var deleted = await roundTrip(odd, function (c) { c.lorebook = [c.lorebook[1]]; });
same('deleting entries does not resurrect them', deleted.out.data.character_book.entries.length, 1);
same('…and the survivor keeps its own properties',
  [deleted.out.data.character_book.entries[0].keys, deleted.out.data.character_book.entries[0].position],
  [['ticket'], undefined]);

var emptied = await roundTrip(odd, function (c) { c.lorebook = []; });
same('an emptied book stays an empty book, not the author\'s',
  emptied.out.data.character_book.entries.length, 0);
same('…with the book-level settings still intact', emptied.out.data.character_book.token_budget, 900);

/* The whole entry mapping rides on the app's per-entry id. If some future save
   path re-mints ids, the worst that may happen is that an entry loses its
   preserved extras - it must never receive another entry's. */
var reminted = await roundTrip(odd, function (c) {
  c.lorebook.forEach(function (e, i) { e.id = 'l-reminted-' + i; });
});
var re = reminted.out.data.character_book.entries;
same('a re-minted id keeps the app fields of its own entry',
  re.map(function (e) { return e.content; }), ['Runs late.', 'Checked.', 'Lost.']);
/* v1.40.0 changed what "its own" includes: position, insertion_order, priority,
   selective, secondary_keys and case_sensitive are now MODELLED (the matcher
   reads them), so they live on the entry itself and survive a re-minted id.
   What must never happen is an entry receiving a field the card put on a
   neighbour - `comment` is the proof, since the app has no use for it and so
   cannot invent one for anyone. */
ok('…and takes no author fields from anywhere else',
  re.every(function (e) { return e.comment === undefined; }) &&
  re[0].position === 'before_char' &&
  re.slice(1).every(function (e) { return e.position === undefined && e.priority === undefined; }),
  JSON.stringify(re));
ok('…but the book itself is still intact', reminted.out.data.character_book.token_budget, 900);

console.log('\n4 — a top level / data disagreement');

var both = {
  spec: 'chara_card_v2', spec_version: '2.0',
  name: 'Twin', description: 'TOP LEVEL', first_mes: 'top greeting',
  data: { name: 'Twin', description: 'DATA LEVEL', first_mes: 'data greeting', personality: '' }
};
var asIs = await roundTrip(both);
same('the import reads data', asIs.c.persona, 'DATA LEVEL');
same('unedited: data keeps what data said', asIs.out.data.description, 'DATA LEVEL');
/* The card disagreed with itself. The app reads `data` (the spec says to), so
   the export resolves the disagreement the same way in both places rather than
   leaving a top-level copy that a different reader could prefer. The author's
   text is not lost - it is the same text, one value instead of two. */
same('unedited: a self-contradicting card is exported consistently',
  [asIs.out.description, asIs.out.data.description], ['DATA LEVEL', 'DATA LEVEL']);
var fixed = await roundTrip(both, function (c) { c.persona = 'EDITED'; });
same('an edit lands in data', fixed.out.data.description, 'EDITED');
same('…and in the top level, so no reader can prefer the stale value',
  fixed.out.description, 'EDITED');

console.log('\n5 — V1, V2 and V3 all come back whole');

var v1 = {
  name: 'Old', description: 'plain text', personality: 'wry',
  first_mes: 'Ancient opening.', mes_example: '', scenario: 'V1 world',
  character_book: { entries: [{ keys: ['old'], content: 'kept', position: 'after_char' }] },
  some_legacy_field: { deep: [1, 2, 3] }
};
var v1r = await roundTrip(v1), v1out = v1r.out;
same('V1 fields survive at the top level', v1out.first_mes, 'Ancient opening.');
same('V1 exports as V2 so other readers find the fields in data too',
  [v1out.spec, v1out.data.first_mes], ['chara_card_v2', 'Ancient opening.']);
same('…with the author\'s text, not a resanitized copy', v1out.data.description, 'plain text');
same('…and the personality kept separate', v1out.data.personality, 'wry');
same('the unknown legacy field survives', v1out.some_legacy_field, { deep: [1, 2, 3] });
same('the top-level book is read and written back',
  v1out.character_book.entries[0].keys, ['old']);
same('…with its entry property', v1out.character_book.entries[0].position, 'after_char');
same('…and into data as well', v1out.data.character_book.entries[0].position, 'after_char');

var v3out = (await roundTrip({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: 'New', description: 'd', first_mes: 'g', nickname: 'Nick',
    character_book: { name: 'b', entries: [{ keys: ['k'], content: 'c', role: 'system' }] } }
})).out;
same('V3 keeps its spec label', [v3out.spec, v3out.spec_version], ['chara_card_v3', '3.0']);
same('V3 keeps its nickname', v3out.data.nickname, 'Nick');
same('V3 keeps an entry field the app ignores', v3out.data.character_book.entries[0].role, 'system');

console.log('\n6 — a character from before this version is untouched');

var legacy = Store.blankCharacter();
legacy.name = 'Long-standing'; legacy.persona = 'p'; legacy.greeting = 'g';
legacy.lorebook = [{ id: 'l-1', keys: ['k'], content: 'c', enabled: true, stage: '', constant: true }];
legacy.createdAt = 1; legacy.updatedAt = 2;
var legacyOut = Store.characterToCard(legacy);
same('an old character exports the five fields the app models',
  legacyOut.data.character_book.entries[0],
  { keys: ['k'], content: 'c', enabled: true, stage: '', constant: true });
ok('nothing is invented to look preserved',
  legacyOut.data.nickname === undefined && legacyOut.data.character_book.entries[0].position === undefined,
  JSON.stringify(legacyOut.data.character_book.entries[0]));
same('…and the export keeps its own banner comment',
  legacyOut.creatorcomment, 'Exported from Horde Studio Mobile');

console.log('\n7 — pictures: back where the app has them, reported where it does not');

var picCard = v2({});
picCard.data.char_x = 'data:image/png;base64,AVATAR';
picCard.data.image_2 = 'data:image/png;base64,GALLERY';
picCard.data.extensions = { background_image: 'data:image/png;base64,BG' };
var pics = await importCard(picCard);
same('the source records what it left out', pics.cardSource.imgs,
  ['data.char_x', 'data.image_2', 'data.extensions.background_image']);
same('…and does not keep a second copy of the blob', pics.cardSource.body.char_x, undefined);
same('the gallery key the card used is remembered', pics.cardSource.imgs.indexOf('data.image_2') !== -1, true);
ok('…so the stored character stays small',
  JSON.stringify(pics.cardSource).indexOf('AVATAR') === -1, 'data URL survived into the copy');
pics.avatar = 'data:image/png;base64,AVATAR';
pics.images = [{ name: 'image_2', src: 'data:image/png;base64,GALLERY' }];
var picOut = Store.characterToCard(pics);
same('the avatar is put back', picOut.char_x, 'data:image/png;base64,AVATAR');
same('the gallery picture is put back', picOut.data.image_2, 'data:image/png;base64,GALLERY');
same('only the uncarried background is reported',
  Store.cardUnrestoredImages(pics, picOut), ['data.extensions.background_image']);

console.log('\n8 — preserved text stays out of the prompt');

function promptOf(c) {
  var s = { provider: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm',
    systemPrompt: 'GLOBAL', userName: 'Sam', contextMessages: 40 };
  return JSON.stringify(API.buildChat(c, { id: 'x', title: 't', sceneCast: [], scenePresent: [],
    addressedTo: '' }, [{ role: 'user', text: 'hello', id: 'u1', createdAt: 1 }], s, null, null));
}
var withSource = await importCard(odd);
var withoutSource = JSON.parse(JSON.stringify(withSource));
delete withoutSource.cardSource;
var a = promptOf(withSource), b = promptOf(withoutSource);
same('the same card prompts identically with or without the kept copy', a, b);
ok('the author system prompt did not sneak in', a.indexOf('AUTHOR PROMPT') === -1, '');
ok('the book comment did not sneak in', a.indexOf('author note') === -1, '');
ok('an unused legacy field did not sneak in', a.indexOf('Wren N.') === -1, '');
ok('the live sheet is still sent', a.indexOf('Quiet, careful.') !== -1, '');

console.log('\nthe notes tell the truth about all of this');

var notes = withSource.importNotes.join(' | ');
ok('an unused-but-kept field is not called a loss',
  notes.indexOf('does not use (') !== -1, notes.slice(0, 160));
ok('…and says the export carries it back', notes.indexOf('carries them back out') !== -1, '');
/* v1.40.0 turned both of these from "kept but ignored" into something the
   player can act on: the card's prompt is imported and switchable, and
   selective + secondary_keys are matched. A note still calling them ignored
   would now be the false statement. */
ok('the card system prompt is described as imported and switchable',
  /shown in full on the character/.test(notes), notes.slice(0, 200));
ok('secondary keys are no longer reported as ignored',
  notes.indexOf('The card keeps the setting') === -1 && notes.indexOf('does not match on') === -1, '');

Store.SOURCE_CAP = 200;
var tooBig = await importCard(v2({ description: 'x'.repeat(500) }));
ok('a source over the cap is not kept', !tooBig.cardSource, JSON.stringify(tooBig.cardSource).slice(0, 60));
ok('…and the notes stop promising preservation',
  /too large for the app to keep a copy/.test(tooBig.importNotes.join(' | ')), tooBig.importNotes.join(' | ').slice(0, 160));
ok('…without losing the character itself', tooBig.persona.length > 0, '');
same('…and export still works', typeof Store.characterToCard(tooBig).data.first_mes, 'string');
Store.SOURCE_CAP = 2 * 1024 * 1024;

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
return fail ? 1 : 0;
}

main().then(function (code) { process.exit(code); },
  function (e) { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
