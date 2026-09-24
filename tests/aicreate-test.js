/* AI-assisted creation: the model is asked for ONE bounded JSON object, and
 * whatever it actually returns — clean, fenced, prose-wrapped, or trailing-
 * commaed — has to survive the trip into the editor or the world importer.
 *
 *   node /home/user/tests/aicreate-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var JS = path.join(__dirname, '..', 'horde-studio-mobile', 'js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function loadApi(stubText, stubModels) {
  var sent = null;
  var prog = null;
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    DOMException: function (m) { this.message = m; this.name = 'AbortError'; },
    Horde: {
      generateText: function (o) { sent = o; prog = o.onProgress; return Promise.resolve({ text: stubText }); },
      listTextModels: function () { return Promise.resolve(stubModels || []); },
      health: function () { return Promise.resolve({}); },
      whoami: function () { return null; }
    },
    fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ choices: [{ message: { content: stubText } }] }); } }); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sandbox, { filename: 'api.js' });
  return { api: sandbox.API, sent: function () { return sent; }, prog: function () { return prog; } };
}

function settings() {
  return {
    provider: 'horde', hordeTextModel: 'test-model', hordeKey: '0000000000',
    userName: 'Sam', maxTokens: 300, temperature: 0.8, streaming: false
  };
}

/* ---- parseAiJson: the extractor is the whole safety net ---------------- */

var clean = { name: 'Mara', places: [{ id: 'a', name: 'Home' }] };
var cleanText = JSON.stringify(clean);

var r = loadApi(cleanText);
var p = r.api.parseAiJson(cleanText);
ok('clean object passes through', p && p.name === 'Mara' && p.places.length === 1, JSON.stringify(p));

var fenced = '```json\n' + cleanText + '\n```';
ok('fenced object is unwrapped', (r.api.parseAiJson(fenced) || {}).name === 'Mara');

var prose = 'Sure! Here is the character as a JSON object:\n' + cleanText + '\nHope that helps!';
ok('prose before and after is tolerated', (r.api.parseAiJson(prose) || {}).name === 'Mara');

var trail = '{"name":"Mara", "places":[{"id":"a","name":"Home"}],}';
ok('trailing comma before a close is tolerated', (r.api.parseAiJson(trail) || {}).name === 'Mara');

ok('garbage returns null', r.api.parseAiJson('I am sorry, I cannot do that.') === null);
ok('empty string returns null', r.api.parseAiJson('') === null);
ok('top-level array is not an object', r.api.parseAiJson('[1,2,3]') === null);
ok('unbalanced braces return null', r.api.parseAiJson('{"name":"Mara"') === null);

/* nested objects survive */
var nested = { a: { b: { c: 'deep' } }, list: [1, 2] };
ok('nested objects survive', (r.api.parseAiJson(JSON.stringify(nested)) || {}).a.b.c === 'deep');

/* ---- aiJson: one bounded request, right knobs ------------------------- */

