/* v1.13.1 — HTML in card text.
 *
 * SillyTavern/Janitor cards carry their text as HTML (<p>, <br>, <i>, the
 * bot's avatar as <img src="…">). Models can't show images, so the model
 * read the markup out of the character sheet and typed it back into the
 * reply as literal text. plainText converts card HTML to plain prose at
 * import time and at prompt time:
 *
 *   - line breaks survive (<br>, </p>, …)
 *   - tags and their URLs drop (including <img> and <script> contents)
 *   - common entities unescape; unknown ones are left as written
 *   - idempotent, and a no-op for text without markup
 *   - the character sheet and the example dialogue are cleaned in the
 *     wire prompt, so already-imported cards stop echoing markup without
 *     a re-import
 *
 *   node /home/user/tests/cardhtml-test.js
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
    TextEncoder: TextEncoder
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

var HISTORY = [{ id: 'm1', role: 'user', text: 'Hi.', createdAt: 1 }];

(async function main() {
  var API = loadApi();

  console.log('\nplainText — card HTML becomes plain prose');

  same('clean text is untouched (no <, no &)',
    'A careful engineer. She hums while she works.',
    API.plainText('A careful engineer. She hums while she works.'));
  same('a stray < without > is not a tag', API.plainText('I have <5 friends in town.'),
    'I have <5 friends in town.');
  same('<br> and <br/> become line breaks',
    API.plainText('first line<br>second line<br/>third line'),
    'first line\nsecond line\nthird line');
  same('paragraph tags become breaks, excess whitespace collapses',
    API.plainText('<p>para one</p><p>para two</p>'),
    'para one\npara two');
  same('an <img> tag drops with its URL',
    API.plainText('She smiled.<img src="https://ella.janitorai.com/media-approved/x.webp?width=600"> The end.'),
    'She smiled. The end.');
  same('a link keeps its caption, not the href',
    API.plainText('see <a href="https://x.example/page">the notes</a> for more'),
    'see the notes for more');
  same('inline markup drops, the words stay',
    API.plainText('She is <i>weary</i> and <b>done</b> with it.'),
    'She is weary and done with it.');
  same('a <script> block goes with its contents',
    API.plainText('before<script>steal(document.cookie)</script>after'),
    'beforeafter');
  same('common entities unescape',
    API.plainText('fish &amp; chips &lt;good&gt; &quot;quoted&quot; &#39;apostrophe&#39; n&nbsp;b'),
    'fish & chips <good> "quoted" \'apostrophe\' n b');
  same('an unknown entity is left as written',
    API.plainText('a &bogus; b'), 'a &bogus; b');

  /* the exact shape from the field report: a Janitor greeting that starts
     with the card's separator and avatar */
  var janitor = '---\n\n<p><img src="https://ella.janitorai.com/media-approved/7t90c9rD6E3C2Q4p73x9.webp?width=600"></p>As you settle onto the couch next to Hannah, the warmth of your body drapes across her reserved demeanor.';
  same('the reported Janitor greeting cleans to plain prose',
    API.plainText(janitor),
    '---\n\nAs you settle onto the couch next to Hannah, the warmth of your body drapes across her reserved demeanor.');
  same('running it twice changes nothing (idempotent)',
    API.plainText(API.plainText(janitor)), API.plainText(janitor));

  console.log('\nexamples — <br> between speakers splits correctly');

  var ex = API.examplesToMessages('{{user}}: Is it fixed? <br> {{char}}: Almost. Sit down.', char(), S);
  same('two turns, no leftover tags', ex.map(function (m) { return m.role + ': ' + m.content; }),
    ['user: Is it fixed?', 'assistant: Almost. Sit down.']);
  same('clean examples are unchanged',
    API.examplesToMessages('{{user}}: Hi.\n{{char}}: Hello.', char(), S).length, 2);

  console.log('\nthe wire prompt carries no markup');

  var dirty = char({
    persona: '<p><img src="https://ella.janitorai.com/media-approved/x.webp?width=600"></p>A careful engineer.&nbsp;She hums while she works.',
    scenario: '<b>The workshop</b>, late at night.',
    postHistory: '<i>Remember the lens.</i>'
  });
  var prompt = API.buildPrompt(dirty, null, HISTORY, S, null, 4000);
  ok('no <img> in the prompt', prompt.indexOf('<img') === -1, prompt.slice(0, 300));
  ok('no <p>/<b>/<i> in the prompt',
    /<\s*\/?\s*(p|b|i)\b/.test(prompt) === false, prompt.slice(0, 400));
  ok('the prose is still there', prompt.indexOf('A careful engineer. She hums while she works.') !== -1);
  ok('the scenario and always-remember note are clean',
    prompt.indexOf('The workshop, late at night.') !== -1 &&
    prompt.indexOf('Remember the lens.') !== -1);

  var chat = API.buildChat(dirty, null, HISTORY, S, null);
  ok('the chat-provider system message is clean too',
    chat[0].content.indexOf('<img') === -1 && /<\s*\/?\s*(p|b|i)\b/.test(chat[0].content) === false,
    chat[0].content.slice(0, 300));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
