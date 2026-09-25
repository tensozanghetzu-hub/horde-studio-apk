/* Edit-and-resend: after the replies don't sit right, the player edits
 * their own message and the app re-sends it — the edited line replaces the
 * old one, everything said after it is cut, a fresh reply is generated.
 * A plain in-place edit would strand the old replies; unchanged edits must
 * spend nothing. Virtual humans keep answering on their own schedule.
 *
 *   node /home/user/tests/editresend-test.js
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

function freshWorld(overrides) {
  overrides = overrides || {};
  var calls = {
    update: [], del: [], add: [], putSession: 0, gen: 0, thread: 0, confirm: null
  };
  var char = Object.assign({
    id: 'c1', name: 'Sera', avatar: null, systemPrompt: '',
    vh: { enabled: false }
  }, overrides.char || {});
  var session = { id: 's1', charId: 'c1', pending: null };

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    UI: {
      esc: function (s) { return String(s == null ? '' : s); },
      icon: function (n) { return '<svg data-icon="' + n + '"></svg>'; },
      toast: function () {},
      confirm: function (title, body, opts) {
        calls.confirm = { title: title, body: body, opts: opts };
        return Promise.resolve(overrides.confirmResult !== undefined ? overrides.confirmResult : true);
      }
    },
    Store: {
      settings: { provider: 'horde', hordeKey: '0000000000', userName: 'Sam', maxTokens: 300, temperature: 0.8 },
      updateMessage: function (m) { calls.update.push(m); return Promise.resolve(m); },
      delMessage: function (id) { calls.del.push(id); return Promise.resolve(); },
      addMessage: function (m) { calls.add.push(m); return Promise.resolve(m); },
      putSession: function (s) { calls.putSession++; return Promise.resolve(s); },
      putCharacter: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      init: function () { return Promise.resolve(); }
    },
    Views: {
      thread: function () { calls.thread++; },
      appendMessage: function () { return {}; },
      stickToBottom: function () {}
    },
    VH: {
      noteContact: function () {},
      replyDelay: function () { return overrides.delay || 0; },
      isAsleep: function () { return !!overrides.asleep; },
      activity: function () { return 'at work'; },
      ensure: function (c) { return c.vh || (c.vh = { enabled: false }); }
    },
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'app.js' });

  /* the generation itself is stubbed: we are testing what TRIGGERS it */
  sandbox.App.generateReply = function () { calls.gen++; return Promise.resolve(); };
  sandbox.App.state = {
    busy: !!overrides.busy,
    char: char, session: session,
    messages: overrides.messages || []
  };
  return { App: sandbox.App, calls: calls, session: session, char: char };
}

function u(id, text, t) { return { id: id, sessionId: 's1', role: 'user', text: text || 'u', createdAt: t || 1 }; }
function a(id, text, t) { return { id: id, sessionId: 's1', role: 'assistant', text: text || 'a', alts: [], altIdx: 0, createdAt: t || 2 }; }

/* ---- the plain case: the edited message is the last one -------------- */

var w = freshWorld({ messages: [a('a1', 'old reply', 2), u('u2', 'is the door locked?', 3)] });
w.App.editAndResend(w.App.state.messages[1], 'is the door locked? (second try)')
  .then(function (r) {
    ok('tail edit settles without a confirm', r === undefined && w.calls.confirm === null);
    ok('the edited text is persisted', w.calls.update.length === 1 &&
      w.calls.update[0].text === 'is the door locked? (second try)');
    ok('nothing after it is deleted', w.calls.del.length === 0);
    ok('exactly one fresh reply is generated', w.calls.gen === 1);
    ok('the thread re-renders', w.calls.thread === 1);
    ok('the thread keeps its length', w.App.state.messages.length === 2);
    ok('the reply is aimed at the edited tail', w.App.state.messages[w.App.state.messages.length - 1].id === 'u2');

    /* ---- edit in the middle: the later turns are cut ------------------ */

    var w2 = freshWorld({ messages: [u('u1', 'first line', 1), a('a1', 'reply one', 2), a('a2', 'reroll', 3)] });
    return w2.App.editAndResend(w2.App.state.messages[0], 'first line, sharpened').then(function (r) {
      ok('a confirm is offered before cutting', r === undefined && !!w2.calls.confirm);
      ok('the confirm names how much gets deleted',
        /deletes the 2 messages after it/.test(w2.calls.confirm.body), w2.calls.confirm.body);
      ok('confirm is the danger style with a clear label',
        w2.calls.confirm.opts.danger === true && w2.calls.confirm.opts.okLabel === 'Edit & resend');
      ok('both later messages are deleted', w2.calls.del.indexOf('a1') !== -1 && w2.calls.del.indexOf('a2') !== -1);
      ok('the thread is cut at the edit', w2.App.state.messages.length === 1 &&
        w2.App.state.messages[0].text === 'first line, sharpened');
      ok('a fresh reply is generated', w2.calls.gen === 1);

      /* declined: nothing is cut, nothing spent */
      var w3 = freshWorld({ messages: [u('u1', 'first line', 1), a('a1', 'reply one', 2)], confirmResult: false });
      return w3.App.editAndResend(w3.App.state.messages[0], 'first line, sharpened').then(function (r) {
        ok('declined resolves cancelled', r === 'cancelled');
        ok('declined deletes nothing', w3.calls.del.length === 0 && w3.calls.update.length === 0);
        ok('declined generates nothing', w3.calls.gen === 0);
        ok('declined leaves the text alone', w3.App.state.messages[0].text === 'first line');

        /* ---- guards ----------------------------------------------------- */

        var w4 = freshWorld({ busy: true, messages: [u('u1', 'x', 1)] });
        return w4.App.editAndResend(w4.App.state.messages[0], 'y').then(function (r) {
          ok('a busy thread is refused', r === 'busy');
          ok('busy spends nothing', w4.calls.gen === 0 && w4.calls.update.length === 0);

          var w5 = freshWorld({ messages: [u('u1', 'x', 1)] });
          return w5.App.editAndResend(w5.App.state.messages[0], 'x').then(function (r) {
            ok('an unchanged edit is a no-op', r === 'unchanged');
            ok('an unchanged edit spends no request', w5.calls.gen === 0 && w5.calls.update.length === 0);

            /* ---- virtual humans keep their own schedule ---------------- */

            var w6 = freshWorld({
              delay: 30, asleep: true,
              char: { id: 'c1', name: 'Sera', avatar: null, systemPrompt: '', vh: { enabled: true, sleep: { end: '07:00' } } },
              messages: [u('u1', 'hey', 1)]
            });
            return w6.App.editAndResend(w6.App.state.messages[0], 'hey (edited)').then(function () {
              ok('a busy virtual human does not generate now', w6.calls.gen === 0);
              ok('their reply is parked as pending', w6.session.pending && w6.session.pending.asleep === true);
              ok('the pending reply is persisted', w6.calls.putSession === 1);
              ok('the player is told why', w6.calls.add.length === 1 &&
                w6.calls.add[0].role === 'system' && /asleep/.test(w6.calls.add[0].text));
            });
          });
        });
      });
    });
  })
  .then(function () {
    console.log('');
    if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
    console.log('editresend-test: ' + pass + ' ok');
  })
  .catch(function (e) {
    console.log('  FAIL threw ' + (e && e.stack || e));
    process.exit(1);
  });
