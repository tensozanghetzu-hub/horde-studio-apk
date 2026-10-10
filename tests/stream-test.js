/* v1.21.0 — the streaming chat request must die loud, never hang silently.
 *
 * Ported from upstream 18.3.5 (readChatProviderReply):
 *   - a 120 s deadline per request (the reader's silence used to wait forever)
 *   - a non-SSE body (proxy notice, HTML error page) is an error, not a "…"
 *   - a stream that ends with no text and no parseable completion frame is an
 *     error; a frame that parsed but carried no content stays '' as before
 *
 * The deadline is shortened with API._setStreamTimeoutMs (tests only).
 *
 *   node /home/user/tests/stream-test.js
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

function sandbox() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  sb.window = sb;
  sb.global = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'api.js' });
  return sb;
}

var SETTINGS = {
  provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'sk-test',
  model: 'm', streaming: true, temperature: 0.8, topP: 0.95, maxTokens: 100,
  systemPrompt: '', userName: 'Tester'
};

/* a body whose read() yields the given strings in order, then done */
function bodyFrom(chunks) {
  var i = 0, cancelled = false;
  return {
    getReader: function () {
      return {
        read: function () {
          if (i < chunks.length) {
            var v = chunks[i++];
            return Promise.resolve({ done: false, value: new TextEncoder().encode(v) });
          }
          return Promise.resolve({ done: true, value: undefined });
        },
        cancel: function () { cancelled = true; return Promise.resolve(); }
      };
    },
    _cancelled: function () { return cancelled; }
  };
}

function res(chunks, opts) {
  var b = bodyFrom(chunks);
  return Object.assign({ ok: true, body: b }, opts || {});
}

var sb = sandbox();
var API = sb.window.API;
var MSGS = [{ role: 'user', content: 'hi' }];

/* a hanging read() — the classic wedge */
function hangingBody() {
  return { getReader: function () {
    return { read: function () { return new Promise(function () {}); },
             cancel: function () { return Promise.resolve(); } };
  } };
}

(function run() {
  API._setStreamTimeoutMs(60000);

  /* 1. happy path: several deltas, split across chunk boundaries */
  sb.window.fetch = function () {
    return Promise.resolve(res([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      '\ndata: [DONE]\n\n'
    ]));
  };
  var d1 = [], f1 = '';
  API.streamChat(SETTINGS, MSGS, function (d, f) { d1.push(d); f1 = f; })
    .then(function (out) {
      ok('happy path resolves the full text', out === 'Hello', JSON.stringify(out));
      ok('onDelta fired per delta', d1.join('') === 'Hello' && d1.length === 2, JSON.stringify(d1));
      ok('onDelta got the running total', f1 === 'Hello', JSON.stringify(f1));
      done();
    });
})();

