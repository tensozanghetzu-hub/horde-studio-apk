#!/usr/bin/env node
/* Generic-check: run before any release.
   Fails if card-specific content has leaked into the shipped app, and
   re-tests the general behaviours that card work tends to disturb.
   Usage: node tests/generic-check.js */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'horde-studio-mobile', 'js');
const SHIPPED = ['app.js', 'api.js', 'views.js', 'store.js', 'urlimport.js', 'ui.js', 'worlds.js', 'hordeworld.js', 'vhuman.js'];

let failures = 0;
function check(cond, msg, detail) {
  if (cond) { console.log('  ok   ' + msg); }
  else { failures++; console.log('  FAIL ' + msg + (detail ? '\n         ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------------ */
section('1. No card-specific content in shipped code');

/* Private names, card titles and fandom terms from cards used in testing.
   Add to this list when a card name ends up in code or a comment. */
const FORBIDDEN = [
  'nira', "veth", 'tal\'ira', 'samantha', 'voss',
  'aston', 'sloane', 'aky', 'heres-the-deal',
  'jedi', 'twi\'lek', 'padawan', 'masters', "makashi"
];

SHIPPED.forEach(f => {
  const p = path.join(JS, f);
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  const hits = [];
  FORBIDDEN.forEach(term => {
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    /* comments count: the one leak this project had was a card name in a
       code comment, not in executable code */
    src.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  });
  check(!hits.length, `${f} carries no card names`, hits.slice(0, 3).join('\n         '));
});

/* Precise leak test: no long run of text from any card kept on this machine
   may appear in the shipped app. Shape-based checks cannot tell an app prompt
   from card prose; this compares against the cards themselves. */
const CARD_DIRS = [path.join(ROOT, 'character-cards'), path.join(ROOT, 'uploads')];
let cardStrings = 0, leaked = 0;
SHIPPED.forEach(f => {
  const p = path.join(JS, f);
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  /* fields the app itself writes into cards: matching those is the app
     quoting itself, not card content leaking in */
  const APP_WRITTEN = ['creatorcomment', 'creator_notes', 'creator_notes_multilingual'];
  function walk(node, key) {
    if (typeof node === 'string' && APP_WRITTEN.indexOf(key) !== -1) return;
    if (typeof node === 'string') {
      if (node.trim().length < 80) return;
      cardStrings++;
      for (let i = 0; i + 60 <= node.length; i += 30) {
        const probe = node.slice(i, i + 60).replace(/\s+/g, ' ').trim();
        if (probe.length === 60 && src.indexOf(probe) !== -1) {
          leaked++;
          console.log('  FAIL ' + f + ' contains card text: "' + probe.slice(0, 50) + '…"');
          return;
        }
      }
    } else if (Array.isArray(node)) { node.forEach(v => walk(v, key)); }
    else if (node && typeof node === 'object') { Object.keys(node).forEach(k => walk(node[k], k)); }
  }
  CARD_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter(n => /\.json$/i.test(n)).forEach(n => {
      try { walk(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))); } catch (e) {}
    });
  });
});
check(leaked === 0, `no card text appears in shipped code (${cardStrings} strings compared)`);

/* ------------------------------------------------------------------ */
section('2. Scene cast: headings are not people');

const appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
function extractFn(src, startNeedle, endNeedle) {
  const a = src.indexOf(startNeedle);
  if (a < 0) return '';
  const b = src.indexOf(endNeedle, a);
  return src.slice(a, b + endNeedle.length);
}
const detectSrc = extractFn(appSrc, '  App.detectCast = function (char) {', '\n  };');
const repeatSrc = extractFn(appSrc, '  App.repeatScore = function (text, prevTexts) {', '\n  };');
global.App = {};
eval(detectSrc);
eval(repeatSrc);

/* a character sheet full of profile headings, one person */
const sheetCard = {
  name: 'Test Subject',
  persona: 'Basic Info\nName: Test Subject\nAge: 27\n\nFacial Features\nSharp cheekbones.\n\n' +
    'Composure First\nShe speaks calmly.\n\nBattlefield Precision\nShe reacts quickly.\n\n' +
    'Emotional Suppression\nShe does not show it.',
  scenario: '', greeting: 'She looks up.', examples: ''
};
check(App.detectCast(sheetCard).length === 0, 'a one-person sheet yields no cast',
  'got ' + JSON.stringify(App.detectCast(sheetCard)));

