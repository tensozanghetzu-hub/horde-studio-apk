/* OpenRouter account quota, selected-route probe, and local usage telemetry. */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'api.js'), 'utf8');
var storage = {}, calls = [];
var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
  parseFloat: parseFloat, parseInt: parseInt, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  AbortController: AbortController, setTimeout: setTimeout, clearTimeout: clearTimeout,
  location: { origin: 'https://example.test' },
  localStorage: {
    getItem: function (k) { return storage[k] || null; },
    setItem: function (k, v) { storage[k] = String(v); }
  },
  fetch: function (url, options) {
    calls.push({ url: url, options: options });
    if (/\/key$/.test(url)) return Promise.resolve({ ok: true, text: function () {
      return Promise.resolve(JSON.stringify({ data: {
        free_model_daily_requests: { used: 13, limit: 50, remaining: 37 },
        limit_remaining: null, usage_daily: 0
      } }));
    } });
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve(JSON.stringify({
      provider: 'TestProvider', choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
    })); } });
  }
};
sb.window = sb; sb.global = sb;
vm.runInNewContext(src, sb, { filename: 'api.js' });
var API = sb.API, pass = 0, fail = 0;
function ok(label, condition, extra) {
  if (condition) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); }
}
var settings = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-v1-test-key', model: 'google/gemma-4-31b-it:free', streaming: false };
API.openRouterKeyStatus(settings).then(function (result) {
  ok('reads authoritative free request counter from OpenRouter /key', result.data.free_model_daily_requests.remaining === 37 && result.data.free_model_daily_requests.limit === 50);
  ok('quota check calls official /key endpoint with bearer key', calls[0].url === 'https://openrouter.ai/api/v1/key' && calls[0].options.headers.Authorization === 'Bearer ' + settings.apiKey);
  ok('reports reset at next UTC midnight', result.resetsAt === API.openRouterResetAt(Date.now()));
  return API.probeOpenRouterModel(settings);
}).then(function (probe) {
  ok('manual selected-model probe returns provider and latency', probe.ok && probe.provider === 'TestProvider' && probe.elapsedMs >= 0);
  ok('probe is a minimal non-streaming request', calls[1].url.endsWith('/chat/completions') && JSON.parse(calls[1].options.body).max_tokens === 12 && JSON.parse(calls[1].options.body).stream === false);
  var totals = API.openRouterActivityToday(settings);
  ok('stores local input/output token observations without prompt or answer text', totals.requests === 1 && totals.successes === 1 && totals.promptTokens === 8 && totals.completionTokens === 1 && totals.tokenReports === 1);

  var streamText = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }) + '\n\n' +
    'data: ' + JSON.stringify({ provider: 'StreamProvider', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 } }) + '\n\n' + 'data: [DONE]\n\n';
  var sentStream = false;
  sb.fetch = function () { return Promise.resolve({ ok: true, body: { getReader: function () { return {
    read: function () {
      if (!sentStream) { sentStream = true; return Promise.resolve({ done: false, value: new TextEncoder().encode(streamText) }); }
      return Promise.resolve({ done: true });
    },
    cancel: function () { return Promise.resolve(); }
  }; } } }); };
  return API.streamChat(settings, [{ role: 'user', content: 'hello' }], null, null, { stream: true }).then(function (reply) {
    var streamTotals = API.openRouterActivityToday(settings);
    ok('stream usage chunk is retained and included in today token totals', reply === 'Hi' && streamTotals.requests === 2 && streamTotals.promptTokens === 28 && streamTotals.completionTokens === 4 && streamTotals.tokenReports === 2);
    var savedActivity = JSON.stringify(storage);
    ok('local diagnostics do not persist the API key or chat prompt/reply text', savedActivity.indexOf(settings.apiKey) < 0 && savedActivity.indexOf('hello') < 0 && savedActivity.indexOf('Hi') < 0 && savedActivity.indexOf('Reply with OK') < 0);
    var providerLimit = API.openRouterErrorDiagnosis({ status: 429, openRouterMetadata: { provider_code: 'rate_limited' } }, null);
    var ambiguousLimit = API.openRouterErrorDiagnosis({ status: 429 }, null);
    var accountLimit = API.openRouterErrorDiagnosis({ status: 429 }, { get: function (k) { return k === 'x-ratelimit-limit' ? '20' : null; } });
    var timeout = API.openRouterErrorDiagnosis({ name: 'TimeoutError' }, null);
    ok('separates provider 429 from account quota 429', providerLimit.kind === 'provider_limit' && accountLimit.kind === 'account_limit');
    ok('labels unclassified 429 honestly instead of guessing the cause', ambiguousLimit.kind === 'ambiguous_limit');
    ok('timeout diagnosis does not claim quota exhaustion', timeout.kind === 'timeout' && /not confirmed/.test(timeout.diagnosis));

    /* v1.42.3: the 429 response carries the limiter it actually hit in
       X-RateLimit-* headers, and the daily counter on the panel cannot
       explain a refusal that arrives while it still reads hundreds
       remaining. The headers must reach both the message and the log. */
    var last429 = null;
    function last29Message() { return last429 ? last429.message : ''; }
    sb.fetch = function () {
      return Promise.resolve({
        ok: false, status: 429,
        headers: { get: function (k) {
          k = String(k).toLowerCase();
          if (k === 'x-ratelimit-limit') return '40';
          if (k === 'x-ratelimit-remaining') return '0';
          if (k === 'x-ratelimit-reset') return String(Date.now() + 540000);
          return null;
        } },
        text: function () { return Promise.resolve(JSON.stringify({
          error: { message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } }
        })); }
      });
    };
    return API.probeOpenRouterModel(settings).catch(function (e) { last429 = e; }).then(function () {
      var m = String(last429 && last29Message());
      ok('429 names the limiter from its headers instead of pointing at the panel',
        /limit 40/.test(m) && /0 remaining/.test(m) && /resets in 9m/.test(m), m);
      ok('the daily counter is explained as a separate allowance',
        /separate allowance/.test(m) && m.indexOf('Check the quota panel for requests remaining') < 0, m);
      ok('the header figures ride on the error for the log to keep',
        !!(last429 && last429.openRouterRateLimit && last429.openRouterRateLimit.limit === 40 &&
          last429.openRouterRateLimit.remaining === 0 && last429.openRouterRateLimit.resetInSec > 500));
      var fromErr = API.openRouterErrorDiagnosis(last429, null);
      ok('diagnosis reads the carried limit with no headers to re-read',
        fromErr.kind === 'account_limit' && /40\/window/.test(fromErr.diagnosis) && /0 left/.test(fromErr.diagnosis),
        fromErr.diagnosis);
      ok('a nine-minute limiter is never mislabelled as the per-minute cap',
        fromErr.diagnosis.indexOf('/min') < 0, fromErr.diagnosis);
      var evs = API.openRouterActivityToday(settings).events || [];
      var withFigures = evs.filter(function (x) { return x && x.rateLimit; })[0] || {};
      ok('the probe logs the figures it measured, key never stored',
        withFigures.rateLimit && withFigures.rateLimit.limit === 40 &&
        withFigures.rateLimit.remaining === 0 && /limit 40/.test(String(withFigures.message)) &&
        JSON.stringify(evs).indexOf('test-key') < 0, JSON.stringify(withFigures).slice(0, 200));
      sb.fetch = function () {
        return Promise.resolve({
          ok: false, status: 429,
          headers: { get: function (k) {
            return String(k).toLowerCase() === 'x-ratelimit-limit' ? '20'
              : (String(k).toLowerCase() === 'x-ratelimit-reset' ? '45' : null);
          } },
          text: function () { return Promise.resolve('{}'); }
        });
      };
      return API.probeOpenRouterModel(settings).catch(function (e) { last429 = e; });
    }).then(function () {
      ok('a sub-two-minute window is called the per-minute cap it is',
        /per-minute window/.test(String(last429.message)), String(last429.message));
      /* With no X-RateLimit-* on the response there is nothing measured to
         show, so the old advice stays — but it is the fallback, not the rule. */
      sb.fetch = function () {
        return Promise.resolve({ ok: false, status: 429, headers: null,
          text: function () { return Promise.resolve(JSON.stringify({
            error: { message: 'Rate limit exceeded', metadata: { limit_source: 'openrouter_free_tier' } } })); } });
      };
      return API.probeOpenRouterModel(settings).catch(function (e) { last429 = e; }).then(function () {
        ok('a 429 that carries no figures still says so plainly, without inventing any',
          /limit 40/.test(String(last429.message)) === false &&
          /Check the quota panel/.test(String(last429.message)) &&
          !last429.openRouterRateLimit, String(last429.message).slice(-90));
      });
      /* The path that matters is a normal chat turn, which retries the 429
         twice before it surfaces. Pin that the retry budget does not eat the
         measured limit on its way out. */
      }).then(function () {
      var beforeChat = (API.openRouterActivityToday(settings).events || []).length;
      API._setRateRetryDelays([1, 1]);
      sb.fetch = function () {
        return Promise.resolve({
          ok: false, status: 429,
          headers: { get: function (k) {
            k = String(k).toLowerCase();
            if (k === 'x-ratelimit-limit') return '40';
            if (k === 'x-ratelimit-remaining') return '0';
            if (k === 'x-ratelimit-reset') return '540';
            return null;
          } },
          text: function () { return Promise.resolve(JSON.stringify({
            error: { message: 'UPSTREAM-ECHO-7z: too many requests from sk-or-v1-test-key' } })); }
        });
      };
      return API.streamChat(settings, [{ role: 'user', content: 'hi' }]).then(
        function () { return { err: null }; },
        function (e) { return { err: e }; }
      ).then(function (r) {
        var after = API.openRouterActivityToday(settings).events || [];
        var chatEv = after.filter(function (x) { return x && x.rateLimit; })[0] || {};
        ok('a refused chat turn logs the limiter it was given',
          after.length > beforeChat && chatEv.rateLimit && chatEv.rateLimit.limit === 40 &&
          chatEv.rateLimit.resetInSec === 540 &&
          /40\/window · 0 left · resets in 9m/.test(String(chatEv.diagnosis)), JSON.stringify(chatEv).slice(0, 220));
        ok('the stored line is this app\'s clause, never the provider\'s text',
          String(chatEv.message).indexOf('UPSTREAM-ECHO-7z') < 0 &&
          /OpenRouter reports an account\/key rate limit/.test(String(chatEv.message)),
          String(chatEv.message));
        API._setRateRetryDelays([5000, 15000]);
        return null;
      });
    });
    return API.openRouterKeyStatus({ baseUrl: 'https://api.example/v1', apiKey: 'x' }).then(function () {
      ok('non-OpenRouter endpoint cannot query this quota API', false);
    }, function (e) {
      ok('non-OpenRouter endpoint cannot query this quota API', /official OpenRouter/.test(e.message));
    });
  });
}).then(function () {
  console.log('\nopenrouter-quota-test: ' + (fail ? fail + ' failed, ' : '') + pass + ' ok');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
