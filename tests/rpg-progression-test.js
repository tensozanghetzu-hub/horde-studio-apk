#!/usr/bin/env node
/* RPG progression: the sheet, the review, and the rules that bind them.
 *
 * v1.48.7 moved the arithmetic out of the model's hands and into the app, which
 * means the promise is now made in three places at once — the sheet a player
 * types into, the prompt the model reads, and the write path that applies an
 * approved change. A test of the maths alone (rpg-status-test.js) cannot see a
 * sheet that derives nothing because it forgot to send a field, or a review that
 * shows one number while storing another. So this file drives the real
 * `App.rpgStatusSheet`, `App.reviewRpgStatusProposal` and `App.sessionMenu`
 * against a fake IDB/UI with the REAL engine, and asserts both what the player
 * is shown and what lands in the store.
 *
 *   node /home/user/tests/rpg-progression-test.js
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

/* The app's chains run putSession, then Promise.all, then the re-render — a
   handful of microtasks deep. Everything here is an already-resolved promise, so
   ten ticks drains it; a sheet the app has not finished with is a sheet whose
   assertions would read nothing at all. */
function tickAll(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 10); i++) p = p.then(function () {});
  return p;
}

/* A sheet is a pile of inputs, so the fake DOM is a map of id -> value, and an
   id nobody gave a value for reads as an empty one. Whether a field EXISTS is a
   question about the HTML, which the assertions ask directly — a null here would
   only make the app's own onMount throw inside a promise chain and look like a
   sheet that never resolved. */
function fakeBody(values) {
  values = values || {};
  var toggles = {};
  return {
    querySelectorAll: function () { return []; },
    querySelector: function (sel) {
      var id = String(sel).replace(/^#/, '');
      var v = values[id];
      if (v && typeof v === 'object' && 'on' in v) {
        if (!toggles[id]) toggles[id] = {
          classList: {
            contains: function () { return !!v.on; },
            toggle: function (cls, on) { v.on = !!on; }
          }
        };
        return toggles[id];
      }
      return { value: v === undefined ? '' : v, textContent: String(v === undefined ? '' : v) };
    }
  };
}

function world(opts) {
  opts = opts || {};
  var session = Object.assign({
    id: 's1', charId: 'c1', title: 'Trial of the Ledger', messageCount: 12,
    rpgStatus: opts.status || null
  }, opts.session || {});
  var message = Object.assign({
    id: 'm1', sessionId: 's1', role: 'assistant', text: 'The forge cools.', createdAt: 2,
    rpgStatusProposal: opts.proposal || null
  }, opts.message || {});
  var seen = { sheets: [], toasts: [], put: [], msgUpdate: [] };
  var sb = {
    console: console, JSON: JSON, Promise: Promise, Object: Object, Array: Array,
    String: String, Number: Number, Math: Math, Date: Date, RegExp: RegExp, Error: Error,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite,
    setTimeout: function (fn) { return fn && fn(); }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    /* The engine is the real one: this file asks whether the UI puts the right
       questions to it, and a stubbed API would prove nothing about that. */
    Store: {
      settings: { userName: 'Sam', provider: 'horde', hordeKey: '0000000000' },
      /* The counter and transcript claims are tests/session-counter-test.js's to
         keep; this fake Store exists so the sheet has somewhere to write. */
      putSession: function (s) { seen.put.push(JSON.parse(JSON.stringify(s))); return Promise.resolve(s); },
      updateMessage: function (m) { seen.msgUpdate.push(m); return Promise.resolve(m); },
      getMessages: function () { return Promise.resolve([message]); },
      characters: [], personas: [], init: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); }
    },
    IDB: {
      get: function (store, key) {
        if (store === 'sessions' && key === session.id) return Promise.resolve(session);
        if (store === 'messages' && key === message.id) return Promise.resolve(message);
        return Promise.resolve(null);
      },
      getAll: function () { return Promise.resolve([]); },
      getAllByIndex: function () { return Promise.resolve([message]); }
    },
    Views: { thread: function () {}, appendMessage: function () { return {}; }, stickToBottom: function () {} },
    UI: {
      /* The real sheet holds its resolve open until an action is pressed, so the
         fake has to as well: closing it early is how a test ends up asserting on
         a sheet the app had already dismissed. */
      sheet: function (o) {
        var entry = { opts: o, resolve: null };
        seen.sheets.push(entry);
        if (typeof o.onMount === 'function') o.onMount(fakeBody(opts.values || {}), function () {});
        return new Promise(function (res) { entry.resolve = res; });
      },
      toast: function (t) { seen.toasts.push(t); },
      esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
      icon: function () { return ''; },
      confirm: function () { return Promise.resolve(true); }
    },
    document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {}, getElementById: function () { return null; } }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
  sb.App.state = { char: { id: 'c1', name: 'Sera' }, session: session, messages: [message], busy: false };
  return { App: sb.App, API: sb.API, session: session, message: message, seen: seen, sb: sb };
}

