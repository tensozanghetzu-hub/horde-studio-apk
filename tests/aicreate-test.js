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
    setTimeout: setTimeout, clearTimeout: clearTimeout,
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

/* A whole-person draft has several ordered fields. A model can hit its output
   cap after completing persona but halfway through examples; that useful
   prefix should be recoverable only for the draft flow, not by the strict
   generic parser above. */
var clippedPersona = 'A precise, guarded witch with "silver" eyes and a cutting voice.';
var clippedCharacter = '{"name":"Draconica","tagline":"Proud, polished, and difficult to read","persona":' +
  JSON.stringify(clippedPersona) + ',"scenario":"At university-style Hogwarts, a letter appears in her bag.",' +
  '"greeting":"She looks up. \\"That is not yours.\\"","examples":"{{user}}: What is it?';
ok('partial character parser salvages complete fields before a clipped tail',
  typeof r.api.parseAiJsonPartial === 'function' &&
  (r.api.parseAiJsonPartial(clippedCharacter) || {}).persona === clippedPersona &&
  !(r.api.parseAiJsonPartial(clippedCharacter) || {}).examples);
var clippedLife = '{"places":[{"id":"home","name":"Home","kind":"home"},{"id":"school","name":"Hogwarts","kind":"work"}],' +
  '"routine":[{"t":"08:00","a":"Breakfast before class"}],"sleep":{"start":"23:00","end":"07:00"},' +
  '"people":[{"name":"Pansy","relation":"friend","closeness":0.4}],"diary":["A tense first day';
