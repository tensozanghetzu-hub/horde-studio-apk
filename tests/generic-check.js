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

/* ------------------------------------------------------------------
 * v1.39.88 — the rule this file exists to enforce, in one sentence:
 *
 *   A fix targets the CLASS of problem, never one card. It must leave every
 *   other card — present or future — working exactly as it did, and it must be
 *   useful to anyone, not just the card that prompted it.
 *
 * Two mechanical consequences, checked below:
 *   - no name, line or phrase from any card may appear in shipped code, in a
 *     prompt, or in a comment;
 *   - the tests that describe a bug use the SHAPE of the card (field blocks,
 *     rotas, quoted labels), not its prose.
 *
 * The forbidden list is now derived from the cards themselves rather than
 * maintained by hand, so a new card cannot be tested without its names
 * becoming forbidden at the same moment.
 * ------------------------------------------------------------------ */

/* Read a card wherever it lives: JSON, or a PNG/CHARX with the usual `chara`
   or `ccv3` text chunk holding base64 JSON. */
function readCardFile(p) {
  const ext = path.extname(p).toLowerCase();
  try {
    if (ext === '.json') return [JSON.parse(fs.readFileSync(p, 'utf8'))];
    if (ext === '.png') {
      const buf = fs.readFileSync(p);
      const out = [];
      let i = 8;
      while (i + 8 <= buf.length) {
        const len = buf.readUInt32BE(i);
        const type = buf.toString('latin1', i + 4, i + 8);
        const data = buf.subarray(i + 8, i + 8 + len);
        if (type === 'tEXt' || type === 'iTXt') {
          const z = data.indexOf(0);
          const key = data.toString('latin1', 0, z);
          if (key === 'chara' || key === 'ccv3') {
            const val = data.subarray(z + 1).toString('latin1');
            try {
              const json = JSON.parse(Buffer.from(val, 'base64').toString('utf8'));
              out.push(json && json.data ? json.data : json);
            } catch (e) { /* not a card */ }
          }
        }
        i += 12 + len;
        if (type === 'IEND') break;
      }
      return out;
    }
  } catch (e) { /* unreadable file: not this check's failure */ }
  return [];
}

const CARD_DIRS = [path.join(ROOT, 'character-cards'), path.join(ROOT, 'uploads')];
const cardDocs = [];
CARD_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter(n => /\.(json|png|charx)$/i.test(n)).forEach(n => {
    readCardFile(path.join(dir, n)).forEach(d => cardDocs.push(d));
  });
});

/* Names come off the cards: the character name, the author, and anything a
   card declares in its own rota. Only distinctive words survive — a card
   called "The Landlady" forbids nothing, because those words are the app's
   own vocabulary. */
const CARD_WORDS = ['user', 'character', 'assistant', 'narrator', 'everyone',
  'player', 'scene', 'cast', 'wife', 'husband', 'father', 'mother', 'daughter',
  'son', 'sister', 'brother', 'friend', 'boss', 'teacher', 'student', 'nurse',
  'doctor', 'landlady', 'landlord', 'the', 'a', 'an', 'of', 'and'];
const derivedNames = new Set();
cardDocs.forEach(d => {
  [d.name, d.creator, d.character_name].forEach(v => {
    String(v || '').split(/[^A-Za-z'’-]+/).forEach(w => {
      if (w.length >= 4 && CARD_WORDS.indexOf(w.toLowerCase()) === -1) derivedNames.add(w.toLowerCase());
    });
  });
  /* rota bullets: "- **Name** — …" */
  String(d.description || d.persona || '').split('\n').forEach(line => {
    const m = /^\s*[-*•]\s+\*\*([^*]{2,40})\*\*/.exec(line);
    if (!m) return;
    m[1].split(/[^A-Za-z'’-]+/).forEach(w => {
      if (w.length >= 4 && CARD_WORDS.indexOf(w.toLowerCase()) === -1) derivedNames.add(w.toLowerCase());
    });
  });
});

