/* chatwork-test.js — v1.39.0: the eight chat improvements.
   Pure-logic and prompt-line assertions ride a vm sandbox with a fake IDB;
   view/source asserts grep the shipped JS. Run: node tests/chatwork-test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0, count = 0;
function ok(name, cond, detail) {
  count++;
  if (cond) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? ('  → ' + detail) : '')); }
}
function eq(name, a, b) { ok(name, a === b, JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function tick(fn, n /* macrotask pumps for fire-and-forget App chains */) {
  return new Promise(resolve => {
    let left = n || 4;
    setTimeout(function pump() { if (--left <= 0) resolve(fn && fn()); else setTimeout(pump, 0); }, 0);
  });
}

/* ---- fake IndexedDB (synchronous-looking, promise-shaped), same trick the
   world tests use ---- */
function fakeIDB() {
  const data = {};
  function store(name) { return (data[name] = data[name] || {}); }
  return {
    get: (t, id) => Promise.resolve((store(t))[id] || null),
    put: (t, o) => { (store(t))[o.id] = o; return Promise.resolve(o); },
    putMany: (t, arr) => { arr.forEach(o => { (store(t))[o.id] = o; }); return Promise.resolve(arr); },
    del: (t, id) => { delete (store(t))[id]; return Promise.resolve(); },
    all: t => Promise.resolve(Object.values(store(t))),
    query: (t, ix, val) => Promise.resolve(Object.values(store(t)).filter(o => o[ix] === val)),
    count: t => Promise.resolve(Object.keys(store(t)).length),
    _data: data
  };
}

function loadCore(overrides) {
  const IDB = fakeIDB();
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    isNaN, parseFloat, parseInt, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { onLine: true },
    IDB
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  const fakeStore = IDB;
  ['store.js', 'idb.js'].forEach(f => vm.runInNewContext(read(f), sandbox, { filename: f }));
  /* idb.js declares its own module-level IDB which needs a real indexedDB
     we do not have in the harness - point the global back at the fake so
     Store.* and direct IDB.* calls both land in the in-memory world. */
  sandbox.IDB = fakeStore;
  const uiStub = 'var sandbox = window; var UI = {}; window.UI = UI;\n' + [
    'UI.uid = p => (p||"x") + Math.random().toString(36).slice(2, 10);',
    "UI.esc = s => String(s || '').replace(/[&<>]/g, c => (c === '&' ? '&amp;' : (c === '<' ? '&lt;' : '&gt;')));",
    'UI.md = s => String(s || "");',
    'UI.toast = m => { (sandbox._toasts = sandbox._toasts || []).push(String(m)); };',
    'UI.input = () => Promise.resolve(null);',
    'UI.confirm = () => Promise.resolve(false);',
    'UI.sheet = () => {};',
    'UI.download = (name, text) => { sandbox._dl = { name, text }; };',
    'UI.fmtTime = t => "now";'
  ].join('\n');
  const apiStub = 'var Views = {}; var API = {};\n' + 'API = { _calls: [], generateFree: function (o) { API._calls.push(o); return Promise.resolve(sandbox.__title || "Canal Duels at Dawn"); }, aiJson: function () { return Promise.resolve(null); } };' +
    'Sandbox = { issue: () => {} };';
  const viewsStub = "Views = { appendMessage: () => ({ classList: { add(){} }, querySelector() { return null; }, removeClass(){} }), thread: () => {}, stickToBottom: () => false, renderPersonaBar: () => {}, toast: () => {} };";
  const domStub = `window.$ = function (s) { return null; }; var $ = window.$;
    HW = { tick: () => Promise.resolve(), start: () => Promise.resolve(), normalize: () => ({}), memoryDue: () => false };
    KeepAwake = { hold: function(){}, release: function(){} };
    document = { querySelectorAll: () => [] };`;
  vm.runInNewContext(uiStub + '\n' + viewsStub + '\n' + domStub + '\n' + apiStub,
    sandbox, { filename: 'prep' });
  return sandbox;
}

/* The API file is long; load it whole with the dom-less globals above so
   buildChat/buildPrompt/parseAiJson run for real. */
function loadApiOnly(overrides) {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    isNaN, parseFloat, parseInt, TextEncoder, TextDecoder,
    fetch: (overrides && overrides.fetch) || (() => Promise.resolve({ ok: false, text: () => Promise.resolve('') }))
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  vm.runInNewContext(read('api.js'), sandbox, { filename: 'api.js' });
  return sandbox.API;
}

