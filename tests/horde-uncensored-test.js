/* Horde "Any available (uncensored)": the model filter, end to end.
 *
 * The Horde API carries no uncensored flag on its model list, so the option
 * resolves at send time to "the uncensored models with workers online" —
 * detected by the community name markers (abliterated / uncensored / heretic)
 * plus a few well-known uncensored families that ship without a marker.
 *
 * Pinned here: the detector, the availability filter, and the payload the
 * Horde actually receives for each of the three settings ('' fastest,
 * sentinel uncensored, a specific model) — plus the clear refusal when no
 * uncensored worker is online.
 *
 *   node /home/user/tests/horde-uncensored-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'horde.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function sameSet(a, b) {
  if (!a || a.length !== b.length) return false;
  var x = a.slice().sort(), y = b.slice().sort();
  for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/* Rows shaped like /api/v2/status/models?type=text — a live-shaped sample. */
var ROWS_ONLINE = [
  { type: 'text', name: 'koboldcpp/Qwen3.8-27B-Uncensored', count: 4, eta: 120, jobs: 2, performance: 5 },
  { type: 'text', name: 'koboldcpp/gemma-4-31B-it-heretic', count: 3, eta: 90, jobs: 1, performance: 4 },
  { type: 'text', name: 'koboldcpp/ReadyArt/Forgotten-Safeword-22B', count: 4, eta: 140, jobs: 3, performance: 6 },
  { type: 'text', name: 'koboldcpp/L3-8B-Stheno-v3.2', count: 4, eta: 110, jobs: 2, performance: 5 },
  { type: 'text', name: 'koboldcpp/mini-magnum-12b-v1.1', count: 2, eta: 60, jobs: 1, performance: 7 },
  { type: 'text', name: 'koboldcpp/Llama-3.2-3B', count: 1, eta: 30, jobs: 0, performance: 3 },
  { type: 'text', name: 'aphrodite/TheDrummer/Skyfall-31B-v4.2', count: 8, eta: 200, jobs: 9, performance: 8 },
  { type: 'text', name: 'koboldcpp/Offline-Uncensored-9B', count: 0, eta: 0, jobs: 0, performance: 0 }
];
var EXPECTED_ONLINE = [
  'koboldcpp/Qwen3.8-27B-Uncensored',
  'koboldcpp/gemma-4-31B-it-heretic',
  'koboldcpp/ReadyArt/Forgotten-Safeword-22B',
  'koboldcpp/L3-8B-Stheno-v3.2',
  'koboldcpp/mini-magnum-12b-v1.1'
];
/* Every model above with zero workers, plus one plain model that IS online. */
var ROWS_NO_UNCENS = ROWS_ONLINE.map(function (m) {
  return { type: m.type, name: m.name, count: 0, eta: 0, jobs: 0, performance: 0 };
}).concat([{ type: 'text', name: 'koboldcpp/Llama-3.2-3B', count: 2, eta: 30, jobs: 0, performance: 3 }]);

/** A fresh VM running the real horde.js against a mocked Horde API.
    Every text-generation POST is recorded in .payloads, in call order. */
function makeHorde(rows) {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, setTimeout: setTimeout, clearTimeout: clearTimeout,
    AbortController: AbortController, DOMException: DOMException
  };
  sandbox.window = sandbox;
  var handle = { payloads: [] };
  sandbox.fetch = function (url, opts) {
    var u = String(url);
    function res(data) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return null; } },
        text: function () { return Promise.resolve(JSON.stringify(data)); }
      });
    }
    if (u.indexOf('/status/models') >= 0) return res(rows);
    if (u.indexOf('/generate/text/async') >= 0) {
      handle.payloads.push(opts && opts.body ? JSON.parse(opts.body) : null);
      return res({ id: 'job-1' });
    }
    if (u.indexOf('/generate/text/status/') >= 0) {
      return res({ done: true, generations: [{ text: 'hello from horde', worker_name: 'w1', model: 'm1' }] });
    }
    return res({});
  };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'horde.js' });
  handle.Horde = sandbox.Horde;
  return handle;
}

console.log('\nthe detector');

var A = makeHorde(ROWS_ONLINE);
var H = A.Horde;
ok('the sentinel exists', typeof H.ANY_UNCENSORED === 'string' && H.ANY_UNCENSORED.length > 0);
ok('marker: uncensored', H.isUncensored('koboldcpp/Qwen3.8-27B-Uncensored'));
ok('marker: heretic', H.isUncensored('koboldcpp/gemma-4-31B-it-heretic'));
ok('marker: abliterated', H.isUncensored('Some/Abliterated-7B'));
ok('family: forgotten-safeword', H.isUncensored('koboldcpp/ReadyArt/Forgotten-Safeword-22B'));
ok('family: stheno', H.isUncensored('koboldcpp/L3-8B-Stheno-v3.2'));
ok('family: magnum', H.isUncensored('koboldcpp/mini-magnum-12b-v1.1'));
ok('plain instruct model is not flagged', !H.isUncensored('koboldcpp/Llama-3.2-3B'));
ok('unmarked RP model is not flagged', !H.isUncensored('aphrodite/TheDrummer/Skyfall-31B-v4.2'));
ok('sentinel displays as its option name', H.modelLabel(H.ANY_UNCENSORED) === 'Any available (uncensored)');
ok('blank displays as blank', H.modelLabel('') === '');
ok('a name displays as itself', H.modelLabel('koboldcpp/Llama-3.2-3B') === 'koboldcpp/Llama-3.2-3B');

console.log('\nthe availability filter');

var chain = H.anyUncensored().then(function (list) {
  ok('returns exactly the uncensored models with workers online',
    sameSet(list, EXPECTED_ONLINE), JSON.stringify(list));
  ok('an uncensored model with zero workers is excluded',
    list.indexOf('koboldcpp/Offline-Uncensored-9B') < 0);

  console.log('\nthe payload the Horde receives');

  return H.generateText({ model: H.ANY_UNCENSORED, prompt: 'hi', maxLength: 50 }).then(function (r) {
    ok('sentinel: the reply comes back', r.text === 'hello from horde', r.text);
    ok('sentinel: payload lists exactly the uncensored online models',
      sameSet(A.payloads[A.payloads.length - 1].models, EXPECTED_ONLINE),
      JSON.stringify(A.payloads[A.payloads.length - 1] && A.payloads[A.payloads.length - 1].models));
    return H.generateText({ model: '', prompt: 'hi', maxLength: 50 });
  }).then(function () {
    ok('blank: payload has no model filter (fastest wins)',
      !('models' in A.payloads[A.payloads.length - 1]));
    return H.generateText({ model: 'koboldcpp/Llama-3.2-3B', prompt: 'hi', maxLength: 50 });
  }).then(function () {
    var p = A.payloads[A.payloads.length - 1];
    ok('named: payload pins that one model',
      p.models && p.models.length === 1 && p.models[0] === 'koboldcpp/Llama-3.2-3B',
      JSON.stringify(p.models));
  });
});

var B = makeHorde(ROWS_NO_UNCENS);
var chain2 = B.Horde.anyUncensored().then(function (list) {
  console.log('\nno uncensored worker online');
  ok('the list is empty', list.length === 0, JSON.stringify(list));
  return B.Horde.generateText({ model: B.Horde.ANY_UNCENSORED, prompt: 'hi', maxLength: 50 })
    .then(function () { ok('it should have refused', false, 'no error'); })
    .catch(function (e) { ok('the refusal says why', /No uncensored workers/i.test(e.message), e.message); });
});

Promise.all([chain, chain2]).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL suite crashed', e && e.stack || e);
  process.exit(1);
});
