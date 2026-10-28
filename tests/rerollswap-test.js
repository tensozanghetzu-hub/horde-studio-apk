/* rerollswap-test — reroll is an EDITION of one bubble, not a twin;
 * and since v1.39.28, Continue is a fresh bubble of its own.
 *
 * The original v1.39.12 bug: generateReply gave the target message a fresh
 * DOM node via appendMessage, so the thread held the same message twice —
 * the original bubble plus a clone that started as the old text and became
 * the new one. Cancel mid-generation and you were left with two identical
 * messages until a reload quietly erased the clone; on a provider error the
 * *stored* message was dropped while the stale bubble stayed on screen.
 *
 *   - reroll streams into the SAME bubble element; nothing is appended
 *   - the old text stays visible while the new one cooks; it swops on arrival
 *   - cancel restores the element to the original text (even mid-partial)
 *   - a provider failure keeps the message, keeps the bubble, keeps the text
 *   - a plain send still appends a fresh bubble
 *
 * v1.39.28 DELIBERATELY reverses "Continue rides the same in-place path":
 *   - Continue appends a NEW bubble {continuationOf: cutMsg} holding only
 *     the text that was missing; the cut original stays untouched
 *   - a genuinely split word ("rh" + "ythms") heals ACROSS the divide: the
 *     dangling fragment moves forward and opens the new bubble whole
 *   - reroll OF a continuation re-continues from the original cut seed and
 *     replaces the take in place (its alt strip grows by one)
 *   - the height seam follow (fromPx, v1.39.20) is retired: the threads of
 *     "continue = same bubble" no longer exist, followReply anchors simply
 *
 *   node /home/user/tests/rerollswap-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'app.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

var OLD = 'The first take. They set down the tea.';

function fresh(opts) {
  opts = opts || {};
  var char = { id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: false } };
  var session = { id: 's1', charId: 'c1', pending: null };
  var orig = { id: 'm-old', sessionId: 's1', role: 'assistant', text: OLD,
    alts: [OLD], altIdx: 0, createdAt: 50 };
  var messages = [
    { id: 'm-u', sessionId: 's1', role: 'user', text: 'Tell me.', createdAt: 10 },
    orig
  ];

  /* one element per message id; appendMessage invents new ones */
  function makeEl(mid) {
    var el = {
      mid: mid, mtext: { innerHTML: '' }, removed: false, streaming: false,
      classList: {
        add: function (c) { if (c === 'streaming') el.streaming = true; },
        remove: function (c) { if (c === 'streaming') el.streaming = false; }
      },
      querySelector: function (sel) { return sel === '.mtext' ? el.mtext : null; },
      remove: function () { el.removed = true; }
    };
    return el;
  }
  var existing = { 'm-old': makeEl('m-old') };
  existing['m-old'].mtext.innerHTML = OLD;   /* the rendered original bubble */
  var appended = [];

  var calls = { update: [], add: 0, append: 0, thread: 0, toasts: [], generate: null };

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setInterval: setInterval, clearInterval: clearInterval,
    AbortController: AbortController,
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      md: function (s) { return String(s || ''); },
      uid: function (p) { return p + '-new'; },
      toast: function (t) { calls.toasts.push(String(t)); },
      confirm: function () { return Promise.resolve(true); }
    },
    Store: {
      settings: { provider: 'horde', hordeKey: '0000000000', userName: 'Sam', maxTokens: 300, temperature: 0.8 },
      updateMessage: function (m) { calls.update.push(JSON.stringify(m)); return Promise.resolve(m); },
      addMessage: function (m) { calls.add++; return Promise.resolve(m); },
      putSession: function (s) { return Promise.resolve(s); },
      putCharacter: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    API: {
      generate: function (g) {
        if (opts.mode === 'abort') {
          if (opts.partial) g.onDelta(opts.partial, opts.partial);
          var e = new Error('stopped'); e.name = 'AbortError';
          return Promise.reject(e);
        }
        if (opts.mode === 'fail') return Promise.reject(new Error('provider down'));
        var text = opts.reply || 'The second take. She smiles.';
        /* v1.39.17: the real generate() returns a continue assembled around
           the seed — emulate that, and let the test see what it was fed */
        calls.generate = { continueFrom: g.continueFrom || null, history: g.history };
        if (g.continueFrom) text = g.continueFrom +
          (/[A-Za-z']$/.test(g.continueFrom) && /^[A-Za-z]/.test(text) ? '' : ' ') + text;
        g.onDelta(text, text);
        return Promise.resolve(text);
      },
      parseState: function () { return null; },
      stripState: function (t) { return t; },
      plainText: function (t) { return t; },
      splitBurst: function (t) { return [t]; }
    },
    IDB: { get: function () { return Promise.resolve({ id: 's1', title: 'T', charId: 'c1' }); } },
    Views: {
      thread: function () { calls.thread++; },
      appendMessage: function (c, m) { var el = makeEl(m.id); appended.push(el); calls.append++; return el; },
      stickToBottom: function () {},
      stateStrip: function () {}
    },
    VH: { noteContact: function () {}, ensure: function (c) { return c; } },
    document: {
      querySelector: function (sel) {
        if (sel === '#thread') return { scrollTop: 0 };
        var m = /data-mid="([^"]+)"/.exec(sel);
        if (m) return existing[m[1]] || null;
        return null;
      },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'app.js' });
  sandbox.App.setStop = function () {};
  sandbox.App.genStart = function () {};
  sandbox.App.genStop = function () {};
  sandbox.App.genSet = function () {};
  sandbox.App.renderTyping = function () {};
  sandbox.App.afterReply = function () { return Promise.resolve(); };
  sandbox.App.maybeAutoTitle = function () { return Promise.resolve(); };
  sandbox.App.state = { busy: false, char: char, session: session, messages: messages, screen: 'chat' };
  return {
    App: sandbox.App, orig: orig, existing: existing, appended: appended,
    calls: calls, messages: messages
  };
}

