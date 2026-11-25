#!/usr/bin/env node
/* v1.47.0 — a card's regex keys and its entry chaining, both off until allowed.
 *
 * Two lorebook fields decided what the model was sent in every other client and
 * nothing here, and the app said so by ignoring them. That was a decision worth
 * making once and not worth keeping: a card that writes `\bVlad(?:'s)?\b` as a key
 * is not asking for the characters, and a book that sets `recursive_scanning` is
 * asking for something the app already does in one direction and could do in two.
 *
 * So both are honoured, and both are gated the way `honorCardSystemPrompt` is — a
 * card cannot approve itself — because each one changes the prompt rather than the
 * screen. The assertions here are on the prompt, not on a description of it:
 *
 *   A  the keys, and what off means
 *   B  pattern matching, compiled once, and the two ways a pattern is refused
 *   C  chaining: who wakes whom, how far, and what a chained entry can never do
 *   D  the Lore screen's readout, rendered from the engine's own record
 *   E  import and export: nothing invented, nothing dropped
 *   F  the switches, clicked
 *   G  the cost, bounded
 *
 * Generic: no card on disk, no network, no model.
 *   node /home/user/tests/lore-card-features-test.js
 */
'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadApi() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    document: { addEventListener: function () {} }, navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error('offline')); },
    Store: { settings: {} }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();

function sample(text) {
  var parts = String(text).split('\n');
  return { text: text, newest: parts[parts.length - 1], parts: parts };
}
function ranked(entries, text, opts) { return API.loreRanks(entries, sample(text), '', opts); }
function ids(rows) { return rows.map(function (r) { return r.entry.id + (r.patterns ? '#' : '') + (r.chain ? '*' : ''); }); }

/* A book that covers every case at once. `keeper` is only ever mentioned inside an
   entry, never in the chat, so it can only come in by chaining. */
function book() {
  return [
    { id: 'plain', keys: ['lamp'], content: 'The lamp is the town’s only job.' },
    { id: 'pat', keys: ["\\bVlad(?:'s)?\\b"], content: 'Vlad keeps the lamp.', useRegex: true },
    { id: 'wrap', keys: ['/harbour|the port/i'], content: 'The port is silted up.', useRegex: true },
    { id: 'broken', keys: ['[unclosed'], content: 'Never in.', useRegex: true },
    { id: 'evil', keys: ['(a+)+b'], content: 'Never in either.', useRegex: true },
    { id: 'cs', keys: ['Door'], content: 'The door is painted red.', useRegex: true, caseSensitive: true },
    { id: 'keeper', keys: ['keeper'], content: 'The harbourmaster owes the town nine crowns.' },
    { id: 'link', keys: ['lamp'], content: 'Under the lamp, the keeper waits.' },
    { id: 'always', keys: ['[nope'], content: 'Always present.', constant: true, useRegex: true },
    { id: 'twosec', keys: ['fog'], content: 'In fog nobody hears you.', useRegex: true,
      selective: true, secondaryKeys: ['bell'] }
  ];
}
var OFF = { regex: false, chain: false };
var ON = { regex: true, chain: false };
var CHAIN = { regex: true, chain: true, chainDepth: 2 };
var CHAT = 'the lamp is out again and Vlad’s boat is late';

console.log('\nA — the switches, and what “off” means');
(function () {
  var r = ranked(book(), CHAT, OFF);
  eq('off: the constant entry and the two literal ones are what the turn brings in',
    ids(r).join(','), 'always,plain,link');
  ok('…and nothing is refused, because nothing was run as a pattern',
    r.bad.length === 0, JSON.stringify(r.bad));
  var on = ranked(book(), CHAT, ON);
  eq('on: the same book, the same turn, and the pattern entry is in',
    ids(on).join(','), 'always#,pat#,plain,link');
  eq('…and the rows say so — a pattern entry that is also constant is still a pattern entry',
    on.filter(function (x) { return x.patterns; }).map(function (x) { return x.entry.id; }).join(','), 'always,pat');
  ok('…while off, the same entry matched on its literal text instead',
    r.filter(function (x) { return x.entry.id === 'always'; })[0].patterns === false);
  var storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
  ok('both ship off', /honorCardRegex: false/.test(storeSrc) && /honorCardRecursion: false/.test(storeSrc));
  ok('…and neither is swept by a generation reset: they belong with the prompt switches',
    !/honorCardRegex|honorCardRecursion/.test(storeSrc.slice(storeSrc.indexOf('var GEN_KEYS'), storeSrc.indexOf('var Store ='))));
  /* the shape of `opts`: nothing in the app can turn either on by itself */
  eq('a character with no settings to hand gets today’s behaviour', API.loreOpts({ id: 'x' }), 
    { compat: false, turns: API.LORE_SCAN_DEFAULT, tokenBudget: 0, regex: false, chain: false, chainDepth: 0 });
  var char = { id: 'x', cardSource: { book: { recursive_scanning: true } } };
  eq('…a book that asks gets nothing until the player agrees',
    API.loreOpts(char, {}).chain, false);
  eq('…and the ask plus the switch is the whole condition',
    API.loreOpts(char, { honorCardRecursion: true }).chain, true);
  eq('…and a string "true" is not a book asking',
    API.loreOpts({ id: 'y', cardSource: { book: { recursive_scanning: 'true' } } }, { honorCardRecursion: true }).chain, false);
  var strung = ranked([{ id: 's', keys: ['lamp'], content: 'x', useRegex: 'true' }], CHAT, ON);
  eq('…while use_regex has to be the entry’s own boolean: a string is not true',
    ids(strung).join(',') + '/' + strung[0].patterns, 's/false');
})();

