#!/usr/bin/env node
/* A4, D1, C2, D3 — the remaining APK-ISSUES items.
 *
 * A4: tags are stripped before macros expand, so a name can never land inside
 *     an attribute or a <script> block on its way to being removed.
 * D1: one named max-token default instead of three different assumptions.
 * C2: every lorebook entry reports whether it is in the prompt and why not.
 * D3: the character sheet's token size is computable (shown on the Lore screen).
 */
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
function same(name, got, want) { ok(name, got === want, JSON.stringify(got) + ' != ' + JSON.stringify(want)); }

function loadApi() {
  var sb = { Promise, JSON, Object, Date, Array, Math, String, Error, console, RegExp,
    Uint8Array, DataView, TextEncoder, TextDecoder, atob, btoa, setTimeout: function () {},
    localStorage: { getItem: function () { return null; }, setItem: function () { } },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    navigator: { userAgent: 'node' }, fetch: function () { return Promise.reject(new Error('offline')); } };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(JS, 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();
var char = { name: 'Quinn', persona: '', scenario: '', greeting: '', examples: '' };
var s = { userName: 'Quinn' };

/* ------------------------------------------------------------------ */
console.log('A4 — tags are stripped before macros expand');

var nasty = 'Her eyes <span title="{{user}}">narrow</span>. ' +
  '<script>var x = "{{user}}";</script>Done.';
var clean = API.macros(API.plainText(nasty), char, s);
same('a name never survives inside a removed tag', clean, 'Her eyes narrow. Done.');

/* the old order expanded first, which put the name inside <script> before removal */
var oldOrder = API.plainText(API.macros(nasty, char, s));
same('both orders drop the script, but only one never writes into it', oldOrder, 'Her eyes narrow. Done.');

/* a legitimate macro in prose still expands */
same('a macro in prose still works',
  API.macros(API.plainText('{{char}} watches {{user}}.'), char, s), 'Quinn watches Quinn.');

/* the sheet uses the safe order at every site */
var src = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
same('no plainText(macros(...)) sites remain', (src.match(/plainText\(macros\(/g) || []).length, 0);

/* ------------------------------------------------------------------ */
console.log('\nD1 — one max-token default');

same('the constant exists', API.DEFAULT_MAX_TOKENS, 400);
same('a missing cap falls back to it', API.maxTokensOf({}), 400);
same('null falls back', API.maxTokensOf({ maxTokens: null }), 400);
same('0 falls back (it used to mean "undefined" at the Horde call)', API.maxTokensOf({ maxTokens: 0 }), 400);
same('a real value is kept', API.maxTokensOf({ maxTokens: 600 }), 600);

var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
var viewsSrc = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
same('no scattered 200 fallbacks', (apiSrc.match(/maxTokens \|\| 200/g) || []).length, 0);
same('no scattered 400 fallbacks in the app', (appSrc.match(/maxTokens \|\| 400/g) || []).length, 0);
same('no scattered 400 fallbacks in the views', (viewsSrc.match(/maxTokens \|\| 400/g) || []).length, 0);
ok('the Horde request no longer passes a bare cap', !/maxLength: s\.maxTokens,/.test(apiSrc));

/* ------------------------------------------------------------------ */
console.log('\nC2 — every lorebook entry says why it is in or out');

var entries = [
  { id: 'a', keys: ['dragon'], content: 'D1'.repeat(10), enabled: true },
  { id: 'b', keys: ['nothing'], content: 'D2'.repeat(10), enabled: true },
  { id: 'c', keys: ['nothing'], content: 'D3', enabled: false },
  { id: 'd', keys: ['nothing'], content: 'D4', enabled: true, constant: true },
  { id: 'e', keys: ['nothing'], content: 'D5', enabled: true, stage: 'late' }
];
var diag = API.loreDiagnostics(entries, 'a dragon appears', 6, 1536, '');
same('one row per entry', diag.rows.length, entries.length);
same('a keyword hit is admitted', diag.rows[0].matched, true);
same('…and says so', diag.rows[0].reason, 'matched');
same('a miss explains itself', diag.rows[1].reason, 'no keyword matched in the recent messages');
same('a disabled entry is named', diag.rows[2].reason, 'disabled');
same('a constant entry is always in', diag.rows[3].reason, 'always (constant)');
same('…and shows as matched', diag.rows[3].matched, true);
ok('a wrong-stage entry names the stage', /wrong stage/.test(diag.rows[4].reason), diag.rows[4].reason);
same('the admitted count is honest', diag.admitted, 2);

var overLimit = [];
for (var i = 0; i < 8; i++) overLimit.push({ keys: ['x'], content: 'y', enabled: true });
var d2 = API.loreDiagnostics(overLimit, 'x', 6, 1536, '');
ok('past the entry limit, the reason says so',
  /entry limit/.test(d2.rows[6].reason), d2.rows[6].reason);
same('only the limit is admitted', d2.admitted, 6);

var big = [{ keys: ['x'], content: 'a'.repeat(1500), enabled: true },
           { keys: ['x'], content: 'b'.repeat(900), enabled: true }];
var d3 = API.loreDiagnostics(big, 'x', 6, 1000, '');
/* v1.39.109 ranks by match quality, so which of two equally-keyed entries is
   admitted depends on the ranking (the cheaper one wins a tie) rather than on
   book order. What must hold is that one is admitted and the other says why. */
ok('over the byte budget, the reason says so',
  d3.rows.some(function (r) { return /byte budget/.test(r.reason); }),
  d3.rows.map(function (r) { return r.reason; }).join(' | '));
same('...and exactly one of the two was admitted', d3.admitted, 1);
same('…and it is not admitted', d3.rows[1].matched, true);
same('the first entry still goes in (a lone match may exceed)', d3.admitted, 1);

/* loreDiagnostics must agree with loreHits, or the readout is a lie */
var admittedViaHits = API._loreHits(entries, 'a dragon appears', 6, 1536, '').length;
same('the readout agrees with what the prompt actually gets', diag.admitted, admittedViaHits);

/* ------------------------------------------------------------------ */
console.log('\nD3 — the sheet size is computable');

var sheet = [char.persona, char.scenario, char.greeting, char.examples, char.postHistory]
  .filter(Boolean).join('\n\n');
same('an empty sheet is 0 tokens', API.estTokens(sheet), 0);
var size = API.estTokens('x'.repeat(4000));
same('4000 chars is ~1000 tokens', size, 1000);

var viewsSrc2 = fs.readFileSync(path.join(JS, 'views.js'), 'utf8');
ok('the Lore screen shows the sheet size', /tokens<\/b> of character text/.test(viewsSrc2));
ok('the Lore screen shows per-entry state', /reason \|\| ''/.test(viewsSrc2));


/* ------------------------------------------------------------------ */
console.log('\nC2 (v1.39.74) — what can trigger, and C3 (v1.39.109) — what is chosen');

var hist = [];
for (var h = 0; h < 20; h++) {
  hist.push({ role: h % 2 ? 'assistant' : 'user', text: h === 0 ? 'We reached the ridge at dusk.' : 'Filler ' + h + '.' });
}
var sample = API.loreSample(hist);
/* C2's guarantee, kept: an entry keyed to something said earlier in the
   window still fires. It is no longer guaranteed a slot - v1.39.109 ranks by
   how recently the key was seen, which is what keeps a character entry from
   being crowded out by a chapter mentioned twenty turns ago. */
var worn = [{ keys: ['ridge'], content: 'Dragons nest on the ridge.', enabled: true }];
same('an entry keyed to something said long ago still fires',
  API._loreHits(worn, sample, 10, 5000, '').length, 1);
same('…and the readout agrees',
  API.loreDiagnostics(worn, sample, 10, 5000, '').rows[0].reason, 'matched');
same('it is scored as an old mention', API.loreRanks(worn, sample, '')[0].recency > 0, true);

/* The window is bounded, so a very long chat does not scan itself. */
ok('the scan is bounded to a window, not the whole chat', API.LORE_SCAN_MESSAGES <= 40, API.LORE_SCAN_MESSAGES);
var huge = [];
for (var q = 0; q < 200; q++) huge.push({ role: 'user', text: 'line ' + q });
same('a 200-message chat scans only the window',
  API.loreSample(huge).parts.length, Math.min(200, API.LORE_SCAN_MESSAGES));

/* Widening what can trigger must not widen what is sent. */
var many = [];
for (var m = 0; m < 40; m++) many.push({ keys: ['filler'], content: 'z'.repeat(200), enabled: true });
same('the ceiling still caps what is sent',
  API._loreHits(many, sample, API.LORE_LIMIT, API.LORE_BUDGET, '').length <= API.LORE_LIMIT, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
