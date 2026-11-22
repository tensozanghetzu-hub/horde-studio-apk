#!/usr/bin/env node
/* Keystore hygiene: run before any release.

   The signing key is the app's identity. It used to be committed, which meant
   a public repo was handing out the thing that decides which APK a phone accepts
   as an update. It is untracked now and lives in keystore-backup/ (also ignored),
   and build.sh refuses to sign without it instead of quietly inventing a new
   identity that breaks in-place upgrades for everybody.

   These checks keep that state from rotting: a bulk `git add -A`, a "helpful"
   fallback in build.sh, or an outdated README sentence are all regressions here.

   Usage: node tests/keystore-hygiene-test.js */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_SH = path.join(ROOT, 'apk-build', 'build.sh');
const GITIGNORE = path.join(ROOT, '.gitignore');
const README = path.join(ROOT, 'README.md');
const BACKUP = path.join(ROOT, 'keystore-backup');
const KEY = path.join(ROOT, 'apk-build', 'horde-studio.keystore');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) { console.log('  ok   ' + msg); }
  else { failures++; console.log('  FAIL ' + msg + (detail ? '\n         ' + detail : '')); }
}
function read(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }
function git(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { return null; }
}

console.log('\n1. The signing key is not tracked');

const tracked = git('git ls-files apk-build');
check(tracked !== null, 'git is available to ask', 'git failed — run this from a checkout');
const keysInIndex = (tracked || '').split('\n').filter(l => /\.keystore$|\.jks$/.test(l));
check(keysInIndex.length === 0,
  'no keystore or .jks in the index',
  keysInIndex.join(', ') + ' — the signing identity must never be committed');

const ignored = git('git check-ignore -q apk-build/horde-studio.keystore; echo $?');
check(ignored === null || ignored.trim() === '0',
  'the key path is gitignored, so a bulk add cannot bring it back',
  'expected `git check-ignore` to exit 0 for apk-build/horde-studio.keystore, got ' + (ignored || '').trim());

