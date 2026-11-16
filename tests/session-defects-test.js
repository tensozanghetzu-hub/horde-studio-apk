#!/usr/bin/env node
/* The four defects reported from an 11-turn session on a three-speaker card.
 *
 * 1. A model refusal was stored as the memory summary — and past the history
 *    budget that summary is the only record of the past.
 * 2. The OOC rule asked for a line the cleanup then deleted as "thinking".
 * 3. `castRev` never invalidated when the CARD changed.
 * 4. Every reply was labelled with the card's name, in the prompt, the export
 *    and the summariser — so Aston's dialogue reached the model as Sloane's.
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}
function loadApi() {
  var mem = {};
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    setTimeout: function () { },
    localStorage: { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' },
    fetch: function () { return Promise.reject(new Error('offline')); }
  };
  sb.window = sb;
  vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();

var char = { id: 'c1', name: 'Sloane', persona: 'p', greeting: 'g', scenario: '', examples: '' };
var session = { sceneCast: ['Sloane', 'Aston', 'Mara'], scenePresent: ['Sloane', 'Aston', 'Mara'] };

/* ------------------------------------------------------------------ */
console.log('1. a refusal is not a summary');

var refusal = 'No transcript was provided, so there is no roleplay content to summarize or extract facts from.';
var r = API.parseMemory(refusal);
same('the refusal is rejected', r.summary, '');
same('…and the caller is told it failed', r.ok, false);

['I cannot summarize this without the transcript.',
 "I'm unable to extract facts from the material provided.",
 'There is no conversation here to summarize.',
 'As an AI, I am not able to continue this task.'
].forEach(function (t) {
  same('refused: "' + t.slice(0, 28) + '…"', API.parseMemory(t).summary, '');
});

var good = '{"summary":"Aston and Sloane move in. Mara resents the decision but concedes the second guest room. Sloane is quiet and grateful.","facts":["Aston is Sloane\'s father","Sloane works at Hot Topic"]}';
var g = API.parseMemory(good);
ok('a real JSON answer is kept', g.summary.indexOf('second guest room') !== -1, g.summary);
same('…and marked usable', g.ok, true);
same('…with its facts', g.facts.length, 2);

var fenced = '```json\n' + good + '\n```';
ok('markdown fences are tolerated', API.parseMemory(fenced).summary.indexOf('second guest room') !== -1);

var prose = 'Aston and Sloane have moved into the spare rooms after his shop closed. Mara dislikes the surprise but is coming around. Sloane has a job at the mall.';
same('a plain prose summary is still accepted', API.parseMemory(prose).summary.length > 40, true);
same('…and marked usable', API.parseMemory(prose).ok, true);
same('a stub of a summary is rejected', API.parseMemory('Okay.').summary, '');
same('broken JSON is not stored as prose', API.parseMemory('{"summary": "unfinished').summary, '');

console.log('\nthe transcript travels in the user turn');
ok('the summariser builds a system message of rules',
  /var rules = instruction;/.test(apiSrc));
ok('…and a user message holding the transcript',
  /content: 'Transcript:\\n' \+ convo/.test(apiSrc));
ok('the old "Return the JSON now." to nobody is gone',
  !/content: 'Return the JSON now\.' \}/.test(apiSrc));
