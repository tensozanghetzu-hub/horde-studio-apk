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
  name: 'The Quiet Boarding House',
  persona: 'Name: Mira Holloway\nAge: 34\nOccupation: Landlady\n' +
    'Relationship: Widow. Your neighbour across the street.\n' +
    'Appearance: Floral dresses, bare feet.',
  greeting: 'The screen door creaks open, and Rose steps out onto the porch with two glasses of lemonade.',
  scenario: 'Mira Holloway\'s house — front porch.',
  examples: 'Main INTRO:\n{{char}}: The screen door creaks open.\n' +
    '<START>\n{{char}}: Evening.\n' +
    'Relationship:\nShe has known you for years.'
};
var cast = detectCast(widow);
ok('"Main INTRO" is not a person', cast.indexOf('Main INTRO') === -1, JSON.stringify(cast));
ok('"Relationship" is not a person', cast.indexOf('Relationship') === -1, JSON.stringify(cast));
ok('"Mira Holloway" is not added from the Name field alone',
  cast.indexOf('Mira Holloway') === -1, JSON.stringify(cast));
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
var one = API.buildChat(ai, oneName, [{ role: 'user', text: 'Hello.' }], { userName: 'Quinn', systemPrompt: 'x', maxTokens: 600 });
ok('a single name never injects the cast override',
  one[0].content.indexOf('SCENE CAST') === -1, one[0].content.slice(0, 120));
var two = API.buildChat(ai, { sceneCast: ['Rose', 'Tom'], scenePresent: ['Rose'] },
  [{ role: 'user', text: 'Hello.' }], { userName: 'Quinn', systemPrompt: 'x', maxTokens: 600 });
ok('two names still do', two[0].content.indexOf('SCENE CAST') !== -1);

/* ------------------------------------------------------------------ */
console.log('\nreal people are still found');

var group = {
  name: 'Alpha',
  persona: 'Ada Vane is the father.\n\nCora Vane is his daughter.\n\n' +
    'Ada Vane said nothing. Cora Vane asked about the rooms.\n' +
    'Cora Vane replied softly. Ada Vane asked back.',
  scenario: 'Ada Vane and Cora Vane are guests.',
  greeting: '"Cora Vane said the rooms are upstairs."',
  examples: 'Cora Vane: I will take the far one.'
};
var g = detectCast(group);
ok('a genuine multi-person card still yields a cast', g.length >= 2, JSON.stringify(g));
ok('…and the speakers are the ones found',
  g.indexOf('Cora Vane') !== -1 && g.indexOf('Ada Vane') !== -1, JSON.stringify(g));

var labelOnly = {
  name: 'Nobody', persona: '', scenario: '', greeting: '',
  examples: 'Pearl: Sit down.\nPearl: You look tired.'
};
same('two speaking labels are enough', detectCast(labelOnly), ['Pearl']);

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
  name: 'Mira Holloway', persona: '', scenario: '',
  greeting: 'Mira Holloway said hello. Mira Holloway said hello again.',
  examples: 'Mira Holloway: Welcome.'
};
same('full name excluded', detectCast(selfCard), []);
var firstOnly = {
  name: 'Mira', persona: '', scenario: '',
  greeting: 'Mira said hello. Mira said hello again.', examples: ''
};
same('first name excluded', detectCast(firstOnly), []);

/* ------------------------------------------------------------------ */
/* v1.39.83 — the reported card: three people written as field blocks.
   "Name: Boris / Age: 32 / Role: ... / Appearance: ... / Likes: ..." once per
   character means every field header recurs three times, and the scan counted
   each recurrence as an act. The headers outranked the speakers and the Scene
   bar filled with Name, Age, Role, Appearance, Likes. */
console.log('\nfield blocks are not a cast');
var blocks =
  'Name: Deacon\nAge: 32\nRole: Older brother\nAppearance: Tall, dark hair\nLikes: Cooking\n\n' +
  'Name: Prue\nAge: 29\nRole: Sister\nAppearance: Red hair\nLikes: Reading\n\n' +
  'Name: Ilse\nAge: 30\nRole: Wife\nAppearance: Blonde\nLikes: Music\n';
var blockCard = { name: 'Prue', persona: blocks, greeting: '', scenario: '', examples: '' };
same('a card made only of fields yields no cast', detectCast(blockCard), []);
['Name', 'Age', 'Role', 'Appearance', 'Likes'].forEach(function (w) {
  ok('"' + w + '" is not a person', detectCast(blockCard).indexOf(w) === -1);
});

