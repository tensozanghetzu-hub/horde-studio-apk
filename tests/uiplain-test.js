/* uiplain-test — v1.39.24: "Plain prose" rendering toggle.
 *
 * Reported live: the current model wraps ALL narration in *asterisks* (and
 * the per-chat style note could not stop it — the whole history is
 * exemplars), so the thread reads as one continuous italic wall with stray
 * ** and *** leftovers around. A render-side toggle — Settings →
 * Generation → "Plain-prose rendering" — makes every asterisk marker
 * vanish on display, past and future messages alike; stored text is never
 * touched and speech-in-quotes keeps its gold.
 *
 *   OFF (default):  *x* → <em>, **x** → <strong>, strays stay literal
 *   ON:             markers stripped, strays dropped, speech spans intact
 *
 *   node /home/user/tests/uiplain-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'ui.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function loadUI(plainEmphasis) {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Store: { settings: plainEmphasis ? { plainEmphasis: true } : {} },
    document: {
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} }, appendChild: function () {} }; },
      addEventListener: function () {}, body: { appendChild: function () {} }
    }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'ui.js' });
  return sb.UI;
}

var ON = loadUI(true);
var OFF = loadUI(false);

console.log('A — default rendering untouched (regression pin)');
ok('*x* still emphasises', OFF.md('*Morning.*') === '<em>Morning.</em>', OFF.md('*Morning.*'));
ok('**x** still boldens', OFF.md('**Settled.**') === '<strong>Settled.</strong>', OFF.md('**Settled.**'));
ok('speech still turns gold', OFF.md('"Many more."') === '<span class="say">&quot;Many more.&quot;</span>', OFF.md('"Many more."'));

console.log('\nB — plain mode: no asterisk reaches the eye');
ok('italics markers vanish, words stay', ON.md('*The thought arrives — warm, certain.*') === 'The thought arrives — warm, certain.', ON.md('*The thought arrives — warm, certain.*'));
ok('bold markers vanish too', ON.md('**Then it&rsquo;s settled.**'.replace('&rsquo;', '’')) === 'Then it’s settled.', ON.md('**Then it’s settled.**'));
ok('mid-paragraph markers strip', ON.md('Her mind reaches — instant, the *bracelet* now') === 'Her mind reaches — instant, the bracelet now', ON.md('Her mind reaches — instant, the *bracelet* now'));

console.log('\nC — plain mode: strays and triplets die with the rest');
ok('trailing stray gone', ON.md('obsidian.*') === 'obsidian.', ON.md('obsidian.*'));
ok('*** triplet leaves nothing behind', ON.md('Calculated. Executed. Prevailed.***') === 'Calculated. Executed. Prevailed.', ON.md('Calculated. Executed. Prevailed.***'));
ok('inline orphan gone', ON.md('effortless — *A statement of fact.') === 'effortless — A statement of fact.', ON.md('effortless — *A statement of fact.'));

console.log('\nD — speech survives plain mode intact');
ok('quoted speech stays gold', ON.md('*Her breath catches.* "Recognition."') === 'Her breath catches. <span class="say">&quot;Recognition.&quot;</span>', ON.md('*Her breath catches.* "Recognition."'));
ok('curly quotes too', ON.md('She says \u201cSettled.\u201d quietly') === 'She says <span class="say">\u201cSettled.\u201d</span> quietly', ON.md('She says \u201cSettled.\u201d quietly'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
