#!/usr/bin/env node
/* CARDS.md's ledger section is the only thing a card author has to go on, and a
   document like that rots in one specific way: the app grows an accepted field, or
   a bound moves, and the author follows the doc and is dropped silently — because
   the parser's failure mode is silence, not an error. So every field name and every
   number the section claims is derived here from the real code, by experiment
   wherever the parser can be made to answer for itself (offer a payload just past
   the bound and see whether it bites) and from the source where it cannot.

   The table in the doc is load-bearing rather than illustrative: a row whose Ops
   cell is filled is a claim the parser accepts that pair, and a row whose Ops cell
   is `—` is a claim it does not. Checked in both directions, so a field the
   grammar grows without a row goes red here too.

   Usage: node tests/card-rpg-doc-test.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(String(got)) + ' != ' + JSON.stringify(want));
}

function loadApi() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite, TextEncoder: TextEncoder
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var cards = fs.readFileSync(path.join(ROOT, 'CARDS.md'), 'utf8');

/* Isolated to the one section: a "600 characters" elsewhere in CARDS.md is about a
   different bound, and a second table added further down must not let a stale row
   here pass by matching against the wrong prose. */
var from = cards.indexOf('## The RPG status ledger');
var section = from === -1 ? '' : cards.slice(from, cards.indexOf('\n## ', from + 10));
ok('CARDS.md has a ledger section for card authors', section.length > 2000, section.length + ' chars');