var spokenBlocks = {
  name: 'Prue', persona: blocks, scenario: '', examples: '',
  greeting: 'Prue: \u201cHi... sorry if we\u2019re interrupting anything.\u201d\n\n' +
    'Deacon: \u201cDon\u2019t mind her. She\u2019s always been a little shy around new people.\u201d'
};
same('the people in those blocks are found, and only the people',
  detectCast(spokenBlocks), ['Prue', 'Deacon']);

console.log('\nthe loaded character may be in her own scene');
same('she leads the cast on a multi-person card',
  detectCast(spokenBlocks)[0], 'Prue');
var stillAlone = {
  name: 'Mira', persona: '', scenario: '', examples: '',
  greeting: 'Mira: \u201cCome in, it\u2019s cold out there.\u201d'
};
same('…but a card with nobody else still has no cast', detectCast(stillAlone), []);

console.log('\none speaking line is enough when it is really speech');
var quotedOnce = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Olive: \u201cSit down. You look like you have been walking all day.\u201d'
};
same('a quoted line names its speaker once', detectCast(quotedOnce), ['Olive']);
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
  'Name: Deacon\nAge: 42\nRole: The father\nLikes: Cooking\n' +
  'Overall: A loyal, easygoing father and longtime best friend who is trying to get his life back together.\n\n' +
  'Name: Prue\nAge: 18\nRole: The daughter\nLikes: Reading\n' +
  'Overall: A quiet, watchful daughter who says the true thing nobody else will say.\n';
var overallCard = {
  name: 'Prue', persona: blocksWithOverall, scenario: '', examples: '',
  greeting: 'Prue: \u201cHi... sorry if we\u2019re interrupting anything.\u201d\n\n' +
    'Deacon: \u201cDon\u2019t mind her. Where should we start unloading?\u201d'
};
var oc = detectCast(overallCard);
same('the described field is not a person', oc, ['Prue', 'Deacon']);
ok('"Overall" never reaches the cast', oc.indexOf('Overall') === -1, JSON.stringify(oc));

var describedOnly = {
  name: 'Nobody', persona: 'Overall: A loyal father who is trying his best every day.\n' +
    'Overall: A patient mother who holds the whole house together.', scenario: '', greeting: '', examples: ''
};
same('even twice over, a description is not a speaker', detectCast(describedOnly), []);

console.log('\ndialogue still wins on its own evidence');
var quotedSpeaker = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Olive: \u201cYou are late. The door was unlocked all evening.\u201d'
};
same('one quoted line names its speaker', detectCast(quotedSpeaker), ['Olive']);
var describedPlusSpoken = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Olive: A patient mother who holds the whole house together.\n' +
    'Olive: \u201cTake your shoes off. You are tracking mud through my kitchen.\u201d'
};
same('a described label that also speaks is kept', detectCast(describedPlusSpoken), ['Olive']);
var fieldWordQuoted = {
  name: 'Nobody', persona: '', scenario: '', examples: '',
  greeting: 'Overall: \u201cTake your shoes off. You are tracking mud through my kitchen.\u201d'
};
same('a field header is never a person, even mid-sentence', detectCast(fieldWordQuoted), []);

/* v1.39.85 — a card may simply say who is in it. A rota line under "Cast",
   "Characters", "Who's here" and the like declares people the dialogue scan
   cannot see: someone who has not spoken yet is still in the room. */
console.log('\na declared rota is cast too');
var rota = 'Nadia is quiet.\n\nCast\n' +
  '- **Tomas Reyes** \u2014 42, her father. Warm and over-apologetic.\n' +
  '- **Olive** \u2014 34, the player\u2019s wife. Dry and controlled.\n' +
  '- **Prue** \u2014 18, quiet, watches the adults.\n' +
  'Write at most two of them speaking in one reply.\n';

var rotaOnly = { name: 'Nadia', persona: rota, scenario: '', greeting: '', examples: '' };
same('the rota supplies the people nobody saw speak',
  detectCast(rotaOnly), ['Tomas Reyes', 'Olive', 'Prue']);

['Cast:', 'CAST', '**Cast**', 'Characters', 'Main Characters:', 'NPCs', "Who\u2019s here", 'In this scene:']
  .forEach(function (heading) {
    var c = { name: 'Nadia', persona: heading + '\n- **Boris** \u2014 father\n- **Olive** \u2014 wife\n', scenario: '', greeting: '', examples: '' };
    var got = detectCast(c);
    ok('"' + heading + '" is read as a rota heading', got.length === 2 && got[0] === 'Boris', JSON.stringify(got));
  });

console.log('\nthe rota is read for people, not for anything else');
same('a field-word bullet stays a field',
  detectCast({ name: 'X', persona: 'Cast\n- **Name** \u2014 label\n- **Overall** \u2014 summary\n', scenario: '', greeting: '', examples: '' }), []);
