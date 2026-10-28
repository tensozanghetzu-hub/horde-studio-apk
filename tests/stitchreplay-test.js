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
 *   C — pure rerun (nothing new) → the reply keeps ONE copy; v1.39.29: the
 *       rerun streak spends the whole 3-round budget instead of stopping at
 *       two with a dangling sentence (a rerun spends a round, it doesn't
 *       end the story)
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
  sb.window.fetch = function (url, init) {
    sb.window.fetch.calls++;
    sb.window.fetch.lastBody = init && init.body ? JSON.parse(init.body) : null;
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
        var stubRerun = REPLAY.slice(0, REPLAY.indexOf('ythms'));
        var sb3 = loadApi([CUT, stubRerun, stubRerun]);
        /* rounds 2 and 3 rerun the tail and add nothing new (still cut) */
        var API3 = sb3.window.API;
        return API3.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
          .then(function (out3) {
            ok('the reply stays the single first pass', out3 === CUT, JSON.stringify(out3.slice(-70)));
            /* v1.39.29: rerun rounds spend the remaining 3-round budget;
               nothing can double because the repeated tail is stripped. */
            ok('…and a rerun streak stops at the 3-round ceiling, still single-copy', sb3.window.fetch.calls === 3, 'calls=' + sb3.window.fetch.calls);

        console.log('\nE — v1.39.29: a rerun round spends a round, it does not END the story');
        /* round 2 is a pure rerun of the cut tail (nothing new); round 3 is
           the model finally continuing to a real sentence end. Under the
           v1.39.27 hard-stop this returned CUT with its open ending and the
           user was left reading a bubble that trails off — the budget the
           app already allows (3 rounds) was never spent finishing it. */
        var CLOSER = 'ythms that don\u2019t matter anymore. Her hand rests.';
        var WANT_E = CUT + CLOSER;
        var sb5 = loadApi([CUT, REPLAY.slice(0, REPLAY.indexOf('ythms')), CLOSER]);
        var API5 = sb5.window.API;
        return API5.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
          .then(function (out5) {
            ok('the sentence actually closes', out5 === WANT_E, JSON.stringify(out5.slice(-70)));
            ok('the rerun round stayed single-copy', out5.indexOf('Her emerald eyes close') === out5.lastIndexOf('Her emerald eyes close'));
            ok('the mid-word seam still heals after the wasted round', /unconnected rhythms/.test(out5));
            ok('all three rounds of the budget were spent', sb5.window.fetch.calls === 3, 'calls=' + sb5.window.fetch.calls);

            console.log('\nF — v1.39.30: a seeded continue tells the endpoint IN WORDS to finish the cut text');
            /* Reproduced from the user's screenshot: a Continue seeded at
               "…Crabbe" came back "Draconica's expression doesn't change…"
               — a FRESH reply beat. The trailing assistant PREFILL is not
               portable: this OpenRouter endpoint treats it as a finished
               turn and writes the next beat from scratch. The fix pins the
               instruction as a system nudge immediately before the seed. */
            var sb6 = loadApi([' and Goyle exchange looks. The moment breaks, and she turns to you.']);
            var API6 = sb6.window.API;
            var SEED = 'The classroom holds its breath. Pansy whispering stops. Crabbe';
            return API6.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null, continueFrom: SEED })
              .then(function (out6) {
                var body = sb6.window.fetch.lastBody;
                var last = body && body.messages[body.messages.length - 1];
                var prev = body && body.messages[body.messages.length - 2];
                ok('the seed still rides as a trailing assistant turn', !!last && last.role === 'assistant' && last.content === SEED, JSON.stringify(last && last.role));
                ok('a system nudge is pinned right before the seed', !!prev && prev.role === 'system' && /[Cc]ontinue/.test(prev.content) && /cut/i.test(prev.content));
                ok('the text picks up from where it left', out6 === SEED + ' and Goyle exchange looks. The moment breaks, and she turns to you.', JSON.stringify(out6.slice(-70)));

                console.log('\nG — a parroted bracket nudge is stripped before it can mangle the seam');
                var sb7 = loadApi(['[Continue the reply from where it is cut off] and that is all she says.']);
                var API7 = sb7.window.API;
                return API7.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null, continueFrom: SEED })
                  .then(function (out7) {
                    ok('no bracket instruction survives into the prose', out7 === SEED + ' and that is all she says.', JSON.stringify(out7.slice(-60)));

                    console.log('\nH — a plain first reply carries NO continue nudge');
                    var sb8 = loadApi(['A quiet first reply.']);
                    var API8 = sb8.window.API;
                    return API8.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null })
                      .then(function () {
                        var b8 = sb8.window.fetch.lastBody;
                        var l8 = b8 && b8.messages[b8.messages.length - 1];
                        ok('no trailing prefill and no cut-off nudge anywhere', !!l8 && l8.role !== 'assistant' &&
                          b8.messages.every(function (m) { return !/cut off/i.test(m.content || ''); }), JSON.stringify(l8 && l8.role));
                console.log('\nI — v1.39.31: a sub-40 fragment replay that STRADDLES a word is a stutter, not a coincidence');
                /* user screenshot: cut at "…Fingers interl", the next pass
                   replayed "Fingers interl" then continued "…aced…" — 14
                   chars, below the replay line, pasted whole: "Fingers
                   interl Fingers interlaced". A coincidence echo continues
                   AFTER a space ("water is cold"); a stutter echo continues
                   INTO the fragment. Only the stutter gets stripped. */
                var BEFORE_ST = 'Draconica\u2019s hand finding Bluscript\u2019s under the desk. Fingers interl';
                var STUTTER = 'Fingers interlaced beneath the desk. Platinum snake bracelets pulse.';
                var WANT_I = BEFORE_ST + 'aced beneath the desk. Platinum snake bracelets pulse.';
                var sb9 = loadApi([BEFORE_ST, STUTTER]);                var API9 = sb9.window.API;
                return API9.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null, continueFrom: BEFORE_ST })
                  .then(function (out9) {
                    ok('the fragment heals into one whole word', out9 === WANT_I, JSON.stringify(out9.slice(-80)));
                    ok('no stutter anywhere in the prose', out9.indexOf('Fingers interl Fingers') === -1, JSON.stringify(out9.slice(-90)));

                    console.log('\nJ — v1.39.31: a WHOLE cut word restated by the next pass is also a stutter');
                    /* same seam, word-boundary cut: "…Crabbe" answered with
                       "Crabbe and Goyle exchange looks." — the old glue
                       tight-joined it into "CrabbeCrabbe". */
                    var BEFORE_J = 'The classroom holds its breath. Pansy whispering stops. Crabbe';
                    var RESTATE = 'Crabbe and Goyle exchange looks. The moment breaks.';
                    var WANT_J = BEFORE_J + ' and Goyle exchange looks. The moment breaks.';
                    var sb10 = loadApi([BEFORE_J, RESTATE]);
                    var API10 = sb10.window.API;
                    return API10.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null, continueFrom: BEFORE_J })
                      .then(function (out10) {
                        ok('the restated word collapses to one', out10 === WANT_J, JSON.stringify(out10.slice(-70)));

                        console.log('\nK — the coincidence echo stays D-proof: "water is" untouched');
                        var BEFORE_K = 'She pours. The water is';
                        var KB = loadApi(['water is cold by now. Nobody speaks.']);
                        var API11 = KB.window.API;
                        return API11.generate({ settings: SETTINGS, character: CHAR, history: HIST, session: { id: 's1' }, signal: null, note: null, continueFrom: BEFORE_K })
                          .then(function (out11) {
                            ok('short echo seam follows legacy glue', out11 === 'She pours. The water is water is cold by now. Nobody speaks.', JSON.stringify(out11));
                            console.log('\n' + pass + ' passed, ' + fail + ' failed');
                            process.exit(fail ? 1 : 0);
                          });
                      });
                  });
                  });
              });
          });
          });
      });
      });
  })
  .catch(function (e) { console.error(e); process.exit(1); });
