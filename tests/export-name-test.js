#!/usr/bin/env node
/* v1.48.2 — what an export is called once it lands in Downloads.

   The Android wrapper writes exports through MediaStore, and MediaStore corrects a
   display name whose extension does not match the MIME type it was handed: for
   `text/plain` the canonical extension is `txt`, so `chat.md` arrived as
   `chat.md.txt` and the fix was "delete the .txt part" — a manual step on every
   transcript, on every phone, forever.

   The two decisions that matter are `mimeForExport` (say `text/markdown` for `.md`,
   so there is nothing to correct) and `renamedByThePlatform` (recognise an append
   the app is allowed to take back). They live in MainActivity.java as plain statics
   with no Android types, so this file can slice them out, compile them with the same
   `javac --release 8` the APK build uses, and RUN them. Everything that needs a
   device — the query, the rename, the toast — is checked as a contract on the source
   it will compile from, and is named as such (TESTING.md rule 1: a shape guard is
   legitimate when the alternative is a claim nobody can test; it is a lie when it is
   offered as behaviour).

     node /home/user/tests/export-name-test.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var JAVA = path.join(ROOT, 'apk-build', 'src', 'com', 'hordestudio', 'mobile', 'MainActivity.java');
var src = fs.readFileSync(JAVA, 'utf8');

var pass = 0, fail = 0, skip = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function skipped(label, why) {
  skip++;
  console.log('  SKIP ' + label + '  (' + why + ')');
}
function same(label, got, want) {
  ok(label, String(got) === String(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

/* ------------------------------------------------------------------ */
console.log('\nthe two statics, compiled and run');

var BLOCK_END = '/* -- end of the block the test compiles -- */';
var i = src.indexOf('static String mimeForExport(String name) {');
var j = src.indexOf(BLOCK_END);
ok('the testable block is where this suite expects it', i > 0 && j > 0 && i < j,
  'i=' + i + ' j=' + j);
/* slice from the first static back to the comment that opens the block, so the
   block's own prose stays out of the compiled file and the boundary is explicit */
var blockStart = src.lastIndexOf('/* ---- export filenames', i);
ok('…and the block is delimited at both ends', blockStart > 0 && blockStart < i);
var block = src.slice(i, j);