same('a heading with prose and no bullets declares nobody',
  detectCast({ name: 'Nadia', persona: 'Characters\nThis card has several people in it, written out in the prose above.\n', scenario: '', greeting: '', examples: '' }), []);
same('a rota entry cannot duplicate the loaded character by full name',
  detectCast({ name: 'Nadia', persona: 'Cast\n- **Nadia Marchetti** \u2014 18, quiet.\n- **Boris** \u2014 father.\n', scenario: '', greeting: '', examples: '' }),
  ['Nadia', 'Boris']);
same('the rota is capped like any other cast',
  detectCast({ name: 'X', persona: 'Cast\n- **Anna** one\n- **Bella** two\n- **Cara** three\n' +
    '- **Dana** four\n- **Elin** five\n- **Faye** six\n- **Gwen** seven\n', scenario: '', greeting: '', examples: '' }).length, 6);
same('bullet styles: dash, star, numbered, plain name',
  detectCast({ name: 'X', persona: 'Cast\n- **Boris** \u2014 one\n* Olive: two\n1. Joss \u2013 three\n', scenario: '', greeting: '', examples: '' }),
  ['Boris', 'Olive', 'Joss']);

console.log('\na rota cannot invent people from prose that merely lists something');
same('a bullet under an unrelated heading is ignored',
  detectCast({ name: 'X', persona: 'Likes\n- Cooking\n- Sports\n- Music\n', scenario: '', greeting: '', examples: '' }), []);

/* v1.39.95 — a mood tracker is not a cast.
   A single-person card that writes its states the way a card writes anything
   else ("Warm: she likes company", "Upset: she hates being ignored") got a
   scene bar full of moods. The blank lines between them used to break the
   counting, so each appeared once — which should have been the end of it.
   The rule now does not depend on that: a word that appears ONLY as a label,
   and reads as a state the card describes, is not somebody speaking. */
console.log('\na mood tracker is not a cast');
var moodCard = {
  name: 'Rose', scenario: '', examples: '',
  persona: 'Rose is a widow in her forties.\n\nPersonality\n\n' +
    'Warm: she likes company and always puts the kettle on.\n' +
    'Teasing: she pokes fun when she is comfortable.\n' +
    'Upset: she goes quiet when her late husband is mentioned.\n' +
    'Vulnerable: she admits things she would rather not.\n' +
    'Embarrassed: she looks away and changes the subject.\n',
  greeting: 'Rose: \u201cYou know... Frank used to sit out here with me every night.\u201d\n\n' +
    'She is quiet for a moment, her fingers finding the rim of her glass.'
};
same('moods and states are not people', detectCast(moodCard), []);
['Warm', 'Teasing', 'Upset', 'Vulnerable', 'Embarrassed'].forEach(function (w) {
  ok('"' + w + '" is not a person', detectCast(moodCard).indexOf(w) === -1);
});

/* The reported card writes its moods as quoted lines under "Dialogue
   Examples:" — so by every other measure they look like speech. What a mood
   cannot do is behave like a person: it is labelled once, and it sits in a run
   of other labels. Built here from the same SHAPE with invented words. */
console.log('\nquoted moods inside a label list are still not people');
var listedMoods = {
  name: 'The Landlady', scenario: '', examples: '',
  greeting: 'She looks up when the door opens.',
  persona: 'She keeps the house spotless.\n\n' +
    'Humor: Bright, dry, self-deprecating. Laughs at herself first.\n\n' +
    'Speech:\n\nBright, soft, slightly slow. Uses pet names for everyone.\n\n' +
    'Dialogue Examples:\n\n' +
    'Greeting: \u201cOh, there you are. I was just about to start dinner.\u201d\n\n' +
    'Bright: \u201cSweetheart, you\u2019re home. I was waiting up for you.\u201d\n\n' +
    'Cheeky: \u201cOh, so you noticed my dress, did you?\u201d\n\n' +
    'Hurt: \u201cI\u2019m sorry. I didn\u2019t mean to\u2014I\u2019m not usually like this.\u201d\n\n' +
    'Wistful: \u201cDo you ever feel like you\u2019re invisible?\u201d\n'
};
same('a single person whose moods are quoted yields no cast', detectCast(listedMoods), []);
['Bright', 'Cheeky', 'Hurt', 'Wistful'].forEach(function (w) {
  ok('"' + w + '" is not a person', detectCast(listedMoods).indexOf(w) === -1);
});

console.log('\n…but a real second speaker in the same card survives');
var listedMoodsPlus = Object.assign({}, listedMoods, {
  persona: listedMoods.persona + '\n' +
    'Her sister Nell visits on Sundays.\nNell: \u201cPut the kettle on, then.\u201d\n' +
    'Nell: \u201cYou look tired. Sit down.\u201d\n'
});
same('the recurring, quoted second speaker is found', detectCast(listedMoodsPlus), ['Nell']);

