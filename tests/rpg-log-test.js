#!/usr/bin/env node
/* v1.48.8: the RPG ledger has a history, so its total can be checked.

   v1.48.7 made the numbers the app's rather than the model's, but the ledger was
   still a snapshot: `xp` was a number the session happened to hold. Three things
   followed from that, and they are the three this file checks:

     - an edit-and-resend deleted the turn that earned an award and left the award;
     - a reroll or a swipe to another take kept credit for words no longer shown;
     - a group chat could not be read back to who granted what, because nothing
       recorded the granting.

   So an approved change is now written ON THE REPLY (`msg.rpgAward`) and the
   session's total is a cache of `floor + Σ`. That is v1.48.6's shape applied to
   the ledger: the rows own the fact, one door reconciles, and opening a chat
   heals whatever a caller forgot. The floor is stored (`rpgStatus.xpBase`) rather
   than read off the oldest surviving entry — a floor that moves when you delete
   the first award is a floor that cannot lose that award.

   Everything below the API section runs the real `Store` against a fake IndexedDB
   whose reads hand back copies, because IndexedDB structured-clones: without that,
   a test about "the row was deleted and the total followed" mutates a live object
   instead and proves nothing.

   Usage: node tests/rpg-log-test.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

function loadApi() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite, TextEncoder: TextEncoder
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();

/* ---------------- 1. the event the log is made of ---------------- */
console.log('\nan approved change becomes an event');
var before = { enabled: true, level: '2', xp: 205, xpToNext: 305, rule: '100', declined: [] };
var res = API.rpgApplyUpdate(before, [{ field: 'xp', op: 'add', value: 100 }, { field: 'inventory', op: 'add', value: 'a brass key' }],
  { at: 12, reason: 'The ledger is settled.', speaker: 'Sera' });
ok('the award is the change actually applied', res.award && res.award.xp === 100, JSON.stringify(res.award));
ok('it records where the total stood before', res.award.from === 205, 'from ' + res.award.from);
ok('the turn it landed on, so the log reads in order', res.award.at === 12, 'at ' + res.award.at);
ok('and why, in the model own words', /ledger is settled/.test(res.award.reason), res.award.reason);
ok('and who said it, which is what makes a group chat auditable', res.award.speaker === 'Sera', res.award.speaker);
ok('the first logged award establishes the floor', res.status.xpBase === 205, 'xpBase ' + res.status.xpBase);
ok('the total is the floor plus the log', res.status.xp === 305);
/* 205 + 100 = 305, and a linear 100 spends its levels at 100/200/300: level 4,
   next at 400. Checked against the curve rather than against the number the
   ledger remembered, which is the whole point of deriving it. */
ok('and the level still follows the total', String(res.status.level) === '4' && res.status.xpToNext === 400,
  'level ' + res.status.level + ' next ' + res.status.xpToNext);

var cut = API.rpgApplyUpdate(before, [{ field: 'xp', op: 'add', value: 5000 }], { at: 13, reason: 'Greed.' });
ok('an award cut by the cap logs what was APPLIED', cut.award.xp === 100, 'logged +' + cut.award.xp);
ok('and keeps the refusal with the event, not in the margin', cut.award.cut && /over the cap/.test(cut.award.cut[0]),
  JSON.stringify(cut.award.cut));
var nothing = API.rpgApplyUpdate(before, [], { at: 14 });
ok('a change that moved no XP logs no award', !nothing.award, JSON.stringify(nothing.award));
var second = API.rpgApplyUpdate(res.status, [{ field: 'xp', op: 'add', value: 50 }], { at: 20 });
ok('a later award does not move the floor', second.status.xpBase === 205, 'xpBase ' + second.status.xpBase);
ok('and its entry carries only its own delta', second.award.xp === 50 && second.award.from === 305, JSON.stringify(second.award));

