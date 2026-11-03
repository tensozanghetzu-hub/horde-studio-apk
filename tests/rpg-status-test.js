/* Per-session RPG status ledger prompt, hidden proposal protocol, and chat UI. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function loadApi() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    isNaN, parseInt, parseFloat, TextEncoder
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'horde-studio-mobile/js/api.js'), 'utf8'), sandbox);
  return sandbox.API;
}

const API = loadApi();
assert.strictEqual(API.rpgStatusPrompt({}), '');
const status = {
  enabled: true, level: '3', xp: 45, xpToNext: 100,
  attributes: { Strength: '8' }, skills: ['Swordsmanship'],
  inventory: ['Iron sword'], notes: ['Find the old map'], suggestionsEnabled: true
};
const prompt = API.rpgStatusPrompt({ groupCharIds: ['a', 'b'], rpgStatus: status });
assert(prompt.includes('Level: 3') && prompt.includes('XP: 45'));
assert(prompt.includes('shared by this conversation (including a group chat)'));
assert(prompt.toLowerCase().includes('do not invent rewards'));
assert(prompt.includes('<rpg_update>'));
const noSuggestions = API.rpgStatusPrompt({ rpgStatus: Object.assign({}, status, { suggestionsEnabled: false }) });
assert(noSuggestions.includes('Status suggestions are disabled'));
assert(!noSuggestions.includes('append one machine-readable proposal'));

const reply = 'The goblin drops its coin pouch.\n<rpg_update>{"reason":"The player defeated the guard.","changes":[{"field":"xp","op":"add","value":15},{"field":"inventory","op":"add","value":"Copper key"},{"field":"attributes","op":"set","key":"Strength","value":9}]}</rpg_update>';
const parsed = API.parseRpgUpdate(reply);
assert.strictEqual(parsed.changes.length, 3);
assert.strictEqual(parsed.changes[0].value, 15);
assert.strictEqual(parsed.changes[1].value, 'Copper key');
assert.strictEqual(parsed.changes[2].key, 'Strength');
assert.strictEqual(API.stripRpgUpdate(reply), 'The goblin drops its coin pouch.');
assert.strictEqual(API.hideRpgUpdate('story text\n<rpg_update>{"reason":"'), 'story text');
assert.strictEqual(API.parseRpgUpdate('No update needed.'), null);
assert.strictEqual(API.parseRpgUpdate('<rpg_update>{bad}</rpg_update>'), null);
assert.strictEqual(API.parseRpgUpdate('<rpg_update>{"changes":[{"field":"xp","op":"set","value":-1}]}</rpg_update>'), null);
assert.strictEqual(API.parseRpgUpdate('<rpg_update>{"changes":[{"field":"admin","op":"set","value":"x"}]}</rpg_update>'), null);

const character = { name: 'Mira', persona: '', scenario: '', examples: '', lorebook: [], postHistory: '', systemPrompt: '' };
const settings = { systemPrompt: 'Stay in character.', userName: 'Player', contextMessages: 40, maxContextChars: 26000 };
const session = { summary: '', facts: [], chatLorebook: [], rpgStatus: status };
const messages = [{ role: 'user', text: 'I defeat the guard.' }];
assert(API.buildChat(character, session, messages, settings).some(m => m.role === 'system' && m.content.includes('PLAYER RPG STATUS')));
assert(API.buildPrompt(character, session, messages, settings).includes('PLAYER RPG STATUS'));

const views = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
  isNaN, parseFloat, parseInt, fetch: () => Promise.resolve({ ok: false }),
  UI: { esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), md: s => String(s || ''), icon: n => '<svg data-icon="' + n + '"></svg>' },
  Store: { settings: { userName: 'Player' } }, document: { querySelector: () => null, querySelectorAll: () => [] }
};
views.window = views;
vm.runInNewContext(fs.readFileSync(path.join(root, 'horde-studio-mobile/js/views.js'), 'utf8'), views);
const html = views.Views.messageHtml({ id: 'm1', role: 'assistant', text: 'The goblin drops the pouch.', rpgStatusProposal: { state: 'pending' } }, { id: 'c1', name: 'Mira' }, views.Store.settings);
assert(html.includes('data-act="rpg-review"') && html.includes('Review status update'));
const dismissed = views.Views.messageHtml({ id: 'm2', role: 'assistant', text: 'Done.', rpgStatusProposal: { state: 'applied' } }, { id: 'c1', name: 'Mira' }, views.Store.settings);
assert(!dismissed.includes('data-act="rpg-review"'));

const app = fs.readFileSync(path.join(root, 'horde-studio-mobile/js/app.js'), 'utf8');
const helperStart = app.indexOf('  App.rpgStatusDefaults = function () {');
const helperEnd = app.indexOf('  App.reviewRpgStatusProposal = function (message) {', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
const appHelpers = { App: {} };
vm.runInNewContext(app.slice(helperStart, helperEnd) + '\nglobalThis.testApplyRpg = applyRpgProposal;', appHelpers);
const applied = appHelpers.testApplyRpg(status, parsed);
assert.strictEqual(applied.xp, 60);
assert.strictEqual(applied.level, '3');
assert(applied.inventory.includes('Copper key'));
assert.strictEqual(applied.attributes.Strength, '9');
assert(app.includes("App.rpgStatusSheet = function (sessionId)"));
assert(app.includes("App.reviewRpgStatusProposal = function (message)"));
assert(app.includes("act === 'rpg-review'"));
assert(app.includes("a === 'rpg-status'"));
assert(app.includes('API.parseRpgUpdate(text)'));
assert(app.includes('session.rpgStatus.suggestionsEnabled !== false'));
console.log('rpg-status-test: per-chat prompt, validated proposals, hidden blocks, confirmation UI, and shared-group routing pass');
