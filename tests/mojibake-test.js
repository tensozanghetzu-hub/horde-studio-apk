/* v1.13.2 — mojibake in card text and chat history.
 *
 * Card exporters (especially Janitor AI) sometimes write UTF-8 bytes as if
 * they were Windows-1252: "she's" (E2 80 99) becomes the three characters
 * â€™. The model reads that in the character sheet or the greeting and
 * starts imitating it in its replies. repairMojibake is the reverse
 * transform (chars → cp1252 bytes → strict UTF-8 decode); the fatal
 * decode means it only succeeds on genuinely double-encoded text, so
 * clean English AND correct French/Dutch/Euro text come back untouched.
 * Wired into plainText (import + character sheet + examples) and into the
 * stored-message context of buildPrompt / buildChat / summarize, so
 * existing chats stop feeding the model its own imitated mojibake.
 *
 *   node /home/user/tests/mojibake-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var API_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'api.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function same(label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadApi() {
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, Uint8Array: Uint8Array
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(API_SRC, 'utf8'), sandbox, { filename: 'api.js' });
  return sandbox.API;
}

var S = { systemPrompt: 'You are {{char}}.', userName: 'Rin', contextMessages: 40, maxContextChars: 26000, maxTokens: 200 };
function char(over) {
  var c = {
    name: 'Sera', persona: 'A careful engineer.', scenario: 'The workshop.',
    examples: '', lorebook: [], postHistory: '', systemPrompt: '',
    temperature: null, maxTokens: null, vh: null
  };
  Object.assign(c, over || {});
  return c;
}

(async function main() {
  var API = loadApi();
  var R = API.repairMojibake;

  console.log('\nrepairMojibake — the reverse of the double-encoding');

  same('a mojibaked apostrophe repairs', R('sheâ€™s'), 'she’s');
  same('mojibaked curly quotes repair', R('â€œquotedâ€\x9d'), '“quoted”');
  same('mojibaked accents repair', R('cafÃ© and Ã©tÃ©'), 'café and été');
  same('a mojibaked closing quote at end of line (the reported shape)',
    R('clear, objective data to work with.â€\x9d'), 'clear, objective data to work with.”');
  same('the reported reply pattern repairs', R('while sheâ€™d probably rather not deal with ambiguity'),
    'while she’d probably rather not deal with ambiguity');
  same('a mojibaked em dash repairs in mixed clean text', R('Hello â€” how are you?'), 'Hello — how are you?');
  same('running it twice changes nothing (idempotent)', R(R('sheâ€™s')), R('sheâ€™s'));

  console.log('\nrepairMojibake — clean text must survive untouched');

  same('clean English', R('A careful engineer. She hums while she works.'),
    'A careful engineer. She hums while she works.');
  same('correct French (château carries an â on its own)', R('château'), 'château');
  same('correct French (été)', R('été'), 'été');
  same('a genuine euro sign', R('I paid €5 for it.'), 'I paid €5 for it.');
  same('a genuine curly apostrophe in clean French', R('j’espère qu’ça ira'), 'j’espère qu’ça ira');
  same('correct French with euros, no mojibake anywhere', R('l’été coûte €5 à Genève'), 'l’été coûte €5 à Genève');
  same('a char beyond cp1252 defeats the whole repair', R('é â and 漢'), 'é â and 漢');
  same('a lone â (an incomplete sequence) stays', R('a â b'), 'a â b');
  same('an incomplete pair stays', R('a â€ b'), 'a â€ b');

  console.log('\nplainText — HTML stripping and mojibake repair compose');

  same('tags, entities and mojibake in one string all clean',
    API.plainText('<p>sheâ€™s fine &amp; happy</p>'), 'she’s fine & happy');
  same('clean card text is still a no-op', API.plainText('Plain and simple.'), 'Plain and simple.');

  console.log('\nthe wire prompt and the chat messages carry no mojibake');

  var dirty = char({ persona: 'B. is her friend, and sheâ€™s the quiet one.' });
  var hist = [
    { id: 'm1', role: 'assistant', text: 'And whereâ€™s the challenge in that?â€\x9d' },
    { id: 'm2', role: 'user', text: 'Keep it simple.' }
  ];
  var session = { summary: 'They met at a cafÃ©.', facts: ['sheâ€™s shy'] };

  var prompt = API.buildPrompt(dirty, session, hist, S, null, 4000);
  ok('no â/Ã left in the prompt', !/â|Ã/.test(prompt), prompt.slice(0, 400));
  ok('the persona repaired', prompt.indexOf('she’s the quiet one.') !== -1);
  ok('the stored char reply repaired', prompt.indexOf('And where’s the challenge in that?”') !== -1);
  ok('the user message is still the user’s', prompt.indexOf('Rin: Keep it simple.') !== -1);
  ok('the stored summary and facts repaired',
    prompt.indexOf('café') !== -1 && prompt.indexOf('she’s shy') !== -1);

  var msgs = API.buildChat(dirty, session, hist, S, null);
  var chatMsg = msgs.filter(function (m) { return m.role === 'assistant'; })[0];
  same('the chat-provider history message repaired',
    chatMsg.role + ': ' + chatMsg.content, 'assistant: And where’s the challenge in that?”');
  ok('no mojibake anywhere in the chat messages',
    !msgs.some(function (m) { return /â|Ã/.test(m.content); }));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