console.log('\nB — a pattern, compiled once, and the two ways it is refused');
(function () {
  var e = API.lorePattern.bind(API);
  eq('an ordinary pattern compiles and ignores case by default', API.lorePattern('\\bVlad(?:\'s)?\\b', false).re.test('VLAD’s'), true);
  eq('…and does not run past a word edge', API.lorePattern('\\bVlad\\b', false).re.test('Vladislav'), false);
  eq('/pattern/flags is unwrapped, and the author’s flags win',
    API.lorePattern('/Cat|Dog/i', true).re.test('a Cat'), true);
  eq('…while a pattern that merely starts with a slash keeps its slash',
    API.lorePattern('/home', false).re.test('/home'), true);
  eq('…and an unclosed delimiter is left alone rather than guessed at',
    API.lorePattern('/home', false).re.test('home'), false);
  eq('a pattern that does not compile is reported, not thrown',
    API.lorePattern('[unclosed', false).why, 'does not compile');
  eq('…and the exponential shape is refused before it is ever run',
    API.lorePattern('(a+)+b', false).why, 'nested repeat');
  eq('…which is the same test the display scripts use, by name',
    typeof API.lorePattern('(a+)+b', false).re, 'object');
  eq('an empty key is no key, not a broken one', API.lorePattern('   ', false).why, 'empty');
  var r = ranked(book(), CHAT, ON);
  eq('a broken pattern takes its entry out — the spec’s rule, not this app’s',
    r.map(function (x) { return x.entry.id; }).indexOf('broken'), -1);
  eq('…and each refusal is named once, however many entries it covers',
    r.bad.map(function (b) { return b.index + ':' + b.why; }).join(','), '3:does not compile,4:nested repeat');
  eq('…and never silently: the two refused entries are the only ones missing',
    r.bad.length, 2);
  var twice = ranked(book(), CHAT, ON);
  eq('the second scan says the same thing as the first (compiled once, cached)',
    twice.bad.length, 2);
  var withEmpty = ranked([{ id: 'k', keys: ['', 'boat'], content: 'x', useRegex: true }], CHAT, ON);
  eq('…so an entry with one blank key and one good one still matches on the good one',
    ids(withEmpty).join(','), 'k#');
  var lit = ranked([{ id: 'k', keys: ['', 'boat'], content: 'x', useRegex: true }], CHAT, OFF);
  eq('…and the blank key is not treated as a match either', ids(lit).join(','), 'k');
})();

