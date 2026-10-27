/* repeatguard-test — v1.39.25: "Repetition guard" (frequency_penalty) wiring.
 *
 * Reported live: the model ritual-reused its signature words ("Seal. Vow.
 * Anchor.", "catalogue", the verdict cadence) in every reply, and editing
 * old replies could never catch up — each new reply re-seeded the words
 * into the context window, and no OpenAI-compatible request the app ever
 * sent carried a frequency/presence penalty. The slider now maps directly
 * to the standard field:
 *
 *   - Settings.frequencyPenalty = 0.4 → the chat-completions body carries
 *     frequency_penalty: 0.4 (stream and non-stream alike)
 *   - unset / 0 → the body is byte-identical to before (key absent: zero
 *     regression risk, and some providers reject unknown-value nuance)
 *   - the rest of the body (temperature / top_p / max_tokens) carries over
 *
 *   node /home/user/tests/repeatguard-test.js
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

function okStream(text) {
  var sse = 'data: {"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}\n\ndata: [DONE]\n\n';
  var sent = false;
  return { ok: true, status: 200, headers: { get: function () { return null; } },
    body: { getReader: function () { return {
      read: function () {
        if (sent) return Promise.resolve({ done: true });
        sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(sse) });
      },
      cancel: function () { return Promise.resolve(); }
    }; } } };
}
function okJson(text) {
  return { ok: true, status: 200, headers: { get: function () { return null; } },
    body: null, text: function () { return Promise.resolve('{"choices":[{"message":{"content":' + JSON.stringify(text) + '}}]}'); },
    json: function () { return Promise.resolve({ choices: [{ message: { content: text } }] }); } };
}

var BASE = {
  provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'sk-test',
  model: 'm', temperature: 0.8, topP: 0.95, maxTokens: 100, userName: 'Tester'
};
var MSGS = [{ role: 'user', content: 'hi' }];

var captured = [];
var sb = loadApi();
var API = sb.window.API;
sb.window.fetch = function (url, opts) {
  captured.push(JSON.parse(opts.body));
  return Promise.resolve(captured._nonstream ? okJson('done.') : okStream('done.'));
};

console.log('A — a set guard reaches the request body');
API.streamChat(Object.assign({}, BASE, { frequencyPenalty: 0.4, streaming: true }), MSGS, null)
  .then(function () {
    var b = captured[0];
    ok('frequency_penalty present at the chosen value', b.frequency_penalty === 0.4, JSON.stringify(b.frequency_penalty));
    ok('…with the rest of the body intact', b.temperature === 0.8 && b.top_p === 0.95 && b.max_tokens === 100 && b.stream === true);

    console.log('\nB — …and it rides the non-streaming path too');
    captured._nonstream = true;
    return API.streamChat(Object.assign({}, BASE, { frequencyPenalty: 0.4, streaming: false }), MSGS, null);
  })
  .then(function () {
    var b = captured[1];
    ok('non-stream body carries it as well', b.frequency_penalty === 0.4 && b.stream === false, JSON.stringify(b));

    console.log('\nC — unset or 0 keeps the body exactly as before');
    captured._nonstream = false;
    return API.streamChat(Object.assign({}, BASE, { streaming: true }), MSGS, null)
      .then(function () { return API.streamChat(Object.assign({}, BASE, { frequencyPenalty: 0, streaming: true }), MSGS, null); });
  })
  .then(function () {
    ok('unset → no frequency_penalty key at all', !('frequency_penalty' in captured[2]), JSON.stringify(captured[2]));
    ok('0 → still absent (explicit slider-zero means leave the model alone)', !('frequency_penalty' in captured[3]), JSON.stringify(captured[3]));
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) { console.error(e); process.exit(1); });
