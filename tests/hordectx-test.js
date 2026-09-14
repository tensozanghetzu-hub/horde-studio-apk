/* The Horde prompt has to fit the context the app asks for.
 *
 * horde.js requests max_context_length = min(8192, promptTokens + maxLength + 64).
 * api.js used to trim history only past 128,000 BYTES (~32,000 tokens), so a
 * long chat produced a prompt far bigger than the 8,192-token worker window.
 * The worker truncates, and a backend that keeps the head of the prompt leaves
 * the model seeing only the character sheet and the first few turns - so every
 * reply comes from the start of the conversation, whatever you type.
 *
 *   node /home/user/tests/hordectx-test.js
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

var char = {
  id: 'c1', name: 'Mara',
  persona: 'Mara keeps a small greenhouse and talks about plants constantly. ' +
    'She is patient, dry-humoured, and notices small changes in people.',
  scenario: 'Evening in the greenhouse.',
  examples: '', lorebook: []
};
var session = { id: 's1', charId: 'c1' };

/* a chat that has been going a while: 40 turns of ordinary length */
function longHistory(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      id: 'm' + i, sessionId: 's1',
      role: i % 2 ? 'user' : 'assistant',
      text: (i === 0 ? 'FIRST-REPLY-FROM-THE-START ' : '') +
        'Turn ' + i + '. ' + ('This is an ordinary message of a realistic length. ').repeat(18),
      createdAt: 1000 + i
    });
  }
  out.push({
    id: 'mnew', sessionId: 's1', role: 'user',
    text: 'NEWEST: what I actually just typed', createdAt: 9000
  });
  return out;
}

function settings() {
  return {
    provider: 'horde', hordeTextModel: '', hordeKey: '0000000000',
    userName: 'Sam', systemPrompt: 'You are {{char}}. Reply in character.',
    maxTokens: 300, temperature: 0.8, topP: 0.9, topK: 0, repPen: 1.1,
    contextMessages: 40, maxContextChars: 26000, streaming: false
  };
}

function capturePrompt(history) {
  var sent = null;
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
    Horde: {
      generateText: function (o) { sent = o; return Promise.resolve({ text: 'A complete reply.' }); },
      listTextModels: function () { return Promise.resolve([]); },
      health: function () { return Promise.resolve({}); },
      whoami: function () { return null; }
    },
    fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ choices: [{ message: { content: 'A complete reply.' } }] }); } }); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'api.js' });
  return sandbox.API.generate({
    settings: settings(), character: char, session: session, history: history
  }).then(function () { return { api: sandbox.API, sent: sent }; });
}

/* what horde.js will ask for, and what therefore has to fit */
var CTX_CAP = 8192;
function ctxFor(prompt, maxLength) {
  return Math.min(CTX_CAP, Math.max(1024, Math.ceil(prompt.length / 4) + (maxLength || 200) + 64));
}

console.log('\nthe prompt fits the context the app asks the Horde for');

capturePrompt(longHistory(40)).then(function (r) {
  var prompt = r.sent.prompt;
  var maxLength = r.sent.maxLength || 300;
  var need = Math.ceil(prompt.length / 4) + maxLength + 64;
  var ctx = ctxFor(prompt, maxLength);

  ok('the newest thing I typed survives into the prompt',
    prompt.indexOf('NEWEST: what I actually just typed') !== -1);
  ok('the prompt fits inside the requested context, so nothing gets truncated',
    need <= CTX_CAP,
    'needs ' + need + ' tokens but workers are capped at ' + CTX_CAP);
  ok('the app is not asking for a context bigger than the cap', ctx <= CTX_CAP, 'ctx ' + ctx);

  /* and it must still work for a brand new chat */
  return capturePrompt(longHistory(2));
}).then(function (r) {
  var prompt = r.sent.prompt;
  ok('a short chat still carries its whole history',
    prompt.indexOf('Turn 0.') !== -1 && prompt.indexOf('NEWEST: what I actually just typed') !== -1);
  return null;
}).then(function () {
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL threw: ' + (e && e.message));
  process.exit(1);
});