function hasJavac() {
  try {
    cp.execSync('javac -version', { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (e) { return false; }
}

var CASES = [
  /* the shipped bug: a `.md` export must not be described as plain text */
  ['mime("chat.md")', 'chat.md', 'text/markdown'],
  ['mime("Chat.MD")', 'Chat.MD', 'text/markdown'],
  ['mime("notes.txt")', 'notes.txt', 'text/plain'],
  ['mime("backup.json")', 'backup.json', 'application/json'],
  ['mime("art.png")', 'art.png', 'image/png'],
  ['mime("art.jpeg")', 'art.jpeg', 'image/jpeg'],
  ['mime("world.horde_world")', 'world.horde_world', 'application/octet-stream'],
  ['mime(null)', null, 'application/octet-stream'],
  ['mime("no extension")', 'no extension', 'application/octet-stream'],

  /* what counts as an append the app may take back */
  ['renamed("chat.md", "chat.md.txt")', 'chat.md|chat.md.txt', 'true'],
  ['renamed("notes.TXT", "notes.TXT.txt") — the append matches whatever its case',
    'notes.TXT|notes.TXT.txt', 'true'],
  ['renamed("chat.md", "chat.md.md") — repeating the same extension is not an append',
    'chat.md|chat.md.md', 'false'],
  ['renamed("chat.md", "chat.md")', 'chat.md|chat.md', 'false'],
  ['renamed("chat.md", "chat (1).md") — a numbered copy is not a rename',
    'chat.md|chat (1).md', 'false'],
  ['renamed("chat.md", "chat.md.extra") — an unknown suffix is left alone',
    'chat.md|chat.md.extra', 'false'],
  ['renamed("chat.md", "other.md.txt") — a different file is not ours to fix',
    'chat.md|other.md.txt', 'false'],
  ['renamed(null, "x.txt")', '|x.txt', 'false'],
  ['renamed("chat.md", null)', 'chat.md|', 'false']
];

if (!hasJavac()) {
  skipped('the compiled section', 'no javac on this machine — the release cannot be checked without it');
} else {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-name-'));
  var main = 'public class ExportNameHarness {\n' + block +
    '\n  public static void main(String[] a) {\n' +
    '    for (String arg : a) {\n' +
    '      int bar = arg.indexOf(\'|\');\n' +
    '      String kind = arg.substring(0, bar);\n' +
    '      String rest = arg.substring(bar + 1);\n' +
    '      String out;\n' +
    '      if (kind.equals("mime")) out = mimeForExport(empty(rest));\n' +
    '      else {\n' +
    '        int bar2 = rest.indexOf(\'|\');\n' +
    '        out = String.valueOf(renamedByThePlatform(empty(rest.substring(0, bar2)), empty(rest.substring(bar2 + 1))));\n' +
    '      }\n' +
    '      System.out.println(out);\n' +
    '    }\n' +
    '  }\n' +
    '  /* the harness spells an absent argument as "-", because a real empty string\n' +
    '     cannot survive a command line the way it does in Java */\n' +
    '  private static String empty(String s) { return s.equals("-") || s.length() == 0 ? null : s; }\n' +
    '}\n';
  fs.writeFileSync(path.join(dir, 'ExportNameHarness.java'), main);
  var compiled = cp.spawnSync('javac', ['-nowarn', '-encoding', 'UTF-8', path.join(dir, 'ExportNameHarness.java')],
    { encoding: 'utf8' });
  ok('the shipped block compiles on its own (javac --release 8 will take it)',
    compiled.status === 0, String(compiled.stderr).slice(0, 400));
  if (compiled.status === 0) {
    var args = CASES.map(function (c) {
      /* "-" is the harness's spelling of "no argument at all" */
      var v = c[1] === null ? '-' : String(c[1]).replace(/\|/g, '|');
      return (c[0].indexOf('mime(') === 0 ? 'mime' : 'renamed') + '|' + v;
    });
    var ran = cp.spawnSync('java', ['-cp', dir, 'ExportNameHarness'].concat(args), { encoding: 'utf8' });
    ok('…and runs', ran.status === 0, String(ran.stderr).slice(0, 300));
    var lines = String(ran.stdout || '').trim().split('\n');
    CASES.forEach(function (c, n) {
      same(c[0], lines[n], c[2]);
    });
    /* the assertion has to be able to fail: 17 cases in, 17 lines out, or the
       harness compared a short list against a shorter answer */
    ok('every case got an answer, so none was silently dropped', lines.length === CASES.length,
      lines.length + ' lines for ' + CASES.length + ' cases');
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

/* ------------------------------------------------------------------ */
console.log('\nthe part that needs a device, as a contract on the shipped source');

var saveFile = src.slice(src.indexOf('public boolean saveFile(final String name, final String base64) {'));
saveFile = saveFile.slice(0, saveFile.indexOf('\n        }'));
ok('saveFile exists and is the length this suite can read', saveFile.length > 400, String(saveFile.length));

ok('the MediaStore insert declares the export\'s own type, not text/plain',
  /cv\.put\(MediaStore\.Downloads\.MIME_TYPE, guessMime\(name\)\);/.test(saveFile), saveFile.slice(0, 200));
ok('…and the bridge\'s guessMime is the tested table, so the two cannot drift',
  /private String guessMime\(String name\) \{\s*\n[^\n]*\n\s*return mimeForExport\(name\);/.test(src),
  'guessMime no longer delegates');
ok('after the write it asks what the file is actually called',
  /String stored = queryDisplayName\(uri\);/.test(saveFile), 'no read-back');
ok('…takes an appended extension back, once',
  /if \(renamedByThePlatform\(name, stored\)\) \{[\s\S]{0,200}DISPLAY_NAME, name[\s\S]{0,120}queryDisplayName\(uri\)/.test(saveFile),
  'no rename-back');
ok('…and the toast reports the name it ended up with, not the one it hoped for',
  /final String shown = savedName;[\s\S]{0,160}"Saved to Downloads\/HordeStudio\/" \+ shown/.test(saveFile),
  'the toast still prints `name`');
ok('the pre-Q branch is untouched — it always wrote the exact name',
  /File f = new File\(dir, name\);/.test(saveFile));

/* the serving path keeps text/plain for .md on purpose: a preview wants a text
   viewer, and nothing there can rename a file. Pin it so a "consistency" sweep
   does not quietly change how files are opened. */
var mimeFor = src.slice(src.indexOf('private String mimeFor(String path) {'));
mimeFor = mimeFor.slice(0, mimeFor.indexOf('\n        }'));
ok('the app\'s own file preview still serves .md as plain text',
  /\.md"\)\) return "text\/plain"/.test(mimeFor), mimeFor.slice(0, 160));
ok('…and that table is not the one the export path uses',
  mimeFor.indexOf('mimeForExport') === -1, 'the preview started sharing the export table');

/* ------------------------------------------------------------------ */
console.log('\nno half-wired leftovers');
ok('nothing else in the wrapper hands MediaStore a MIME type for an export',
  (src.match(/MediaStore\.Downloads\.MIME_TYPE/g) || []).length === 1,
  String((src.match(/MediaStore\.Downloads\.MIME_TYPE/g) || []).length));
ok('the web side still asks for .md (the fix is native, so the name must stay)',
  /UI\.download\(stem \+ '\.md'/.test(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/app.js'), 'utf8')));
ok('…and passes the markdown type, which is what the browser path needs',
  /'text\/markdown'\)/.test(fs.readFileSync(path.join(ROOT, 'horde-studio-mobile/js/app.js'), 'utf8')));

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
process.exit(fail ? 1 : 0);
