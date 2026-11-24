#!/usr/bin/env node
/* v1.44.0 — the card's own account of itself, read for display and nothing else.
 *
 * Character Card V3 added `creation_date`, `modification_date` and
 * `creator_notes` (with `creator_notes_multilingual`) for exactly the question
 * this app could not answer: which copy of this card did I import, and what did
 * the author say about it? The fields were already surviving import — inside
 * `cardSource`, preserved and never read — so this is not a round-trip fix. It
 * is the difference between keeping a field and showing it.
 *
 * Pinned here:
 * 1. the shape of each field, including the two the spec calls out: `0` means
 *    "unknown on purpose", and the unit is seconds
 * 2. the note-language rule, in the order the spec writes it
 * 3. a value that is not what the spec allows is named, not discarded
 * 4. reading it changes nothing: the card still exports complete, and none of it
 *    reaches the fields a prompt is built from
 * 5. the screen escapes it, because it is text from a file someone downloaded
 *
 * Synthetic cards only, per the repo rule.
 *
 *   node /home/user/tests/card-file-notes-test.js
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

var captured = null;
var uidN = 0;
var base = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error,
  setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
  localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
  document: { addEventListener: function () { }, getElementById: function () { return null; },
    querySelector: function () { return null; }, createElement: function () { return { style: {}, setAttribute: function () { }, appendChild: function () { } }; },
    body: { appendChild: function () { } } },
  location: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); },
  IDB: {
    getAll: function () { return Promise.resolve([]); },
    get: function () { return Promise.resolve(null); },
    put: function () { return Promise.resolve(); },
    del: function () { return Promise.resolve(); }
  },
  UI: {
    uid: function (p) { return p + (++uidN); },
    esc: function (v) {
      return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    icon: function () { return ''; },
    toast: function (m) { toast = m; },
    sheet: function (opts) { captured = opts; return Promise.resolve(null); },
    confirm: function () { return Promise.resolve(false); },
    input: function () { return Promise.resolve(null); }
  }
};
var toast = '';
function load(extra) {
  var sb = Object.assign({}, base);
  if (extra) Object.keys(extra).forEach(function (k) { sb[k] = extra[k]; });
  sb.window = sb; sb.global = sb;
  return sb;
}
var sbStore = load({});
vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sbStore, { filename: 'store.js' });
var Store = sbStore.Store;

/** V3 shape, as a file would carry it. Only the fields under test are set. */
function card(data) {
  return {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: Object.assign({
      name: 'Wren', description: 'A keeper of small boats.', personality: '', scenario: '',
      greeting: 'You are late.', example_dialogs: [], creator_notes: '', system_prompt: '',
      post_history_instructions: '', alternate_greetings: [], tags: [], creator: '',
      character_version: '1', extensions: {}
    }, data || {})
  };
}
function charFor(data) { return Store.cardToCharacter(card(data)); }
function declared(data) { return Store.cardDeclared(charFor(data)); }
var SEC = 1700000000;
var asString = function (n) { return new Date(n * 1000).toLocaleString(); };

console.log('\nnothing declared, nothing claimed');
same('a plain card has no file notes to show', declared(), null);
same('…and empty strings do not count as a note', declared({ creator_notes: '   ', creation_date: null }), null);

console.log('\nthe dates, in the unit the spec names');
var d1 = declared({ creation_date: SEC, modification_date: SEC + 86400 });
ok('creation_date is read', !!d1 && d1.created.length > 0, JSON.stringify(d1 && d1.created));
same('…as seconds, not milliseconds', d1.created, asString(SEC));
same('…and so is modification_date', d1.modified, asString(SEC + 86400));
same('a zero is the author saying "unknown", not 1970',
  declared({ creation_date: 0 }).created, 'unknown (left that way on purpose)');
var ms = declared({ creation_date: SEC * 1000 });
same('a millisecond stamp is still read as the same day', ms.created, asString(SEC));
ok('…and it is reported as a spec break, not quietly fixed', /milliseconds/.test(ms.odd.join(' ')), JSON.stringify(ms.odd));
same('a numeric string is read', declared({ creation_date: String(SEC) }).created, asString(SEC));
var junk = declared({ creation_date: 'last tuesday' });
same('…a non-number is not', junk.created, '');
ok('…and it is named rather than swallowed', /creation_date is not a number/.test(junk.odd.join(' ')), JSON.stringify(junk.odd));

console.log('\nthe note, in the language order the spec writes');
same('a lone creator_notes is the note', declared({ creator_notes: 'Needs an 8k window.' }).notes, 'Needs an 8k window.');
var withEn = declared({ creator_notes: 'English one', creator_notes_multilingual: { en: 'Translated English', de: 'Deutsch' } });
same('…the English copy wins when the translations carry one', withEn.notes, 'Translated English');
same('…and the screen says which field it came from', withEn.noteFrom, 'the English copy');
var noEn = declared({ creator_notes: 'English one', creator_notes_multilingual: { de: 'Deutsch', fr: 'Francais' } });
same('…with no English copy, the plain field IS the English note', noEn.notes, 'English one');
ok('…and the other languages are listed, not dropped', /de, fr/.test(noEn.noteLanguages.join(', ')), JSON.stringify(noEn.noteLanguages));
ok('…naming the rule that made the choice', /spec reads as English/.test(noEn.noteFrom), noEn.noteFrom);
same('an empty translations object leaves the plain note alone',
  declared({ creator_notes: 'English one', creator_notes_multilingual: {} }).notes, 'English one');
same('a 900-character note is shown as 700', declared({ creator_notes: new Array(901).join('n') }).notes.length, 700);
var weird = String.fromCharCode(97, 0, 98, 10, 99, 127, 100);      /* a NUL b LF c DEL d */
same('control characters and line breaks become one line of prose',
  declared({ creator_notes: weird }).notes, 'a b c d');

console.log('\nreading it changes nothing');
var c = charFor({ creation_date: SEC, creator_notes: 'Do not use with small windows.' });
var round = Store.characterToCard(c);
same('the date rides back out unchanged', round.data.creation_date, SEC);
same('…and so does the note', round.data.creator_notes, 'Do not use with small windows.');
var sheetFields = [c.persona, c.descText, c.scenario, c.greeting, c.examples, c.postHistory].join('\n');
ok('none of it becomes prompt text', sheetFields.indexOf('Do not use with small windows.') === -1, sheetFields.slice(0, 120));

console.log('\nthe screen escapes what the file said');
var appSb = load({
  Store: {
    settings: {},
    cardDeclared: function () {
      return { created: 'yesterday', modified: '', notes: '<img src=x onerror=alert(1)>', noteLanguages: ['de'], odd: ['creation_date is not a number'] };
    }
  },
  API: { buildChat: function () { return []; } }
});
vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), appSb, { filename: 'app.js' });
appSb.App.cardFileNotes({ name: 'Wren' });
ok('a tag in a note stays text', captured && captured.body.indexOf('<img') === -1 && captured.body.indexOf('&lt;img') !== -1,
  captured && captured.body.slice(0, 240));
ok('the heading says whose claim it is', captured && /says about itself/.test(captured.body));
ok('a spec break is shown, not hidden', captured && /Not as the spec writes it/.test(captured.body));
ok('the unread languages are mentioned', captured && /as well/.test(captured.body));
appSb.Store.cardDeclared = function () { return null; };
toast = '';
appSb.App.cardFileNotes({ name: 'Wren' });
ok('a card with nothing declared says so rather than opening an empty sheet',
  /no date or author note/.test(toast), toast);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
