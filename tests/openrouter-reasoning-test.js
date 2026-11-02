/* OpenRouter's free Nemotron reasoning can consume the whole output budget,
 * leaving message.content empty. Keep final-answer tokens available and fail
 * visibly if a valid-but-empty completion still arrives. */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'api.js');
var pass = 0, fail = 0;
function ok(label, condition, extra) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); }
}
function makeApi(fetchFn) {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
    location: { origin: 'https://app.test' }, fetch: fetchFn,
    Horde: { generateText: function () { return Promise.resolve({ text: '' }); },
      listTextModels: function () { return Promise.resolve([]); },
      health: function () { return Promise.resolve({}); }, whoami: function () { return null; } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
function settings(model, baseUrl, streaming) {
  return { provider: 'openai', baseUrl: baseUrl || 'https://openrouter.ai/api/v1',
    apiKey: 'sk-test', model: model, streaming: streaming, maxTokens: 600,
    temperature: 0.8, topP: 0.95, userName: 'Tester' };
}
function streamResponse(chunks) {
  var i = 0;
  return { ok: true, body: { getReader: function () { return {
    read: function () { return i < chunks.length
      ? Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) })
      : Promise.resolve({ done: true }); },
    cancel: function () { return Promise.resolve(); }
  }; } } };
}
var bodySent;
var API = makeApi(function (url, options) {
  bodySent = JSON.parse(options.body);
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ choices: [{
    message: { content: 'A short roleplay reply.' }, finish_reason: 'stop'
  }] }); } });
});
var msgs = [{ role: 'user', content: 'Write one sentence.' }];

API.streamChat(settings('nvidia/nemotron-3.5-super-vl:free', undefined, false), msgs, null)
  .then(function (text) {
    ok('free Super VL still returns its visible reply', text === 'A short roleplay reply.');
    ok('OpenRouter free Nemotron has reasoning disabled by default',
      bodySent.reasoning && bodySent.reasoning.enabled === false, JSON.stringify(bodySent.reasoning));
    ok('reasoning fix preserves the user reply-token setting', bodySent.max_tokens === 600, String(bodySent.max_tokens));

    return API.streamChat(settings('nvidia/nemotron-3-ultra-550b-a55b:free', undefined, false), msgs, null)
      .then(function () {
        ok("the same guard covers the user's Ultra free fallback",
          bodySent.reasoning && bodySent.reasoning.enabled === false, JSON.stringify(bodySent.reasoning));
        return API.streamChat(settings('google/gemma-4-31b-it:free', undefined, false), msgs, null).then(function () {
          ok('other OpenRouter models are left untouched', !bodySent.reasoning, JSON.stringify(bodySent.reasoning));
          return API.streamChat(settings('nvidia/nemotron-3.5-super-vl:free', 'https://api.example.test/v1', false), msgs, null).then(function () {
            ok('the OpenRouter-only workaround does not affect other providers', !bodySent.reasoning, JSON.stringify(bodySent.reasoning));
            var emptyApi = makeApi(function () {
              return Promise.resolve(streamResponse([
                'data: {"choices":[{"delta":{"reasoning":"private chain of thought"}}]}\n',
                'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
                'data: [DONE]\n'
              ]));
            });
            return emptyApi.streamChat(settings('nvidia/nemotron-3.5-super-vl:free', undefined, true), msgs, null)
              .then(function (out) {
                ok('reasoning-only empty completion rejects instead of saving a blank bubble', false, JSON.stringify(out));
              }, function (e) {
                ok('reasoning-only empty completion rejects instead of saving a blank bubble',
                  /no final answer text/i.test(e.message), e.message);
              });
          });
        });
      });
  })
  .then(function () {
    console.log('\nopenrouter-reasoning-test: ' + (fail ? fail + ' failed, ' : '') + pass + ' ok');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
