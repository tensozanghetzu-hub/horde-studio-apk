#!/usr/bin/env node
/* The two bars that frame every screen, and the rows they contain.

   Reported from a phone: "when I switch to chat tabs the lower bar with the
   Cast/Life/Chats/Lore/Worlds/Settings disappears. I need to scroll max below and tap
   in the general area the bar/buttons was … or enter a chat just to see the bar."

   That description rules the usual causes out: the bar is still HIT-TESTABLE where it
   always was, so it has not moved and nothing is covering it — it has stopped being
   PAINTED. `#nav` is a child of <body>, `position:fixed;bottom:0`, and no rule anywhere
   in app.css overrides it, so no content height can push it off screen. The one thing in
   its rule that needs a layer of its own is `backdrop-filter`, and a compositor that
   skips that layer takes the bar's children with it.

   So the invariant is about the shell, not about the symptom: a bar that reserves its
   own space in the layout (which is what `.view`'s padding does) has nothing to blur —
   no content is meant to be readable through it — so it must paint from an opaque
   colour and hold no composited layer. Both bars obey that now, and this file keeps
   them obeying it, including against a theme that would make the colour translucent
   again. The chats tools row and the composer are here because the same
   cannot-shrink-flex-child problem was hiding the "Import a chat backup" control off
   the edge of the screen.

   Usage: node tests/shell-chrome-test.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var APP = path.join(ROOT, 'horde-studio-mobile');
var CSS = path.join(APP, 'css', 'app.css');
var HTML = path.join(APP, 'index.html');
var JS = path.join(APP, 'js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function stripComments(t) {
  return String(t).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
var css = stripComments(fs.readFileSync(CSS, 'utf8'));
var html = stripComments(fs.readFileSync(HTML, 'utf8'));

/* every `sel{…}` in the file, flattened one level (the file is flat by convention) */
function rules(text) {
  var out = [];
  var re = /([^{}]+)\{([^{}]*)\}/g, m;
  while ((m = re.exec(text))) {
    var sel = m[1].trim().replace(/\s+/g, ' ');
    if (sel.charAt(0) === '@') continue;           /* @supports / @keyframes wrappers */
    out.push({ sel: sel, body: m[2].replace(/\s+/g, ' ').trim() });
  }
  return out;
}
var RULES = rules(css);
/* A selector can be declared in more than one place, and the file does exactly that
   (`:root` is written twice). Every check here asks a question the whole file has to
   answer, so every check looks at all of the rules for a selector, not just the last. */
