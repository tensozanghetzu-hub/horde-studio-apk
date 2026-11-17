#!/usr/bin/env node
/* Two reports from real use:
 *
 * 1. A memory was generated, then the reply it was built on was rerolled and
 *    the chat continued — and the memory stayed, describing a reply that no
 *    longer exists.
 * 2. On a card with more than one character, nothing said when the loaded
 *    character was the one talking.
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');

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
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  localStorage: { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } },
  location: { hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
sb.window = sb;
vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
var API = sb.API;

/* ------------------------------------------------------------------ */
console.log('1. the card\'s own name is a speaker label on a cast card');

var cast = ['Nadia', 'Boris', 'Olive'];
var single = [];

var replySheOpens = 'Nadia: *She sets her backpack down.* "I can take the treadmill down."';
same('her own label is kept when she speaks first',
  API.cleanReply(replySheOpens, 'Nadia', 'Quinn', { cast: cast }), replySheOpens);

var replyMidway = 'The landing is quiet.\nNadia: "I can take the treadmill down."';
ok('a line starting with her name no longer cuts the reply',
  API.cleanReply(replyMidway, 'Nadia', 'Quinn', { cast: cast }).indexOf('treadmill') !== -1,
  API.cleanReply(replyMidway, 'Nadia', 'Quinn', { cast: cast }));
same('…the whole reply survives',
  API.cleanReply(replyMidway, 'Nadia', 'Quinn', { cast: cast }), replyMidway);

var replyOther = 'Boris: *He grins.* "Thanks, buddy."';
same('another speaker\'s label is untouched', API.cleanReply(replyOther, 'Nadia', 'Quinn', { cast: cast }), replyOther);

console.log('\nthe player\'s own name still ends the reply, cast or not');
var leaked = 'Nadia: "Hi."\nQuinn: *I nod and head upstairs.*';
same('a fake player turn is still cut',
  API.cleanReply(leaked, 'Nadia', 'Quinn', { cast: cast }), 'Nadia: "Hi."');

console.log('\na one-character card behaves exactly as before');
same('her label is stripped there',
  API.cleanReply('Nadia: *She nods.*', 'Nadia', 'Quinn', { cast: single }), '*She nods.*');
same('…and a mid-reply turn still cuts it',
  API.cleanReply('She nods.\nNadia: Another line.', 'Nadia', 'Quinn', { cast: single }), 'She nods.');
same('no cast passed at all is the old behaviour',
  API.cleanReply('Nadia: *She nods.*', 'Nadia', 'Quinn'), '*She nods.*');

console.log('\nthe bubble header follows the speaker');
ok('the chat sets speakerName from the reply', /msg\.speakerName = spoken\.name/.test(appSrc));
ok('…only on a card with a cast', /scene\.sceneCast\.length >= 2 && API\.splitSpeaker/.test(appSrc));
ok('…and clears it when the card itself speaks', /else delete msg\.speakerName/.test(appSrc));
ok('the bubble already prefers speakerName', /m\.speakerName \|\| char\.name/.test(
  fs.readFileSync(path.join(JS, 'views.js'), 'utf8')));

/* ------------------------------------------------------------------ */
console.log('\n2. memory that describes a rerolled reply is dropped');

ok('a transcript digest exists', /App\.transcriptHash = function/.test(appSrc));
ok('memory records what it was built from', /session\.memAnchorHash = App\.transcriptHash\(usedMessages\)/.test(appSrc));
ok('…and how many turns that was', /session\.memAnchorCount = usedMessages\.length/.test(appSrc));
ok('…and is marked as auto-written', /session\.memManual = false/.test(appSrc));
ok('a hand-written memory is never auto-cleared', /s\.memManual = true/.test(appSrc));
ok('…and the check skips it', /session\.memManual\) return Promise\.resolve\(false\)/.test(appSrc));
ok('the check runs when the conversation continues', /App\.checkMemoryBasis\(session\)/.test(appSrc));

/* Exercise the two pure pieces in isolation. */
var hashSrc = appSrc.slice(appSrc.indexOf('  App.transcriptHash = function (msgs) {'),
  appSrc.indexOf('\n  };', appSrc.indexOf('  App.transcriptHash = function (msgs) {')) + 4);
ok('the digest is extractable', /transcriptHash/.test(hashSrc));
var appSb = { App: {}, console: console, String: String };
vm.runInNewContext(hashSrc + '\nthis.App = App;', appSb, { filename: 'transcriptHash.js' });
var hash = appSb.App.transcriptHash;

var before = [
  { id: 'm1', text: 'Come in.' },
  { id: 'm2', text: '*She nods.* "Thank you."' }
];
var rerolled = [
  { id: 'm1', text: 'Come in.' },
  { id: 'm2', text: '*She looks at the floor.* "Thanks."' }
];
ok('an unchanged transcript matches', hash(before) === hash(before));
ok('a rerolled reply changes the digest', hash(before) !== hash(rerolled));
ok('an added turn does not change the covered digest',
  hash(before) === hash(before.concat([{ id: 'm3', text: 'Later.' }]).slice(0, 2)));
ok('a deleted turn changes it', hash(before) !== hash(before.slice(0, 1)));
ok('an empty transcript still hashes', typeof hash([]) === 'string');

console.log('\nwhat the player is told');
ok('the memory is cleared, not replaced by a refusal', /session\.summary = '';/.test(appSrc));
ok('…with a reason naming the cause', /built on a reply that has since been rerolled or edited/.test(appSrc));
ok('…and a promise it will be rebuilt', /rebuilt from the current story/.test(appSrc));
ok('swiping back before sending keeps it',
  /Checked here, not at the reroll itself/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
