/* editintros-test — v1.39.15: intro swipes inside the character editor.
 *
 * Cards carry up to a dozen first messages (greeting + alternateGreetings),
 * and the chat already swipes them (‹ n / N ›). The editor only showed the
 * main greeting — the alternates were invisible and uneditable there, and
 * there was no way to add another one by hand (e.g. paste an intro copied
 * from the card's page).
 *
 * The editor now drives a small nav model, Views.introNavModel(char):
 *   - builds [greeting].concat(alternateGreetings) as swipeable slots
 *   - move() steps/wraps exactly like the chat's ‹ n / N › arrows
 *   - set() writes the textarea back into THE slot being viewed, so saving
 *     while looking at intro k does not clobber the main greeting
 *   - add() appends an empty slot and jumps to it — "paste it here"
 *   - remove() drops the shown alternate, never the main greeting, and the
 *     model never mutates the character's original array by aliasing
 *   - collect() writes back greeting + alternates with empty slots dropped
 *
 *   node /home/user/tests/editintros-test.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};

function loadViews() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp,
    Error, isNaN, parseFloat, parseInt,
    fetch: () => Promise.resolve({ ok: false }),
    UI: {
      esc: s => String(s == null ? '' : s),
      md: s => String(s || ''),
      icon: n => '<svg data-icon="' + n + '"></svg>'
    },
    Store: { settings: { userName: 'T' } },
    document: { querySelector: () => null, querySelectorAll: () => [] }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  return sandbox.Views;
}

console.log('A — the model builds from the character');
const Views = loadViews();
ok('introNavModel exists', typeof Views.introNavModel === 'function');
if (typeof Views.introNavModel !== 'function') {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

const char = { greeting: 'Intro one.', alternateGreetings: ['Intro two.', 'Intro three.'] };
let nav = Views.introNavModel(char);
ok('three slots for greeting + two alternates', nav.count() === 3, nav.count());
ok('starts on the main greeting', nav.index() === 0 && nav.text() === 'Intro one.', nav.text());
ok('label matches the chat counter style', nav.label() === '1 / 3', nav.label());

nav = Views.introNavModel({ greeting: 'Only one.' });
ok('no alternates → a single slot', nav.count() === 1 && nav.label() === '1 / 1');
nav = Views.introNavModel({});
ok('blank sheet → one empty slot', nav.count() === 1 && nav.text() === '');
nav = Views.introNavModel({ greeting: 'G', alternateGreetings: 'not-an-array' });
ok('a junk alternates field degrades to the greeting alone', nav.count() === 1 && nav.text() === 'G');

console.log('\nB — swiping steps and wraps like the chat arrows');
nav = Views.introNavModel({ greeting: 'one', alternateGreetings: ['two', 'three'] });
ok('forward', nav.move(1) === 'two' && nav.index() === 1 && nav.label() === '2 / 3');
ok('forward again', nav.move(1) === 'three' && nav.index() === 2);
ok('forward wraps to the start', nav.move(1) === 'one' && nav.index() === 0);
ok('backward wraps to the end', nav.move(-1) === 'three' && nav.index() === 2 && nav.label() === '3 / 3');
nav = Views.introNavModel({ greeting: 'solo' });
ok('a single intro does not move', nav.move(1) === 'solo' && nav.index() === 0);

console.log('\nC — writing back hits the slot on show, not the main greeting');
nav = Views.introNavModel({ greeting: 'main', alternateGreetings: ['alt A', 'alt B'] });
nav.move(1); nav.move(1);        /* onto slot 3 */
nav.set('alt B edited');
nav.move(1);                     /* wraps back to the main greeting */
ok('the main greeting is untouched', nav.text() === 'main', nav.text());
nav.move(-1);                    /* back to slot 3 */
ok('the edit landed in slot 3', nav.text() === 'alt B edited', nav.text());
nav.move(1);                     /* main greeting */
nav.set('main edited');
nav.move(1);                     /* slot 2 */
ok('editing the main greeting keeps the alternates', nav.text() === 'alt A', nav.text());

console.log('\nD — adding a fresh intro');
nav = Views.introNavModel({ greeting: 'one', alternateGreetings: ['two'] });
const added = nav.add();
ok('add lands on an empty new last slot', nav.count() === 3 && nav.index() === 2 && added === '');
ok('label follows', nav.label() === '3 / 3');
nav.set('pasted from the card page');
nav.collect ? null : null;
ok('the paste stays put', nav.text() === 'pasted from the card page');

console.log('\nE — removing intros');
nav = Views.introNavModel({ greeting: 'main', alternateGreetings: ['A', 'B'] });
ok('the main greeting refuses to be removed', nav.remove() === false && nav.count() === 3);
nav.move(2);
ok('removing an alternate works', nav.remove() === true && nav.count() === 2);
ok('…and steps back to a valid slot', nav.index() === 1 && nav.text() === 'A', nav.index() + ':' + nav.text());
nav.remove();
ok('removing down to one leaves the main greeting', nav.count() === 1 && nav.index() === 0 && nav.text() === 'main');
ok('remove at one slot is a no-op', nav.remove() === false && nav.count() === 1);

console.log('\nF — collect writes the sheet back, empties dropped, no aliasing');
const original = ['keep me', '   ', '  keep me too  '];
const sheet = { greeting: 'first', alternateGreetings: original };
nav = Views.introNavModel(sheet);
nav.add();                       /* an empty slot the user never filled — add() lands on it… */
nav.remove();                    /* …and it is dropped again before saving */
const before = original.slice();
nav.collect();
ok('the card array was never mutated in place', JSON.stringify(original) === JSON.stringify(before), JSON.stringify(original));
ok('greeting round-trips', sheet.greeting === 'first');
ok('alternates keep order, whitespace-only slots dropped, real ones kept verbatim',
  JSON.stringify(sheet.alternateGreetings) === JSON.stringify(['keep me', '  keep me too  ']),
  JSON.stringify(sheet.alternateGreetings));
nav = Views.introNavModel({ greeting: '', alternateGreetings: [] });
nav.add(); nav.set('');          /* added but left blank */
nav.collect();
const bare = { greeting: '', alternateGreetings: undefined };
nav = Views.introNavModel(bare);
nav.collect();
ok('a blank sheet collects to no alternates',
  Array.isArray(bare.alternateGreetings) && bare.alternateGreetings.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