function textOf(html) { return String(html).replace(/<[^>]*>/g, ' '); }
function find(re, s) { var m = String(s).match(re); return m ? m[0] : '<<not found>>'; }

/* Press an action the way UI.sheet does: run its onClick against the fake inputs,
   then hand the value back to the sheet's own chain. */
function press(w, sheetIndex, label, values) {
  var entry = w.seen.sheets[sheetIndex];
  if (!entry) { ok('the sheet at ' + sheetIndex + ' opened', false); return tickAll(); }
  var act = (entry.opts.actions || []).filter(function (a) { return a.label === label; })[0];
  if (!act) {
    ok('the sheet offers "' + label + '"', false, (entry.opts.actions || []).map(function (a) { return a.label; }).join(', '));
    return tickAll();
  }
  var v = act.onClick ? act.onClick(fakeBody(values || {})) : act.value;
  entry.resolve(v);
  return tickAll(14);
}

var MANUAL = { enabled: true, level: '1', xp: 0, xpToNext: 100, rule: 'manual', attributes: {}, skills: [], inventory: [], notes: [], declined: [], suggestionsEnabled: true };

function sheetSection() {
  console.log('\nthe sheet: a curve is chosen, and the level follows it');
  var w1 = world({ status: MANUAL });
  w1.App.rpgStatusSheet('s1');
  return tickAll().then(function () {
    var sheet = w1.seen.sheets[0];
    ok('the sheet opened', !!sheet);
    var raw = sheet.opts.body, body = textOf(raw);
    ok('the sheet offers a level curve field', /id="rpg-rule"/.test(raw));
    ok('a manual sheet leaves the level editable', !/id="rpg-level"[^>]*readonly/.test(raw), find(/id="rpg-level"[^>]*/, raw));
    ok('a manual sheet still offers the typed target', /id="rpg-next"/.test(raw));
    ok('it says the AI cannot set these numbers', /the model cannot set them/.test(body));
    ok('no refusals are claimed when there are none', !/Not offered again/.test(body));
    return press(w1, 0, 'Save status', {
      'rpg-level': '7', 'rpg-xp': '0', 'rpg-rule': '100 x1.5',
      'rpg-attributes': '', 'rpg-skills': '', 'rpg-inventory': '', 'rpg-notes': '', 'rpg-suggestions': { on: true }
    });
  }).then(function () {
    var saved = w1.seen.put[0] && w1.seen.put[0].rpgStatus;
    ok('typing a curve re-derives the level from the XP, not from the box', saved && String(saved.level) === '1', 'level ' + (saved && saved.level));
    ok('the target becomes the curve\'s, not the typed one', saved && saved.xpToNext === 100, 'target ' + (saved && saved.xpToNext));
    ok('the curve is stored, not only displayed', saved && saved.rule && saved.rule.curve === 'geometric');
    var w2 = world({ status: saved });
    w2.App.rpgStatusSheet('s1');
    return tickAll().then(function () {
      var raw2 = w2.seen.sheets[0].opts.body, body2 = textOf(raw2);
      ok('the reopened sheet prints the rule in the grammar it reads back', /id="rpg-rule" type="text" maxlength="80" value="100 x1\.5"/.test(raw2), find(/id="rpg-rule"[^>]*/, raw2));
      ok('and says in plain words what it means', /100 XP per level, each one ×1\.5 the last/.test(body2), find(/level \d+ ·[^(]*/, body2));
      ok('under a curve the level box is read-only', /id="rpg-level" type="text" maxlength="40" value="1" readonly/.test(raw2), find(/id="rpg-level"[^>]*/, raw2));
      ok('under a curve the target is shown, not typed', /more XP \(at 100 total\)" readonly/.test(raw2), find(/Next level[^S]{0,60}/, body2));
      ok('and there is no editable target field left to fight with', !/id="rpg-next"/.test(raw2));
      return press(w2, 0, 'Save status', {
        'rpg-level': '1', 'rpg-xp': '325', 'rpg-rule': '100 x1.5',
        'rpg-attributes': 'Strength: 9', 'rpg-skills': '', 'rpg-inventory': '', 'rpg-notes': '', 'rpg-suggestions': { on: true }
      });
    }).then(function () {
      var s2 = w2.seen.put[0] && w2.seen.put[0].rpgStatus;
      ok('XP typed by the player walks the curve on its own', s2 && String(s2.level) === '3' && s2.xpToNext === 475,
        s2 && ('level ' + s2.level + ' next ' + s2.xpToNext));
      ok('attributes still save', s2 && s2.attributes.Strength === '9');
    });
  });
}

function reviewSection() {
  console.log('\nthe review: the numbers shown are the numbers stored');
  var w3 = world({
    status: { enabled: true, level: '3', xp: 375, xpToNext: 475, rule: { curve: 'geometric', step: 100, base: 100, growth: 1.5, steps: [], max: 0 }, attributes: {}, skills: [], inventory: [], notes: [], declined: [{ label: '+10 XP', at: 4 }], suggestionsEnabled: true },
    proposal: { state: 'pending', reason: 'The forge work pays off.', changes: [{ field: 'xp', op: 'add', value: 500 }] }
  });
  w3.App.reviewRpgStatusProposal(w3.message);
  return tickAll().then(function () {
    var raw = w3.seen.sheets[0].opts.body, body = textOf(raw);
    ok('the review shows the proposed change', /\+500 XP/.test(body), body.slice(0, 200));
    ok('it says where the rules come from', /your curve \(100 XP per level, each one ×1\.5 the last, at most 225 XP per turn\)/.test(body), find(/curve \([^)]*\)/, body));
    ok('so the cap shown is the step at the level you are on, not at level 1', /at most 225 XP per turn/.test(body));
    ok('it shows the cut before it happens', /cut this down/.test(body) && /over the cap of 225/.test(body), find(/cut this down[\s\S]{0,140}/, body));
    ok('it shows the ledger after Apply', /Your ledger after Apply: level 4 · 600 XP · 213 to the next one/.test(body), find(/Your ledger after Apply[\s\S]{0,110}/, body));
    ok('a past dismissal is on the sheet being decided', /Dismissed here are not offered again: \+10 XP/.test(body));
    return press(w3, 0, 'Apply changes', {});
  }).then(function () {
    var after = w3.seen.put[0] && w3.seen.put[0].rpgStatus;
    ok('Apply pays the cap, not the ask', after && after.xp === 600, after && ('xp ' + after.xp));
    ok('and the curve says what that is worth', after && String(after.level) === '4' && after.xpToNext === 813,
      after && ('level ' + after.level + ' next ' + after.xpToNext));
    var msg = w3.seen.msgUpdate[0];
    ok('the message records what was refused', msg && msg.rpgStatusProposal.state === 'applied' &&
      /cap of 225/.test((msg.rpgStatusProposal.dropped || []).join(' ')), JSON.stringify(msg && msg.rpgStatusProposal));
    ok('the toast says it out loud', w3.seen.toasts.some(function (t) { return /cap of 225/.test(String(t)); }),
      w3.seen.toasts.join(' | '));
  });
}

function refusalSection() {
  console.log('\nthe refusal: dismissed once, not offered again');
  var w4 = world({
    status: MANUAL,
    proposal: { state: 'pending', reason: 'A tidy hour of practice.', changes: [{ field: 'xp', op: 'add', value: 10 }] }
  });
  w4.App.reviewRpgStatusProposal(w4.message);
  return tickAll().then(function () { return press(w4, 0, 'Dismiss', {}); }).then(function () {
    var st = w4.seen.put[0] && w4.seen.put[0].rpgStatus;
    ok('a dismissal applies nothing', st && st.xp === 0, st && ('xp ' + st.xp));
    ok('a dismissal is remembered', st && st.declined.length === 1 && st.declined[0].label === '+10 XP', JSON.stringify(st && st.declined));
    ok('remembered with the turn it happened on', st && st.declined[0].at === 12, st && ('at ' + st.declined[0].at));
    var prompt = w4.API.rpgStatusPrompt({ rpgStatus: st });
    ok('and it reaches the next prompt', /REFUSED BY THE PLAYER/.test(prompt) && /\+10 XP/.test(prompt), prompt.slice(0, 200));

    /* Later is not a refusal: nothing is written and the model hears nothing, so
       a player who changes their mind can still find the row in the chat. */
    var w5 = world({
      status: MANUAL,
      proposal: { state: 'pending', reason: 'Practice.', changes: [{ field: 'xp', op: 'add', value: 10 }] }
    });
    w5.App.reviewRpgStatusProposal(w5.message);
    return tickAll().then(function () {
      var entry = w5.seen.sheets[0];
      var later = (entry.opts.actions || []).filter(function (a) { return a.label === 'Later'; })[0];
      ok('the review offers Later as a way to decide nothing', !!later);
      entry.resolve(later.onClick ? later.onClick(fakeBody({})) : later.value);
      return tickAll(14).then(function () {
        ok('Later writes nothing', w5.seen.put.length === 0 && w5.seen.msgUpdate.length === 0,
          w5.seen.put.length + '/' + w5.seen.msgUpdate.length);
        ok('Later leaves the proposal pending', w5.message.rpgStatusProposal.state === 'pending');
        ok('and records no refusal for it', !/REFUSED BY THE PLAYER/.test(w5.API.rpgStatusPrompt({ rpgStatus: w5.session.rpgStatus })));
      });
    });
  });
}

function menuSection() {
  console.log('\nthe ⋮ row, the prompt and the sheet agree');
  var w6 = world({ status: { enabled: true, level: '1', xp: 0, xpToNext: null, rule: '100', attributes: {}, skills: [], inventory: [], notes: [], declined: [], suggestionsEnabled: true } });
  w6.App.sessionMenu('s1');
  return tickAll().then(function () {
    var menu = textOf(w6.seen.sheets[0].opts.body);
    ok('the menu row carries the derived level and target', /level 1 · 0 XP · 100 to go/.test(menu), find(/RPG status[^\n]{0,60}/, menu));
    var pr = w6.API.rpgStatusPrompt({ rpgStatus: w6.session.rpgStatus });
    ok('the prompt tells the model the same cost', /needs 100 XP to advance/.test(pr));
    ok('and the same threshold', /next threshold is 100 total/.test(pr));
    ok('and the same cap', /at most 100 XP/.test(pr));
    ok('so a level in prose is refused before it is written', /a `level` or `xpToNext` change is refused/.test(pr));
    var w7 = world({ status: { enabled: true, level: 'Grandmaster', xp: 8, xpToNext: 12, rule: 'manual', attributes: {}, skills: [], inventory: [], notes: [], declined: [], suggestionsEnabled: true } });
    w7.App.sessionMenu('s1');
    return tickAll().then(function () {
      ok('a manual chat keeps its words in the menu row', /level Grandmaster · 8 XP · 4 to go/.test(textOf(w7.seen.sheets[0].opts.body)),
        find(/RPG status[^\n]{0,60}/, textOf(w7.seen.sheets[0].opts.body)));
      /* A chat that never started tracking must not sprout a curve out of nowhere. */
      var w8 = world({ status: null });
      w8.App.rpgStatusSheet('s1');
      return tickAll().then(function () {
        var b8 = w8.seen.sheets[0].opts.body;
        ok('an untracked chat opens on manual, not on a curve', /value="manual"/.test(b8), find(/id="rpg-rule"[^>]*/, b8));
        var acts8 = (w8.seen.sheets[0].opts.actions || []).map(function (a) { return a.label; });
        ok('and the save says so in one button', /Save & start tracking/.test(acts8.join(' | ')), acts8.join(' | '));
        ok('an untracked chat is not offered the way out of itself', !/Stop tracking/.test(acts8.join(' | ')), acts8.join(' | '));
      });
    });
  });
}

Promise.resolve().then(sheetSection).then(reviewSection).then(refusalSection).then(menuSection).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}).catch(function (e) {
  console.log('FAIL (threw): ' + ((e && e.stack) || e));
  process.exit(1);
});
