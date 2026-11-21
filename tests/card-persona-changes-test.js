#!/usr/bin/env node
/* v1.41.0 — the reviewer's follow-up report, three defects and one open request,
 * on invented cards. Everything here is a behaviour the v1.40.0 bundle got wrong,
 * each block naming the defect it closes:
 *
 *  issue 2  a change BACK to a default is a change. Clearing a Horde instruction
 *           or resetting placement/compat/window used to be written nowhere: the
 *           key was only ever emitted when it differed from this app's default,
 *           and the untouched copy of the card kept the author's value, so the
 *           next import put the cleared thing straight back. Now the export
 *           compares against what the card said at import (v1.40.0 characters
 *           without that snapshot compare against their preserved copy instead),
 *           and writes an explicit value whenever the two differ.
 *
 *  issue 3  the preserved copy has real shape limits, and they used to be
 *           silent. Depth was cut at 12 and long arrays were punched full of
 *           nulls with nothing said about either. The depth bound is 200, an
 *           array is copied whole or reported, and whatever could not be copied
 *           is named — at import and again at export — as `path — reason`.
 *
 *  issue 1  (regression guard, alongside card-placement-lore-test.js) a card's
 *           `system_prompt_source` is kept as a request and applied by nobody.
 *
 *  request 4  `description` and `personality` are separately editable, and the
 *           merged one-box path keeps its documented consequence.
 *
 *     node /home/user/tests/card-persona-changes-test.js
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
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: atob, btoa: btoa,
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  location: { hostname: 'localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); },
  UI: {
    uid: function (p) { return p + (++uidN); },
    esc: function (v) { return String(v == null ? '' : v); },
    icon: function () { return ''; },
    toast: function (m) { sb.__toasts.push(String(m)); }, download: function () {},
    sheet: function () { return Promise.resolve(null); },
    confirm: function () { return Promise.resolve(true); },
    input: function () { return Promise.resolve(null); },
    md: function (v) { return String(v || ''); }
  },
  Views: {
    normalizeDataUrl: function (v) { return Promise.resolve(v); },
    normalizeCardImages: function (v) { return Promise.resolve(v); }
  },
  document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {} },
  scrollTo: function () {}, addEventListener: function () {}
};
sb.__toasts = [];
sb.window = sb; sb.global = sb;
vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
var Store = sb.Store, App = sb.App, API = sb.API;

var GLOBAL = 'GLOBAL SYSTEM PROMPT';
function settings(over) { return Object.assign({ userName: 'Player', systemPrompt: GLOBAL, styleLock: true }, over || {}); }
function v2(data) {
  return {
    spec: 'chara_card_v2', spec_version: '2.0', name: data.name,
    data: Object.assign({ name: 'Wren', description: 'Quiet.', personality: 'Loyal.', first_mes: 'Hello.',
      mes_example: '', scenario: 'A wet town.', post_history_instructions: '', extensions: {} }, data)
  };
}
function hx(card) {
  var d = (card && card.data && card.data.extensions && card.data.extensions.horde_studio) ||
    (card && card.extensions && card.extensions.horde_studio) || {};
  return d;
}
function importCard(card) { return App.prepareImportedCharacter(card); }
function sheet(c) {
  return API._charSheet(c, settings(), {}, API.loreSample([{ role: 'user', text: 'x' }]), 0, {});
}
/* the whole request, so “in the prompt” is a fact about what is sent and not a
   guess about which part of the builder a field belongs to */
function sent(c, set) {
  var hist = [{ role: 'user', text: 'player line' }, { role: 'assistant', text: 'reply' }];
  return API.buildChat(c, {}, hist, set || settings(), null, 'APP FINAL NOTE')
    .map(function (m) { return String(m.content || ''); }).join('\n\n');
}

/* a card authored the way a well-behaved Horde card is authored: it states its
   choices, and states them as the values this app would write by default */
