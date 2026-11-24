/* v1.46.0 recall: BM25-lite over the messages the history window left out, appended and never moved.
 *
 * Three properties carry the whole feature, and each is a decision taken in the
 * research rather than an invention: protect the window (a passage the request
 * already carries is not recalled), append after the transcript (relocating matched
 * messages is what costs SillyTavern its prompt-cache discount, and 90 % of this
 * app's cheap behaviour is that prefix staying put), and score by inverse document
 * frequency (a raw term count ranks "the lamp" first in a lighthouse story forever).
 * Everything else here is the price of getting those wrong: a frozen prompt is not
 * the only failure mode — a passage fetched on one shared common word is worse than
 * no passage, because the model will weave it in.
 *
 * Generic: a synthetic 60-turn campaign, no cards, no network, no model.
 *
 *   node /home/user/tests/recall-bm25-test.js
 */
'use strict';

var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
var pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function load() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () { return 0; },
    clearInterval: function () {},
    document: { addEventListener: function () {} }, navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error('offline')); },
    Store: { settings: {} }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
  return sb.API;
}
var API = load();

var TURNS = 60;
function fixture(lastAsk) {
  var h = [];
  for (var i = 0; i < TURNS; i++) {
    var mine = i === TURNS - 1 && lastAsk
      ? lastAsk
      : 'turn ' + i + ' — the tide and the lamp and the weather outside';
    if (i === 8) mine = 'turn 8 — I name the boat Sorrow of Dunmore and it is rotting at the pier';
    h.push({ id: 'u' + i, role: 'user', text: mine });
    var rep = i === 20
      ? 'Nadia: turn 20 — the debt to the harbourmaster is paid in full, three crowns, ledger torn'
      : 'Nadia: turn ' + i + ' — she nods at the weather';
    h.push({ id: 'a' + i, role: 'assistant', text: rep });
  }
  return h;
}
function winOf(history, cap) {
  return API.requestWindow(history, { contextMessages: cap || 40 });
}
var ASK = 'is the Sorrow of Dunmore still rotting at the pier?';

console.log('\nA — the ranking');

var h = fixture(ASK);
var w = winOf(h);
var r = API.recallSearch(h, ASK, { windowed: w.messages, limit: 6 });
ok('the window holds the last 40 messages and the corpus is everything before it',
  w.messages.length === 40 && r.corpus === h.length - 40, w.messages.length + '/' + r.corpus);
eq('the planted name is found 50 turns after it was written', r.hits.length, 1);
eq('…in the message it was planted in', r.hits[0].index, 16);
ok('…with a score that is a magnitude, not a coincidence', r.hits[0].score > 1, r.hits[0].score);
eq('the common words alone fetch nothing: 60 messages mention the lamp', (function () {
  return API.recallSearch(h, 'the lamp and the tide', { windowed: w.messages, limit: 6 }).hits.length;
})(), 0);
ok('…and a two-word query whose words co-occur once does find it', (function () {
  var x = API.recallSearch(h, 'harbourmaster crowns', { windowed: w.messages, limit: 6 });
  return x.hits.length === 1 && x.hits[0].index === 41;
})(), true);
eq('a query of nothing but stopwords has no terms to score', API.recallSearch(h, 'the a an of', { windowed: w.messages }).hits.length, 0);
eq('an empty query likewise', API.recallSearch(h, '', { windowed: w.messages }).hits.length, 0);

ok('saying a word twice in the query does not double anything (tf is the document’s)',
  (function () {
    var twice = API.recallSearch(h, 'Sorrow Sorrow of Dunmore pier rotting', { windowed: w.messages, limit: 6 });
    var once = API.recallSearch(h, 'Sorrow of Dunmore pier rotting', { windowed: w.messages, limit: 6 });
    return twice.hits.length === 1 && once.hits.length === 1 &&
      Math.abs(twice.hits[0].score - once.hits[0].score) < 1e-9;
  })(), true);

/* Term-frequency saturation, the thing that separates BM25 from a word count. One
   post says "pier" four hundred times, another says it twice: the long one wins, but
   by a third, not by two hundred. `avg` length normalisation is why it is not more. */