var ai = loadApi(fenced);
ai.api.aiJson(settings(), 'the prompt', 800, function () {})
  .then(function (obj) {
    ok('aiJson resolves to the parsed object', obj && obj.name === 'Mara', JSON.stringify(obj));
    var s = ai.sent();
    ok('uses the selected horde model', s && s.model === 'test-model', s && s.model);
    ok('bounded by the caller\'s maxTokens', s && s.maxLength === 800, s && s.maxLength);
    ok('drafts run cool (temperature 0.3)', s && s.temperature === 0.3, s && s.temperature);
    ok('forwards the apikey', s && s.apikey === '0000000000');
    ok('long drafts get a longer maxWait', s && s.maxWait === 600, s && s.maxWait);

    /* onProgress is wired so a 2,400-token world draft does not look frozen */
    ok('onProgress was handed to the Horde call', typeof ai.prog() === 'function');

    /* malformed draft -> null, not a throw: the UI says "try again" */
    var bad = loadApi('I cannot produce JSON right now.');
    return bad.api.aiJson(settings(), 'prompt', 100).then(function (o) {
      ok('malformed draft resolves to null', o === null, JSON.stringify(o));
    });
  })
  .then(function () {
    /* ---- the world draft shape actually feeds HW.parse ---------------- */
    var worldRaw = {
      _format: 'horde-world',
      name: 'Drowned City',
      description: 'A sunken metropolis of canals.',
      dmPrompt: 'You are the showrunner. ' + 'Filler. '.repeat(40),
      intro: 'The water is at your ankles.',
      authorNote: 'Keep it honest.',
      startLocationId: 'loc_dock',
      locations: [
        { id: 'loc_region', name: 'The Shallows', mapType: 'region', parentLocationId: null, description: 'The drowned city.', exits: [{ text: 'to Old Dock', travelTime: 5, isOneWay: false }] },
        { id: 'loc_dock', name: 'Old Dock', mapType: 'building', parentLocationId: 'loc_region', description: 'A rotted pier.', exits: [{ text: 'to The Shallows', travelTime: 5, isOneWay: false }] }
      ],
      entities: [
        { id: 'npc_mara', name: 'Mara', type: 'npc', isMajor: true, description: 'A boat-woman.', persona: 'Dry and watchful.', goal: 'Collect her debt.', secrets: 'She can swim.' }
      ],
      factions: [{ id: 'fac_tide', name: 'Tide Guild', description: 'Runs the boats.' }],
      relationships: [{ a: 'npc_mara', b: 'npc_mara', label: 'self', score: 0 }],
      lorebook: [{ keyword: 'canal,water', text: 'The water is black and still.' }],
      startingLives: [{ id: 'origin_main', name: 'New Face in Town', role: 'A visitor.', startLocationId: 'loc_dock', description: 'You arrive at the dock.' }],
      gameRules: { modules: { quests: true, relationships: true, livingWorld: true } },
      hudConfig: { showClock: true, startWeekday: 'Monday', startTimeHours: 8, timeStep: 10 }
    };
    var wbox = {
      console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
      Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
      Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder
    };
    wbox.window = wbox;
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'hordeworld.js'), 'utf8'), wbox, { filename: 'hordeworld.js' });

    /* ---- the three-part world draft joins through HW.assemble ------------ */
    var partPlaces = {
      name: 'Drowned City', description: 'A sunken metropolis of canals.',
      startLocationId: 'loc_dock',
      locations: [
        { id: 'loc_region', name: 'The Shallows', mapType: 'region', parentLocationId: null, description: 'The drowned city.', exits: [{ text: 'to Old Dock', travelTime: 5, isOneWay: false }] },
        { id: 'loc_dock', name: 'Old Dock', mapType: 'building', parentLocationId: 'loc_region', description: 'A rotted pier.', exits: [{ text: 'to The Shallows', travelTime: 5, isOneWay: false }] }
      ]
    };
    var partPeople = {
      entities: [{ id: 'npc_mara', name: 'Mara', type: 'npc', isMajor: true, description: 'A boat-woman.', persona: 'Dry and watchful.', goal: 'Collect her debt.', secrets: 'She can swim.' }],
      factions: [{ id: 'fac_tide', name: 'Tide Guild', description: 'Runs the boats.' }],
      relationships: [{ a: 'npc_mara', b: 'npc_mara', label: 'self', score: 0 }]
    };
    var partRules = {
      dmPrompt: 'You are the showrunner and referee. ' + 'Filler. '.repeat(30),
      intro: 'The water is at your ankles.',
      authorNote: 'Keep it honest.',
      startingLives: [{ id: 'origin_main', name: 'New Face in Town', role: 'A visitor.', startLocationId: 'loc_dock', description: 'You arrive at the dock.' }],
      gameRules: { modules: { quests: true, relationships: true, livingWorld: true } },
      hudConfig: { showClock: true, startWeekday: 'Monday', startTimeHours: 8, timeStep: 10 }
    };

    var assembled = wbox.HW.assemble({ places: partPlaces, people: partPeople, rules: partRules });
    ok('assemble produces a .horde_world-shaped object', assembled && assembled._format === 'horde-world');
    var joined = wbox.HW.parse(assembled);
    ok('a three-part draft parses into a world', !!joined);
    ok('the join keeps places from part one', joined && joined.locations.length === 2 && joined.startLocationId === 'loc_dock');
    ok('the join keeps the cast from part two', joined && joined.entities.length === 1 && joined.factions.length === 1);
    ok('the join keeps the rules from part three', joined && joined.dmPrompt.length > 100 && joined.startingLives[0].startLocationId === 'loc_dock');

    ok('a draft missing its places is rejected', wbox.HW.parse(wbox.HW.assemble({ people: partPeople, rules: partRules })) === null);
    ok('an empty assemble is rejected', wbox.HW.parse(wbox.HW.assemble({})) === null);

    var w = wbox.HW.parse(JSON.parse(JSON.stringify(worldRaw)));
    ok('a model-shaped world survives HW.parse', !!w, JSON.stringify(w));
    ok('the world keeps its name', w && w.name === 'Drowned City');
    ok('locations normalise with exits', w && w.locations.length === 2 && w.locations[0].exits.length === 1 && w.locations[0].exits[0].travelTime === 5);
    ok('entities normalise', w && w.entities.length === 1 && w.entities[0].persona === 'Dry and watchful.');
    ok('starting lives keep their start location', w && w.startingLives[0].startLocationId === 'loc_dock');
    ok('a world with no locations is rejected', wbox.HW.parse({ _format: 'horde-world', name: 'X' }) === null);

    console.log('');
    if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
    console.log('aicreate-test: ' + pass + ' ok');
  })
  .catch(function (e) {
    console.log('  FAIL threw ' + (e && e.stack || e));
    process.exit(1);
  });
