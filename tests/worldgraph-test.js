/* The three things a world pack has to answer correctly.
 *
 *   how long is the walk  - routed across the route graph. 87% of pairs in the
 *                           Tempe pack are not directly connected, so a
 *                           direct-only lookup was guessing nearly every
 *                           journey.
 *   what can they do here - every capability, not one
 *   is it open right now  - opening hours, when the pack records them
 *
 *   node /home/user/tests/worldgraph-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var APP = path.join(__dirname, '..', 'horde-studio-mobile');
var PACK = JSON.parse(fs.readFileSync(path.join(APP, 'worlds', 'tempe-core.json'), 'utf8'));

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadWorlds() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error,
    fetch: function (f) {
      var file = path.join(APP, 'worlds', String(f).replace(/^worlds\//, ''));
      if (!fs.existsSync(file)) return Promise.reject(new Error('missing ' + f));
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); } });
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(APP, 'js', 'worlds.js'), 'utf8'), sandbox, { filename: 'worlds.js' });
  return sandbox.Worlds;
}

var W = loadWorlds();

/* the pack's own edges, so the tests can tell a direct hop from a routed one */
var direct = {};
(PACK.routes || []).forEach(function (r) {
  direct[r.f < r.t ? r.f + '|' + r.t : r.t + '|' + r.f] = r.m;
});
var ids = (PACK.places || []).map(function (p) { return p.id; });
function nameOf(id) {
  for (var i = 0; i < PACK.places.length; i++) if (PACK.places[i].id === id) return PACK.places[i].name;
  return id;
}

/* a weekday at a given time, found by weekday so the tests never drift */
function atTime(dayOfWeek, hh, mm) {
  var d = new Date(2026, 8, 1);
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

console.log('\nrouting across the walking graph');

/* find a pair the pack has no direct route for */
var multi = null;
for (var i = 0; i < ids.length && !multi; i++) {
  for (var j = 0; j < ids.length; j++) {
    if (i === j) continue;
    var k = ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i];
    if (!direct[k]) { multi = [ids[i], ids[j]]; break; }
  }
}
ok('the pack really does have pairs with no direct route (87% of them)', !!multi);

var r = W.route(PACK, multi[0], multi[1]);
ok('a journey with no direct route is still routed, not guessed',
  r && r.routed === true, r ? JSON.stringify(r) : 'no route');
ok('it takes more than one hop', r && r.hops.length > 2, 'hops ' + (r ? r.hops.length : '?'));
ok('the time is believable for a walk across a city',
  r && r.minutes > 0 && r.minutes < 240, r ? r.minutes + ' min' : '?');

/* every hop of the returned path must be a real edge in the pack */
var chainOk = r ? r.hops.every(function (id, n) {
  if (n === 0) return true;
  var a = r.hops[n - 1], b = id;
  var k = a < b ? a + '|' + b : b + '|' + a;
  return direct[k] !== undefined;
}) : false;
ok('every step of the path is a real walking route', chainOk);

var back = W.route(PACK, multi[1], multi[0]);
ok('it costs the same coming back', back && Math.abs(back.minutes - r.minutes) < 0.01,
  r.minutes + ' vs ' + (back ? back.minutes : '?'));

/* one place is genuinely unconnected in the source data */
var lonely = ids.filter(function (id) {
  return !(PACK.routes || []).some(function (rt) { return rt.f === id || rt.t === id; });
});
eq('exactly one place has no routes at all', lonely.length, 1);
var stranded = W.route(PACK, ids[0], lonely[0]);
ok('an unreachable place falls back to an estimate instead of failing',
  stranded && stranded.routed === false && stranded.minutes > 0,
  stranded ? stranded.minutes + ' min, routed ' + stranded.routed : 'null');
ok('the estimate is still a sane walk', stranded && stranded.minutes >= 1 && stranded.minutes <= 90,
  stranded ? String(stranded.minutes) : '?');

eq('being already there takes no time', W.minutes(PACK, ids[0], ids[0]), 0);

console.log('\ncapabilities');

var food = (PACK.places || []).filter(function (p) { return (p.caps || []).indexOf('food') !== -1; });
ok('places carry every capability the pack gave them', food.length > 0, food.length + ' food places');
var multiCap = (PACK.places || []).filter(function (p) { return (p.caps || []).length > 1; });
ok('a place can serve more than one need (a cafe is food AND leisure)',
  multiCap.length > 0, multiCap.length + ' of ' + PACK.places.length);
ok('Worlds.caps returns them all',
  W.caps(PACK, food[0].id).indexOf('food') !== -1 && W.caps(PACK, food[0].id).indexOf('leisure') !== -1,
  JSON.stringify(W.caps(PACK, food[0].id)));
eq('an unknown place has no capabilities', W.caps(PACK, 'nope').length, 0);

console.log('\nopening hours');