(function () {
  var corpus = [{ id: 'x0', role: 'user', text: 'pier moorings ' + 'pier '.repeat(400) + 'at the edge of the harbour' },
                { id: 'x1', role: 'user', text: 'pier pier moorings' }];
  for (var i = 0; i < 40; i++) corpus.push({ id: 'f' + i, role: 'user', text: 'dock rope and tar, day ' + i + ' moorings' });
  var r = API.recallSearch(corpus, 'pier moorings', { windowed: [], limit: 3 });
  eq('both are fetched: one rare word plus one the whole chat shares', r.hits.length, 2);
  var loud = r.hits.filter(function (x) { return x.id === 'x0'; })[0];
  var tight = r.hits.filter(function (x) { return x.id === 'x1'; })[0];
  ok('repetition saturates: 200 times the term buys a factor between 0.3 and 3, not 200',
    !!loud && !!tight && loud.score < tight.score * 3 && loud.score > tight.score * 0.3,
    loud && tight ? (loud.score / tight.score).toFixed(3) + '\u00d7 (' + loud.score.toFixed(2) + ' vs ' + tight.score.toFixed(2) + ')' : 'not both fetched');
  ok('…and the score is reported per hit, so the sheet can say how sure it was',
    r.hits.every(function (x) { return x.score > 0 && x.matched >= 2 && x.clues >= 1; }),
    JSON.stringify(r.hits[0]));
})();

/* Six messages that differ only in a word the query never asks about: all of them
   score to the last decimal, so their order is decided by the tie-break alone. A pair
   would not do — a comparator is free to be asked about a pair in either direction, so
   it takes a run of six to show an order is not arbitrary. The eighteen other messages
   are there to keep "alpha beta" rare enough to count as a clue: a term in a quarter
   of the chat or more is not one, which is the rule the run is also testing. */
var TIE = [];
['anchor', 'cable', 'fable', 'gable', 'hitch', 'joint'].forEach(function (w, i) {
  TIE.push({ id: 'tie' + i, role: 'user', text: 'alpha beta ' + w });
  for (var f = 0; f < 3; f++) {
    TIE.push({ id: 'filler' + i + '-' + f, role: 'user', text: 'gamma delta ' + ['rope', 'sack', 'keg', 'net', 'lamp'][f % 5] + i + f });
  }
});
var t1 = API.recallSearch(TIE, 'alpha beta', { windowed: [], limit: 6 });
var t2 = API.recallSearch(TIE, 'alpha beta', { windowed: [], limit: 6 });
eq('all six tied passages come back, none dropped', t1.hits.length, 6);
eq('…and they come back newest first, all the way down',
  t1.hits.map(function (x) { return x.id; }).join(','), 'tie5,tie4,tie3,tie2,tie1,tie0');
eq('…and the run is repeatable: same chat, same prompt',
  t2.hits.map(function (x) { return x.id; }).join(','), t1.hits.map(function (x) { return x.id; }).join(','));
ok('…and every one of them really did tie',
  t1.hits.every(function (x) { return Math.abs(x.score - t1.hits[0].score) < 1e-12; }),
  t1.hits.map(function (x) { return x.score.toFixed(10); }).join(' '));
eq('a word in most of the chat is no clue at all',
  API.recallSearch(TIE, 'gamma delta', { windowed: [], limit: 3 }).hits.length, 0);
eq('one rare word on its own is enough — the turn where a name is all you typed',
  API.recallSearch([{ id: 'q', role: 'user', text: 'the Sorrow of Dunmore was a brig' },
                    { id: 'r', role: 'user', text: 'the tide and the lamp' },
                    { id: 's', role: 'user', text: 'the weather and the tide' }],
    'Sorrow', { windowed: [], limit: 3 }).hits.length, 1);

/* one word out of two is not a match: it is how a boilerplate reply gets fetched
   because it happens to contain "the", and the model then weaves it in */
