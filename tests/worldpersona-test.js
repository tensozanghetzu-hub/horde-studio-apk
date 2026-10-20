/* worldpersona-test — v1.39.4: world runs carry the player's persona.
   Before this, the referee prompt only knew the LIFE choice ("begins as
   Guild hopeful") — never who the player actually is. The effective
   identity (settings userName/userPersona, which persona switching swaps
   in place) is frozen into the run at start, like the life and class, and
   the referee prompt learns the player's name and description. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadHW() {
  const sandbox = { console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp };
  sandbox.window = sandbox;
  vm.runInNewContext(read('hordeworld.js'), sandbox, { filename: 'hordeworld.js' });
  return sandbox.HW;
}

const WORLD = {
  id: 'w1', _format: 'horde-world', name: 'Test', description: 'd', startLocationId: 'loc_a',
  locations: [{ id: 'loc_a', name: 'A', mapType: 'room', exits: [] }],
  entities: [], factions: [], relationships: [], lorebook: [],
  startingLives: [{ id: 'life_x', role: 'Bridgekeeper', description: 'd', startLocationId: 'loc_a', statOverrides: {}, obligations: [], inventory: [] }],
  startingQuests: [], goalPrograms: [], worldAgent: null,
  gameRules: {}, hudConfig: { stats: [{ id: 'grit', name: 'Grit', value: 3 }] },
  dmPrompt: 'Referee hard.', intro: 'Begin.'
};

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    console.log('A — run start can carry the player\'s identity');
    const HW = loadHW();
    const who = { name: 'Ramiros', persona: 'A soft-spoken mercenary monk who refuses to kill and collects pressed flowers.' };
    const run = HW.start(JSON.parse(JSON.stringify(WORLD)), 'life_x', null, who);
    ok('start accepts an identity as the fourth argument', !!run);
    ok('the name freezes into the run', run.playerName === 'Ramiros', JSON.stringify(run.playerName));
    ok('the persona description freezes into the run', /mercenary monk/.test(run.playerPersona || ''), JSON.stringify(run.playerPersona));

    console.log('B — the referee prompt actually learns it');
    const built = HW.buildPrompt(WORLD, run, 'I bow slightly.');
    const sysText = typeof built === 'string' ? built
      : (built && (built.system || built.parts || ''));
    const msgText = Array.isArray(built && built.messages)
      ? built.messages.map(m => m.content || '').join('\n') : '';
    const all = String(sysText) + '\n' + msgText;
    ok('the player\'s name reaches the referee', /Ramiros/.test(all));
    ok('the persona description reaches the referee', /mercenary monk/.test(all));
    ok('the life choice still is present (identity layers, not replaces)', /Bridgekeeper/.test(all));

    console.log('C — old-shape runs are untouched (regression guard)');
    const bare = HW.start(JSON.parse(JSON.stringify(WORLD)), 'life_x', null);
    ok('start without identity leaves the field undefined', !bare.playerName && !bare.playerPersona);
    const bareAll = (function () {
      const b = HW.buildPrompt(WORLD, bare, 'hello');
      return String(typeof b === 'string' ? b : (b && b.system) || '') +
        (Array.isArray(b && b.messages) ? b.messages.map(m => m.content || '').join('\n') : '');
    })();
    ok('no phantom identity lines appear for old runs', !/The player is [a-z]/i.test(bareAll), bareAll.slice(0, 200));

    console.log('D — the app hands its effective identity over');
    const appSrc = read('app.js');
    ok('beginWorld passes the identity into HW.start', /HW\.start\(world,\s*lifeId,\s*classId,[\s\S]{0,100}\{[\s]*name:\s*idname/.test(appSrc));
    ok('...and the identity is the effective one (persona-switched keys)', /who|playerName/.test(appSrc) &&
       /userName/.test(appSrc) && /userPersona/.test(appSrc));
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nworldpersona-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
