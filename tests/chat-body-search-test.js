/* v1.45.0 searching message bodies: the chats box has to find the chat, not only the title.
 *
 * The box used to answer from the session index alone. That is fast and useless for
 * "the chat where the boat sank", which sits 140 messages deep under a title of "New
 * chat". Bodies live in a separate store with no text index, so this is a scan: it is
 * debounced, bounded, interruptible, and it paints itself in when it finishes. Those
 * four properties are the whole risk of the feature, so they are what this file pins
 * — plus the jump, because a hit you cannot reach is a bug with a nicer UI.
 *
 * Generic: invented chats, no character card, no network.
 *
 *   node /home/user/tests/chat-body-search-test.js
 */
'use strict';

var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---- the world the scan reads ------------------------------------------------ */
function msg(id, role, text) { return { id: id, role: role, text: text }; }
var BODIES = {
  s1: [msg('m1', 'user', 'the boat sank at the pier'), msg('m2', 'assistant', '*She shrugs.*')],
  /* s2 holds the phrase twice. The oldest is m4, and a jump must land there: "where it
     happened" is where the story starts, not where it was repeated. */
  s2: [msg('m3', 'user', 'boat?'), msg('m4', 'assistant', 'the boat sank at dawn'),
       msg('m5', 'assistant', 'and the boat sank again at dusk')],
  s3: [msg('m6', 'user', 'a boat, archived away')],
  s4: [msg('m7', 'user', null), msg('m8', 'assistant', ''), msg('m9', 'user', 'sank')]
};
var SESSIONS = [
  { id: 's1', charId: 'c1', title: 'New chat', updatedAt: 40, archived: false },
  { id: 's2', charId: 'c1', title: 'Harbour', updatedAt: 30, archived: false },
  { id: 's4', charId: 'c1', title: 'Empty ones', updatedAt: 20, archived: false },
  { id: 's3', charId: 'c1', title: 'Old', updatedAt: 10, archived: true }
];
var reads = 0, readIds = [], repaints = 0, toasts = [], slow = false;

/* ---- a thread to jump into ---------------------------------------------------- */
function fakeMsg(mid, text) {
  var el = {
    mid: mid, set: {}, scrolled: 0, textContent: text,
    getAttribute: function (n) { return n === 'data-mid' ? mid : null; },
    scrollIntoView: function () { this.scrolled++; }
  };
  el.classList = {
    add: function (c) { el.set[c] = true; },
    remove: function (c) { delete el.set[c]; },
    contains: function (c) { return !!el.set[c]; }
  };
  return el;
}
var THREAD = {
  msgs: [fakeMsg('m4', 'the boat sank at dawn'), fakeMsg('m5', 'and the boat sank again at dusk'),
         fakeMsg('m2', '*She shrugs.*')],
  querySelectorAll: function (sel) { return sel === '.msg' ? this.msgs : []; },
  querySelector: function (sel) {
    for (var i = 0; i < this.msgs.length; i++) {
      if (sel === '.msg[data-mid="' + this.msgs[i].mid + '"]') return this.msgs[i];
    }
    return null;
  }
};