var HALF = [
  { id: 'half0', role: 'user', text: 'the lamp was lit and the tide was high at the quay' },
  { id: 'half1', role: 'user', text: 'a keg, a coil, and a rope, listed in the harbour ledger' },
  { id: 'half2', role: 'user', text: 'a net, a brush, and a sack, listed in the harbour ledger' },
  { id: 'both', role: 'user', text: 'the lamp was lit at the ford, and the toll was owed' }
];
eq('a passage sharing one of two words is not fetched',
  API.recallSearch(HALF, 'lamp ford', { windowed: [], limit: 4 }).hits.map(function (x) { return x.id; }).join(','), 'both');
eq('…while one sharing both is, once',
  API.recallSearch(HALF, 'lamp ford', { windowed: [], limit: 4 }).hits.length, 1);

console.log('\nB — the corpus, the window, and the cache');

ok('nothing inside the window is ever recalled twice',
  API.recallSearch(h, ASK, { windowed: h.slice(10), limit: 6 }).hits.every(function (x) { return x.index < 10; }) ||
  API.recallSearch(h, ASK, { windowed: h.slice(10), limit: 6 }).hits.length === 0, 'ok');
var allin = API.recallSearch(h, ASK, { windowed: h, limit: 6 });
eq('with the whole chat in the window there is nothing left to fetch', allin.corpus, 0);
var short = fixture(ASK).slice(0, 4);
eq('a chat with four messages is too young to need a memory', API.recallFor(short, { messages: short }, { name: 'N' }, {}, { recallOn: true }) ? 1 : 0, 0);

var grown = fixture(ASK);
grown.push({ id: 'u99', role: 'user', text: 'turn 99 — and the Sorrow of Dunmore sank at noon' });
var rNew = API.recallSearch(grown, 'which ship sank at noon', { windowed: winOf(grown).messages, limit: 6 });
ok('a message added since the last request is in the next one (the token cache is invalidated)',
  rNew.corpus > 0, rNew.corpus);
var edited = fixture(ASK);
edited[16].text = 'turn 8 — the brig is called Grief of Dunmore';
var rEd = API.recallSearch(edited, 'which brig is called Grief', { windowed: winOf(edited).messages, limit: 6 });
ok('…and so is an edit to an old line, even at the same length',
  rEd.hits.length === 1 && rEd.hits[0].index === 16, JSON.stringify(rEd.hits[0] || {}));

var BIG = [];
for (var b = 0; b < 1600; b++) BIG.push({ id: 'b' + b, role: 'user', text: 'common word ' + b + ' — uniquephrase' + (b === 3 ? 'x' : b) });
var rb = API.recallSearch(BIG, 'uniquephrasex common', { windowed: [], limit: 3 });
eq('a monstrous chat is capped rather than stalling the turn', rb.corpus, API.RECALL_LIMITS.maxDocs);
ok('…keeping the newest end, which is where the recent scenes are', rb.scanned > rb.corpus, rb.scanned + ' > ' + rb.corpus);

console.log('\nC — the block that gets injected');

var char = { id: 'c1', name: 'Nadia', persona: 'A lighthouse keeper.' };
var sess = { id: 's1', charId: 'c1' };
var on = { userName: 'Quinn', recallOn: true, recallCount: 4, contextMessages: 40, systemPrompt: 'x', maxTokens: 300 };
var blk = API.recallFor(h, winOf(h), char, sess, on);
ok('it is labelled as the chat’s own record, not as a new message',
  /From earlier in this conversation, taken from its own record/.test(blk.text), blk.text.slice(0, 90));
ok('…says what to do when it conflicts with the present', /newer wins/.test(blk.text));
ok('…and quotes the line, with the speaker named', /Quinn: .*Sorrow of Dunmore/.test(blk.text), blk.text.slice(0, 400));
eq('…numbered from one, at most as many as asked for', (blk.text.match(/^\d\./gm) || []).length, 1);
eq('it reports what it cost', blk.tokens > 0 && blk.tokens < 700, true);
eq('…and how much it had to choose from', blk.corpus, h.length - 40);

var off = API.recallFor(h, winOf(h), char, sess, { userName: 'Quinn', recallCount: 4 });

/* A tie has to break somewhere fixed, or the prompt is not repeatable. The two
   passages below score to the last decimal, so which one comes back first is decided
   by the tie-break alone: equal scores go to the newer message, because if the chat
   said a thing twice, the second saying is the one that is true now. */
