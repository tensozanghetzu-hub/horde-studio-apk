/* Standalone lorebook-file import: native and SillyTavern JSON shapes. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(label, condition, extra) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); }
}
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
  Horde: { generateText: function () { return Promise.resolve({ text: '' }); },
    listTextModels: function () { return Promise.resolve([]); }, health: function () { return Promise.resolve({}); }, whoami: function () { return null; } },
  fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sandbox, { filename: 'api.js' });
var API = sandbox.API;
function parse(text) { return typeof API.parseLorebookFile === 'function' ? API.parseLorebookFile(text) : []; }

var nativeBook = parse(JSON.stringify({
  name: 'Campus', entries: [
    { keys: ['library', 'restricted section'], content: 'The north wing closes at midnight.', enabled: true },
    { keys: ['headmistress'], content: 'She keeps the old school register.', enabled: false }
  ]
}));
ok('native lorebook JSON entries import with keys, content, and enabled state',
  nativeBook.length === 2 && nativeBook[0].keys.length === 2 &&
  /midnight/.test(nativeBook[0].content) && nativeBook[1].enabled === false);

var sillyBook = parse(JSON.stringify({ entries: {
  '0': { key: ['Hogsmeade', 'Three Broomsticks'], content: 'The landlord knows every student.', disable: false },
  '1': { key: 'owlery', content: 'The owls return before dawn.', disable: true }
} }));
ok('SillyTavern object-map entries and key/disable fields normalize',
  sillyBook.length === 2 && sillyBook[0].keys[1] === 'Three Broomsticks' &&
  sillyBook[0].enabled === true && sillyBook[1].keys[0] === 'owlery' && sillyBook[1].enabled === false);

var cardBook = parse(JSON.stringify({
  spec: 'chara_card_v2', data: { character_book: { entries: [
    { keys: ['greenhouse'], content: 'A glasshouse sits behind the west tower.', enabled: true }
  ] } }
}));
ok('character-card JSON imports its embedded character_book only',
  cardBook.length === 1 && cardBook[0].keys[0] === 'greenhouse');

ok('malformed or unrelated JSON safely returns an empty list',
  parse('{oops').length === 0 && parse('{"name":"No entries"}').length === 0);
ok('import parser has a bounded entry count',
  parse(JSON.stringify({ entries: Array.from({ length: 250 }, function (_, i) {
    return { keys: ['k' + i], content: 'Fact ' + i };
  }) })).length === 200);

var views = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
var editor = views.slice(views.indexOf('Character lorebook'), views.indexOf('Overrides (optional)'));
ok('character editor exposes a lorebook file-import control',
  /data-act="lore-import-file"/.test(editor) && /Import file/.test(editor));
var importHandlerStart = views.indexOf("on(body, '[data-act=lore-import-file]'");
var importHandlerEnd = views.indexOf("on(body, '[data-act=lore-ai-draft]'", importHandlerStart);
var importHandler = importHandlerStart < 0 ? '' : views.slice(importHandlerStart, importHandlerEnd);
ok('the file picker accepts JSON and appends parsed lore without autosaving',
  /data-act=lore-import-file[\s\S]{0,900}pickFile\('\.json,application\/json'\)/.test(views) &&
  /API\.parseLorebookFile/.test(importHandler) && /draft\.lorebook\.push/.test(importHandler) &&
  !/Store\.putCharacter/.test(importHandler));

console.log('\nlorebook-file-import-test: ' + (fail ? fail + ' failed, ' : '') + pass + ' ok');
process.exit(fail ? 1 : 0);