console.log('\nC — chaining: who wakes whom, how far, and what it can never do');
(function () {
  var off = ranked(book(), CHAT, OFF);
  ok('off, nothing chains: an entry only the lamp entry mentions stays out',
    ids(off).indexOf('keeper') === -1, ids(off).join(','));
  var on = ranked(book(), CHAT, CHAIN);
  ok('on, one entry is enough to wake the next', ids(on).indexOf('keeper*') !== -1, ids(on).join(','));
  eq('…and the rows say which came in by chaining',
    on.filter(function (x) { return x.chain; }).map(function (x) { return x.entry.id; }).join(','), 'keeper,wrap');
  eq('…on a book where the pattern entry is also reachable that way',
    ids(on).join(','), 'always#,pat#,plain,link,keeper*,wrap#*');
  var order = ids(on);
  ok('…and it ranks behind every entry the chat itself matched',
    order.indexOf('keeper*') > order.indexOf('plain') && order.indexOf('keeper*') > order.indexOf('pat#'),
    order.join(','));
  /* budget: a chained entry may fill what the conversation left over, and no more */
  var tight = API._loreHits(book(), sample(CHAT), 3, 120, '', CHAIN);
  eq('a limit of three keeps the constant entry and the two the chat matched',
    tight.map(function (e) { return e.id; }).join(','), 'always,pat,plain');
  ok('…so a chained entry cannot displace one the chat mentioned',
    tight.map(function (e) { return e.id; }).indexOf('keeper') === -1, tight.map(function (e) { return e.id; }).join(','));
  var room = API._loreHits(book(), sample(CHAT), 6, 5000, '', CHAIN);
  eq('…and with room going spare, the chained entries take it',
    room.map(function (e) { return e.id; }).join(','), 'always,pat,plain,link,keeper,wrap');
  /* depth: the book's number is a request, and the ceiling is the app's */
  var deep = { regex: false, chain: true, chainDepth: 3 };
  var chain3 = [
    { id: 'a1', keys: ['start'], content: 'a1 mentions b1' },
    { id: 'b1', keys: ['b1'], content: 'b1 mentions c1' },
    { id: 'c1', keys: ['c1'], content: 'c1 mentions d1' },
    { id: 'd1', keys: ['d1'], content: 'd1 mentions e1' },
    { id: 'e1', keys: ['e1'], content: 'e1, four hops away' }
  ];
  var hops = ids(ranked(chain3, 'start of it', deep));
  eq('three hops is the ceiling whatever the book asked for', hops.join(','), 'a1,b1*,c1*,d1*');
  eq('…and one hop is one hop', ids(ranked(chain3, 'start of it', { regex: false, chain: true, chainDepth: 1 })).join(','), 'a1,b1*');
  eq('…and a cycle does not repeat an entry',
    ids(ranked([{ id: 'x', keys: ['start'], content: 'x says y' }, { id: 'y', keys: ['y'], content: 'y says x' }],
      'start of it', { regex: false, chain: true, chainDepth: 3 })).join(','), 'x,y*');
  eq('a book of two entries that never mention each other gains nothing',
    ids(ranked([{ id: 'p', keys: ['lamp'], content: 'the lamp' }, { id: 'q', keys: ['zzz'], content: 'zzz' }],
      CHAT, CHAIN)).join(','), 'p');
  var det1 = ids(ranked(book(), CHAT, CHAIN)).join(','), det2 = ids(ranked(book(), CHAT, CHAIN)).join(','), det3 = ids(ranked(book(), CHAT, CHAIN)).join(',');
  ok('the same chat ranks the same three times over', det1 === det2 && det2 === det3, det1 + ' | ' + det3);
  /* the real prompt, not just the ranking */
  var hist = [];
  for (var i = 0; i < 8; i++) {
    hist.push({ id: 'u' + i, role: 'user', text: i === 7 ? CHAT : 'quiet evening ' + i + ' on the water' });
    hist.push({ id: 'a' + i, role: 'assistant', text: 'Nadia: she looks at the weather' });
  }
  var char = { id: 'c1', name: 'Nadia', lorebook: book(), cardSource: { book: { recursive_scanning: true, recursion_depth: 9 } } };
  function built(extra) {
    var st = Object.assign({ userName: 'Quinn', systemPrompt: 'x', maxTokens: 300, contextMessages: 40 }, extra);
    return API.buildChat(char, { id: 's' }, hist, st).map(function (m) { return String(m.content); }).join('\n');
  }
  var withBoth = built({ honorCardRegex: true, honorCardRecursion: true });
  var withNeither = built({});
  ok('the prompt gains the chained fact when both switches are on',
    withBoth.indexOf('harbourmaster owes the town') !== -1, 'absent');
  ok('…and the pattern fact too', withBoth.indexOf('Vlad keeps the lamp') !== -1, 'absent');
  ok('…while with the switches off neither line is in it at all',
    withNeither.indexOf('harbourmaster owes the town') === -1 && withNeither.indexOf('Vlad keeps the lamp') === -1,
    'leaked');
  eq('…and the plain path is byte-for-byte what it was', withNeither, built({ honorCardRegex: false, honorCardRecursion: false }));
  /* “No settings in scope” has to mean the same thing as “the switches are off”:
     every caller that hands over nothing (the chat’s own lorebook, an old saved
     character, a caller added next month) is then on the pre-feature path by
     construction rather than by luck. */
  var noOpts = API._loreHits(book(), sample(CHAT), 10, 5000, '');
  var offOpts = API._loreHits(book(), sample(CHAT), 10, 5000, '', { regex: false, chain: false, chainDepth: 0 });
  eq('a book ranked with no options at all matches one ranked with both switched off',
    noOpts.map(function (e) { return e.id; }).join(','), offOpts.map(function (e) { return e.id; }).join(','));
  eq('…and the chat’s own lorebook cannot grant itself regex keys',
    API.loreRanks([{ id: 'cb', keys: ['lamp'], content: 'x', useRegex: true }], sample(CHAT), '', undefined)
      .map(function (r) { return r.entry.id + (r.patterns ? '#' : ''); }).join(','), 'cb');
})();

