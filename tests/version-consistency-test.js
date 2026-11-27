#!/usr/bin/env node
/* The version lives in several files that cannot all read each other.
 *
 * `AndroidManifest.xml` is the source of truth. `js/store.js` and `sw.js` ship
 * to the browser, where the manifest does not exist, so they carry copies that
 * `tools/stamp-version.py` writes at build time. That copy went six releases
 * behind once (store.js said 1.39.51 while the app was 1.39.74), and the About
 * screen — the exact place someone looks before filing a bug — quoted a version
 * that matched no release.
 *
 * This test fails the build if any copy disagrees, so the next drift is caught
 * in CI rather than on the phone.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function same(name, got, want) {
  ok(name, String(got) === String(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

var manifest = read('apk-build/AndroidManifest.xml');
var versionName = (manifest.match(/android:versionName="([^"]*)"/) || [])[1];
var versionCode = (manifest.match(/android:versionCode="([^"]*)"/) || [])[1];

console.log('the manifest is the source of truth');
ok('versionName looks like a release', /^\d+\.\d+\.\d+$/.test(versionName || ''), versionName);
ok('versionCode is a whole number', /^\d+$/.test(versionCode || ''), versionCode);
var parts = (versionName || '0.0.0').split('.').map(Number);
/* The 1.39 line is numbered code = 79 + patch (1.39.70 -> 149, and on from
   there), so the two fields cannot silently fall out of step. */
if (parts[0] === 1 && parts[1] === 39) {
  ok('versionCode advances with the version (1.39.x -> 79 + x)',
    Number(versionCode) === 79 + parts[2], versionCode + ' vs 79+' + parts[2]);
} else {
  ok('versionCode is a positive integer on a new release line', Number(versionCode) > 0);
}

console.log('\nstore.js — what the About screen displays');
var store = read('horde-studio-mobile/js/store.js');
var storeVersion = (store.match(/var VERSION = '([^']*)';/) || [])[1];
same('Store.VERSION equals the manifest', storeVersion, versionName);
ok('Store.VERSION is not a hand-edited stranger', /Bumped with each release|stamped/i.test(store),
  'its comment should say where the value comes from');
same('…and it is exported so the UI can use it', /VERSION: VERSION/.test(store), true);

console.log('\nsw.js — which shell a phone installs');
var sw = read('horde-studio-mobile/sw.js');
var cache = (sw.match(/var CACHE = '([^']*)';/) || [])[1];
same('the cache name carries the manifest version', cache, 'horde-studio-v' + versionName);
ok('the cache name is not hand-maintained', /do not edit by hand|stamp-version/i.test(sw),
  'the banner should say the stamp writes it');
ok('an old release is not named in the banner', !/Bumped for v\d/.test(sw));

console.log('\nthe published channel matches');
var vjPath = path.join(ROOT, 'docs', 'version.json');
if (fs.existsSync(vjPath)) {
  var vj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
  same('docs/version.json apk', vj.apk, versionName);
  same('docs/version.json web', vj.web, versionName);
  same('docs/version.json apkCode', vj.apkCode, Number(versionCode));
  var docsStore = (fs.readFileSync(path.join(ROOT, 'docs', 'js', 'store.js'), 'utf8')
    .match(/var VERSION = '([^']*)';/) || [])[1];
  same('the copy in docs/ agrees too', docsStore, versionName);
} else {
  ok('docs/version.json present (skipped: channel not built yet)', true);
}

console.log('\nthe APK the channel advertises is really on the channel');
/* 2026-11-23: deleting the gitignored build artifact at the workspace root made
   build-channel.py mirror docs/ against the source alone, which removed
   HordeStudio-latest.apk and left version.json pointing at it. The channel can
   advertise a download that 404s for every installed phone, and nothing in the
   suite noticed. These checks notice. */