function fresh2(opts) { return new Promise(function (res) { res(fresh(opts)); }); }

(async function () {
  console.log('A — reroll success is an edition, not a twin');
  var w = fresh();
  var p = w.App.generateReply({ rerollFor: w.orig });
  await p; await new Promise(r => setTimeout(r, 25));
  ok('no second bubble is appended', w.calls.append === 0, 'append x' + w.calls.append);
  ok('the original element was reused', w.existing['m-old'].removed === false);
  ok('the element now shows the new take',
    w.existing['m-old'].mtext.innerHTML === 'The second take. She smiles.',
    JSON.stringify(w.existing['m-old'].mtext.innerHTML));
  ok('the stored message is one record, text replaced',
    w.messages.length === 2 && w.orig.text === 'The second take. She smiles.');
  ok('the old take kept as a swipe-back alt',
    w.orig.alts.length === 2 && w.orig.alts[0] === OLD && w.orig.altIdx === 1);
  ok('the save went through', w.calls.update.length >= 1 &&
    /second take/.test(w.calls.update[w.calls.update.length - 1]));

  console.log('B — cancel mid-reroll: original back in place, no duplicate');
  w = fresh({ mode: 'abort' });
  var elB = w.existing['m-old'];
  await w.App.generateReply({ rerollFor: w.orig });
  await new Promise(r => setTimeout(r, 25));
  ok('still exactly one message record', w.messages.length === 2);
  ok('the text is the original, not a partial', w.orig.text === OLD);
  ok('the bubble shows the original again', elB.mtext.innerHTML === OLD,
    JSON.stringify(elB.mtext.innerHTML));
  ok('nothing appended, nothing removed', w.calls.append === 0 && elB.removed === false);
  ok('streaming state lifted', elB.streaming === false);

  console.log('C — cancel AFTER new text started arriving: still the original');
  w = fresh({ mode: 'abort', partial: 'The second take begins…' });
  var elC = w.existing['m-old'];
  await w.App.generateReply({ rerollFor: w.orig });
  await new Promise(r => setTimeout(r, 25));
  ok('no partial new take survives in the record', w.orig.text === OLD);
  ok('the bubble loses the partial too', elC.mtext.innerHTML === OLD,
    JSON.stringify(elC.mtext.innerHTML));

  console.log('D — v1.39.28: Continue continues the cut text in a NEW bubble');
  w = fresh({ reply: 'An encore.' });
  await w.App.generateReply({ continueFor: w.orig });
  await new Promise(r => setTimeout(r, 25));
  ok('a new bubble is appended for the continuation', w.calls.append === 1, 'append x' + w.calls.append);
  ok('the app hands generate the seed text to continue from',
    w.calls.generate && w.calls.generate.continueFrom === OLD,
    JSON.stringify(w.calls.generate && w.calls.generate.continueFrom));
  ok('…and takes the cut message OUT of the context so it cannot echo itself',
    w.calls.generate && !w.calls.generate.history.some(function (m) { return m.id === 'm-old'; }));
  ok('the cut record is untouched — text and alts preserved', w.orig.text === OLD && w.orig.alts.length === 1 && w.orig.alts[0] === OLD);
  ok('the rendered cut bubble still wears its original text', w.existing['m-old'].mtext.innerHTML === OLD);
  var cont = w.messages[w.messages.length - 1];
  ok('a new record carries ONLY the continuation prose',
    w.messages.length === 3 && cont.text === 'An encore.',
    JSON.stringify(w.messages.map(function (m) { return m.text; })));
  ok('…remembering which cut message it grew from', cont.continuationOf === 'm-old');
  ok('the new bubble shows only the new prose', w.appended[0].mtext.innerHTML === 'An encore.',
    JSON.stringify(w.appended[0].mtext.innerHTML));
  ok('its alt strip starts at the continuation', cont.alts.length === 1 && cont.alts[0] === 'An encore.' && cont.altIdx === 0);

  console.log('D2 — rerolling that continuation re-continues, replacing the take in place');
  w.existing[cont.id] = w.appended[0];   /* register the continuation's bubble in the fake DOM */
  await w.App.generateReply({ rerollFor: cont });
  await new Promise(r => setTimeout(r, 25));
  ok('no extra bubble appears', w.calls.append === 1, 'append x' + w.calls.append);
  ok('it re-continues from the ORIGINAL cut seed',
    w.calls.generate.continueFrom === OLD, JSON.stringify(w.calls.generate.continueFrom));
  ok('…and history drops BOTH the source and the old take',
    !w.calls.generate.history.some(function (m) { return m.id === 'm-old' || m.id === cont.id; }));
  ok('the take swaps in place, swipe-back kept',
    cont.text === 'An encore.' && cont.alts.length === 2 && cont.altIdx === 1,
    JSON.stringify({ text: cont.text, alts: cont.alts }));

  console.log('D3 — a mid-word seam heals ACROSS the bubble divide');
  /* v1.39.28: the model continued "…unconnected rh" with "ythms…" (tight join) —
     the dangling fragment moves forward so neither bubble shows half a word */
  w = fresh({ reply: 'ythms that don\u2019t matter anymore.' });
  w.orig.text = 'Dormitory breathes around her in unconnected rh';
  w.orig.alts = [w.orig.text];
  await w.App.generateReply({ continueFor: w.orig });
  await new Promise(r => setTimeout(r, 25));
  var cont3 = w.messages[w.messages.length - 1];
  ok('the fragment left the cut bubble', w.orig.text === 'Dormitory breathes around her in unconnected', JSON.stringify(w.orig.text));
  ok('…and opens the new bubble whole', cont3.text === 'rhythms that don\u2019t matter anymore.', JSON.stringify(cont3.text));


  console.log('E — provider failure mid-reroll keeps the message whole');
  w = fresh({ mode: 'fail' });
  await w.App.generateReply({ rerollFor: w.orig });
  await new Promise(r => setTimeout(r, 25));
  ok('the message is NOT deleted from the ledger', w.messages.length === 2 &&
    w.messages[1].id === 'm-old', JSON.stringify(w.messages.map(m => m.id)));
  ok('its text is untouched', w.orig.text === OLD);
  ok('the bubble survives and shows the take', w.existing['m-old'].removed === false &&
    w.existing['m-old'].mtext.innerHTML === OLD);

  console.log('F — a plain send still appends a fresh bubble');
  w = fresh();
  await w.App.generateReply();
  await new Promise(r => setTimeout(r, 25));
  ok('appendMessage ran for the new reply', w.calls.append === 1, 'append x' + w.calls.append);
  ok('the assistant reply joined the ledger', w.messages.filter(m => m.role === 'assistant').length === 2);

  console.log('\nrerollswap-test: ' + (fail ? fail + ' FAILED, ' : '') + pass + ' ok');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
