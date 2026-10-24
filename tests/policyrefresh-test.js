/* policyrefresh-test — v1.39.10: Horde Studio upstream 18.3.7 refreshed the
   four bundled worlds under "Repair missing routes, opening locations and
   cast, daily schedules, duplicated player-role NPCs". We bundle one of them
   (Policy Panic at Bramble & Pike). The portable part of that refresh is
   DATA, and it must merge without touching what is ours on purpose:
   - ADOPT upstream: the 10 repaired exits, the rewritten world intro, and
     the per-life opening scenes.
   - KEEP ours: the world id (existing installs and runs bind to it), the
     dice checks block (upstream's 18.x structured-event engine moved away
     from the check table our v1.29.1/v1.34 engine resolves every turn),
     and the art-stripped shape (no media payload in the APK). */
'use strict';
const fs = require('fs');
const path = require('path');

const BUNDLE = path.join(__dirname, '..', 'horde-studio-mobile', 'worlds', 'policy-panic.horde_world');
const DOC = path.join(__dirname, '..', 'docs', 'worlds', 'policy-panic.horde_world');
const FIXTURE = path.join(__dirname, 'fixtures', 'policy-panic.horde_world');

function exitsTotal(w) {
  return (w.locations || []).reduce((n, l) => n + ((l.exits || []).length), 0);
}
function hasExit(w, fromName, toId) {
  const from = (w.locations || []).find(l => l.name === fromName);
  return !!(from && (from.exits || []).some(e => e.targetLocationId === toId));
}

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const w = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
    const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

    console.log('A — the repaired routes are in the bundle');
    ok('the exit graph grew to upstream size (56)', exitsTotal(w) === 56, 'has ' + exitsTotal(w));
    ok("Maplebridge reaches Gloria's apartment", hasExit(w, 'Maplebridge', 'loc_gloria_home'));
    ok('Maplebridge reaches Wade\'s workshop', hasExit(w, 'Maplebridge', 'loc_wade_home'));
    ok('the Parking Lot reaches the office directly', hasExit(w, 'Bramble & Pike Parking Lot', 'loc_office'));
    ok('the Reception Lobby reaches the office directly', hasExit(w, 'Reception Lobby', 'loc_office'));
    ok('repaired exits carry travel times', (w.locations.find(l => l.name === 'Maplebridge').exits || [])
      .every(e => typeof e.travelTime === 'number' && e.travelTime > 0));
    ok('...and the same routes landed in the test fixture', hasExit(f, 'Maplebridge', 'loc_gloria_home') &&
       hasExit(f, 'Reception Lobby', 'loc_office'));

    console.log('B — every life opens with its own scene now');
    const intros = (w.startingLives || []).map(l => String(l.intro || ''));
    ok('all 7 lives are present', intros.length === 7, 'has ' + intros.length);
    ok('every life carries a non-trivial opening', intros.every(t => t.trim().length >= 100),
       'shortest: ' + Math.min.apply(null, intros.map(t => t.trim().length)));
    ok('the fixture\'s lives got the openings too',
       (f.startingLives || []).every(l => String(l.intro || '').trim().length >= 100));

    console.log('C — the new world intro landed');
    ok('intro opens where it should (rain, Monday)', /^Monday, 8:57 a\.m\. Rain needles/.test(w.intro));
    ok('intro names the actual opening room', /Reception Lobby/.test(w.intro));

    console.log('D — what is OURS stayed ours');
    ok('the id did not drift (installs bind to it)', w.id === 'world_policy-panic', w.id);
    ok('the dice table survived the upstream merge', Array.isArray(w.gameRules.checks) &&
       w.gameRules.checks.length >= 5 && w.gameRules.checks[0].name === 'Nerve');
    ok('the APK stays art-free (no media payload)', !('mediaAssets' in w) && !('banner' in w) &&
       !('_mediaManifest' in w));
    ok('remote channel copy is identical to the bundle',
       JSON.stringify(JSON.parse(fs.readFileSync(DOC, 'utf8'))) === JSON.stringify(w));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\npolicyrefresh-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
