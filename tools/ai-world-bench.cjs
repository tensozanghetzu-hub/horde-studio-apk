/* AI world-creator bench (quality pass, v1.38.1): fires the app's exact
 * three-part draft prompts at a LIVE Horde model over real HTTP, grades
 * the answers structurally, and dumps everything for human reading.
 *
 * The prompt strings are lifted out of app.js source by evaluating the
 * same concatenation expressions the phone runs - the bench can never
 * drift from what the app actually sends. `--print-only` builds the
 * prompts without spending anything.
 *
 *   node tools/ai-world-bench.mjs "<idea>" <model> <outdir> [--print-only]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const IDEA = process.argv[2] ||
  'a drowned city where the streets are canals and the oldest families live in the upper floors, above the water';
const MODEL = process.argv[3] || 'koboldcpp/L3-8B-Stheno-v3.2';
const OUT = process.argv[4] || path.join(ROOT, 'bench');
const PRINT_ONLY = process.argv.includes('--print-only');
const HORDE_BASE = 'https://stablehorde.net/api/v2';
const ANON = '0000000000';

fs.mkdirSync(OUT, { recursive: true });

/* ---------------- the app's own API client, real network --------------- */
const sandbox = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp,
  Error, isNaN, parseFloat, parseInt, TextEncoder, TextDecoder, setTimeout, clearTimeout,
  AbortController, Headers, Request, Response,
  fetch: (...a) => fetch(...a),
  HORDE_BASE
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/horde.js'), 'utf8'), sandbox, { filename: 'horde.js' });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/api.js'), 'utf8'), sandbox, { filename: 'api.js' });
const API = sandbox.API;

/* ------- lift the three prompt expressions straight out of app.js ------ */
const appSrc = fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/app.js'), 'utf8');
/* every API.aiJson(Store.settings, <expr>, <tokens>, prog) inside the
   creation flow, in source order, with the token knob it asks */
const cwWin = appSrc.slice(appSrc.indexOf('App.aiCreateWorld = function'),
  appSrc.indexOf('App.importWorld = function'));
const LIFTS = [];
(function scan() {
  const re = /API\.aiJson\(Store\.settings,\s*\n([\s\S]*?),\s*\n\s*(\d+), prog\)/g;
  let m; while ((m = re.exec(cwWin))) LIFTS.push({ expr: m[1].trim(), tokens: parseInt(m[2], 10) });
})();
if (!LIFTS.length) throw new Error('bench: no aiJson asks found in App.aiCreateWorld');
console.log('lifted ' + LIFTS.length + ' asks from app.js: ' + LIFTS.map(l => l.tokens).join(' / ') + ' tokens');

function grabVarDecls(cwWin) {
  /* hoist the shape/ids declarations out of the creation function so the
     evaluation harness can run them before the prompt expressions */
  const names = ['placesShape', 'peopleShape', 'waysInShape', 'bookShape'];
  names.push('statIds');
  return names.map(n => {
    const m = cwWin.match(new RegExp('var ' + n + ' = ([\\s\\S]*?);\\n'));
    if (!m) throw new Error('bench: no decl for ' + n);
    return 'var ' + n + ' = ' + m[1] + ';';
  }).join('\n');
}

function buildPrompts() {
  const decls = grabVarDecls(cwWin);
  const exprs = LIFTS.map(l => l.expr);
  const fn = new Function('idea', 'places', 'placeIds', 'waysIn',
    decls + '\nvar locIds = placeIds;\nreturn [' + exprs.map(e => '(' + e + ')').join(',') + '];');
  return function (idea, places, placeIds, waysIn) {
    const all = fn(idea, places, placeIds, waysIn || { hudConfig: { stats: [{ id: 'stat_gold' }] } });
    return all; /* array of the four prompt strings, in source order */
  };
}

if (PRINT_ONLY) {
  const bp = buildPrompts();
  const probe = {
    name: 'Probe City', startLocationId: 'loc_a',
    locations: [{ id: 'loc_a', name: 'A' }, { id: 'loc_b', name: 'B' }]
  };
  const texts = bp(IDEA, probe, 'loc_a, loc_b');
  [['1-places', ['Answer with the JSON only', 'locations', 'exits', IDEA.slice(0, 16)]],
   ['2-people', [probe.name, 'The place ids that exist: loc_a, loc_b', 'entities', 'schedule']],
   ['3-referee', [probe.name, 'dmPrompt', 'intro']],
   ['4-ways-in', ['stat_snake', 'startingLives', 'hudConfig', 'startingQuests']],
   ['5-book', ['stat_gold', 'skillsCatalog', 'classes', 'lorebook']]]
    .forEach(([label, needles], i) => {
      const txt = texts[i];
      const missing = needles.filter(n => txt.indexOf(n) === -1);
      console.log(label + ': ' + txt.length + ' chars, ask ' + LIFTS[i].tokens + ', ' +
        (missing.length ? 'MISSING ' + JSON.stringify(missing) : 'all markers present'));
      if (missing.length || LIFTS[i].tokens > 512) process.exitCode = 2;
    });
  process.exit(process.exitCode || 0);
}

