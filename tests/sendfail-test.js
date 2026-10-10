/* v1.21.0 — a storage failure must not eat the user's text or the model's
 * reply, and a mid-turn reply must not be deleted or corrected out from
 * under the app.
 *
 * Ported from upstream 18.3.5 (save-failure surfacing + mid-turn guards):
 *   - App.send: when the user message cannot be saved, the draft is handed
 *     back to the input instead of vanishing
 *   - generateReply: a finished reply STAYS in the thread when saving fails
 *     (the storage error gets its own toast; the provider-failure path that
 *     deletes the reply and offers a re-spent retry is not used), and the
 *     burst parts are not queued behind a ledger that is down
 *   - the abort-time partial save is no longer fire-and-forget
 *   - deleting the generating character / the active chat while a reply is
 *     in flight is refused
 *
 *   node /home/user/tests/sendfail-test.js
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
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

function freshWorld(overrides) {
  overrides = overrides || {};
  var calls = {
    add: 0, addAttempts: 0, update: [], updateAttempts: 0,
    delChar: 0, delSession: 0, putSession: 0, gen: 0, thread: 0,
    confirm: null, toasts: [], append: 0, go: [], sheet: null, afterReply: 0, els: []
  };
  var char = Object.assign({ id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: false } }, overrides.char || {});
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
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      md: function (s) { return String(s || ''); },
      uid: function (p) { return p + '-1'; },
      toast: function (t) { calls.toasts.push(String(t)); },
      confirm: function (title, body, opts) {
        calls.confirm = { title: title, body: body, opts: opts };
        return Promise.resolve(overrides.confirmResult !== undefined ? overrides.confirmResult : true);
      },
      input: function () { return Promise.resolve(null); },
      sheet: function (o) { calls.sheet = o; return { close: function () {} }; }
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
      putSession: function (s) { calls.putSession++; return Promise.resolve(s); },
      putCharacter: function () { return Promise.resolve(); },
      delCharacter: function () {
        calls.delChar++;
        return overrides.delCharacterFails ? Promise.reject(new Error('Quota exceeded')) : Promise.resolve();
      },
      delSession: function () { calls.delSession++; return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    API: {
      generate: function (opts) {
        var mode = overrides.apiGenerate || 'ok';
        if (mode === 'abort') {
          if (overrides.partial) opts.onDelta(overrides.partial, overrides.partial);
          var err = new Error('aborted'); err.name = 'AbortError';
          return Promise.reject(err);
        }
        if (mode === 'reject') return Promise.reject(new Error('provider down'));
        var text = overrides.reply !== undefined ? overrides.reply : 'a reply';
        opts.onDelta(text, text);
        return Promise.resolve(text);
      },
      parseState: function () { return null; },
      stripState: function (t) { return t; },
      splitBurst: function (t) { return overrides.split ? String(t).split('\n\n') : [t]; }
    },
    IDB: { get: function () { return Promise.resolve({ id: 's1', title: 'My chat', charId: 'c1' }); } },
    Views: {
      thread: function () { calls.thread++; },
      appendMessage: function () { var el = makeEl(); calls.els.push(el); calls.append++; return el; },
      stickToBottom: function () {},
      chats: function () {}
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
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'app.js' });

  /* UI glue the tests do not care about */
  sandbox.App.setStop = function () {};
  sandbox.App.go = function (s) { calls.go.push(s); };
  sandbox.App.afterReply = function () { calls.afterReply++; return Promise.resolve(); };
  if (overrides.stubGenerate) sandbox.App.generateReply = function () { calls.gen++; return Promise.resolve(); };
  sandbox.App.state = {
    busy: !!overrides.busy, char: char, session: session,
    messages: overrides.messages || [], screen: 'chat'
  };
  return { App: sandbox.App, calls: calls, input: input, session: session, char: char, els: calls.els };
}

function u(id, text, t) { return { id: id, sessionId: 's1', role: 'user', text: text || 'u', createdAt: t || 1 }; }
function a(id, text, t) { return { id: id, sessionId: 's1', role: 'assistant', text: text || 'a', alts: [], altIdx: 0, createdAt: t || 2 }; }
function optEl(name) {
  return { getAttribute: function (k) { return k === 'data-a' ? name : null; },
           fire: function () { this.onclick(); } };
}
function toasts(w) { return w.calls.toasts.join(' | '); }

function clickDel(w) {
  var el = optEl('del');
  w.calls.sheet.onMount({ querySelectorAll: function () { return [el]; } }, function () {});
  el.fire();
}

