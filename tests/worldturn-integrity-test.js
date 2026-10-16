/* v1.29.1 — world-turn ledger integrity (the "Lantern Marches" handoff).
 *
 * P1: App.worldTurn used to run HW.applyTags on the LIVE run to judge the
 * first model reply, then finishTurn ran applyTags on that same live run
 * AGAIN — a double application on every turn, and on a repair the draft's
 * effects (the player never saw it) persisted and the repaired answer was
 * applied on top. Clocks, cash, stats, inventory, quests, companions,
 * location and the dice seed could all disagree with the displayed answer.
 *
 * Contract now: every candidate is evaluated on an isolated copy of the
 * pre-turn run; only the validated FINAL answer mutates persistent state,
 * exactly once; failures (bad output, rejected bookkeeping, failed repair,
 * API error, failed save) leave the pre-turn run intact and put the input
 * back for a retry.
 *
 * Plus the output guards from the same handoff:
 *   - a reply with code fences or a planning trailer ("Self-Correction
 *     Check … Ready to output") is not a world turn; its tags never run
 *   - a near-verbatim repeat of the opening does not commit its tags
 *   - an unknown bracket command is refused, not left in the story
 *   - empty replies do not become "…" turns
 *   - checks: exactly one resolution per final turn; a draft's check
 *     request consumes no dice and leaves no trace
 *   - correctState: tasks can actually be removed, and the clock can be
 *     shifted, so an already-damaged run can be repaired
 *   - the Horde reports which model/worker actually answered
 *
 *   node /home/user/tests/worldturn-integrity-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }
var WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-marches.horde_world'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- a small honest DOM (worldturnbar pattern) ------------ */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '',
    scrollTop: 0, scrollHeight: 0,
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    addEventListener: function () {},
    getAttribute: function () { return null; },
    setAttribute: function () {},
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var els = {
  '#wr-input': el(),
  '#wr-hud': el(),
  '#wr-thread': el(),
  '#wr-typing': el(),
  '#bar-title': el(),
  '#bar-sub': el(),
  '#btn-back': el(),
  '#btn-bar-action': el()
};
var documentStub = {
  addEventListener: function () {},
  querySelector: function (sel) { return els[sel] || null; },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return els['#' + id] || null; }
};

/* ---------------- fake IDB: counts saves, can fail them ---------------- */
var saves = 0, saveFail = false;
var fakeDb = {
  put: function (s, v) {
    if (s !== 'worldRuns') return Promise.resolve();
    if (saveFail) return Promise.reject(new Error('disk full'));
    saves++;
    return Promise.resolve();
  },
  getAll: function () { return Promise.resolve([]); },
  get: function () { return Promise.resolve(null); },
  del: function () { return Promise.resolve(); }
};

/* ---------------- the referee's script ---------------------------------- */
var apiCalls = 0;
var replies = [];   /* API.generate resolves with replies[callIndex]       */
var throws = {};    /* throws[callIndex] = error message                   */
var API = {
  generate: function () {
    apiCalls++;
    var i = apiCalls - 1;
    if (throws[i]) return Promise.reject(new Error(throws[i]));
    return Promise.resolve(replies[i] !== undefined ? replies[i] : '…');
  }
};

