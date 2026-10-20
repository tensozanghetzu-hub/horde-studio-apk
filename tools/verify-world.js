'use strict';
/* Validation: JSON validity, HW.parse round-trip on the REAL engine loader,
   and the hard reference-integrity rules from world-author-prompt.md. */
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || '/home/user/Azarinth-Healer-inspired.horde_world.json';
let failed = 0, count = 0;
const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

let raw = null;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); ok('valid JSON', true); }
catch (e) { console.log('  FAIL valid JSON  → ' + e.message); process.exit(1); }

const sandbox = { console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/hordeworld.js', 'utf8'), sandbox, { filename: 'hordeworld.js' });

let w = null;
try {
  w = sandbox.HW.parse(JSON.parse(JSON.stringify(raw)));
  ok('HW.parse accepts it (the real import gate)', !!w);
} catch (e) { ok('HW.parse accepts it (the real import gate)', false, e.message); process.exit(1); }

const L = id => (w.locations || []).some(x => x.id === id);
const E = id => (w.entities || []).some(x => x.id === id);
const F = id => (w.factions || []).some(x => x.id === id);
const ST = id => ((w.hudConfig && w.hudConfig.stats) || []).some(x => x.id === id);
const SK = id => (w.skillsCatalog || []).some(x => x.id === id);
const ENAME = id => { const e = (w.entities || []).find(x => x.id === id); return e ? e.name.toLowerCase() : null; };

console.log('A — counts the engine will see');
console.log('   locations', (w.locations || []).length,
            '| entities', (w.entities || []).length,
            '| factions', (w.factions || []).length,
            '| lorebook', (w.lorebook || []).length,
            '| lives', (w.startingLives || []).length,
            '| programs', (w.goalPrograms || []).length);

console.log('B — reference integrity');
const badStartLoc = (w.entities || []).filter(e => e.startLocation && !L(e.startLocation));
ok('every entity startLocation resolves', badStartLoc.length === 0, badStartLoc.map(e => e.id).join(','));
const badHome = (w.entities || []).filter(e => e.homeLocation && !L(e.homeLocation));
ok('every entity homeLocation resolves', badHome.length === 0, badHome.map(e => e.id).join(','));
const badSched = (w.entities || []).flatMap(e => (e.schedule || []).filter(s => s.locationId && !L(s.locationId)).map(s => e.id + '/' + s.time));
ok('every schedule slot resolves to a location', badSched.length === 0, badSched.join(','));
const badFac = (w.entities || []).filter(e => e.factionId && !F(e.factionId));
ok('every factionId resolves', badFac.length === 0, badFac.map(e => e.id).join(','));
const badRel = (w.relationships || []).filter(r => !E(r.a) || !E(r.b));
ok('every relationship endpoint resolves', badRel.length === 0, badRel.map(r => r.a + '<->' + r.b).join(','));
const badLoreNpc = (w.lorebook || []).filter(l => l.unlockNpc && !E(l.unlockNpc) && !(w.entities || []).some(e => e.name.toLowerCase() === l.unlockNpc.toLowerCase()));
ok('every lore unlockNpc resolves (id or name)', badLoreNpc.length === 0, badLoreNpc.map(l => l.unlockNpc).join(','));
const badLoreQuest = (w.lorebook || []).filter(l => l.unlockQuest && !(w.startingQuests || []).some(q => q.toLowerCase().includes(l.unlockQuest.toLowerCase())));
ok('every unlockQuest has a matching starting quest (engine gates by substring)', badLoreQuest.length === 0, badLoreQuest.map(l => l.unlockQuest).join(','));
const badLoreGate = (w.lorebook || []).filter(l => (l.unlockQuest || l.unlockNpc) && l.knownBy !== 'secret');
ok('gated entries are marked secret (else gates are dead weight)', badLoreGate.length === 0, badLoreGate.map(l => l.id).join(','));
ok('startLocationId is a real place', L(w.startLocationId), w.startLocationId);
const badLife = (w.startingLives || []).filter(l => l.startLocationId && !L(l.startLocationId));
ok('every starting life lands somewhere real', badLife.length === 0, badLife.map(l => l.id).join(','));
const badProg = (w.goalPrograms || []).filter(g => g.actor && !E(g.actor) && !F(g.actor));
ok('every goal-program actor resolves', badProg.length === 0, badProg.map(g => g.id).join(','));
const badStatOv = [];
(w.startingLives || []).forEach(l => Object.keys(l.statOverrides || {}).forEach(k => { if (!ST(k)) badStatOv.push(l.id + ':' + k); }));
(w.classes || []).forEach(c => Object.keys(c.statOverrides || {}).forEach(k => { if (!ST(k)) badStatOv.push(c.id + ':' + k); }));
ok('every statOverride targets a declared stat', badStatOv.length === 0, badStatOv.join(','));
const badSkillStat = (w.skillsCatalog || []).filter(s => s.stat && !ST(s.stat));
ok('every skill trains a declared stat', badSkillStat.length === 0, badSkillStat.map(s => s.id).join(','));
const badClsSkill = (w.classes || []).flatMap(c => (c.skills || []).filter(s => !SK(s)).map(s => c.id + ':' + s));
ok('every class skill exists in the catalog', badClsSkill.length === 0, badClsSkill.join(','));

console.log('C — liveness: worlds move without the player');
ok('world agent is on', !!(w.worldAgent && w.worldAgent.enabled !== false));
ok('at least two goal programs with real steps', (w.goalPrograms || []).filter(g => g.steps && g.steps.length >= 3).length >= 2);
const scheduled = (w.entities || []).filter(e => (e.schedule || []).length >= 2).length;
ok('most of the cast has a real schedule', scheduled >= Math.max(3, (w.entities || []).length - 3), scheduled + '/' + (w.entities || []).length);

console.log('\nverify-world: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
process.exit(failed ? 1 : 0);
