/* D3/C2 — the Lore screen really renders: the sheet size, the per-entry state
 * readout, and the Add-lore button. This drives Views.world with a minimal DOM
 * so a broken template (an undeclared variable, a lost button) fails here
 * instead of on a phone. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var root = path.join(__dirname, '..');

function el() {
  return {
    innerHTML: '', id: '', listeners: {},
    addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    closest: function () { return null; }
  };
}

var body = el(), loreList = el(), loreSummary = el(), memList = el();

var character = {
  id: 'c1', name: 'Rhea',
  persona: 'x'.repeat(2000), scenario: 'Rain.', greeting: 'Hi.', examples: '', postHistory: '',
  lorebook: [
    { id: 'l1', keys: ['dragon'], content: 'Dragons nest on the ridge.', enabled: true },
    { id: 'l2', keys: ['nothing'], content: 'Never mentioned.', enabled: true },
    { id: 'l3', keys: ['nothing'], content: 'Switched off.', enabled: false }
  ]
};

var session = { id: 's1', title: 'The ridge', updatedAt: 5, facts: [], continuity: { enabled: false } };

var ctx = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error,
  isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout,
  document: {
    querySelector: function (sel) {
      if (sel === '#world-body') return body;
      if (sel === '#lore-list') return loreList;
      if (sel === '#lore-summary') return loreSummary;
      if (sel === '#mem-list') return memList;
      return null;
    },
    querySelectorAll: function () { return []; },
    createElement: el,
    addEventListener: function () {}
  },
  UI: {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    md: function (s) { return String(s || ''); },
    icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
    toast: function () {}, sheet: function () { return Promise.resolve(null); }
  },
  Store: {
    settings: { userName: 'Tester', maxTokens: 600 },
    characters: [character],
    getSessions: function () { return Promise.resolve([session]); },
    getMessages: function () {
      return Promise.resolve([
        { role: 'user', text: 'We climbed toward the dragon.' },
        { role: 'assistant', text: 'The ridge was quiet.' }
      ]);
    }
  },
  App: { state: { worldChar: null, messages: [] }, editLore: function () {}, memorySheet: function () {} },
  API: {}
};
ctx.window = ctx;
ctx.global = ctx;

vm.runInNewContext(fs.readFileSync(path.join(root, 'horde-studio-mobile/js/api.js'), 'utf8'), ctx, { filename: 'api.js' });
ctx.Views = null;
vm.runInNewContext(fs.readFileSync(path.join(root, 'horde-studio-mobile/js/views.js'), 'utf8'), ctx, { filename: 'views.js' });

var Views = ctx.Views;

async function main() {
  assert(Views && typeof Views.world === 'function', 'views.js must expose Views.world');
  Views.world({});

  // The synchronous template must survive on its own.
  assert(/Character sheet · Rhea/.test(body.innerHTML), 'the sheet group renders');
  assert(/Lorebook · Rhea/.test(body.innerHTML), 'the lorebook group renders');
  assert(/data-act="lore-add"/.test(body.innerHTML), 'the Add lore entry button survives');
  assert(/Add lore entry/.test(body.innerHTML), '…with its label');
  assert(/About <b>\d+ tokens<\/b>/.test(body.innerHTML), 'the sheet token count is present');
  var sheetTokens = Number((body.innerHTML.match(/About <b>(\d+) tokens/) || [])[1]);
  assert(sheetTokens > 400, 'a 2000-char persona reports real tokens, got ' + sheetTokens);

  // Groups must be balanced, or the rest of the screen shifts under them.
  var opens = (body.innerHTML.match(/<div/g) || []).length;
  var closes = (body.innerHTML.match(/<\/div>/g) || []).length;
  assert.strictEqual(opens, closes, 'div tags balance: ' + opens + ' open, ' + closes + ' close');

  // Then the async readout fills in.
  await new Promise(function (r) { setTimeout(r, 30); });
  assert(/1 of 3/.test(loreSummary.innerHTML), 'summary counts admitted entries: ' + loreSummary.innerHTML);
  assert(/bytes used/.test(loreSummary.innerHTML), 'summary shows the byte budget');
  assert(/The ridge/.test(loreSummary.innerHTML), 'summary names the conversation it read');

  assert(/✓ matched/.test(loreList.innerHTML), 'the hit entry is ticked');
  assert(/✕ no keyword matched/.test(loreList.innerHTML), 'the miss is crossed with a reason');
  assert(/✕ disabled/.test(loreList.innerHTML), 'the disabled entry names itself');
  assert(/data-lore="0"/.test(loreList.innerHTML), 'rows stay clickable');

  // No messages yet: it must not claim entries are ignored without evidence.
  ctx.Store.getSessions = function () { return Promise.resolve([]); };
  Views.world({});
  await new Promise(function (r) { setTimeout(r, 20); });
  assert(/Open a conversation with Rhea/.test(loreSummary.innerHTML),
    'an empty character explains itself instead of guessing: ' + loreSummary.innerHTML);
  assert(!/✕/.test(loreList.innerHTML), 'no fake verdicts without a conversation');

  console.log('worldview-test: 18 ok');
}
main().catch(function (e) { console.error('worldview-test FAILED\n' + (e && e.stack || e)); process.exit(1); });
