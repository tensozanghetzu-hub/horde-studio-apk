/* worldstop-test — v1.39.9: a world turn in flight can be stopped, like a
   chat generation. Chats abort through an AbortController wired down to the
   Horde call; the world's generate calls carried NO signal, so nothing
   could cancel the queue wait, the GPU pass or the repair. A stopped turn
   is no turn at all: the pre-turn snapshot returns and the words go back
   into the box (the AbortError branch already does that - it just had no
   signal to fire it). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const appSrc = read('js/app.js');
    const idx = read('index.html');
    const css = read('css/app.css');

    /* scope the whole worldSend body: from the pre-turn snapshot to the
       final cleanup that hides the typing row */
    const at = appSrc.indexOf('var pre = HW.cloneRun(run);');
    ok('the world send exists', at !== -1);
    const body = at === -1 ? '' : appSrc.slice(at, at + 16000);

    console.log('A — the stop button exists where the wait lives');
    ok('a stop control sits inside the typing row', /<button[^>]*id="wr-stop"[^>]*>/.test(idx) &&
       idx.indexOf('wr-stop') > idx.indexOf('wr-typing-label') - 400);
    ok('the stop control is styled', /\.wr-stop/.test(css));

    console.log('B — the signal reaches both generations');
    ok('an AbortController is made for the turn', /AbortController/.test(body));
    const signalCount = (body.match(/signal:\s*\w+/g) || []).length;
    ok('both the first answer AND the repair take the signal', signalCount >= 2,
       'found ' + signalCount);
    ok('the stop control aborts it', /wr-stop[\s\S]{0,400}\.abort\(\)|\.abort\(\)[\s\S]{0,400}wr-stop/.test(body)
       || /getElementById\('wr-stop'\)|\$\('#wr-stop'\)/.test(appSrc));

    console.log('C — a stopped turn is NO turn at all');
    ok('the AbortError branch restores the pre-turn state',
       /AbortError[\s\S]{0,300}adopt\(pre\)/.test(body));
    ok('...and gives the words back', /AbortError[\s\S]{0,600}input\.value\s*=\s*text/.test(body));
    ok('...and says so in plain words', /Stopped/.test(body));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldstop-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
