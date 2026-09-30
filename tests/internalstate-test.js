/* v1.13.0 — per-character internal state (mood / intent / flags).
 *
 *   - the prompt carries the current state + a format instruction only
 *     when tracking is on, and never for virtual humans
 *   - the hidden <state> block is parsed out of a reply before it is
 *     stored or shown; the last block wins, parsing is defensive (no
 *     usable block → null → the previous state is kept)
 *   - stripState removes every block from the visible text
 *
 *   node /home/user/tests/internalstate-test.js
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

var S = {
  systemPrompt: 'You are {{char}}.', userName: 'Rin',
  contextMessages: 40, maxContextChars: 26000, maxTokens: 200
};

function char(over) {
  var c = {
    name: 'Sera', persona: 'A careful engineer.', scenario: 'The workshop.',
    examples: '', lorebook: [], postHistory: '', systemPrompt: '',
    temperature: null, maxTokens: null, vh: null
  };
  Object.assign(c, over || {});
  return c;
}

var FULL = { mood: 'weary but fond', intent: 'finish the repair', flags: 'hiding the broken lens' };
var HISTORY = [
  { id: 'm1', role: 'user', text: 'Is it fixed?', createdAt: 1 },
  { id: 'm2', role: 'assistant', text: 'Almost.', createdAt: 2 }
];

(async function main() {
  var API = loadApi();

  console.log('\nstatePrompt — what the character sheet carries');

  same('tracking off → nothing', API.statePrompt(char()), '');
  same('a character with state but tracking off → nothing',
    API.statePrompt(char({ state: FULL })), '');

  var on = API.statePrompt(char({ stateTracking: true, state: FULL }));
  ok('on + full state → current state listed',
    on.indexOf('Your current internal state:') === 0 &&
    on.indexOf('mood: weary but fond') !== -1 &&
    on.indexOf('intent: finish the repair') !== -1 &&
    on.indexOf('flags: hiding the broken lens') !== -1, on);
  ok('…plus the exact format instruction',
    on.indexOf('<state>') !== -1 && on.indexOf('the reader never sees it') !== -1, on);

  var fresh = API.statePrompt(char({ stateTracking: true }));
  ok('on, no state yet → says not established and still asks for a block',
    fresh.indexOf('not established yet') !== -1 && fresh.indexOf('<state>') !== -1, fresh);

  var partial = API.statePrompt(char({ stateTracking: true, state: { mood: 'wary' } }));
  var partialHead = partial.split('\nKeep your internal state')[0];
  ok('partial state → only the present fields, no empty ones',
    partialHead.indexOf('mood: wary') !== -1 &&
    partialHead.indexOf('intent:') === -1 && partialHead.indexOf('flags:') === -1, partialHead);

  same('virtual human with tracking on → still nothing (the simulation owns that state)',
    API.statePrompt(char({ stateTracking: true, state: FULL, vh: { enabled: true, mood: 20 } })), '');

  console.log('\nparseState — reading the hidden block back');

  var good = 'She set down the soldering iron.\n' +
    '<state>\nmood: relieved\nintent: ask about the letter\nflags: lens replaced, she noticed you leaving\n</state>';
  same('well-formed block → all three fields', API.parseState(good),
    { mood: 'relieved', intent: 'ask about the letter', flags: 'lens replaced, she noticed you leaving' });
  same('tag and keys are case-insensitive',
    API.parseState('<STATE>\nMOOD: wary\nIntent: hold the line\n</STATE>'),
    { mood: 'wary', intent: 'hold the line', flags: '' });
  same('a missing key stays empty, not dropped',
    API.parseState('<state>\nmood: tired\n</state>'), { mood: 'tired', intent: '', flags: '' });
  same('no block → null (caller keeps the previous state)', API.parseState('Just prose, no bookkeeping.'), null);
  same('two blocks → the last one wins',
    API.parseState('a <state>\nmood: old\n</state> b <state>\nmood: new\nintent: go\n</state>'),
    { mood: 'new', intent: 'go', flags: '' });
  same('unknown keys are ignored, real ones kept',
    API.parseState('<state>\nsecret: nobody knows\nmood: calm\n</state>'),
    { mood: 'calm', intent: '', flags: '' });
  same('a runaway block (>1200 chars) → null', API.parseState('<state>\nmood: ' + 'x'.repeat(1300) + '\n</state>'), null);
  same('a block with no usable keys → null', API.parseState('<state>\nsorry, I forgot the format\n</state>'), null);
  same('text around the block does not matter',
    API.parseState('  \n<state>\nflags: one thing\n</state>\n  '), { mood: '', intent: '', flags: 'one thing' });

  console.log('\nstripState — what the reader sees');

  same('block at the end → clean reply, no trailing whitespace',
    API.stripState(good), 'She set down the soldering iron.');
  same('block mid-reply → removed, both halves kept',
    API.stripState('First beat.\n<state>\nmood: x\n</state>\nSecond beat.'), 'First beat.\n\nSecond beat.');
  same('no block → untouched', API.stripState('Plain reply.'), 'Plain reply.');
  same('two blocks → both go',
    API.stripState('a\n<state>\nmood: 1\n</state>\nb\n<state>\nmood: 2\n</state>\nc'), 'a\n\nb\n\nc');
  same('empty input → empty', API.stripState(''), '');

  console.log('\nbuildPrompt — the section in the wire format');

  var withState = API.buildPrompt(char({ stateTracking: true, state: FULL }), null, HISTORY, S, null, 4000);
  ok('tracking on → the prompt head carries the state',
    withState.indexOf('Your current internal state:') !== -1 &&
    withState.indexOf('mood: weary but fond') !== -1, withState.slice(0, 300));
  ok('…and the history is still there', withState.indexOf('Rin: Is it fixed?') !== -1);

  var without = API.buildPrompt(char(), null, HISTORY, S, null, 4000);
  ok('tracking off → no state section, no instruction',
    without.indexOf('internal state') === -1 && without.indexOf('<state>') === -1);

  var vh = API.buildPrompt(char({ stateTracking: true, state: FULL, vh: { enabled: true } }), null, HISTORY, S, null, 4000);
  ok('virtual human → excluded from the prompt too', vh.indexOf('internal state') === -1);

  var freshP = API.buildPrompt(char({ stateTracking: true }), null, HISTORY, S, null, 4000);
  ok('first tracked reply → prompt asks the model to establish the state',
    freshP.indexOf('not established yet') !== -1);

  console.log('\nround trip — one reply, parsed and shown');

  var reply = 'It\'s fixed. I think.\n' +
    '<state>\nmood: pleased\nintent: keep the secret\nflags: she asked about the lens\n</state>';
  var st = API.parseState(reply);
  var shown = API.stripState(reply);
  same('the state the next prompt will carry', st,
    { mood: 'pleased', intent: 'keep the secret', flags: 'she asked about the lens' });
  same('what lands in the chat', shown, 'It\'s fixed. I think.');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