var toasts = [];
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  fetch: function () { return Promise.resolve({ ok: false }); },
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function (m) { toasts.push(String(m)); },
    sheet: function () {}
  },
  Store: { settings: { provider: 'horde' } },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: API,
  IDB: fakeDb
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
vm.runInNewContext(fs.readFileSync(src('js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

var HW = sandbox.HW;
var App = sandbox.App;

/* ---------------- scenario setup ---------------------------------------- */

var QUESTION = 'What does the slip say?';

function freshWorld() {
  var world = HW.parse(JSON.parse(JSON.stringify(WORLD)));
  var run = HW.start(world, null);
  /* a run nobody has entered yet opens with its own words (openWorldRun) */
  if (!run.log.length && world.intro) {
    run.log.push({ role: 'assistant', content: world.intro, at: Date.now() });
  }
  App.state.world = world;
  App.state.worldRun = run;
  App.state.worldBusy = false;
  App.state.worldStatusOpen = false;
  apiCalls = 0; replies = []; throws = {}; toasts = []; saves = 0;
  els['#wr-input'].value = '';
  App.go('worldrun');
  return { world: world, run: run };
}

function send(text) {
  els['#wr-input'].value = text || QUESTION;
  App.worldTurn();
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); }
function live() { return App.state.worldRun; }
function assistants(run) { return (run.log || []).filter(function (m) { return m.role === 'assistant'; }); }
function users(run) { return (run.log || []).filter(function (m) { return m.role === 'user'; }); }
function checks(run) { return (run.log || []).filter(function (m) { return m.role === 'check'; }); }

/* ====================================================================== */

(async function () {

  console.log('\n1. a clean turn applies its tags exactly once');
  var s1 = freshWorld();
  var pre1 = JSON.parse(JSON.stringify(s1.run));
  replies = ['Bram slides the work slip back. "That is yours now." [[clock:+5]][[cash:+1]][[with:Bram Kest]]'];
  send();
  await settle();
  var r1 = live();
  eq('one API call', apiCalls, 1);
  eq('one turn', r1.turn, 1);
  eq('the +5 minute tag applied once', r1.extraMinutes, 5);
  eq('the +1 crown applied once', r1.stats.cash, 13);
  eq('the clock reads the single delta', HW.clockOf(r1, s1.world.hudConfig).text, 'Thursday 15:20');
  eq('Bram joined once', (r1.companions || []).length, 1);
  eq('nothing was refused', (r1.rejections || []).length, 0);
  eq('one save', saves, 1);
  eq('the player line is in the log once', users(r1).length, 1);
  eq('the answer is in the log once', assistants(r1).length, 2);
  eq('the pre-turn state is untouched in the save', r1.id, pre1.id);

  console.log('\n2. a rejected draft leaves no trace; the repair is authoritative');
  var s2 = freshWorld();
  var seed2 = live().seed;
  replies = [
    'Pell signs the work slip. [[quest:Find Heartglass Shard]][[with:Bram Kest]][[clock:+5]][[roll:1d20:check:Nope]]',
    'Rain rattles the guild hall. No task has been accepted yet. [[clock:+5]]'
  ];
  send();
  await settle(120);
  var r2 = live();
  eq('one turn', r2.turn, 1);
  eq('the repair was the second call', apiCalls, 2);
  ok('the draft\'s quest never became a task', !(r2.quests || []).length, JSON.stringify(r2.quests));
  ok('the draft\'s companion never joined', !(r2.companions || []).length, JSON.stringify(r2.companions));
  eq('only the final clock delta', r2.extraMinutes, 5);
  eq('the draft\'s check consumed no dice', r2.seed, seed2);
  eq('no check line from the draft', checks(r2).length, 0);
  ok('the draft\'s prose is not in the story',
    !(r2.log || []).some(function (m) { return /Pell signs/.test(m.content); }));
  eq('the repair\'s prose is the story',
    assistants(r2)[assistants(r2).length - 1].content, 'Rain rattles the guild hall. No task has been accepted yet.');
  eq('one save', saves, 1);

  console.log('\n3. a companion already in the pre-turn party is still refused');
  var s3 = freshWorld();
  replies = ['Bram nods once. [[with:Bram Kest]]'];
  send();
  await settle();
  eq('first turn: Bram joins', (live().companions || []).length, 1);
  apiCalls = 0;   /* a fresh queue for the next turn */
  replies = ['Bram nods again. [[with:Bram Kest]]', 'Bram nods again.'];
  send();
  await settle(120);
  var r3 = live();
  eq('second turn committed', r3.turn, 2);
  eq('still exactly one Bram', (r3.companions || []).length, 1);
  ok('the duplicate was refused, not swallowed',
    (r3.rejections || []).some(function (x) { return /already with the player/.test(x.reason); }));
  eq('the clean repair is the story',
    assistants(r3)[assistants(r3).length - 1].content, 'Bram nods again.');

  console.log('\n4. a failed repair changes nothing');
  var s4 = freshWorld();
  replies = ['Bram signs the slip. [[move:loc_nowhere]][[clock:+5]]'];
  throws[1] = 'the repair went nowhere';
  send();
  await settle(120);
  var r4 = live();
  eq('no turn committed', r4.turn, 0);
  eq('no clock drift', r4.extraMinutes, 0);
  eq('no task, no companion', (r4.quests || []).length + (r4.companions || []).length, 0);
  eq('the optimistic player line is gone', users(r4).length, 0);
  eq('nothing saved', saves, 0);
  eq('the referee is no longer busy', App.state.worldBusy, false);
  ok('the player was told it failed', toasts.length > 0, JSON.stringify(toasts));
  eq('the input is back for a retry', els['#wr-input'].value, QUESTION);

  console.log('\n5. a failed first answer changes nothing');
  var s5 = freshWorld();
  throws[0] = 'The Horde is busy right now';
  send();
  await settle();
  var r5 = live();
  eq('no turn committed', r5.turn, 0);
  eq('the optimistic player line is gone', users(r5).length, 0);
  eq('nothing saved', saves, 0);
  eq('the referee is no longer busy', App.state.worldBusy, false);
  ok('the player was told it failed', toasts.some(function (t) { return /busy|could not|referee/i.test(t); }), JSON.stringify(toasts));
  eq('the input is back for a retry', els['#wr-input'].value, QUESTION);

  console.log('\n6. a valid check resolves exactly once, from the pre-turn state');
  var s6 = freshWorld();
  var seed6 = live().seed;
  replies = ['*He squints at the slip.* [[roll:1d20:check:Notice]]'];
  send();
  await settle();
  var r6 = live();
  ok('one turn, no repair', r6.turn === 1 && apiCalls === 1, 'turn ' + r6.turn + ' calls ' + apiCalls);
  eq('exactly one check line', checks(r6).length, 1);
  ok('the check line reads like a verdict', /Notice check: .* vs DC 12/.test(checks(r6)[0].content), checks(r6)[0].content);
  eq('the dice seed advanced exactly once', r6.seed, (seed6 + 0x6D2B79F5) | 0);
  ok('the branch moved Sharpness by one', r6.stats.sharp === 4 || r6.stats.sharp === 2, 'sharp ' + r6.stats.sharp);

  console.log('\n7. a failed save keeps the pre-turn run live');
  var s7 = freshWorld();
  saveFail = true;
  replies = ['Bram slides the slip back. [[clock:+5]]'];
  send();
  await settle(120);
  saveFail = false;
  var r7 = live();
  eq('no turn committed', r7.turn, 0);
  eq('no clock drift', r7.extraMinutes, 0);
  eq('the optimistic player line is gone', users(r7).length, 0);
  eq('nothing was saved', saves, 0);
  eq('the referee is no longer busy', App.state.worldBusy, false);
  ok('the player was told it failed', toasts.length > 0, JSON.stringify(toasts));

  console.log('\n8. code is not a world turn, and its tags do not run');
  var s8 = freshWorld();
  replies = [
    'The counter is quiet.\n```python\nprint("[[clock:+30]]")\n```',
    'The counter is quiet. [[clock:+5]]'
  ];
  send();
  await settle(120);
  var r8 = live();
  eq('one turn', r8.turn, 1);
  eq('only the final clock delta ran', r8.extraMinutes, 5);
  ok('no code in the story', !(r8.log || []).some(function (m) { return /```|python/.test(m.content); }));
  eq('the clean repair is the story',
    assistants(r8)[assistants(r8).length - 1].content, 'The counter is quiet.');

  console.log('\n9. a planning trailer is not a world turn');
  var s9 = freshWorld();
  replies = [
    'Bram shrugs.\n\n---\nSelf-Correction Check: the tags seem correct based on the history.\n\nReady to output.',
    'Bram shrugs.'
  ];
  send();
  await settle(120);
  var r9 = live();
  eq('one turn', r9.turn, 1);
  ok('no planning in the story',
    !(r9.log || []).some(function (m) { return /Self-Correction Check|Ready to output/.test(m.content); }));
  eq('the clean repair is the story',
    assistants(r9)[assistants(r9).length - 1].content, 'Bram shrugs.');

  console.log('\n10. when even the repair is garbage, the turn fails closed');
  var s10 = freshWorld();
  replies = [
    'Bram shrugs.\n\n---\nSelf-Correction Check: fine.\n\nReady to output.',
    'Self-Correction Check: fine.\nReady to output.'
  ];
  send();
  await settle(120);
  var r10 = live();
  eq('no turn committed', r10.turn, 0);
  eq('nothing saved', saves, 0);
  eq('the optimistic player line is gone', users(r10).length, 0);
  eq('the referee is no longer busy', App.state.worldBusy, false);
  ok('the player was told it failed', toasts.length > 0, JSON.stringify(toasts));

  console.log('\n11. an unknown bracket command is refused, not narrated');
  var s11 = freshWorld();
  replies = ['Bram signs. [[party:Bram Kest]]', 'Bram signs.'];
  send();
  await settle(120);
  var r11 = live();
  eq('one turn', r11.turn, 1);
  ok('the unknown command was refused',
    (r11.rejections || []).some(function (x) { return /party/.test(x.tag); }), JSON.stringify(r11.rejections));
  ok('it is not left in the story',
    !(r11.log || []).some(function (m) { return /\[\[party/.test(m.content); }));

  console.log('\n12. an empty reply is not a "…" turn');
  var s12 = freshWorld();
  replies = ['   ', 'Bram waits.'];
  send();
  await settle(120);
  var r12 = live();
  eq('one turn', r12.turn, 1);
  ok('no placeholder was committed',
    !(r12.log || []).some(function (m) { return m.role === 'assistant' && m.content === '…'; }));
  eq('the repair is the story',
    assistants(r12)[assistants(r12).length - 1].content, 'Bram waits.');

  console.log('\n13. repeating the opening is not an answer');
  var s13 = freshWorld();
  replies = [
    WORLD.intro + ' [[clock:+5]]',
    'Bram taps the slip. "Deliver before dark."'
  ];
  send();
  await settle(120);
  var r13 = live();
  eq('one turn', r13.turn, 1);
  eq('the echo\'s tags did not run', r13.extraMinutes, 0);
  eq('the real answer is the story',
    assistants(r13)[assistants(r13).length - 1].content, 'Bram taps the slip. "Deliver before dark."');

  console.log('\n14. the ledger can actually be corrected');
  var w14 = HW.parse(JSON.parse(JSON.stringify(WORLD)));
  var r14 = HW.start(w14, null);
  r14.quests = [
    { text: 'Carry a heartglass shard to Ashbank', done: false },
    { text: 'Find the wick', done: true }
  ];
  r14.extraMinutes = 15;
  var ch = HW.correctState(w14, r14, { removeQuest: 'Carry a heartglass shard to Ashbank' });
  ok('the task is gone', !r14.quests.some(function (q) { return /heartglass/i.test(q.text); }), JSON.stringify(r14.quests));
  ok('…and it is logged', /removed/i.test(ch.join(' ')), JSON.stringify(ch));
  ok('the other task survived', r14.quests.some(function (q) { return /wick/i.test(q.text); }));
  var ch2 = HW.correctState(w14, r14, { clockDelta: -10 });
  eq('the clock moved', r14.extraMinutes, 5);
  ok('…and it is logged', /clock/i.test(ch2.join(' ')), JSON.stringify(ch2));

  console.log('\n15. the referee\'s words reach the player\'s screen (contract)');
  var vsrc = fs.readFileSync(src('js/views.js'), 'utf8');
  var at = vsrc.indexOf('Views.worldCorrect = function');
  var wc = vsrc.slice(at, at + 12000);
  ok('the correct-state screen can remove a task', /removeQuest/.test(wc));
  ok('…and can shift the clock', /clockDelta/.test(wc));

  console.log('\n16. the Horde says who actually answered');
  await apiSide();
  var asrc = fs.readFileSync(src('js/app.js'), 'utf8');
  var wt = asrc.slice(asrc.indexOf('App.worldTurn = function'), asrc.indexOf('App.worldTurn = function') + 12000);
  ok('the world run records who answered', /lastModel|lastHorde/.test(wt));
  var vs = vsrc.slice(vsrc.indexOf('Views.worldStatusSheet = function'), vsrc.indexOf('Views.worldStatusSheet = function') + 9000);
  ok('…and the status sheet shows it', /lastModel/.test(vs));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);

  /* ------------------------------------------------------------------ */
  /* 16. (continued) — the api.js side, in its own context               */
  /* ------------------------------------------------------------------ */
  async function apiSide() {
    var sb = {
      console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
      Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
      Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
      setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    sb.window = sb; sb.global = sb;
    var Horde = {
      generateText: function () {
        return Promise.resolve({ text: 'ok reply', worker: 'wkr-1', model: 'mystery-7b', kudos: 3, tries: 1 });
      },
      listTextModels: function () { return Promise.resolve([]); },
      health: function () { return Promise.resolve({ textWorkers: 1, imageWorkers: 1, textJobs: 0, imageJobs: 0, textEta: 5 }); },
      whoami: function () { return null; }
    };
    sb.Horde = Horde;
    vm.createContext(sb);
    vm.runInNewContext(fs.readFileSync(src('js/api.js'), 'utf8'), sb, { filename: 'api.js' });
    var API2 = sb.API;

    /* the observed trailer, end to end */
    var t = 'Pell answers your question plainly.\n\n---\n' +
      'Self-Correction Check: the tags seem correct based on the history.\n\nReady to output.';
    var out = API2.stripThinking(t, true);
    ok('the planning trailer is stripped', !/Self-Correction Check|Ready to output/.test(out), out.slice(0, 80));
    ok('…and the story survives', /Pell answers your question plainly/.test(out));
    var story = '"You can pay me in coin, or in favors."\n*He taps the dead lamp.*';
    eq('ordinary prose is untouched', API2.stripThinking(story, true), story);
    var quoted = 'She said, "Remember: self-correction check your work before dusk."';
    ok('a quoted phrase inside a line is not a trailer', API2.stripThinking(quoted, true).indexOf('self-correction check') !== -1, quoted);

    /* the worker/model metadata survives the API */
    var text = await API2.generate({
        settings: {
          provider: 'horde', hordeTextModel: '', hordeKey: 'anon', maxTokens: 200,
          userName: 'Tester', autoFinish: false
        },
      character: { id: 'c', name: 'The Lantern Marches', persona: '', scenario: '', examples: '', lorebook: [], systemPrompt: 's' },
      session: { id: 's' },
      history: []
    });
    eq('the text still resolves as text', text, 'ok reply');
    ok('the actual model and worker are recorded',
      API2.lastHorde && API2.lastHorde.model === 'mystery-7b' && API2.lastHorde.worker === 'wkr-1',
      JSON.stringify(API2.lastHorde));
    ok('…along with what was asked for',
      API2.lastHorde && API2.lastHorde.requested === 'any', JSON.stringify(API2.lastHorde));
  }
})().catch(function (e) {
  console.error('ERR', e);
  process.exit(1);
});