(async function main() {
  /* ---- App.send: the draft comes back when saving fails -------------- */
  var w = freshWorld({ input: 'hello, are you there?', addMessageFails: true, stubGenerate: true });
  w.App.send();
  await tick();
  ok('send: draft is restored to the input', w.input.value === 'hello, are you there?', JSON.stringify(w.input.value));
  ok('send: failure is named in the toast', /not sent — saving failed/.test(toasts(w)), toasts(w));
  ok('send: nothing appended, nothing generated', w.calls.append === 0 && w.calls.gen === 0);

  /* ---- App.send: the normal path is untouched ------------------------ */
  var w2 = freshWorld({ input: 'hello', stubGenerate: true });
  w2.App.send();
  await tick();
  ok('send: input cleared on success', w2.input.value === '');
  ok('send: message appended and generated', w2.calls.append === 1 && w2.calls.gen === 1);
  ok('send: message in state', w2.App.state.messages.length === 1 && w2.App.state.messages[0].text === 'hello');

  /* ---- deleteCharacter: mid-turn guard ------------------------------- */
  var w3 = freshWorld({ busy: true });
  w3.App.deleteCharacter('c1');
  await tick();
  ok('delete char: refused while busy', /Wait for the current reply/.test(toasts(w3)), toasts(w3));
  ok('delete char: spends nothing while busy', w3.calls.delChar === 0);

  var w4 = freshWorld();
  w4.App.deleteCharacter('c1');
  await tick();
  ok('delete char: proceeds when idle', w4.calls.delChar === 1);
  ok('delete char: back to the list', w4.calls.go.indexOf('characters') !== -1);

  var w5 = freshWorld({ delCharacterFails: true });
  w5.App.deleteCharacter('c1');
  await tick();
  ok('delete char: save failure toasted', /Could not delete the character/.test(toasts(w5)), toasts(w5));
  ok('delete char: no navigation after a failed delete', w5.calls.go.length === 0);

  /* ---- sessionMenu 'del': the active chat while busy ------------------ */
  var w6 = freshWorld({ busy: true });
  w6.App.sessionMenu('s1');
  await tick();
  ok('chat menu: sheet mounted', !!w6.calls.sheet);
  clickDel(w6);
  await tick();
  ok('chat menu: delete refused while busy', /Wait for the current reply/.test(toasts(w6)), toasts(w6));
  ok('chat menu: no confirm offered while busy', w6.calls.confirm === null);
  ok('chat menu: nothing deleted while busy', w6.calls.delSession === 0);

  var w7 = freshWorld();
  w7.App.sessionMenu('s1');
  await tick();
  clickDel(w7);
  await tick();
  ok('chat menu: confirm offered when idle', !!w7.calls.confirm);
  ok('chat menu: session deleted', w7.calls.delSession === 1);
  ok('chat menu: success toasted', /Chat deleted/.test(toasts(w7)), toasts(w7));

  /* ---- generateReply: a finished reply survives a failed save -------- */
  var w8 = freshWorld({ messages: [u('u1', 'hi')], addMessageFails: true });
  w8.App.generateReply();
  await tick();
  var kept = w8.App.state.messages.filter(function (m) { return m.role === 'assistant'; });
  ok('save fail: reply kept in the thread', kept.length === 1 && kept[0].text === 'a reply',
    JSON.stringify(w8.App.state.messages.map(function (m) { return m.role + ':' + (m.text || ''); })));
  ok('save fail: reply marked saveFailed', kept.length === 1 && kept[0].saveFailed === true);
  ok('save fail: bubble not removed', w8.els.length === 1 && w8.els[0].removed === false);
  ok('save fail: streaming class cleared', w8.els.length === 1 && w8.els[0].streaming === false);
  ok('save fail: the storage error is named', /could not be saved/.test(toasts(w8)), toasts(w8));
  ok('save fail: no provider error toast', !/Error:/.test(toasts(w8)), toasts(w8));
  ok('save fail: afterReply not re-armed while the ledger is down', w8.calls.afterReply === 0);
  ok('save fail: busy flag cleared', w8.App.state.busy === false);

  /* ---- generateReply: the provider-failure path is unchanged --------- */
  var w9 = freshWorld({ messages: [u('u1', 'hi')], apiGenerate: 'reject' });
  w9.App.generateReply();
  await tick();
  ok('provider fail: reply removed from state', w9.App.state.messages.length === 1 && w9.App.state.messages[0].role === 'user');
  ok('provider fail: bubble removed', w9.els.length === 1 && w9.els[0].removed === true);
  ok('provider fail: error toasted', /Error: provider down/.test(toasts(w9)), toasts(w9));
  ok('provider fail: retry chip armed', w9.App.state.messages[0].retry === true);
  ok('provider fail: thread re-rendered', w9.calls.thread === 1);

  /* ---- generateReply: empty abort still removes the bubble ----------- */
  var w10 = freshWorld({ messages: [u('u1', 'hi')], apiGenerate: 'abort' });
  w10.App.generateReply();
  await tick();
  ok('abort: empty abort removes the bubble', w10.els[0].removed === true && w10.App.state.messages.length === 1);
  ok('abort: stopped toasted', /Stopped/.test(toasts(w10)), toasts(w10));

  /* ---- generateReply: reroll abort keeps its text, save failure loud -- */
  var w11 = freshWorld({
    messages: [u('u1', 'hi'), a('a1', 'old reply')],
    apiGenerate: 'abort', updateMessageFails: true
  });
  w11.App.generateReply({ rerollFor: w11.App.state.messages[1] });
  await tick();
  ok('reroll abort: message not removed', w11.App.state.messages.length === 2);
  ok('reroll abort: bubble not removed', w11.els[0].removed === false);
  ok('reroll abort: partial-save failure toasted', /could not be saved/.test(toasts(w11)), toasts(w11));
  ok('reroll abort: stopped toasted too', /Stopped/.test(toasts(w11)), toasts(w11));

  /* ---- generateReply: a burst does not queue parts behind a down ledger */
  var w12 = freshWorld({
    char: { id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: true, burst: 2 } },
    messages: [u('u1', 'hi')],
    reply: 'first part\n\nsecond part', split: true, addMessageFails: true
  });
  w12.App.generateReply();
  await tick();
  var kept12 = w12.App.state.messages.filter(function (m) { return m.role === 'assistant'; });
  ok('burst: first bubble kept on a save failure', kept12.length === 1 && kept12[0].text === 'first part',
    JSON.stringify(kept12.map(function (m) { return m.text; })));
  ok('burst: no parts queued behind the down ledger', w12.calls.addAttempts === 1 && w12.App.state.messages.length === 2);
  ok('burst: save failure toasted once', w12.calls.toasts.filter(function (t) { return /could not be saved/.test(t); }).length === 1, toasts(w12));

  console.log('');
  if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
  console.log('sendfail-test: ' + pass + ' ok');
})().catch(function (e) {
  console.log('  FAIL threw ' + (e && e.stack || e));
  process.exit(1);
});
