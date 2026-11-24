#!/usr/bin/env node
/* v1.44.0 — the transcript ceiling is the user's, and the budget is what decides.
 *
 * `requestWindow(history, s)` took a settings argument and never read it: the
 * transcript was cut to LORE_SCAN_TURNS (6 turns ~ 12 messages) BEFORE
 * "Messages in context" (default 40, range 6..120) was applied, so that setting
 * could only ever lower the number, never raise it — a 160-message campaign
 * talked to a model that had seen 12 messages of it, and nothing on screen said
 * so. The lore scan having its own window is deliberate (v1.40.0 item 4c); the
 * transcript borrowing that number was the accident.
 *
 * Pinned here: the setting governs the transcript, the token budget governs how
 * big the transcript gets, the lore scan does NOT move with the setting, and the
 * numbers the prompt inspector prints are the ones the builder actually used —
 * recorded by the builder, not recomputed about it.
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) { ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want)); }

function loadApi() {
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    setTimeout: function () { },
    localStorage: { getItem: function () { return null; }, setItem: function () { } },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' },
    fetch: function () { return Promise.reject(new Error('offline')); }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var JS = ROOT;
var API = loadApi();

var CHAR = { id: 'c1', name: 'Vesna', persona: 'A harbinger.', scenario: '', examples: '', lorebook: [] };
function settings(extra) {
  return Object.assign({
    userName: 'You', systemPrompt: '', provider: 'openai', model: 'test/model',
    maxTokens: 400, temperature: 0.8, topP: 1, repPen: 1.1, streaming: false,
    contextMessages: 40
  }, extra || {});
}
/** `turns` player turns, each reply padded to `len` characters. */
function chat(turns, len) {
  var h = [];
  for (var i = 0; i < turns; i++) {
    h.push({ role: 'user', text: 'q' + i + ' ' + new Array(len + 1).join('x') });
    h.push({ role: 'assistant', text: 'a' + i + ' ' + new Array(len + 1).join('y') });
  }
  return h;
}
function transcript(msgs) {
  return msgs.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
}

console.log('\nthe setting governs the transcript');
API.resetAssembly();
same('nothing has been assembled yet', API.lastAssembly(), null);

var hist = chat(40, 100);                                     /* 80 messages */
var at40 = API.buildChat(CHAR, {}, hist, settings(), null);
var a40 = API.lastAssembly();
same('40 asked, 40 offered', transcript(at40).length, 40);
same('…and the builder says so', a40.sent, 40);
same('…having been handed 80', a40.available, 80);
same('…with nothing lost to the budget', a40.trimmedByBudget, 0);
same('the oldest message sent begins a turn', transcript(at40)[0].role, 'user');
same('…and it is the turn the ceiling landed on', /^q20\b/.test(transcript(at40)[0].content), true);

var at120 = API.buildChat(CHAR, {}, hist, settings({ contextMessages: 120 }), null);
same('120 asked, all 80 offered', transcript(at120).length, 80);
var at6 = API.buildChat(CHAR, {}, hist, settings({ contextMessages: 6 }), null);
same('6 asked, 6 offered — the setting still cuts downward', transcript(at6).length, 6);
same('…still from a turn boundary', transcript(at6)[0].role, 'user');
same('…still the newest ones', /a39/.test(transcript(at6)[transcript(at6).length - 1].content), true);

/* An unset ceiling is not "unbounded". trimHistory has always read `|| 40` there,
   and a preview that called it unbounded would be describing a request the
   builder never made — so both now read one function, and the record says which
   default stood in rather than hiding it. */
var unset = API.buildChat(CHAR, {}, hist, settings({ contextMessages: 0 }), null);
same('a zero setting falls back to the app default, the same number the budget pass uses',
  transcript(unset).length, 40);
same('…and the record names the ceiling that was in force', API.lastAssembly().messageCap, 40);
ok('…and says it was the default, not the user’s number',
  API.lastAssembly().ceilingIsDefault === true, JSON.stringify(API.lastAssembly().ceilingIsDefault));
