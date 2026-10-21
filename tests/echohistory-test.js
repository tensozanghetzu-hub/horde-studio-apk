/* echohistory-test — v1.39.9: the repeat-guard used to watch only the LAST
   referee answer. On The Hand's Doorstep the model re-wrote a scene from
   THREE turns back - fresh standing on the yard, "your evaluation begins" -
   and rewound the story from the middle of the challenge to before it
   started. The guard now compares against the referee's last FOUR answers,
   and the prompt is told the story only moves forward. */

'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'hordeworld.js');
var WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-panic.horde_world'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function loadHW() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, globalThis: null,
    fetch: function (f) {
      var file = path.join(__dirname, '..', 'horde-studio-mobile', String(f));
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
      } });
    }
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'hordeworld.js' });
  return sandbox.HW;
}

/* the rewind the phone hit: fresh description of the very yard scene that
   had played three turns earlier */
var OLDER_SCENE = 'Kyrian performs slow drills with a heavy practice sword near the ' +
  'center while newer recruits cluster nervously at the edge, and Ilea Spears oversees ' +
  'the pinning of new contracts by the Contract Hall. Walter stands near the desk with ' +
  'his usual air of detached judgment. This is it your evaluation begins now rookies.';
var LAST_SCENE = 'Walter steps away from his desk and walks deliberately toward the ' +
  'center of the yard, boots clicking sharply on packed earth, his shadow eclipsing ' +
  'the morning light as he calls your name and tells you to begin.';
var BETWEEN = 'Composure holds firm as you scan the yard, noting the pattern of scars ' +
  'on a sparring partner and the moment Kyrian wipes sweat from his brow, alert but at ease.';

(async function main() {
  try {
    var HW = loadHW();
    var src = fs.readFileSync(SRC, 'utf8');

    console.log('A — an echo of an OLDER scene is refused');
    var run = { id: 'r1', turn: 12, stats: {}, quests: [], inventory: [], reputation: [],
      log: [
        { role: 'assistant', content: OLDER_SCENE },
        { role: 'user', content: 'You remain calm and vigilant.' },
        { role: 'assistant', content: BETWEEN },
        { role: 'user', content: 'Time passes' },
        { role: 'assistant', content: LAST_SCENE },
        { role: 'user', content: 'You remain calm. Muscle memory kicks in.' }
      ] };
    var v = HW.validateReply(WORLD, run, 'You remain calm. Muscle memory kicks in.', OLDER_SCENE + ' [[clock:+5]]');
    ok('the rewound scene is NOT ok', v.ok === false, JSON.stringify(v.reasons));
    ok('...and the reason says WHICH echo it was', /earlier scene/i.test(v.reasons.join(' ')),
       JSON.stringify(v.reasons));

    console.log('B — the previous behaviour stands');
    var v2 = HW.validateReply(WORLD, run, 'x', LAST_SCENE + ' more words here padding the repeat');
    ok('a repeat of the LAST answer is still refused', v2.ok === false && /repeats the last answer/.test(v2.reasons.join(' ')),
       JSON.stringify(v2.reasons));
    var v3 = HW.validateReply(WORLD, run, 'x',
      'Steel meets air as the first exchange begins in earnest. [[check:combat]]');
    ok('a genuinely new scene still passes', v3.ok === true, JSON.stringify(v3.reasons));

    console.log('C — the prompt is told the story only moves forward');
    ok('a forward-only instruction exists', /moves forward/i.test(src));
    ok('it forbids rewinding or re-describing played scenes', /rewind|re-describ|already[- ]played|from the beginning/i.test(src));
  } catch (e) {
    fail++;
    console.log('  FAIL battery threw  -> ' + (e && e.message || e));
  }
  console.log('\nechohistory-test: ' + (fail ? (fail + ' FAILED, ') : '') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