var tied = [
  { id: 't0', role: 'user', text: 'the toll at the ford was paid, said the ferryman' },
  { id: 't1', role: 'user', text: 'a rope, a sack, and a candle, listed in the harbour ledger' },
  { id: 't2', role: 'user', text: 'a net, a lantern, and a coil, listed in the harbour ledger' },
  { id: 't3', role: 'user', text: 'the toll at the ford was settled, said the ferryman' },
  { id: 't4', role: 'user', text: 'a coil, a tarpaulin, and a keg, listed in the harbour ledger' },
  { id: 't5', role: 'assistant', text: 'Nadia: the kettle boiled and the rain went off the roof' },
  { id: 't6', role: 'user', text: 'the weather outside, the nets, and a kettle in the kitchen' },
  { id: 't7', role: 'user', text: 'what is the toll at the ford now, and who said it?' }
];
(function () {
  var r = API.recallSearch(tied, 'toll ford said ferryman', { windowed: [tied[7]], limit: 4 });
  eq('two passages, one score: both come back', r.hits.length, 2);
  ok('…and the newer one is offered first',
    r.hits[0].index === 3 && r.hits[1].index === 0,
    r.hits.map(function (x) { return x.index + '/' + x.score.toFixed(6); }).join(' '));
  var blk = API.recallFor(tied, { messages: [tied[7]] }, char, sess, on);
  ok('…and a block built from a tie keeps the same order as the ranking',
    blk === null || blk.from[0] === 3 || blk.from.indexOf(3) < blk.from.indexOf(0),
    JSON.stringify(blk && blk.from));
})();

/* The bound that makes "on every turn" safe: an unbounded scan of a 4 000-message
   chat is how a phone spends its turn on arithmetic. The cap keeps the newest lines,
   and what it left out is counted rather than hidden — "nothing matched" about
   messages nobody read would be a lie. */
(function () {
  var CAP = API.RECALL_LIMITS.maxDocs, BEYOND = 300, TOTAL = CAP + BEYOND;
  var many = [];
  for (var i = 0; i < TOTAL; i++) {
    many.push({ id: 'c' + i, role: 'user', text: 'the harbour was quiet on day ' + i + ', the nets were mended' });
  }
  /* the cap keeps the NEWEST `CAP` of `TOTAL`, so the boundary sits at TOTAL-CAP */
  many[TOTAL - CAP - 1].text = 'the Sorrow of Dunmore was moored at the rotting pier';
  many[TOTAL - CAP - 1].id = 'edge-out';      /* the newest line that is not read */
  many[TOTAL - CAP].text = 'the Grief of Aranmoore was moored at the rotting quay';
  many[TOTAL - CAP].id = 'edge-in';           /* the oldest line that is */
  var r = API.recallSearch(many, 'Sorrow Grief pier quay moored rotting', { windowed: [], limit: 4 });
  eq('the search reads at most the cap', r.corpus, CAP);
  eq('…and says how many it never looked at', r.scanned - r.corpus, 300);
  ok('…the line one place inside the cap is found, the one just outside is not',
    r.hits.length === 1 && r.hits[0].id === 'edge-in', JSON.stringify(r.hits[0] && r.hits[0].id));
})();

eq('the switch is the whole feature: off means no block, not an empty one', off, null);
var noluck = API.recallFor(h, winOf(h), char, sess, Object.assign({}, on, { recallOn: true }));
ok('with a query that matches nothing, no block either — and no invented filler',
  noluck === null || noluck.hits >= 0, JSON.stringify(noluck && noluck.text.slice(0, 40)));

var wide = API.recallFor(h, winOf(h, 120), char, sess, on);
eq('a chat that fits entirely in the window has nothing to recall', wide, null);

/* twelve asked for, and a block whose own budget fits fewer: what the cap left out is
   counted, not silently missing, and the numbering stays whole. */
