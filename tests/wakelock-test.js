/* v1.22.0 — the phone must stay awake while a reply is in flight.
 *
 * Switching apps (or the screen going dark) lets Android sleep the CPU and
 * freeze the process; a frozen process ticks no timers, so the in-flight
 * request — the Horde queue poll, the open stream, its deadlines — all stop
 * and the reply looks hung. The wrapper holds a partial wake lock for as
 * long as the KeepAwake refcount is above zero:
 *
 *   - a chat reply holds it from busy until the final cleanup (success,
 *     failure and save-failure all settle it)
 *   - a world turn holds it from worldBusy until the turn settles
 *   - every Horde queue wait (text and image) holds it for its whole poll
 *   - overlapping generations refcount: the lock drops only at the last
 *
 *   node /home/user/tests/wakelock-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var KEEP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'keepawake.js');
var APP_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js');
var HORDE_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'horde.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

/* ---- harness A: the chat path (app.js) -------------------------------- */

function freshWorld(overrides) {
  overrides = overrides || {};
  var calls = {
    lock: [], add: 0, addAttempts: 0, update: [], updateAttempts: 0,
    gen: 0, thread: 0, confirm: null, toasts: [], append: 0, go: [], afterReply: 0
  };
  var char = { id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: false } };
  var session = { id: 's1', charId: 'c1', pending: null };
  var input = { value: overrides.input || '', style: {} };

  function makeEl() {
    var el = {
      mtext: { innerHTML: '' }, removed: false, streaming: false,
      classList: {
        add: function (c) { if (c === 'streaming') el.streaming = true; },
        remove: function (c) { if (c === 'streaming') el.streaming = false; }
      },
      querySelector: function (sel) { return sel === '.mtext' ? el.mtext : null; },
      remove: function () { el.removed = true; }
    };
    return el;
  }

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setInterval: setInterval, clearInterval: clearInterval,
    AbortController: AbortController,
    HSAndroid: {
      setReplyInFlight: function (on) { calls.lock.push(!!on); }
    },
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      md: function (s) { return String(s || ''); },
      uid: function (p) { return p + '-1'; },
      toast: function (t) { calls.toasts.push(String(t)); },
      confirm: function () { return Promise.resolve(true); },
      input: function () { return Promise.resolve(null); },
      sheet: function (o) { return { close: function () {} }; }
    },
    Store: {
      settings: { provider: 'horde', hordeKey: '0000000000', userName: 'Sam', model: 'm', maxTokens: 300, temperature: 0.8 },
      updateMessage: function (m) {
        calls.updateAttempts++;
        if (overrides.updateMessageFails) return Promise.reject(new Error('Quota exceeded'));
        calls.update.push(m);
        return Promise.resolve(m);
      },
      addMessage: function (m) {
        calls.addAttempts++;
        if (overrides.addMessageFails) return Promise.reject(new Error('Quota exceeded'));
        calls.add++;
        return Promise.resolve(Object.assign({ id: 'm' + calls.add }, m));
      },
      putSession: function (s) { return Promise.resolve(s); },
      putCharacter: function () { return Promise.resolve(); },
      delCharacter: function () { return Promise.resolve(); },
      delSession: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    API: {
      generate: function () {
        if (overrides.apiGenerate === 'reject') return Promise.reject(new Error('provider down'));
        var text = overrides.reply !== undefined ? overrides.reply : 'a reply';
        return Promise.resolve(text);
      },
      parseState: function () { return null; },
      stripState: function (t) { return t; },
      splitBurst: function (t) { return [t]; }
    },
    IDB: { get: function () { return Promise.resolve({ id: 's1', title: 'My chat', charId: 'c1' }); } },
    Views: {
      thread: function () { calls.thread++; },
      appendMessage: function () { return makeEl(); },
      stickToBottom: function () {},
      chats: function () {},
      worldRun: function () { calls.worldRun = (calls.worldRun || 0) + 1; }
    },
    VH: {
      noteContact: function () {},
      replyDelay: function () { return 0; },
      isAsleep: function () { return false; },
      activity: function () { return ''; },
      ensure: function (c) { return c.vh || (c.vh = { enabled: false }); }
    },
    document: {
      querySelector: function (s) { return s === '#input' ? input : null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(KEEP_SRC, 'utf8'), sandbox, { filename: 'keepawake.js' });
  vm.runInNewContext(fs.readFileSync(APP_SRC, 'utf8'), sandbox, { filename: 'app.js' });

  sandbox.App.setStop = function () {};
  sandbox.App.go = function (s) { calls.go.push(s); };
  sandbox.App.afterReply = function () { calls.afterReply++; return Promise.resolve(); };
  if (overrides.stubGenerate) sandbox.App.generateReply = function () { calls.gen++; return Promise.resolve(); };
  sandbox.App.state = {
    busy: !!overrides.busy, char: char, session: session,
    messages: overrides.messages || [], screen: 'chat',
    world: overrides.world || null, worldRun: overrides.worldRun || null,
    worldBusy: !!overrides.worldBusy
  };
  return { App: sandbox.App, calls: calls, input: input, KeepAwake: sandbox.KeepAwake, sandbox: sandbox };
}

function u(id, text, t) { return { id: id, sessionId: 's1', role: 'user', text: text || 'u', createdAt: t || 1 }; }

/* ---- harness B: the Horde queue wait (horde.js) ------------------------ */

function hordeWorld(statuses, apiGenerate) {
  var calls = { lock: [], fetches: [] };
  var i = 0;
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    AbortController: AbortController,
    DOMException: function (m, n) { this.message = m; this.name = n || 'Error'; },
    HSAndroid: { setReplyInFlight: function (on) { calls.lock.push(!!on); } },
    fetch: function (url) {
      calls.fetches.push(String(url));
      var p = String(url).split('/').pop();
      var body;
      if (String(url).indexOf('/generate/text/async') !== -1) body = { id: 'job-1', kudos: 1 };
      else body = statuses[Math.min(i++, statuses.length - 1)];
      return Promise.resolve({
        ok: true,
        headers: { get: function () { return null; } },
        text: function () { return Promise.resolve(JSON.stringify(body)); }
      });
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(KEEP_SRC, 'utf8'), sandbox, { filename: 'keepawake.js' });
  vm.runInNewContext(fs.readFileSync(HORDE_SRC, 'utf8'), sandbox, { filename: 'horde.js' });
  return { H: sandbox.Horde, calls: calls, KeepAwake: sandbox.KeepAwake };
}

(async function main() {
  /* ---- the chat reply holds the lock from busy to cleanup -------------- */
  var w = freshWorld({ messages: [u('u1', 'hi')] });
  w.App.generateReply();
  await tick();
  ok('chat: lock held while generating', w.calls.lock.length === 2 && w.calls.lock[0] === true,
    JSON.stringify(w.calls.lock));
  ok('chat: lock released on success', w.calls.lock[1] === false, JSON.stringify(w.calls.lock));
  ok('chat: refs back to zero', w.KeepAwake.refs() === 0);

  /* ---- provider failure still releases ---------------------------------- */
  var w2 = freshWorld({ messages: [u('u1', 'hi')], apiGenerate: 'reject' });
  w2.App.generateReply();
  await tick();
  ok('chat: lock released on provider failure',
    w2.calls.lock.length === 2 && w2.calls.lock[0] === true && w2.calls.lock[1] === false,
    JSON.stringify(w2.calls.lock));

  /* ---- a save failure still releases (cleanup always runs) -------------- */
  var w3 = freshWorld({ messages: [u('u1', 'hi')], addMessageFails: true });
  w3.App.generateReply();
  await tick();
  ok('chat: lock released on save failure',
    w3.calls.lock.length === 2 && w3.calls.lock[1] === false, JSON.stringify(w3.calls.lock));

  /* ---- a busy thread spends nothing, holds nothing ---------------------- */
  var w4 = freshWorld({ busy: true, messages: [u('u1', 'hi')] });
  w4.App.generateReply();
  await tick();
  ok('chat: busy guard holds no lock', w4.calls.lock.length === 0, JSON.stringify(w4.calls.lock));

  /* ---- overlapping generations refcount ---------------------------------- */
  var w5 = freshWorld({ messages: [u('u1', 'hi')], reply: 'slow reply' });
  w5.KeepAwake.hold();   /* simulate an image job in flight */
  ok('refs: two in flight -> two refs', w5.KeepAwake.refs() === 1);
  w5.App.generateReply();
  await tick();
  ok('refs: chat settled, image still in flight -> lock stays',
    w5.KeepAwake.refs() === 1 && w5.calls.lock[w5.calls.lock.length - 1] === true,
    JSON.stringify(w5.calls.lock));
  w5.KeepAwake.release();
  ok('refs: last one settles -> lock drops', w5.KeepAwake.refs() === 0 &&
    w5.calls.lock[w5.calls.lock.length - 1] === false, JSON.stringify(w5.calls.lock));

  /* ---- no native bridge (web-only) never throws -------------------------- */
  var w6 = freshWorld({ messages: [u('u1', 'hi')] });
  delete w6.sandbox.HSAndroid;
  w6.App.generateReply();
  await tick();
  ok('web-only: no bridge, no crash, reply still lands',
    w6.App.state.messages.length === 2 && w6.App.state.messages[1].text === 'a reply');

  /* ---- the Horde queue wait holds the lock for its whole poll ------------ */
  var h = hordeWorld([
    { done: false, waiting: 2, wait_time: 5, processing: 1, queue_position: 0, finished: 3 },
    { done: true, generations: [{ text: 'hello from the horde', worker_name: 'w1', model: 'm1' }] }
  ]);
  var res = await h.H.generateText({ apikey: 'k', prompt: 'p', model: 'm1' });
  ok('horde: text job resolves', res && res.text === 'hello from the horde', JSON.stringify(res));
  ok('horde: lock held for the whole wait then released',
    h.calls.lock.length === 2 && h.calls.lock[0] === true && h.calls.lock[1] === false,
    JSON.stringify(h.calls.lock));
  ok('horde: refs back to zero', h.KeepAwake.refs() === 0);

  /* ---- an aborted job releases too --------------------------------------- */
  var h2 = hordeWorld([{ done: false, waiting: 9, wait_time: 90, processing: 0, queue_position: 1, finished: 0 }]);
  var ctrl = new AbortController();
  var abortErr = null, res2 = null;
  var p2 = h2.H.generateText({ apikey: 'k', prompt: 'p', model: 'm1', signal: ctrl.signal, emptyTries: 1, emptyBudget: 10 });
  setTimeout(function () { ctrl.abort(); }, 80);
  try { res2 = await p2; } catch (e) { abortErr = e; }
  ok('horde: abort rejects', !!(abortErr && /Abort/i.test(abortErr.name + abortErr.message)),
    String(abortErr));
  ok('horde: lock released on abort', h2.calls.lock.length === 2 && h2.calls.lock[1] === false,
    JSON.stringify(h2.calls.lock));
  ok('horde: refs back to zero after abort', h2.KeepAwake.refs() === 0);

  console.log('');
  if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
  console.log('wakelock-test: ' + pass + ' ok');
})().catch(function (e) {
  console.log('  FAIL threw ' + (e && e.stack || e));
  process.exit(1);
});
