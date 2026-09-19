/* Save as tests/world-compatibility-regression-test.js in horde-studio-apk.
 * Node 18+; no npm packages, credentials, network requests or Android SDK needed.
 * Usage: node tests/world-compatibility-regression-test.js
 * Optional first argument: path to a different horde-studio-mobile web root.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = process.argv[2] ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'horde-studio-mobile');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
}
function context(extra = {}) {
  const c = { console, TextEncoder, TextDecoder, Response, ReadableStream,
    setTimeout, clearTimeout, location: { origin: 'https://test.invalid' }, ...extra };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const name of ['hordeworld.js', 'api.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), c, { filename: name });
  }
  return c;
}
const settings = {
  systemPrompt: 'GLOBAL_FALLBACK_SENTINEL', userName: 'Player',
  contextMessages: 40, maxContextChars: 26000,
  provider: 'custom', baseUrl: 'https://test.invalid', model: 'fake-test-model',
  maxTokens: 1000, temperature: 0.7, streaming: false, autoFinish: false
};
const character = systemPrompt => ({
  id: 'world_test', name: 'Test World', persona: '', scenario: '', examples: '',
  lorebook: [], systemPrompt
});
const occurrences = (text, token) => text.split(token).length - 1;
const rawWorld = {
  _format: 'horde-world', _version: 2, id: 'world_test', name: 'Test World',
  dmPrompt: 'WORLD_NARRATOR_SENTINEL', startLocationId: 'loc_start',
  locations: [{ id: 'loc_start', name: 'Start', description: 'A test room.', exits: [] }],
  entities: [], lorebook: [{ id: 'lore_one', keyword: '@test-lore@', text: 'LORE_SENTINEL' }],
  hudConfig: { stats: [{ id: 'hp', name: 'HP', value: 100, max: 100 }] },
  gameRules: { currencyStatId: 'gil', currencyName: 'gil', modules: { inventory: true, quests: true } },
  startingLives: [{ id: 'origin_test', name: 'Test origin', role: 'tester',
    startLocationId: 'loc_start', inventory: ['STATE_SENTINEL'] }]
};
async function generateChat(streaming, pieces, autoFinish = false) {
  let requestCount = 0; const sent = [];
  const box = context({ fetch: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    const text = pieces[Math.min(requestCount++, pieces.length - 1)];
    if (!streaming) {
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const chunks = [text.slice(0, 16), text.slice(16)];
    const events = chunks.map(t => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] })
      + '\n\n').join('') + 'data: [DONE]\n\n';
    return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } });
  const text = await box.API.generate({
    settings: { ...settings, streaming, autoFinish }, character: character('WORLD_SENTINEL'),
    session: {}, history: [{ role: 'user', text: 'Begin' }]
  });
  return { text, sent, requestCount, box };
}
(async () => {
  for (const backend of ['chat', 'horde']) {
    await test(backend + ': world prompt, live state and requested lore reach provider payload', () => {
      const c = context(); const w = c.HW.parse(rawWorld); const run = c.HW.start(w, 'origin_test');
      const built = c.HW.buildPrompt(w, run, 'Begin @test-lore@');
      const history = built.messages.map(m => ({ role: m.role, text: m.content }));
      const ch = character(built.system);
      const payload = backend === 'chat'
        ? JSON.stringify(c.API.buildChat(ch, {}, history, settings))
        : c.API.buildPrompt(ch, {}, history, settings, null, 7000);
      for (const token of ['WORLD_NARRATOR_SENTINEL', 'STATE_SENTINEL', 'LORE_SENTINEL']) {
        assert(payload.includes(token), 'Missing ' + token);
      }
    });
    await test(backend + ': missing custom prompt preserves global fallback', () => {
      const c = context(); const ch = character('');
      const payload = backend === 'chat'
        ? JSON.stringify(c.API.buildChat(ch, {}, [], settings))
        : c.API.buildPrompt(ch, {}, [], settings);
      assert(payload.includes('GLOBAL_FALLBACK_SENTINEL'));
    });
  }
  for (const streaming of [false, true]) {
    await test((streaming ? 'Streaming' : 'Non-streaming') + ': response/state tags appear once', async () => {
      const result = await generateChat(streaming, ['You receive a coin.\n[[cash:+10]]']);
      assert.equal(occurrences(result.text, '[[cash:+10]]'), 1);
      assert.equal(occurrences(result.text, 'You receive a coin.'), 1);
      assert.equal(result.sent[0].stream, streaming);
      assert(result.sent[0].messages[0].content.includes('WORLD_SENTINEL'));
      const w = result.box.HW.parse(rawWorld); const run = result.box.HW.start(w, 'origin_test');
      result.box.HW.applyTags(w, run, result.text);
      assert.equal(run.stats.gil, 10, 'One authored +10 tag must settle once');
    });
    await test((streaming ? 'Streaming' : 'Non-streaming') + ': continuation retains earlier text once', async () => {
      const result = await generateChat(streaming, ['You enter the', ' inn.\n[[cash:+10]]'], true);
      assert.equal(result.requestCount, 2);
      assert.equal(occurrences(result.text, 'You enter the'), 1);
      assert.equal(occurrences(result.text, '[[cash:+10]]'), 1);
      assert(result.text.includes('You enter the inn.'));
    });
  }
  await test('AI Horde generate forwards the prompt and returns tags once', async () => {
    let sent;
    const c = context({ Horde: { generateText: async o => {
      sent = o; return { text: 'You receive a coin.\n[[cash:+10]]' };
    } } });
    const result = await c.API.generate({
      settings: { ...settings, provider: 'horde', hordeTextModel: '' },
      character: character('HORDE_WORLD_SENTINEL'), session: {},
      history: [{ role: 'user', text: 'Begin' }]
    });
    assert(sent.prompt.includes('HORDE_WORLD_SENTINEL'));
    assert.equal(occurrences(result, '[[cash:+10]]'), 1);
  });
  await test('Backup round-trip preserves worlds/runs, excludes configured API keys, accepts old backups', async () => {
    const seed = context(); const w = seed.HW.parse(rawWorld); const run = seed.HW.start(w, 'origin_test');
    let db = { characters: [{ id: 'c' }], sessions: [{ id: 's' }], messages: [{ id: 'm' }],
      personas: [{ id: 'p' }], worlds: [w], worldRuns: [run] };
    const c = context({ IDB: {
      getAll: async key => db[key] || [],
      putMany: async (key, values) => { db[key] = JSON.parse(JSON.stringify(values)); }
    } });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'), c, { filename: 'store.js' });
    c.Store.settings = { ...settings, apiKey: 'SECRET_API', hordeKey: 'SECRET_HORDE' };
    const text = await c.Store.exportAll(); const exported = JSON.parse(text);
    assert(!text.includes('SECRET_API')); assert(!text.includes('SECRET_HORDE'));
    assert.equal(exported.worlds.length, 1); assert.equal(exported.worldRuns.length, 1);
    db = {}; await c.Store.importAll(text);
    assert.equal(db.worldRuns[0].worldId, w.id);
    assert(db.worldRuns[0].inventory.includes('STATE_SENTINEL'));
    assert.equal(db.characters[0].id, 'c'); assert.equal(db.personas[0].id, 'p');
    await c.Store.importAll(JSON.stringify({ characters: [], sessions: [], messages: [], personas: [] }));
    assert.equal(db.worlds.length, 1, 'Legacy backup must not delete worlds');
    assert.equal(db.worldRuns.length, 1, 'Legacy backup must not delete runs');
  });
  /* ---- extra coverage added during this repair ----
     The response parser must follow the mode actually requested, not the global
     setting. summarize() (auto-memory) and quickText() (AI persona draft) force
     stream:false. With streaming enabled — the shipped default — their JSON
     answer was being fed to the SSE parser and came back '', so auto memory
     silently never recorded anything and the persona draft button did nothing.
     These fail on the unpatched baseline for streaming:true. */
  for (const streaming of [true, false]) {
    const label = streaming ? 'streaming on' : 'streaming off';

    await test('summarize() parses its forced non-stream JSON (' + label + ')', async () => {
      const sent = [];
      const c = context({ fetch: async (_url, options) => {
        sent.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ choices: [{ message: { content:
          '{"summary":"Met a smith.","facts":["MEMORY_SENTINEL"]}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      } });
      const result = await c.API.summarize({
        settings: { ...settings, streaming },
        character: { name: 'Smith' }, session: {},
        history: [{ role: 'user', text: 'hello' }]
      });
      assert.equal(sent[0].stream, false, 'summarize must ask for a JSON response');
      assert.ok(result.facts.includes('MEMORY_SENTINEL'),
        'memory facts lost with ' + label + ' — got ' + JSON.stringify(result));
    });

    await test('quickText() parses its forced non-stream JSON (' + label + ')', async () => {
      const c = context({ fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { content: 'QUICKTEXT_SENTINEL' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }) });
      const text = await c.API.quickText({ ...settings, streaming }, 'say something');
      assert.equal(text, 'QUICKTEXT_SENTINEL', 'quickText empty with ' + label);
    });
  }

  await test('explicit stream:false override wins over streaming:true, and is parsed as JSON', async () => {
    const sent = [];
    const c = context({ fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OVERRIDE_SENTINEL' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    /* streaming is ON here; the override must still force non-stream mode */
    const text = await c.API.streamChat({ ...settings, streaming: true },
      [{ role: 'user', content: 'hi' }], null, null, { stream: false });
    assert.equal(sent[0].stream, false);
    assert.equal(text, 'OVERRIDE_SENTINEL');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

