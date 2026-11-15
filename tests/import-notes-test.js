#!/usr/bin/env node
/* G — the import preview says what was NOT carried over.
 *
 * Every note here corresponds to a real silent loss. The point is that a card
 * author sees the reason instead of guessing.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var APP = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

/* importLossNotes is pure: lift it out and run it on its own. */
var src = fs.readFileSync(APP, 'utf8');
var a = src.indexOf('  App.importLossNotes = function (card) {');
var b = src.indexOf('\n  };', a) + 4;
if (a < 0) { console.error('importLossNotes not found'); process.exit(1); }
global.App = {};
eval(src.slice(a, b));
var notes = global.App.importLossNotes;

function v3(extra) {
  return { spec: 'chara_card_v3', data: Object.assign({
    name: 'S', description: 'd', scenario: 's', first_mes: 'hi', mes_example: ''
  }, extra || {}) };
}

console.log('G — each silent loss produces a line');

ok('a clean card says nothing',
  notes({ spec: 'chara_card_v2', data: { name: 'S', mes_example: '{{user}}: hi\n{{char}}: hello' } }).length === 0,
  JSON.stringify(notes({ spec: 'chara_card_v2', data: { name: 'S', mes_example: '{{user}}: hi\n{{char}}: hello' } })));

/* v1.39.70 supports <START> (B1), so it is no longer a loss to report */
var startNotes = notes({ spec: 'chara_card_v2', data: { name: 'S', mes_example: '<START>\n{{user}}: hi' } });
ok('<START> is no longer reported — it now works', startNotes.length === 0, JSON.stringify(startNotes));

var constNotes = notes(v3({
  character_book: { entries: [{ keys: ['a'], content: 'x', constant: true }] }
}));
ok('"constant" lorebook entries are reported', /constant/.test(constNotes.join(' ')), JSON.stringify(constNotes));

var secNotes = notes(v3({
  character_book: { entries: [{ keys: ['a'], content: 'x', secondary_keys: ['b'], selective: true }] }
}));
ok('secondary keys / selective are reported', /secondary keys/.test(secNotes.join(' ')), JSON.stringify(secNotes));

var orderNotes = notes(v3({
  character_book: { entries: [{ keys: ['a'], content: 'x', insertion_order: 5 }] }
}));
ok('insertion_order is reported', /insertion_order/.test(orderNotes.join(' ')), JSON.stringify(orderNotes));

var sysNotes = notes(v3({ system_prompt: 'You are a narrator.' }));
ok('a card system prompt is reported', /system prompt/.test(sysNotes.join(' ')), JSON.stringify(sysNotes));

console.log('\nG — notes are per-issue, not noise');

var three = notes(v3({
  system_prompt: 'x',
  character_book: { entries: [{ keys: ['a'], content: 'c', constant: true, insertion_order: 1 }] }
}));
ok('independent problems each get their own line', three.length === 3, JSON.stringify(three));
ok('plural wording for several entries',
  /2 lorebook entries rely/.test(notes(v3({
    character_book: { entries: [{ constant: true }, { constant: true }] }
  })).join(' ')));

console.log('\nG — the sheet actually renders them');
var preview = src.slice(src.indexOf('App.previewImport = function'), src.indexOf('App.importMany = function'));
ok('the preview renders importNotes', /importNotes/.test(preview));
ok('…under a "Not carried over" heading', /Not carried over/.test(preview));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