/* ------------- structural judges (mirror of the app's needs) ----------- */
function judgePlaces(w) {
  const ms = [];
  const locs = (w && w.locations) || [];
  const ids = new Set(locs.map(l => l.id));
  if (locs.length < 4) ms.push('fewer than four places (' + locs.length + ')');
  if (!w || !w.startLocationId || !ids.has(w.startLocationId)) ms.push('startLocationId does not point inside the map');
  const nameSet = new Set(locs.map(l => String(l.name).toLowerCase()));
  locs.forEach(l => (l.exits || []).forEach(x => {
    const to = String(x.to || (x.text || '').replace(/^to\s+/i, '')).trim().toLowerCase();
    if (to && !ids.has(x.to) && !nameSet.has(to)) ms.push('an exit from ' + l.id + ' leads outside the known world (' + (x.to || x.text) + ')');
  }));
  if (!w || !w.name) ms.push('no name');
  return ms;
}
function judgePeople(p, places) {
  const ms = [];
  const ids = new Set(((places && places.locations) || []).map(l => l.id));
  const ent = (p && p.entities) || [];
  if (!ent.length) ms.push('no people');
  const names = new Set();
  ent.forEach(e => {
    if (names.has(String(e.name))) ms.push('duplicate name ' + e.name);
    names.add(String(e.name));
    if (e.homeLocation && !ids.has(e.homeLocation)) ms.push(e.name + ' lives at unknown place ' + e.homeLocation);
    (e.schedule || []).forEach(s => { if (s.locationId && !ids.has(s.locationId)) ms.push(e.name + "'s day visits unknown place " + s.locationId); });
    if (!e.persona || e.persona.length < 60) ms.push(e.name + ' is flat (persona ' + (e.persona || '').length + ' chars)');
  });
  return ms;
}
function judgeRules(r, places) {
  const ms = [];
  const locs = (places && places.locations) || [];
  const namesTxt = (locs.map(l => l.name).join(' ')).toLowerCase();
  if (!r || !r.dmPrompt) ms.push('no referee prompt');
  else {
    if (!/never write the player|player('s|’s) (words|actions)|never (speak|decide) for the player/i.test(r.dmPrompt)) ms.push('the referee prompt never plants player agency');
    if (r.dmPrompt.split(/\s+/).length < 120) ms.push('referee prompt is thin (' + r.dmPrompt.split(/\s+/).length + ' words)');
  }
  (r.lorebook || []).forEach(l => {
    const k = String(l.keyword || '');
    const words = k.split(/[\s,]+/).filter(Boolean).length;
    if (words > 2) ms.push('lore key "' + k + '" is ' + words + ' words - nobody types that');
    const stem = k.split(/[\s,]+/).join(' ').toLowerCase().replace(/^(the|a|an)\s+/, '');
    if (stem && namesTxt.indexOf(stem) === -1) ms.push('lore key "' + k + '" is said nowhere in the world that came with it');
  });
  const stats = new Set(((r.hudConfig || {}).stats || []).map(s => s.id));
  const cat = new Set((r.skillsCatalog || []).map(s => s.id));
  (r.classes || []).forEach(c => {
    (c.skills || []).forEach(k => { if (!cat.has(k)) ms.push('class "' + (c.name || c.id) + '" names skill ' + k + ' - not in the catalog'); });
    Object.keys(c.statOverrides || {}).forEach(k => { if (stats.size && !stats.has(k)) ms.push('class "' + (c.name || c.id) + '" overrides unknown stat ' + k); });
  });
  (r.startingLives || []).forEach(l => {
    if (!l.startLocationId || !locs.some(x => x.id === l.startLocationId)) ms.push('a way in starts nowhere (' + JSON.stringify(l.startLocationId) + ')');
  });
  return ms;
}

/* ---------------- the three calls, app-like ---------------------------- */
const settings = { provider: 'horde', hordeTextModel: MODEL, hordeKey: ANON };
async function stage(name, prompt, maxTokens) {
  console.log('\n[' + name + '] ask ' + maxTokens + ' tok, prompt ~' + Math.ceil(prompt.length / 4) + ' tok…');
  fs.writeFileSync(path.join(OUT, name + '.prompt.txt'), prompt);
  const t0 = Date.now();
  const raw = await sandbox.Horde.generateText({
    prompt, model: MODEL, maxLength: maxTokens, temperature: 0.3, apikey: ANON, maxWait: 900
  });
  fs.writeFileSync(path.join(OUT, name + '.raw.txt'), raw.text || '');
  console.log('  answered in ' + Math.round((Date.now() - t0) / 1000) + 's, ' + (raw.text || '').length + ' chars');
  const o = API.parseAiJson(raw.text);
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(o, null, 2));
  return o;
}

(async () => {
  const bp = buildPrompts();
  console.log('idea: ' + IDEA + '\nmodel: ' + MODEL + ' (anonymous, live)\nout: ' + OUT);

  const p0 = bp(IDEA, { name: '(your world)' }, 'loc_x');
  const places = await stage('1-places', p0[0], LIFTS[0].tokens);
  const m1 = places ? judgePlaces(places) : ['parse failed'];
  console.log('  => ' + (places ? (places.locations || []).length + ' places' : 'PARSE FAILED') + (m1.length ? (' · misses: ' + m1.join('; ')) : ' · structurally clean'));
  if (!places || !Array.isArray(places.locations) || !places.locations.length) process.exit(2);

  const placeIds = places.locations.map(l => l.id).join(', ');
  const people = await stage('2-people', bp(IDEA, places, placeIds)[1], LIFTS[1].tokens);
  const m2 = people ? judgePeople(people, places) : ['parse failed'];
  console.log('  => ' + (people ? (people.entities || []).length + ' people' : 'PARSE FAILED') + (m2.length ? (' · misses: ' + m2.join('; ')) : ' · structurally clean'));
  if (!people || !Array.isArray(people.entities) || !people.entities.length) process.exit(2);

  const referee = await stage('3-referee', bp(IDEA, places, placeIds)[2], LIFTS[2].tokens);
  const m3r = (!referee || !referee.dmPrompt) ? ['parse failed or no referee prompt'] : judgeRules(Object.assign({}, referee, { startingLives: [{ startLocationId: places.locations[0].id }] }), places);
  console.log('  => ' + (referee && referee.dmPrompt ? 'referee written' : 'PARSE FAILED') + (m3r.length ? (' · misses: ' + m3r.map(m => m.replace(/unknown stat.*/, 'unknown stat*')).join('; ')) : ' · structurally clean'));

  const waysIn = await stage('4-ways-in', bp(IDEA, places, placeIds)[3], LIFTS[3].tokens);
  const m4w = (!waysIn || !waysIn.hudConfig) ? ['parse failed or no hudConfig'] : judgeRules(Object.assign({}, waysIn, { lorebook: [], classes: [], skillsCatalog: [] }), places).filter(m => m.indexOf('referee') === -1);
  console.log('  => ' + (waysIn && waysIn.hudConfig ? 'ways-in written with ' + ((((waysIn.hudConfig || {}).stats) || []).length) + ' stats' : 'PARSE FAILED') + (m4w.length ? (' · misses: ' + m4w.join('; ')) : ' · structurally clean'));
  if (!waysIn) process.exit(2);

  const book = await stage('5-book', bp(IDEA, places, placeIds, waysIn)[4], LIFTS[4].tokens);
  const rules = Object.assign({}, referee || {}, waysIn || {}, book || {});
  const m5 = book ? judgeRules(rules, places).filter(m => m.indexOf('referee') === -1 && m.indexOf('way in') === -1) : ['parse failed'];
  fs.writeFileSync(path.join(OUT, '5-merged-rules.json'), JSON.stringify(rules, null, 2));
  console.log('  => ' + (book ? 'book written (' + Object.keys(book).length + ' keys)' : 'PARSE FAILED') + (m5.length ? ('\n  misses:\n   - ' + m5.join('\n   - ')) : ' · structurally clean'));

  const misses = m1.concat(m2, m4w, m5);
  console.log('\nBENCH TOTAL: ' + (misses.length ? (misses.length + ' structural misses') : 'clean around the wall') + '\nread ' + OUT + '/*.json for the flavor pass.');
  process.exit(0);
})().catch(e => { console.error('bench threw:', e && e.message || e); process.exit(1); });