console.log('\nD — what the Lore screen reads out');
(function () {
  function diag(opts) { return API.loreDiagnostics(book(), sample(CHAT), 10, 5000, '', opts); }
  var off = diag(OFF), on = diag(ON), chained = diag(CHAIN);
  eq('a pattern entry asked for is counted whether or not it was used', off.patternAsked, 7);
  eq('…with the switch off, none matched on a pattern', off.patterns, 0);
  eq('…with it on, the good ones did', on.patterns, 2);
  eq('…and the two unusable ones are named as such', on.brokenPatterns, 2);
  eq('and chaining reports how much of the prompt it brought in', [chained.chained, off.chained], [2, 0]);
  var brokenRow = off.rows.filter(function (r) { return r.keys[0] === '[unclosed'; })[0];
  ok('a switched-off entry says the switch is off, not that it found nothing',
    brokenRow && /the switch is off/.test(brokenRow.reason) && /plain text/.test(brokenRow.reason) &&
    !brokenRow.matched, brokenRow && brokenRow.reason);
  var onRow = on.rows.filter(function (r) { return r.keys[0] === '[unclosed'; })[0];
  ok('…and once the switch is on it says what was refused and why',
    onRow && /refused/.test(onRow.reason) && /not a regular expression/.test(onRow.reason), onRow && onRow.reason);
  var evil = on.rows.filter(function (r) { return r.keys[0] === '(a+)+b'; })[0];
  ok('the exponential refusal says it is a matter of time, not of syntax',
    evil && /exponential/.test(evil.reason), evil && evil.reason);
  var sec = on.rows.filter(function (r) { return r.keys[0] === 'fog'; })[0];
  ok('a pattern entry ignores its secondary keys, and says so on the row',
    sec && sec.ignored === 'secondary_keys', sec && sec.ignored);
  var keeper = chained.rows.filter(function (r) { return r.keys[0] === 'keeper'; })[0];
  ok('a chained entry is marked on its row', keeper && keeper.chained === true, JSON.stringify(keeper));
  var always = on.rows.filter(function (r) { return r.keys[0] === '[nope'; })[0];
  ok('a constant entry with a broken pattern still comes in, and still says it',
    always && always.matched && /does not compile/.test(always.broken), JSON.stringify(always));
  var view = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
  ok('the screen quotes these instead of inventing its own tally',
    /diag\.patternAsked/.test(view) && /diag\.chained/.test(view) && /diag\.regexOn/.test(view) && /r\.chained \? 'chained from another entry'/.test(view));
})();

console.log('\nE — import and export: nothing invented, nothing dropped');
(function () {
  var storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
  ok('the importer mirrors use_regex as the card wrote it', /useRegex: e\.use_regex/.test(storeSrc));
  var bookCard = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: 'Keeper', description: 'd', personality: 'p', first_mes: 'hi', mes_example: '',
      character_book: {
        name: 'b', description: '', recursive_scanning: true, recursion_depth: 9,
        entries: [
          { keys: ['lamp'], content: 'plain', enabled: true, use_regex: false },
          { keys: ['\\bVlad\\b'], content: 'pattern', enabled: true, use_regex: true }
        ]
      }
    }
  };
  var sb = makeStore();
  var c = sb.Store.cardToCharacter(bookCard);
  eq('the live entry carries the flag the matcher reads',
    c.lorebook.map(function (e) { return e.useRegex; }), [false, true]);
  eq('…and the book’s own ask is kept where it was written',
    [c.cardSource.book.recursive_scanning, c.cardSource.book.recursion_depth], [true, 9]);
  var out = sb.Store.characterToCard(c);
  var ob = out.data.character_book;
  eq('an untouched card exports the same book-level bytes',
    [ob.recursive_scanning, ob.recursion_depth], [true, 9]);
  eq('…and the same per-entry ones', ob.entries.map(function (e) { return e.use_regex; }), [false, true]);
  var edited = sb.Store.characterToCard((function () {
    var c2 = JSON.parse(JSON.stringify(c));
    c2.lorebook[0].useRegex = true;
    return c2;
  })());
  eq('switching it on in the editor writes it out',
    edited.data.character_book.entries.map(function (e) { return e.use_regex; }), [true, true]);
  var handmade = sb.Store.characterToCard({ id: 'm', name: 'Mine', lorebook: [{ id: 'l1', keys: ['a'], content: 'b', enabled: true }] });
  ok('…and an entry written in this app gets no field invented for it',
    handmade.data.character_book.entries[0].use_regex === undefined,
    JSON.stringify(handmade.data.character_book.entries[0]));
})();

