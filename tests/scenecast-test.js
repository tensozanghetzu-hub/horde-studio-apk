#!/usr/bin/env node
/* Scene cast detection — a field label is not a person.
 *
 * Reported from a real card: the Scene strip listed "Main INTRO", "Rose" and
 * "Relationship" as though three people were standing on the porch. Only Rose
 * was. The scan treated any `Capitalised words:` line as a speaker, so section
 * headings and profile fields came through with the cast.
 *
 * The rule now: a name is a person only if the card uses it to SPEAK — words
 * after the colon, or a speech verb in the prose — and does so more than once.
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
function same(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}

/* pull App.detectCast out of app.js without booting the whole app */
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var start = appSrc.indexOf('  App.detectCast = function (char) {');
var end = appSrc.indexOf('\n  };', start) + 4;
ok('detectCast is where the test expects it', start > 0 && end > start);
var sb = { console: console, Object: Object, Array: Array, String: String, RegExp: RegExp, Math: Math };
sb.window = sb;
vm.runInNewContext(appSrc.slice(start, end) + '\nthis.App = App;', Object.assign(sb, { App: {} }), { filename: 'app.detectCast.js' });
var detectCast = sb.App.detectCast;

/* ------------------------------------------------------------------ */
console.log('\nthe reported card — one person, two headings');

var widow = {
  name: 'Your Lonely Widow Landlady',
  persona: 'Name: Rosalind Chase\nAge: 34\nOccupation: Landlady\n' +
    'Relationship: Widow. Your neighbour across the street.\n' +
    'Appearance: Floral dresses, bare feet.',
  greeting: 'The screen door creaks open, and Rose steps out onto the porch with two glasses of lemonade.',
  scenario: 'Rosalind Chase\'s house — front porch.',
  examples: 'Main INTRO:\n{{char}}: The screen door creaks open.\n' +
    '<START>\n{{char}}: Evening.\n' +
    'Relationship:\nShe has known you for years.'
};
var cast = detectCast(widow);
ok('"Main INTRO" is not a person', cast.indexOf('Main INTRO') === -1, JSON.stringify(cast));
ok('"Relationship" is not a person', cast.indexOf('Relationship') === -1, JSON.stringify(cast));
ok('"Rosalind Chase" is not added from the Name field alone',
  cast.indexOf('Rosalind Chase') === -1, JSON.stringify(cast));
same('nothing is invented for a one-person card', cast, []);

console.log('\nthe screen agrees with the prompt');
var oneName = { sceneCast: ['Rose'], scenePresent: ['Rose'] };
var apiSb = {
  Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
  String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
  setTimeout: function () { }, localStorage: { getItem: function () { return null; }, setItem: function () { } },
  location: { hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
apiSb.window = apiSb;
vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), apiSb, { filename: 'api.js' });
var API = apiSb.API;
var ai = { id: 'a', name: 'Rose', persona: 'p', greeting: 'g', examples: '', scenario: '' };
var one = API.buildChat(ai, oneName, [{ role: 'user', text: 'Hello.' }], { userName: 'Blu', systemPrompt: 'x', maxTokens: 600 });
ok('a single name never injects the cast override',
  one[0].content.indexOf('SCENE CAST') === -1, one[0].content.slice(0, 120));
var two = API.buildChat(ai, { sceneCast: ['Rose', 'Tom'], scenePresent: ['Rose'] },
  [{ role: 'user', text: 'Hello.' }], { userName: 'Blu', systemPrompt: 'x', maxTokens: 600 });
ok('two names still do', two[0].content.indexOf('SCENE CAST') !== -1);

/* ------------------------------------------------------------------ */
console.log('\nreal people are still found');

var group = {
  name: 'Alpha',
  persona: 'Bravo Vale is the father.\n\nCharlie Vale is his daughter.\n\n' +
    'Bravo Vale said nothing. Charlie Vale asked about the rooms.\n' +
    'Charlie Vale replied softly. Bravo Vale asked back.',
  scenario: 'Bravo Vale and Charlie Vale are guests.',
  greeting: '"Charlie Vale said the rooms are upstairs."',
  examples: 'Charlie Vale: I will take the far one.'
};
var g = detectCast(group);
ok('a genuine multi-person card still yields a cast', g.length >= 2, JSON.stringify(g));
ok('…and the speakers are the ones found',
  g.indexOf('Charlie Vale') !== -1 && g.indexOf('Bravo Vale') !== -1, JSON.stringify(g));

var labelOnly = {
  name: 'Nobody', persona: '', scenario: '', greeting: '',
  examples: 'Mara: Sit down.\nMara: You look tired.'
};
same('two speaking labels are enough', detectCast(labelOnly), ['Mara']);

