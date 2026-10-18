/* v1.37.0 — the open book: the world viewer shows the lorebook, keys and
 * gates visible, SECRET entries sealed so a peek can never spoil the story.
 * Dead keywords (never said anywhere in the world's own text) are hinted,
 * not hidden - a hint is honest, a verdict would not be.
 *
 *   node /home/user/tests/worldlore-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

/* ---------------- the book the player peeks into ------------------------ */
var FILE_WORLD = {
  _format: 'horde-world', _version: '1.4',
  id: 'world_book', name: 'The Quiet Stacks',
  description: 'A library at the edge of the salt flats.',
  startLocationId: 'loc_stack',
  locations: [
    { id: 'loc_stack', name: 'The Long Stack', description: 'Shelves bow under dust.', exits: [{ text: 'to the Reading Room', travelTime: null, isOneWay: false }] }
  ],
  entities: [
    { id: 'npc_moss', name: 'Widow Moss', type: 'npc', description: 'Keeps the index.',
      persona: 'Exacting.', goal: 'Find the missing folio.', secrets: '' },
    { id: 'npc_dray', name: 'Dray', type: 'npc', description: 'A porter in oilskins.' }
  ],
  factions: [{ id: 'fac_binders', name: 'The Binder Circle', description: 'Bookmen.', goal: 'Bind what floods.' }],
  relationships: [],
  lorebook: [
    { keyword: 'salt flats', text: 'The flats were a sea once; the tide keeps a ledger.', knownBy: '' },
    { keyword: 'binder circle', text: 'The Circle pays for water-damaged paper by the pound.', knownBy: 'faction:fac_binders' },
    { keyword: 'widow moss', text: 'The Widow re-opened the index the night the folio vanished.', knownBy: 'npc:Widow Moss' },
    { keyword: 'the folio', text: 'SEALED CONTENT ONE, never shown', knownBy: 'secret', unlockQuest: 'Recover the missing folio' },
    { keyword: 'the vault door', text: 'SEALED CONTENT TWO, never shown', knownBy: 'secret', unlockNpc: 'Dray' },
    { keyword: 'the ninth bell', text: 'SEALED CONTENT THREE, never shown', knownBy: 'secret' },
    { keyword: 'zzqqx', text: 'An entry whose keyword is a nonsense word.', knownBy: '' }
  ],
  gameRules: {}, hudConfig: {}, startingLives: [],
  intro: 'The salt flats shine through the west glass.',
  dmPrompt: 'Be the library.'
};

/* ---------------- sandbox: hordeworld + views, no DOM needed ------------*/
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  navigator: {},
  location: { protocol: 'file:' },
  document: {
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getElementById: function () { return null; }
  },
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function () { return ''; },
    toast: function () {},
    sheet: function () {}
  },
  Store: { settings: { provider: 'horde' }, personas: [] },
  VH: { status: function () { return { text: '' }; } },
  KeepAwake: { hold: function () {}, release: function () {} },
  API: {},
  IDB: { put: function () { return Promise.resolve(); }, getAll: function () { return Promise.resolve([]); },
         get: function () { return Promise.resolve(null); }, del: function () { return Promise.resolve(); } }
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/hordeworld.js'), 'utf8'), sandbox, { filename: 'hordeworld.js' });
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });
var HW = sandbox.HW, Views = sandbox.Views;

console.log('\nthe open book - the world viewer shows lore without spoiling it\n');

var world = HW.parse(JSON.parse(JSON.stringify(FILE_WORLD)));
var h = Views.worldSummary(world);

ok('the book is open: the open entry shows its key', /salt flats/.test(h));
ok('...and tells its fact', /The flats were a sea once/.test(h));
ok('the faction-gated entry names its circle', /known inside The Binder Circle/.test(h), 'gate: ' + (h.match(/binder circle[^<]*/i) || ['?'])[0]);
ok('...and still tells its fact', /water-damaged paper/.test(h));
ok('the npc-gated entry names whose company speaks it', /speaks near Widow Moss/.test(h));
ok('...and tells its fact', /re-opened the index/.test(h));

/* secrets are non-negotiable: content never, mechanism named */
ok('a secret never shows its content (quest-gated)', h.indexOf('SEALED CONTENT ONE') === -1);
ok('...but names the hinge it turns on', /Recover the missing folio/.test(h));
ok('...and says it is sealed', /sealed/.test(h));
ok('a secret never shows its content (witness-gated)', h.indexOf('SEALED CONTENT TWO') === -1);
ok('...but names the witness', /Dray/.test(h));
ok('a secret with no hinge stays honest about that', h.indexOf('SEALED CONTENT THREE') === -1 &&
  /nothing that opens/.test(h));

/* the dead-key hint (gap #7): honest, not in the way */
ok('a key the world itself never says is hinted', /never said anywhere/.test(h));
ok('a key the world does say is not hinted', !/salt flats[\s\S]{0,260}never said anywhere/.test(h));

/* an empty book stays shut */
var bare = HW.parse(JSON.parse(JSON.stringify(FILE_WORLD)));
bare.lorebook = [];
ok('no book, no book section', Views.worldSummary(bare).indexOf('known book') === -1);

/* v1.38.0: the classes page - bundles visible, like everything that is
   not a secret */
console.log('\nthe classes page\n');
var CLASS_WORLD = JSON.parse(JSON.stringify(FILE_WORLD));
CLASS_WORLD.skillsCatalog = [
  { id: 'skill_lockpicking', name: 'Lockpicking', description: 'Thin wire.', stat: 'finesse' }
];
CLASS_WORLD.classes = [
  { id: 'cls_thief', name: 'Cutpurse', description: 'Fingers first.',
    statOverrides: { finesse: 8 }, skills: ['skill_lockpicking'],
    obligations: ['Repay the fence'], outfit: 'too many pockets' }
];
var ch = Views.worldSummary(HW.parse(CLASS_WORLD));
ok('the classes page shows its walkers', /Cutpurse/.test(ch));
ok('...and what they bring', /Lockpicking/.test(ch));
ok('...without inventing a page for worlds with none',
  Views.worldSummary(HW.parse(JSON.parse(JSON.stringify(FILE_WORLD)))).indexOf('Classes') === -1);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