function statedCard(over) {
  var h = Object.assign({
    post_history_placement: 'tail', system_prompt_source: 'card', lore_compat: true, lore_scan_turns: 11,
    agency: 'Author agency', style: 'Author style'
  }, over || {});
  return v2({ post_history_instructions: 'Author instruction: never narrate for the player.',
    extensions: { horde_studio: h } });
}

async function main() {

console.log('\nissue 2 — clearing a field is an edit, and survives a round trip');
var c2 = await importCard(statedCard());
same('import applies the card’s arrangement fields', {
  p: c2.postHistoryPlacement, compat: c2.loreCompat, turns: c2.loreScanTurns, agency: c2.directives.agency
}, { p: 'tail', compat: true, turns: 11, agency: 'Author agency' });
ok('…and not the prompt request', c2.systemPromptSource === '' && c2.systemPromptAsked === 'card',
  JSON.stringify({ s: c2.systemPromptSource, a: c2.systemPromptAsked }));
ok('…and the card’s instruction is in the request, so there is something to clear',
  sent(c2).indexOf('never narrate for the player') !== -1 &&
  sheet(c2).indexOf('Author agency') !== -1, sent(c2).slice(-160));

/* the reviewer's repro, exactly: clear all four things, export, re-import */
c2.postHistory = '';
c2.postHistoryPlacement = 'sheet';
c2.loreCompat = false;
c2.loreScanTurns = 0;
c2.directives.agency = '';
var cleared = Store.characterToCard(c2);
same('the export names every field moved back to a default instead of staying quiet',
  { p: hx(cleared).post_history_placement, c: hx(cleared).lore_compat, t: hx(cleared).lore_scan_turns,
    a: hx(cleared).agency === undefined ? 'omitted' : JSON.stringify(hx(cleared).agency) },
  { p: 'sheet', c: false, t: 0, a: '""' });
var c2b = Store.cardToCharacter(cleared);
ok('…so the cleared card stays cleared through a save and a re-import',
  c2b.postHistory === '' && c2b.postHistoryPlacement === 'sheet' && c2b.loreCompat === false &&
  c2b.loreScanTurns === 0 && (c2b.directives || {}).agency === '',
  JSON.stringify({ ph: c2b.postHistory, p: c2b.postHistoryPlacement, c: c2b.loreCompat,
    t: c2b.loreScanTurns, a: (c2b.directives || {}).agency }));
ok('…and the author’s text is gone from the request the app sends',
  sent(c2b).indexOf('never narrate for the player') === -1 &&
  sent(c2b).indexOf('Author agency') === -1, sent(c2b).slice(-260));
ok('…while the fields the card authored but nobody touched still come back',
  hx(cleared).system_prompt_source === 'card', JSON.stringify(hx(cleared)));

console.log('\nissue 2 — an untouched card still exports the author’s own bytes');
var untouched = Store.characterToCard(await importCard(statedCard()));
same('every stated value comes back as it was written, none of them re-stated',
  { p: hx(untouched).post_history_placement, c: hx(untouched).lore_compat, t: hx(untouched).lore_scan_turns,
    a: hx(untouched).agency, st: hx(untouched).system_prompt_source },
  { p: 'tail', c: true, t: 11, a: 'Author agency', st: 'card' });
ok('…and the instruction text is the card’s, not a re-write',
  (untouched.data.post_history_instructions || '') === 'Author instruction: never narrate for the player.',
  JSON.stringify(untouched.data.post_history_instructions));
var odd = await importCard(v2({ extensions: { horde_studio: { post_history_placement: 'middle', lore_scan_turns: 99 } } }));
same('a value this app does not recognise rides out untouched, unedited',
  { p: hx(Store.characterToCard(odd)).post_history_placement, t: hx(Store.characterToCard(odd)).lore_scan_turns },
  { p: 'middle', t: 99 });
ok('…while the app reads it its own way: “middle” is no placement, 99 clamps to 24',
  odd.postHistoryPlacement === 'sheet' && odd.loreScanTurns === 24,
  JSON.stringify({ p: odd.postHistoryPlacement, t: odd.loreScanTurns }));
odd.loreScanTurns = 3;
ok('…and one tap on a window turns it into a value this app wrote',
  hx(Store.characterToCard(odd)).lore_scan_turns === 3,
  JSON.stringify(hx(Store.characterToCard(odd))));

console.log('\nissue 2 — a character saved before this version gets the same rule');
var legacy = await importCard(statedCard());
delete legacy.cardAsked;                    /* what v1.40.0 actually stored */
legacy.postHistory = '';
legacy.postHistoryPlacement = 'sheet';
legacy.loreCompat = false;
legacy.loreScanTurns = 0;
var legacyOut = Store.characterToCard(legacy);
same('the ask is read off the card’s own copy when the character has no snapshot',
  { p: hx(legacyOut).post_history_placement, c: hx(legacyOut).lore_compat, t: hx(legacyOut).lore_scan_turns },
  { p: 'sheet', c: false, t: 0 });
var hand = { id: 'c1', name: 'Handmade', persona: 'Made here.', descText: '', persText: '',
  postHistoryPlacement: 'sheet', loreCompat: false, loreScanTurns: 0,
  directives: { agency: 'typed here' } };
same('a hand-made character keeps the old rule: only non-defaults are written',
  hx(Store.characterToCard(hand)), { agency: 'typed here' });

console.log('\nissue 3 — deep and wide cards, and what is said about them');
function nest(depth, leaf) {
  var out = leaf;
  for (var i = 0; i < depth; i++) out = { under: out };
  return out;
}
var deep = await importCard(v2({ extensions: { horde_studio: {} }, custom: { lore: nest(Store.SRC_DEPTH, 'past twelve') } }));
ok('a value 200 levels down is preserved whole (v1.40.0 stopped at 12)',
  !Store.cardSourceGaps(deep).length &&
  (function () {
    var v = Store.characterToCard(deep).data.custom.lore;
    for (var i = 0; i < Store.SRC_DEPTH; i++) v = v.under;
    return v === 'past twelve';
  })(), JSON.stringify(Store.cardSourceGaps(deep)));
var tooDeep = await importCard(v2({ extensions: { horde_studio: {} }, custom: { lore: nest(Store.SRC_DEPTH + 1, 'gone') } }));
var gaps = Store.cardSourceGaps(tooDeep);
ok('one level past the bound is reported by name, not discarded in silence',
  gaps.length === 1 && /custom\.lore\.under/.test(gaps[0]) && /nested past/.test(gaps[0]),
  JSON.stringify(gaps));
ok('…the import says it, where the user is deciding whether to trust the card',
  (tooDeep.importNotes || []).some(function (n) { return /cannot hold part of this card/.test(n) && /nested past/.test(n); }),
  JSON.stringify((tooDeep.importNotes || []).join(' | ').slice(0, 220)));
ok('…the export says it again at the moment it matters',
  /cardSourceGaps/.test(fs.readFileSync(path.join(JS, 'app.js'), 'utf8')));
ok('…and the character itself still works: nothing was cut from it',
  tooDeep.name === 'Wren' && /nested past/.test((tooDeep.importNotes || []).join(' ')));

console.log('\nissue 3 — arrays are copied whole or said to be too big');
var wide = await importCard(v2({ extensions: { horde_studio: {} }, notes: new Array(200).fill('x') }));
var wOut = Store.characterToCard(wide).data.notes;
ok('a 200-slot array comes back with no holes punched in it',
  Array.isArray(wOut) && wOut.length === 200 && wOut[100] === 'x' && wOut[150] === 'x',
  wOut && wOut.length + ':' + JSON.stringify((wOut || []).slice(100, 102)));
var holey = Store.cardSourceGaps(wide);
ok('…and if anything was left out, there is a note saying so rather than a quiet null',
  !holey.length || /notes/.test(holey.join(' ')), JSON.stringify(holey));

console.log('\nrequest 4 — the card’s two persona fields, edited apart');
var split = await importCard(v2({ description: 'Tall, patient, smells of rain.', personality: 'Stubborn. Kind to strangers.' }));
ok('import keeps both halves', split.descText === 'Tall, patient, smells of rain.' &&
  split.persText === 'Stubborn. Kind to strangers.',
  JSON.stringify({ d: split.descText, p: split.persText }));
ok('…and the prompt still sees one persona, so nothing else changed',
  split.persona === 'Tall, patient, smells of rain.\n\nStubborn. Kind to strangers.' && split.personaSplit === false,
  JSON.stringify(split.persona));
/* what the editor's two-field mode does on save */
split.personaSplit = true;
split.descText = 'Tall, patient, smells of rain. Rewritten here.';
split.persona = [split.descText, split.persText].filter(function (t) { return t.trim(); }).join('\n\n');
var sOut = Store.characterToCard(split);
ok('editing the description leaves the card’s personality exactly as it was',
  sOut.data.personality === 'Stubborn. Kind to strangers.' &&
  sOut.personality === 'Stubborn. Kind to strangers.',
  JSON.stringify({ data: sOut.data.personality, top: sOut.personality }));
ok('…and carries the new description under its own name',
  sOut.data.description === 'Tall, patient, smells of rain. Rewritten here.',
  JSON.stringify(sOut.data.description));
var sBack = Store.cardToCharacter(sOut);
ok('…so a re-import shows the two fields again, unchanged',
  sBack.descText === 'Tall, patient, smells of rain. Rewritten here.' &&
  sBack.persText === 'Stubborn. Kind to strangers.',
  JSON.stringify({ d: sBack.descText, p: sBack.persText }));
split.personaSplit = true;
split.descText = 'Tall, patient, smells of rain. Rewritten here.';
split.persText = 'Stubborn only.';
split.persona = [split.descText, split.persText].join('\n\n');
var pOut = Store.characterToCard(split);
ok('editing the personality leaves the description alone',
  pOut.data.description === 'Tall, patient, smells of rain. Rewritten here.' &&
  pOut.data.personality === 'Stubborn only.', JSON.stringify({ d: pOut.data.description, p: pOut.data.personality }));
ok('…and the {{personality}} / {{description}} macros mean their own fields now',
  sheet(split).indexOf('Stubborn only.') !== -1 && /smells of rain/.test(sheet(split)),
  sheet(split).slice(0, 240));
var mergedChar = Store.cardToCharacter(v2({ description: 'D.', personality: 'P.' }));
mergedChar.persona = 'D edited.\n\nP.';
mergedChar.personaSplit = false;
var mOut = Store.characterToCard(mergedChar);
ok('the merged path keeps its consequence: one box writes description and empties personality',
  mOut.data.description === 'D edited.\n\nP.' && mOut.data.personality === '',
  JSON.stringify({ d: mOut.data.description, p: mOut.data.personality }));
ok('…nothing is lost on that path — the old half is inside the text being edited',
  mOut.data.description.indexOf('P.') === mOut.data.description.length - 2);
mergedChar.descText = 'D edited.\n\nP.';
mergedChar.persText = '';
mergedChar.personaSplit = true;
var m2 = Store.characterToCard(mergedChar);
ok('…and switching to two fields after that keeps them two fields, one of them empty',
  m2.data.description === 'D edited.\n\nP.' && m2.data.personality === '', JSON.stringify({ d: m2.data.description, p: m2.data.personality }));

var flagOnly = Store.cardToCharacter(v2({ description: 'Kept.', personality: 'Kept too.' }));
flagOnly.personaSplit = true;                 /* the flag without the halves */
delete flagOnly.descText; delete flagOnly.persText;
ok('a record claiming two fields without carrying them cannot empty the card’s persona',
  Store.characterToCard(flagOnly).data.description === 'Kept.' &&
  Store.characterToCard(flagOnly).data.personality === 'Kept too.',
  JSON.stringify({ d: Store.characterToCard(flagOnly).data.description,
    p: Store.characterToCard(flagOnly).data.personality }));

/* the bare path (no source copy at all) must follow the same three cases */
var bareSplit = { id: 'c9', name: 'Bare', descText: 'Half one.', persText: 'Half two.',
  persona: 'Half one.\n\nHalf two.', personaSplit: true };
var bareOut = Store.characterToCard(bareSplit);
same('a character with no card behind it exports its two halves as two fields',
  { d: bareOut.data.description, p: bareOut.data.personality }, { d: 'Half one.', p: 'Half two.' });
var bareMerged = JSON.parse(JSON.stringify(bareSplit));
bareMerged.personaSplit = false;
var bareM = Store.characterToCard(bareMerged);
same('…and one string as description with an empty personality, as before',
  { d: bareM.data.description, p: bareM.data.personality }, { d: 'Half one.\n\nHalf two.', p: '' });

console.log('\nissue 1 — the request is kept and honoured by nobody (V2 and V3)');
var asking = await importCard(v2({ system_prompt: 'CARD RULES', extensions: { horde_studio: { system_prompt_source: 'card' } } }));
ok('a V2 card asking for “the card’s” prompt does not get it',
  asking.systemPromptSource === '' && API.cardPromptMode(asking, settings()) === '' &&
  sheet(asking).indexOf('CARD RULES') === -1, JSON.stringify({ s: asking.systemPromptSource }));
var v3asking = { spec: 'chara_card_v3', spec_version: '3.0', data: Object.assign(
  { name: 'Wren', description: 'Quiet.', personality: '', first_mes: 'Hi', mes_example: '', extensions: {} },
  { system_prompt: 'CARD RULES V3', extensions: { horde_studio: { system_prompt_source: 'combine' } } }) };
await importCard(v3asking).then(function (c3) {
  ok('the V3 path asks the same way and gets the same answer',
    c3.systemPromptAsked === 'combine' && c3.systemPromptSource === '' &&
    sent(c3).indexOf('CARD RULES V3') === -1 && sent(c3).indexOf('GLOBAL SYSTEM PROMPT') !== -1,
    JSON.stringify({ a: c3.systemPromptAsked, s: c3.systemPromptSource }));
  ok('…and its ask survives an export unchanged',
    hx(Store.characterToCard(c3)).system_prompt_source === 'combine', JSON.stringify(hx(Store.characterToCard(c3))));
});
/* the preference is live, not a stamp: it applies while it is on and stops when it
   goes off, which is what "my cards, my decision, made once" has to mean */
var PREF = Object.assign(settings(), { honorCardSystemPrompt: true });
var live = await importCard(v2({ system_prompt: 'LIVE PROMPT',
  extensions: { horde_studio: { system_prompt_source: 'card' } } }));
ok('the player’s preference reaches a card imported while it was off, and lets go when it goes off',
  sent(live).indexOf('LIVE PROMPT') === -1 &&
  sent(live, PREF).indexOf('LIVE PROMPT') !== -1 &&
  sent(live).indexOf('LIVE PROMPT') === -1 &&
  live.systemPromptSource === '', JSON.stringify({ asked: live.systemPromptAsked }));
var silent = await importCard(v2({ system_prompt: 'NO ASK PROMPT' }));
ok('…and it does nothing at all to a card that never asked',
  sent(silent, PREF).indexOf('NO ASK PROMPT') === -1);
ok('the grant a player gives is a character field, never a new card key',
  /systemPromptAsked/.test(fs.readFileSync(path.join(JS, 'store.js'), 'utf8')) &&
  !/system_prompt_approved/.test(fs.readFileSync(path.join(JS, 'store.js'), 'utf8')));
ok('CARDS.md documents the ask, the clearing rule and the preservation bound', (function () {
  var md = fs.readFileSync(path.join(ROOT, 'CARDS.md'), 'utf8');
  return /system_prompt_source/.test(md) && /asked/i.test(md) && /nested past|depth/i.test(md) &&
    /description.*personality|two fields/i.test(md);
})());

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('threw:', e && e.stack || e); process.exit(1); });
