/* Update flow, part two: "Update everything" promises that after the APK
 * install the new web files apply themselves — no second Check for it.
 *
 * Pinned here: on a fresh install/upgrade (version code went up) with a
 * remembered, still-fresh check result, boot applies that revision
 * automatically; and every case where it must NOT (no upgrade, no remembered
 * check, a stale remembered check, an already-current overlay).
 *
 *   node /home/user/tests/updateflow-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'update.js');
var DEFAULT_URL = 'https://tensozanghetzu-hub.github.io/horde-studio-apk';

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

function boot(opts) {
  opts = opts || {};
  var store = {};
  Object.keys(opts.localStorage || {}).forEach(function (k) { store[k] = opts.localStorage[k]; });
  var applied = [];      // [url, rev]
  var nativeCalls = { confirm: 0 };

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    setInterval: setInterval, clearInterval: clearInterval,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    Store: { settings: {} },
    UI: { toast: function () { } },
    location: { reload: function () { sandbox.__reloaded = true; } },
    HSAndroid: {
      updateInfo: function () {
        return JSON.stringify({
          apk: '1.8.3', apkCode: opts.apkCode != null ? opts.apkCode : 25,
          overlay: !!opts.overlay, rev: opts.overlayRev || ''
        });
      },
      jobStatus: function () { return JSON.stringify({ state: 'done', result: 'ok', progress: 100, message: '' }); },
      applyWebUpdate: function (url, rev) { applied.push([url, rev]); return 'job-1'; },
      confirmUpdate: function () { nativeCalls.confirm++; },
      checkUpdate: function () { return 'job-1'; },
      installApk: function () { }, openDownload: function () { },
      clearWebUpdate: function () { }, pickUpdateZip: function () { return 'job-1'; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'update.js' });
  return { sandbox: sandbox, applied: applied, store: store, confirm: nativeCalls };
}

var now = Date.now();
var fresh = new Date(now).toISOString();
var stale = new Date(now - 10 * 24 * 3600 * 1000).toISOString();
var REMOTE = { apk: '1.8.3', apkCode: 25, webRev: '123', updated: fresh, apkUrl: 'HordeStudio-latest.apk' };

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  console.log('\na fresh install or upgrade applies the remembered files');

  var b = boot({
    apkCode: 25,
    localStorage: {
      'hs.lastApkCode': '24',
      'hs.remote': JSON.stringify(REMOTE)
    }
  });
  ok('the wrapper was told the app booted', b.confirm.confirm === 1, 'confirm=' + b.confirm.confirm);
  ok('it remembered the new version code', b.store['hs.lastApkCode'] === '25', b.store['hs.lastApkCode']);
  await wait(450);   // the native job is polled at 250ms
  ok('it applied the remembered web revision',
    b.applied.length === 1 && b.applied[0][1] === '123' && b.applied[0][0] === DEFAULT_URL + '/web.zip',
    JSON.stringify(b.applied));
  ok('it flagged the revision as pending (boot watchdog)', b.store['hs.pendingRev'] === '123', b.store['hs.pendingRev']);

  console.log('\nit must not misfire');

  var b2 = boot({ apkCode: 25, localStorage: { 'hs.lastApkCode': '25', 'hs.remote': JSON.stringify(REMOTE) } });
  await wait(450);
  ok('same version code → no auto-apply', b2.applied.length === 0, JSON.stringify(b2.applied));

  var b3 = boot({ apkCode: 25, localStorage: { 'hs.lastApkCode': '24' } });
  await wait(450);
  ok('no remembered check → no auto-apply', b3.applied.length === 0, JSON.stringify(b3.applied));

  var staleRemote = { apk: '1.8.3', apkCode: 25, webRev: '99', updated: stale, apkUrl: 'x' };
  var b4 = boot({ apkCode: 25, localStorage: { 'hs.lastApkCode': '24', 'hs.remote': JSON.stringify(staleRemote) } });
  await wait(450);
  ok('a week-old remembered check → no auto-apply (would be a downgrade)', b4.applied.length === 0, JSON.stringify(b4.applied));

  var b5 = boot({
    apkCode: 25, overlay: true, overlayRev: '123',
    localStorage: { 'hs.lastApkCode': '24', 'hs.remote': JSON.stringify(REMOTE) }
  });
  await wait(450);
  ok('overlay already at that revision → no redundant apply', b5.applied.length === 0, JSON.stringify(b5.applied));

  var b6 = boot({ apkCode: 25, overlay: true, overlayRev: '122',
    localStorage: { 'hs.lastApkCode': '24', 'hs.remote': JSON.stringify(REMOTE) } });
  await wait(450);
  ok('overlay one revision behind → it does apply', b6.applied.length === 1 && b6.applied[0][1] === '123',
    JSON.stringify(b6.applied));

  console.log('\nfirst boot records the version code');

  var b7 = boot({ apkCode: 25, localStorage: {} });
  ok('marker written on first boot', b7.store['hs.lastApkCode'] === '25', b7.store['hs.lastApkCode']);
  await wait(450);
  ok('…and does nothing else', b7.applied.length === 0, JSON.stringify(b7.applied));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.log('  FAIL suite crashed', e && e.stack || e);
  process.exit(1);
});