/* ---------------- 2. what the rows add up to ---------------- */
console.log('\nthe total is derived from the rows');
function row(id, xp, from, extra) {
  var r = Object.assign({ id: id, role: 'assistant', text: 'x', rpgAward: { xp: xp, from: from } }, extra || {});
  return r;
}
var legacy = { enabled: true, level: '9', xp: 4000, xpToNext: 5000, rule: 'manual' };
var untouched = API.rpgLedger(legacy, [{ id: 'a' }, { id: 'b' }]);
ok('a chat with no log keeps the number its player typed', !untouched.changed && untouched.status.xp === 4000);
ok('and is not given a floor it never earned', untouched.floor === null, JSON.stringify(untouched.floor));
var oldApplied = API.rpgLedger(legacy, [{ id: 'a', rpgStatusProposal: { state: 'applied', changes: [{ field: 'xp', op: 'add', value: 900 }] } }]);
ok('an applied proposal from before the log is not counted again', !oldApplied.changed && oldApplied.awards === 0,
  'awards ' + oldApplied.awards + ' xp ' + oldApplied.status.xp);

var ledger = { enabled: true, level: '2', xp: 305, xpToNext: 305, rule: '100', xpBase: 205 };
var agree = API.rpgLedger(ledger, [row('m1', 100, 205)]);
ok('rows that match the cache change nothing', !agree.changed && agree.awards === 1);
var rewind = API.rpgLedger({ enabled: true, xp: 205, level: '2', rule: '100', xpBase: 205 }, [row('m1', 100, 205)]);
ok('rows that do not match it move the cache to the truth', rewind.changed && rewind.status.xp === 305,
  'xp ' + rewind.status.xp);
ok('and the level is re-derived in the same breath', String(rewind.status.level) === '4', 'level ' + rewind.status.level);
var gone = API.rpgLedger(ledger, []);
ok('deleting the granting reply takes the award with it', gone.changed && gone.status.xp === 205, 'xp ' + gone.status.xp);
var midGone = API.rpgLedger({ enabled: true, xp: 355, level: '3', rule: '100', xpBase: 205 },
  [row('m1', 100, 205), row('m3', 50, 305)]);
ok('two awards sum in order, whatever the middle one was', !midGone.changed && midGone.sum === 150, 'sum ' + midGone.sum);
var firstGone = API.rpgLedger({ enabled: true, xp: 355, level: '3', rule: '100', xpBase: 205 },
  [row('m3', 50, 305)]);
ok('deleting the OLDEST award still subtracts it — the floor does not move', firstGone.changed && firstGone.status.xp === 255,
  'xp ' + firstGone.status.xp);
var penalty = API.rpgLedger({ enabled: true, xp: 105, level: '2', rule: '100', xpBase: 205 },
  [row('m1', -100, 205)]);
ok('a penalty is an award with a minus sign', !penalty.changed && penalty.sum === -100, 'sum ' + penalty.sum);
var corrected = API.rpgLedger({ enabled: true, xp: 50, level: '1', rule: '100', xpBase: -70 },
  [row('m1', 100, 0), row('m2', 20, 100)]);
ok('a player who types under the log stays there — the floor may be negative', !corrected.changed && corrected.status.xp === 50,
  'xp ' + corrected.status.xp + ' floor ' + corrected.floor);
var forged = API.rpgLedger({ enabled: true, xp: 0, xpBase: 0, rule: 'manual' }, [
  row('m1', 999999999, 999999999, { rpgAward: { xp: 1e12, from: -50, at: 'x', reason: 'r'.repeat(9000), label: 'l'.repeat(9000), cut: ['c'.repeat(9000), 'y', 'z', 'w'] } })
]);
ok('an entry from a file is clamped, not trusted', forged.status.xp <= 1000000 && forged.entries[0].reason.length <= 200,
  'xp ' + forged.status.xp + ' reason ' + forged.entries[0].reason.length);
ok('it keeps at most three refusals, each bounded', forged.entries[0].cut.length === 3 &&
  forged.entries[0].cut.every(function (x) { return x.length <= 200; }), JSON.stringify(forged.entries[0].cut.map(function (x) { return x.length; })));