const groupCard = {
  name: 'Alpha',
  persona: 'Bravo Vale is the father.\n\nCharlie Vale is his daughter.\n\n' +
    'Bravo Vale said nothing.\nCharlie Vale asked about the rooms.\nCharlie Vale replied softly.\nBravo Vale asked back.',
  scenario: 'Bravo Vale and Charlie Vale are guests.',
  greeting: '"Charlie Vale said the rooms are upstairs."', examples: 'Charlie Vale: I will take the far one.'
};
const g = App.detectCast(groupCard);
check(g.length > 0, 'a genuine multi-person card still yields a cast', 'got ' + JSON.stringify(g));

/* ------------------------------------------------------------------ */
section('3. Loop guard');

const loopA = 'The door slides open and the master steps inside, taking in the state of the room.\n' +
  '"You have been reading all night," she says. "That is not discipline."\n' +
  'She turns and expects you to follow. The training ground is cold at this hour.\n' +
  'She corrects your weight, then your breathing. You adapt. She watches.\n' +
  'She walks you back to your room. "Rest," she says at the door.';
const loopB = loopA.replace('her voice level', 'her voice flat');
const fresh = 'Morning light cuts across the floor and the door opens without a knock.\n' +
  'The master is already dressed, a datapad in her hand. "The Council has moved our session."\n' +
  'She sets it down and the screen shows a city you have never seen.';

check(App.repeatScore(loopB, [loopA]) >= 0.55, 'a reworded repeat trips the guard');
check(App.repeatScore(fresh, [loopA, loopB]) < 0.55, 'a new beat does not trip the guard');

/* ------------------------------------------------------------------ */
section('4. Seam repair');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {} };
global.location = { hostname: 'localhost', origin: 'http://localhost' };
global.navigator = { userAgent: 'node' };
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.fetch = () => Promise.reject(new Error('offline'));
eval(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'));
const API = global.API;

/* fusion inside the model's own continuation */
const unfuse = API._unfuseFirstWord;
if (typeof unfuse === 'function') {
  check(unfuse('shattereach other apart.') === 'shatter each other apart.', 'fused "shattereach" separates');
  check(unfuse('Precisionover power.') === 'Precision over power.', 'fused "Precisionover" separates');
  ['understand', 'everyone', 'without', 'another', 'something'].forEach(w => {
    check(unfuse(w + ' the rest.') === w + ' the rest.', `real word "${w}" is left alone`);
  });
} else {
  check(false, 'unfuseFirstWord is exported for testing');
}

/* the trailing order must be the last thing the model reads */
const msgs = API.buildChat(
  { name: 'Test', persona: 'A person.', scenario: '', greeting: '', examples: '', lorebook: null },
  { id: 's', messages: [] },
  [{ role: 'user', text: 'hello' }],
  { systemPrompt: 'Narrate.', maxTokens: 600, temperature: 0.85, topP: 0.95, userName: 'Player' },
  null, 'SEAM-ORDER-SENTINEL'
);
check(msgs[msgs.length - 1].content === 'SEAM-ORDER-SENTINEL', 'a trailing order is sent last');
check(msgs[0].role === 'system', 'the system prompt still comes first');

/* ------------------------------------------------------------------ */
section('5. Pronoun macros');

const T = 'She takes {{poss_p}} hand and pulls {{obj}} close. {{sub}} is ready, and {{ref}} knows it.';
const she = API.macros(T, { name: 'Test' }, { userName: 'P', pronounPreset: 'she' });
check(she === 'She takes hers hand and pulls her close. she is ready, and herself knows it.',
  'she/her set resolves every pronoun macro', she);
const they = API.macros(T, { name: 'Test' }, { userName: 'P', pronounPreset: 'they' });
check(they.includes('theirs hand') && they.includes('them close'), 'they/them set resolves');
const mixed = API.macros('{{char}} {{user}} {{poss_p}} {{obj}} {{sub}} {{poss}} {{ref}}',
  { name: 'C' }, { userName: 'P', pronounPreset: 'they' });
check(!/\{\{|\}\}/.test(mixed), 'no macro braces survive substitution', mixed);
check(API.macros('{{Sub}} nods.', { name: 'C' }, { userName: 'P', pronounPreset: 'he' }) === 'He nods.',
  'a capitalised macro keeps its capital');

/* ------------------------------------------------------------------ */
section('6. No hardcoded player names');

const storeSrc = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
check(!/userName:\s*'(?!You')/i.test(storeSrc), 'default player name is generic');

/* ------------------------------------------------------------------ */
console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'all generic checks passed'));
process.exit(failures ? 1 : 0);
