#!/usr/bin/env node
/* session.messageCount is a cache, and it now behaves like one.

   Reported as "a chat of thirty turns listed 1 message". The number is not
   stored anywhere authoritative: one `+1` in `Store.addMessage` maintained it,
   nothing ever subtracted, and `Store` has no `getSession(id)` — only
   `getSessions`/`allSessions` — so every caller that wants a session loads a
   LIST and keeps the OBJECT. 33 places in `app.js` then hand that object back
   to `Store.putSession`, which wrote the whole record: last writer wins, on
   every field. A title job, a memory pass or a scene check that finished after
   its own read rewrote `messageCount` as whatever it was when the job started.

   The visible half is a wrong label. The half that matters is `app.js:3606`
   and `3611`: auto-summarising runs when `since = messageCount - memAt`
   reaches `memoryEvery`, so a rewound count plus a bookmark stamped from it
   answers 0 forever, and the chat quietly stops remembering — no error, no
   toast, no hint in the health readout.

   So the counter has one owner now (`recountSession`/`reconcile`), a generic
   `putSession` carries the STORED value forward instead of the one in the
   caller's hand, the transcript is counted by one rule for everyone
   (`countTranscript`, which excludes the vhuman "is busy right now" notices
   the prompt history and the export already exclude — the importer's recount
   did, the `+1` did not, so the two writers of the number disagreed about the
   same chat), and opening a chat reconciles the cache against rows it loaded
   for the thread anyway. That last part is why a future caller that forgets
   the door costs one re-open rather than a permanent lie — and it is what
   heals a chat whose count an archive restore wrote back.

   Everything below runs the real `Store` against a fake IndexedDB whose reads
   always hand back a copy, because IndexedDB structured-clones: without that,
   a "stale snapshot" test mutates the live row and proves nothing. The two
   checks that can only be source contracts say so in their names.

   Usage: node tests/session-counter-test.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var storeSrc = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

/* ---------------- the world: real Store, fake IDB ---------------- */
function world() {
  var data = {};
  var writes = 0;
  function st(t) { return (data[t] = data[t] || {}); }
  function copy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  var IDB = {
    get: function (t, id) { return Promise.resolve(st(t)[id] == null ? null : copy(st(t)[id])); },
    put: function (t, o) { writes++; st(t)[o.id] = copy(o); return Promise.resolve(copy(o)); },
    putMany: function (t, arr) { arr.forEach(function (o) { writes++; st(t)[o.id] = copy(o); }); return Promise.resolve(arr); },
    del: function (t, id) { writes++; delete st(t)[id]; return Promise.resolve(); },
    getAll: function (t) { return Promise.resolve(Object.keys(st(t)).map(function (k) { return copy(st(t)[k]); })); },
    getAllByIndex: function (t, ix, v) {
      return Promise.resolve(Object.keys(st(t)).map(function (k) { return st(t)[k]; })
        .filter(function (o) { return o[ix] === v; }).map(copy));
    },
    _rows: function (t) { return Object.keys(st(t)).map(function (k) { return copy(st(t)[k]); }); },
    _writes: function () { return writes; }
  };
  var uid = 0;
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error,
    isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout,
    IDB: IDB,
    UI: {
      uid: function (p) { return p + '-' + (++uid); },
      esc: function (x) { return String(x == null ? '' : x); },
      toast: function () {}, confirm: function () { return Promise.resolve(false); },
      input: function () { return Promise.resolve(null); }, sheet: function () {}
    }
  };
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(storeSrc, sb, { filename: 'store.js' });
  sb.Store.settings = { activePersona: '', memoryEvery: 14, autoMemory: true };
  return { Store: sb.Store, IDB: IDB };
}

