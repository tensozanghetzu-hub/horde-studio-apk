/* Does a multi-turn conversation actually reach the model?
 *
 * Reported symptom: "no matter what I type, the response is always the first
 * message from the start of the conversation" - which is what you get when the
 * history stops growing and every turn sends the same opening context.
 *
 * This drives API.generate with a six-message history and inspects what would
 * go on the wire, for both the chat-completions path and the Horde path.
 *
 *   node /home/user/tests/history-test.js
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
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* six turns: three from each side, so "the first message" is unambiguous */
function history() {
  var mk = function (role, text, i) {
    return { id: 'm' + i, sessionId: 's1', role: role, text: text, createdAt: 1000 + i };
  };
  return [
    mk('assistant', 'FIRST-REPLY-FROM-THE-START', 1),
    mk('user', 'second turn from me', 2),
    mk('assistant', 'third turn reply', 3),
    mk('user', 'fourth turn from me', 4),
    mk('assistant', 'fifth turn reply', 5),
    mk('user', 'sixth turn, the newest thing I typed', 6)
  ];
}

var char = { id: 'c1', name: 'Mara', persona: 'A test character.', scenario: '', examples: '', lorebook: [] };
var session = { id: 's1', charId: 'c1' };

function baseSettings(over) {
  return Object.assign({
    provider: 'openai',
    model: 'test-model',
    apiKey: 'k',
    userName: 'Sam',
    systemPrompt: 'You are {{char}}. Reply in character.',
    contextMessages: 40,
    maxContextChars: 26000,
    temperature: 0.8,
    maxTokens: 200,
    topP: 1,
    streaming: false
  }, over || {});
}

function run(provider) {
  var sent = null;
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
    Horde: {
      generateText: function (o) {
        sent = { kind: 'horde', prompt: o.prompt, stop: o.stopSequence };
        return Promise.resolve({ text: 'A complete reply.' });
      },
      listTextModels: function () { return Promise.resolve([]); },
      health: function () { return Promise.resolve({}); },
      whoami: function () { return null; }
    },
    fetch: function (url, opts) {
      sent = { kind: 'chat', url: url, body: JSON.parse(opts.body) };
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ choices: [{ message: { content: 'A complete reply.' } }] });
        }
      });
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'api.js' });

  return sandbox.API.generate({
    settings: baseSettings({ provider: provider }),
    character: char, session: session, history: history()
  }).then(function () { return sent; });
}

console.log('\nconversation history reaches the model');

run('openai').then(function (sent) {
  var msgs = sent.body.messages;
  var body = msgs.filter(function (m) { return m.role !== 'system'; });
  /* 'A complete reply.' ends on punctuation, so auto-finish stops after one
     round - otherwise a second round appends another assistant turn. */
  eq('chat path: all six turns are sent', body.length, 6);
  eq('the oldest turn is present', body[0].content, 'FIRST-REPLY-FROM-THE-START');
  eq('the newest turn is present', body[5].content, 'sixth turn, the newest thing I typed');
  eq('turns are in order, alternating',
    body.map(function (m) { return m.role; }).join(','),
    'assistant,user,assistant,user,assistant,user');
  return run('horde');
}).then(function (sent) {
  var p = sent.prompt;
  ok('horde path: the oldest turn is in the prompt',
    p.indexOf('FIRST-REPLY-FROM-THE-START') !== -1);
  ok('horde path: the newest turn is in the prompt',
    p.indexOf('sixth turn, the newest thing I typed') !== -1);
  ok('horde path: the prompt ends on the character name, ready to answer',
    /Mara:\s*$/.test(p), JSON.stringify(p.slice(-40)));
  return null;
}).then(function () {
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL threw: ' + (e && e.message));
  process.exit(1);
});
