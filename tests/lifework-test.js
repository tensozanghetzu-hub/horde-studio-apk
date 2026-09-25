/* 18.2.0 alignment — the parts that moved to the phone.
 *
 *  1. Foreground vs background: autonomous virtual-human outreach must be
 *     BACKGROUND work — it may not claim the chat's busy flag, may not show
 *     the "working…" indicator, and may not block the player's own sends.
 *     A manual nudge is user-initiated and keeps the foreground flag.
 *     Slots are per-character, and every path — success, failure, early
 *     bail — gives the slot back (the 1.8.3 no-stuck-dots guarantee,
 *     extended to the life slot).
 *  2. Stable transcript: a mid-thread re-render (delete/edit) must restore
 *     the reader's position, anchored on the message in view — with the
 *     predecessor standing in when that message was the one deleted.
 *     Fresh opens still land on the last message.
 *  3. 18.2.0 storage: read-only storage report (pure, unit-tested) and the
 *     image-normalizer math (downscale target, transparency-aware format).
 *
 *   node /home/user/tests/lifework-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var APP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function settle() { return new Promise(function (r) { setImmediate(r); }); }

/* ============================ app.js world ============================ */

function freshWorld(overrides) {
  overrides = overrides || {};
  var calls = { gen: 0, save: [], spend: 0, toasts: [], replyGen: 0, add: [] };
  var gate = { queued: [] };
  var charA = Object.assign({ id: 'cA', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: false, spend: { day: 'x', used: 0, cap: 5 } } }, overrides.charA || {});
  var charB = Object.assign({ id: 'cB', name: 'Milo', avatar: null, systemPrompt: '', vh: { enabled: false, spend: { day: 'x', used: 0, cap: 5 } } }, overrides.charB || {});
  var sessionA = { id: 'sA', charId: 'cA', pending: null };
  var sessionB = { id: 'sB', charId: 'cB', pending: null };

  var typingEl = { hidden: false };
  var inputEl = { value: '', style: {} };

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setInterval: function () { return 0; }, clearInterval: function () {},
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      toast: function (t) { calls.toasts.push(t); },
      confirm: function () { return Promise.resolve(true); },
      uid: function (p) { return p + '-' + Math.random().toString(36).slice(2, 8); }
    },
    Store: {
      settings: { provider: 'horde', hordeKey: '0000000000', userName: 'Sam', maxTokens: 300, temperature: 0.8, stripThinking: true },
      characters: [charA, charB],
      getSessions: function (id) { return Promise.resolve(id === 'cA' ? [sessionA] : [sessionB]); },
      getMessages: function () { return Promise.resolve([{ id: 'm1', role: 'user', text: 'earlier', createdAt: 1 }]); },
      addMessage: function (m) { calls.add.push(m); return Promise.resolve(Object.assign({ id: 'u' + (calls.add.length + 1) }, m)); },
      putSession: function (s) { return Promise.resolve(s); },
      putCharacter: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    Views: {
      thread: function () {},
      appendMessage: function () { return {}; },
      stickToBottom: function () {},
      chats: function () {}
    },
    VH: {
      ensure: function (c) { return c.vh; },
      perm: function () { return true; },
      canSpend: function () { return overrides.canSpend !== false; },
      outreachPrompt: function () { return 'PROMPT'; },
      contextLine: function () { return 'CTX'; },
      spendOne: function () { calls.spend++; },
      feedAdd: function () {},
      noteReply: function () {},
      noteContact: function () {},
      replyDelay: function () { return 0; },
      isAsleep: function () { return false; }
    },
    API: {
      generateFree: function (opts) {
        calls.gen++;
        gate.lastOpts = opts;
        return new Promise(function (res, rej) { gate.queued.push({ res: res, rej: rej }); });
      },
      stripThinking: function (t) { return t; },
      cleanReply: function (t) { return t; },
      splitBurst: function (t) { return [t]; },
      generateText: function () { return Promise.resolve('x'); },
      generateImage: function () { return Promise.resolve('x'); }
    },
    HW: { all: function () { return Promise.resolve([]); }, allRuns: function () { return Promise.resolve([]); }, bundled: function () { return Promise.resolve([]); } },
    document: {
      querySelector: function (sel) {
        if (sel === '#typing') return typingEl;
        if (sel === '#input') return inputEl;
        return null;
      },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(APP_SRC, 'utf8'), sandbox, { filename: 'app.js' });

  /* the real generateReply claims the busy flag on entry — the stub
     mirrors that so "busy came from the send" is testable */
  sandbox.App.generateReply = function () { calls.replyGen++; sandbox.App.state.busy = true; return Promise.resolve(); };
  var realSave = sandbox.App.saveAutonomous;
  sandbox.App.saveAutonomous = function (c, s, t, opts) {
    calls.save.push(opts || {});
    return realSave.apply(sandbox.App, arguments);
  };
  sandbox.App.state = {
    screen: 'chat', char: charA, session: sessionA, messages: [],
    busy: false, bursting: false, lifeBusy: {}
  };
  return {
    App: sandbox.App, calls: calls, typing: typingEl, input: inputEl,
    charA: charA, charB: charB, sessionA: sessionA, sessionB: sessionB,
    release: function (text) { var p = gate.queued.shift(); if (p) p.res(text); },
    rejectWith: function (msg) { var p = gate.queued.shift(); if (p) p.rej(new Error(msg)); }
  };
}