function makeStore() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout,
    document: { addEventListener: function () {} }, navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error('offline')); },
    API: loadApi(),
    UI: {
      uid: function (p) { sb.__n = (sb.__n || 0) + 1; return p + '-' + sb.__n; },
      esc: function (v) { return String(v == null ? '' : v); },
      toast: function () {}
    }
  };
  sb.window = sb; sb.global = sb;
  sb.Store = null;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8'), sb, { filename: 'store.js' });
  sb.Store.settings = Object.assign({}, sb.Store.DEFAULTS || {});
  return sb;
}


/* The harness both F and H render in: views.js loaded against a document made of
   objects, so the assertions are about HTML the shipped screen produced, not about
   its source text. One copy on purpose — a stub DOM that drifts from the real one is
   worse than no test at all, because it can make a working screen look broken and a
   broken one look fine. */
function viewEnv(settings) {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: null, navigator: { userAgent: 'node' }, location: { href: 'http://x/', hash: '' },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    requestAnimationFrame: function () { return 0; }, addEventListener: function () {},
    Image: function () {}, btoa: function () { return ''; },
    UI: {
      esc: function (v) { return String(v == null ? '' : v); },
      md: function (v) { return String(v || ''); },
      icon: function (n) { return '<i data-icon="' + n + '"></i>'; },
      toast: function () {}
    },
    API: loadApi()
  };
  var saved = [];
  sb.Store = {
    settings: settings,
    saveSettings: function (patch) { Object.assign(settings, patch); saved.push(patch); },
    personas: [], characters: [], sessions: [], messages: [], defaultSystem: 'x',
    getSessions: function () { return Promise.resolve(sb.Store.sessions || []); },
    getMessages: function () { return Promise.resolve(sb.Store.messages || []); }
  };
  sb.App = { state: {}, editLore: function () {} };
  var pool = {};
  function el(key) {
    if (pool[key]) return pool[key];
    var node = {
      key: key, innerHTML: '', textContent: '', value: '', onclick: null, handlers: {},
      classList: {
        names: {},
        add: function (c) { this.names[c] = 1; },
        remove: function (c) { delete this.names[c]; },
        contains: function (c) { return !!this.names[c]; },
        toggle: function (c, on) {
          /* the DOM's own rule: one argument toggles, two force it. views.js uses the
             one-argument form here, so a stub that only honoured the two-argument one
             would make every switch on the screen look broken. */
          if (arguments.length < 2) { if (this.names[c]) delete this.names[c]; else this.names[c] = 1; return; }
          if (on) this.names[c] = 1; else delete this.names[c];
        }
      },
      addEventListener: function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
      querySelector: function (sel) { return el(String(sel).replace(/^[#.]/, '')); },
      querySelectorAll: function () { return []; },
      fire: function (ev) { (this.handlers[ev] || []).forEach(function (f) { f({ target: node }); }); if (node.onclick) node.onclick.call(node); }
    };
    pool[key] = node;
    return node;
  }
  sb.document = {
    addEventListener: function () {}, removeEventListener: function () {},
    createElement: function () { return el('created'); },
    querySelector: function (sel) { return el(String(sel).replace(/^[#.]/, '')); },
    querySelectorAll: function () { return []; },
    body: el('body'), documentElement: el('html')
  };
  sb.window = sb; sb.global = sb;
  /* views.js once, not per render: a screen is a module-level function and the
     second render has to see the first one's writes, exactly as in the app. */
  var src = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
  try {
    vm.runInNewContext(src, sb, { filename: 'views.js' });
  } catch (e) {
    ok('views.js loads against the stub document', false, String((e && e.message) || e));
  }
  return {
    sb: sb, el: el, saved: saved, settings: settings, Views: sb.Views,
    /* a fresh render starts from empty nodes, so an assertion cannot pass on HTML
       the previous render left behind */
    reset: function () { Object.keys(pool).forEach(function (k) { delete pool[k]; }); }
  };
}

console.log('\nF — the switches, clicked');
(function () {
  var env = viewEnv({ userName: 'Quinn' });
  var src = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
  ok('Settings → System prompt owns both, beside the one they resemble',
    /id="set-card-regex"/.test(src) && /id="set-card-chain"/.test(src) && /id="set-card-prompt"/.test(src));
  ok('…and the order on the screen is prompt, regex, chaining',
    src.indexOf('id="set-card-prompt"') < src.indexOf('id="set-card-regex"') &&
    src.indexOf('id="set-card-regex"') < src.indexOf('id="set-card-chain"'), 'moved');
  ok('each says what off means, in the words a player needs',
    /searched for as plain text/.test(src) && /can fill the space your turn left over/.test(src));
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: null, navigator: { userAgent: 'node' }, location: { href: 'http://x/', hash: '' },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    requestAnimationFrame: function () { return 0; }, addEventListener: function () {},
    Image: function () {}, btoa: function () { return ''; },
    UI: {
      esc: function (v) { return String(v == null ? '' : v); },
      md: function (v) { return String(v || ''); },
      icon: function (n) { return '<i data-icon="' + n + '"></i>'; },
      toast: function () {}
    },
    API: loadApi()
  };
  var settings = Object.assign({ userName: 'Quinn' }, sb.API ? {} : {});
  var saved = [];
  sb.Store = {
    settings: settings,
    saveSettings: function (patch) { Object.assign(settings, patch); saved.push(patch); },
    personas: [], characters: [], sessions: [], defaultSystem: 'x'
  };
  var pool = {};
  function el(key) {
    if (pool[key]) return pool[key];
    var node = {
      key: key, innerHTML: '', textContent: '', value: '', onclick: null, handlers: {},
      classList: {
        names: {},
        add: function (c) { this.names[c] = 1; },
        remove: function (c) { delete this.names[c]; },
        contains: function (c) { return !!this.names[c]; },
        toggle: function (c, on) {
          /* the DOM's own rule: one argument toggles, two force it. views.js uses the
             one-argument form here, so a stub that only honoured the two-argument one
             would make every switch on the screen look broken. */
          if (arguments.length < 2) { if (this.names[c]) delete this.names[c]; else this.names[c] = 1; return; }
          if (on) this.names[c] = 1; else delete this.names[c];
        }
      },
      addEventListener: function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
      querySelector: function (sel) { return el(String(sel).replace(/^[#.]/, '')); },
      querySelectorAll: function () { return []; },
      fire: function (ev) { (this.handlers[ev] || []).forEach(function (f) { f({ target: node }); }); if (node.onclick) node.onclick.call(node); }
    };
    pool[key] = node;
    return node;
  }
  sb.document = {
    addEventListener: function () {}, removeEventListener: function () {},
    createElement: function () { return el('created'); },
    querySelector: function (sel) { return el(String(sel).replace(/^[#.]/, '')); },
    querySelectorAll: function () { return []; },
    body: el('body'), documentElement: el('html')
  };
  sb.window = sb; sb.global = sb;
  var Views;
  try {
    vm.runInNewContext(src, sb, { filename: 'views.js' });
    Views = sb.Views;
  } catch (e) {
    ok('views.js loads with the two switches on the System prompt screen', false, String(e && e.message));
    return;
  }
  ok('the screen renders', typeof Views.settingsSystem === 'function');
  pool.systems = null; saved.length = 0;
  try { Views.settingsSystem(sb.document); } catch (e) { ok('…without throwing', false, String(e && e.message)); return; }
  var html = el('settings-x-body').innerHTML;
  ok('…with both toggles, and neither showing as on',
    /Cards may use regex keys/.test(html) && /Cards may chain lore entries/.test(html) &&
    (html.match(/toggle on/g) || []).length === 0, String((html.match(/toggle on/g) || []).length));
  el('set-card-regex').fire('click');
  ok('clicking the regex switch writes its key', saved[0] && saved[0].honorCardRegex === true, JSON.stringify(saved));
  saved.length = 0;
  el('set-card-chain').fire('click');
  ok('…and the chaining switch writes its own', saved[0] && saved[0].honorCardRecursion === true, JSON.stringify(saved));
  ok('…so the engine agrees with the screen',
    API.loreOpts({ id: 'z', cardSource: { book: { recursive_scanning: true } } }, settings).chain === true &&
    API.loreOpts({ id: 'z' }, settings).regex === true, JSON.stringify(settings));
  /* a second render shows what the first one wrote */
  env.reset(); saved.length = 0;
  Views.settingsSystem(sb.document);
  ok('…and reopening Settings shows them on, read from the store',
    (el('settings-x-body').innerHTML.match(/toggle on/g) || []).length === 2,
    String((el('settings-x-body').innerHTML.match(/toggle on/g) || []).length));
})();

console.log('\nG — the cost, bounded');
(function () {
  var many = [];
  for (var i = 0; i < 400; i++) {
    many.push({ id: 'm' + i, keys: ['\\bword' + (i % 7) + '\\b'], content: 'entry ' + i + ' about the harbour and its nets', useRegex: true });
  }
  many[399].content = 'entry 399 mentions keeper, which nobody said';
  many.push({ id: 'target', keys: ['keeper'], content: 'the harbourmaster owes nine crowns', useRegex: false });
  var t0 = Date.now();
  var r = ranked(many, 'the word0 and word3 and word5 appear in this turn of the chat', ON);
  var cold = Date.now() - t0;
  t0 = Date.now();
  var r2 = ranked(many, 'the word0 and word3 and word5 appear in this turn of the chat', ON);
  var warm = Date.now() - t0;
  ok('400 pattern entries, one scan: tens of milliseconds, not seconds', cold < 400, cold + ' ms cold');
  ok('…and the second turn is cheaper, because patterns are compiled once', warm <= cold + 2, warm + ' ms warm');
  eq('…which is the same answer both times', ids(r2).slice(0, 3).join(','), ids(r).slice(0, 3).join(','));
  var t1 = Date.now();
  var c = ranked(many, 'the word0 and word3 and word5 appear in this turn of the chat', { regex: true, chain: true, chainDepth: 3 });
  var chainMs = Date.now() - t1;
  ok('chaining over the same book stays inside a turn’s worth of work', chainMs < 700, chainMs + ' ms');
  /* The pool a hop is drawn from is bounded (LORE_CHAIN_FROM), and a bound nobody can
     observe from both sides is a number in a comment. Entries rank with shorter
     content first, so an entry the chat matched at #22 sits just outside the pool and
     one at #4 sits inside it — the only difference between the two runs below is
     which of them says the word the next entry is keyed on. */
  (function () {
    var N = API.LORE_CHAIN_FROM;
    /* Every entry in the pool is the same length, because rank — and so the pool —
       is decided by cost as well as by recency. A longer content would have pushed
       the linking entry out of the top twenty by itself, and the check would be
       about nothing. `size` is explicit because a fixture written entirely in
       terms of the constant it tests stays true when that constant is raised to a
       number nobody meant to allow: 999999 rows read per hop is a bound in name
       only, so the pair at 40 rows is what pins the size of it. */
    function poolBook(linkAt, size) {
      var n = size == null ? N + 2 : size;
      var list = [];
      for (var i = 0; i < n; i++) {
        list.push({ id: 'p' + i, keys: ['mw'], content: i === linkAt ? 'keeper!!' : 'nnnnnnnn' });
      }
      list.push({ id: 'goal', keys: ['keeper'], content: 'owes nine crowns' });
      return list;
    }
    var inside = ids(ranked(poolBook(4), 'mw in the message', { regex: false, chain: true, chainDepth: 1 }));
    ok('an entry inside the hop pool does wake the next one', inside.indexOf('goal*') !== -1, inside.slice(0, N + 4).join(','));
    var outside = ids(ranked(poolBook(N + 1), 'mw in the message', { regex: false, chain: true, chainDepth: 1 }));
    ok('…and one just past it does not, however long the chat waits',
      outside.indexOf('goal*') === -1, outside.slice(0, N + 4).join(','));
    eq('…which is the whole difference between the two runs', outside.length, inside.length - 1);
  (function () {
    /* Forty rows is more than this release allows and far less than nothing: if the
       bound is ever lifted to something cosmetic, the fourth-ranked link still works
       and the thirty-ninth one starts working too, which is the pair that fails. */
    var inside = ids(ranked(poolBook(3, 40), 'mw in the message', { regex: false, chain: true, chainDepth: 1 }));
    var outside = ids(ranked(poolBook(39, 40), 'mw in the message', { regex: false, chain: true, chainDepth: 1 }));
    ok('the pool is a few dozen rows: #4 is read, #40 is not',
      inside.indexOf('goal*') !== -1 && outside.indexOf('goal*') === -1,
      inside.indexOf('goal*') + '/' + outside.indexOf('goal*'));
  })();
  })();
  ok('…bounded by the constant the engine exports, not by luck',
    API.LORE_CHAIN_FROM >= 10 && API.LORE_CHAIN_MAX === 3,
    API.LORE_CHAIN_FROM + '/' + API.LORE_CHAIN_MAX);
})();

function finish() {
  console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* The Lore readout is the whole remedy for a card that does nothing: it is what a
   player reads when their regex entry is quiet. So this renders Views.world — the
   shipped function, against a stub document — and asserts on the HTML it wrote,
   which is the only way to catch the screen and the prompt disagreeing. */
console.log('\nH — the World screen, rendered, tells the truth about both switches');
(async function () {
  var env = viewEnv({ userName: 'Quinn' });
  var Views = env.Views;
  ok('the World screen is reachable', Views && typeof Views.world === 'function');
  var c = {
    id: 'c1', name: 'The keeper', persona: 'A lighthouse keeper.', scenario: '',
    greeting: '', examples: '', lorebook: book(),
    cardSource: { book: { recursive_scanning: true, recursion_depth: 2 } }
  };
  env.sb.Store.characters = [c];
  env.sb.Store.sessions = [{ id: 's1', title: 'The lamp chat' }];
  env.sb.Store.messages = [{ id: 'u1', role: 'user', text: "the lamp is out again and Vlad's boat is late" }];
  function row(list, i) {
    var m = String(list).split(/data-lore="/);
    return m[i + 1] || '';
  }
  function render(settings) {
    Object.keys(settings).forEach(function (k) { env.sb.Store.settings[k] = settings[k]; });
    env.reset();
    Views.world(env.el('root'));
    /* the rows arrive out of a promise chain, exactly as they do in the app */
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ list: env.el('lore-list').innerHTML, summary: env.el('lore-summary').innerHTML });
      }, 0);
    });
  }

  var off = await render({ honorCardRegex: false, honorCardRecursion: false });
  ok('the screen renders one row per entry, so nothing is hidden by the readout',
    (String(off.list).match(/data-lore="/g) || []).length === 10,
    String((String(off.list).match(/data-lore="/g) || []).length));
  ok('…and its summary says how many of them are in the prompt this turn',
    /<b>3 of 10<\/b> entries are in the prompt now/.test(off.summary), off.summary);
  ok('a card asking for regex keys is answered with the switch, not with silence',
    /switched off in Settings → System prompt/.test(off.summary) &&
    /regex keys, switched off/.test(row(off.list, 1)), row(off.list, 1));
  ok('…and the row says what happened instead: its pattern was read as text',
    /searched for as plain text/.test(row(off.list, 1)), row(off.list, 1));
  ok('with the switches off, nothing claims a pattern ran and nothing claims a chain',
    !/matched on a pattern/.test(off.list) && !/chained from another entry/.test(off.list));
  ok('…and the constant entry is in, saying that it is constant',
    /always \(constant\)/.test(row(off.list, 8)), row(off.list, 8));

  var on = await render({ honorCardRegex: true, honorCardRecursion: true });
  ok('the same book with both switches on says a pattern matched',
    /matched on a pattern/.test(row(on.list, 1)) && !/switched off/.test(on.list), row(on.list, 1));
  ok('…and names the two keys it had to refuse',
    /cannot match/.test(row(on.list, 3)) && /not a regular expression/.test(row(on.list, 3)), row(on.list, 3));
  ok('…a constant entry with a dead key still comes in, and the row says which is which',
    /its pattern does not compile — in because it is constant/.test(row(on.list, 8)), row(on.list, 8));
  ok('…and the entry the conversation never mentions says who woke it',
    /chained from another entry/.test(row(on.list, 6)), row(on.list, 6));
  ok('the summary counts the refusals rather than hiding them',
    /patterns were refused/.test(on.summary), on.summary);
  ok('…and says the book chains, with the bound this app applies',
    /This book also chains: <b>2<\/b> entries came in from another entry/.test(on.summary) &&
    /up to 2 hops/.test(on.summary), on.summary);
  ok('…and admits more, which is the only thing the switches are for',
    /<b>6 of 10<\/b> entries are in the prompt now/.test(on.summary), on.summary);

  /* The readout is only worth having if it is the prompt. Same character, same
     settings, same history, through the request builder. */
  var built = API.buildChat(c, { id: 's1', title: 'The lamp chat' }, env.sb.Store.messages, {
    userName: 'Quinn', systemPrompt: 'x', maxTokens: 300, contextMessages: 20,
    honorCardRegex: true, honorCardRecursion: true
  });
  var wire = JSON.stringify(built);
  ok('what the screen called matched is in the request',
    wire.indexOf('Vlad keeps the lamp.') !== -1, wire.slice(0, 200));
  ok('…and so is what it called chained',
    wire.indexOf('The harbourmaster owes the town nine crowns.') !== -1, wire.slice(0, 200));
  var plain = JSON.stringify(API.buildChat(c, { id: 's1', title: 'The lamp chat' }, env.sb.Store.messages, {
    userName: 'Quinn', systemPrompt: 'x', maxTokens: 300, contextMessages: 20
  }));
  ok('with no settings in scope, neither line reaches the wire',
    plain.indexOf('Vlad keeps the lamp.') === -1 &&
    plain.indexOf('The harbourmaster owes the town nine crowns.') === -1, plain.slice(0, 200));
})().then(finish, function (e) {
  ok('the rendered World screen completed', false, String((e && e.stack) || e));
  finish();
});