/* A name that is an ordinary word in the app's own vocabulary cannot be used
   as a detection signal — "Your Wife (Mara)" must not forbid the word "your".
   The shipped code is its own dictionary: a word the app uses constantly is
   vocabulary, a word it never uses is a name. */
const shippedAll = SHIPPED.map(f => {
  const p = path.join(JS, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').toLowerCase() : '';
}).join('\n');
const vocabulary = new Set();
derivedNames.forEach(name => {
  const count = shippedAll.split(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')).length - 1;
  if (count > 5) { vocabulary.add(name); derivedNames.delete(name); }
});
check(true, 'card names are derived from the cards on disk (' + derivedNames.size + ' names, ' +
  vocabulary.size + ' card words that are also app vocabulary: ' +
  (Array.from(vocabulary).slice(0, 6).join(', ') || 'none') + ')');

/* Every name derived from a card must be absent from shipped code — including
   from comments and prompts. This is the check that makes "never target one
   card" testable instead of a promise. */
if (derivedNames.size) {
  const leaks = [];
  SHIPPED.forEach(f => {
    const p = path.join(JS, f);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    derivedNames.forEach(name => {
      const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      src.split('\n').forEach((line, i) => {
        if (re.test(line)) leaks.push(`${f}:${i + 1} names a card: ${line.trim().slice(0, 90)}`);
      });
    });
  });
  check(leaks.length === 0, 'no shipped line names anything a card on disk calls itself or its cast',
    leaks.slice(0, 6).join('\n         '));
}

/* Precise leak test: no long run of text from any card kept on this machine
   may appear in the shipped app. Shape-based checks cannot tell an app prompt
   from card prose; this compares against the cards themselves. */
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
  cardDocs.forEach(doc => walk(doc));
});
if (cardStrings === 0) {
  console.log('  skip no card text appears in shipped code — no cards on disk');
  console.log('       (this pass is optional: the hardcoded-name check above still ran)');
  console.log('       to run it, drop a card JSON into character-cards/ for one release check');
} else {
  check(leaked === 0, `no card text appears in shipped code (${cardStrings} strings compared)`);
}

/* The build and the app must not reach into card folders at all. A card may
   be dropped in for a check, but nothing may depend on one being there. */
/* The build pipeline must not touch a card folder: a card may be dropped in for
   a check, but nothing may depend on one. sync-github.sh is the exception and is
   checked the other way round — it must keep its guard that refuses to publish
   anything card-shaped. */
const BUILD_INPUTS = ['apk-build/build.sh', 'tools/build-channel.py',
                      '.github/workflows/release.yml'];
let cardRefs = [];
BUILD_INPUTS.forEach(rel => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (/character-cards|uploads\//.test(line)) {
      cardRefs.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`);
    }
  });
});
check(cardRefs.length === 0, 'the build pipeline never reads a card folder',
  cardRefs.join('\n         '));

const syncSrc = fs.existsSync(path.join(ROOT, 'sync-github.sh'))
  ? fs.readFileSync(path.join(ROOT, 'sync-github.sh'), 'utf8') : '';
check(/character-cards/.test(syncSrc) && /refus/i.test(syncSrc),
  'sync-github.sh still refuses to publish card files');

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
/* {{Poss_p}} carries a capital P as part of its NAME, not as a case signal */
check(API.macros('takes {{Poss_p}} hand', { name: 'C' }, { userName: 'P', pronounPreset: 'she' }) === 'takes hers hand',
  '{{Poss_p}} does not capitalise mid-sentence');
check(API.macros('{{Poss}} choice', { name: 'C' }, { userName: 'P', pronounPreset: 'she' }) === 'Her choice',
  '{{Poss}} at the start still capitalises');

/* ------------------------------------------------------------------ */
section('6. No hardcoded player names');

const storeSrc = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
check(!/userName:\s*'(?!You')/i.test(storeSrc), 'default player name is generic');

/* ------------------------------------------------------------------ */
console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'all generic checks passed'));
process.exit(failures ? 1 : 0);
