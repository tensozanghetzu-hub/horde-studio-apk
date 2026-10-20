/* worldstream-test — v1.39.7: the world's live stream preview must read like
   the turn taking shape, not like the wire protocol. The model mixes the
   narration with [[bookkeeping tags]]; the finished turn gets them stripped
   before printing, so the in-progress tail must strip them too. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

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
    const src = read('app.js');
    /* the tail helper must exist PURE beside the progress mapper */
    const sb = carve('App.worldStreamTail') || carve('App.worldPreview');

    console.log('A — the preview speaks prose, not bookkeeping');
    if (!sb || sb.error || typeof (sb.App.worldStreamTail || sb.App.worldPreview) !== 'function') {
      ok('a pure stream-tail helper exists in app.js', false, sb && sb.error ? sb.error : 'carve failed');
    } else {
      ok('a pure stream-tail helper exists in app.js', true);
      const tail = sb.App.worldStreamTail || sb.App.worldPreview;
      ok('complete tags are stripped', !/\[\[/.test(tail('the bell rings. [[clock:+60]] You look up.')) &&
         /bell rings/.test(tail('the bell rings. [[clock:+60]] You look up.')));
      ok('a half-written trailing tag never shows', !/\[\[/.test(tail('she turns. [[rep:fac_han')));
      ok('the narration survives intact', tail('Kyrian bows. [[move:loc_yard]] [[cash:+5]] Done.').indexOf('Kyrian bows.') !== -1);
      ok('a turn that is ONLY tags so far shows nothing', tail('[[clock:+60]][[rep:a|+1]]') === '');
      ok('plain text passes through untouched', tail('just words, no tags at all') === 'just words, no tags at all');
      ok('nothing degenerates on empty input', tail('') === '' && tail(null) === '');
    }

    console.log('B — it is wired where the stream lands');
    const at = src.indexOf('var wrDelta');
    ok('the world stream handler exists', at !== -1);
    const block = at === -1 ? '' : src.slice(at, at + 700);
    ok('the preview runs the raw text through the stripper first',
       /worldStreamTail|worldPreview/.test(block));
    ok('the raw slice trick is gone from the preview', !/\.slice\(-160\)\s*\.trim\(\)\s*;/.test(block) ||
       /worldStreamTail|worldPreview/.test(block));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldstream-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