ok('an empty rpgAward field is not an award', API.rpgLedger({ enabled: true, xp: 5, rule: 'manual' }, [{ id: 'x', rpgAward: {} }]).awards === 0);
var line = API.rpgAwardText(forged.entries[0]);
ok('a log line says the amount, the turn and the cut', /\+1000000 XP/.test(line) && /cut down/.test(line), line.slice(0, 120));
ok('and one with no reason and no speaker is still a line', API.rpgAwardText({ xp: 25, from: 0, at: 0, label: '', reason: '', speaker: '' }) === '+25 XP',
  JSON.stringify(API.rpgAwardText({ xp: 25, from: 0, at: 0, label: '', reason: '', speaker: '' })));

/* ---------------- 3. the real store ---------------- */
/* ---------------------------------------------------------------------------
   (2b) Nothing is still nothing. A row whose award moved no XP, cut nothing and
   gave no reason is not a fact about the chat, and a stored one must not become
   a line of the ledger merely by existing — that is the difference between a
   log and a pile of receipts. */
console.log('\nnothing in the log is still nothing');
ok('an award that moved nothing is not an award', API.rpgAwardIn({ xp: 0, from: 0, at: 4 }, null) === null,
  JSON.stringify(API.rpgAwardIn({ xp: 0, from: 0, at: 4 }, null)));
ok('nor one whose only reason is blanks', API.rpgAwardIn({ xp: 0, from: 0, reason: '   ' }, null) === null);
var blankStatus = { enabled: true, rule: 'manual' };
var blank = API.rpgLedger(blankStatus, [{ id: 'a1', rpgAward: {} }, { id: 'a2', rpgAward: { xp: 0, from: 0 } }]);
ok('a blank award does not become a line of the log', blank.entries.length === 0, JSON.stringify(blank.entries));
ok('and it does not make the sheet want to rewrite the session', blank.changed === false, 'changed ' + blank.changed);
ok('the total stays exactly where the player left it', blank.status.xp === 0, 'xp ' + blank.status.xp);

console.log('\nthe real store heals it, and a delete subtracts');
function world() {
  var data = {};
  var writes = 0;
  function st(t) { return (data[t] = data[t] || {}); }
  function copy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  var IDB = {
    get: function (t, id) { return Promise.resolve(st(t)[id] == null ? null : copy(st(t)[id])); },
    put: function (t, o) { writes++; st(t)[o.id] = copy(o); return Promise.resolve(copy(o)); },
    putMany: function (t, arr) { arr.forEach(function (o) { writes++; st(t)[o.id] = copy(o); }); return Promise.resolve(arr); },
    del: function (t, id) { writes++; delete st(t)[id]; return Promise.resolve(); },
    getAll: function (t) { return Promise.resolve(Object.keys(st(t)).map(function (k) { return copy(st(t)[k]); })); },
    getAllByIndex: function (t, ix, v) {
      return Promise.resolve(Object.keys(st(t)).map(function (k) { return st(t)[k]; })
        .filter(function (o) { return o[ix] === v; }).map(copy));
    }
  };
  var uid = 0;
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout, isFinite: isFinite,
    IDB: IDB, API: API,
    UI: {
      uid: function (p) { return p + '-' + (++uid); },
      esc: function (x) { return String(x == null ? '' : x); },
      toast: function () {}, confirm: function () { return Promise.resolve(false); },
      input: function () { return Promise.resolve(null); }, sheet: function () {}
    }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  sb.Store.settings = { activePersona: '', memoryEvery: 14, autoMemory: true };
  return { Store: sb.Store, IDB: IDB, writes: function () { return writes; } };
}