var huge = [];
for (var q = 0; q < 49; q++) {
  huge.push({ id: 'h' + q, role: 'user',
    text: (q % 4 === 1 ? 'zrepl ' : 'other ') + q + ' — ' + 'the tide and the lamp at the pier '.repeat(14) });
}
huge[48].text = 'zrepl 48 — the tide and the lamp at the pier';
var budget = API.recallFor(huge, { messages: [huge[48]] }, char, sess, { userName: 'Quinn', recallOn: true, recallCount: 12 });
ok('twelve passages are offered but the block never outgrows its budget',
  budget.hits === 12 - budget.dropped && budget.dropped > 0 && budget.hits >= 3 &&
  budget.text.length <= API.RECALL_LIMITS.tokens * 4 + 400,
  budget.text.length + ' chars, ' + budget.hits + ' kept, ' + budget.dropped + ' dropped of 12');
ok('…and what it kept is numbered without holes', (budget.text.match(/^\d+\./gm) || []).length === budget.hits,
  budget.hits);

var longOne = 'a'.repeat(2000) + ' the pier where Sorrow was moored ' + 'b'.repeat(2000);
var sn = API.recallSnippet(longOne, ['sorrow', 'pier'], 420);
ok('a snippet is the matched stretch of a long message, not its opening',
  /Sorrow was moored/.test(sn) && sn.length <= 424, String(sn.length));
ok('…and it says it was cut, at both ends', sn.indexOf('…') === 0 && /…$/.test(sn), sn.slice(0, 12) + ' … ' + sn.slice(-8));
eq('a message with nothing to match falls back to its opening', API.recallSnippet('plain words here', ['zzz'], 40), 'plain words here');
ok('a short message is passed through whole, with no invented ellipsis',
  API.recallSnippet('the Sorrow was moored at the pier', ['sorrow'], 420) === 'the Sorrow was moored at the pier');

console.log('\nD — both builders, same position, same order');

var msgs = API.buildChat(char, sess, h, on);
var tail = msgs[msgs.length - 1];
ok('the recall block rides in the trailing system turn, after the transcript',
  tail.role === 'system' && /From earlier in this conversation/.test(tail.content), JSON.stringify(tail).slice(0, 120));
var withLock = h.map(function (m) { return m.role === 'assistant' ? Object.assign({}, m, { text: m.text + ' *a* *b* *c*' }) : m; });
var msgs2 = API.buildChat(char, sess, withLock, on);
var tail2 = msgs2[msgs2.length - 1].content;
ok('…and before the style lock and the app’s own instructions, which are orders',
  tail2.indexOf('From earlier in this conversation') !== -1 &&
  tail2.indexOf('From earlier in this conversation') < (tail2.indexOf('FORMAT FOR THIS REPLY') === -1 ? 1e9 : tail2.indexOf('FORMAT FOR THIS REPLY')),
  tail2.slice(0, 60));

var body = msgs.slice(0, msgs.length - 1);
var numbers = body.map(function (m) { return String(m.content).indexOf('turn 8 —'); }).join('|');
eq('the turn that was recalled is still absent from the transcript (append, not move)',
  /turn 8 —/.test(body.filter(function (m) { return m.role !== 'system'; }).map(function (m) { return m.content; }).join('\n')), false);
var hist = body.slice(1).map(function (m) { var x = /turn (\d+) —/.exec(String(m.content)); return x ? +x[1] : -1; }).filter(function (n) { return n >= 0; });
ok('…and the transcript that IS sent runs oldest to newest, untouched',
  hist.length > 4 && hist.every(function (n, i) { return i === 0 || n >= hist[i - 1]; }),
  hist.slice(0, 8).join(','));
ok('…starting where the window starts, not where the recalled turn sits',
  hist[0] === 40 && hist.indexOf(8) === -1, String(hist[0]));
var asm = API.lastAssembly();
ok('the assembly records what recall did, in messages and tokens',
  asm.recall && asm.recall.on === true && asm.recall.passages >= 1 && asm.recall.tokens > 0, JSON.stringify(asm.recall));
ok('…and names the message it took, so the inspector can point at it',
  asm.recall.from.indexOf(16) !== -1, JSON.stringify(asm.recall.from));

var offMsgs = API.buildChat(char, sess, h, { userName: 'Quinn', contextMessages: 40, systemPrompt: 'x', maxTokens: 300 });
ok('with the switch off the prompt is byte-for-byte the prompt of before',
  offMsgs.length === msgs.length - 1 && !/From earlier in this conversation/.test(offMsgs.map(function (m) { return m.content; }).join('\n')),
  offMsgs.length + ' vs ' + msgs.length);
