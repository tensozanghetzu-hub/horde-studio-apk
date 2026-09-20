/* Virtual Humans: the people in their life are not scenery.
 *
 * Regression for the 18.1.0 social-bonds fix. Upstream's 100-day scenario
 * showed that when completed contacts never count, relationships with
 * everyone but the player flatline. The mobile engine had the same bug:
 * people[].closeness was authored once and never moved.
 *
 * Invariants this pins down:
 *   - completed time together moves closeness (warm: closer, hostile: worse)
 *   - only warmth that was actually earned fades with long silence
 *   - a relationship that was only ever written stays as written
 *   - no contact while asleep or when autonomy is off
 *   - the roll fails quietly most of the time (low autonomy, short tick)
 *
 *   node /home/user/tests/vhuman-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'vhuman.js');
var DAY = 86400000;
var NOW = Date.UTC(2026, 8, 20, 10, 0, 0);   /* Sunday 10:00 UTC — a known instant */

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* Date with a frozen "now" — the engine reads Date.now() and new Date() all
   over the place, and the test must not depend on the real clock. */
function frozenDate(now) {
  var RealDate = Date;
  function F() {
    var a = arguments;
    return a.length ? new RealDate(a[0]) : new RealDate(now);
  }
  F.now = function () { return now; };
  return F;
}

var sandbox = {
  console: console, JSON: JSON, Object: Object, Array: Array, String: String,
  Number: Number, RegExp: RegExp, Error: Error,
  Date: frozenDate(NOW)
};
sandbox.window = sandbox;
sandbox.__rand = 0.99;
sandbox.Math = {
  random: function () { return sandbox.__rand; },
  min: Math.min, max: Math.max, floor: Math.floor,
  abs: Math.abs, sign: Math.sign, round: Math.round
};
vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'vhuman.js' });

var VH = sandbox.VH;

var AWAKE = { start: '20:00', end: '06:00' };   /* 10:00 is awake */
var ASLEEP = { start: '09:00', end: '11:00' };  /* 10:00 is asleep */
var NO_TRAVEL = { message: true, photo: true, post: true, travel: false };

function life(over, hoursAgo) {
  var vh = { lastTick: NOW - (hoursAgo === undefined ? 2 : hoursAgo) * 3600000 };
  Object.keys(over || {}).forEach(function (k) { vh[k] = over[k]; });
  var c = { name: 'Test', vh: vh };
  VH.ensure(c);
  return c;
}
function tick(c, rand) {
  sandbox.__rand = rand === undefined ? 0.99 : rand;
  return VH.tick(c);
}

console.log('\nauthored people survive untouched');

var c1 = life({ people: [
  { id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.8 },
  { id: 'p2', name: 'Old Pete', relation: 'landlord', closeness: -0.4 }
] });
tick(c1);
eq('two people, unmet, keep their written closeness (warm)', c1.vh.people[0].closeness, 0.8);
eq('…and (cold)', c1.vh.people[1].closeness, -0.4);
ok('no contact was invented', c1.vh.people.every(function (p) { return !p.lastContact; }));

console.log('\nsilence fades only what was earned');

var c2 = life({
  autonomy: 'low', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.8, lastContact: NOW - 30 * DAY }]
});
var r2 = tick(c2, 0.99);
var met = c2.vh.people[0];
ok('a met person drifts after long silence', met.closeness < 0.8, met.closeness);
ok('…gently (2 hours is not a week)', met.closeness > 0.79, met.closeness);

var c3 = life({
  autonomy: 'low', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.8 }]
});
tick(c3, 0.99);
eq('a never-met person does not drift', c3.vh.people[0].closeness, 0.8);

var c4 = life({
  autonomy: 'off', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.005, lastContact: NOW - 30 * DAY }]
}, 36);
tick(c4, 0.99);
eq('drift stops at neutral, never crosses it', c4.vh.people[0].closeness, 0);

console.log('\ncompleted time together moves closeness');

var c5 = life({
  autonomy: 'high', perms: NO_TRAVEL, sleep: AWAKE,
  needs: { energy: 0.8, hunger: 0.25, social: 0.8, comfort: 0.7 },
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.2 }]
}, 24);
var r5 = tick(c5, 0);   /* guaranteed: 24h at high autonomy always passes the roll */
var m5 = c5.vh.people[0];
ok('the meeting is recorded', m5.lastContact === NOW, String(m5.lastContact));
ok('a warm meeting warms the bond', m5.closeness > 0.2, m5.closeness);
ok('the day remembers it', r5.beats.some(function (b) { return b.text === 'spent time with Mara'; }),
  JSON.stringify(r5.beats.map(function (b) { return b.text; })));

var c6 = life({
  autonomy: 'high', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Old Pete', relation: 'landlord', closeness: -0.6 }]
}, 24);
tick(c6, 0);
ok('a hostile meeting does not magically reconcile them', c6.vh.people[0].closeness < -0.6,
  c6.vh.people[0].closeness);

console.log('\nno contact at the wrong times');

var c7 = life({
  autonomy: 'high', perms: NO_TRAVEL, sleep: ASLEEP,
  needs: { energy: 0.8, hunger: 0.25, social: 0.8, comfort: 0.7 },
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.2 }]
}, 24);
var r7 = tick(c7, 0);
ok('asleep: no meeting', !c7.vh.people[0].lastContact);
ok('asleep: no contact beat', !r7.beats.some(function (b) { return b.text.indexOf('spent time with') === 0; }));

var c8 = life({
  autonomy: 'off', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.2 }]
}, 24);
tick(c8, 0);
ok('autonomy off: no meeting', !c8.vh.people[0].lastContact);

var c9 = life({
  autonomy: 'low', perms: NO_TRAVEL, sleep: AWAKE,
  people: [{ id: 'p1', name: 'Mara', relation: 'sister', closeness: 0.3 }]
});
tick(c9, 0.99);   /* low autonomy for 2 hours: the roll fails */
eq('the roll usually fails — nothing happens', c9.vh.people[0].closeness, 0.3);

var c10 = life({});
var r10 = tick(c10);
ok('a life with no people ticks without trouble', Array.isArray(r10.beats));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