API.buildChat(CHAR, {}, hist, settings({ contextMessages: 40 }), null);
ok('…while a setting the user actually wrote is not called a default',
  API.lastAssembly().ceilingIsDefault === false, JSON.stringify(API.lastAssembly().ceilingIsDefault));

console.log('\nthe history budget is still the one that decides');
var long = chat(40, 2000);                                     /* 80 messages, ~4 KB each */
var wide = API.buildChat(CHAR, {}, long, settings({ contextMessages: 120, historyTokens: 3000 }), null);
var aw = API.lastAssembly();
ok('a 120 ceiling with a 3 000-token budget sends far fewer than 120 messages',
  transcript(wide).length < 30, transcript(wide).length + ' sent');
same('…and the shortfall is attributed to the budget, not to the ceiling', aw.trimmedByBudget > 0, true);
same('…naming the budget it fitted to', aw.historyTokens, 3000);
ok('the transcript that survives is the NEWEST part of the chat',
  /a39/.test(transcript(wide)[transcript(wide).length - 1].content), true);
ok('the newest message you wrote is never the thing that gets cut',
  transcript(wide).length >= 4, transcript(wide).length);

console.log('\nthe lore scan keeps its own window');
var far = chat(20, 40);
far[2] = { role: 'user', text: 'the lighthouse lamp turns' };   /* 18 turns back */
var book = [{ keys: ['lighthouse'], content: 'LIGHTHOUSE-FACT-77' }];
var c2 = Object.assign({}, CHAR, { lorebook: book });
var narrow = API.buildChat(c2, {}, far, settings({ contextMessages: 120 }), null);
ok('a keyword outside the scan window does not fire, even though the transcript now carries it',
  narrow[0].content.indexOf('LIGHTHOUSE-FACT-77') === -1, 'the scan quietly widened with the transcript');
var widened = API.buildChat(Object.assign({}, c2, { loreScanTurns: 24 }), {}, far, settings({ contextMessages: 120 }), null);
ok('…and the per-character scan depth is what widens it',
  widened[0].content.indexOf('LIGHTHOUSE-FACT-77') !== -1, 'the documented knob does nothing');
same('raising the transcript ceiling did not change how many entries were admitted',
  narrow.filter(function (m) { return /LIGHTHOUSE/.test(m.content); }).length, 0);

console.log('\nan entry that matched but did not fit is named, with its reason');
var crowd = chat(3, 40);
crowd[crowd.length - 1] = { role: 'user', text: 'everyone says HELD' };
var twelve = [];
for (var t = 0; t < 12; t++) twelve.push({ keys: ['HELD'], content: 'fact ' + t });
API.buildChat(Object.assign({}, CHAR, { lorebook: twelve }), {}, crowd, settings({ contextMessages: 40 }), null);
var al = API.lastAssembly();
same('the ceiling admitted ten of twelve', al.lore.admitted, 10);
same('…and reported the two it turned away', al.lore.skipped.length, 2);
same('…naming why', al.lore.skipped[0].why, 'limit');
ok('…and which entry, so the Lore screen can be checked against it',
  al.lore.skipped.every(function (x) { return x.entry >= 0 && x.keys === 'HELD' && x.chars > 0; }),
  JSON.stringify(al.lore.skipped));

console.log('\nthe plain-text (Horde) shape reads the same setting');
var hp = API.buildPrompt(CHAR, {}, hist, settings({ provider: 'horde', contextMessages: 40 }), null, 40000);
var ah = API.lastAssembly();
same('the Horde prompt carries the 40 messages the user asked for', ah.sent, 40);
same('…from 80 available', ah.available, 80);
same('…shape recorded', ah.shape, 'prompt');
var hpTight = API.buildPrompt(CHAR, {}, hist, settings({ provider: 'horde', contextMessages: 40 }), null, 600);
var aht = API.lastAssembly();
/* The cap stops as soon as the prompt fits; the floor is only the point it can
   never go past. `sent === floor` would be a claim about where it landed, not
   about the promise the code makes. */
