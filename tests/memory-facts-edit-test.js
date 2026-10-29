/* memory-facts-edit-test — edit/add/delete must stay inline in the single
   Memory sheet (nested UI.sheet dialogs replace and destroy the parent), and
   Save must persist changes into storage and the active session. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js/app.js'), 'utf8');
const start = app.indexOf('App.memorySheet = function (sessionId) {');
const end = app.indexOf('\n  };', start) + 5;
const block = app.slice(start, end);
let pass = 0, fail = 0;
function ok(label, yes, detail) { if (yes) { pass++; console.log('  ok   ' + label); } else { fail++; console.log('  FAIL ' + label + (detail ? ' → ' + detail : '')); } }

console.log('A — edit stays in the Memory sheet instead of opening a destructive nested modal');
ok('fact rows render an explicit edit action', /data-edit-fact/.test(block));
ok('edit control opens an inline prefilled multiline editor', /data-fact-edit/.test(block) && /data-save-fact/.test(block) && /data-cancel-edit/.test(block));
ok('inline edits update the working fact and rerender', block.indexOf('facts[i] = edited;') !== -1 && block.indexOf('render(body);', block.indexOf('facts[i] = edited;')) !== -1);
ok('editing no longer launches a nested sheet', !/UI\.input\('Edit fact'/.test(block));
console.log('B — delete confirmation stays inline too');
ok('fact rows render an explicit remove action', /data-remove-fact/.test(block));
ok('removal has inline confirm and cancel controls', /data-confirm-delete/.test(block) && /data-cancel-delete/.test(block));
ok('delete no longer launches a nested confirm sheet', !/UI\.confirm\('Remove fact\?'/i.test(block));
console.log('C — add stays in the Memory sheet');
ok('add uses an inline editor', /data-new-fact/.test(block) && /data-save-new-fact/.test(block));
ok('add no longer launches a nested input sheet', !/UI\.input\('New fact'/.test(block));
console.log('D — Save makes changes live for the next prompt');
ok('Save persists the updated fact list', /s\.facts\s*=\s*facts[\s\S]{0,160}Store\.putSession\(s\)/.test(block));
ok('Save refreshes the active in-memory session', /App\.state\.session\s*=\s*s/.test(block));

// Small DOM double to exercise the real memorySheet event handlers.
function Element(attrs, value) { this.attrs = attrs || {}; this.value = value || ''; this.onclick = null; }
Element.prototype.getAttribute = function (key) { return this.attrs[key] == null ? null : String(this.attrs[key]); };
Element.prototype.focus = function () {};
function Body() {
  var self = this;
  this.summary = new Element({}, '');
  this.add = new Element({}, '');
  this.regen = new Element({}, '');
  this.inject = new Element({}, '');
  this.inputs = {};
  this.nodes = {};
  this.facts = { _html: '' };
  Object.defineProperty(this.facts, 'innerHTML', { get: function () { return self.facts._html; }, set: function (v) { self.facts._html = v; } });
}
Body.prototype.querySelector = function (selector) {
  if (selector === '#facts') return this.facts;
  if (selector === '#sum') return this.summary;
  if (selector === '#addfact') return this.add;
  if (selector === '#regen') return this.regen;
  if (selector === '#inject') return this.inject;
  var edit = selector.match(/^\[data-fact-edit="(\d+)"\]$/);
  if (edit) return this.inputs['edit' + edit[1]] || (this.inputs['edit' + edit[1]] = new Element({}, 'old fact'));
  if (selector === '[data-new-fact]') return this.inputs.newfact || (this.inputs.newfact = new Element({}, ''));
  return null;
};
Body.prototype.querySelectorAll = function (selector) {
  var m = selector.match(/\[data-([a-z-]+)\]/);
  if (!m) return [];
  var attr = 'data-' + m[1];
  var re = new RegExp(attr + '(?:="([^"]*)")?', 'g'), hit, out = [];
  while ((hit = re.exec(this.facts.innerHTML))) {
    var value = hit[1] == null ? '' : hit[1], key = attr + ':' + value;
    if (!this.nodes[key]) { var a = {}; a[attr] = value; this.nodes[key] = new Element(a); }
    out.push(this.nodes[key]);
  }
  return out;
};

(async function behavior() {
  var session = { id: 's1', title: 'Chat', summary: 'Summary', facts: ['old fact', 'remove me'] };
  var active = { id: 's1', facts: ['stale'] }, stored = null, opts = null, body = null;
  var sb = {
    App: { state: { session: active } },
    IDB: { get: function () { return Promise.resolve(session); } },
    Store: { settings: { memoryEvery: 14 }, putSession: function (s) { stored = s; session.facts = s.facts; return Promise.resolve(s); } },
    UI: {
      sheet: function (o) { opts = o; body = new Body(); o.onMount(body, function () {}); return Promise.resolve(); },
      input: function () { throw new Error('nested input replaced the Memory sheet'); },
      confirm: function () { throw new Error('nested confirm replaced the Memory sheet'); },
      toast: function () {}
    },
    esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    icon: function () { return ''; }, Promise, String, Object, Array, parseInt
  };
  vm.createContext(sb);
  vm.runInContext(block, sb);
  sb.App.memorySheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));

  function button(selector, value) {
    var all = body.querySelectorAll('#facts ' + selector);
    if (value == null) return all[0];
    return all.find(el => Object.keys(el.attrs).some(k => el.attrs[k] === String(value)));
  }
  var edit = button('[data-edit-fact]');
  edit.onclick();
  var editInput = body.querySelector('[data-fact-edit="0"]');
  editInput.value = 'corrected fact';
  button('[data-save-fact]').onclick();
  ok('editing changes the fact without closing the Memory sheet', body.facts.innerHTML.indexOf('corrected fact') !== -1);

  var remove = button('[data-remove-fact]', 1);
  remove.onclick();
  ok('delete confirmation appears inside the same sheet', body.facts.innerHTML.indexOf('Remove this fact?') !== -1);
  button('[data-confirm-delete]').onclick();
  ok('confirmed delete removes the selected fact inline', body.facts.innerHTML.indexOf('remove me') === -1);

  body.add.onclick();
  body.querySelector('[data-new-fact]').value = 'new user fact';
  button('[data-save-new-fact]').onclick();
  ok('add creates a fact without replacing the Memory sheet', body.facts.innerHTML.indexOf('new user fact') !== -1);

  var save = opts.actions.find(a => a.label === 'Save');
  await save.onClick(body);
  ok('save stores edited, deleted, and added facts', !!stored && JSON.stringify(stored.facts) === JSON.stringify(['corrected fact', 'new user fact']), JSON.stringify(stored && stored.facts));
  ok('save refreshes the active chat memory', JSON.stringify(sb.App.state.session.facts) === JSON.stringify(['corrected fact', 'new user fact']));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
