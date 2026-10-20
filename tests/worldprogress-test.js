/* worldprogress-test — v1.39.6: the world's turn must never sit silent.
   Chats live-report queue position, worker-empties, cut-off continuations
   and stream text; world's send passed NEITHER callback, so a 1-4 minute
   Horde turn looked dead. Now the typing widget carries the same live
   status plus a tail of the reply as it arrives, on both the first answer
   and the repair pass. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readIdx = () => fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'index.html'), 'utf8');

/* carving discipline from chatwork-test: run an isolated `Name = function ...`
   out of app.js in a small sandbox, never a DOM-dependent whole-file load. */
function carve(name) {
  const src = read('app.js');
  const start = src.indexOf(name + ' = function ');
  if (start === -1) return null;
  const body = src.slice(start, src.indexOf('\n  };', start) + 5);
  const sandbox = { console, JSON, Math, Object, Array, String, Promise, App: { state: {} } };
  sandbox.window = sandbox;
  try { vm.runInNewContext(body, sandbox, { filename: name }); }
  catch (e) { return { error: e.message }; }
  return sandbox;
}

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const appSrc = read('app.js');

    console.log('A — the main world turn reports like a chat does');
    /* the worldSend generate call is the one inside the world turn block;
       locate it relative to the typing widget it guards */
    const sendAt = appSrc.indexOf("var typing = $('#wr-typing');");
    ok('the world turn code lives in app.js', sendAt !== -1);
    const block = sendAt === -1 ? '' : appSrc.slice(sendAt, sendAt + 12000);
    ok('the main turn passes an onProgress callback', /onProgress:\s*(function|wrProgress)/.test(block));
    ok('the main turn passes an onDelta callback', /onDelta:\s*(function|wrDelta)/.test(block));

    console.log('B — the repair pass reports too (second-call silence was real)');
    const repAt = appSrc.indexOf('function repairOnce');
    ok('repairOnce exists (the one retry lane)', repAt !== -1);
    const repBlock = repAt === -1 ? '' : appSrc.slice(repAt, repAt + 6500);
    ok('the repair generate passes onProgress', /onProgress:\s*function/.test(repBlock));
    ok('...and says it is REPAIRING, not faking the first silence',
       /repair/i.test(repBlock.replace(/\s/g, ' ')) && /onProgress[\s\S]{0,600}repair|repair[\s\S]{0,200}onProgress/i.test(repBlock));

    console.log('C — the status mapping is the honest vocabulary');
    ok('queued position shows', /queued[\s\S]{0,80}position/i.test(appSrc));
    ok('processing shows volunteer work', /volunteer GPU|\brocessing\b/i.test(appSrc));
    ok('empty replies are named, not silent', /Worker sent nothing|empty/i.test(appSrc));

    console.log('D — the mapping runs for real (carved from app.js)');
    const sb = carve('App.worldProgressText');
    if (!sb || sb.error || typeof sb.App.worldProgressText !== 'function') {
      ok('App.worldProgressText exists and loads', false, sb && sb.error ? sb.error : 'carve failed');
    } else {
      ok('App.worldProgressText exists and loads', true);
      ok('a queued state reads position', /position 3/i.test(sb.App.worldProgressText({ state: 'queued', queuePosition: 3 })));
      ok('an empty reply reads like a retry ask', /worker|nothing/i.test(sb.App.worldProgressText({ state: 'empty', attempt: 1, of: 3 })));
      ok('a continuation reads honest', /cut off|finishing|continuing/i.test(sb.App.worldProgressText({ state: 'continuing' })));
      ok('unknown states degrade to Working', /work/i.test(sb.App.worldProgressText({ state: 'mystery' })));
    }

    console.log('E — the widget grew a mouth');
    const idx = readIdx();
    ok('a label element exists under #wr-typing', /id="wr-typing-label"/.test(idx));
    ok('a stream preview element exists', /id="wr-typing-preview"/.test(idx));
    ok('world write-back exists in the app (label setter)', /wr-typing-label/.test(appSrc));
    ok('the stream tail lands in the preview', /wr-typing-preview/.test(appSrc));
    ok('the repair progress is visibly polite', /Repairing|repairing/.test(block + repBlock));
    ok('label and preview get cleared when the scene ends',
       /wr-typing-label[\s\S]{0,300}(hidden|textContent\s*=\s*'')/.test(block));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldprogress-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