var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: function () {},
  navigator: { userAgent: 'node', onLine: true },
  document: {
    addEventListener: function () {},
    querySelector: function (sel) {
      if (sel === '#thread') return THREAD;
      if (sel === '.screen') return { querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
      return null;
    },
    querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, appendChild: function () {}, querySelector: function () { return null; } }; }
  },
  UI: {
    esc: function (x) {
      return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    icon: function () { return ''; },
    toast: function (m) { toasts.push(String(m)); },
    sheet: function () { return Promise.resolve(null); },
    closeSheet: function () {},
    uid: function (p) { return p + '-' + Math.random().toString(36).slice(2, 7); },
    fmtTime: function () { return 'now'; },
    download: function () {},
    inputBox: function () { return Promise.resolve(null); }
  },
  IDB: {
    getAll: function (name) { reads++; return Promise.resolve(name === 'sessions' ? SESSIONS : []); },
    get: function () { return Promise.resolve(null); },
    put: function () { return Promise.resolve(); }
  },
  Store: {
    settings: { userName: 'Quinn', regexOn: false, regexScripts: [] },
    characters: [],
    saveSettings: function () { return Promise.resolve(); },
    getMessages: function (id) {
      readIds.push(id);
      if (slow) return sleep(15).then(function () { return BODIES[id] || []; });
      return Promise.resolve(BODIES[id] || []);
    },
    getCharacter: function () { return Promise.resolve({ id: 'c1', name: 'Nadia' }); }
  },
  Views: { chats: function () { repaints++; }, thread: function () {}, characters: function () {} },
  API: {}
};
sb.window = sb; sb.global = sb;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), sb, { filename: 'app.js' });
var App = sb.App;

/* every case except the debounce test drives the scan directly: the point of the
   timer is that it exists, not that the test has to lose a race with it. */
function query(q) {
  App.setChatSearch(q);
  if (App.state.searchTimer) { clearTimeout(App.state.searchTimer); App.state.searchTimer = null; }
  return App.searchBodies();
}