const gi = read(GITIGNORE);
check(/apk-build\/\*\.keystore/.test(gi), '.gitignore carries the apk-build/*.keystore rule');
check(/apk-build\/\*\.jks/.test(gi), '.gitignore covers .jks too (the other keytool container)');
check(/\/keystore-backup\//.test(gi), '.gitignore keeps the offline backup copy out of the repo');

console.log('\n2. build.sh refuses instead of inventing an identity');

const sh = read(BUILD_SH);
check(sh.length > 0, 'apk-build/build.sh is readable');
const guard = sh.slice(sh.indexOf('if [ ! -f "$KEY" ]'));
const guardBlock = guard.slice(0, guard.indexOf('\nfi') + 3);
check(guard.length > 0, 'the key-presence guard still exists');
check(/HS_ROTATE_KEY/.test(guardBlock),
  'generating a key is opt-in (HS_ROTATE_KEY), never a side effect of a missing file');
// The literal line, not a mention: an error message may *say* HS_ROTATE_KEY
// while the condition around it has been softened away. Checked as text here;
// the behaviour it describes (exit 1, no key created) was verified by running
// build.sh with the key moved aside.
check(/^\s*if \[ "\$\{HS_ROTATE_KEY:-\}" != "1" \]; then\s*$/m.test(guardBlock),
  'the refusal is gated on the real HS_ROTATE_KEY test, not just described by it');
check(/exit 1/.test(guardBlock),
  'a missing key stops the build with a non-zero exit');
check(/keystore-backup/.test(guardBlock),
  'the error message points at the backup that fixes it');
const genCount = (sh.match(/-genkeypair/g) || []).length;
check(genCount === 1, 'exactly one genkeypair call, the deliberate one', 'found ' + genCount);

console.log('\n3. The document that used to promise the opposite');

const rm = read(README);
check(!/keystore is tracked in the repo \*on purpose\*/.test(rm),
  'README no longer claims the key is tracked on purpose');
check(!/full source, tests, build scripts, keystore, docs/.test(rm),
  'README no longer tells a lost workspace that a clone restores the keystore');
check(/keystore-backup/.test(rm), 'README names where the key actually lives');
check(/HS_ROTATE_KEY=1/.test(rm), 'README documents the deliberate rotation switch');

console.log('\n4. The offline copy is real');

check(fs.existsSync(path.join(BACKUP, 'README.txt')),
  'keystore-backup/README.txt explains restore, loss and rotation cost');
const b64 = path.join(BACKUP, 'horde-studio.keystore.base64.txt');
const raw = path.join(BACKUP, 'horde-studio.keystore');
check(fs.existsSync(b64) || fs.existsSync(raw),
  'at least one restorable copy of the key sits beside those instructions');
if (fs.existsSync(b64)) {
  const text = read(b64).trim();
  check(/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 3000,
    'the base64 copy looks like a complete keystore, not a truncated paste',
    'length ' + text.length);
}
if (fs.existsSync(KEY) && fs.existsSync(raw)) {
  const a = fs.readFileSync(KEY), b = fs.readFileSync(raw);
  check(a.equals(b), 'the working key and the backup copy are byte-identical',
    'they have diverged — one of them is not the key that signs your releases');
  const doc = read(path.join(BACKUP, 'README.txt'));
  const expect = require('crypto').createHash('sha256').update(a).digest('hex');
  check(doc.includes(expect),
    'the fingerprint written in keystore-backup/README.txt is the fingerprint of the key you hold',
    'README says otherwise; recompute with `sha256sum apk-build/horde-studio.keystore`');
} else if (fs.existsSync(KEY) !== fs.existsSync(raw)) {
  console.log('  --   one of {working key, backup copy} is absent — restore before building, do not rotate');
}

console.log('\n5. The identity of record, and the guard that reads it');

const IDENT = path.join(ROOT, 'apk-build', 'signing-identity.txt');
const ident = read(IDENT);
const norm = v => String(v || '').replace(/:/g, '').toLowerCase();
// keytool writes A1:B0:… (95 chars), apksigner writes a1b0… (64). Accept either
// on either side and compare the normalised form, or the comparison truncates.
const want = norm((ident.match(/^cert-sha256:\s*([0-9a-f:]{64,})\s*$/m) || [])[1]);
check(ident.length > 0, 'apk-build/signing-identity.txt is in the repo',
  'it is public information — a fingerprint, not a key — and it is what makes a wrong key loud');
check(!!want, 'it records exactly one 64-hex certificate fingerprint', want ? want : 'no parsable cert-sha256: line');
check(/^rotated-from:\s*[0-9a-f:]{64,}$/m.test(ident),
  'it names the fingerprint this one replaced, so the burned key is identifiable');
check(/^since:\s*\d+\.\d+\.\d+/m.test(ident), 'it says which release switched identity');
check(/apk-build\/\*\.keystore\.\*/.test(gi), '.gitignore also covers stray .keystore.bak / .keystore.old files');

check(/signing-identity\.txt/.test(sh), 'build.sh compares the built APK against the identity file');
check(/HS_ALLOW_OTHER_KEY/.test(sh), 'overriding the identity check is an explicit, named decision');
check(/certificate SHA-256 digest:[^\n]*\|\|\s*true/.test(sh),
  'reading the digest cannot abort the build silently under pipefail (sed … || true)');
check(!/grep[^\n]*certificate SHA-256[^\n]*\|[^\n]*head/.test(sh),
  'the digest is not read with grep|head — a no-match there once killed the build without a word');

if (want && fs.existsSync(KEY)) {
  const kt = ['/usr/lib/jvm/jdk-11/bin/keytool', '/usr/lib/jvm/default-jvm/bin/keytool', 'keytool']
    .find(c => { try { execSync(c + ' -help', { stdio: 'ignore' }); return true; } catch (e) { return false; } });
  if (!kt) { console.log('  --   no keytool on this machine — the live key was not compared to the record'); }
  else {
    let got = '';
    try {
      const out = execSync('"' + kt + '" -list -v -keystore "' + KEY + '" -storepass hordestudio',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      got = norm((out.match(/SHA256:\s*([0-9A-Fa-f:]{64,})/) || [])[1]);
    } catch (e) { got = ''; }
    check(got === want,
      'the key on disk really is the recorded identity',
      'disk says ' + (got || '<unreadable>') + ', record says ' + want);
  }
} else if (fs.existsSync(KEY)) {
  check(false, 'cannot compare the live key: the identity record is unreadable');
}

console.log('\n6. Live and burned copies cannot be confused');

const burned = path.join(BACKUP, 'burned-2026-11-22');
check(fs.existsSync(path.join(BACKUP, 'HordeStudio-signing-key-LIVE-v1.42.0.zip')),
  'the live key ships as a zip named LIVE');
check(fs.existsSync(burned), 'the superseded key is archived rather than deleted',
  'it is the only thing that can verify every release up to v1.41.1');
const burnedDoc = read(path.join(burned, 'README.txt'));
check(/DO NOT/.test(burnedDoc) && /never|Never/.test(burnedDoc),
  'the archive label itself says not to sign with it again');
if (fs.existsSync(path.join(burned, 'horde-studio-DO-NOT-SIGN.keystore')) && fs.existsSync(raw)) {
  const diff = !fs.readFileSync(path.join(burned, 'horde-studio-DO-NOT-SIGN.keystore'))
    .equals(fs.readFileSync(raw));
  check(diff, 'the burned copy and the live copy are different files');
}

console.log(failures ? '\n' + failures + ' keystore-hygiene checks FAILED' : '\nall keystore-hygiene checks passed');
process.exit(failures ? 1 : 0);
