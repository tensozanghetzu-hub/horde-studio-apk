/* v1.31.0 — personas keep their face: each persona can import a photo for
 * its avatar, and that photo is what the player sees for that identity.
 *
 *   - the persona record carries `avatar` (never settings)
 *   - the personas screen shows the photo in each row and offers
 *     import/remove controls (initials until one is set)
 *   - the identity bar's chip shows the persona's face
 *   - the player's own chat bubbles show the active persona's photo
 *     instead of initials; the default identity keeps initials
 *
 *   node /home/user/tests/personaavatar-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, 'horde-studio-mobile', p); }

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ---------------- a small honest DOM (worldavatar pattern) ------------ */
function el(extra) {
  var e = {
    hidden: false, innerHTML: '', textContent: '', value: '',
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    addEventListener: function () {},
    getAttribute: function () { return null; },
    setAttribute: function () {},
    remove: function () {}
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
var bar = el();
var documentStub = {
  addEventListener: function () {},
  querySelector: function () { return el(); },
  querySelectorAll: function (sel) { return sel === '.persona-bar' ? [bar] : []; },
  getElementById: function () { return el(); },
  createElement: function () { return el(); }
};

var AV = 'data:image/jpeg;base64,FACERIN';
var personas = [
  { id: 'p1', name: 'Rin', text: 'the wanderer', avatar: AV, createdAt: 1, updatedAt: 1 },
  { id: 'p2', name: 'NoPic', text: '', createdAt: 2, updatedAt: 2 }   /* no avatar key, like an old record */
];

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, setTimeout: setTimeout,
  navigator: {},
  location: { protocol: 'file:' },
  scrollTo: function () {},
  document: documentStub,
  UI: {
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    md: function (s) { return String(s || ''); },
    icon: function (name) { return '<svg data-icon="' + name + '"></svg>'; },
    toast: function () {},
    sheet: function () {},
    lightbox: function () {}
  },
  Store: {
    personas: personas,
    settings: { activePersona: 'p1', defaultName: 'Marcus', userName: 'Rin' }
  },
  App: {},
  IDB: { getAll: function () { return Promise.resolve([]); } }
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(fs.readFileSync(src('js/views.js'), 'utf8'), sandbox, { filename: 'views.js' });

var Views = sandbox.Views;

/* ====================================================================== */

console.log('\nA. the personas screen rows carry the photo');

var rows = Views.personaRowsHtml(personas, 'p1');
ok('every row still has its name field', rows.split('data-persona-name').length - 1 === 2);
ok('every row still has its text field', rows.split('data-persona-text').length - 1 === 2);
ok('a persona with a photo shows it in the row',
  rows.indexOf('data-persona-av="p1"') !== -1 && rows.indexOf(AV) !== -1);
ok('…and gets the remove dot', rows.indexOf('data-persona-avdel="p1"') !== -1);
ok('a persona without a photo carries no remove dot',
  rows.indexOf('data-persona-avdel="p2"') === -1);
/* the p2 fallback: initials inside the thumb button */
var p2row = rows.slice(rows.indexOf('data-prow="p2"'));
ok('a photo-less persona falls back to initials',
  p2row.indexOf('data-persona-av="p2"') !== -1 && p2row.indexOf('class="ph"') !== -1,
  p2row.slice(0, 400));

console.log('\nB. the identity bar chip shows the face');

Views.renderPersonaBar();
ok('the bar is visible with personas to switch between', bar.hidden === false);
ok('a persona with a photo gets the face in its chip',
  bar.innerHTML.indexOf('class="pchip-av"') !== -1 && bar.innerHTML.indexOf(AV) !== -1);
ok('a persona without one keeps the user icon',
  /data-persona="p2"[^>]*><svg data-icon="user"/.test(bar.innerHTML), bar.innerHTML);
ok('the default identity chip keeps the user icon too',
  /data-persona=""[^>]*><svg data-icon="user"/.test(bar.innerHTML));

console.log('\nC. the player\'s own chat bubbles show the active persona\'s photo');

var m = { role: 'user', text: 'hello there', id: 'm1' };
var char = { name: 'Sera', avatar: '' };
var withPhoto = Views.messageHtml(m, char, { userName: 'Rin', activePersona: 'p1' });
ok('the user bubble shows the persona photo', withPhoto.indexOf(AV) !== -1);
var theirs = Views.messageHtml({ role: 'assistant', text: 'hi', id: 'm2' }, char, { userName: 'Rin', activePersona: 'p1' });
ok('the character side is untouched',
  theirs.indexOf('>Sera<') !== -1 && theirs.indexOf(AV) === -1);

var noPersona = Views.messageHtml(m, char, { userName: 'Marcus' });
ok('the default identity keeps initials', noPersona.indexOf('>M<') !== -1 && noPersona.indexOf(AV) === -1);

var noPhoto = Views.messageHtml(m, char, { userName: 'NoPic', activePersona: 'p2' });
ok('a persona without a photo keeps initials',
  noPhoto.indexOf('>N<') !== -1 && noPhoto.indexOf(AV) === -1);

var deleted = Views.messageHtml(m, char, { userName: 'Ghost', activePersona: 'pGONE' });
ok('a missing persona record falls back to initials safely',
  deleted.indexOf('>G<') !== -1);

console.log('\nD. the helper itself');

eq('no active persona means no photo', Views.activePersonaAvatar({}), '');
eq('the active persona lends its photo', Views.activePersonaAvatar({ activePersona: 'p1' }), AV);
eq('a photo-less active persona lends nothing', Views.activePersonaAvatar({ activePersona: 'p2' }), '');
eq('a stale reference lends nothing', Views.activePersonaAvatar({ activePersona: 'pGONE' }), '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
