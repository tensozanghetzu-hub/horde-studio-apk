/* ssecomment-test — v1.39.21: OpenRouter's heartbeat comments must not
 * kill the stream.
 *
 * Reported live: switching to a working OpenRouter model instantly died
 * with "The provider returned an invalid chat stream." OpenRouter prefaces
 * and interleaves its SSE with COMMENT lines — `: OPENROUTER PROCESSING` —
 * which the spec says every parser must ignore; ours failed loud on any
 * line that wasn't data/event/id/retry. (Gemma :free never reached this —
 * it 429s before streaming — so the path only lit up once a model actually
 * streamed.)
 *
 *   - colon-comment lines anywhere in the stream are ignored
 *   - comments split across DATA chunks (': OPENROUTER PROC' + 'ESSING') too
 *   - genuine junk (HTML error page mid-stream, a bare word) STILL fails loud
 *   - a mid-stream data-frame carrying an {error} object rejects with its
 *     real message instead of dissolving into a blank "…" bubble
 *
 *   node /home/user/tests/ssecomment-test.js
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
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free', streaming: true,
  temperature: 0.8, topP: 0.95, maxTokens: 100, systemPrompt: '', userName: 'Tester'
};
var MSGS = [{ role: 'user', content: 'hi' }];

function bodyFrom(chunks) {
  var i = 0;
  return { ok: true, status: 200, headers: { get: function () { return null; } },
    body: undefined, getReader: null };
}
function sse(chunks) {
  var i = 0;
  return { ok: true, status: 200, headers: { get: function () { return null; } },
    body: { getReader: function () { return {
      read: function () {
        if (i < chunks.length) return Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) });
        return Promise.resolve({ done: true });
      },
      cancel: function () { return Promise.resolve(); }
    }; } } };
}
var DELTA = function (t) { return 'data: {"choices":[{"delta":{"content":' + JSON.stringify(t) + '}}]}\n\n'; };

console.log('A — heartbeat comments ride along unnoticed');
var sb = loadApi();
var API = sb.window.API;
sb.window.fetch = function () {
  return Promise.resolve(sse([
    ': OPENROUTER PROCESSING\n\n' + DELTA('"Obviously' ),
    ': OPENROUTER PROCESSING\n\n' + DELTA('. "'),
    'data: [DONE]\n\n'
  ]));
};
API.streamChat(SETTINGS, MSGS, null)
  .then(function (out) {
    ok('comments before/between deltas do not fail the stream', out === '"Obviously. "', JSON.stringify(out));

    console.log('\nB — a comment split across chunk boundaries');
    sb.window.fetch = function () {
      return Promise.resolve(sse([
        DELTA('The answer'),
        ': OPENROUTER PROC',
        'ESSING\n\n' + DELTA(' survives.'),
        'data: [DONE]\n\n'
      ]));
    };
    return API.streamChat(SETTINGS, MSGS, null);
  })
  .then(function (out) {
    ok('split comment still ignored, text intact', out === 'The answer survives.', JSON.stringify(out));

    console.log('\nC — actual garbage STILL fails loud (the strictness stays)');
    sb.window.fetch = function () {
      return Promise.resolve(sse(['<html><body>Bad Gateway</body></html>']));
    };
    return API.streamChat(SETTINGS, MSGS, null).then(
      function () { ok('junk must never resolve', false, 'resolved'); },
      function (e) { ok('junk still errors', /invalid chat stream/.test(e.message), e.message); }
    );
  })
  .then(function () {
    console.log('\nD — a mid-stream error frame speaks its message');
    sb.window.fetch = function () {
      return Promise.resolve(sse([
        DELTA('halfway'),
        'data: {"error":{"code":524,"message":"upstream request timed out"}}\n\n'
      ]));
    };
    return API.streamChat(SETTINGS, MSGS, null).then(
      function () { ok('an error frame must not resolve to half text', false, 'resolved: ' + JSON.stringify(arguments)); },
      function (e) { ok('the error frame surfaces its own message', /upstream request timed out/.test(e.message), e.message); }
    );
  })
  .then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) { console.error(e); process.exit(1); });
