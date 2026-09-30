/* Horde empty-reply retries: a worker that answers a text job with nothing
 * gets replaced by resubmitting — up to 10 attempts inside a 90-second
 * budget (bumped from 5 / 45s on request: the public cluster's blank rate
 * made 5 runs out on busy days).
 *
 *   node /home/user/tests/horde-empty-retry-test.js
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

/** A fresh VM running the real horde.js against a mocked Horde API.
    `statusQueue` is a list of {empty: true} / {text: '…'} responses served
    one per job poll, in order; the last one repeats forever.
    `pollDelay` ms of fake job-processing time per poll (deterministic
    budget tests). */
function makeHorde(statusQueue, pollDelay) {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, setTimeout: setTimeout, clearTimeout: clearTimeout,
    AbortController: AbortController, DOMException: DOMException
  };
  sandbox.window = sandbox;
  var handle = { posts: 0, polls: 0 };
  sandbox.fetch = function (url) {
    var u = String(url);
    function res(data) {
      var p = Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return null; } },
        text: function () { return Promise.resolve(JSON.stringify(data)); }
      });
      return pollDelay ? new Promise(function (r) { setTimeout(function () { r(p); }, pollDelay); }) : p;
    }
    if (u.indexOf('/status/models') >= 0) return res([]);
    if (u.indexOf('/generate/text/async') >= 0) { handle.posts++; return res({ id: 'job-' + handle.posts }); }
    if (u.indexOf('/generate/text/status/') >= 0) {
      handle.polls++;
      var i = Math.min(handle.polls - 1, statusQueue.length - 1);
      var r = statusQueue[i];
      return res(r.empty
        ? { done: true, generations: [] }
        : { done: true, generations: [{ text: r.text, worker_name: 'w' + handle.polls, model: 'm1' }] });
    }
    return res({});
  };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'horde.js' });
  handle.Horde = sandbox.Horde;
  return handle;
}
function empties(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ empty: true });
  return out;
}
var BASE = { prompt: 'hi', maxLength: 50, apikey: '0000000000' };

(async function main() {
  console.log('\nexplicit retry count is honored');

  var A = makeHorde(empties(5));
  var errA = null;
  try { await A.Horde.generateText(Object.assign({ emptyTries: 3 }, BASE)); } catch (e) { errA = e; }
  ok('3 tries → gives up after 3', errA !== null && /after 3 tries/.test(errA.message), errA && errA.message);
  ok('…and exactly 3 jobs were posted', A.posts === 3, 'posts=' + A.posts);

  var B = makeHorde(empties(2).concat([{ text: 'made it on the third' }]));
  var rB = await B.Horde.generateText(Object.assign({ emptyTries: 4 }, BASE));
  ok('two blanks then a worker answers → the text comes back', rB.text === 'made it on the third', rB.text);
  ok('…reported as the 3rd try', rB.tries === 3, 'tries=' + rB.tries);
  ok('…with exactly 3 posts', B.posts === 3, 'posts=' + B.posts);

  console.log('\nthe default is 10 attempts');

  var C = makeHorde(empties(9).concat([{ text: 'tenth time luck' }]));
  var progress = [];
  var rC = await C.Horde.generateText(Object.assign({}, BASE, {
    onProgress: function (info) { if (info.state === 'empty') progress.push(info); }
  }));
  ok('9 blanks then success on attempt 10 → the default runs 10', rC.tries === 10, 'tries=' + rC.tries);
  ok('…with exactly 10 posts', C.posts === 10, 'posts=' + C.posts);
  ok('the progress line counts (2 of 10)', progress.length === 9 &&
    progress[0].attempt === 1 && progress[0].of === 10 &&
    progress[8].attempt === 9 && progress[8].of === 10,
    JSON.stringify(progress[0]) + ' … ' + JSON.stringify(progress[8]));

  console.log('\nthe time budget still caps a hung worker');

  /* every poll takes 30 ms, so a 1 ms budget is guaranteed to expire
     before the second try starts (the mock is otherwise faster than the
     millisecond granularity of Date.now()) */
  var D = makeHorde(empties(50), 30);
  var errD = null;
  try { await D.Horde.generateText(Object.assign({ emptyBudget: 1 }, BASE)); } catch (e) { errD = e; }
  ok('a 1 ms budget stops after the first blank, no matter the try count',
    errD !== null && /after 1 try/.test(errD.message), errD && errD.message);
  ok('…and only one job was posted', D.posts === 1, 'posts=' + D.posts);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