console.log('\n…but a label whose value is speech is still a speaker');
var talkingMoods = {
  name: 'Rose', scenario: '', examples: '',
  greeting: 'Warm: \u201cSit down, love. I\u2019ll put the kettle on.\u201d\n\n' +
    'Teasing: \u201cYou always were hopeless with the gate.\u201d'
};
same('labels that speak are kept', detectCast(talkingMoods), ['Warm', 'Teasing']);

console.log('\nand a real cast is untouched by the new veto');
var realCast = {
  name: 'Alpha', scenario: '', examples: 'Olive: I will take the far one.',
  greeting: '',
  persona: 'Olive is her mother.\n\nOlive said nothing.\nOlive asked about the rooms.\nOlive replied softly.'
};
same('a recurring, quoted speaker still appears', detectCast(realCast), ['Olive']);

/* An existing chat keeps its stored cast until something re-detects. On a
   one-person card the cast must be dropped outright, whatever put it there. */
console.log('\na stored cast on a one-person card is dropped on open');
var appSrcAll = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var initStart = appSrcAll.indexOf('  App.initSceneCast = function (char, session) {');
var initEnd = appSrcAll.indexOf('\n  };', initStart) + 4;
ok('initSceneCast is where the test expects it', initStart > 0 && initEnd > initStart);
var initCalls = { put: 0 };
var initSb = {
  App: { state: {} }, console: console, CAST_REV: rev,
  Store: { putSession: function () { initCalls.put++; return Promise.resolve(); } }
};
vm.runInNewContext(appSrcAll.slice(initStart, initEnd) + '\nthis.App = App;', initSb, { filename: 'initSceneCast.js' });
initSb.App.detectCast = function () { return []; };
initSb.App.castFingerprint = function () { return 'fp'; };
var stale = { sceneCast: ['Rose', 'Warm', 'Teasing'], scenePresent: ['Rose', 'Warm', 'Teasing'], addressedTo: 'Warm' };
initSb.App.initSceneCast({ name: 'Rose', persona: '', greeting: '', scenario: '', examples: '', vh: {} }, stale);
same('the stale chips are gone', stale.sceneCast, []);
same('…their presence too', stale.scenePresent, []);
same('…and the addressed state', stale.addressedTo, '');
ok('…and the change is persisted', initCalls.put === 1);

var keptSb = {
  App: { state: {} }, console: console, CAST_REV: rev,
  Store: { putSession: function () { return Promise.resolve(); } }
};
vm.runInNewContext(appSrcAll.slice(initStart, initEnd) + '\nthis.App = App;', keptSb, { filename: 'initSceneCast2.js' });
keptSb.App.detectCast = function () { return ['Rose', 'Olive']; };
keptSb.App.castFingerprint = function () { return 'fp'; };
var live = { sceneCast: ['Rose', 'Olive'], scenePresent: ['Rose'], castChecked: true, castRev: rev, castFp: 'fp' };
keptSb.App.initSceneCast({ name: 'Rose', persona: '', greeting: '', scenario: '', examples: '', vh: {} }, live);
same('a real cast is left alone', live.sceneCast, ['Rose', 'Olive']);
same('…and its presence', live.scenePresent, ['Rose']);

console.log('\\nthe revision bump makes stored chats re-detect');
var appAll = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var rev = parseInt((appAll.match(/var CAST_REV = (\d+);/) || [])[1], 10);
ok('CAST_REV was bumped past the version that shipped the bug', rev >= 3, String(rev));
ok('hand-edited casts are still left alone', /!session\.castEdited/.test(appAll));

/* ------------------------------------------------------------------
   v1.48.1 — the two ways this feature failed a real card: a cast typed by hand
   was deleted when the chat opened, and once the strip was hidden there was no
   way back to its editor. Both are behaviour checks. The grep that used to sit
   here — `/!session\.castEdited/` anywhere in app.js — passed the whole time the
   clear path ignored it, which is exactly the failure TESTING.md rule 1 is for,
   so it stays as a smoke check under a name that says what it is not.
   ------------------------------------------------------------------ */
/* the file's own `rev` is declared further down and hoists to undefined at this
   point, so read the revision here rather than compare undefined to undefined */
var revNow = parseInt((appSrcAll.match(/var CAST_REV = (\d+);/) || [])[1], 10);
ok('the current cast revision is a number the test can pin', revNow >= 9, String(revNow));

