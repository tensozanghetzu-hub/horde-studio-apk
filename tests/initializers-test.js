/* v1.22.1 — static guard against the crash that bricked v1.22.0.
 *
 * An Activity's field initializers run while the Activity is being
 * CONSTRUCTED — before attach() gives it a context. Calling getFilesDir()
 * (or any other context method) from a field initializer throws NPE on
 * every single launch: "the app keeps stopping". It compiles clean and no
 * Node test can see it, so the guard is a static scan of the wrapper source.
 *
 *   node /home/user/tests/initializers-test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'apk-build', 'src', 'com', 'hordestudio', 'mobile', 'MainActivity.java');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

var lines = fs.readFileSync(SRC, 'utf8').split('\n');
var bad = [];
lines.forEach(function (line, i) {
  /* a field initializer: `private <...> name = <expression>;` */
  var body = line.replace(/;\s*$/, '');
  var isFieldInit = /^\s*private\s+[^=;]*=\s*[^;]*$/.test(body);
  if (!isFieldInit) return;
  /* context-dependent calls that are illegal before attach() */
  if (/\b(getFilesDir|getCacheDir|getExternalFilesDir|getSystemService|getSharedPreferences|getPackageManager|getApplication|getResources|getBaseContext)\s*\(/.test(line)) {
    bad.push((i + 1) + ': ' + line.trim());
  }
});
ok('no context calls in field initializers (the v1.22.0 launch crash)', bad.length === 0, bad.join(' | '));

/* the same class of bug one level up: instance methods of the Activity
   must only be reached after construction — nothing to scan, but the log
   file must resolve lazily, so assert the fixed shape is present */
var text = lines.join('\n');
ok('log file resolves lazily via logFile()', text.indexOf('private File logFile() {') !== -1);
ok('no eager logFile field remains', text.indexOf('private final File logFile =') === -1);

console.log('');
if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
console.log('initializers-test: ' + pass + ' ok');