eq('"24/7" is always open', JSON.stringify(W._parseHours('24/7')),
   JSON.stringify([{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }]));
var wk = W._parseHours('Mo-Fr 08:00-17:00');
eq('"Mo-Fr 08:00-17:00" covers five days', wk[0].days.length, 5);
eq('and runs 8am to 5pm', wk[0].start + '-' + wk[0].end, '480-1020');
eq('"Sa,Su 10:00-18:00" covers the weekend', W._parseHours('Sa,Su 10:00-18:00')[0].days.length, 2);
eq('two spans in one rule', W._parseHours('Mo-Fr 08:00-12:00,13:00-17:00').length, 2);
eq('two rules separated by a semicolon', W._parseHours('Mo-Fr 08:00-17:00; Sa 10:00-14:00').length, 2);
eq('something unparseable is unknown, not closed', W._parseHours('by appointment'), null);

var shop = { name: 'Test', oh: 'Mo-Fr 08:00-17:00' };
ok('open on a weekday afternoon', W._isOpen(shop, atTime(1, 12, 0)) === true);
ok('closed on a weekday evening', W._isOpen(shop, atTime(1, 20, 0)) === false);
ok('closed at the weekend', W._isOpen(shop, atTime(6, 12, 0)) === false);
var late = { name: 'Bar', oh: 'Mo-Su 18:00-02:00' };
ok('a span past midnight is open after midnight', W._isOpen(late, atTime(2, 1, 0)) === true);
ok('and open before midnight', W._isOpen(late, atTime(2, 23, 0)) === true);

var noHours = (PACK.places || []).filter(function (p) { return !p.oh && !p.hours; });
ok('the pack has places with no recorded hours', noHours.length > 0, noHours.length + ' of ' + PACK.places.length);
ok('a place with no hours is unknown, so it is not treated as closed',
  W.open(PACK, noHours[0].id) === null, String(W.open(PACK, noHours[0].id)));

console.log('\nchoosing somewhere to go');

var near = W.within(PACK, ids[0], 30);
ok('within() finds somewhere to walk to in half an hour', near.length > 0, near.length + ' places');
ok('and every one is inside the budget',
  near.every(function (p) { return p.minutes <= 30; }));
ok('nearest first',
  near.every(function (p, n) { return n === 0 || near[n - 1].minutes <= p.minutes; }));

var hungry = W.search(PACK, { from: ids[0], caps: ['food'], maxMinutes: 60, at: atTime(1, 12, 0) });
ok('a hungry life is sent somewhere that serves food',
  hungry && W.caps(PACK, hungry.id).indexOf('food') !== -1,
  hungry ? nameOf(hungry.id) : 'nowhere');
ok('and it is within walking distance', hungry && hungry.minutes <= 60, hungry ? hungry.minutes + ' min' : '?');

var tight = W.search(PACK, { from: ids[0], caps: ['food'], maxMinutes: 5, at: atTime(1, 12, 0) });
ok('a tight budget is respected, or honestly refused',
  tight === null || tight.minutes <= 5, tight ? tight.minutes + ' min' : 'refused');

/* a synthetic pack where the only food place is shut */
var closedPack = {
  id: 'test', name: 'Test', places: [
    { id: 'a', name: 'Start', caps: ['leisure'], ll: [0, 0] },
    { id: 'b', name: 'Shut cafe', caps: ['food'], ll: [0.001, 0], oh: 'Mo-Fr 08:00-17:00' },
    { id: 'c', name: 'Open cafe', caps: ['food'], ll: [0.002, 0], oh: 'Mo-Su 00:00-23:59' }
  ],
  routes: [{ f: 'a', t: 'b', m: 5 }, { f: 'a', t: 'c', m: 9 }]
};
var night = W.search(closedPack, { from: 'a', caps: ['food'], at: atTime(1, 22, 0) });
eq('at 10pm it picks the cafe that is actually open', night && night.name, 'Open cafe');
var midday = W.search(closedPack, { from: 'a', caps: ['food'], at: atTime(1, 12, 0) });
eq('at noon the nearer one wins', midday && midday.name, 'Shut cafe');
var strict = W.search(closedPack, { from: 'a', caps: ['food'], at: atTime(1, 22, 0), requireOpen: true });
eq('requireOpen never returns a shut place', strict && strict.name, 'Open cafe');

console.log('\nthe merge carries the new fields');

var vh = { places: [{ id: 'home', name: 'Home', kind: 'home', note: '' }], place: 'home' };
W.apply(vh, PACK);
var packed = vh.places.filter(function (p) { return (p.caps || []).length; });
ok('loaded places keep their capabilities', packed.length === PACK.places.length,
  packed.length + ' of ' + PACK.places.length);
ok('and their coordinates, so journeys still route',
  packed.every(function (p) { return p.ll && p.ll.length === 2; }));
ok('and their opening hours where the pack has them',
  packed.some(function (p) { return p.oh || p.hours; }));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
