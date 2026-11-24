/* v1.46.0 the recap reads what the chat was shown: API.summarize and requestWindow, one window.
 *
 * v1.44.0 gave "Messages in context" back its meaning for the live request and left
 * the memory pass reading its own last 40. So a player who set the slider to 8 had a
 * model that had seen 8 messages and a summary written over 40 — and the memory sheet
 * quoted the summary's number, which made the disagreement invisible. The finding this
 * file pins is boring and total: the two windows are now the same window, with a floor
 * so a small setting cannot reduce a recap to one beat, and an explicit override so a
 * caller that wants a short recap still gets one.
 *
 * Generic: synthetic transcripts, no cards, no network (fetch is stubbed and captured).
 *
 *   node /home/user/tests/recap-window-test.js
 */
'use strict';

var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
var pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

var REPLY = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ summary: 'They are at the pier.', facts: ['The boat is named Sorrow'], changed: [] }) } }]
});

/* one sandbox per run: the recap path keeps no state between calls, and a shared
   one would let a stray cache make a later case pass for the wrong reason */
function run(history, settings, o) {
  var calls = [];
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: function () {},
    document: { addEventListener: function () {} },
    navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function (url, opt) {
      calls.push(JSON.parse(opt.body));
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return 'application/json'; } },
        json: function () { return Promise.resolve(JSON.parse(REPLY)); },
        text: function () { return Promise.resolve(REPLY); }
      });
    }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
  var settings2 = Object.assign({
    provider: 'openrouter', apiKey: 'k', baseUrl: 'https://api.openrouter.ai/v1',
    model: 'test/model', userName: 'Quinn', systemPrompt: 'x', maxTokens: 300,
    contextMessages: 40
  }, settings || {});
  return sb.API.summarize(Object.assign({
    settings: settings2,
    character: { id: 'c1', name: 'Nadia' },
    session: { id: 's1', charId: 'c1', summary: '', facts: [] },
    history: history
  }, o || {})).then(function (mem) { return { mem: mem, calls: calls }; });
}

function transcript(lines, n) {
  var out = [];
  for (var i = 0; i < (n || lines); i++) {
    out.push({ id: 'u' + i, role: 'user', text: 'line ' + i + ' from Quinn — ' + (typeof lines === 'string' ? lines : 'the tide and the lamp') });
    out.push({ id: 'a' + i, role: 'assistant', text: 'line ' + i + ' from the keeper' });
  }
  return out;
}

(async function () {
  console.log('\nA — the window is shared, not copied');

  var hist = transcript('x', 80);          /* 160 messages, oldest first */
  eq('the history has 160 messages to choose from', hist.length, 160);

  var small = await run(hist, { contextMessages: 8 });
  ok('a chat set to 8 messages gets a recap of at least that, and not forty',
    small.mem.sentMessages >= 8 && small.mem.sentMessages <= 16, small.mem.sentMessages);
  eq('…and the sheet is told how big the history really was', small.mem.availableMessages, 160);

  var tiny = await run(hist, { contextMessages: 2 });
  ok('the floor keeps a recap longer than one beat even at the smallest setting',
    tiny.mem.sentMessages >= 12, tiny.mem.sentMessages);

  var wide = await run(hist.slice(0, 30), { contextMessages: 120 });
  eq('a setting above the history size sends all of it', wide.mem.sentMessages, 30);
  var unset = await run(hist.slice(0, 50), { contextMessages: 0 });
  eq('an unset slider is the same ceiling the live request reads — forty, not everything',
    unset.mem.sentMessages, 40);
  var capped = await run(hist, { contextMessages: 40 });
  var opened = (capped.calls[0].messages[1].content.split('\n')[1] || '');
  ok('at the default the recap is turn-aligned, so it opens on the player’s line',
    /^Quinn: line \d+ from/.test(opened), opened.slice(0, 60));
  var ansFirst = (await run(hist, { contextMessages: 40 })).calls[0].messages[1].content.split('\n')[1] || '';
  ok('…and never on an answer whose question was left out',
    !/^Keeper:|^Nadia:/.test(ansFirst), ansFirst.slice(0, 40));

  console.log('\nB — the transcript on the wire');

  var userTurn = capped.calls[0].messages[1].content;
  ok('the recap still rides in the user turn, after the instruction',
    /^Transcript:\n/.test(userTurn) && /Return the JSON now\.$/.test(userTurn.trim()),
    userTurn.slice(-60));
  ok('…and the system turn carries the job, not the story',
    /memory manager for a roleplay/.test(capped.calls[0].messages[0].content) &&
    capped.calls[0].messages[0].content.indexOf('line 79 from') === -1,
    capped.calls[0].messages[0].content.slice(0, 80));
  var firstSent = userTurn.split('\n')[1] || '';
  ok('the oldest line sent is inside the window, not the start of the chat',
    !/^Quinn: line 0 /.test(firstSent) && /line ([3-9]\d|1[0-5]\d) from/.test(firstSent), firstSent);
  var lastSent = userTurn.trim().split('\n').slice(-2)[0];
  ok('…and the newest line is the last thing that happened',
    /line 79 /.test(userTurn), lastSent.slice(0, 60));

  console.log('\nC — the byte cap still bites, and says so');

  var long = [];
  for (var i = 0; i < 60; i++) {
    long.push({ id: 'L' + i, role: 'user', text: 'q' + i + ' ' + 'water '.repeat(700) });
    long.push({ id: 'R' + i, role: 'assistant', text: 'a' + i + ' ' + 'lamp '.repeat(700) });
  }
  var big = await run(long, { contextMessages: 40 });
  ok('a transcript over the budget is cut down rather than rejected',
    big.mem.sentMessages < 12 && big.mem.sentMessages >= 3, big.mem.sentMessages);
  var wire = big.calls[0].messages[1].content;
  ok('…keeping the NEWEST half each time, so the recap ends where the chat does',
    /q59 /.test(wire) && !/q0 /.test(wire), (wire.split('\n')[1] || '').slice(0, 40) + ' … ' +
    (wire.trim().split('\n').slice(-2)[0] || '').slice(0, 40));
  var bytes = JSON.stringify(big.calls[0].messages).length;
  ok('…and the request stays a request', bytes < 60000, bytes);

  console.log('\nD — an explicit ask still wins');

  var short = await run(hist, { contextMessages: 40 }, { maxMessages: 4 });
  eq('maxMessages: 4 recaps four messages', short.mem.sentMessages, 4);
  ok('…and does so at the newest end', /line 79 /.test(short.calls[0].messages[1].content));

  console.log('\nE — the code says it once, in one place');

  ok('summarize no longer carries a private default of forty',
    !/var maxMessages = o\.maxMessages \|\| 40/.test(apiSrc), 'gone');
  eq('requestWindow has one definition and every caller reads it',
    (apiSrc.match(/function requestWindow/g) || []).length, 1);
  ok('…including the recap', /requestWindow\(history, s\)\.messages/.test(apiSrc));
  ok('a caller with no history at all recaps nothing rather than crashing',
    /history\.length > 0|pool\.length/.test(apiSrc));
  var empty = await run([], {});
  eq('…and reports zero', empty.mem.sentMessages, 0);

  console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
