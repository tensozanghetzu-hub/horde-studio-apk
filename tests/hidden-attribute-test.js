#!/usr/bin/env node
/* The `hidden` attribute only works if CSS lets it.
 *
 * `hidden` is a user-agent rule — `[hidden]{display:none}` — and every author
 * rule outranks the UA sheet. So any component that sets `display:flex` on
 * itself silently ignored `hidden` and stayed on screen when the code said
 * "hide me". The generating banner did that: once a reply finished,
 * `genStop()` set `b.hidden = true` and the bar stayed under the chat as an
 * empty purple outline with nothing in it.
 *
 * Six separate `X[hidden]{display:none}` patches existed in the stylesheet —
 * typing, toast, the sheet, the icon buttons, the attachment stage, the world
 * HUD — so this bug had been found six times, one symptom at a time, and the
 * seventh component (the banner) had not been.
 *
 * This test enforces the general form instead: if any element marked `hidden`
 * in the markup belongs to a component that sets its own `display`, the
 * stylesheet must carry the global guard.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var HTML = path.join(ROOT, 'horde-studio-mobile', 'index.html');
var CSS = path.join(ROOT, 'horde-studio-mobile', 'css', 'app.css');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

var html = stripComments(fs.readFileSync(HTML, 'utf8'));
var css = stripComments(fs.readFileSync(CSS, 'utf8'));

/* ---- what the markup says should be hideable ------------------------ */
var hiddenEls = [];
var tagRe = /<([a-z][a-z0-9-]*)([^>]*\bhidden\b[^>]*)>/gi, m;
while ((m = tagRe.exec(html))) {
  var attrs = m[2];
  var idm = /id="([^"]+)"/.exec(attrs);
  var clm = /class="([^"]+)"/.exec(attrs);
  hiddenEls.push({
    tag: m[1],
    id: idm ? idm[1] : null,
    classes: clm ? clm[1].split(/\s+/).filter(Boolean) : []
  });
}
ok('the markup marks elements hidden', hiddenEls.length > 5, String(hiddenEls.length));

/* ---- which of them could have their display overridden -------------- */
var rules = [];
var ruleRe = /([^{}]+)\{([^{}]*)\}/g, r;
while ((r = ruleRe.exec(css))) {
  var sel = r[1].trim(), body = r[2];
  if (/(^|;)\s*display\s*:/.test(body)) rules.push(sel);
}

/* Only rules whose LAST compound could be this element — a descendant rule
   like `.char-state .cs-row` styles something inside, not the element itself,
   and must not be counted. */
function lastCompound(sel) {
  var p = sel.trim().split(/\s*(?:>|\+|~)\s*|\s+/);
  return p[p.length - 1] || '';
}
function ruleMatches(el, sel) {
  var parts = sel.split(',').map(function (p) { return lastCompound(p); });
  return parts.some(function (p) {
    if (el.id) {
      var re = new RegExp('#' + el.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
      if (re.test(p)) return true;
    }
    return el.classes.some(function (c) {
      var re = new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
      return re.test(p) && p.indexOf('#') === -1;
    });
  });
}
function atRisk(el) {
  return rules.filter(function (sel) {
    if (sel.indexOf('[hidden]') !== -1) return false;      /* a guard, not a risk */
    return ruleMatches(el, sel);
  });
}
function hasOwnGuard(el) {
  return rules.filter(function (sel) {
    return sel.indexOf('[hidden]') !== -1 && ruleMatches(el, sel.replace(/\[hidden\]/g, ''));
  }).length > 0;
}

var risky = hiddenEls.filter(function (el) { return atRisk(el).length; });

console.log('\nthe banner that started this');
var banner = hiddenEls.filter(function (el) { return el.id === 'gen-banner'; })[0];
ok('the generating banner is marked hidden in the markup', !!banner);
ok('…and its component sets its own display', banner && atRisk(banner).length > 0,
  banner ? JSON.stringify(atRisk(banner)) : 'no banner');
ok('…and it is hidden again when generation stops',
  /b\.hidden = true/.test(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js'), 'utf8')));

console.log('\nthe general guard');
var globalGuard = /(^|[},;])\s*\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
ok('[hidden]{display:none !important} exists', globalGuard,
  'without it, any component with its own display ignores the attribute');

console.log('\nevery hideable element is covered');
ok(risky.length > 0, 'at least one element needs the guard (' + risky.length + ' found)',
  'if this ever reads 0, the test has stopped testing anything');
var uncovered = risky.filter(function (el) { return !globalGuard && !hasOwnGuard(el); });
ok('no element is left relying on a per-component patch',
  uncovered.length === 0,
  uncovered.map(function (el) { return '#' + (el.id || el.classes.join('.')); }).join(', '));
ok('the guard uses !important, so it beats a more specific author rule',
  /\[hidden\]\s*\{[^}]*!important/.test(css));

console.log('\nthe guard does not fight the code');
var js = fs.readFileSync(path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js'), 'utf8');
ok('code shows elements by clearing the attribute, not by class',
  /\.hidden = false/.test(js), 'clearing it is what the guard expects');
ok('no code sets hidden and then expects the element to show',
  !/\.hidden\s*=\s*true[^\n]*display/.test(js));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
