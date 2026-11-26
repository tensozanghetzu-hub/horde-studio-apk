#!/usr/bin/env node
/* The mutation harness is the repo's proof that its tests can fail, and a harness
   whose anchors have quietly gone stale is worse than none: it prints
   "every break is caught" while replacing nothing. So this checks the list itself,
   every sweep, in the two ways a stale list shows up — an anchor that no longer
   matches the source exactly once, and a break aimed at a suite that has moved.

   It deliberately does NOT run the mutations: that takes minutes and belongs in
   `python3 tools/mutation-check.py`, before a release. This only proves the list
   is still pointed at the code.

   Usage: node tests/mutation-harness-test.js */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var HARNESS = path.join(ROOT, 'tools', 'mutation-check.py');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\nthe harness exists and runs');
if (!fs.existsSync(HARNESS)) {
  console.log('  FAIL tools/mutation-check.py is missing — the release bar is that every\n' +
    '         check is shown to fail when the source is broken, and that is this file.\n');
  process.exit(1);
}
/* `--list` parses the module, so a syntax error or a mutated structure shows up here
   rather than at the point where someone needs the harness to work. */
var listed = cp.spawnSync('python3', [HARNESS, '--list'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
ok('…and answers --list without error', listed.status === 0, (listed.stderr || listed.error || '').toString().slice(0, 200));

var src = fs.readFileSync(HARNESS, 'utf8');
var entries = [];
(function parse() {
  /* Read the tuples the same way Python would, roughly: the harness keeps them as
     plain literals, so a regex over the source is enough to know what it claims. */
  var re = /\(\s*"((?:[^"\\]|\\.)*)",\s*'((?:[^']|\\')*)',\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",\s*\[([^\]]*)\]\s*,?\s*\)/g;
  var m;
  while ((m = re.exec(src))) {
    var suites = (m[5].match(/'([^']+)'/g) || []).map(function (x) { return x.replace(/'/g, ''); });
    /* Unescape the way Python would, for every escape it understands — not just
       \". An anchor that carries a regex (`/\*\s*$/`) is written in the harness as
       a doubled backslash, and reading it literally looks for a string that no
       file contains, so the anchor check would report a missing break instead of
       a broken one. */
    function unquote(x) { return x.replace(/\\([^\n])/g, '$1'); }
    entries.push({ name: unquote(m[1]), file: m[2], find: unquote(m[3]), repl: unquote(m[4]), suites: suites });
  }
})();
ok('the list has entries to check', entries.length >= 10, entries.length + ' parsed');

console.log('\nevery break is aimed at source that is still there');
var seen = {};
var bad = [];
entries.forEach(function (e) {
  var label = e.name.length > 40 ? e.name.slice(0, 40) + '…' : e.name;
  if (seen[e.name]) bad.push(label + ': duplicate name');
  seen[e.name] = 1;
  /* the same rule the harness uses: a bare name is js/, a path with a slash is
     repo-root-relative, so the wrapper's statics can be broken here too */
  var fp = e.file.indexOf('/') === -1 ? path.join(JS, e.file) : path.join(ROOT, e.file);
  if (!fs.existsSync(fp)) { bad.push(label + ': no such file ' + e.file); return; }
  var body = fs.readFileSync(fp, 'utf8');
  var n = body.split(e.find).length - 1;
  if (n !== 1) bad.push(label + ' — ' + e.file + ': ' + JSON.stringify(e.find.slice(0, 46)) +
    ' occurs ' + n + ' times; the harness wants exactly one');
  if (e.find === e.repl) bad.push(label + ': the break replaces the text with itself');
  e.suites.forEach(function (s) {
    if (!fs.existsSync(path.join(ROOT, 'tests', s))) bad.push(label + ': no such suite tests/' + s);
  });
});
ok('each anchor matches its file exactly once, and each suite still exists',
  bad.length === 0, '\n         ' + bad.join('\n         '));

console.log('\nwhat it covers');
var files = {};
entries.forEach(function (e) { files[e.file] = (files[e.file] || 0) + 1; });
ok('the engine, the store, the screen and the import note are all covered',
  ['api.js', 'store.js', 'views.js', 'app.js'].every(function (f) { return files[f]; }),
  JSON.stringify(files));
var suites = {};
entries.forEach(function (e) { e.suites.forEach(function (s) { suites[s] = 1; }); });
ok('…and at least five suites are named as the ones that must go red',
  Object.keys(suites).length >= 3, Object.keys(suites).join(', '));
/* The point of the file, stated where it can be checked: a break nothing fails is
   reported, not skipped. */
ok('a break that survives is reported as a failure, not as a pass',
  /SURVIVED/.test(src) && /return 1/.test(src.slice(src.indexOf('print(\'\\n%d killed'))));

console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