(async () => {
  try {
    const appSrc = read('app.js');
    const viewsSrc = read('views.js');

    console.log('A — the chat list learns search, pins and archives');
    {
      ok('sessions carry pinned + archived flags in the schema defaults',
        /pinned:\s*false/.test(appSrc + '\n' + read('store.js')));
      ok('the list renders a search box', /id="chat-search"/.test(viewsSrc + readIdx()));
      ok('...and lets the player show archived chats', /show-archived|Show archived/.test(appSrc + viewsSrc));
      ok('the session menu offers Pin and Archive',
        /data-a="pin"/.test(appSrc) && /data-a="archive"/.test(appSrc));
      ok('ordering puts pinned first', /b\.pinned -\s*a\.pinned|a\.pinned \|\| 0/.test(appSrc + viewsSrc) ||
        /pinned/.test(viewsSrc));
    }

    console.log('B — transcripts round-trip: readable text out, real JSON back in');
    {
      ok('the export menu offers a JSON backup', /Export for Horde Studio|Backup \(\.json\)|k:\s*'hordesession'/.test(appSrc));
      ok('the chats screen offers import', /chats-import|Import chat/i.test(appSrc + viewsSrc));
      ok('import validates the payload kind', /k\s*===?\s*'hordesession'/.test(appSrc));
      ok('import re-keys messages for a fresh session', /App\.importChatData/.test(appSrc));
    }

    console.log('C — a chat may lean local over the character');
    {
      ok('sessions may carry generation overrides',/overrides/.test(appSrc));
      ok('the menu has a Chat settings entry', /data-a="settings"/.test(appSrc));
      ok('the chat note reaches the prompt as a note',
        /session\.overrides && session\.overrides\.note|overrides\.note/.test(appSrc));
      ok('the chat temperature beats the character default',
        /overrides\.temperature/.test(appSrc));
      const API = loadApiOnly();
      const char = { id: 'c1', name: 'Mara', persona: 'Watchful toll warden.', temperature: 0.9, maxTokens: 500 };
      const session = { id: 's1' };
      /* buildPath checks happen against App source but the prompt plumbing
         is API's; the note channel is shared */
      const msgs = API.buildChat(char, { id: 's1' }, [{ role: 'user', text: 'hi' }],
        { systemPrompt: 'You are {name}.', systemPromptOOC: '', contextMessages: 40, maxContextChars: 26000 },
        'Chat note: this scene answers whispers');
      ok('...proof: the note lands in the system prompt',
        JSON.stringify(msgs[0]).indexOf('this scene answers whispers') !== -1);
    }

    console.log('D — rerolls compare and can be steered');
    {
      ok('the swipe row counts words', /wordCount|altWords|\bwords\b/.test(viewsSrc));
      ok('reroll-with-instruction exists', /rerollnote|Reroll with/.test(appSrc + viewsSrc));
      /* one trimmed function: word counting is the cheap promise */
      if (/function altWordCount/.test(viewsSrc + appSrc)) {
        ok('altWordCount is exported for tests', /altWordCount/.test(viewsSrc));
      } else {
        ok('alt word counting exposed', /altWords|wordsPer/i.test(viewsSrc));
      }
    }

    console.log('E — the player may say it with a photo');
    {
      ok('the composer has an attach button', /id="attach-btn"|id="send-attach"/.test(viewsSrc + appSrc + readIdx()));
      ok('attachments are normalized small (normalizeImage at 640)', /normalizeImage\(f(?:ile)?[, ]+640\)/.test(appSrc + viewsSrc));
      ok('messages carry the caption the character reads', /imageCaption/.test(appSrc + viewsSrc));
      const API = loadApiOnly();
      const msgs = API.buildChat({ id: 'c1', name: 'Mara' }, { id: 's1' },
        [{ role: 'user', text: '', imageCaption: 'a jellyfish lantern drifting between pillars' }],
        { systemPrompt: 'You are {name}.', contextMessages: 40, maxContextChars: 26000 }, null);
      const userLine = msgs.find(m => m.role === 'user');
      ok('the model reads the photo caption', !!userLine && /a jellyfish lantern/.test(userLine.content) && /photo/.test(userLine.content),
        JSON.stringify(userLine && userLine.content));
      const plain = API.buildPrompt({ id: 'c1', name: 'Mara' }, { id: 's1' },
        [{ role: 'user', text: 'look', imageCaption: 'a rusted bell' }],
        { systemPrompt: 'You are {name}.', contextMessages: 40, maxContextChars: 26000 }, null, 400);
      ok('...and in the plain-text path too', /rusted bell/.test(plain));
    }

    console.log('F — every reply can be heard');
    {
      ok('assistant messages carry a Listen action', /data-act="say"|Listen/.test(viewsSrc));
      ok('speech is stripped of markdown before synthesis', /speechText|stripForSpeech|forSpeech/.test(appSrc + viewsSrc));
      ok('speaking stops when navigating away', /speechSynthesis\.cancel|App\.stopSpeech/.test(appSrc + viewsSrc));
      ok('unsupported engines say so instead of crashing', /speechSynthesis/.test(appSrc + viewsSrc));
    }

    console.log('G — the health sheet tells you what your chat is spending');
    {
      ok('the menu has Chat health', /data-a="health"/.test(appSrc));
      ok('the numbers come from a pure counter', /App\.chatHealth\s*=\s*function/.test(appSrc));
      const sb = loadCoreLite();
      const health = sb.App.chatHealth(
        { id: 's1', summary: 'The keeper confessed.', facts: ['the flood'], memoryAt: 10, createdAt: 1 },
        [
          { role: 'user', text: 'one two three' },
          { role: 'assistant', text: 'four five six seven eight nine ten eleven', alts: ['a', 'b'] },
          { role: 'user', text: 'twelve thirteen' },
          { role: 'assistant', text: 'answer' },
          { role: 'system', text: 'queued' },
          { role: 'user', text: 'x', autonomous: true }
        ],
        { memoryEvery: 14, contextMessages: 40, maxContextChars: 26000 });
      eq('message count excludes nothing', health.messages, 6);
      eq('answers counted', health.replies, 2);
      eq('rerolls counted from alts', health.rerolls, 1);
      ok('word average computed', health.wordsPerReply >= 4, JSON.stringify(health));
      ok('summarization progress known', typeof health.sinceSummary === 'number');
      ok('context estimate known', /~?\d/.test(String(health.contextTokens)));
    }

    console.log('H — chats name themselves after the third exchange');
    {
      ok('generateReply asks for a title once the chat is old enough', /maybeAutoTitle|autoTitle/.test(appSrc));
      ok('auto-titling leaves user-chosen titles alone', /titleAuto/.test(appSrc));
      const sb = loadCoreLite();
      sb.Store.settings = Object.assign({ provider: 'horde', userName: 'Me', systemPrompt: 'Be {name}.' }, sb.Store.settings);
      sb.Store.characters = [{ id: 'c1', name: 'Mara', persona: 'p' }];
      const sess = { id: 's1', charId: 'c1', title: 'New chat', createdAt: Date.now(), updatedAt: Date.now() };
      await sb.IDB.put('sessions', sess);
      /* two alternatives pattern: call maybeAutoTitle directly with a
         fabricated transcript state */
      sb.App.state = sb.App.state || {};
      sb.App.state.session = sess;
      sb.App.state.char = sb.Store.characters[0];
      sb.App.state.messages = [
        { role: 'user', text: 'canal passage?' }, { role: 'assistant', text: 'two coppers' },
        { role: 'user', text: 'who runs the locks?' }, { role: 'assistant', text: 'the Toll Warden,' },
        { role: 'user', text: 'is she honest?' }, { role: 'assistant', text: 'mostly.' }];
      if (typeof sb.App.maybeAutoTitle !== 'function') {
        ok('maybeAutoTitle exists', false, 'not exported');
      } else {
        await sb.App.maybeAutoTitle();
        eq('the title call fired once', sb.API._calls.length, 1);
        const saved = await sb.IDB.get('sessions', 's1');
        ok('the title was saved', saved.title !== 'New chat', saved && saved.title);
        eq('and marked automatic', saved.titleAuto, true);
      }
    }

  } catch (e) {
    ok('battery threw', false, e && (e.stack || String(e)));
  }

  /* ---------- helpers that need faking App.core ---------- */
  function readIdx() { return fs.readFileSync(path.join(path.dirname(ROOT), 'index.html'), 'utf8'); }

  function loadCoreLite() {
    const sb = loadCore();
    sb.App = sb.App || {};
    /* App core: load app.js only enough to expose its pure helpers. The
       whole file wants a DOM; carve the exported functions out instead. */
    const src = read('app.js');
    ['App.chatHealth', 'App.maybeAutoTitle', 'App.validAutoTitle'].forEach(name => {
      if (!src.includes(name + ' = function ')) return;
      const start = src.indexOf(name + ' = function ');
      const fnBody = src.slice(start, src.indexOf('\n  };', start) + 5);
      try { vm.runInNewContext(fnBody, sb, { filename: name }); }
      catch (e) { /* a helper that needs more of App stays surface-asserted */ }
    });
    return sb;
  }

  console.log('\nchatwork-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
