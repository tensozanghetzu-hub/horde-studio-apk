#!/usr/bin/env node
/* v1.48.0 — coming back to them.

   Two switches, both off, and one count. The engine's rules for the count, the app's
   single choke point where an arrival is noticed, the three places a message can land
   without you looking, the background timer that the switches govern, and the four
   screens that have to tell the truth about all of it — each checked the way the
   failure would actually happen (TESTING.md, rule 1 and rule 2: break it and show the
   red, and render the view rather than grep it).

   Usage: node tests/vhuman-away-test.js
*/
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function settle(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 4); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  return p;
}

var BASE = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
  parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout, clearTimeout: clearTimeout,
  setImmediate: setImmediate, TextEncoder: TextEncoder, TextDecoder: TextDecoder
};

/* =============================== the engine =============================== */

var sess = { id: 's1', charId: 'cA' };
var msg = { id: 'm1', sessionId: 's1', role: 'assistant', text: 'Back soon.', createdAt: 1 };

function loadVH() {
  var sb = Object.assign({}, BASE, {
    document: { addEventListener: function () {} }, navigator: { userAgent: 'node' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} }
  });
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(read('vhuman.js'), sb, { filename: 'vhuman.js' });
  return sb.VH;
}
var VH = loadVH();
function life(over) {
  var c = { id: 'cA', name: 'Sera', avatar: null, persona: 'p', systemPrompt: '', examples: [], vh: null };
  VH.ensure(c);
  Object.assign(c.vh, over || {});
  return c;
}

console.log('\nA — the count, its rules, and what it can and cannot know');
(function () {
  var c = life();
  eq('a new life starts with nothing waiting', [c.vh.unread, c.vh.unreadAt, c.vh.seenAt], [0, 0, 0]);

  /* an old save: the fields are absent, and `ensure` is the whole migration */
  var old = { id: 'cOld', name: 'Milo', vh: { enabled: true, lastTick: 123, mood: 0.4 } };
  VH.ensure(old);
  eq('a life written before this release gains the fields without losing its mood',
    [old.vh.unread, old.vh.unreadAt, old.vh.seenAt, old.vh.mood, old.vh.lastTick], [0, 0, 0, 0.4, 123]);

  VH.arrived(c, 1);
  var first = c.vh.unreadAt;
  ok('one arrival is counted, and stamped', c.vh.unread === 1 && first > 0, JSON.stringify(c.vh));
  ok('…and the stamp is a real time', Math.abs(Date.now() - first) < 5000, String(first));
  /* the stamp is pinned by hand rather than compared across two Date.now() calls:
     on a fast machine those land in the same millisecond, and the check would pass
     against code that re-stamps on every arrival. */
  c.vh.unreadAt = 12345;
  VH.arrived(c, 1);
  eq('a second arrival adds to the count but does not move "since"',
    [c.vh.unread, c.vh.unreadAt], [2, 12345]);

  var z = life();
  VH.arrived(z, 0); VH.arrived(z, -4); VH.arrived(z, ''); VH.arrived(z, NaN);
  eq('nothing arrives on a count of zero, negative, blank or NaN', z.vh.unread, 0);
  VH.arrived(z, 1.7);
  eq('…a fractional count is floored, not rounded up', z.vh.unread, 1);
  VH.arrived(z, '3');
  eq('…and a string number still counts, because a caller may have built it', z.vh.unread, 4);
  VH.arrived(z);
  eq('…while no count at all means the one thing that just landed', z.vh.unread, 5);
  for (var i = 0; i < 2000; i++) VH.arrived(z, 1);
  eq('…and it is capped, so a broken caller cannot grow a number forever', z.vh.unread, 999);

  var had = VH.read(c);
  eq('marking them read clears both fields and stamps when you looked',
    [had, c.vh.unread, c.vh.unreadAt, c.vh.seenAt > 0], [true, 0, 0, true]);
  ok('…and it reports that something changed, so the caller writes the character', VH.read(c) === false);

  var fmt = function (ts) { return 'T'; };
  var q = life();
  eq('the line says nothing when nothing is waiting', [VH.unreadLine(q.vh, fmt), VH.unreadLine(null, fmt)], ['', '']);
  VH.arrived(q, 1);
  eq('one is singular, and carries the time of the first', VH.unreadLine(q.vh, fmt), '1 message since T');
  VH.arrived(q, 2);
  eq('three are plural', VH.unreadLine(q.vh, fmt), '3 messages since T');
  q.vh.unreadAt = 0;
  eq('…and the time is dropped rather than invented when it is not there', VH.unreadLine(q.vh, fmt), '3 messages');

  /* the marks are the publisher's, so a published human does not carry them */
  var withMarks = life({ unread: 4, unreadAt: 111, seenAt: 222, mood: 0.6, enabled: true });
  var tpl = VH.portable(withMarks).character.vh;
  eq('a template exports the life without the sender’s inbox or attention stamps',
    [tpl.unread, tpl.unreadAt, tpl.seenAt], [0, 0, 0]);
  ok('…and the life itself is still in there', tpl.mood === 0.6 && tpl.enabled === true,
    JSON.stringify({ mood: tpl.mood, enabled: tpl.enabled }));
  var full = VH.portable(life({ unread: 2, unreadAt: 5, seenAt: 6 }), [sess], [msg], true);
  eq('…a full export zeroes them too, because there is no reader on the other side yet',
    [full.character.vh.unread, full.character.vh.unreadAt, full.character.vh.seenAt], [0, 0, 0]);
  var adopted = VH.adopt(VH.portable(withMarks, [sess], [msg], true));
  eq('and adopting one starts the life with nothing waiting',
    [adopted.character.vh.unread, adopted.character.vh.unreadAt, adopted.character.vh.seenAt], [0, 0, 0]);
  ok('…without losing the messages that came with it', adopted.messages.length === 1, JSON.stringify(adopted.messages));
})();