function chat(w, status) {
  var s = w.Store.newSession('cA', 'The Ledger That Forgot');
  s.rpgStatus = status;
  return w.Store.putSession(s).then(function () { return s; });
}
function reply(w, sid, text, award, speaker) {
  return w.Store.addMessage({ sessionId: sid, role: 'assistant', text: text, createdAt: Date.now(), rpgAward: award, speakerName: speaker });
}

var s0 = { enabled: true, level: '1', xp: 0, xpToNext: 100, xpBase: null, rule: '100', declined: [] };
var w1 = world();
var s1, a1;
chat(w1, s0).then(function (s) {
  s1 = s;
  var applied = API.rpgApplyUpdate(s.rpgStatus, [{ field: 'xp', op: 'add', value: 100 }], { at: 1, reason: 'First score.' });
  s.rpgStatus = applied.status;
  return Promise.all([w1.Store.putSession(s), reply(w1, s.id, 'You did the thing.', applied.award, 'Sera')]);
}).then(function (r) {
  a1 = r[1];
  /* Re-read before measuring: the count half of `reconcile` would otherwise
     write legitimately (the object in this test's hand predates the message) and
     the check would be about the wrong thing. */
  return w1.IDB.get('sessions', s1.id).then(function (fresh) {
    s1 = fresh;
    var writesBefore = w1.writes();
    return w1.Store.reconcile(s1, [a1]).then(function () {
    ok('a chat whose rows agree with its cache is not rewritten to check', w1.writes() === writesBefore,
      (w1.writes() - writesBefore) + ' writes');
    return w1.IDB.get('sessions', s1.id);
  });
  });
}).then(function (stored) {
  ok('the row, not the memo, is what the total says', stored.rpgStatus.xp === 100 && String(stored.rpgStatus.level) === '2',
    JSON.stringify({ xp: stored.rpgStatus.xp, level: stored.rpgStatus.level }));

  /* the symptom this release exists for: the reply that granted the award is
     deleted (edit-and-resend, or one message removed), and the ledger follows. */
  return w1.Store.removeMessages([a1]).then(function () { return w1.IDB.get('sessions', s1.id); });
}).then(function (after) {
  ok('deleting the granting reply subtracts the award', after.rpgStatus.xp === 0 && String(after.rpgStatus.level) === '1',
    JSON.stringify({ xp: after.rpgStatus.xp, level: after.rpgStatus.level }));
  ok('the floor stays where the player left it', after.rpgStatus.xpBase === 0, 'xpBase ' + after.rpgStatus.xpBase);
}).then(function () {
  /* An opened chat heals a total that was written behind its own log — the
     v1.48.6 lesson, applied here rather than assumed. */
  var w2 = world();
  return chat(w2, { enabled: true, level: '5', xp: 999, xpToNext: 1000, xpBase: 205, rule: '100', declined: [] }).then(function (s) {
    return Promise.all([
      reply(w2, s.id, 'one', { xp: 100, from: 205, at: 3 }),
      reply(w2, s.id, 'two', { xp: 50, from: 305, at: 5 })
    ]).then(function () { return w2.Store.getMessages(s.id); }).then(function (rows) {
      return w2.Store.reconcile(s, rows).then(function () { return w2.IDB.get('sessions', s.id); });
    });
  });
}).then(function (healed) {
  ok('a poisoned total is repaired on open', healed.rpgStatus.xp === 355 && String(healed.rpgStatus.level) === '4',
    JSON.stringify({ xp: healed.rpgStatus.xp, level: healed.rpgStatus.level }));
  ok('the stale target in the row is replaced with the curve\'s', healed.rpgStatus.xpToNext === 400, 'target ' + healed.rpgStatus.xpToNext);
}).then(function () {
  /* and a chat that never had a log is left alone entirely */
  var w3 = world();
  return chat(w3, { enabled: true, level: 'Apprentice', xp: 4000, xpToNext: null, rule: 'manual', declined: [] }).then(function (s) {
    return reply(w3, s.id, 'prose only', null).then(function () { return w3.IDB.get('sessions', s.id); }).then(function (fresh) {
      var before = w3.writes();
      return w3.Store.getMessages(s.id).then(function (rows) {
      return w3.Store.reconcile(fresh, rows).then(function () {
        ok('a chat with nothing logged is not rebased, zeroed or written', w3.writes() === before, (w3.writes() - before) + ' writes');
        return w3.IDB.get('sessions', s.id);
      });
      });
    });
  });
}).then(function (s) {
  ok('and its numbers are exactly the ones it had', s.rpgStatus.xp === 4000 && s.rpgStatus.level === 'Apprentice',
    JSON.stringify({ xp: s.rpgStatus.xp, level: s.rpgStatus.level }));
}).then(function () {
  /* A store asked to reconcile without an engine loaded (a bare harness) must
     not invent rules of its own. */
  var w4 = world();
  var src = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN, parseFloat: parseFloat,
    parseInt: parseInt, setTimeout: setTimeout, isFinite: isFinite, IDB: w4.IDB,
    UI: { uid: function () { return 'x'; }, esc: function (x) { return String(x); }, toast: function () {} }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(src, sb, { filename: 'store.js (no API)' });
  sb.Store.settings = { activePersona: '', memoryEvery: 14, autoMemory: true };
  var s = sb.Store.newSession('cA', 'No engine');
  s.rpgStatus = { enabled: true, xp: 700, level: '1', xpBase: 0, rule: '100' };
  return sb.Store.putSession(s).then(function () {
    return sb.Store.reconcile(s, [{ id: 'm', rpgAward: { xp: 100, from: 0 } }]).then(function () {
      ok('without the engine the store counts messages and says nothing about curves',
        s.messageCount === 1 && s.rpgStatus.xp === 700, JSON.stringify({ n: s.messageCount, xp: s.rpgStatus.xp }));
    });
  });
}).then(function () {
  console.log('\nthe app keeps the log with the reply that earned it');
  var app = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  var awards = (app.match(/delete msg\.rpgAward/g) || []).length;
  /* three, not "at least two": a reroll, a swipe and a hand-edit of a reply are
     the three ways a row's text changes without being deleted, and the release
     is only honest if all three withdraw what the old words earned. */
  ok('every place a reply stops being what it was withdraws its award', awards === 3, awards + ' sites, want 3');
  ok('and the award is written on the message, not beside it', /message\.rpgAward = notes\.award/.test(app));
  ok('a chat backup carries its history, or a restore would fall to zero', /rpgAward: m\.rpgAward \|\| null/.test(app));
  ok('and an imported entry goes through the same clamp as a live one', /API\.rpgAwardIn\(m\.rpgAward, null\)/.test(app));
  ok('the sheet reads the rows it summarizes', /Promise\.all\(\[IDB\.get\('sessions', sessionId\), Store\.getMessages\(sessionId\)\]\)/.test(app));
  ok('the sheet shows the log and the floor it started from', /Progress log/.test(app) && /from the log/.test(app));
  ok('typing XP moves the floor, never the log', /xpBase: ledger\.awards \? \(Math\.max\(0, Math\.floor\(Number\(result\.xp\) \|\| 0\)\) - ledger\.sum\) : null/.test(app));
  ok('the ledger door the store and the app share is the same function', /API\.rpgLedger\(session\.rpgStatus, messages \|\| \[\]\)/.test(app));
  ok('an aborted re-spin does not withdraw anything it never changed',
    !/Partial reply kept on screen[\s\S]{0,220}recountSession/.test(app));
  ok('a reroll that did reach the row does repair', /syncRpgLedger\(App\.state\.session, App\.state\.messages\)/.test(app));
  ok('the store reconciles the ledger through the counter\'s own door',
    /reconcileLedger: function \(s, list\)/.test(fs.readFileSync(path.join(JS, 'store.js'), 'utf8')));
}).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}).catch(function (e) {
  console.log('FAIL (threw): ' + ((e && e.stack) || e));
  process.exit(1);
});