function allFor(sel) {
  return RULES.filter(function (r) { return r.sel === sel; })
    .map(function (r) { return r.body; }).join(' ');
}
/* one hop of var() indirection, enough for the theme tokens */
var TOKENS = {};
(function () {
  (allFor(':root').match(/--[a-z0-9-]+:[^;]+/g) || []).forEach(function (d) {
    var i = d.indexOf(':');
    TOKENS[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  });
})();
function resolve(value) {
  var v = String(value || '').trim(), guard = 0;
  while (/^var\(/.test(v) && guard++ < 4) {
    var name = /^\(?\s*(--[\w-]+)/.exec(v.slice(4));
    if (!name || !TOKENS[name[1]]) break;
    v = TOKENS[name[1]];
  }
  return v;
}
function isOpaque(value) {
  var v = resolve(value).replace(/\s+/g, ' ');
  if (/^#[0-9a-f]{6}$/i.test(v)) return true;
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(-2).toLowerCase() === 'ff';
  var fn = /^(rgb|hsl|color|color-mix)\(([^)]*(?:\)[^)]*)?)\)$/i.exec(v);
  if (!fn) return false;                     /* var() left unresolved, a keyword, a gradient */
  if (fn[1].toLowerCase() === 'color-mix') return false;   /* always a blend in this file */
  var parts = fn[2].split(/[,/]\s+|\s+/).filter(Boolean);
  if (parts.length <= 3) return true;                       /* rgb()/hsl(): no alpha channel */
  var a = parseFloat(parts[parts.length - 1]);
  if (/^\d+(\.\d+)?%$/.test(parts[parts.length - 1])) return a >= 100;
  return a >= 1;
}

console.log('\nwhich bars the shell makes room for');
var viewPad = allFor('.view').match(/padding:([^;]+)/);
var reserved = viewPad ? (viewPad[1].match(/--[\w-]+/g) || []) : [];
ok('the shell reserves space for its own bars in .view padding', reserved.length >= 2, reserved.join(' '));
/* a "shell bar" is a fixed element the page makes room for by height: the two that
   take --bar-h / --nav-h in a calc() are exactly those */
var shellBars = RULES.filter(function (r) {
  return /position:fixed/.test(r.body) && /height:calc\([^)]*(--bar-h|--nav-h)/.test(r.body);
});
ok('and exactly those two bars are found by this test', shellBars.length === 2,
  shellBars.map(function (r) { return r.sel; }).join(' ') || 'none');

console.log('\na shell bar paints from an opaque colour and holds no composited layer');
shellBars.forEach(function (r) {
  var body = allFor(r.sel);
  ok(r.sel + ' declares no backdrop-filter', !/backdrop-filter/.test(body),
    (body.match(/backdrop-filter:[^;]+/) || [''])[0]);
  var bg = /background-color:([^;]+)/.exec(body);
  ok('…and its background-color is opaque', !!bg && isOpaque(bg[1]),
    bg ? bg[1] : 'no background-color at all: ' + r.body.slice(0, 90));
  ok('…so the theme tint still paints over it as an image', /background-image:/.test(body),
    body.slice(0, 130));
});

console.log('\nno theme can make the bars translucent again');
(function () {
  var src = fs.readFileSync(path.join(JS, 'themes.js'), 'utf8');
  /* t(bg, bg2, …) — position 2 is the token the bars now rest on */
  var rows = src.match(/t\(\s*'[^']*',\s*'[^']*'/g) || [];
  ok('every theme in the table was found', rows.length >= 4, rows.length + ' themes');
  var bad = [];
  rows.forEach(function (line) {
    var vals = line.match(/'([^']*)'/g) || [];
    var bg2 = (vals[1] || '').replace(/'/g, '');
    if (!isOpaque(bg2)) bad.push(bg2 || '(empty)');
  });
  ok('each one sets an opaque --bg-2 for the bars to sit on', bad.length === 0, bad.join(' '));
})();

console.log('\nthe shell measures the viewport you can see, not the tallest one');
(function () {
  var big = RULES.filter(function (r) { return /(min-height|height)\s*:[^;]*100vh/.test(r.body); });
  ok('rules that size themselves to 100vh were found', big.length >= 2,
    big.map(function (r) { return r.sel; }).join(' '));
  var supports = css.match(/@supports[^{]*\{([\s\S]*?)\}\s*\}/g) || [];
  var upgraded = rules(supports.join('\n')).filter(function (r) { return /100dvh/.test(r.body); });
  var missing = big.filter(function (r) {
    return !upgraded.some(function (u) { return u.sel === r.sel; });
  });
  ok('every one of them has a 100dvh upgrade for the same selector', missing.length === 0,
    missing.map(function (r) { return r.sel + '{' + r.body.slice(0, 40) + '}'; }).join(' '));
})();

console.log('\na row cannot be pushed off screen by a control that refuses to shrink');
(function () {
  var flexRows = {};
  RULES.forEach(function (r) { if (/display:flex/.test(r.body)) flexRows[r.sel] = 1; });
  var offenders = [], sites = 0;
  RULES.forEach(function (r) {
    var parts = r.sel.split(/\s*,\s*/)[0].split(/\s+/);
    if (parts.length < 2) return;
    var parent = parts.slice(0, -1).join(' ');
    var child = parts[parts.length - 1];
    child = child.replace(/\[[^\]]*\]/g, '');
    if (!/^(input|textarea|select)$/.test(child)) return;
    if (!/flex:1/.test(r.body)) return;
    if (!flexRows[parent]) return;
    sites++;
    if (!/min-width:0/.test(r.body)) offenders.push(r.sel);
  });
  ok('flex:1 form controls inside flex rows were found at all', sites >= 3, sites + ' sites');
  ok('and each one is allowed to shrink', offenders.length === 0, offenders.join(' '));
  /* the reported case specifically: the row that carries the import control */
  ok('the chats tools row can wrap', /flex-wrap:wrap/.test(allFor('.chat-tools')), allFor('.chat-tools'));
})();

console.log('\nthe bar is the document’s, not a screen’s');
(function () {
  var navAt = html.indexOf('<nav id="nav"');
  var mainEnd = html.indexOf('</main>');
  ok('the nav sits outside <main>, so no animated screen can capture position:fixed',
    navAt > 0 && mainEnd > 0 && navAt > mainEnd, 'nav@' + navAt + ' </main>@' + mainEnd);
  var nav = /<nav id="nav"[\s\S]*?<\/nav>/.exec(html);
  var buttons = nav ? (nav[0].match(/data-go="([\w-]+)"/g) || []).map(function (s) { return /"([\w-]+)"/.exec(s)[1]; }) : [];
  ok('and it offers the six destinations the phone was tapped for', buttons.length === 6, buttons.join(' '));
  var screens = (html.match(/data-screen="([\w-]+)"/g) || []).map(function (s) { return /"([\w-]+)"/.exec(s)[1]; });
  var dangling = buttons.filter(function (b) { return screens.indexOf(b) === -1; });
  ok('every button leads to a screen that exists', dangling.length === 0, dangling.join(' '));
})();

/* ---------------- the row label, rendered by the real view ---------------- */
console.log('\na chat row counts its messages in the right words');
var BASE = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
  parseFloat: parseFloat, parseInt: parseInt, setTimeout: setTimeout, clearTimeout: clearTimeout,
  setImmediate: setImmediate, TextEncoder: TextEncoder, TextDecoder: TextDecoder
};
function node() {
  var n = { innerHTML: '', outerHTML: '', textContent: '', value: '', hidden: false, className: '',
    style: { setProperty: function () {} }, names: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function (c) { return c; }, addEventListener: function () {},
    querySelector: function () { return node(); }, querySelectorAll: function () { return []; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    closest: function () { return null; }, remove: function () {}, focus: function () {}, click: function () {},
    insertAdjacentHTML: function (_, s) { this.innerHTML += s; }, scrollIntoView: function () {} };
  return n;
}
function settle(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 6); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  return p;
}
(function () {
  var sessions = [
    { id: 's1', charId: 'cA', title: 'One', messageCount: 1, updatedAt: 5 },
    { id: 's2', charId: 'cA', title: 'Two', messageCount: 2, updatedAt: 4 },
    { id: 's3', charId: 'cA', title: 'None', messageCount: 0, updatedAt: 3 },
    { id: 's4', charId: 'cA', title: 'Summarised', messageCount: 99, summary: 'Blu and Ada argued about the gate.', updatedAt: 2 }
  ];
  var captured = {};
  function grab(key) {
    if (!captured[key]) captured[key] = node();
    return captured[key];
  }
  var doc = {
    hidden: false, body: grab('body'), documentElement: node(),
    querySelector: function (s) { return grab(String(s)); },
    getElementById: function (i) { return grab('#' + i); },
    querySelectorAll: function () { return []; },
    createElement: function () { return node(); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  var chars = [{ id: 'cA', name: 'Ada', avatar: '' }];
  var sb = Object.assign({}, BASE, {
    document: doc,
    UI: { esc: function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
      icon: function () { return '<svg></svg>'; }, fmtTime: function () { return '2h ago'; },
      toast: function () {}, uid: function (p) { return p + '-1'; } },
    Store: {
      characters: chars, settings: { userName: 'Blu' }, personas: [],
      allSessions: function () { return Promise.resolve(sessions); },
      sessionTotal: function () { return Promise.resolve(sessions.length); },
      personaLabel: function () { return 'Blu'; }, getCharacter: function () { return Promise.resolve(chars[0]); }
    },
    App: { state: { showArchived: false, chatSearch: '', search: null }, go: function () {}, openSession: function () {} },
    Views: {}, API: {}, Logs: { push: function () {} }
  });
  sb.window = sb; sb.global = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'views.js'), 'utf8'), sb, { filename: 'views.js' });
  sb.Views.chats(doc.querySelector('#screen'));
  return settle(8).then(function () {
    var out = grab('#chat-list').innerHTML;
    function row(id) {
      var parts = String(out).split('data-open="' + id + '"');
      if (parts.length < 2) return '';
      return parts[1].split('data-open=')[0];
    }
    ok('one message is said in the singular', /1 message<\//.test(row('s1')), JSON.stringify(row('s1').slice(0, 160)));
    ok('two of them are plural again', /2 messages/.test(row('s2')), JSON.stringify(row('s2').slice(0, 160)));
    ok('an empty chat says 0 messages', /0 messages/.test(row('s3')), JSON.stringify(row('s3').slice(0, 160)));
    ok('a chat with a summary still shows the summary, not a count',
      /Blu and Ada argued about the gate\./.test(row('s4')) && !/99/.test(row('s4')),
      JSON.stringify(row('s4').slice(0, 160)));
  });
})().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  ok('the suite ran', false, String((e && e.stack) || e));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});