/* ============================ the app world ============================ */

function makeDoc(hidden) {
  var nodes = {};
  function node(key) {
    if (nodes[key]) return nodes[key];
    var n = {
      key: key, hidden: true, innerHTML: '', textContent: '', value: '',
      style: { setProperty: function () {}, removeProperty: function () {} },
      handlers: {}, names: {},
      classList: {
        toggle: function (c, on) {
          /* the DOM's own rule: one argument flips it, two force it — and views.js
             uses both forms, so a stub that only honoured one would misreport the
             screen's state back to the test */
          if (arguments.length < 2) on = !n.names[c];
          if (on) n.names[c] = 1; else delete n.names[c];
        },
        add: function (c) { n.names[c] = 1; },
        remove: function (c) { delete n.names[c]; },
        contains: function (c) { return !!n.names[c]; }
      },
      addEventListener: function (ev, fn) { (n.handlers[ev] = n.handlers[ev] || []).push(fn); },
      querySelector: function (sel) { return node(String(sel).replace(/^[#.]/, '')); },
      querySelectorAll: function () { return []; },
      focus: function () {}, blur: function () {},
      setAttribute: function (k, v) { n[key + ':' + k] = v; },
      getAttribute: function (k) { return n[key + ':' + k]; },
      removeAttribute: function (k) { delete n[key + ':' + k]; },
      remove: function () {},
      click: function () { (n.handlers.click || []).forEach(function (f) { f({ currentTarget: n, target: n, preventDefault: function () {} }); }); }
    };
    nodes[key] = n;
    return n;
  }
  return {
    hidden: hidden,
    body: node('body'),
    querySelector: function (sel) { return node(String(sel).replace(/^[#.]/, '')); },
    getElementById: function (id) { return node(id); },
    querySelectorAll: function () { return []; },
    createElement: function () { return node('created-' + Math.random()); },
    documentElement: node('html'),
    addEventListener: function (ev, fn) { (nodes['@' + ev] = nodes['@' + ev] || []).push(fn); },
    removeEventListener: function () {},
    /* the test's own door: fire a document-level handler (visibilitychange) */
    fire: function (ev) { (nodes['@' + ev] || []).forEach(function (f) { f({}); }); },
    nodes: nodes
  };
}

function world(opts) {
  opts = opts || {};
  var calls = { add: [], putChar: 0, toasts: [], notes: [], notifies: [], lifeRenders: 0, feedRenders: 0 };
  var char = life(Object.assign({ enabled: true }, opts.vh));
  var session = { id: 'sA', charId: 'cA', pending: null };
  var settings = Object.assign({ userName: 'Sam', stripThinking: true, provider: 'horde' }, opts.settings || {});
  var hidden = !!opts.hidden;

  var sb = Object.assign({}, BASE, {
    setInterval: function (fn, ms) { sb.intervals.push({ fn: fn, ms: ms }); return 1; },
    clearInterval: function () {}, intervals: [],
    /* keyed nodes, not one throwaway: C and D assert on the HTML the shipped views
       wrote, and a stub that hands back a fresh object for every selector would let
       a screen write its answer somewhere nobody reads */
    document: makeDoc(hidden),
    UI: {
      esc: function (x) { return String(x == null ? '' : x); },
      md: function (x) { return String(x == null ? '' : x); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      fmtTime: function () { return '09:00'; },
      fmtDate: function () { return '24 Nov'; },
      toast: function (t) { calls.toasts.push(t); },
      confirm: function () { return Promise.resolve(true); },
      prompt: function () { return Promise.resolve(''); },
      uid: function (p) { return p + '-' + Math.random().toString(36).slice(2, 7); }
    },
    Store: {
      settings: settings,
      characters: [char],
      getSessions: function () { return Promise.resolve([session]); },
      getMessages: function () { return Promise.resolve([{ id: 'm0', role: 'user', text: 'earlier', createdAt: 1 }]); },
      addMessage: function (m) { calls.add.push(m); return Promise.resolve(Object.assign({ id: 'm' + calls.add.length }, m)); },
      putSession: function (s) { return Promise.resolve(s); },
      putCharacter: function () { calls.putChar++; return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([char]); },
      saveSettings: function (patch) { Object.assign(settings, patch); calls.notes.push(patch); },
      init: function () { return Promise.resolve(); },
      allSessions: function () { return Promise.resolve([session]); },
      /* the same object every time, so a mark cleared through openSession is
         visible on the character the test holds — which is the whole claim */
      getCharacter: function () { return Promise.resolve(char); }
    },
    Views: {
      thread: function () {}, appendMessage: function () { return {}; }, stickToBottom: function () {},
      chats: function () { calls.chatsRenders = (calls.chatsRenders || 0) + 1; },
      life: function () { calls.lifeRenders++; }, feed: function () { calls.feedRenders++; }
    },
    VH: VH,
    API: {
      generateFree: function () { return Promise.resolve('Back in a bit.'); },
      generate: function () { return Promise.resolve('Sorry I was slow.'); },
      stripThinking: function (t) { return t; },
      cleanReply: function (t) { return t; },
      splitBurst: function (t) { return String(t).split('\n\n'); },
      DEFAULT_MAX_TOKENS: 300, DEFAULT_HISTORY_TOKENS: 6000,
      estTokens: function (t) { return Math.ceil((t || '').length / 4); }
    },
    HW: { all: function () { return Promise.resolve([]); }, allRuns: function () { return Promise.resolve([]); }, bundled: function () { return Promise.resolve([]); } },
    IDB: {
      get: function () { return Promise.resolve(session); }, put: function () { return Promise.resolve(); },
      all: function () { return Promise.resolve([session]); },
      /* lifeTick reads sessions through IDB directly, not through Store */
      getAll: function () { return Promise.resolve([session]); }
    }
  });
  if (opts.notification === 'absent') { /* nothing to install */ }
  else {
    var perm = opts.notification || 'granted';
    sb.Notification = function (title, o) { calls.notifies.push({ title: title, o: o }); this.close = function () {}; };
    sb.Notification.permission = perm;
    sb.Notification.requestPermission = function () { return Promise.resolve(opts.askResult || perm); };
  }
  sb.window = sb; sb.global = sb;
  /* bindGlobal also listens on the window (install prompt, online/offline); the
     sandbox is the window, so it needs the two methods or the boot throws half-way */
  sb.addEventListener = function () {}; sb.removeEventListener = function () {};
  /* and the two globals the tail of bindGlobal reads: a file: location means the
     service worker block is skipped for the same reason it is on a phone opened
     from disk, rather than because the harness crashed on the way to it */
  sb.navigator = { userAgent: 'node', onLine: true, serviceWorker: undefined };
  sb.location = { protocol: 'file:', href: 'file:///index.html' };
  /* the boot handler applies the saved theme before it binds anything, so the real
     themes.js is loaded too rather than stubbed — it is 60 lines and it is what the
     phone runs */
  vm.runInNewContext(read('themes.js'), sb, { filename: 'themes.js' });
  if (opts.withViews) vm.runInNewContext(read('views.js'), sb, { filename: 'views.js' });
  vm.runInNewContext(read('app.js'), sb, { filename: 'app.js' });
  var App = sb.App;
  /* the harness's view of the app wins over whatever app.js booted with, because
     "their chat is the one on screen" IS the case under test */
  App.state = Object.assign({}, App.state || {}, {
    screen: opts.screen || 'chats', char: opts.chatOpen ? char : null,
    session: opts.chatOpen ? session : null, messages: [],
    busy: false, bursting: false, lifeBusy: {}
  });
  App.persistVH = function () { calls.putChar++; return Promise.resolve(); };
  App.deliverBurst = function (c, first, parts) { return Promise.resolve([first].concat(parts.slice(1))); };
  App.renderTyping = function () {};
  App.renderAttach = function () {};
  App.renderSceneCast = function () {};
  App.initSceneCast = function () {};
  App.renderGroupSpeaker = function () {};
  App.stopSpeech = function () {};
  return {
    App: App, sb: sb, calls: calls, char: char, session: session, settings: settings,
    doc: sb.document, html: function (sel) { return sb.document.querySelector(sel).innerHTML; },
    setHidden: function (v) { sb.document.hidden = v; },
    fire: function (ev) { sb.document.fire(ev); },
    tickIntervals: function () { sb.intervals.forEach(function (i) { i.fn(); }); }
  };
}

console.log('\nB — one place decides that you were not looking');
(async function () {
  var w = world({ screen: 'chat', chatOpen: true });
  await settle();
  w.App.vhArrived(w.char, 2, 'Sera sent you 2 messages');
  await settle();
  ok('an arrival is counted on the human', w.char.vh.unread === 2, JSON.stringify(w.char.vh));
  ok('…and the character is written back, so it survives a reload', w.calls.putChar >= 1, String(w.calls.putChar));
  ok('…and you are told, while the app is in front of you', w.calls.toasts.length === 1, JSON.stringify(w.calls.toasts));
  eq('…and no system notice is built for something you can see', w.calls.notifies.length, 0);

  var w2 = world({ hidden: true, notification: 'granted', settings: { notifyAway: true } });
  await settle();
  w2.App.vhArrived(w2.char, 1, 'Sera sent you a message');
  await settle();
  ok('while backgrounded, nothing toasts into a screen nobody is looking at', w2.calls.toasts.length === 0, JSON.stringify(w2.calls.toasts));
  eq('…but the notice goes to the person, tagged to them so a second message updates one',
    [w2.calls.notifies.length, w2.calls.notifies[0] && w2.calls.notifies[0].title, w2.calls.notifies[0] && w2.calls.notifies[0].o.tag],
    [1, 'Sera', 'horde-vh-cA']);
  ok('…and the count is what survives the notification either way', w2.char.vh.unread === 1, JSON.stringify(w2.char.vh));

  var w3 = world({ hidden: true, notification: 'granted' });
  await settle();
  w3.App.vhArrived(w3.char, 1, 'Sera sent you a message');
  await settle();
  eq('the switch off means no notice, and still a count waiting', [w3.calls.notifies.length, w3.char.vh.unread], [0, 1]);

  var w35 = world({ hidden: true, notification: 'default', settings: { notifyAway: true } });
  await settle();
  w35.App.vhArrived(w35.char, 1, 'Sera sent you a message');
  await settle();
  eq('the switch on but the permission not granted is a count, not a construct attempt',
    [w35.calls.notifies.length, w35.char.vh.unread], [0, 1]);

  var w4 = world({ hidden: true, notification: 'absent', settings: { notifyAway: true } });
  await settle();
  var threw = null;
  w4.sb.window.Notification = undefined;
  try { w4.App.vhArrived(w4.char, 1, 'x'); } catch (e) { threw = e; }
  await settle();
  ok('a platform with no Notification at all is a normal day, not an error', threw === null, String(threw));
  ok('…and the count is still the signal', w4.char.vh.unread === 1, JSON.stringify(w4.char.vh));

  var w5 = world({ hidden: true, notification: 'granted' });
  await settle();
  w5.sb.Notification = function () { throw new Error('no notifications in this webview'); };
  w5.sb.Notification.permission = 'granted';
  var threw2 = null;
  try { w5.App.notifyAway(w5.char, 'x'); } catch (e) { threw2 = e; }
  ok('a platform that throws on construct is caught, not surfaced', threw2 === null, String(threw2));

  /* ---- the three landing sites ---- */
  var s1 = world({ screen: 'chats' });
  await settle();
  await s1.App.saveAutonomous(s1.char, s1.session, 'One line.\n\nAnother line.', { manual: false }).catch(function () {});
  await settle(6);
  ok('a two-bubble burst counts as the two messages the chat holds', s1.char.vh.unread === 2, JSON.stringify(s1.char.vh.unread));

  var s2 = world({ screen: 'chat', chatOpen: true });
  await settle();
  await s2.App.saveAutonomous(s2.char, s2.session, 'Said while you were reading.', { manual: false }).catch(function () {});
  await settle(6);
  eq('while their chat is on screen, nothing is counted and nothing is announced',
    [s2.char.vh.unread, s2.calls.toasts.length], [0, 0]);

  var s3 = world({ screen: 'chats' });
  await settle();
  s3.session.pending = { askedAt: Date.now() - 600000, dueAt: 1, asleep: false };
  s3.App.deliverPending(s3.char, s3.session, true);
  await settle(8);
  ok('a reply that came due while you were away counts as an arrival', s3.char.vh.unread === 1, JSON.stringify(s3.char.vh.unread));
  ok('…and the message itself landed in the chat', s3.calls.add.length === 1, JSON.stringify(s3.calls.add.map(function (m) { return m.role; })));

  var s4 = world({ screen: 'chats' });
  await settle();
  s4.session.pending = { askedAt: Date.now(), dueAt: 1, asleep: false };
  s4.App.deliverPending(s4.char, s4.session, true);
  s4.App.state.screen = 'chat'; s4.App.state.session = s4.session; s4.App.state.char = s4.char;
  await settle(10);
  eq('…but not if you opened the chat while it was still being written', s4.char.vh.unread, 0);

  /* ---- opening the chat is the read receipt ---- */
  var r = world({ screen: 'chats' });
  await settle();
  r.App.vhArrived(r.char, 3, 'x');
  await settle(3);
  r.calls.putChar = 0;
  await r.App.openSession('sA').catch(function () {});
  await settle(8);
  ok('opening their chat clears the mark and stamps when you looked',
    r.char.vh.unread === 0 && r.char.vh.seenAt > 0, JSON.stringify(r.char.vh));

  var r2 = world({ screen: 'chats' });
  await settle();
  r2.calls.putChar = 0;
  await r2.App.openSession('sA').catch(function () {});
  await settle(6);
  eq('…and a chat with nothing waiting writes nothing', r2.calls.putChar, 0);
  return runScreens().then(function () {
    /* if a section stops existing, the count stops matching — a suite that prints
       no verdict at all is not a passing suite */
    /* the count as measured before this check is added, against the floor below:
       a section that stops being called would drop well under it. 70 is deliberately
       a floor and not the exact total, so adding a check here never "fixes" a
       missing section by moving the target. */
    ok('every section ran its checks', pass + fail >= 70, pass + fail + ' checks ran, expected at least 70');
    finish();
  });
})().catch(function (e) { ok('the release run completed', false, String((e && e.stack) || e)); finish(); });

function finish() {
  console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

async function runScreens() {
  await sectionC();
  await sectionD();
  await sectionE();
}

/* The rendered screens. Both are drawn by the shipped view functions against a stub
   document, because the whole point of this release is a claim a screen makes about
   what the engine did — and a grep of views.js cannot tell you that the string ever
   reached the page (TESTING.md, rule 2). */
async function sectionC() {
  console.log('\nC — the Life screen and the chat list, rendered');
  /* Milo is a living human with nothing waiting — the case that must stay quiet.
     A character with no life at all would be filtered out before a card was built,
     and the check would pass for the wrong reason. */
  var other = { id: 'cB', name: 'Milo', avatar: null, persona: 'p', systemPrompt: '', examples: [] };
  VH.ensure(other);
  other.vh.enabled = true;
  var plain = { id: 'cC', name: 'A card', avatar: null, persona: 'p', systemPrompt: '', examples: [] };
  var older = { id: 'sOld', charId: 'cA', pending: null };
  var w = world({ withViews: true, settings: { lifeWhileAway: false, regexScripts: [] } });
  await settle();
  w.char.vh.enabled = true;
  VH.arrived(w.char, 2);
  w.sb.Store.characters = [w.char, other, plain];
  var plainSession = { id: 'sC', charId: 'cC', pending: null };
  w.sb.Store.allSessions = function () { return Promise.resolve([w.session, older, plainSession]); };
  w.sb.Store.getSessions = function () { return Promise.resolve([w.session, older]); };

  w.sb.Views.life(w.doc.querySelector('#screen'));
  var lifeHtml = w.html('#now-body');
  ok('the screen says who has written, and how much, by name',
    /<b>1<\/b> person has written since you were last here: Sera \(2 messages since 09:00\)/.test(lifeHtml),
    lifeHtml.slice(0, 240));
  function cardOf(html, name) {
    var parts = String(html).split('class="vh-card"');
    for (var i = 1; i < parts.length; i++) {
      if (parts[i].indexOf('>' + name + '</div>') !== -1) return parts[i];
    }
    return '';
  }
  ok('their own card carries the arrival, above the calendar',
    /2 messages since 09:00<\/b> · open the chat/.test(cardOf(lifeHtml, 'Sera')), cardOf(lifeHtml, 'Sera').slice(0, 320));
  ok('…and a human with nothing waiting has no such line on their card',
    cardOf(lifeHtml, 'Milo') !== '' && !/open the chat/.test(cardOf(lifeHtml, 'Milo')),
    cardOf(lifeHtml, 'Milo').slice(0, 320));
  ok('with the away switch off, the same line says the day stops when the app does',
    /stops while the app is closed/.test(lifeHtml) &&
    /Settings → Generation can keep it running in the background/.test(lifeHtml), lifeHtml.slice(0, 300));

  w.doc.querySelectorAll = function () { return []; };
  await new Promise(function (r) { w.sb.Store.allSessions().then(function () { r(); }); });
  w.sb.Views.chats(w.doc.querySelector('#screen'));
  await settle(6);
  var chatsHtml = w.html('#chat-list');
  eq('the chat list marks the human’s newest session, once',
    (chatsHtml.match(/2 new<\/span>/g) || []).length, 1);
  function rowOf(html, name) {
    var parts = String(html).split('data-open="');
    for (var i = 1; i < parts.length; i++) {
      if (parts[i].indexOf('>' + name + ' <') !== -1) return parts[i];
    }
    return '';
  }
  ok('…and not the older chat of the same person',
    !/1 new/.test(chatsHtml) && rowOf(chatsHtml, 'Milo') === '', chatsHtml.slice(0, 240));
  ok('…nor a character that is not a virtual human at all',
    rowOf(chatsHtml, 'A card') !== '' && !/ new</.test(rowOf(chatsHtml, 'A card')),
    rowOf(chatsHtml, 'A card').slice(0, 240));

  VH.read(w.char);
  w.sb.Views.life(w.doc.querySelector('#screen'));
  ok('opening them, and re-rendering, takes the mark away in both places',
    w.html('#now-body').indexOf('open the chat') === -1, w.html('#now-body').slice(0, 200));
  w.sb.Views.chats(w.doc.querySelector('#screen'));
  await settle(6);
  ok('…and the chat list agrees', w.html('#chat-list').indexOf(' new<') === -1, w.html('#chat-list').slice(0, 160));

  var w2 = world({ withViews: true, settings: { lifeWhileAway: true, regexScripts: [] } });
  await settle();
  w2.sb.Store.characters = [w2.char];
  w2.sb.Views.life(w2.doc.querySelector('#screen'));
  var onHtml = w2.html('#now-body');
  ok('with the switch on, the same sentence tells the truth about the switch instead',
    /keeps advancing while the app is in your pocket/.test(onHtml) &&
    !/stops while the app is closed/.test(onHtml), onHtml.slice(0, 240));
}

async function sectionD() {
  console.log('\nD — Settings → Generation: two switches, and a permission that is not assumed');
  /* the real store.js, for the one claim only it can settle: both switches ship off
     and both are swept by a generation reset, because the Generation screen owns them */
  var st = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
    parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout,
    navigator: { onLine: true },
    document: { addEventListener: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; } },
    IDB: { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); }, all: function () { return Promise.resolve([]); }, getAll: function () { return Promise.resolve([]); } }
  };
  st.window = st; st.global = st;
  vm.runInNewContext(read('store.js'), st, { filename: 'store.js' });
  var g = st.Store.generationDefaults();
  eq('both ship off, and a generation reset restores exactly that', [g.lifeWhileAway, g.notifyAway], [false, false]);
  ok('…so neither survives a reset as a surprise cost switch',
    Object.keys(g).indexOf('lifeWhileAway') !== -1 && Object.keys(g).indexOf('notifyAway') !== -1,
    Object.keys(g).join(','));

  var w = world({ withViews: true, notification: 'absent', settings: { regexScripts: [] } });
  w.sb.Views.settingsGeneration(w.doc.querySelector('#settings-body'));
  var html = w.html('#settings-x-body');
  ok('the screen offers both, by name',
    /Keep their life running when backgrounded/.test(html) && /Notify me when they write/.test(html));
  ok('…each showing off, as stored',
    /class="toggle" id="t-away"/.test(html) && /class="toggle" id="t-notify"/.test(html), html.slice(0, 120));
  ok('…and the notification row says what this platform actually has',
    /no notifications/.test(html) && /count on the Life screen/.test(html), html.slice(0, 200));
  ok('the cost of the first switch is stated, not glossed',
    /costs model calls\s*\n?\s*you are not watching/.test(html.replace(/\s+/g, ' ').replace(/costs model calls you are not watching/, 'costs model calls you are not watching')) ||
    /costs model calls/.test(html), 'the wording moved');

  w.doc.getElementById('t-away').click();
  ok('clicking the away switch writes its key', w.settings.lifeWhileAway === true, JSON.stringify(w.calls.notes));
  ok('…through the settings door, so it persists',
    w.calls.notes.some(function (p) { return p && p.lifeWhileAway === true; }), JSON.stringify(w.calls.notes));
  w.doc.getElementById('t-notify').click();
  await settle();
  ok('…while clicking the notify switch on a platform without notifications writes nothing and says why',
    w.settings.notifyAway === undefined && w.calls.toasts.length === 1 &&
    !w.calls.notes.some(function (p) { return p && p.notifyAway; }),
    JSON.stringify([w.settings.notifyAway, w.calls.toasts, w.calls.notes]));

  var w2 = world({ withViews: true, notification: 'granted', settings: { regexScripts: [] } });
  w2.sb.Views.settingsGeneration(w2.doc.querySelector('#settings-body'));
  ok('where notifications exist, the row explains that permission is asked for',
    /Asks your browser for permission/.test(w2.html('#settings-x-body')) &&
    !/no notifications/.test(w2.html('#settings-x-body')), w2.html('#settings-x-body').slice(0, 200));
  w2.doc.getElementById('t-notify').click();
  await settle();
  eq('…and an already-granted permission is the only thing that turns it on', w2.settings.notifyAway, true);

  var w3 = world({ withViews: true, notification: 'default', askResult: 'denied', settings: { regexScripts: [] } });
  w3.sb.Views.settingsGeneration(w3.doc.querySelector('#settings-body'));
  w3.doc.getElementById('t-notify').click();
  await settle(6);
  eq('a refusal leaves the switch off, and tells you it is off', [w3.settings.notifyAway, w3.calls.toasts.length], [false, 1]);
}

async function sectionE() {
  console.log('\nE — the minute, while the app is in a pocket');
  /* The two clocks are installed inside the private bindGlobal(), which the boot
     handler calls after Store.init() — so the way to get the real callbacks is to
     fire the real DOMContentLoaded handler and let it run. App.go is stubbed first
     because the screens it mounts are not what is under test here, and a throw from
     the view stub would be mistaken for one from the clock. Nothing waits a minute:
     the installed callback is fired by hand. */
  var w = world({ settings: { lifeWhileAway: false } });
  w.App.go = function () {};
  w.fire('DOMContentLoaded');
  await settle(10);
  ok('the boot installed a per-minute clock', w.sb.intervals.some(function (i) { return i.ms === 60000; }),
    JSON.stringify(w.sb.intervals.map(function (i) { return i.ms; })));
  var seen = [];
  w.App.lifeTick = function (o) { seen.push(o && o.background ? 'background' : 'foreground'); };
  w.setHidden(false); w.tickIntervals();
  eq('in front of you, the tick runs as it always did', seen, ['foreground']);
  w.setHidden(true); w.tickIntervals();
  eq('backgrounded with the switch off, nothing runs at all', seen, ['foreground']);
  w.settings.lifeWhileAway = true; w.tickIntervals();
  eq('…and with it on, the tick runs in the background mode', seen, ['foreground', 'background']);
  /* coming back to the app is the other half of the same minute: the boot's own
     visibilitychange handler catches up, in foreground mode, exactly once — and it
     is still once whether or not background ticks have been happening, because the
     count and the hour gap are what decide, not the event */
  w.setHidden(false); w.fire('visibilitychange');
  eq('returning to the foreground catches up once, in foreground mode',
    seen, ['foreground', 'background', 'foreground']);
  w.fire('visibilitychange');
  eq('…and a second hidden-while-false event does not invent a background tick',
    seen.length, 4);
  var off = world({ settings: { lifeWhileAway: false } });
  off.App.go = function () {};
  off.fire('DOMContentLoaded');
  await settle(10);
  var seenOff = [];
  off.App.lifeTick = function (o) { seenOff.push(o && o.background ? 'background' : 'foreground'); };
  off.setHidden(false); off.fire('visibilitychange');
  eq('and that is the same as it was before this release with the switch off', seenOff, ['foreground']);

  var real = world({ settings: { lifeWhileAway: true }, screen: 'life' });
  var r2 = world({ settings: { lifeWhileAway: true }, screen: 'life' });
  real.App.lifeTick({ background: true });
  ok('a background tick does no view work — there is nobody looking at this screen',
    real.calls.lifeRenders === 0 && real.calls.feedRenders === 0, JSON.stringify(real.calls));
  r2.App.lifeTick();
  ok('…while the same call in front of you redraws the screen it is on',
    r2.calls.lifeRenders >= 1, JSON.stringify(r2.calls));
  ok('and the day still advanced in the background call',
    real.char.vh.lastTick > 0 && real.calls.putChar >= 0, 'lastTick missing');
}