var savedLife = r.api.parseAiJsonPartial(clippedLife) || {};
ok('partial life parser keeps completed top-level arrays', savedLife.places && savedLife.places.length === 2 &&
  savedLife.routine && savedLife.routine.length === 1 && !savedLife.diary);

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
      var truncated = loadApi(clippedCharacter);
      return truncated.api.aiJson(settings(), 'whole person', 450, null, true).then(function (partial) {
        ok('Horde whole-person JSON recovers a complete persona prefix',
          partial && partial.persona === clippedPersona && !partial.examples, JSON.stringify(partial));
        var lifeCall = loadApi(clippedLife);
        return lifeCall.api.aiJson(settings(), 'life around the character', 480, null, true).then(function (life) {
          ok('the bounded life request recovers completed places and routine',
            life && life.places && life.places.length === 2 && life.routine && life.routine.length === 1,
            JSON.stringify(life));
          ok('life request stays below the Horde anonymous ceiling', lifeCall.sent().maxLength === 480);
        }).then(function () {
        var other = loadApi(clippedCharacter);
        var otherSettings = settings();
        otherSettings.provider = 'openai';
        otherSettings.baseUrl = 'https://api.example.test/v1';
        otherSettings.model = 'test-model';
        return other.api.aiJson(otherSettings, 'whole person', 450, null, true).then(function (otherPartial) {
          ok('OpenAI-compatible whole-person JSON recovers the same prefix',
            otherPartial && otherPartial.persona === clippedPersona && !otherPartial.examples,
            JSON.stringify(otherPartial));
          var prose = loadApi('Draconica is a brilliant, guarded witch who hides her fears behind impeccable manners.');
          return prose.api.aiJson(otherSettings, 'whole person', 450, null, 'character').then(function (draft) {
            ok('plain-text model replies become an editable persona instead of a dead-end toast',
              draft && /brilliant, guarded witch/.test(draft.persona || ''), JSON.stringify(draft));
            var alias = loadApi('{"name":"Draconica","description":"A proud witch with a guarded, incisive voice."}');
            return alias.api.aiJson(otherSettings, 'whole person', 450, null, 'character').then(function (a) {
              ok('description-shaped JSON is normalized into persona',
                a && /proud witch/.test(a.persona || ''), JSON.stringify(a));
              var refused = loadApi('I cannot help with that request.');
              return refused.api.aiJson(otherSettings, 'whole person', 450, null, 'character').then(function (rj) {
                ok('a clear model refusal is not misfiled as a character persona', rj === null, JSON.stringify(rj));
                var plainScene = loadApi('At midnight, the Slytherin common room door opens onto a rain-soaked courtyard.');
                return plainScene.api.aiJson(otherSettings, 'write a scenario', 320, null, 'scenario').then(function (scene) {
                  ok('plain-text scenario replies become an editable scenario',
                    scene && /midnight, the Slytherin common room/.test(scene.scenario || ''), JSON.stringify(scene));
                  var sceneAlias = loadApi('{"situation":"At dawn, she discovers a sealed invitation on her desk."}');
                  return sceneAlias.api.aiJson(otherSettings, 'write a scenario', 320, null, 'scenario').then(function (aliasScene) {
                    ok('situation-shaped scenario JSON is normalized',
                      aliasScene && /sealed invitation/.test(aliasScene.scenario || ''), JSON.stringify(aliasScene));
                  });
                });
              });
            });
          });
        });
      });
    });
  })
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

    /* v1.35.0: the richer schema survives the same three-part machine */
    var rich = wbox.HW.parse(wbox.HW.assemble({
      places: partPlaces,
      people: {
        entities: [{ id: 'npc_mara', name: 'Mara', type: 'npc', persona: 'Dry and watchful.',
          homeLocation: 'loc_dock',
          schedule: [{ time: '09:00', locationId: 'loc_dock', activity: 'Mends the nets', days: ['weekday'] }] }],
        factions: [{ id: 'fac_tide', name: 'Tide Guild', description: 'Runs the boats.', goal: 'Own every mooring.' }]
      },
      rules: {
        dmPrompt: 'You are the showrunner and referee. ' + 'Filler. '.repeat(30),
        intro: 'The water is at your ankles.',
        startingLives: [{ id: 'origin_main', name: 'New Face in Town', role: 'A visitor.',
          startLocationId: 'loc_dock', statOverrides: { grit: 7 },
          obligations: ['Find dry shoes'], outfit: 'borrowed oilskins' }],
        startingQuests: ['Learn which bells mean high water'],
        goalPrograms: [{ id: 'scheme_tide', name: 'The Tide takes the north', actor: 'fac_tide',
          steps: ['buy up moorings', 'fix the ferry tolls', 'dam the upper canal'] }],
        gameRules: { modules: { quests: true, relationships: true, livingWorld: true } },
        hudConfig: { showClock: true, startWeekday: 'Monday', startTimeHours: 8, startTimeMinutes: 57, timeStep: 10,
          stats: [{ id: 'grit', name: 'Grit', value: 3, min: 0, max: 10 }] },
        kernel: { sceneLocationLimit: 12 }
      }
    }));
    ok('a rich draft still parses', !!rich);
    ok('the cast keeps its day', rich && rich.entities[0].schedule.length === 1 &&
      rich.entities[0].schedule[0].time === '09:00' && rich.entities[0].homeLocation === 'loc_dock');
    ok('goal programs ride assemble through', rich && rich.goalPrograms.length === 1 &&
      rich.goalPrograms[0].steps.length === 3);
    ok('the stat registry survives', rich && rich.hudConfig.stats.length === 1 &&
      rich.hudConfig.stats[0].id === 'grit');
    ok('the scene cap survives too', rich && rich.kernel.sceneLocationLimit === 12);

    /* v1.36.1: the book has a spine - lore rides the third draft through */
    var loreDraft = wbox.HW.parse(wbox.HW.assemble({
      places: partPlaces,
      people: partPeople,
      rules: {
        dmPrompt: 'You are the showrunner and referee. ' + 'Filler. '.repeat(30),
        intro: 'The water is at your ankles.',
        lorebook: [
          { keyword: 'tide guild', text: 'The Tide Guild owns every mooring north of the Shallows.', knownBy: 'faction:fac_tide' },
          { keyword: 'the shallows', text: 'The flood took the city on a night tide.' }
        ]
      }
    }));
    ok('a drafted lorebook rides assemble through', loreDraft && loreDraft.lorebook.length === 2);
    ok('...with its gates intact', loreDraft && loreDraft.lorebook[0].knownBy === 'faction:fac_tide' &&
      loreDraft.lorebook[1].knownBy === '');

    /* v1.38.0: classwork rides the third draft too - the catalog and its
       classes, whole, through the three-part machine */
    var classDraft = wbox.HW.parse(wbox.HW.assemble({
      places: partPlaces, people: partPeople,
      rules: {
        dmPrompt: 'You are the showrunner and referee. ' + 'Filler. '.repeat(30),
        intro: 'The water is at your ankles.',
        skillsCatalog: [{ id: 'skill_ropes', name: 'Knotwork', description: 'Rope tells the truth.', stat: 'grit' }],
        classes: [{ id: 'cls_boatwright', name: 'Boatwright', description: 'Builds what floats.',
          statOverrides: { grit: 7 }, skills: ['skill_ropes'], obligations: [], outfit: 'tar-thick apron' }]
      }
    }));
    ok('a drafted catalog rides assemble through', classDraft && (classDraft.skillsCatalog || []).length === 1);
    ok('...and the classes that use it', classDraft && (classDraft.classes || []).length === 1 &&
      classDraft.classes[0].skills[0] === 'skill_ropes');

    /* v1.36.1: the character side learns its word edges too */
    var cchar = {
      name: 'Mara', persona: 'Dry and watchful.',
      lorebook: [
        { keys: ['bell'], content: 'bells at noon', enabled: true },
        { keys: ['mark'], content: 'the Mark counts coin', enabled: true },
        { keys: ['gossip'], content: 'gossip has wings', enabled: true }
      ]
    };
    var chatBox = loadApi('');
    var csys = chatBox.api.buildChat(cchar, {}, [{ role: 'assistant', text: 'The labelling faded years ago.' }], settings())[0].content;
    ok('char lore ignores an embedded mention (labelling ≠ bell)', csys.indexOf('Relevant world facts') === -1, csys.slice(0, 60));
    var csys2 = chatBox.api.buildChat(cchar, {}, [{ role: 'assistant', text: 'The market is open; the bell rings.' }], settings())[0].content;
    ok('char lore keeps the real word but not the embedded one',
      csys2.indexOf('bells at noon') !== -1 && csys2.indexOf('the Mark counts coin') === -1);
    var csys3 = chatBox.api.buildChat(cchar, {}, [{ role: 'assistant', text: 'She trades in gossips.' }], settings())[0].content;
    ok('char lore still knows a bare plural (gossips → gossip)', csys3.indexOf('gossip has wings') !== -1);

    /* v1.37.0: the character side learns the byte budget - the pile stops
       at the budget (world rule), and a lone match may exceed it alone */
    var fat = function (n, ch, key) { return { keys: [key], content: new Array(n + 1).join(ch), enabled: true }; };
    var fatChar = { name: 'Fat', lorebook: [fat(600, 'a', 'alpha'), fat(600, 'b', 'bravo'), fat(600, 'c', 'charlie')] };
    var fsheet = chatBox.api.buildChat(fatChar, {}, [{ role: 'assistant', text: 'alpha bravo charlie all night' }], settings())[0].content;
    var fblock = (fsheet.split('Relevant world facts:')[1] || '').split('\n\n')[0];
    var frows = fblock.split('\n').filter(function (l) { return l.indexOf('- ') === 0; });
    ok('the char-lore pile stops at the byte budget', frows.length === 2, frows.length + ' injected');
    ok('...and the latecomer waits its turn', fsheet.indexOf(new Array(40).join('c')) === -1);
    var loneChar = { name: 'Lone', lorebook: [fat(2000, 'q', 'only')] };
    var lsheet = chatBox.api.buildChat(loneChar, {}, [{ role: 'assistant', text: 'only the truth' }], settings())[0].content;
    ok('a lone match still gets in (the budget floor)', lsheet.indexOf(new Array(2001).join('q')) !== -1);

    var richRun = wbox.HW.start(rich, 'origin_main');
    ok('a life starts like the life, straight from the draft',
      richRun.stats.grit === 7 && richRun.outfit === 'borrowed oilskins' &&
      richRun.quests.length === 2 &&
      richRun.quests[0].text === 'Find dry shoes' &&
      richRun.quests[1].text === 'Learn which bells mean high water',
      JSON.stringify({ stats: richRun.stats, quests: richRun.quests, outfit: richRun.outfit }));

    /* the ask itself, asserted against app.js - the schema is the product */
    var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    var viewsSrc = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
    ok('the whole-person draft opts into character-response recovery',
      /450,\s*null,\s*'character'\)\.then\(function \(a\)/.test(viewsSrc));
    ok('the first draft keeps fields compact enough for its output budget',
      /under 100 words/.test(viewsSrc) && /"scenario":string \(1-2 sentences/.test(viewsSrc) &&
      /one short \{\{user\}\}: and \{\{char\}\}: exchange/.test(viewsSrc));
    ok('empty model output gets a useful diagnostic, not the generic toast',
      /The model returned no character description/.test(viewsSrc));
    ok('the life request recovers a completed prefix under a safe token bound',
      /480,\s*null,\s*true\)\.then\(function \(b\)/.test(viewsSrc));
    ok('life-generation failure still returns the person to an editable sheet',
      /Life details were not returned; the default routine and places are ready to edit/.test(viewsSrc) &&
      /Views\.editor\(\$\('#editor-body'\), Object\.assign\(\{\}, char, draft, \{ vh: vh \}\)\)/.test(viewsSrc));
    ok('scenario draft accepts prose and salvages a short structured response',
      /320,\s*null,\s*'scenario'\)\.then\(function \(d\)/.test(viewsSrc));
    ok('the people draft asks for homes and days',
      appSrc.indexOf('homeLocation') !== -1 && appSrc.indexOf('schedule: [{') !== -1);
    ok('...and is told the place ids', appSrc.indexOf('var placeIds') !== -1 &&
      appSrc.indexOf('The place ids that exist') !== -1);
    ok('the rules draft asks for tasks, schemes, and a stat registry',
      appSrc.indexOf('startingQuests') !== -1 && appSrc.indexOf('goalPrograms') !== -1 &&
      appSrc.indexOf('stat_snake') !== -1);
    ok('lives are asked to arrive lived (overrides, obligations, outfit)',
      appSrc.indexOf('statOverrides') !== -1 && appSrc.indexOf('obligations') !== -1 &&
      appSrc.indexOf('outfit') !== -1);
    /* v1.38.1 the honest budget: the bench proved the old 700/800 asks die
       anonymously (the Horde walls requests over 512 without kudos). The
       flow is five small asks now, each at most 512 - the first bench
       round then caught the single-bones ask overflowing the wall again,
       so the numbers and the book are two asks. */
    var createBlock = appSrc.slice(appSrc.indexOf('App.aiCreateWorld = function'));
    createBlock = createBlock.slice(0, createBlock.indexOf('App.importWorld'));
    var asks = (createBlock.match(/,\s*(\d+), prog\)/g) || []).map(function (m) {
      return parseInt(m.replace(/[^\d]/g, ''), 10);
    });
    ok('the creation flow makes five bounded requests', asks.length === 5, JSON.stringify(asks));
    ok('...and every ask fits the anonymous wall', asks.every(function (n) { return n <= 512; }),
      JSON.stringify(asks));
    ok('...saying so on the button', createBlock.indexOf('Create (5 requests)') !== -1);
    ok('the rules draft asks for a living book (v1.36.1)',
      /lorebook.{0,220}keyword/.test(appSrc) && /keyword.{0,120}really (come up|type)/s.test(appSrc));
    ok('the rules draft offers classwork with real stats (v1.38.0)',
      appSrc.indexOf('classes') !== -1 && appSrc.indexOf('skillsCatalog') !== -1 &&
      /skillsCatalog.[\s\S]{0,220}stat/.test(appSrc));

    /* v1.36.0: the world's memory keeper - transcript shapes up, ledger
       mechanics excluded by instruction, and memory parses loose output */
    var memText = 'Despite noise {"summary":"The keeper of Thornkeep confessed the flood was his doing.","facts":["The keeper caused the flood","The ferry fare is two apples"],"junk":true} trailing';
    var memCall = loadApi(memText);
    return memCall.api.summarizeWorld({
      settings: settings(),
      world: { name: 'Thornkeep' },
      run: { log: [
        { role: 'user', content: 'I ask who sank the town.' },
        { role: 'assistant', content: 'The keeper lowers his lamp: "That was me."' },
        { role: 'system', content: '[move:crossroads]' },
        { role: 'user', content: 'I say nothing.' }
      ]}
    }).then(function (mem) {
      ok('the memory parses out of noisy text', !!mem && /confessed/.test(mem.summary || ''), JSON.stringify(mem && mem.summary).slice(0, 80));
      ok('...with its durable facts', (mem.facts || []).length === 2 && mem.facts[0].indexOf('caused the flood') !== -1);
      var asked = String(memCall.sent().prompt || '');
      ok('the transcript speaks in world voices', /Thornkeep:/.test(asked) && /Player: I ask who sank the town/.test(asked), asked.slice(-160));
      ok('dice verdicts stay out of the story', asked.indexOf('crossroads') === -1);
      ok('the instruction keeps the ledger off the menu', /Do NOT record tag commands/.test(asked));
      console.log('');
      if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
      console.log('aicreate-test: ' + pass + ' ok');
    }, function (e) { ok('summarizeWorld resolves', false, e && e.message); process.exit(1); });
  })
  .catch(function (e) {
    console.log('  FAIL threw ' + (e && e.stack || e));
    process.exit(1);
  });
