/* continuefix-test — v1.39.17: a cut reply must END like a sentence, and
 * Continue must actually continue.
 *
 * Reported live: a reply stopped mid-contraction ("…each other, don'") and
 * pressing Continue appended a whole new beat after a paragraph break
 * instead of finishing the sentence. Two bugs:
 *
 *   1. looksTruncated() whitelisted ' and ’ as "real punctuation" — so a
 *      reply cut mid-contraction (don') looked COMPLETE and the auto-finish
 *      rounds never fired.
 *   2. The manual Continue button generated a fresh next turn and glued it
 *      with \n\n. Now generate() accepts { continueFrom: text }: the seeded
 *      partial rides as the assistant prefix (chat) / appended to the
 *      prompt (horde), the seam joins tight across a split word ("don'" +
 *      "t you…" → "don't you…"), and nothing is duplicated in context.
 *
 *   node /home/user/tests/continuefix-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'api.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function loadApi() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'api.js' });
  return sb;
}

var SETTINGS = {
  provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'sk-test',
  model: 'm', streaming: true, temperature: 0.8, topP: 0.95, maxTokens: 100,
  systemPrompt: '', userName: 'Tester'
};
var CHAR = { name: 'Draconica', persona: 'Proud Slytherin.' };

function sseBody(chunks) {
  var i = 0;
  return { getReader: function () {
    return {
      read: function () {
        if (i < chunks.length) {
          return Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) });
        }
        return Promise.resolve({ done: true, value: undefined });
      },
      cancel: function () { return Promise.resolve(); }
    };
  } };
}
function sseText(text) {
  return 'data: {"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}\n\ndata: [DONE]\n\n';
}

console.log('A — a mid-contraction cut reads as truncated');
var sb = loadApi();
var API = sb.window.API;
ok('"…don\'" is truncated (was whitelisted as punctuation)',
  API.looksTruncated('…both rather dependent on each other, don\'') === true);
ok('curly variant "…don’" is truncated too',
  API.looksTruncated('…both rather dependent on each other, don’') === true);
ok('a message ending in a quoted ? is complete',
  API.looksTruncated('"Honestly, {{user}}. What do you think?"') === false);
ok('a sentence closing on an apostrophe-quote is complete',
  API.looksTruncated('She finally said the name. "Malfoy."') === false);
ok('an action beat ending is complete', API.looksTruncated('*She nods once.*') === false);
ok('plain stop punctuation is complete', API.looksTruncated('The train whistles twice.') === false);
ok('a comma-cut is truncated', API.looksTruncated('She reaches for the clasp,') === true);

var results = { ok: true };
function B(continueFromMissing) {
  var calls = [];
  var sb2 = loadApi();
  var API2 = sb2.window.API;
  var SEED = 'It seems we are both rather dependent on each other, don\'';
  var script = [ sseText('t you think?"') ];
  sb2.window.fetch = function (url, opts) {
    calls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, body: sseBody([script.shift() || sseText('')]) });
  };
  var hist = [{ role: 'user', text: 'I offer my hand. "Partners?"' }];
  var genOpts = {
    settings: SETTINGS, character: CHAR, session: null, history: hist,
    autoFinish: false
  };
  if (!continueFromMissing) genOpts.continueFrom = SEED;
  return API2.generate(genOpts).then(function (out) {
    if (continueFromMissing) {
      var last = calls[0].messages[calls[0].messages.length - 1];
      ok('plain generate sends no assistant prefix', last.role !== 'assistant',
        JSON.stringify(last));
      return;
    }
    ok('the continuation finishes the contraction tight ("don\'" + "t you…")',
      out === SEED + 't you think?"', JSON.stringify(out));
    ok('the result keeps the seed at its head', out.indexOf(SEED) === 0);
    var msgs = calls[0].messages;
    var lastM = msgs[msgs.length - 1];
    ok('wire ends with the seed as assistant prefix',
      lastM.role === 'assistant' && lastM.content === SEED, JSON.stringify(lastM));
    var seedCount = msgs.filter(function (m) { return String(m.content).indexOf('don\'') !== -1; }).length;
    ok('the cut text appears exactly once in context (no duplication)', seedCount === 1, seedCount);
    /* v1.39.30 re-pin: prefill-blind endpoints used to treat the trailing
       assistant seed as a finished turn and answered Continue with a fresh
       beat; a system nudge now sits between the user's turn and the seed to
       pin the instruction in words. */
    ok('the seam is framed nudge-then-seed, user turn before both',
      msgs[msgs.length - 2].role === 'system' && /[Cc]ontinue/.test(msgs[msgs.length - 2].content) &&
        msgs[msgs.length - 3].role === 'user', JSON.stringify(msgs[msgs.length - 2].role));
  });
}

function C() {
  var calls = [];
  var sb3 = loadApi();
  var API3 = sb3.window.API;
  var SEED = 'It seems we are both rather dependent on each other, don\'';
  var script = [
    sseText('t you think?" she adds —'),
    sseText(' and for once, she means it.')
  ];
  sb3.window.fetch = function (url, opts) {
    calls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, body: sseBody([script.shift()]) });
  };
  return API3.generate({
    settings: SETTINGS, character: CHAR, session: null,
    history: [{ role: 'user', text: '"Partners?"' }],
    continueFrom: SEED
  }).then(function (out) {
    ok('a continuation that is ITSELF cut fires another round', calls.length === 2, calls.length);
    ok('round 2 carries the re-assembled text as its prefix',
      calls.length > 1 &&
      calls[1].messages[calls[1].messages.length - 1].content === SEED + 't you think?" she adds —',
      calls.length > 1 ? JSON.stringify(calls[1].messages[calls[1].messages.length - 1].content) : 'no round 2');
    ok('the em-dash seam keeps its breathing room',
      out === SEED + 't you think?" she adds — and for once, she means it.', JSON.stringify(out));
  });
}

B(false)
  .then(function () { return B(true); })
  .then(C)
  .then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) { console.error(e); process.exit(1); });