function freshChat(w, title) {
  var s = w.Store.newSession('cA', title || 'Truth or Dare Night');
  return w.Store.putSession(s).then(function () { return s; });
}
function turn(w, sid, role, text) {
  return w.Store.addMessage({ sessionId: sid, role: role, text: text || '…', createdAt: Date.now() });
}
function stored(w, sid) {
  return w.IDB.get('sessions', sid);
}
function rows(w, sid) {
  return w.Store.getMessages(sid);
}
function counts(w, sid) {
  return Promise.all([stored(w, sid), rows(w, sid)]).then(function (r) {
    return { count: r[0].messageCount, memAt: r[0].memAt || 0, rows: r[1].length,
      transcript: w.Store.countTranscript(r[1]) };
  });
}

/* ------------------------------------------------------------------ */
console.log('\nwhat counts as a message is one rule');
var w = world();
freshChat(w).then(function (s) {
  return turn(w, s.id, 'assistant', 'the greeting')
    .then(function () { return turn(w, s.id, 'user', 'my line'); })
    .then(function () { return turn(w, s.id, 'system', 'Mika is busy right now (asleep).'); })
    .then(function () { return turn(w, s.id, 'assistant', 'their line'); })
    .then(function () {
      return counts(w, s.id);
    })
    .then(function (c) {
      same('the thread holds four bubbles', c.rows, 4);
      same('the transcript is three turns', c.transcript, 3);
      same('…and the counter agrees with the rule, notice included in neither', c.count, 3);
      same('a chat with no messages counts none', w.Store.countTranscript([]), 0);
      ok('…and nothing in the app re-types either half of it',
        !/\.filter\(function \(m\) \{ return m\.role !== 'system'/.test(appSrc) &&
        !/messageCount \|\| 0\) - \(/.test(appSrc),
        (appSrc.match(/role !== 'system'/g) || []).length + ' filter copies, ' +
        (appSrc.match(/messageCount \|\| 0\) - \(/g) || []).length + ' gate copies');
      same('the count is the selector, not a second copy of the test',
        w.Store.countTranscript([{ role: 'user' }, { role: 'system' }, { role: 'assistant' }]), 2);
      return c;
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\na stale whole-row write cannot move the counter');
  var w2 = world();
  var sid, snap;
  return freshChat(w2).then(function (s) {
    sid = s.id;
    return turn(w2, sid, 'assistant', 'the greeting');
  }).then(function () {
    /* what App.openSession / the titler / the memory pass do: read the row,
       do slow model work, write the row back */
    return w2.Store.allSessions().then(function (all) { snap = all[0]; });
  }).then(function () {
    var p = Promise.resolve();
    for (var i = 0; i < 11; i++) p = p.then(function () { return turn(w2, sid, i % 2 ? 'user' : 'assistant'); });
    return p;
  }).then(function () { return counts(w2, sid); })
    .then(function (c) {
      same('twelve turns are on the books', c.count, 12);
      /* the field the job actually came to write, and a bookmark, both from a
         row it read when the chat held one message */
      snap.title = 'Mika confesses';
      snap.memAt = snap.messageCount || 0;
      return w2.Store.putSession(snap);
    })
    .then(function () { return counts(w2, sid); })
    .then(function (c) {
      same('the job saved a snapshot from when the chat had one message', c.count, 12);
      return stored(w2, sid).then(function (s) {
        same('the title change was not swallowed by the guard', s.title, 'Mika confesses');
        same('…and so was the bookmark', s.memAt, 1);
        ok('…while the rows say twelve', c.rows === 12);
      });
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\nthe door still moves it, and so does the memory reset');
  var w3 = world();
  var sid;
  return freshChat(w3).then(function (s) {
    sid = s.id;
    var p = Promise.resolve();
    for (var i = 0; i < 12; i++) p = p.then(function () { return turn(w3, sid, 'assistant'); });
    return p;
  }).then(function () {
    return stored(w3, sid).then(function (s) {
      s.memAt = 0; s.summary = '';
      return w3.Store.putSession(s);
    });
  }).then(function () { return stored(w3, sid); })
    .then(function (s) {
      same('clearing the memory bookmark goes through', s.memAt, 0);
      same('…and the counter is untouched by that write', s.messageCount, 12);
      return w3.Store.recountSession(sid).then(function (n) { return n; });
    })
    .then(function (n) {
      same('an explicit recount from the rows still works', n, 12);
      return w3.IDB.get('sessions', sid);
    })
    .then(function (s) {
      /* a caller that has only the id — the repair must still land in the row,
         not just come back as a number the caller can ignore */
      s.messageCount = 999; s.memAt = 999;
      return w3.IDB.put('sessions', s).then(function () { return w3.Store.recountSession(sid); });
    })
    .then(function (n) {
      same('recountSession reports the truth', n, 12);
      return stored(w3, sid);
    })
    .then(function (s) {
      same('…and writes it to the row, for a caller holding only an id', s.messageCount, 12);
      same('…clamping the bookmark with it', s.memAt, 12);
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\ndeleting turns takes them off the number, once, not N times');
  var w4 = world();
  var sid;
  return freshChat(w4).then(function (s) {
    sid = s.id;
    var p = Promise.resolve();
    for (var i = 0; i < 12; i++) p = p.then(function () { return turn(w4, sid, i % 2 ? 'user' : 'assistant', 'turn ' + i); });
    return p;
  }).then(function () { return w4.Store.getMessages(sid); })
    .then(function (all) {
      /* App.editAndResend: every turn after the edited one goes, in parallel */
      return w4.Store.removeMessages(all.slice(5));
    })
    .then(function () { return counts(w4, sid); })
    .then(function (c) {
      same('five turns survive', c.rows, 5);
      same('…and so does their number', c.count, 5);
      same('…with nothing to exclude, the transcript is the same five', c.transcript, 5);
      return w4.Store.getMessages(sid).then(function (all) {
        return w4.Store.removeMessages([all[0]]).then(function () { return counts(w4, sid); });
      });
    })
    .then(function (c) {
      same('a single delete through the same door decrements too', c.count, 4);
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\nopening a chat heals a number that was already wrong');
  var w5 = world();
  var sid;
  return freshChat(w5).then(function (s) {
    sid = s.id;
    var p = Promise.resolve();
    for (var i = 0; i < 7; i++) p = p.then(function () { return turn(w5, sid, 'assistant'); });
    return p;
  }).then(function () {
    /* the damage the guard alone could not undo: a poisoned value sitting in
       the row, and a bookmark stamped past the end of the transcript */
    return w5.IDB.get('sessions', sid).then(function (s) {
      s.messageCount = 999; s.memAt = 999;
      return w5.IDB.put('sessions', s);
    });
  }).then(function () { return counts(w5, sid); })
    .then(function (c) {
      same('seven turns are on disk, and the row claims 999', c.count, 999);
      ok('…which reads as "up to date": the gate answers 0 however the chat grows',
        w5.Store.sinceMemory({ messageCount: c.count, memAt: c.memAt }) === 0);
      return w5.IDB.get('sessions', sid);
    })
    .then(function (s) {
      return w5.Store.getMessages(sid).then(function (msgs) {
        /* App.openSession hands over the session row it loaded plus the rows
           it loaded for the thread — the same two objects, in the same order */
        return w5.IDB.get('sessions', sid).then(function (s) {
          return w5.Store.reconcile(s, msgs);
        });
      });
    })
    .then(function (n) {
      same('the reconcile returns the truth it found', n, 7);
      return counts(w5, sid);
    })
    .then(function (c) {
      same('the count is healed', c.count, 7);
      same('…and the bookmark that sat past the end is pulled back to it', c.memAt, 7);
      var p = Promise.resolve();
      for (var i = 0; i < 14; i++) p = p.then(function () { return turn(w5, sid, 'user'); });
      return p.then(function () { return w5.IDB.get('sessions', sid); });
    })
    .then(function (s) {
      ok('fourteen more turns and the gate opens again — this chat can remember',
        w5.Store.sinceMemory(s) >= 14, w5.Store.sinceMemory(s));
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\nno write when the cache already agrees (and it is checked, not assumed)');
  var w6 = world();
  var sid;
  return freshChat(w6).then(function (s) {
    sid = s.id;
    return turn(w6, sid, 'assistant').then(function () { return turn(w6, sid, 'user'); });
  }).then(function () {
    var writes0 = w6.IDB._writes();
    return w6.IDB.get('sessions', sid).then(function (s) {
      return w6.Store.getMessages(sid).then(function (msgs) {
        return w6.Store.reconcile(s, msgs).then(function () { return w6.IDB._writes() - writes0; });
      });
    });
  }).then(function (extraWrites) {
    same('opening a healthy chat performs zero session writes', extraWrites, 0);
  });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\nthe gate is one question with the same answer everywhere');
  var w7 = world();
  var sid;
  return freshChat(w7).then(function (s) {
    sid = s.id;
    var p = Promise.resolve();
    for (var i = 0; i < 24; i++) p = p.then(function () { return turn(w7, sid, i % 3 === 2 ? 'system' : 'assistant'); });
    return p;
  }).then(function () { return w7.Store.getMessages(sid); })
    .then(function (msgs) {
      return w7.IDB.get('sessions', sid).then(function (s) {
        return w7.Store.reconcile(s, msgs).then(function () {
          return w7.IDB.get('sessions', sid).then(function (fresh) {
            var gate = w7.Store.sinceMemory(fresh);
            var readout = w7.Store.sinceMemory(fresh, w7.Store.countTranscript(msgs));
            same('the auto-memory gate and the health readout agree on the same chat', readout, gate);
            ok('…and both are above the trigger of 14', gate >= 14, gate);
            same('a bookmark ahead of the count answers 0, not a negative',
              w7.Store.sinceMemory({ messageCount: 7, memAt: 999 }), 0);
            same('…because a negative since clears no >= gate, ever',
              w7.Store.sinceMemory({ messageCount: 7, memAt: 999 }) >= 14, false);
            same('a pre-v1.39 session that only has memoryAt is not read as never-summarised',
              w7.Store.sinceMemory({ messageCount: 20, memoryAt: 18 }), 2);
            same('no session, no question', w7.Store.sinceMemory(null), 0);
          });
        });
      });
    });
})

/* ------------------------------------------------------------------ */
.then(function () {
  console.log('\nsource contract: the paths that change the transcript go through it');
  var open = appSrc.slice(appSrc.indexOf('App.openSession = function'), appSrc.indexOf('App.createGroupChat'));
  ok('App.openSession reconciles with the rows it loaded for the thread',
    /Store\.reconcile\(s, msgs\)/.test(open), open.slice(open.length - 400));
  ok('…and it is a documented exception to opening being read-only',
    /the one write opening a chat makes/.test(open));
  var resend = appSrc.slice(appSrc.indexOf('App.editAndResend = function'), appSrc.indexOf('App.editAndResend = function') + 2000);
  ok('edit-and-resend deletes through the counter-aware door',
    /Store\.removeMessages\(after\)/.test(resend) && !/Store\.delMessage\(x\.id\)/.test(resend));
  ok('the message menu does too',
    /Store\.removeMessages\(\[msg\]\)/.test(appSrc) && !/Store\.delMessage\(msg\.id\)/.test(appSrc));
  ok('the prompt history asks the store which rows are turns, rather than deciding',
    /history: Store\.transcript\(msgs\)/.test(appSrc),
    (appSrc.match(/history: [^\n]{0,60}/g) || []).slice(0, 2).join(' | '));
  ok('no caller in the app writes the counter at all — only the store does',
    !/messageCount\s*=[^=]/.test(appSrc),
    (appSrc.match(/.{0,40}messageCount\s*=[^=].{0,20}/g) || []).join(' | '));
  var put = storeSrc.slice(storeSrc.indexOf('putSession: function'), storeSrc.indexOf('getSessions: function'));
  ok('putSession carries the stored counter forward',
    /s\.messageCount = cur\.messageCount/.test(put), put.slice(0, 200));
  ok('…and only when there IS a stored row, so a new chat is still creatable',
    /if \(cur\)/.test(put));
})

.then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  ok('the suite ran', false, String((e && e.stack) || e).slice(0, 600));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});