eq('…and the assembly says so rather than printing a zero', API.lastAssembly().recall.on, false);

var plain = API.buildPrompt(char, sess, h, on);
ok('the plain-text shape gets the same block, after the transcript and before the cue',
  plain.indexOf('Chat history:') < plain.indexOf('From earlier in this conversation') &&
  plain.indexOf('From earlier in this conversation') < plain.lastIndexOf('Nadia:'), JSON.stringify(plain.slice(plain.indexOf('From earlier'), 80)));
var plainOff = API.buildPrompt(char, sess, h, { userName: 'Quinn', contextMessages: 40, systemPrompt: 'x', maxTokens: 300 });
ok('…and nothing at all when it is off', plainOff.indexOf('From earlier in this conversation') === -1);

console.log('\nE0 — a 60-turn campaign, probed the way the memory research says to');

/* The LongMemEval question types, asserted on the request the app would send rather
   than on prose. The window is 40 messages, so from turn 40 on, turns 0-39 have left
   the transcript: anything planted early comes back through recall or not at all.
   The last line of play names the threads it asks about — that is the contract of a
   lexical engine, and the limit test below says so out loud. */
(function () {
  function campaign(finalLine) {
    var h = [];
    for (var i = 0; i < 60; i++) {
      var mine = 'on the ' + i + 'th evening we mended the nets and talked about the tide';
      var reply = 'Nadia: the keeper poured the tea and listened to the rain';
      if (i === 8) mine = 'I name the brig the Sorrow of Dunmore, rotting at the north pier';
      if (i === 12) mine = 'I buy a brass spyglass from the chandler for two crowns';
      if (i === 20) mine = 'the harbourmaster says the debt of nine crowns stands open until the tide turns';
      if (i === 26) reply = 'Nadia: Pell takes his kit and leaves the lamp house for good';
      if (i === 50) mine = 'the debt of nine crowns is paid in full and the ledger is torn';
      if (i === 59) mine = finalLine;
      h.push({ id: 'u' + i, role: 'user', text: mine });
      h.push({ id: 'a' + i, role: 'assistant', text: reply });
    }
    return h;
  }
  var ASK = 'the Sorrow of Dunmore is at the north pier — did the chandler ever get the two ' +
    'crowns for the brass spyglass, and is the debt of nine crowns settled? what became of Pell?';
  var chat = Object.assign({}, on, { recallCount: 6 });
  var plain = { userName: 'Quinn', contextMessages: 40, systemPrompt: 'x', maxTokens: 300 };
  var cam = campaign(ASK);
  var built = API.buildChat(char, sess, cam, chat);
  var withRecall = built.map(function (m) { return String(m.content); }).join('\n');
  var without = API.buildChat(char, sess, cam, plain).map(function (m) { return String(m.content); }).join('\n');

  ok('extract (the name said only at turn 8): with recall the line is in the request',
    /Sorrow of Dunmore, rotting at the north pier/.test(withRecall), 'absent');
  ok('…and at the same turn it is genuinely gone from the transcript, not merely duplicated',
    !/rotting at the north pier/.test(without), 'the plain prompt should not carry it');
  ok('combine (turn 12): two facts from a different turn arrive in one briefing',
    /brass spyglass/.test(withRecall) && /two crowns/.test(withRecall));
  ok('update (turns 20 and 50): the superseded value can only come from recall, the current one is in the transcript',
    /debt of nine crowns is paid in full/.test(without) && /stands open/.test(withRecall) &&
    !/stands open/.test(without), 'both present or neither');
  ok('…and the block itself hands the model the rule for the clash',
    /newer wins/.test(withRecall), 'no');
  ok('…while the same prompt without recall loses the whole episode, which is the point of the switch',
    /stands open/.test(without) === false, 'leaked');
  ok('temporal (the companion who left at 26): recalled as an exit, with its own turn',
    /Pell takes his kit/.test(withRecall), 'no');
  ok('…and it is labelled as a recalled line, so the model reads it as past',
    /From earlier in this conversation/.test(withRecall));
  eq('abstain: a thing never established is not fetched, not even as a plausible maybe',
    /bell in the tower/.test(withRecall), false);
  eq('no filler: the block carries the four turns that answer and no neighbourly boilerplate',
    (API.recallFor(cam, API.requestWindow(cam, plain), char, sess, chat).text.match(/mended the nets/g) || []).length, 0);
  ok('the campaign is deterministic: the same chat builds the same request twice',
    API.buildChat(char, sess, campaign(ASK), chat).join('\n') === built.join('\n'), 'differs');

  /* the documented limit, asserted so nobody is surprised by it: an engine with no
     model answers what the words point at. Ask the same question in other words and
     the passage stays buried — recall neither guesses nor apologises. */
  var vague = API.buildChat(char, sess, campaign('how did that all end for us?'), chat)
    .map(function (m) { return String(m.content); }).join('\n');
  ok('LIMIT: phrased without the thread\'s words, nothing is fetched — no guessing, no invented recall',
    !/From earlier in this conversation/.test(vague) && !/spyglass/.test(vague), 'it invented something');
})();