console.log('\nthe table and the parser agree, both ways');
var rows = [];
section.split('\n').forEach(function (line) {
  var m = line.match(/^\|\s*`([a-zA-Z]+)`\s*\|([^|]*)\|/);
  if (m) rows.push({ field: m[1], ops: (m[2].match(/`([a-z]+)`/g) || []).map(function (x) { return x.replace(/`/g, ''); }) });
});
ok('the table is readable and names a handful of fields', rows.length >= 6, rows.map(function (r) { return r.field; }).join(', '));

function probe(field, op) {
  var c = { field: field, op: op };
  if (field === 'xp') c.value = op === 'add' ? 10 : 50;
  else if (field === 'level' || field === 'xpToNext') c.value = 7;
  else if (field === 'attributes') { c.key = 'Strength'; c.value = '8'; }
  else c.value = 'a brass key';
  var parsed = API.parseRpgUpdate('<rpg_update>' + JSON.stringify({ reason: 'probe', changes: [c] }) + '</rpg_update>');
  return !!(parsed && parsed.changes.length);
}
rows.forEach(function (r) {
  if (!r.ops.length) {
    ok('`' + r.field + '` is refused, as its `—` promises',
      !probe(r.field, 'set') && !probe(r.field, 'add'),
      'the parser took it, so the doc promises a refusal that does not happen');
    return;
  }
  r.ops.forEach(function (op) {
    ok('`' + r.field + ' ' + op + '` is accepted, as the table claims', probe(r.field, op),
      'the parser drops it — an author is told to write something that silently does nothing');
  });
});

var parseBody = apiSrc.slice(apiSrc.indexOf('function parseRpgUpdate'), apiSrc.indexOf('function stripRpgUpdate'));
var fromSource = {};
/* Every comparison against the field name, written either way round: the parser
   copies `c.field` into a local, so today the source says `field === 'xp'` and no
   `c.field === `. Matching both spellings means a refactor that inlines the local
   cannot hide a field from this check — and the declaration is `String(c.field ||
   '')`, with no `===`, so it cannot be mistaken for one either. */
(parseBody.match(/c?\.?field === '([a-zA-Z]+)'/g) || []).forEach(function (x) {
  fromSource[/'([a-zA-Z]+)'/.exec(x)[1]] = 1;
});
/* …plus the one array form the parser uses for the three list fields. */
var listArray = (parseBody.match(/\[((?:'[a-zA-Z]+',?\s*)+)\]\.indexOf\(field\)/) || [])[1] || '';
(listArray.match(/'([a-zA-Z]+)'/g) || []).forEach(function (x) { fromSource[x.replace(/'/g, '')] = 1; });
/* Vacuity guard: an extractor that found nothing would make the equality below
   "0 == 6" and pass on the day the parser is rewritten into a table of its own. */
ok('the extractor found the grammar it claims to read', Object.keys(fromSource).length >= 6,
  Object.keys(fromSource).join(', '));
var codeFields = Object.keys(fromSource).sort();
var tableFields = rows.filter(function (r) { return r.ops.length; }).map(function (r) { return r.field; }).sort();
ok('…and every field the parser takes has a row', codeFields.join(' ') === tableFields.join(' '),
  'parser: ' + codeFields.join(', ') + ' / table: ' + tableFields.join(', '));
ok('`xpToNext` is not in the grammar at all', codeFields.indexOf('xpToNext') === -1 && !probe('xpToNext', 'set'),
  'it is the app’s number');

console.log('\nthe bounds in the prose are the bounds in the code');
function tag(changes, extra) {
  return API.parseRpgUpdate('<rpg_update>' + JSON.stringify(Object.assign({ reason: 'r', changes: changes }, extra || {})) + '</rpg_update>');
}
var many = []; for (var i = 0; i < 21; i++) many.push({ field: 'skills', op: 'add', value: 'thing ' + i });
same('21 changes drop the block whole, as the 1-to-20 line says', tag(many), 'null');
same('20 do not', ((tag(many.slice(0, 20)) || {}).changes || []).length, 20);
var fat = '<rpg_update>' + JSON.stringify({ reason: new Array(8200).join('x'), changes: [{ field: 'xp', op: 'add', value: 1 }] }) + '</rpg_update>';
ok('a tag whose JSON runs past 8000 characters is refused', fat.indexOf('</rpg_update>') - 13 > 8000 &&
  API.parseRpgUpdate(fat) === null, 'inner length ' + (fat.indexOf('</rpg_update>') - 13));
same('1000001 XP is not a number the app keeps', tag([{ field: 'xp', op: 'add', value: 1000001 }]), 'null');
same('1000000 XP is', ((tag([{ field: 'xp', op: 'add', value: 1000000 }]) || {}).changes || [{}])[0].value, 1000000);
same('a negative `set` is refused', tag([{ field: 'xp', op: 'set', value: -5 }]), 'null');
same('a skill of 241 characters comes back at 240', (((tag([{ field: 'skills', op: 'add', value: new Array(242).join('a') }]) || {}).changes || [{}])[0].value || '').length, 240);
same('an attribute key of 49 comes back at 48', (((tag([{ field: 'attributes', op: 'set', key: new Array(50).join('k'), value: 'v' }]) || {}).changes || [{}])[0].key || '').length, 48);
same('and its value of 161 at 160', (((tag([{ field: 'attributes', op: 'set', key: 'k', value: new Array(162).join('v') }]) || {}).changes || [{}])[0].value || '').length, 160);
same('a level of 41 comes back at 40', (((tag([{ field: 'level', op: 'set', value: new Array(42).join('l') }]) || {}).changes || [{}])[0].value || '').length, 40);
same('a reason of 500 comes back at 400', (tag([{ field: 'xp', op: 'add', value: 1 }], { reason: new Array(501).join('r') }) || {}).reason.length, 400);
same('an unknown field is dropped and the good row survives', ((tag([{ field: 'gold', op: 'add', value: 5 }, { field: 'xp', op: 'add', value: 7 }]) || {}).changes || []).length, 1);

/* A bound the code moved and the prose did not is the actual failure this file
   exists for, so the numbers have to be printed in the section, not merely true. */
['≤ **8000 characters**', '**1 to 20**', '1000000', '≤ 240 chars', '≤ 48', '≤ 160', '≤ 40',
  '≤ **400 characters**', '≤ **200**', '≤ **600 characters**', '≤ 80 entries'].forEach(function (claim) {
  ok('the section says ' + claim, section.indexOf(claim) !== -1, 'not in the prose, though the code does it');
});

console.log('\nwhat the app does with an approved change');
var award = API.rpgAwardOf({ xp: 100 }, { xp: 250 }, [{ field: 'xp', op: 'add', value: 150 }],
  { at: 9, reason: 'Held the bridge through a full night', speaker: 'Sera' });
ok('the award is the object the section describes', award && award.xp === 150 && award.from === 100 &&
  award.at === 9 && award.speaker === 'Sera' && /full night/.test(award.reason), JSON.stringify(award));
/* `label` and `cut` exist only when there is something to say, so the claim pinned
   here is the one the doc makes: every key it lists is a key the award can carry. */
var awardKeys = Object.keys(API.rpgAwardIn({ xp: 1, from: 0, at: 0, label: 'l', reason: 'r', speaker: 's', cut: ['c'] }, null));
ok('every key of an award is one the section explains', awardKeys.every(function (k) {
  return section.indexOf('`' + k + '`') !== -1;
}), awardKeys.join(', ') + ' — the prose must name each one it promises the log can hold');
same('and the log clips the reason where the section says it does',
  API.rpgAwardIn({ xp: 1, from: 0, at: 0, reason: new Array(501).join('r') }, null).reason.length, 200);
['msg.rpgAward', 'xpBase', 'declined', 'rpgStatus'].forEach(function (key) {
  ok('the section names `' + key + '` as not yours to write', section.indexOf(key) !== -1);
});

console.log('\nthe four silences are in the code, not just in the doc');
same('a chat with the ledger off is given no block at all', API.rpgStatusPrompt({ rpgStatus: { enabled: false } }), '');
ok('a chat with suggestions off is told to output no tag',
  /Status suggestions are disabled\. Do not output an <rpg_update> block\./.test(
    API.rpgStatusPrompt({ rpgStatus: { enabled: true, suggestionsEnabled: false } })));
ok('a reroll, a replace-bubble and a continue offer nothing',
  appSrc.indexOf('suggestionsEnabled !== false && !(opts.rerollFor || opts.replaceBubble || opts.continueFor)') !== -1,
  'the gate moved or was loosened; the doc promises the tag is dropped there');
same('a second block wins and the first is ignored',
  ((API.parseRpgUpdate('<rpg_update>{"reason":"a","changes":[{"field":"xp","op":"add","value":1}]}</rpg_update>' +
    '<rpg_update>{"reason":"b","changes":[{"field":"xp","op":"add","value":2}]}</rpg_update>') || {}).changes || [{}])[0].value, 2);
ok('the refusal list is handed back to the model verbatim',
  API.rpgStatusPrompt({ rpgStatus: { enabled: true, declined: [{ label: 'a', at: 1 }] } })
    .indexOf('REFUSED BY THE PLAYER, do not offer again in this chat: a') !== -1);

console.log('\nwhat the card does get to say');
ok('`progression` is a real authoring field, labelled as the doc calls it',
  /\['progression', 'Story progression'\]/.test(apiSrc) && /extensions\.horde_studio\.progression/.test(section));
same('and 600 is its bound into the prompt', (apiSrc.match(/var DIRECTIVE_CHARS = (\d+)/) || [])[1], '600');
ok('the section tells an author to leave the numbers out',
  /restating figures in your card builds a second authority/.test(section));
/* The doc shows a worked example rather than a paraphrase, and an example is the
   part an author copies. So both sentences are taken out of the generator for the
   chat the doc names, and the section has to contain them — prose and code are
   allowed to move together, but not apart. The doc wraps its blockquote, so both
   sides are compared with runs of whitespace collapsed. */
var quotedChat = { enabled: true, xp: 405, rule: '100 x1.5' };
var shown = API.rpgStatusPrompt({ rpgStatus: quotedChat });
/* Blockquote markers first, then whitespace: the doc wraps its quote with `> ` on
   every line, and a `>` left in the middle would read as prose the generator never
   wrote. */
var flat = section.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
var curveLine = (shown.split('\n').filter(function (l) { return /^Level \d+ needs/.test(l); })[0] || '')
  .split(' The level and its threshold')[0];
var capLine = (shown.match(/One turn may move at most [^.]+\./) || [''])[0];
ok('the quoted curve sentence is exactly what the app writes', curveLine.length > 30 &&
  flat.indexOf(curveLine.replace(/\s+/g, ' ')) !== -1, curveLine);
ok('the quoted cap sentence is exactly what the app writes', capLine.length > 20 &&
  flat.indexOf(capLine.replace(/\s+/g, ' ')) !== -1, capLine);
ok('and the example really is that chat', /405 XP on `100 x1.5`/.test(section) &&
  String(API.rpgView(quotedChat).level) === '3', 'level ' + API.rpgView(quotedChat).level);
/* `text = API.stripRpgUpdate ? API.stripRpgUpdate(text) : text;` names it twice on
   one line, so the site is counted by line: one place strips the tag, which is what
   makes "a block in the greeting is never parsed and never removed" true. */
var stripLines = appSrc.split('\n').filter(function (l) { return l.indexOf('API.stripRpgUpdate') !== -1; });
ok('the greeting warning is true: only the reply pipeline strips the tag', stripLines.length === 1,
  stripLines.length + ' lines strip it, want 1: ' + stripLines.join(' / ').slice(0, 90));
ok('one class, and the doc says it is on purpose',
  !/tracks|multiclass/i.test(Object.keys(API.rpgStatusDefaults()).join(' ')) && /One class, on purpose/.test(section));
same('the ledger is the documented set of keys', Object.keys(API.rpgStatusDefaults()).sort().join(' '),
  'attributes declined enabled inventory level notes rule skills suggestionsEnabled xp xpBase xpToNext');

console.log('\nlevel under a curve, level under manual — as the Kept-when column claims');
var curved = API.rpgApplyUpdate({ enabled: true, xp: 0, rule: '100' }, [{ field: 'level', op: 'set', value: 'Archmage' }], { at: 3 });
var manual = API.rpgApplyUpdate({ enabled: true, xp: 0, rule: 'manual', level: '1' }, [{ field: 'level', op: 'set', value: 'Archmage' }], { at: 3 });
ok('a curve refuses it and says so in `dropped`', curved.status.level === '1' && curved.dropped.length === 1,
  JSON.stringify({ level: curved.status.level, dropped: curved.dropped }));
same('manual keeps the string the model wrote', manual.status.level, 'Archmage');
same('and neither one moves the target by itself', manual.status.xpToNext, null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