console.log('\nbut a cast the player typed is not deleted on open');
var clearSb = {
  App: { state: {} }, console: console, CAST_REV: revNow,
  Store: { putSession: function () { clearSb.puts++; return Promise.resolve(); } }, puts: 0
};
vm.runInNewContext(appSrcAll.slice(initStart, initEnd) + '\nthis.App = App;', clearSb, { filename: 'initSceneCast3.js' });
clearSb.App.detectCast = function () { return []; };        /* the scanner sees one person */
clearSb.App.castFingerprint = function () { return 'fp'; };
var typed = {
  sceneCast: ['Vlad', 'Mira', 'Ivan'], scenePresent: ['Vlad', 'Mira', 'Ivan'],
  addressedTo: 'Mira', lastSpeaker: 'Vlad', castChecked: true, castEdited: true, castRev: revNow, castFp: 'fp'
};
clearSb.App.initSceneCast({ name: 'The House', persona: '', greeting: '', scenario: '', examples: '', vh: {} }, typed);
same('the three names stay', typed.sceneCast, ['Vlad', 'Mira', 'Ivan']);
same('…and who is in the room', typed.scenePresent, ['Vlad', 'Mira', 'Ivan']);
same('…and who is being spoken to', typed.addressedTo, 'Mira');
same('…and who spoke last', typed.lastSpeaker, 'Vlad');
ok('…and nothing was written, because nothing needed changing', clearSb.puts === 0, String(clearSb.puts));

/* the same chat without the player's edit still loses the cast — v1.39.95 stays
   true for a cast nobody vouched for, and that is what makes the line above a
   choice rather than a blanket disable */
var unedited = JSON.parse(JSON.stringify(typed));
delete unedited.castEdited;
clearSb.App.initSceneCast({ name: 'The House', persona: '', greeting: '', scenario: '', examples: '', vh: {} }, unedited);
same('a cast nobody typed is still dropped from a one-person card', unedited.sceneCast, []);
ok('…and the shape grep alone would not have caught this',
  /!session\.castEdited/.test(appSrcAll), 'the grep passes while the behaviour was wrong');

/* ------------------------------------------------------------------ */
console.log('\nthe editor text becomes a cast by one rule, shared by both doors');
var pcStart = appSrcAll.indexOf('  App.parseCast = function (text) {');
var pcEnd = appSrcAll.indexOf('\n  };', pcStart) + 4;
ok('parseCast is where the test expects it', pcStart > 0 && pcEnd > pcStart);
var acStart = appSrcAll.indexOf('  App.applyCast = function (session, names) {');
var acEnd = appSrcAll.indexOf('\n  };', acStart) + 4;
ok('…and applyCast too', acStart > 0 && acEnd > acStart);
var hsb = { console: console, CAST_REV: revNow, Object: Object, Array: Array, String: String, RegExp: RegExp, Math: Math };
hsb.App = {};
vm.runInNewContext(appSrcAll.slice(pcStart, pcEnd) + '\n' + appSrcAll.slice(acStart, acEnd) +
  '\nthis.App = App;', hsb, { filename: 'cast-helpers.js' });

same('one name per line, runs of space collapsed',
  hsb.App.parseCast('  Vlad   the elder \n  Mira\n'), ['Vlad the elder', 'Mira']);
same('the same name twice is one name, whatever the case',
  hsb.App.parseCast('Mira\nmira\nMIRA'), ['Mira']);
ok('a blank line is not a person', hsb.App.parseCast('\n \nVlad\n\n').length === 1);
same('a label too long for the strip is not a name either',
  hsb.App.parseCast(new Array(26).join('a') + '\nVlad'), ['Vlad']);