var oneLine = {
  name: 'Nobody', persona: '', scenario: '', greeting: '',
  examples: 'Joss: Get out.'
};
same('a single speaking line is not a cast member', detectCast(oneLine), []);

console.log('\nheadings are rejected in every shape they take');
var headings = {
  name: 'Nobody',
  persona: 'Main INTRO:\nSome text.\nRelationship:\nMore text.\nBASIC INFO:\nEven more.\nPersonality:\nCalm.',
  greeting: '', scenario: '', examples: 'Main INTRO:\nx\nMain INTRO:\ny\nRelationship:\nz'
};
same('even when a heading repeats, it is not a person', detectCast(headings), []);

console.log('\nthe card\'s own name is never cast');
var selfCard = {
  name: 'Rosalind Chase', persona: '', scenario: '',
  greeting: 'Rosalind Chase said hello. Rosalind Chase said hello again.',
  examples: 'Rosalind Chase: Welcome.'
};
same('full name excluded', detectCast(selfCard), []);
var firstOnly = {
  name: 'Rosalind', persona: '', scenario: '',
  greeting: 'Rosalind said hello. Rosalind said hello again.', examples: ''
};
same('first name excluded', detectCast(firstOnly), []);

/* ------------------------------------------------------------------ */
/* v1.39.83 — the reported card: three people written as field blocks.
   "Name: Aston / Age: 32 / Role: ... / Appearance: ... / Likes: ..." once per
   character means every field header recurs three times, and the scan counted
   each recurrence as an act. The headers outranked the speakers and the Scene
   bar filled with Name, Age, Role, Appearance, Likes. */
console.log('\nfield blocks are not a cast');
var blocks =
  'Name: Aston\nAge: 32\nRole: Older brother\nAppearance: Tall, dark hair\nLikes: Cooking\n\n' +
  'Name: Sloane\nAge: 29\nRole: Sister\nAppearance: Red hair\nLikes: Reading\n\n' +
  'Name: Aky\nAge: 30\nRole: Wife\nAppearance: Blonde\nLikes: Music\n';
var blockCard = { name: 'Sloane', persona: blocks, greeting: '', scenario: '', examples: '' };
same('a card made only of fields yields no cast', detectCast(blockCard), []);
['Name', 'Age', 'Role', 'Appearance', 'Likes'].forEach(function (w) {
  ok('"' + w + '" is not a person', detectCast(blockCard).indexOf(w) === -1);
});

var spokenBlocks = {
  name: 'Sloane', persona: blocks, scenario: '', examples: '',
  greeting: 'Sloane: \u201cHi... sorry if we\u2019re interrupting anything.\u201d\n\n' +
    'Aston: \u201cDon\u2019t mind her. She\u2019s always been a little shy around new people.\u201d'
};
same('the people in those blocks are found, and only the people',
  detectCast(spokenBlocks), ['Sloane', 'Aston']);

console.log('\nthe loaded character may be in her own scene');
same('she leads the cast on a multi-person card',
  detectCast(spokenBlocks)[0], 'Sloane');
var stillAlone = {
  name: 'Rosalind', persona: '', scenario: '', examples: '',
  greeting: 'Rosalind: \u201cCome in, it\u2019s cold out there.\u201d'
};
same('…but a card with nobody else still has no cast', detectCast(stillAlone), []);

console.log('\none speaking line is enough when it is really speech');
var quotedOnce = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Mara: \u201cSit down. You look like you have been walking all day.\u201d'
};
same('a quoted line names its speaker once', detectCast(quotedOnce), ['Mara']);
var bareOnce = {
  name: 'Nobody', persona: '', scenario: '', examples: 'Joss: Out.'
};
same('a bare two-word line still does not', detectCast(bareOnce), []);

/* v1.39.84 — the same card shape, one layer deeper. A block can end with an
   "Overall:" line: a full sentence, but a sentence *about* somebody. The
   "one real sentence is speech" rule let it through twice, which was enough
   to outrank the people who speak. */
console.log('\na sentence about somebody is not a line of dialogue');
var blocksWithOverall =
  'Name: Aston\nAge: 42\nRole: The father\nLikes: Cooking\n' +
  'Overall: A loyal, easygoing father and longtime best friend who is trying to get his life back together.\n\n' +
  'Name: Sloane\nAge: 18\nRole: The daughter\nLikes: Reading\n' +
  'Overall: A quiet, watchful daughter who says the true thing nobody else will say.\n';
var overallCard = {
  name: 'Sloane', persona: blocksWithOverall, scenario: '', examples: '',
  greeting: 'Sloane: \u201cHi... sorry if we\u2019re interrupting anything.\u201d\n\n' +
    'Aston: \u201cDon\u2019t mind her. Where should we start unloading?\u201d'
};
var oc = detectCast(overallCard);
same('the described field is not a person', oc, ['Sloane', 'Aston']);
ok('"Overall" never reaches the cast', oc.indexOf('Overall') === -1, JSON.stringify(oc));