ok('the JSON request rides with the transcript',
  /Return the JSON now\.' \}/.test(apiSrc));
ok('the caller writes nothing on failure',
  /if \(!mem \|\| !mem\.summary \|\| mem\.ok === false\)/.test(appSrc));
ok('…and says so', /Memory not updated: ' \+ App\.lastMemoryFailure\.reason/.test(appSrc));

/* ------------------------------------------------------------------ */
console.log('\n2. the OOC answer survives the cleanup');
same('an [ooc] line is not planning', API.isMetaLine('[ooc] She is asking you, not Mara.'), false);
same('…nor a (ooc) line', API.isMetaLine('(OOC) She means you.'), false);
same('…nor a plain OOC: line', API.isMetaLine('OOC: she is asking you.'), false);
same('[note] is still planning', API.isMetaLine('[note] keep the tone light'), true);
same('[meta] is still planning', API.isMetaLine('[meta] check the card'), true);

var oocReply = '[ooc] She is asking you, not Mara.\n\n*Sloane glances at the doorway, then back at you.*\n\n"Dad does not know it."';
var kept = API.stripThinking(oocReply, true);
ok('a reply that opens with an OOC answer keeps that answer',
  kept.indexOf('She is asking you, not Mara') !== -1, kept);

console.log('\na character can still leave a note');
var noteReply = 'Note: I fed the cat.\n\n*Mara sets the paper on the counter and leaves.*\n\n"She will find it when she gets home tonight."';
ok('a bare "Note:" scene beat is not planning',
  API.isMetaLine('Note: I fed the cat.') === false);
ok('…and survives stripping', API.stripThinking(noteReply, true).indexOf('I fed the cat') !== -1);

ok('the rule asks for the answer first', /step out of the character and answer it first/.test(apiSrc));
ok('…prefixed so it can be seen as an aside', /begins with "OOC:"/.test(apiSrc));
ok('…and forbids answering only through the fiction',
  /Never answer an OOC question only through the fiction/.test(
    API.buildChat(char, session, [], { userName: 'Blu', systemPrompt: 'x', maxTokens: 600 })[0].content));

/* ------------------------------------------------------------------ */
console.log('\n3. editing the card invalidates the cast');
var fpStart = appSrc.indexOf('  App.castFingerprint = function (char) {');
var fpEnd = appSrc.indexOf('\n  };', fpStart) + 4;
ok('a fingerprint function exists', fpStart > 0 && fpEnd > fpStart);
var sbApp = { App: {}, console: console };
vm.runInNewContext(appSrc.slice(fpStart, fpEnd) + '\nthis.App = App;', sbApp, { filename: 'castFingerprint.js' });
var fp = sbApp.App.castFingerprint;
var cardA = { name: 'Sloane', persona: 'Name: Aston\nAge: 42', greeting: 'Hi.', scenario: '', examples: '' };
var cardB = { name: 'Sloane', persona: 'Name: Aston\nAge: 43', greeting: 'Hi.', scenario: '', examples: '' };
ok('the same card gives the same fingerprint', fp(cardA) === fp(cardA));
ok('a renamed character changes it', fp(cardA) !== fp(cardB));
ok('adding a Cast section changes it',
  fp(cardA) !== fp({ name: 'Sloane', persona: cardA.persona + '\nCast\n- **Mara** — wife', greeting: 'Hi.', scenario: '', examples: '' }));
ok('an empty card does not throw', fp(null) === '');
ok('the re-detect compares the fingerprint', /session\.castFp !== fp/.test(appSrc));
ok('…and stores it', /session\.castFp = fp;/.test(appSrc));

/* ------------------------------------------------------------------ */
console.log('\n4. the reply is attributed to whoever spoke');
same('an Aston reply is Aston', API.splitSpeaker(char, session, 'Aston Ashworth: *He sets the box down.*').name, 'Aston');
ok('…and the redundant label is removed',
  API.splitSpeaker(char, session, 'Aston Ashworth: *He sets the box down.*').text.indexOf('Aston') === -1);
same('a cast name that is not the card name works', API.splitSpeaker(char, session, 'Mara: "Fine."').name, 'Mara');
same('the card\'s own reply falls back to the card', API.splitSpeaker(char, session, '*She nods.*').name, 'Sloane');
same('a doubled label is unwound', API.splitSpeaker(char, session, 'Sloane: Aston Ashworth: *He grins.*').name, 'Aston');
ok('…and both labels are gone',
  API.splitSpeaker(char, session, 'Sloane: Aston Ashworth: *He grins.*').text.indexOf('Sloane') === -1);
same('a non-cast label is not invented as a speaker',
  API.splitSpeaker(char, session, 'The Narrator: once upon a time.').name, 'Sloane');
same('with no cast, the card name is used', API.splitSpeaker(char, { sceneCast: [] }, 'Aston: hi').name, 'Sloane');

var single = { sceneCast: ['Sloane'] };
same('a redundant self-label is stripped on a one-name card',
  API.splitSpeaker(char, single, 'Sloane: *She nods.*').text, '*She nods.*');

var built = API.buildChat(char, session, [
  { role: 'user', text: 'Come in.' },
  { role: 'assistant', text: 'Aston Ashworth: *He grins.* "Thanks, buddy."' },
  { role: 'assistant', text: '*She nods.*' }
], { userName: 'Blu', systemPrompt: 'x', maxTokens: 600 });
var hist = built.filter(function (m) { return m.role !== 'system'; }).map(function (m) { return m.content; }).join('\n');
ok('the prompt labels Aston\'s line Aston', /Aston: \*He grins/.test(hist), hist.slice(0, 300));
ok('…and does not call the card Sloane twice', hist.indexOf('Sloane: Aston') === -1);
ok('the card\'s own unlabelled reply is still Sloane', /Sloane: \*She nods/.test(hist));
ok('the user\'s own line is never given a character name', /^Come in\.$/m.test(hist) && hist.indexOf('Aston: Come in') === -1);

var exportStart = appSrc.indexOf('App.exportTranscript = function');
var exportSrc = appSrc.slice(exportStart, appSrc.indexOf('\n  };', exportStart));
ok('the export uses the same speaker resolution', /API\.splitSpeaker\(c, s, m\.text/.test(exportSrc));
ok('the world log gets the transcript in the user turn too', /Transcript:\\n' \+ convo \+ '\\n\\nReturn the JSON now/.test(apiSrc));
ok('the summariser does too', /splitSpeaker\(char, session, body\)/.test(apiSrc));

/* ------------------------------------------------------------------ */
console.log('\na damaged memory is visible and can be cleared');
same('the refusal already stored is flagged', API.memoryLooksBroken(refusal), true);
same('an ordinary summary is not', API.memoryLooksBroken(prose), false);
same('an empty memory is not flagged', API.memoryLooksBroken(''), false);
same('a stub is flagged', API.memoryLooksBroken('Okay.'), true);
ok('the Memory sheet offers to clear it', /This memory does not read like a summary\./.test(appSrc));
ok('…and says why it happened', /Older versions stored whatever the model/.test(appSrc));
ok('…with a clear button that empties the summary', /#clearbad/.test(appSrc) && /body\.querySelector\('#sum'\)\.value = ''/.test(appSrc));

/* ------------------------------------------------------------------ */
/* v1.39.89 — the guard works, but a truncated answer is not a refusal. */
console.log('\na cut-off JSON answer is salvaged, not discarded');

var truncated = '{"summary":"Aston and Sloane have moved into the spare rooms. Mara dislikes the surprise but is coming around, and Sloane has started her job at the mall.","facts":["Aston is Sloane\'s father","Mara is the player\'s wife","Sloane works at Hot Topic","The second guest room is ';
var t = API.parseMemory(truncated);
ok('the summary survives a cut-off facts array',
  t.summary.indexOf('moved into the spare rooms') !== -1, t.summary);
same('…and the memory is usable', t.ok, true);
ok('…flagged as salvaged', t.salvaged === true);
same('only whole facts are kept', t.facts.length, 3);

var noFacts = '{"summary":"Aston and Sloane have moved in, and Mara is slowly thawing toward the idea of them staying."';
ok('a summary with no closing brace still parses',
  API.parseMemory(noFacts).summary.indexOf('slowing thawing') !== -1 ||
  API.parseMemory(noFacts).summary.indexOf('slowly thawing') !== -1);

console.log('\nevery rejection says why');
same('an empty reply says so', API.parseMemory('').reason, 'the model returned nothing');
same('a refusal is named', API.parseMemory(refusal).reason, 'the model refused');
same('unfinished JSON is named', API.parseMemory('{"summary": "some text but no close').reason,
  'the model returned unfinished JSON');
same('a stub is named', API.parseMemory('Okay.').reason, 'the answer was too short to be a summary');

console.log('\nthe attempt is retried once, asking for prose');
ok('the JSON attempt has a higher ceiling than the old 500',
  /max_tokens: 900/.test(apiSrc) && !/max_tokens: 500/.test(apiSrc));
ok('the fact count was trimmed to fit it', /Keep at most 8 facts/.test(apiSrc));
ok('a retry asks for plain sentences', /Write 3-6 plain sentences/.test(apiSrc));
ok('…with no JSON', /No JSON, no headings, no commentary/.test(apiSrc));
ok('…only if the first attempt failed', /var mem = parseMemory\(raw\);\s*if \(mem\.ok\) return mem;/.test(apiSrc));

console.log('\nthe failure is visible afterwards');
ok('the app records why memory failed', /App\.lastMemoryFailure = \{/.test(appSrc));
ok('…and the raw reply with it', /raw: \(mem && mem\.lastRaw\)/.test(appSrc));
ok('the toast names the reason', /'Memory not updated: ' \+ App\.lastMemoryFailure\.reason/.test(appSrc));
ok('the Memory sheet shows it', /The last memory attempt failed\./.test(appSrc));
ok('…and says nothing was overwritten', /Nothing was overwritten/.test(appSrc));

/* ------------------------------------------------------------------ */
/* v1.39.90 — the refusal test was eating honest summaries.
   It matched anywhere in the text: "there is no", "no conversation",
   "I can't". A perfectly good summary of a scene where nobody had agreed on
   the rent yet was thrown away as a model refusal — and the retry, saying
   something similar, was thrown away too. */
console.log('\nthe refusal test only fires when a refusal opens the answer');

var honest = '{"summary":"Aston and Sloane moved in. There is no agreement about the rent yet, and Mara is watching how long they really stay.","facts":["Aston has no job yet"]}';
var h = API.parseMemory(honest);
ok('a summary mentioning "there is no" is kept',
  h.summary.indexOf('no agreement about the rent') !== -1, h.summary);
same('…and is usable', h.ok, true);

var honestProse = 'There is no agreement about the rent yet, but Aston and Sloane have settled into the second room and Mara is thawing.';
ok('the same in prose is kept too', API.parseMemory(honestProse).ok, true);

var withCant = '{"summary":"Sloane cannot ask for anything outright, so she waits until Mara leaves the room. Aston says he cannot take another favour."}';
ok('"cannot" inside a summary is not a refusal',
  API.parseMemory(withCant).summary.indexOf('waits until Mara') !== -1);

['No transcript was provided, so there is no roleplay content to summarize.',
 'I cannot summarize this without the transcript.',
 "I'm unable to extract facts from this material.",
 'As an AI, I am not able to continue this task.',
 'There is no conversation here to summarize.',
 'The transcript was not provided.',
 'Nothing to summarize.'
].forEach(function (t) {
  same('still refused: "' + t.slice(0, 30) + '…"', API.parseMemory(t).summary, '');
  same('…and named', API.parseMemory(t).reason, 'the model refused');
});

console.log('\nboth attempts report, and the text is kept');
ok('the retry reason is appended', /\(retry: '/.test(apiSrc) || /' \(retry: ' \+/.test(apiSrc));
ok('a failed retry request is named', /the retry failed/.test(apiSrc));
ok('the first attempt is kept even if the retry throws', /mem\.lastRaw = String\(raw \|\| ''\)/.test(apiSrc));
ok('parsed JSON is only rejected for a short outright refusal',
  /MEMORY_REFUSAL\.test\(body\) && body\.length < 240/.test(apiSrc));

/* ------------------------------------------------------------------ */
/* v1.39.91 — the summariser sent the whole chat and got nothing back.
   It ignored the history budget entirely: up to 40 entire messages, which on
   a long chat is a request larger than a free route's window. A provider that
   cannot fit the prompt answers with an empty completion. */
console.log('\nthe summariser fits its request to the model');

function fakeEngine(replies) {
  var calls = [];
  var mem = {};
  var sb = {
    Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
    String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
    Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    atob: function (x) { return Buffer.from(String(x), 'base64').toString('binary'); },
    btoa: function (x) { return Buffer.from(String(x), 'binary').toString('base64'); },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' },
    fetch: function (url, opt) {
      calls.push(JSON.parse(opt.body));
      var text = replies[Math.min(calls.length - 1, replies.length - 1)];
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return 'application/json'; } },
        json: function () { return Promise.resolve({ choices: [{ message: { content: text } }] }); },
        text: function () { return Promise.resolve(JSON.stringify({ choices: [{ message: { content: text } }] })); }
      });
    }
  };
  sb.window = sb;
  vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
  return { API: sb.API, calls: calls };
}

var longHistory = [];
for (var hi = 0; hi < 60; hi++) {
  longHistory.push({ role: hi % 2 ? 'assistant' : 'user', text: 'Line ' + hi + ': ' + new Array(60).join('some ordinary words here ') });
}
var settings = {
  provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'test/free-model',
  userName: 'Blu', maxTokens: 600
};

(async function () {
  var e1 = fakeEngine(['{"summary":"Things happened and everyone is in the kitchen now."}']);
  var r1 = await e1.API.summarize({ settings: settings, character: { name: 'Sloane', persona: 'p' },
    session: { id: 's1', sceneCast: [] }, history: longHistory });
  same('a working model still produces a summary', r1.ok, true);
  ok('the request was capped, not sent whole', r1.sentMessages < 60, String(r1.sentMessages));
  ok('…and the cap is reported', r1.sentTokens > 0);
  same('the model is recorded with the result', r1.model, 'test/free-model');

  var e2 = fakeEngine(['', '', '']);
  var r2 = await e2.API.summarize({ settings: settings, character: { name: 'Sloane', persona: 'p' },
    session: { id: 's2', sceneCast: [] }, history: longHistory });
  same('an empty model is a failure, not a stored summary', r2.ok, false);
  same('…and is named as empty', r2.reason, 'the model returned nothing');
  same('three attempts were made', e2.calls.length, 3);
  ok('the third is much smaller than the first',
    JSON.stringify(e2.calls[2].messages).length < JSON.stringify(e2.calls[0].messages).length / 2);
  ok('the third turns reasoning off on OpenRouter',
    e2.calls[2].reasoning && e2.calls[2].reasoning.enabled === false);
  ok('every attempt keeps the JSON request out of the system turn',
    e2.calls.every(function (c) { return c.messages[0].role === 'system'; }));

  var e3 = fakeEngine(['', 'Aston and Sloane settled in; Mara is still deciding how she feels about it.']);
  var r3 = await e3.API.summarize({ settings: settings, character: { name: 'Sloane', persona: 'p' },
    session: { id: 's3', sceneCast: [] }, history: longHistory });
  same('a prose retry is accepted', r3.ok, true);
  ok('…and its text is the summary', r3.summary.indexOf('Mara is still deciding') !== -1);

  var e4 = fakeEngine(['', '', 'Sloane carried boxes; the treadmill is still on the landing.']);
  var r4 = await e4.API.summarize({ settings: settings, character: { name: 'Sloane', persona: 'p' },
    session: { id: 's4', sceneCast: [] }, history: longHistory });
  same('the tiny third attempt can rescue it', r4.ok, true);
  ok('…and is marked as the short path', r4.shortOf === true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