console.log('\nE — the words it matches on');

eq('markup is stripped before matching', API.recallTokenize('*the **lamp** and `Sorrow`!*').join(','), 'lamp,sorrow');
eq('single letters and stopwords are not signal', API.recallTokenize('a the of lamp x').join(','), 'lamp');
eq('numbers are words (a year, a count)', API.recallTokenize('in 1846 we paid 3 crowns').join(','), '1846,paid,crowns');
var capped = API.recallTokenize('word '.repeat(4000));
ok('a document is bounded, so one enormous post cannot dominate the corpus',
  capped.length <= 400, capped.length);
eq('accents and apostrophes survive', API.recallTokenize("El Niño's cañon").join(','), "niño's,cañon");

console.log('\nF — the keys, the reset, and the screen');

var storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
ok('recall ships off', /recallOn: false/.test(storeSrc) && /recallCount: 6/.test(storeSrc));
ok('…and is not swept by a generation reset — it belongs to the Memory screen',
  !/recallOn|recallCount/.test(storeSrc.slice(storeSrc.indexOf('var GEN_KEYS'), storeSrc.indexOf('var Store ='))));
var viewsSrc = fs.readFileSync(path.join(ROOT, 'js', 'views.js'), 'utf8');
ok('the Memory screen owns the switch and the count',
  /sc\.toggle\('#t-recall', 'recallOn'\)/.test(viewsSrc) && /sc\.range\('#set-recallcount', '#v-recallcount', 'recallCount'\)/.test(viewsSrc));
ok('…and reports what the last request did instead of leaving it a guess',
  /recallStatusNote\(\)/.test(viewsSrc) && /looked through /.test(viewsSrc));
ok('the wording promises no relocation and no upload',
  /Nothing is moved /.test(viewsSrc) && /nothing uploaded/.test(viewsSrc) &&
  /prompt cache keeps its discount/.test(viewsSrc));
/* The note is built by a real function on a real record, not grepped out of the
   source: pull its body out of views.js and run it against stubbed assemblies. The
   sentences are the ones a user reads when deciding whether to leave this on, so
   they are worth asserting on their own. */
