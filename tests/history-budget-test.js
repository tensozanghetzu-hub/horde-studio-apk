#!/usr/bin/env node
/* The history budget: visible, in tokens, and fitted to the model.
 *
 * A review of the app put two things first: expose `maxContextChars` (which was
 * a 26 000-character literal inside the prompt builder, outranking the
 * "Messages in context" slider and invisible in the UI), and give
 * `sceneCastPrompt` something to say beyond a roster.
 *
 * The number is not raised blindly here: the reviewer's "100k is free" holds
 * only for models with a 25.6k-token window. On OpenRouter's free routes many
 * windows are 8k–32k, and a prompt larger than the window is not more memory —
 * the provider truncates it and the character answers the start of the
 * conversation forever. So the budget is the user's number, capped by what the
 * model's window actually leaves.
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
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

function loadApi(store) {
  var mem = store || {};
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    setTimeout: function () { },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }
    },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' },
    fetch: function () { return Promise.reject(new Error('offline')); }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return { API: sb.API, mem: mem };
}

console.log('the budget exists and has a sane default');
var first = loadApi();
var API = first.API;
same('DEFAULT_HISTORY_TOKENS is exported', API.DEFAULT_HISTORY_TOKENS, 6000);
/* The old cap was 26 000 characters ~ 6 500 tokens. The default is not raised
   past that on purpose: on OpenRouter's free routes 8 192-token models are
   common, and the default has to fit one of those before any window is known.
   Page 8 192 - 6 000 - 600 reply - 512 margin > 0. */
ok('the default fits the smallest common free window',
  8192 - API.DEFAULT_HISTORY_TOKENS - 600 - 512 > 0,
  String(8192 - API.DEFAULT_HISTORY_TOKENS - 600 - 512) + ' tokens to spare');
ok('…and it is not smaller than what shipped before', API.DEFAULT_HISTORY_TOKENS * 4 >= 24000,
  (API.DEFAULT_HISTORY_TOKENS * 4) + ' chars');
same('an unset setting uses the default', API.historyBudgetTokens({}), 6000);
same("the user's number wins when nothing else is known",
  API.historyBudgetTokens({ historyTokens: 12000 }), 12000);

console.log('\na model window caps it, instead of being ignored');
/* the picker's catalogue is where this comes from — no extra request */
API.rememberModelWindows([
  { id: 'small/free:model', context_length: 8192 },
  { id: 'mid/free:model', context_length: 32768 },
  { id: 'big/model', context_length: 200000 },
  { id: 'no-window/model' }
]);
same('a known window is remembered', API.modelContextTokens('small/free:model'), 8192);
same('a model with no window is not invented', API.modelContextTokens('no-window/model'), 0);
same('an unknown model is 0', API.modelContextTokens('never/heard-of-it'), 0);

/* 8192 window, 2000-token sheet, 600-token reply, 512 margin -> 5080 room */
same('a small window shrinks the budget to what is left',
  API.historyBudgetTokens({ historyTokens: 32000, model: 'small/free:model' }, 2000, 600), 8192 - 2000 - 600 - 512);
same("a big window lets the user's number through",
  API.historyBudgetTokens({ historyTokens: 12000, model: 'big/model' }, 2000, 600), 12000);
same('a window bigger than the request changes nothing',
  API.historyBudgetTokens({ historyTokens: 6000, model: 'mid/free:model' }, 2000, 600), 6000);
same('a card that eats the whole window leaves a floor, not a negative',
  API.historyBudgetTokens({ historyTokens: 6000, model: 'small/free:model' }, 9000, 600), 1000);

console.log('\nthe window map survives a restart');
var second = loadApi(first.mem);
same('it is read back from storage', second.API.modelContextTokens('small/free:model'), 8192);
second.API.rememberModelWindows([{ id: 'another/model', context_window: 16000 }]);
same('a second fetch adds to it rather than replacing it',
  second.API.modelContextTokens('small/free:model'), 8192);
same('…and keeps the new one', second.API.modelContextTokens('another/model'), 16000);

console.log('\nthe transcript is trimmed by that budget, not by a literal');
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
ok('the 26 000-character literal is gone', !/maxContextChars/.test(apiSrc),
  'maxContextChars is still referenced');
ok('the budget is converted to characters at four to a token',
  /histBudget \* 4/.test(apiSrc));
ok('the trim floor is respected', /Math\.max\(2000, histBudget \* 4\)/.test(apiSrc));
ok('the model catalogue feeds the window map', /rememberModelWindows\(arr\)/.test(apiSrc));

console.log('\nthe setting is visible in the UI');
var viewsSrc = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
ok('Settings → Generation has a History budget row', /<label>History budget<\/label>/.test(viewsSrc));
ok('…with a slider', /id="set-hist"/.test(viewsSrc));
ok('…and a tappable exact value', /id="v-hist"/.test(viewsSrc));
ok('…that saves to historyTokens', /sc\.range\('#set-hist', '#v-hist', 'historyTokens'\)/.test(viewsSrc));
ok('the hint names the model window when it is known', /takes <b>/.test(viewsSrc));
ok('the hint says what happens when it is not known', /does not know this model/.test(viewsSrc));
ok('the messages-in-context hint still names the history budget as the ceiling that decides',
  /still decides the size/.test(viewsSrc));
ok('\u2026and no longer claims to be the lorebook keyword window',
  !/how far back the lorebook looks/.test(viewsSrc) &&
  /keyword scan is a separate, shorter window/.test(viewsSrc));
ok('\u2026naming where that depth is actually set', /set per character/.test(viewsSrc));

console.log('\nthe scene cast says how to use the cast');
var sb2 = loadApi();
var castSession = { sceneCast: ['Rose', 'Tom'], scenePresent: ['Rose'] };
var prompt = sb2.API.buildChat({ id: 'a', name: 'Rose', persona: 'p', greeting: 'g', examples: '', scenario: '' },
  castSession, [{ role: 'user', text: 'Hello.' }],
  { userName: 'Quinn', systemPrompt: 'x', maxTokens: 600, historyTokens: 6000 });
var system = prompt[0].content;
ok('the roster is still there', /Present in this scene: Rose, Quinn/.test(system));
ok('the prohibition is still there', /Elsewhere and out of the scene: Tom/.test(system));
ok('…and it still says they never speak', /never speak, react, act/.test(system));
ok('speech must be attributed by name', /name them in the prose/.test(system));
ok('it warns against round-robin turns', /do not give each of them a turn/.test(system));
ok('it forbids writing the player', /Never write Quinn.s words, thoughts or actions/.test(system));
ok('the cast block is still last-worded', /THIS OVERRIDES THE CARD/.test(system));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