if (fs.existsSync(vjPath)) {
  var chanVj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
  var advertised = chanVj.apkUrl || 'HordeStudio-latest.apk';
  var apkOnChannel = path.join(ROOT, 'docs', advertised);
  var hasApk = fs.existsSync(apkOnChannel);
  var chan = read('tools/build-channel.py');
  ok('docs/ holds the file named by apkUrl', hasApk, advertised);
  if (hasApk) {
    var apkBytes = fs.statSync(apkOnChannel).size;
    same('apkSize is the real size of those bytes', chanVj.apkSize, apkBytes);
    ok('and the channel is not advertising an empty APK', apkBytes > 100000, apkBytes);
    /* The next day, and worse: build.sh died halfway (its SDK had gone missing
       from a restored workspace), so no new APK existed, and build-channel
       copied the PREVIOUS release's bytes into docs/ while announcing
       `app 1.48.6 (code 210)`. Size matched. Existence matched. Every check
       above passed. Only the binary knew, because tools/stamp-version.py writes
       the release into the store.js inside it — so the channel is now made to
       ask, and to refuse rather than publish a number phones cannot tell from
       the one they already have. */
    var inside = '';
    try {
      inside = require('child_process').execFileSync('python3', ['-c',
        'import importlib.util, sys\n' +
        'spec = importlib.util.spec_from_file_location("bc", sys.argv[1])\n' +
        'mod = importlib.util.module_from_spec(spec)\n' +
        'spec.loader.exec_module(mod)\n' +
        'print(mod.apk_version(sys.argv[2]) or "")\n',
        path.join(ROOT, 'tools', 'build-channel.py'), apkOnChannel],
        { encoding: 'utf8', timeout: 60000 }).trim();
    } catch (e) {
      inside = 'python3 could not run: ' + (e.message || e).slice(0, 80);
    }
    same('the APK on the channel says it IS this release', inside, versionName);
    ok('…and the tool refuses instead of advertising it, before the copy',
      /inside = apk_version\(apk\)/.test(chan) &&
      chan.indexOf('inside = apk_version(apk)') < chan.indexOf('shutil.copy2(apk'),
      'the bytes must be read before they land in docs/');
    ok('…and a refusal fails the run, so build.sh and sync-github.sh cannot read it as a publish',
      /sys\.exit\(main\(\)\)/.test(chan), 'a bare main() returns 0 whatever it returns');
    /* The day after that, a version string can be right while the code inside is
       yesterday's — the near-miss above is exactly that shape, one stamp away from
       being invisible. So the channel's APK is asked which files it carries, and
       they have to be these files, byte for byte. */
    var carry = '';
    try {
      carry = require('child_process').execFileSync('python3', ['-c',
        'import sys, zipfile\n' +
        'z = zipfile.ZipFile(sys.argv[1])\n' +
        'want = 0\n' +
        'for name, dest in zip(sys.argv[2::2], sys.argv[3::2]):\n' +
        '    want += 1 if z.read("assets/js/" + name) == open(dest, "rb").read() else 0\n' +
        'print(want)\n',
        apkOnChannel, 'app.js', path.join(ROOT, 'horde-studio-mobile', 'js', 'app.js'),
        'api.js', path.join(ROOT, 'horde-studio-mobile', 'js', 'api.js')],
        { encoding: 'utf8', timeout: 60000 }).trim();
    } catch (e) {
      carry = 'python3 could not run: ' + (e.message || e).slice(0, 80);
    }
    same('the APK on the channel carries THIS release\u2019s code, not only its number', carry, '2');
  } else {
    ok('apkSize says so when there is no APK yet', chanVj.apkSize === 0, chanVj.apkSize);
  }
  ok('the mirror step exempts the published APK from deletion',
    /keep = \{APK_NAME\}/.test(chan) && /if f in keep/.test(chan));
}

console.log('\nthe README names the release it ships');
var readme = read('README.md');
same('the README headline matches', (readme.match(/v(\d+\.\d+\.\d+)/) || [])[1], versionName);

console.log('\nthe release notes are the release they ship with');
/* store.js's copy of the version went six releases behind once, and the prose has the
   same failure mode with no build step to write it: the newest heading in each notes
   file has to be the release this commit is, or the repo tells two different stories
   about what just shipped. */
var notes = read('NOTES.md');
same('NOTES.md leads with this release', (notes.match(/^## v(\d+\.\d+\.\d+)/m) || [])[1], versionName);
var rel = read('RELEASE-NOTES.md');
ok('RELEASE-NOTES.md opens by naming this release',
  new RegExp('v' + versionName.replace(/\./g, '\\.')).test(rel.slice(0, 400)), rel.slice(0, 70));

console.log('\nthe stamp is wired into both build paths');
var buildSh = read('apk-build/build.sh');
var channel = read('tools/build-channel.py');
ok('build.sh stamps before it copies assets', /stamp-version\.py/.test(buildSh));
ok('build-channel.py stamps before it hashes', /stamp-version\.py/.test(channel));
ok('the stamp script exists', fs.existsSync(path.join(ROOT, 'tools', 'stamp-version.py')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
