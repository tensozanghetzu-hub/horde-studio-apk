#!/usr/bin/env node
/* Compare the lore-driven prompt against the release before it.

   "Off means nothing changed" is the promise every card-feature switch makes, and it is
   not a promise a unit test can make on its own: a test written after the change can
   encode the new behaviour and still pass. This does the comparison instead — the shipped
   api.js at a git rev you name, and the one in the working tree, both asked for the same
   prompts, over a fixture book that exercises every field the release started reading.

   Usage, from the repo root:

     node tools/compare-lore-prompt-against-release.js            # against HEAD
     node tools/compare-lore-prompt-against-release.js a4541ef   # against a release

   What you want to see: every case where the switches are off says `same`, and the ones
   where a switch is on differ ONLY when the card asked for it. A `chain ask, no switch`
   row that differs is a card approving itself; a `switches off` row that differs is a
   feature that is not behind its switch at all.
*/
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var REV = process.argv[2] || 'HEAD';

function sandbox() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    document: { addEventListener: function () {} }, navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error('offline')); },
    Store: { settings: {} }
  };
  sb.window = sb; sb.global = sb;
  return sb;
}
function apiFrom(src, label) {
  var sb = sandbox();
  vm.runInNewContext(src, sb, { filename: label });
  return sb.API;
}
var PREV = cp.execSync('git show ' + REV + ':horde-studio-mobile/js/api.js', { cwd: ROOT, maxBuffer: 64e6 }).toString();
var OLD = apiFrom(PREV, REV + ':api.js');
var NEW = apiFrom(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/api.js'), 'utf8'), 'api.js');

/* A book that covers every shape the release can be asked to read: a plain key, a
   working pattern, an unusable one, an entry only reachable by chaining, an entry that
   links to it, and a constant entry whose key is broken. */
var BOOK = [
  { id: 'plain', keys: ['lamp'], content: 'The lamp is the town job.' },
  { id: 'pat', keys: ["\\bVlad(?:'s)?\\b"], content: 'Vlad keeps the lamp.', useRegex: true },
  { id: 'broken', keys: ['[unclosed'], content: 'Never in.', useRegex: true },
  { id: 'keeper', keys: ['keeper'], content: 'The harbourmaster owes nine.' },
  { id: 'link', keys: ['lamp'], content: 'Under the lamp, the keeper waits.' },
  { id: 'always', keys: ['[nope'], content: 'Always present.', constant: true, useRegex: true }
];
function char(book, asks) {
  return {
    id: 'c1', name: 'Keeper', persona: 'p', systemPrompt: '', examples: [], lorebook: book,
    cardSource: asks ? { book: { recursive_scanning: true, recursion_depth: 9 } } : {}
  };
}
function history(n) {
  var h = [];
  for (var i = 0; i < n; i++) {
    h.push({ id: 'u' + i, role: 'user', text: 'turn ' + i + ': the lamp, the keeper, Vlad and the fog at the harbour' });
    h.push({ id: 'a' + i, role: 'assistant', text: 'she nods' });
  }
  return h;
}

var SWITCHES = [
  ['switches off', {}],
  ['regex on', { honorCardRegex: true }],
  ['chain ask, no switch', { honorCardRecursion: true }],
  ['both on', { honorCardRegex: true, honorCardRecursion: true }]
];
var rows = [];
[true, false].forEach(function (asks) {
  [['with regex entries', BOOK], ['no lorebook', []]].forEach(function (book) {
    SWITCHES.forEach(function (sw) {
      [4, 40].forEach(function (n) {
        ['buildChat', 'buildPrompt'].forEach(function (fn) {
          var base = Object.assign({ userName: 'You', systemPrompt: 'x', maxTokens: 300, contextMessages: 20 }, sw[1]);
          var a = JSON.stringify(OLD[fn](char(book[1], asks), { id: 's' }, history(n), base));
          var b = JSON.stringify(NEW[fn](char(book[1], asks), { id: 's' }, history(n), base));
          rows.push({ ask: asks ? 'card asks' : 'card quiet', book: book[0], sw: sw[0], n: n, fn: fn, same: a === b });
        });
      });
    });
  });
});

var off = rows.filter(function (r) { return r.sw === 'switches off'; });
var on = rows.filter(function (r) { return r.sw !== 'switches off'; });
console.log(REV + ' vs the working tree — ' + rows.length + ' prompt cases\n');
console.log('  switches off: ' + off.filter(function (r) { return r.same; }).length + '/' + off.length +
  ' byte-identical' + (off.every(function (r) { return r.same; }) ? '   ✓ nothing the card wrote leaks through' : ''));
off.filter(function (r) { return !r.same; }).forEach(function (r) {
  console.log('    DIFFERS (should not): ' + r.ask + ' / ' + r.book + ' / ' + r.n + ' turns / ' + r.fn);
});
console.log('  a switch on:    ' + on.filter(function (r) { return !r.same; }).length + '/' + on.length + ' differ');
on.filter(function (r) { return !r.same; }).forEach(function (r) {
  console.log('    ' + r.sw + ', ' + r.ask + ', ' + r.book + ', ' + r.n + ' turns → ' + r.fn);
});
/* The two refusals that are not allowed to change anything. */
var wrong = on.filter(function (r) {
  return r.sw === 'chain ask, no switch' && !r.same;
}).length;
console.log('\n' + (wrong ? 'FAILED — ' + wrong + ' cases where a book asked for recursion and the ' +
  'player did not agree still changed the prompt' : 'ok — a card that asks without the switch changes nothing'));
process.exit(off.every(function (r) { return r.same; }) && !wrong ? 0 : 1);
