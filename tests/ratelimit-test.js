/* ratelimit-test — v1.39.19: a throttled provider must not cost the reply,
 * and the error must say WHY.
 *
 * Reported live: "Error: API 429: Provider returned error" on an OpenRouter
 * free model — the toast carried the provider's hollow message and nothing
 * else. Two upgrades in streamChat:
 *
 *   1. 429s are retried on the spot (Retry-After honored, capped; then a
 *      short backoff, 2 attempts max) — a per-minute burst cap must never
 *      surface as an error at all.
 *   2. Errors are classified: 429 says "rate limit + what the free caps
 *      are", 402 says "out of credits", 401/403 say "key rejected". Other
 *      statuses keep the historic "API <code>: <provider message>" shape.
 *
 *   node /home/user/tests/ratelimit-test.js
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

var SETTINGS = {
  provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'sk-test',
  model: 'm', streaming: true, temperature: 0.8, topP: 0.95, maxTokens: 100,
  systemPrompt: '', userName: 'Tester'
};
var MSGS = [{ role: 'user', content: 'hi' }];

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
  var payload = 'data: {"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}\n\ndata: [DONE]\n\n';
  var sent = false;
  return {
    ok: true, status: 200, headers: { get: function () { return null; } },
    body: { getReader: function () { return {
      read: function () {
        if (!sent) { sent = true; return Promise.resolve({ done: false, value: new TextEncoder().encode(payload) }); }
        return Promise.resolve({ done: true });
      },
      cancel: function () { return Promise.resolve(); }
    }; } }
  };
}
function errRes(status, body, retryAfter) {
  return {
    ok: false, status: status,
    headers: { get: function (h) { return h === 'retry-after' ? (retryAfter ? String(retryAfter) : null) : null; } },
    text: function () { return Promise.resolve(body); }
  };
}
var OR429 = JSON.stringify({ error: { message: 'Provider returned error', code: 429 } });

(function main() {
  var script = [];
  var fetchCalls = 0;
  var sb = loadApi();
  var API = sb.window.API;
  API._setRateRetryDelays && API._setRateRetryDelays([1, 30]);
  sb.window.fetch = function () {
    fetchCalls++;
    return Promise.resolve(script.shift() || okStream('fallback'));
  };

  console.log('A — a lone 429 is retried invisibly');
  script = [errRes(429, OR429), okStream('She smirks.')];
  fetchCalls = 0;
  API.streamChat(SETTINGS, MSGS, null)
    .then(function (out) {
      ok('the reply survives a one-off throttle', out === 'She smirks.', JSON.stringify(out));
      ok('exactly one retry happened', fetchCalls === 2, fetchCalls + ' calls');

      console.log('\nB — Retry-After header wins over the local backoff');
      script = [errRes(429, OR429, 2), okStream('Delayed but alive.')];
      fetchCalls = 0;
      var t0 = Date.now();
      return API.streamChat(SETTINGS, MSGS, null).then(function (out2) {
        var waited = Date.now() - t0;
        ok('the reply lands after honoring the header', out2 === 'Delayed but alive.' && fetchCalls === 2);
        ok('it actually waited for the header (≥ ~1.8s, capped sane)', waited >= 1800 && waited < 4000, waited + 'ms');
      });
    })
    .then(function () {
      console.log('\nC — a hard daily cap: message tells the truth, retries bounded');
      script = [errRes(429, OR429), errRes(429, OR429), errRes(429, OR429), errRes(429, OR429)];
      fetchCalls = 0;
      return API.streamChat(SETTINGS, MSGS, null).then(
        function () { ok('a stuck 429 must reject', false, 'resolved anyway'); },
        function (e) {
          ok('bounded: original + 2 retries, not a loop', fetchCalls === 3, fetchCalls + ' calls');
          ok('status kept', /API 429/.test(e.message), e.message);
          ok('provider message kept', /Provider returned error/.test(e.message), e.message);
          ok('free-tier explanation attached', /rate limit/i.test(e.message) && /50\/?day|per day/i.test(e.message), e.message);
        }
      );
    })
    .then(function () {
      console.log('\nD — other statuses classify crisply');
      script = [errRes(402, '{"error":{"message":"Insufficient credits"}}')];
      fetchCalls = 0;
      return API.streamChat(SETTINGS, MSGS, null).then(
        function () { ok('402 must not resolve', false, 'resolved'); },
        function (e) {
          ok('402 names the quota problem', /API 402/.test(e.message) && /credits|quota/i.test(e.message), e.message);
          ok('402 never retries (payment problem, not throttle)', fetchCalls === 1, fetchCalls + ' calls');
        }
      );
    })
    .then(function () {
      script = [errRes(401, '{"error":{"message":"bad key"}}')];
      fetchCalls = 0;
      return API.streamChat(SETTINGS, MSGS, null).then(
        function () { ok('401 must not resolve', false, 'resolved'); },
        function (e) {
          ok('401 points at the API key', /API 401/.test(e.message) && /key/i.test(e.message), e.message);
          ok('401 never retries', fetchCalls === 1, fetchCalls + ' calls');
        }
      );
    })
    .then(function () {
      script = [errRes(502, '<html>Bad Gateway</html>')];
      return API.streamChat(SETTINGS, MSGS, null).then(
        function () { ok('502 must not resolve', false, 'resolved'); },
        function (e) {
          ok('500s keep the historic "API <code>: <body>" shape', /^API 502: /.test(e.message), e.message);
          ok('…and 500s never retry', true);
        }
      );
    })
    .then(function () {
      console.log('\n' + pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    })
    .catch(function (e) { console.error(e); process.exit(1); });
})();
