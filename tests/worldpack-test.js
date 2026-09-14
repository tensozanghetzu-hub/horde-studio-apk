/* World packs: do real places and real walking times actually work?
 *
 * Runs js/worlds.js in a bare Node sandbox with fetch pointed at the built
 * packs, so it tests the real converted data rather than a fixture.
 *
 *   node /home/user/tests/worldpack-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var WORLDS = path.join(__dirname, '..', 'horde-studio-mobile', 'worlds');
var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'worlds.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

var sandbox = {
  console: console, JSON: JSON, Math: Math,
  fetch: function (f) {
    // f looks like "worlds/index.json"
    var p = path.join(path.dirname(SRC), '..', f);
    return new Promise(function (resolve, reject) {
      fs.readFile(p, 'utf8', function (err, body) {
        if (err) return reject(new Error('missing ' + f));
        resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(body)); } });
      });
    });
  },
  /* the only bit of VH the module touches */
  VH: {
    place: function (vh, id) {
      return (vh.places || []).filter(function (p) { return p.id === id; })[0] || null;
    }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'worlds.js' });
var Worlds = sandbox.Worlds;

function freshVH() {
  return {
    places: [
      { id: 'home', name: 'Home', kind: 'home', note: '' },
      { id: 'work', name: 'Work', kind: 'work', note: '' },
      { id: 'town', name: 'Town', kind: 'outdoor', note: '' }
    ],
    place: 'home',
    worldId: null
  };
}

console.log('\nworld packs');

var pack;
Worlds.available()
  .then(function (packs) {
    eq('the catalogue lists the one installed pack', packs.length, 1);
    ok('it is named', /Tempe/.test(packs[0].name), packs[0].name);
    ok('it carries OpenStreetMap attribution (ODbL requires it)',
      /OpenStreetMap|ODbL/i.test(packs[0].attribution || ''), packs[0].attribution);
    return Worlds.load(packs[0].id);
  })
  .then(function (p) {
    pack = p;
    eq('every place converted', pack.places.length, 120);
    eq('routes deduped to one per pair', pack.routes.length, 918);
    ok('geometry was dropped', pack.routes.every(function (r) { return r.geometry === undefined; }));
    ok('places kept their coordinates', pack.places.every(function (x) { return x.ll && x.ll.length === 2; }));

    // a pair the pack knows: the answer must be the real walking time
    var r = pack.routes[0];
    eq('a known route returns its own minutes',
      Worlds.minutes(pack, r.f, r.t), r.m);
    eq('and works in either direction',
      Worlds.minutes(pack, r.t, r.f), r.m);
    eq('being already there takes no time',
      Worlds.minutes(pack, r.f, r.f), 0);

    // a pair it does not know: estimate from the coordinates
    var est = Worlds.minutes(pack, pack.places[0].id, pack.places[119].id);
    ok('an unknown pair is estimated, not zero', est > 0, String(est));
    ok('the estimate is a sane walk (1-90 min)', est >= 1 && est <= 90, est + ' min');
    return null;
  })
  .then(function () {
    var vh = freshVH();
    var n = Worlds.apply(vh, pack);
    var ids = vh.places.map(function (p) { return p.id; });
    ok('places you wrote yourself survive the merge',
      ids.indexOf('home') === 0 && ids.indexOf('work') === 1 && ids.indexOf('town') === 2,
      ids.slice(0, 3).join());
    eq('the whole city joins them', n, 123);
    eq('the life remembers which pack it uses', vh.worldId, 'tempe-core');
    ok('no duplicate ids', new Set(vh.places.map(function (p) { return p.id; })).size === n);

    var vh2 = freshVH();
    Worlds.apply(vh2, pack);
    var left = Worlds.remove(vh2, pack);
    eq('removing the pack leaves home, work and the old town', left, 3);
    eq('and forgets the pack', vh2.worldId, null);
    return null;
  })
  .then(function () {
    console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) {
    console.log('  FAIL threw: ' + e.message);
    process.exit(1);
  });
