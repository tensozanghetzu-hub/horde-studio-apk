/* stitchreplay-test — v1.39.27: auto-finish must keep only the NEW prose
 * when the model replays.
 *
 * Reported live: with the repetition guard on, replies end cut mid-word
 * almost every time — and yesterday's screenshot showed why the stitcher
 * gets no blame: the continuation pass REPLAYS a whole block ("Her emerald
 * eyes close. The lake presses…" emitted twice), the old stitcher pasted
 * it whole, the pass's token budget burned on rerun, and the assembled
 * reply still ended unfinished.
 *
 * replayedTail(before, piece) → length of the shared cut-tail rerun:
 * a verbatim run that starts somewhere in `before` AND reaches the very
 * end of `before` (the cut), ≥ 40 chars. Shorter or floating overlaps are
 * coincidences and must not touch the seam.
 *
 *   A — full generate(): cut pass + replay-and-continue pass → clean single
 *       copy with the mid-word seam healed ('rh' + 'ythms' → 'rhythms')
 *   B — ordinary continuation (no replay) → byte-identical to before the fix
 *   C — pure rerun (nothing new) → the reply keeps ONE copy and ends
 *   D — floating short echo (< 40) → NOT stripped (old behavior pinned)
 *
 *   node /home/user/tests/stitchreplay-test.js
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

function loadApi(queue) {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'api.js' });
  sb.window.fetch = function () {
    sb.window.fetch.calls++;
    if (!queue.length) return Promise.reject(new Error('unexpected extra fetch call'));
    return Promise.resolve(okStream(queue.shift()));
  };
  sb.window.fetch.calls = 0;
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

var SETTINGS = {
  provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'k',
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free', streaming: true,
  temperature: 0.8, topP: 0.95, maxTokens: 100, userName: 'Blice',
  systemPrompt: '', stripThinking: true
};
var CHAR = { id: 'c1', name: 'Draconica', persona: 'p', scenario: '' };
var HIST = [{ role: 'user', content: '*You squeeze her hand.*' }];

var CUT = 'Her emerald eyes close. The lake presses against windows like a lullaby. ' +
  'Fire dies to embers below. Dormitory breathes around her in unconnected rh';
var REPLAY = 'Her emerald eyes close. The lake presses against windows like a lullaby. ' +
  'Fire dies to embers below. Dormitory breathes around her in unconnected rhythms that don\u2019t matter anymore.\n\n' +
  'Her hand rests on her chest.';
var WANT = 'Her emerald eyes close. The lake presses against windows like a lullaby. ' +
  'Fire dies to embers below. Dormitory breathes around her in unconnected rhythms that don\u2019t matter anymore.\n\n' +
  'Her hand rests on her chest.';

console.log('A — a replay-and-continue pass yields one clean copy');
var sb = loadApi([CUT, REPLAY]);
var API = sb.window.API;
API.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
  .then(function (out) {
    ok('assembled reply is the single stitched copy', out === WANT, JSON.stringify(out.slice(-90)));
    ok('no paragraph is duplicated', out.indexOf('Her emerald eyes close') === out.lastIndexOf('Her emerald eyes close'));
    ok('the mid-word seam healed tight', /unconnected rhythms/.test(out) && !/rhythms\s+ythms|rh\s+ythms/.test(out));
    ok('two provider calls (cut + one clean-up)', sb.window.fetch.calls === 2, 'calls=' + sb.window.fetch.calls);

    console.log('\nB — a plain continuation is untouched by the replay logic');
    var sb2 = loadApi(['The toast arrives, cr', 'usts at the edge. He takes a bite.']);
    var API2 = sb2.window.API;
    return API2.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
      .then(function (out2) {
        ok('word-split seam still joins tight', out2 === 'The toast arrives, crusts at the edge. He takes a bite.', JSON.stringify(out2));

        console.log('\nC — a pure rerun never doubles the text');
        var sb3 = loadApi([CUT, REPLAY.slice(0, REPLAY.indexOf('ythms') + 0), REPLAY.slice(0, REPLAY.indexOf('ythms'))]);
        /* rounds 2 and 3 rerun the tail and add nothing new (still cut) */
        var API3 = sb3.window.API;
        return API3.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
          .then(function (out3) {
            ok('the reply stays the single first pass', out3 === CUT, JSON.stringify(out3.slice(-70)));
            ok('…and a pure-rerun pass stops there (reruns will rerun again; no third gamble)', sb3.window.fetch.calls === 2, 'calls=' + sb3.window.fetch.calls);

            console.log('\nD — short floating echoes are not replays');
            var before4 = 'She pours. The water is';
        var piece4 = 'water is cold by now. Nobody speaks.';
            var sb4 = loadApi([before4, piece4]);
            var API4 = sb4.window.API;
            return API4.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
              .then(function (out4) {
                /* 'water is' (9 chars) is below the 40-char replay threshold:
                   the legacy space-glue join must apply, nothing stripped */
                ok('short echo seam follows legacy glue', out4 === 'She pours. The water is water is cold by now. Nobody speaks.', JSON.stringify(out4));
                console.log('\n' + pass + ' passed, ' + fail + ' failed');
                process.exit(fail ? 1 : 0);
              });
          });
      });
  })
  .catch(function (e) { console.error(e); process.exit(1); });