(async function () {
  console.log('\nA — typing does not mean reading the archive');

  App.setChatSearch('');
  await sleep(340);
  eq('an empty box starts no scan', reads, 0);
  eq('…and leaves no search state behind', App.state.search, null);

  App.setChatSearch('bo');
  await sleep(340);
  eq('two letters are not a search: they match every chat in the app', reads, 0);
  eq('…but the box still remembers what was typed', App.state.chatSearch, 'bo');

  App.setChatSearch('boat');
  eq('a real query is recorded at once, so the list can paint while the scan waits',
    App.state.search && App.state.search.q, 'boat');
  ok('the list is repainted immediately', repaints > 0);
  eq('and nothing is read before the debounce is up', reads, 0);
  await sleep(420);
  eq('the timer runs the scan on its own — the wiring is the feature', reads, 1);
  ok('…and the scan finishes', App.state.search.done === true && App.state.search.running === false);

  console.log('\nB — what counts as a hit');

  var hits = App.state.search.hits;
  eq('a chat whose only match is in the prose is found', !!hits.s1, true);
  eq('…with the message it happened in, oldest first', hits.s1.first, 'm1');
  eq('…and who said it', hits.s1.role, 'you');
  eq('every matching message counts, not only the first', hits.s2.count, 3);
  eq('…and the jump goes to the oldest of them, not the newest', hits.s2.first, 'm3');
  eq('an archived chat is not read unless it is being shown', !!hits.s3, false);
  eq('a chat of empty and missing texts is scanned without an error', !!hits.s4, false);
  ok('…and it was visited', readIds.indexOf('s4') !== -1, readIds.join(','));
  eq('the character who replied is named as a reply', App.scanForWords([msg('z', 'assistant', 'a boat')], ['boat']).role, 'reply');

  App.state.showArchived = true;
  await query('boat');
  eq('with archived shown, the scan reads them too', !!App.state.search.hits.s3, true);
  App.state.showArchived = false;

  console.log('\nC — it yields, it reports, and it can be superseded');

  ok('the list was repainted as it went, so progress is visible', repaints > 2, repaints);
  eq('a finished scan prints no progress line', App.searchProgress(), '');

  slow = true;
  App.setChatSearch('boat');
  if (App.state.searchTimer) clearTimeout(App.state.searchTimer);
  var staleRun = App.state.search;
  var inFlight = App.searchBodies();          /* in flight, one read per 15 ms */
  await query('lighthouse');
  await inFlight;
  slow = false;
  eq('a superseded scan cannot write into the new result', Object.keys(App.state.search.hits).length, 0);
  eq('…and the old run kept its own object, so nothing was shared', staleRun === App.state.search, false);
  ok('…and it ended without throwing', true);

  await query('boat dawn');
  eq('two words are ANDed inside one message, the way titles are',
    Object.keys(App.state.search.hits).join(','), 's2');
  eq('…so the oldest message holding BOTH wins the jump, not the one with only the first',
    App.state.search.hits.s2.first, 'm4');
  await query('BOAT');
  eq('case is not part of the question', Object.keys(App.state.search.hits).length, 2);
  await query('the a');
  eq('a single letter is dropped rather than widening the net to everything',
    App.state.search.words.join(','), 'the');

  console.log('\nD — the bound, and what it says when it bites');

  var many = [];
  for (var i = 0; i < 420; i++) many.push(msg('x' + i, 'user', i === 0 ? 'the boat sank' : 'nothing'));
  BODIES.s5 = many;
  SESSIONS.unshift({ id: 's5', charId: 'c1', title: 'Long one', updatedAt: 50, archived: false });
  await query('boat');
  eq('a huge chat is read from its tail, so the oldest line is out of reach', !!App.state.search.hits.s5, false);
  eq('…and the scan admits it stopped short', App.state.search.capped, true);
  App.state.search.done = false;
  App.state.search.scanned = 3;
  App.state.search.total = 9;
  ok('the progress line names the count and the giving-up',
    /Reading 3 of 9/.test(App.searchProgress()) && /stopped early/.test(App.searchProgress()), App.searchProgress());
  SESSIONS.shift(); delete BODIES.s5;

  var thirty = [];
  for (var j = 0; j < 40; j++) thirty.push(msg('y' + j, 'user', 'boat ' + j));
  BODIES.s6 = thirty;
  SESSIONS.unshift({ id: 's6', charId: 'c1', title: 'Repeats', updatedAt: 50, archived: false });
  await query('boat');
  eq('the count stops at 25, because the row prints 24+ and no more',
    App.state.search.hits.s6.count, 25);
  eq('…but a scan still walks the whole tail for the oldest hit',
    App.state.search.hits.s6.first, 'y0');
  SESSIONS.shift(); delete BODIES.s6;

  console.log('\nE — the row the user reads');

  var snippet = App.searchSnippet({ snippet: 'the <b>boat</b> sank at dawn' }, ['boat', 'sank']);
  ok('the matched words are marked',
    snippet.indexOf('<mark>boat</mark>') !== -1 && snippet.indexOf('<mark>sank</mark>') !== -1, snippet);
  ok('…and the text is escaped on the way out, so a reply cannot inject markup',
    snippet.indexOf('<b>') === -1 && snippet.indexOf('&lt;b&gt;') !== -1, snippet);
  eq('a hit with no words to mark is still escaped text',
    App.searchSnippet({ snippet: 'plain <i>x</i>' }, []), 'plain &lt;i&gt;x&lt;/i&gt;');
  eq('a missing hit is an empty row, not a crash', App.searchSnippet(null, ['a']), '');
  var cut = App.searchCut('x'.repeat(400) + ' the boat sank here ' + 'y'.repeat(400), 404);
  ok('the snippet is centred near the match and cut at both ends',
    cut.indexOf('…') === 0 && /boat/.test(cut) && /…$/.test(cut) && cut.length < 140, cut);

  console.log('\nF — the jump');

  App.state.chatSearch = 'boat sank';
  App.focusMessage('m4');
  eq('the message you asked for is the highlighted one', THREAD.msgs[0].set['msg-find'], true);
  eq('…and it was scrolled to', THREAD.msgs[0].scrolled, 1);
  ok('the other matching messages are lit, not highlighted',
    THREAD.msgs[1].set['msg-hit'] === true && !THREAD.msgs[1].set['msg-find'], JSON.stringify(THREAD.msgs[1].set));
  ok('a message that does not match is left alone', !THREAD.msgs[2].set['msg-hit']);
  eq('and the count of the rest is said out loud', /other matching message/.test(toasts[toasts.length - 1]), true);

  THREAD.msgs.forEach(function (m) { m.set = {}; m.scrolled = 0; });
  App.state.chatSearch = '';
  App.focusMessage('m4');
  eq('with the box empty the jump still lands', THREAD.msgs[0].set['msg-find'], true);
  ok('…and marks nothing else', !THREAD.msgs[1].set['msg-hit'] && !THREAD.msgs[0].set['msg-hit']);

  THREAD.msgs.forEach(function (m) { m.set = {}; });
  App.state.chatSearch = 'boat';
  var toastsBefore = toasts.length;
  App.focusMessage('deleted-message');
  ok('a message that is gone says so, instead of opening a chat at the top',
    /gone from this chat/.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
  eq('…and the match count is not allowed to overwrite that message', toasts.length - toastsBefore, 1);

  toasts.length = 0;
  App.state.chatSearch = 'boat';
  App.focusMessage('m1" or 1=1');
  eq('a selector-hostile id is never handed to querySelector', THREAD.msgs[0].set['msg-find'], undefined);
  ok('…and the user still hears that nothing was found',
    /gone from this chat/.test(toasts[toasts.length - 1] || ''), toasts.join(' | '));
  THREAD.msgs.forEach(function (m) { m.set = {}; });
  App.state.chatSearch = '';
  toasts.length = 0;
  App.focusMessage('');
  ok('an empty id and an empty box: no marks, no toast, no jump',
    toasts.length === 0 && !THREAD.msgs[0].set['msg-hit'] && !THREAD.msgs[0].set['msg-find'],
    JSON.stringify(THREAD.msgs[0].set) + ' | ' + toasts.join(' / '));

  console.log('\nH — the wiring, checked where it is easy to break');

  var viewsSrc = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
  var htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('the row prints the snippet, not the summary, when a body matched',
    /bodyHit\(s\)[\s\S]{0,260}App\.searchSnippet\(bodyHit\(s\), words\)/.test(viewsSrc));
  ok('…and the count is capped in words, because 25 is enough to say "many"',
    /bodyHit\(s\)\.count > 24 \? '24\+'/.test(viewsSrc));
  ok('the jump button carries the session and the oldest hit, and nothing else',
    /data-jump="' \+ esc\(s\.id\) \+ ':' \+ esc\(bodyHit\(s\)\.first\)/.test(viewsSrc));
  ok('…and the click hands both to the chat opener as a focus target',
    /App\.openSession\(bits\[0\], \{ focusMid: bits\[1\] \}\)/.test(viewsSrc));
  ok('the jump does not also fire the row’s own open handler',
    /e\.preventDefault\(\); e\.stopPropagation\(\);/.test(viewsSrc.slice(viewsSrc.indexOf("on(list, '[data-jump]'"))));
  ok('the progress line only appears while a scan is in flight',
    /if \(scanning\)/.test(viewsSrc) && /App\.searchProgress\(\)/.test(viewsSrc));
  ok('the hits are only read for the query that is still typed',
    /App\.state\.search\.q === q/.test(viewsSrc));
  ok('the box is revealed once there are enough chats to need it — it shipped hidden',
    /searchEl\.hidden = all\.length < 3/.test(viewsSrc));
  ok('…and the markup says what it searches now',
    /placeholder="Search titles and messages"/.test(htmlSrc));
  ok('typing goes through the one setter that starts and stops the scan',
    /App\.setChatSearch\(_chs\.value\)/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')) &&
    !/App\.state\.chatSearch = _chs\.value/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')));

  console.log('\nG — the words');

  eq('the query is trimmed, lowercased and stripped of single letters',
    App.searchWords('  The   A boat SANK ').join(','), 'the,boat,sank');
  eq('…and capped, because ten words is already not a search',
    App.searchWords('a1 b2 c3 d4 e5 f6 g7 h8 i9 j0').length, 8);
  eq('an empty box has no words', App.searchWords('   ').length, 0);

  console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
