/* briefingecho-test — v1.39.8: the Horde reads its state briefing and
   sometimes writes it straight back as the story. A reply whose body is
   "(Referee texture: danger 8, prosperity 0 of 100.) / Time: Monday 06:35 /
   Stats: Mana 2, Guile -1 / Money: 0 coins / Carrying: ... / Tasks: ... /
   The world is working toward: ..." is not a scene - it is the sheet quoted
   aloud. The echo is stripped before validation (a reply that is ONLY the
   briefing is invalid, so the repair lane regenerates), at commit (new
   turns), when the log is replayed to the model (old echoes cannot teach
   new ones), and at render (old saves read clean). Real screenshots:

     "(Referee texture: danger 8, prosperity 0 of 100.)"                */

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

/* the exact echo body from the phone, turn 10 of The Hand's Doorstep */
var ECHO = '(Referee texture: danger 8, prosperity 0 of 100.)\n' +
  'Time: Monday 06:35\n' +
  'Stats: Mana 2, Guile -1\n' +
  'Money: 0 coins\n' +
  'Carrying: 2 coins, amber compass needle, one good boot and one worse, paperwork (receipt, map)\n' +
  'Tasks: learn what this place is called and what hunts inside it; Prove yourself at the evaluation — present your letter to Walter in the Hand hall and be ready in the yard at dawn.; Rats at the ruin quarter — copper-rank contract pinned mid-wall at the contract hall; players take coin and a hand-bite of reputation.; The overgrown temple — Corvin the Sifter owns a weathered stone map of wild paths; his price is a moving-out favor for what time the patrol map comes to his caches.\n' +
  'The world is working toward: The Hand brings its strength back - now: "post the city-wide call for rookies at dawn on the notice board".';

try {
  vm; // loaders run below inside main
} catch (e) { /* noop */ }

(async function main() {
  try {
    var HW = loadHW();
    var src = fs.readFileSync(SRC, 'utf8');
    var viewsSrc = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'views.js'), 'utf8');

    console.log('A — the stripper itself, pure');
    ok('HW.stripBriefingEcho is exported', typeof HW.stripBriefingEcho === 'function');
    if (typeof HW.stripBriefingEcho === 'function') {
      ok('the whole screenshot echo strips to nothing', HW.stripBriefingEcho(ECHO).trim() === '',
         JSON.stringify(HW.stripBriefingEcho(ECHO)));
      var mix = HW.stripBriefingEcho('The yard smells of oiled leather.\n' +
        'The world is working toward: The Hand brings its strength back.\n[[clock:+60]]');
      ok('narration survives a trailing goal echo', mix.indexOf('oiled leather') !== -1);
      ok('...and the goal line is gone', mix.indexOf('working toward') === -1);
      ok('prose that MENTIONS tasks is not a briefing line',
         HW.stripBriefingEcho('Her tasks weighed more than the iron bell.') === 'Her tasks weighed more than the iron bell.');
      ok('a plain scene passes through untouched',
         HW.stripBriefingEcho('Kyrian bows. The yard is empty at dawn.') === 'Kyrian bows. The yard is empty at dawn.');
      ok('the texture parenthesis is dropped wherever it stands',
         HW.stripBriefingEcho('Steel rings once.\n(Referee texture: danger 3 of 100.)\nTwice.').indexOf('Referee texture') === -1);
      ok('clock echoes are caught', HW.stripBriefingEcho('Time: Monday 09:30') === '');
    }

    console.log('B — validation refuses an echo-only reply (repair lane gets it)');
    var run = { id: 'r1', turn: 3, log: [{ role: 'assistant', content: 'A different scene entirely.' }], stats: {}, quests: [], inventory: [], reputation: [] };
    var v = HW.validateReply(WORLD, run, 'You are ready', ECHO);
    ok('the echo-only reply is NOT ok', v.ok === false, JSON.stringify(v.reasons));
    ok('...and the reason names the briefing', v.reasons.join(' ').toLowerCase().indexOf('briefing') !== -1,
       JSON.stringify(v.reasons));
    var v2 = HW.validateReply(WORLD, run, 'You are ready', 'The yard waits. [[clock:+10]]');
    ok('a real scene still passes', v2.ok === true, JSON.stringify(v2.reasons));

    console.log('C — it is wired at every joint the echo can pass');
    ok('the commit path strips briefing as well as tags',
       /stripBriefingEcho\(stripTagArtifacts\(|stripTagArtifacts\(stripBriefingEcho\(/.test(src));
    ok('the model never READS old echoes (log replay strips them)',
       src.split('stripBriefingEcho').length >= 4);
    ok('the referee is TOLD not to quote the briefing', /Never restate|never quote|do not quote/i.test(src));
    ok('the view heals old saved turns at render', /stripBriefingEcho/.test(viewsSrc));
  } catch (e) {
    fail++;
    console.log('  FAIL battery threw  -> ' + (e && e.message || e));
  }
  console.log('\nbriefingecho-test: ' + (fail ? (fail + ' FAILED, ') : '') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
