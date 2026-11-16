#!/usr/bin/env node
/* Why a reply came back as pure OOC on turn 1 of a fresh chat.
 *
 * Reproduced from a screenshot: the greeting shows the family arriving (car in
 * the driveway, everyone outside), the player's line matches that opening, and
 * the model answered only:
 *
 *   OOC: This appears to be a scene reset or alternate opening. The previous
 *   scene had boxes already inside, Mara in the doorway, and established
 *   tension. This version has everyone still outside with the car just
 *   arriving. Which version would you like to continue?
 *
 * Two causes, both the app's:
 *
 * 1. The card's `mes_example` shows a LATER scene (boxes inside, the wife in
 *    the doorway). `buildChat` pushed those examples as real turns BEFORE the
 *    history, so the model read them as the oldest part of this conversation:
 *    the story had already advanced and then restarted at its own opening.
 * 2. `OOC_RULE` was widened in v1.39.86 to "if you are unsure what they are
 *    asking, say so in that line" — an escape hatch offered with no invitation.
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

var mem = {};
var sb = {
  Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
  String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
  setTimeout: function () { },
  localStorage: { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } },
  location: { hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
sb.window = sb;
vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
var API = sb.API;

/* The reported card's shape: the greeting is the opening, the examples are a
   later scene. Nothing here depends on its names — only on the order. */
var char = {
  id: 'c1', name: 'Sloane',
  persona: 'Name: Sloane\nAge: 18\n\nName: Aston\nAge: 42',
  greeting: 'Episode 1 — The Unexpected Move-In\n\n*A car pulls into the driveway. Several moving boxes are piled beside them.*\n\nAston: "Well, look who we have here!"',
  scenario: '',
  examples: '{{user}}: *I set the last box down by the staircase.* "Take the guest room."\n' +
    '{{char}}: Aston: "You are a lifesaver, buddy." Your Wife: *She has not moved from the living room doorway.* "Three weeks is what you said."\n' +
    '<START>\n' +
    '{{user}}: "Give him a break."\n' +
    '{{char}}: Your Wife: "He would. That is not the point."'
};
var session = { sceneCast: ['Sloane', 'Aston', 'Mara'], scenePresent: ['Sloane', 'Aston', 'Mara'] };
var settings = { userName: 'Blu', systemPrompt: 'You are {{char}}.', maxTokens: 600 };
var history = [
  { role: 'assistant', text: char.greeting },
  { role: 'user', text: 'come in. Happy i can help.' }
];

console.log('the example dialogue is no longer sent as prior turns');
var chat = API.buildChat(char, session, history, settings);
var roles = chat.map(function (m) { return m.role; });
same('exactly one system message opens the request', roles[0], 'system');
same('the first non-system turn is the opening message, not an example',
  roles[1], 'assistant');
ok('…and it is the greeting',
  chat[1].content.indexOf('A car pulls into the driveway') !== -1, chat[1].content.slice(0, 80));
same('the player\'s line follows it', roles[2], 'user');
same('no example turn survives as history', roles.length, 3);

console.log('\n…but it is still there, and clearly labelled');
ok('the examples reach the model in the system block',
  chat[0].content.indexOf('You are a lifesaver, buddy') !== -1);
ok('the label says they are a sample', /Example dialogue — a sample of the intended voice/.test(chat[0].content));
ok('the label says they are not events that happened',
  /NOT events that have already happened/.test(chat[0].content));
ok('the label says the chat begins at the opening',
  /nothing in them overrides the opening message below where the chat actually begins/.test(chat[0].content));

console.log('\nan OOC answer is only for an OOC question');
var system = chat[0].content;
ok('the rule still answers a real OOC note', /if, and only if, Blu writes an OOC note/.test(system));
ok('…still asking for a plain "OOC:" line', /begins with "OOC:"/.test(system));
ok('the rule now forbids unsolicited OOC', /Otherwise write the scene and never speak out of character/.test(system));
ok('…specifically opening a reply with it', /do not open a reply with "OOC:"/.test(system));
ok('…and asking which version to continue',
  /do not ask the player which version of events to continue/.test(system));
ok('…and commenting on the examples', /do not comment on the prompt, the examples/.test(system));
ok('it says which version of events is true',
  /treat the opening message and the most recent turns as the truth/.test(system));

console.log('\nthe continuation format gets the same framing');
var prompt = API.buildPrompt(char, session, history, settings);
ok('the examples are labelled there too', /Example dialogue — a sample of the intended voice/.test(prompt));
ok('…with the same "not events" wording', /These are NOT events that have already happened/.test(prompt));
ok('…and the chat history still follows', /Chat history:/.test(prompt));
ok('the opening message is inside the chat history',
  prompt.indexOf('A car pulls into the driveway') > prompt.indexOf('Chat history:'));

console.log('\nno card names in the shipped rule text');
var ruleStart = system.indexOf('Out of character:');
var ruleBlock = system.slice(ruleStart, system.indexOf('\n\n', ruleStart));
['Aston', 'Mara'].forEach(function (n) {
  ok('the rule does not name ' + n, ruleBlock.indexOf(n) === -1);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