ok('a tiny token budget cuts the oldest turns and keeps the newest',
  aht.droppedByCap === aht.window - aht.sent && aht.sent > aht.floor,
  JSON.stringify({ window: aht.window, sent: aht.sent, dropped: aht.droppedByCap }));
ok('…and never below the floor it states', aht.sent >= aht.floor, JSON.stringify(aht.sent));
var hpTiny = API.buildPrompt(CHAR, {}, chat(30, 4000), settings({ provider: 'horde', contextMessages: 120 }), null, 20);
var ahp = API.lastAssembly();
same('…even when that means everything else goes', ahp.sent, ahp.floor);
ok('…and the record admits it went over rather than implying it fitted',
  ahp.overCap === true && ahp.bytes > ahp.cap, JSON.stringify([ahp.bytes, ahp.cap, ahp.overCap]));
API.buildChat(CHAR, {}, hist, settings({ contextMessages: 40 }), null);
ok('a chat that fits is not flagged as over cap', API.lastAssembly().overCap === false,
  JSON.stringify(API.lastAssembly().overCap));
ok('…and the prompt it built ends with the card speaking', /Vesna:$/.test(hpTight), hpTight.slice(-40));

console.log('\nwhat the inspector is told');
API.buildChat(CHAR, {}, hist, settings({ contextMessages: 12, historyTokens: 6000 }), null);
var seen = API.lastAssembly();
var live = API.buildChat(CHAR, {}, hist, settings({ contextMessages: 12, historyTokens: 6000 }), null);
same('the count it prints is the count on the wire', seen.sent, transcript(live).length);
same('…and the window is what the setting allowed', seen.window, 12);
ok('bytes are measured, not estimated', seen.bytes > 0 && seen.bytes <= seen.cap, JSON.stringify([seen.bytes, seen.cap]));
same('the reply budget is counted against the model window', seen.replyTokens, 400);

console.log('\nthe request body has one builder');
var s1 = settings({ replyFallback: 'a:free, b:free', reasoningOff: true, baseUrl: 'https://openrouter.ai/api/v1', model: 'nvidia/nemotron-3.5-nano:free', frequencyPenalty: 0.4 });
var plan = API.chatRequestPlan(s1, [{ role: 'user', content: 'hi' }], null);
same('the fallback chain rides the body', plan.body.models.length, 3);
same('…first the model asked for', plan.body.models[0], 'nvidia/nemotron-3.5-nano:free');
same('the reasoning guard is decided once and reported', plan.reasoningGuarded, true);
same('…and it is in the body the caller posts', plan.body.reasoning.enabled, false);
same('the stream flag the parser follows is the flag on the wire', plan.wantStream, plan.body.stream);
same('the repetition guard is sent only when set', plan.body.frequency_penalty, 0.4);
var plan2 = API.chatRequestPlan(settings({ baseUrl: 'https://my.host/v1', replyFallback: 'x:free' }), [{ role: 'user', content: 'hi' }], null);
ok('a non-OpenRouter host is not given the chain', plan2.body.models === undefined, JSON.stringify(plan2.body.models));
same('a caller override still wins over the guard', API.chatRequestPlan(s1, [], { stream: false }).body.stream, false);
/* A falsy non-boolean is the case that could split the two answers: without the
   one assignment, the wire would carry `stream: 0` while the parser believed it
   was not streaming. */
var odd = API.chatRequestPlan(settings({ streaming: true }), [], { stream: 0 });
same('a falsy stream override reaches the provider as a real false', odd.body.stream, false);
same('…and the parser is told the same thing', odd.wantStream, false);
var off = API.chatRequestPlan(settings({ streaming: false }), [], { stream: true });
same('…and an explicit true wins over a global off', off.body.stream, true);
same('…with the parser agreeing', off.wantStream, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