function done() {
  /* 2. the deadline kills a hung read */
  API._setStreamTimeoutMs(50);
  sb.window.fetch = function () { return Promise.resolve({ ok: true, body: hangingBody() }); };
  var t0 = Date.now();
  API.streamChat(SETTINGS, MSGS, null).then(function () {
    ok('deadline: hung read rejects', false, 'it resolved');
    step3();
  }, function (e) {
    ok('deadline: hung read rejects', e.name === 'TimeoutError', String(e));
    ok('deadline: message names the limit', /did not complete within/.test(e.message), String(e));
    ok('deadline: fired near the set limit', Date.now() - t0 < 500, (Date.now() - t0) + 'ms');
    step3();
  });

  function step3() {
    /* 3. a non-SSE body fails loud, and the reader is cancelled */
    API._setStreamTimeoutMs(60000);
    var captured = null;
    sb.window.fetch = function () {
      var r = res(['<html><body>', 'proxy error 502</body></html>']);
      captured = r.body;
      return Promise.resolve(r);
    };
    API.streamChat(SETTINGS, MSGS, null).then(function (out) {
      ok('junk body rejects', false, 'resolved ' + JSON.stringify(out));
      step4();
    }, function (e) {
      ok('junk body rejects', /invalid chat stream/.test(e.message), String(e));
      ok('junk body: reader cancelled', captured._cancelled() === true);
      step4();
    });

    function step4() {
      /* 4. no text, no parseable frame (only [DONE]) -> error */
      sb.window.fetch = function () {
        return Promise.resolve(res(['data: [DONE]\n']));
      };
      API.streamChat(SETTINGS, MSGS, null).then(function (out) {
        ok('frameless stream rejects', false, 'resolved ' + JSON.stringify(out));
        step5();
      }, function (e) {
        ok('frameless stream rejects', /completed without visible text/.test(e.message), String(e));
        step5();
      });

      function step5() {
        /* 5. a frame that parsed but carried no content is still '' (the
           existing "…" bubble behaviour is preserved) */
        sb.window.fetch = function () {
          return Promise.resolve(res([
            'data: {"choices":[{"delta":{}}]}\n',
            'data: [DONE]\n'
          ]));
        };
        API.streamChat(SETTINGS, MSGS, null).then(function (out) {
          ok('empty-delta frames still resolve \'\'' , out === '', JSON.stringify(out));
          step6();
        }, function (e) {
          ok('empty-delta frames still resolve \'\'', false, String(e));
          step6();
        });

        function step6() {
          /* 6. all-malformed frames -> error (they are not valid frames) */
          sb.window.fetch = function () {
            return Promise.resolve(res(['data: {not json at all\n', 'data: [DONE]\n']));
          };
          API.streamChat(SETTINGS, MSGS, null).then(function (out) {
            ok('all-malformed frames reject', false, 'resolved ' + JSON.stringify(out));
            step7();
          }, function (e) {
            ok('all-malformed frames reject', /completed without visible text/.test(e.message), String(e));
            step7();
          });

          function step7() {
            /* 7. SSE metadata lines (event/id/retry) are harmless */
            sb.window.fetch = function () {
              return Promise.resolve(res([
                'event: message\nid: 7\nretry: 3000\n',
                'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
                'data: [DONE]\n'
              ]));
            };
            API.streamChat(SETTINGS, MSGS, null).then(function (out) {
              ok('metadata lines tolerated', out === 'hi', JSON.stringify(out));
              step8();
            }, function (e) {
              ok('metadata lines tolerated', false, String(e));
              step8();
            });

            function step8() {
              /* 8. a final frame with no trailing newline (buf at done) */
              sb.window.fetch = function () {
                return Promise.resolve(res([
                  'data: {"choices":[{"delta":{"content":"A"}}]}\n',
                  'data: {"choices":[{"delta":{"content":"B"}}]}'
                ]));
              };
              API.streamChat(SETTINGS, MSGS, null).then(function (out) {
                ok('final frame without trailing newline', out === 'AB', JSON.stringify(out));
                step9();
              }, function (e) {
                ok('final frame without trailing newline', false, String(e));
                step9();
              });

              function step9() {
                /* 9. non-stream mode untouched: JSON completion */
                sb.window.fetch = function () {
                  return Promise.resolve({
                    ok: true,
                    json: function () {
                      return Promise.resolve({
                        choices: [{ message: { content: 'json reply' } }]
                      });
                    }
                  });
                };
                var d9 = [];
                API.streamChat(SETTINGS, MSGS, function (d) { d9.push(d); }, null, { stream: false })
                  .then(function (out) {
                    ok('non-stream JSON path resolves', out === 'json reply', JSON.stringify(out));
                    ok('non-stream onDelta got the text', d9[0] === 'json reply', JSON.stringify(d9));
                    step10();
                  }, function (e) {
                    ok('non-stream JSON path resolves', false, String(e));
                    step10();
                  });

                function step10() {
                  /* 10. HTTP error path still surfaces the provider message */
                  sb.window.fetch = function () {
                    return Promise.resolve({
                      ok: false, status: 500,
                      text: function () {
                        return Promise.resolve('{"error":{"message":"boom from provider"}}');
                      }
                    });
                  };
                  API.streamChat(SETTINGS, MSGS, null).then(function (out) {
                    ok('HTTP error rejects', false, 'resolved ' + JSON.stringify(out));
                    finish();
                  }, function (e) {
                    ok('HTTP error rejects', /API 500: boom from provider/.test(e.message), String(e));
                    finish();
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  function finish() {
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
}