/* ==================== 1. background vs foreground ===================== */

(async function main() {
  console.log('\nautonomous outreach is background work');

  var w = freshWorld();
  w.App.vhOutreach(w.charA, false);           // autonomous
  await settle();
  ok('the life slot is claimed for the character', w.App.state.lifeBusy.cA === true);
  ok('the chat is NOT busy — the player is not blocked', w.App.state.busy === false);
  ok('no "typing…" banner (genInfo unset)', !w.App.genInfo, JSON.stringify(w.App.genInfo));
  w.App.renderTyping(); /* the indicator's own verdict, mid-life-work */
  ok('the working indicator stays off', w.typing.hidden === true);

  /* the crux of 18.2.0: the player sends their own message mid-outreach */
  w.input.value = 'hey, are you there?';
  w.App.send();
  await settle();
  ok('a send during autonomous life work goes through', w.calls.replyGen === 1 && w.calls.add.length === 1);
  ok('the chat busy flag came from the SEND, not the life', w.App.state.busy === true);

  w.release('Hey! I just got back.');
  await settle(); await settle(); await settle();
  ok('the life slot is given back on success', w.App.state.lifeBusy.cA === undefined);
  ok('the autonomous message is saved as autonomous', w.calls.save.length === 1 && w.calls.save[0].manual === false);
  ok('autonomous activity spent the daily budget', w.calls.spend === 1);

  console.log('\nmanual nudges stay foreground');

  var w2 = freshWorld();
  w2.App.vhOutreach(w2.charA, true);          // forced / nudge
  await settle();
  ok('nudge claims the life slot AND the chat busy flag', w2.App.state.lifeBusy.cA === true && w2.App.state.busy === true);
  ok('nudge shows the "typing…" banner', w2.App.genInfo !== null && /Sera is typing/.test(w2.App.genInfo.text));
  ok('nudge shows the working indicator', w2.typing.hidden === false);

  w2.release('There you are.');
  await settle(); await settle(); await settle();
  ok('nudge cleanup: busy cleared, banner gone, slot released',
    w2.App.state.busy === false && !w2.App.genInfo && w2.App.state.lifeBusy.cA === undefined);
  ok('a manual nudge does not spend the daily budget', w2.calls.spend === 0);

  console.log('\nslot rules');

  var w3 = freshWorld();
  w3.App.vhOutreach(w3.charA, false);
  await settle();
  w3.App.vhOutreach(w3.charA, false);
  await settle();
  ok('the same character cannot double-generate', w3.calls.gen === 1);

  w3.App.vhOutreach(w3.charB, false);
  await settle();
  ok('a different character may run life work at the same time', w3.calls.gen === 2 && w3.App.state.lifeBusy.cB === true);
  w3.release('from A');
  await settle();
  ok('A finishing does not release B\'s slot', w3.App.state.lifeBusy.cA === undefined && w3.App.state.lifeBusy.cB === true);
  w3.release('from B');
  await settle(); await settle(); await settle();
  ok('both slots are released', Object.keys(w3.App.state.lifeBusy).length === 0);

  console.log('\nfailures give the slot back (no stuck life work)');

  var w4 = freshWorld();
  w4.App.vhOutreach(w4.charA, false);
  await settle();
  w4.rejectWith('the model came back empty');
  await settle(); await settle();
  ok('failed autonomous outreach releases its slot', w4.App.state.lifeBusy.cA === undefined);
  ok('failed autonomous outreach never claimed the chat', w4.App.state.busy === false);
  ok('failure is surfaced, nothing saved', w4.calls.toasts.length === 1 && w4.calls.save.length === 0);

  var w5 = freshWorld();
  w5.App.vhOutreach(w5.charA, true);
  await settle();
  w5.rejectWith('boom');
  await settle(); await settle();
  ok('failed manual nudge: busy cleared, banner gone, slot released',
    w5.App.state.busy === false && !w5.App.genInfo && w5.App.state.lifeBusy.cA === undefined);

  /* ============= 2. storage report (pure) & image math ============= */

  console.log('\nstorage report');

  /* 'hello there' (11 chars → 22 B) + 'art' (3 → 6 B) = 28 B of text.
     image base64 4000 chars → 3000 B. avatar base64 1000 chars → 750 B.
     worlds: 62 + 64 = 126 B. Total 3904. */
  var rep = w.App.storageReport({
    characters: [{ avatar: 'data:image/png;base64,' + ('x'.repeat(1000)) }, { avatar: null }],
    sessions: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    messages: [
      { text: 'hello there', image: null },
      { text: 'art', image: 'data:image/jpeg;base64,' + ('y'.repeat(4000)) }
    ],
    worlds: [{ name: 'W1', data: 'abcd' }, 'broken-but-stringifiable']
  });
  ok('conversations line: chats, messages, UTF-16 text weight', rep.lines[0][1] === '3 chats · 2 messages · ~1 KB', rep.lines[0][1]);
  ok('avatars weighed as real bytes (base64 × 3/4)', rep.lines[1][1] === '~1 KB across 2 characters', rep.lines[1][1]);
  ok('chat images weighed as real bytes', rep.lines[2][1] === '~3 KB', rep.lines[2][1]);
  ok('worlds counted and weighed', rep.lines[3][1] === '2 installed · ~1 KB', rep.lines[3][1]);
  /* 28 (text) + 3017 (image base64 incl. prefix) + 767 (avatar incl. prefix)
     + 54 + 52 (worlds) = 3918 */
  ok('total is the sum of the parts', rep.bytes === 3918, String(rep.bytes));

  var empty = w.App.storageReport({});
  ok('an empty app reports empty, not broken',
    empty.bytes === 0 && empty.lines[0][1] === '0 chats · 0 messages · ~0 KB' && /0 installed/.test(empty.lines[3][1]),
    JSON.stringify(empty.lines));

  var big = w.App.storageReport({
    characters: [], sessions: [{ id: 's' }],
    messages: [{ text: 'z'.repeat(2 * 1024 * 1024) }], worlds: []
  });
  ok('a 4 MB text mass is reported in MB', /· ~4.0 MB$/.test(big.lines[0][1]), big.lines[0][1]);

  console.log('\nimage normalization math');

  var V = viewsWorld();
  var t = V.Views.imageTargetSize(4032, 3024);
  ok('a 12 MP landscape photo lands at 512 long edge', t.w === 512 && t.h === 384, JSON.stringify(t));
  t = V.Views.imageTargetSize(3024, 4032);
  ok('a 12 MP portrait photo lands at 512 long edge', t.w === 384 && t.h === 512, JSON.stringify(t));
  t = V.Views.imageTargetSize(300, 200);
  ok('a small image is not upscaled', t.w === 300 && t.h === 200, JSON.stringify(t));
  t = V.Views.imageTargetSize(4000, 4000, 256);
  ok('a custom max edge is honored', t.w === 256 && t.h === 256, JSON.stringify(t));
  ok('opaque images re-encode as JPEG', V.Views.imageMime(false) === 'image/jpeg');
  ok('transparency is kept as PNG', V.Views.imageMime(true) === 'image/png');

  /* ================= 3. scroll anchor on re-render =================== */

  console.log('\nmid-thread re-renders keep the reader');

  function child(mid, top) {
    return {
      mid: mid, offsetTop: top, offsetHeight: 300,
      getAttribute: function (n) { return n === 'data-mid' ? this.mid : null; }
    };
  }
  function layout(drop) {
    var out = [];
    for (var i = 1; i <= 10; i++) if (i !== drop) out.push(child('m' + i, (i - 1) * 300));
    return out;
  }

  function anchoredThread(pre, post) {
    var th = {
      scrollTop: 0, clientHeight: 500,
      querySelectorAll: function () { return []; },
      appendChild: function () {}
    };
    th.children = pre;
    Object.defineProperty(th, 'scrollHeight', { get: function () { return 5000; } });
    Object.defineProperty(th, 'innerHTML', {
      get: function () { return th._h || ''; },
      set: function (h) { th._h = h; th.children = post; }
    });
    th.querySelector = function (sel) {
      var m = sel.match(/^\[data-mid="(.+)"\]$/);
      if (!m) return null;
      for (var i = 0; i < th.children.length; i++) if (th.children[i].mid === m[1]) return th.children[i];
      return null;
    };
    V.sandbox.document.querySelector = function (sel) { return sel === '#thread' ? th : null; };
    return th;
  }

  var pre = layout(null);

  var th = anchoredThread(pre, layout(null));
  th.scrollTop = 1050;                      /* mid-line of m4 (top 900) */
  V.Views.thread(V.char, null, V.msgs, null, false);
  ok('anchor re-render restores the exact position (mid-line kept)', th.scrollTop === 750, 'scrollTop=' + th.scrollTop);

  th = anchoredThread(pre, layout(4));      /* m4 was the deleted message */
  th.scrollTop = 950;                        /* inside m4 (top 900) */
  V.Views.thread(V.char, null, V.msgs, null, false);
  ok('deleted anchor → the predecessor stands in (lands at its top)', th.scrollTop === 600, 'scrollTop=' + th.scrollTop);

  th = anchoredThread(pre, layout(4));
  th.scrollTop = 400;                        /* inside m2 (top 300, depth 100) */
  V.Views.thread(V.char, null, V.msgs, null, false);
  ok('an untouched anchor message still pins the view (depth kept)', th.scrollTop === 200, 'scrollTop=' + th.scrollTop);

  th = anchoredThread(pre, layout(null));
  th.scrollTop = 1050;
  V.Views.thread(V.char, null, V.msgs, null, true);   /* a fresh OPEN */
  ok('a fresh open still lands on the last message', th.scrollTop === 5000, 'scrollTop=' + th.scrollTop);

  th = anchoredThread(pre, layout(null));
  th.scrollTop = 4500;                       /* near the bottom */
  V.Views.thread(V.char, null, V.msgs, null, false);
  ok('near-bottom re-renders still follow the content (v1.8.2 rule)', th.scrollTop === 5000, 'scrollTop=' + th.scrollTop);

  /* the pure helpers, directly */
  var anch = V.Views.threadAnchor(pre, 900);
  ok('anchor picks the first message in view, with depth and predecessor',
    anch && anch.mid === 'm4' && anch.dy === 0 && anch.prev === 'm3', JSON.stringify(anch));
  anch = V.Views.threadAnchor(pre, 1199);
  ok('anchor depth is measured to the pixel', anch && anch.mid === 'm4' && anch.dy === 299, JSON.stringify(anch));
  anch = V.Views.threadAnchor(pre, 10 * 300 + 5);
  ok('scrolled past the last message → no anchor (stick-to-bottom rules)', anch === null);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });

/* ---- views.js world for the pure helpers (loaded lazily, sync) ------- */

var _views = null;
function viewsWorld() {
  if (_views) return _views;
  var thread = {
    innerHTML: '', scrollTop: 0, clientHeight: 500,
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(thread, 'scrollHeight', { get: function () { return this.innerHTML ? 5000 : 0; } });
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    fetch: function () { return Promise.resolve({ ok: false }); },
    UI: {
      esc: function (s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      md: function (s) { return String(s || ''); },
      icon: function (name) { return '<svg data-icon="' + name + '"></svg>'; }
    },
    Store: { settings: { userName: 'Tester' } },
    document: {
      querySelector: function (sel) { return sel === '#thread' ? thread : null; },
      querySelectorAll: function () { return []; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  _views = {
    sandbox: sandbox,
    Views: sandbox.Views,
    char: { id: 'c1', name: 'Vera', avatar: null, systemPrompt: '' },
    msgs: [{ sessionId: 's1', id: 'm1', role: 'user', text: 'hello', createdAt: 1 },
      { sessionId: 's1', id: 'm2', role: 'assistant', text: 'hi', createdAt: 2 }]
  };
  return _views;
}