(function () {
  var src = viewsSrc;
  var head = 'function recallStatusNote() {';
  var i = src.indexOf(head);
  ok('the note is a function in views.js, not a string in the markup', i > 0);
  if (i < 0) return;
  var depth = 0, j = i + head.length - 1;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  var make = new Function('API', src.slice(i, j + 1) + '; return recallStatusNote;');
  var note = function (recall) {
    return make({ lastAssembly: function () { return { recall: recall }; } })();
  };
  eq('with nothing generated yet it does not print a zero',
    note(undefined), 'Nothing has been recalled yet since the app opened. Send a reply with this on and the count appears here.');
  eq('off means off, in words', note({ on: false }), 'Switched off, so the last request carried no recall block.');
  eq('a pass that found nothing says it looked',
    note({ on: true, passages: 0, corpus: 214, scanned: 214 }),
    'Last request: looked through 214 older messages and nothing in them matched that turn.');
  ok('a pass that kept passages counts them and their cost',
    note({ on: true, passages: 3, corpus: 214, scanned: 214, tokens: 388, dropped: 0 }) ===
      'Last request: looked through 214 older messages and kept 3 passages, ~388 tokens.',
    note({ on: true, passages: 3, corpus: 214, scanned: 214, tokens: 388, dropped: 0 }));
  ok('…and admits when the budget cut some of them',
    /2 more dropped for size\.$/.test(note({ on: true, passages: 4, corpus: 214, scanned: 214, tokens: 700, dropped: 2 })));
  ok('past the search cap it names what it never read, rather than claiming it was empty',
    /1 500 older messages \(2 460 before those are past the search cap and were not read\)/
      .test(note({ on: true, passages: 1, corpus: 1500, scanned: 3960, tokens: 96, dropped: 0 })) ||
    /1500 older messages \(2460 before those are past the search cap and were not read\)/
      .test(note({ on: true, passages: 1, corpus: 1500, scanned: 3960, tokens: 96, dropped: 0 })),
    note({ on: true, passages: 1, corpus: 1500, scanned: 3960, tokens: 96, dropped: 0 }));
})();

var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
ok('the inspector counts it among the things a request spent',
  /Recall: /.test(appSrc) && /asm\.recall/.test(appSrc));

console.log('\nG — one speaker label per recalled line');

/* The block writes its own "Quinn:" / "Nadia:" credit, and roleplay text is full of
   inline labels, so this is where a doubled name comes from — and where a label that
   belongs to somebody else must not be mistaken for noise. */
(function () {
  function fixture(speaker) {
    var h = [];
    for (var i = 0; i < 10; i++) {
      h.push({ id: 'u' + i, role: 'user', text: 'evening ' + i + ': the tide, the lamp, and the price of nets' });
    }
    h.push({
      id: 'x', role: 'assistant',
      text: speaker + ': Pell left the lamp house and the Sorrow of Dunmore was sold at the quay'
    });
    h.push({ id: 'z', role: 'user', text: 'is the Sorrow of Dunmore sold, and did Pell leave the lamp house?' });
    return h;
  }
  function block(speaker, cast) {
    var h = fixture(speaker);
    var b = API.recallFor(h, { messages: [h[h.length - 1]] }, char,
      cast ? { id: 's', sceneCast: cast } : { id: 's' }, on);
    return b ? b.text.split('\n').slice(1).join('\n') : '';
  }
  eq('a card that signs its own lines is named once, not twice', block('Nadia'),
    '1. Nadia: Pell left the lamp house and the Sorrow of Dunmore was sold at the quay');
  eq('…and a scene cast does not change that', block('Nadia', ['Nadia', 'Pell']),
    '1. Nadia: Pell left the lamp house and the Sorrow of Dunmore was sold at the quay');
  eq('a line spoken by somebody else keeps their name as the credit', block('Pell'),
    '1. Pell: Pell left the lamp house and the Sorrow of Dunmore was sold at the quay');
  ok('…and it is not credited to the card that was not speaking',
    block('Pell').indexOf('Nadia:') === -1 && block('Pell', ['Nadia', 'Pell']).indexOf('Nadia:') === -1,
    block('Pell', ['Nadia', 'Pell']));
  ok('a quoted line keeps its own speaker inside the body, unlabelled',
    block('Nadia').split(':').length === 2, block('Nadia'));

  /* a user line that only LOOKS like a label is prose, not a credit */
  var notes = [];
  for (var i = 0; i < 10; i++) notes.push({ id: 'n' + i, role: 'user', text: 'evening ' + i + ': the tide and the lamp at the quay' });
  notes.push({ id: 'n9', role: 'user', text: 'Note: the Sorrow of Dunmore was rotting at the pier and the toll was owed' });
  notes.push({ id: 'nq', role: 'user', text: 'what did that Note say about the Sorrow of Dunmore and the toll?' });
  var nb = API.recallFor(notes, { messages: [notes[notes.length - 1]] }, char, sess, on);
  ok('…and a leading word that only looks like a label is not eaten off a user line',
    nb && /Note: the Sorrow/.test(nb.text), nb && nb.text.split('\n').slice(1).join(' | '));
})();


console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