var describedOnly = {
  name: 'Nobody', persona: 'Overall: A loyal father who is trying his best every day.\n' +
    'Overall: A patient mother who holds the whole house together.', scenario: '', greeting: '', examples: ''
};
same('even twice over, a description is not a speaker', detectCast(describedOnly), []);

console.log('\ndialogue still wins on its own evidence');
var quotedSpeaker = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Mara: \u201cYou are late. The door was unlocked all evening.\u201d'
};
same('one quoted line names its speaker', detectCast(quotedSpeaker), ['Mara']);
var describedPlusSpoken = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Mara: A patient mother who holds the whole house together.\n' +
    'Mara: \u201cTake your shoes off. You are tracking mud through my kitchen.\u201d'
};
same('a described label that also speaks is kept', detectCast(describedPlusSpoken), ['Mara']);
var fieldWordQuoted = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Overall: \u201cTake your shoes off. You are tracking mud through my kitchen.\u201d'
};
same('a field header is never a person, even mid-sentence', detectCast(fieldWordQuoted), []);

/* v1.39.85 — a card may simply say who is in it. A rota line under "Cast",
   "Characters", "Who's here" and the like declares people the dialogue scan
   cannot see: someone who has not spoken yet is still in the room. */
console.log('\na declared rota is cast too');
var rota = 'Sloane is quiet.\n\nCast\n' +
  '- **Aston Ashworth** \u2014 42, her father. Warm and over-apologetic.\n' +
  '- **Mara** \u2014 34, the player\u2019s wife. Dry and controlled.\n' +
  '- **Sloane Ashworth** \u2014 18, quiet, watches the adults.\n' +
  'Write at most two of them speaking in one reply.\n';

var rotaOnly = { name: 'Sloane', persona: rota, scenario: '', greeting: '', examples: '' };
same('the rota supplies the people nobody saw speak',
  detectCast(rotaOnly), ['Sloane', 'Aston Ashworth', 'Mara']);

['Cast:', 'CAST', '**Cast**', 'Characters', 'Main Characters:', 'NPCs', "Who\u2019s here", 'In this scene:']
  .forEach(function (heading) {
    var c = { name: 'Sloane', persona: heading + '\n- **Aston** \u2014 father\n- **Mara** \u2014 wife\n', scenario: '', greeting: '', examples: '' };
    var got = detectCast(c);
    ok('"' + heading + '" is read as a rota heading', got.length === 2 && got[0] === 'Aston', JSON.stringify(got));
  });

console.log('\nthe rota is read for people, not for anything else');
same('a field-word bullet stays a field',
  detectCast({ name: 'X', persona: 'Cast\n- **Name** \u2014 label\n- **Overall** \u2014 summary\n', scenario: '', greeting: '', examples: '' }), []);
same('a heading with prose and no bullets declares nobody',
  detectCast({ name: 'Sloane', persona: 'Characters\nThis card has several people in it, written out in the prose above.\n', scenario: '', greeting: '', examples: '' }), []);
same('a rota entry cannot duplicate the loaded character by full name',
  detectCast({ name: 'Sloane', persona: 'Cast\n- **Sloane Ashworth** \u2014 18, quiet.\n- **Aston** \u2014 father.\n', scenario: '', greeting: '', examples: '' }),
  ['Sloane', 'Aston']);
same('the rota is capped like any other cast',
  detectCast({ name: 'X', persona: 'Cast\n- **Anna** one\n- **Bella** two\n- **Cara** three\n' +
    '- **Dana** four\n- **Elin** five\n- **Faye** six\n- **Gwen** seven\n', scenario: '', greeting: '', examples: '' }).length, 6);
same('bullet styles: dash, star, numbered, plain name',
  detectCast({ name: 'X', persona: 'Cast\n- **Aston** \u2014 one\n* Mara: two\n1. Joss \u2013 three\n', scenario: '', greeting: '', examples: '' }),
  ['Aston', 'Mara', 'Joss']);

console.log('\na rota cannot invent people from prose that merely lists something');
same('a bullet under an unrelated heading is ignored',
  detectCast({ name: 'X', persona: 'Likes\n- Cooking\n- Sports\n- Music\n', scenario: '', greeting: '', examples: '' }), []);

console.log('\nthe revision bump makes stored chats re-detect');
var appAll = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var rev = parseInt((appAll.match(/var CAST_REV = (\d+);/) || [])[1], 10);
ok('CAST_REV was bumped past the version that shipped the bug', rev >= 3, String(rev));
ok('hand-edited casts are still left alone', /!session\.castEdited/.test(appAll));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