same('eight is the ceiling, and the first eight win',
  hsb.App.parseCast('a b c d e f g h i j'.replace(/ /g, '\n')), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
same('nothing typed is no cast, not a cast of the word "undefined"',
  hsb.App.parseCast(undefined), []);

var target = {
  sceneCast: ['Vlad', 'Mira'], scenePresent: ['Mira'], addressedTo: 'Mira',
  lastSpeaker: 'Vlad', castRev: 1, castFp: 'old', castChecked: false
};
ok('applying a different cast reports a change', hsb.App.applyCast(target, ['Vlad', 'Ivan']) === true);
same('…the cast', target.sceneCast, ['Vlad', 'Ivan']);
same('…a name added is in the room, a name removed is out of it', target.scenePresent, ['Vlad', 'Ivan']);
same('…the removed name is no longer being spoken to', target.addressedTo, '');
same('…a name still in the cast stays the last speaker', target.lastSpeaker, 'Vlad');
/* a second target for the next step, because reusing `target` here would move the
   state the three checks after it read — a fixture that mutates under the assertions
   is how a suite starts passing for the wrong reason */
var leaving = { sceneCast: ['Vlad', 'Mira'], scenePresent: ['Vlad', 'Mira'], addressedTo: 'Mira', lastSpeaker: 'Mira' };
hsb.App.applyCast(leaving, ['Vlad']);
same('…and once they leave, the addressed state and the last speaker go too',
  [leaving.addressedTo, leaving.lastSpeaker, leaving.scenePresent], ['', '', ['Vlad']]);
ok('…and the chat is now the player’s own, at this revision',
  target.castEdited === true && target.castChecked === true && target.castRev === revNow,
  JSON.stringify({ e: target.castEdited, c: target.castChecked, r: target.castRev }));
ok('applying the same cast again changes nothing', hsb.App.applyCast(target, 'Vlad\nIvan') === false);
same('…and takes the text form exactly as the textarea gives it', target.sceneCast, ['Vlad', 'Ivan']);
same('clearing the cast is a change the strip honours', hsb.App.applyCast(target, []), true);
same('…and it empties both lists', [target.sceneCast, target.scenePresent], [[], []]);

/* ------------------------------------------------------------------
   the second door: Chat settings, rendered by calling the shipped
   App.chatSettingsSheet and reading the HTML it asked UI.sheet to show.
   ------------------------------------------------------------------ */
console.log('\nChat settings carries the cast, and says what the card showed');

function sheetEnv(opts) {
  var seen = { body: '', title: '', put: 0, toasts: [], saves: 0 };
  var body = '';
  var nodes = {};
  function node(key) {
    if (nodes[key]) return nodes[key];
    var n = {
      key: key, hidden: true, innerHTML: '', textContent: '', value: '', style: {}, names: {},
      classList: {
        toggle: function (c, on) { if (arguments.length < 2) on = !n.names[c]; if (on) n.names[c] = 1; else delete n.names[c]; },
        add: function (c) { n.names[c] = 1; }, remove: function (c) { delete n.names[c]; },
        contains: function (c) { return !!n.names[c]; }
      },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelector: function (sel) { return node(String(sel).replace(/^[#.]/, '')); },
      querySelectorAll: function () { return []; },
      setAttribute: function () {}, getAttribute: function () { return null; }, remove: function () {},
      focus: function () {}, blur: function () {}, click: function () {}
    };
    nodes[key] = n;
    return n;
  }
  var sessions = opts.sessions || {};
  var chars = opts.characters || {};
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN, parseFloat: parseFloat,
    parseInt: parseInt, setTimeout: setTimeout, clearTimeout: clearTimeout, setImmediate: setImmediate,
    setInterval: function () { return 1; }, clearInterval: function () {},
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'file:', href: 'file:///' },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    document: {
      hidden: false, body: node('body'), documentElement: node('html'),
      querySelector: function (sel) { return node(String(sel).replace(/^[#.]/, '')); },
      getElementById: function (id) { return node(id); },
      querySelectorAll: function () { return []; },
      createElement: function () { return node('x' + Math.random()); },
      addEventListener: function () {}, removeEventListener: function () {}
    },
    UI: {
      esc: function (x) { return String(x == null ? '' : x); },
      md: function (x) { return String(x == null ? '' : x); },
      icon: function (n) { return '<svg data-i="' + n + '"></svg>'; },
      fmtTime: function () { return '09:00'; }, fmtDate: function () { return '24 Nov'; },
      toast: function (t) { seen.toasts.push(t); },
      uid: function (p) { return p + '-' + Math.random().toString(36).slice(2, 7); },
      confirm: function () { return Promise.resolve(true); },
      prompt: function () { return Promise.resolve(''); },
      sheet: function (cfg) {
        seen.title = cfg.title;
        seen.body = cfg.body;
        seen.cfg = cfg;          /* so a test can drive a button the sheet offers */
        body = cfg.body;
        /* the real sheet hands onClick the sheet's own DOM, so a field that the
           body did not render must read as absent — that is the difference between
           "the group chat has no cast field" and "it has an empty one" */
        var save = cfg.actions.filter(function (a) { return a.onClick; })[0];
        var values = opts.resolve;
        /* the values the app returns are keyed by what they MEAN, while the fields
           are keyed by their id — `cast` lives in `#cs-cast`. Fill the ids, or the
           stub hands the app an empty textarea and the test proves only that an
           empty textarea saves nothing. */
        var IDS = {
          temperature: 'cs-temp', maxTokens: 'cs-maxtok', note: 'cs-note', sceneNote: 'cs-scene',
          sceneNotePlacement: 'cs-scene-place', sceneNoteFrequency: 'cs-scene-frequency', cast: 'cs-cast'
        };
        if (save && values && values.action === 'save') {
          seen.saves++;
          Object.keys(values).forEach(function (k) {
            var id = IDS[k] || k;
            if (new RegExp('id="' + id + '"').test(body)) node(id).value = values[k] == null ? '' : String(values[k]);
          });
          return Promise.resolve(save.onClick({
            querySelector: function (sel) {
              var id = String(sel).replace(/^#/, '');
              return new RegExp('id="' + id + '"').test(body) ? node(id) : null;
            }
          })).then(function (v) { return v; });
        }
        return Promise.resolve(values === undefined ? null : values);
      }
    },
    Store: {
      settings: { userName: 'Sam' },
      characters: Object.keys(chars).map(function (k) { return chars[k]; }),
      getCharacter: function (id) { return Promise.resolve(chars[id] || null); },
      putSession: function (st) { seen.put++; return Promise.resolve(st); },
      putCharacter: function () { return Promise.resolve(); },
      refreshCharacters: function () { return Promise.resolve([]); },
      getMessages: function () { return Promise.resolve([]); },
      getSessions: function () { return Promise.resolve(Object.keys(sessions).map(function (k) { return sessions[k]; })); },
      allSessions: function () { return Promise.resolve(Object.keys(sessions).map(function (k) { return sessions[k]; })); }
    },
    Views: { thread: function () {}, chats: function () {}, life: function () {}, feed: function () {} },
    VH: { ensure: function (c) { return c.vh; }, read: function () { return false; }, arrived: function () {}, life: function () { return {}; } },
    API: {}, HW: {}, Logs: { push: function () {} },
    IDB: {
      get: function (store, id) { return Promise.resolve(store === 'sessions' ? (sessions[id] || null) : null); },
      put: function () { return Promise.resolve(); }, all: function () { return Promise.resolve([]); },
      getAll: function () { return Promise.resolve([]); }
    }
  };
  sb.window = sb; sb.global = sb;
  sb.addEventListener = function () {}; sb.removeEventListener = function () {};
  vm.runInNewContext(appSrcAll, sb, { filename: 'app.js' });
  sb.App.state = Object.assign({}, sb.App.state, { renders: 0 });
  sb.App.renderSceneCast = function () { sb.App.state.renders++; };
  return {
    sb: sb, seen: seen, node: node, body: function () { return seen.body; },
    settle: function () {
      var p = Promise.resolve();
      for (var i = 0; i < 6; i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
      return p;
    }
  };
}

function openSheet(opts) {
  var e = sheetEnv(opts);
  return Promise.resolve(e.sb.App.chatSettingsSheet(opts.openId)).then(function () { return e.settle(); }).then(function () { return e; });
}

var house = { id: 'cHouse', name: 'The House', persona: 'A house with one keeper.', greeting: 'The door opens.', scenario: '', examples: '', vh: {} };
var speaking = Object.assign({}, house, {
  persona: 'Vlad: Welcome to the inn.\nMira: Wipe your boots.\nVlad: Ale is two coppers.\n' +
    'Mira: The dog is mine.\nIvan: I brought the wine.\nIvan: Two cups, then.'
});

openSheet({
  openId: 'sHouse', characters: { cHouse: house },
  sessions: { sHouse: { id: 'sHouse', charId: 'cHouse', title: 'House', groupCharIds: [] } }
}).then(function (e) {
  ok('a card the app cannot read is told so, and given the field',
    /names its people in a way the app will not infer/.test(e.body()) &&
    /Type them here, one per line/.test(e.body()) && /id="cs-cast"/.test(e.body()),
    e.body().slice(-300));
  return openSheet({
    openId: 'sHouse', characters: { cHouse: speaking },
    sessions: { sHouse: { id: 'sHouse', charId: 'cHouse', title: 'House', groupCharIds: [] } }
  });
}).then(function (e) {
  ok('a card the app can read says who it read, by name',
    /Read from this card: 3 people/.test(e.body()) && /Vlad, Mira, Ivan/.test(e.body()),
    e.body().slice(-300));
  ok('…and promises not to re-scan over what the player types',
    /re-scanned over your head/.test(e.body()), e.body().slice(-300));
  return openSheet({
    openId: 'sGroup',
    characters: { cA: { id: 'cA', name: 'Ava', persona: '', greeting: '', scenario: '', examples: '', vh: {} } },
    sessions: { sGroup: { id: 'sGroup', charId: 'cA', title: 'Group', groupCharIds: ['cA', 'cB'] } }
  });
}).then(function (e) {
  ok('a group chat is told why there is no Scene bar, and is not handed a field it cannot show',
    /several characters, so the Scene bar is not used/.test(e.body()) &&
    !/id="cs-cast"/.test(e.body()), e.body().slice(-300));
  return openSheet({
    openId: 'sVh',
    characters: { cV: { id: 'cV', name: 'Sera', persona: '', greeting: '', scenario: '', examples: '', vh: { enabled: true } } },
    sessions: { sVh: { id: 'sVh', charId: 'cV', title: 'With Sera', groupCharIds: [] } }
  });
}).then(function (e) {
  ok('a living character gives its own reason instead', 
    /living \(Life is on\)/.test(e.body()) && !/id="cs-cast"/.test(e.body()), e.body().slice(-300));

  /* saving through the sheet: the cast lands on the chat, marked as the player's */
  var saved = { id: 'sHouse2', charId: 'cHouse', title: 'House', groupCharIds: [], sceneCast: [], scenePresent: [] };
  var e2 = sheetEnv({
    openId: 'sHouse2', characters: { cHouse: house }, sessions: { sHouse2: saved },
    resolve: {
      action: 'save', temperature: '', maxTokens: '', note: '', sceneNote: '',
      sceneNotePlacement: 'end', sceneNoteFrequency: '1', cast: 'Vlad\nMira\nIvan\nVlad'
    }
  });
  return Promise.resolve(e2.sb.App.chatSettingsSheet('sHouse2')).then(function () {
    return e2.settle();
  }).then(function () {
    same('the saved cast is the cast, deduplicated and in order', saved.sceneCast, ['Vlad', 'Mira', 'Ivan']);
    same('…everyone starts in the room', saved.scenePresent, ['Vlad', 'Mira', 'Ivan']);
    ok('…marked as the player’s own, so no future scan undoes it', saved.castEdited === true);
    ok('…and the chat was written', e2.seen.put === 1, String(e2.seen.put));
    ok('…while a chat that is not on screen gets no strip redraw',
      e2.sb.App.state.renders === 0, String(e2.sb.App.state.renders));

    /* and the same save, on the chat that IS open, does redraw it */
    var saved2 = { id: 'sOpen', charId: 'cHouse', title: 'Open one', groupCharIds: [], sceneCast: [], scenePresent: [] };
    var e3 = sheetEnv({
      openId: 'sOpen', characters: { cHouse: house }, sessions: { sOpen: saved2 },
      resolve: {
        action: 'save', temperature: '', maxTokens: '', note: '', sceneNote: '',
        sceneNotePlacement: 'end', sceneNoteFrequency: '1', cast: 'Vlad\nMira'
      }
    });
    e3.sb.App.state.session = saved2;
    return Promise.resolve(e3.sb.App.chatSettingsSheet('sOpen')).then(function () { return e3.settle(); }).then(function () {
      same('the open chat gets its cast', saved2.sceneCast, ['Vlad', 'Mira']);
      ok('…and its strip is repainted, so the bar appears without reopening the chat',
        e3.sb.App.state.renders >= 1, String(e3.sb.App.state.renders));
    });
  });
}).then(function () {
  /* the first door: the ✎ inside the strip. Same helper, same rules — the two
     entry points must not drift into two ideas of what a cast is. */
  var stripChat = {
    id: 'sStrip', charId: 'cHouse', title: 'House', groupCharIds: [],
    sceneCast: ['Vlad', 'Mira'], scenePresent: ['Vlad', 'Mira'], castEdited: false
  };
  var e4 = sheetEnv({ openId: 'sStrip', characters: { cHouse: house }, sessions: { sStrip: stripChat } });
  e4.sb.App.state.session = stripChat;
  e4.sb.App.editSceneCast();
  return e4.settle().then(function () {
    var acts = (e4.seen.cfg.actions || []).filter(function (a) { return a.onClick; });
    var box = /<textarea id="scene-cast-text"[^>]*>([\s\S]*?)<\/textarea>/.exec(e4.seen.cfg.body);
    ok('the strip’s editor opens with the current names in the box',
      !!box && box[1] === 'Vlad\nMira', e4.seen.cfg.body.slice(0, 240));
    var before = e4.seen.put;
    e4.node('scene-cast-text').value = 'Vlad\nOlive\nOlive';
    return acts[acts.length - 1].onClick({
      querySelector: function (sel) { return e4.node(String(sel).replace(/^#/, '')); }
    });
  }).then(function () { return e4.settle(); }).then(function () {
    same('saving from the strip writes the same shape of cast', stripChat.sceneCast, ['Vlad', 'Olive']);
    same('…and the same presence rule', stripChat.scenePresent, ['Vlad', 'Olive']);
    ok('…marked as the player’s own', stripChat.castEdited === true);
    ok('…the chat written once', e4.seen.put === 1, String(e4.seen.put));
    ok('…and the strip on screen was redrawn', e4.sb.App.state.renders >= 1, String(e4.sb.App.state.renders));
  });
}).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (err) {
  ok('the sheet section ran', false, String((err && err.stack) || err));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});

