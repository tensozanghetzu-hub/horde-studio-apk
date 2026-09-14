/* Does the updater find the APK when the server cannot serve "/app"?
 *
 * GitHub Pages has no /app route, so the address now comes from a field in
 * the version file. This runs js/update.js in a bare Node sandbox with a
 * fake Android bridge - no browser, no network, nothing to reinstall.
 *
 *   node /home/user/tests/apkurl-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = path.join(__dirname, '..', 'horde-studio-mobile', 'js', 'update.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) { ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }

/* A phone, roughly: localStorage that survives, and a bridge that records. */
function makePhone(versionJson) {
  var store = {};
  var calls = { install: [], download: [], checked: [] };
  var jobs = {}, nextId = 1;

  var HSAndroid = {
    updateInfo: function () {
      return JSON.stringify({ apk: '1.4.7', apkCode: 12, overlay: false, rev: '' });
    },
    jobStatus: function (id) {
      var j = jobs[id];
      if (!j) return JSON.stringify({ state: 'error', message: 'no such job' });
      return JSON.stringify(j);
    },
    checkUpdate: function (url) {
      calls.checked.push(url);
      var id = nextId++;
      jobs[id] = { state: 'done', progress: 100, message: 'done', result: versionJson };
      return id;
    },
    applyWebUpdate: function () { return 0; },
    installApk: function (url) { calls.install.push(url); },
    openDownload: function (url) { calls.download.push(url); },
    clearWebUpdate: function () { },
    confirmUpdate: function () { },
    pickUpdateZip: function () { return 0; }
  };

  var sandbox = {
    console: console,
    JSON: JSON,
    setTimeout: setTimeout, setInterval: setInterval, clearInterval: clearInterval,
    navigator: {},
    location: { reload: function () { } },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    HSAndroid: HSAndroid,
    Store: {
      settings: {},
      saveSettings: function (patch) {
        for (var k in patch) this.settings[k] = patch[k];
        return true;
      }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'update.js' });

  return { Updates: sandbox.Updates, calls: calls, store: store };
}

var GITHUB = JSON.stringify({
  apk: '1.4.7', apkCode: 12,
  apkUrl: 'https://you.github.io/horde-studio-mobile/HordeStudio-latest.apk',
  web: '1.4.7', webRev: '8b2ce2946e96', files: 18
});

var SANDBOX_OLD = JSON.stringify({
  apk: '1.4.7', apkCode: 12, web: '1.4.7', webRev: '1789359575', files: 18
});

console.log('\napkUrl / GitHub Pages compatibility');

/* 1 - the old shape: no apkUrl, so the old /app address must still work */
var a = makePhone(SANDBOX_OLD);
a.Updates.saveUrl('https://8010-old.e2b.app/');
eq('no apkUrl falls back to base + /app',
  a.Updates.apkUrl(), 'https://8010-old.e2b.app/app');

/* 2 - after a check against GitHub, the version file decides */
var b = makePhone(GITHUB);
b.Updates.saveUrl('https://you.github.io/horde-studio-mobile/');
return_run(b);

function return_run(phone) {
  phone.Updates.check()
    .then(function (out) {
      eq('check reads the version file', phone.calls.checked[0],
        'https://you.github.io/horde-studio-mobile/version.json');
      ok('a newer bundle is offered', out.newWeb === true);
      eq('apkUrl comes from the version file',
        phone.Updates.apkUrl(),
        'https://you.github.io/horde-studio-mobile/HordeStudio-latest.apk');

      /* 3 - the buttons follow it */
      phone.Updates.installApk();
      eq('Install app update downloads from apkUrl', phone.calls.install[0],
        'https://you.github.io/horde-studio-mobile/HordeStudio-latest.apk');
      phone.Updates.openDownload();
      eq('browser fallback opens apkUrl', phone.calls.download[0],
        'https://you.github.io/horde-studio-mobile/HordeStudio-latest.apk');

      /* 4 - it survives a reload: fresh context, the same remembered file */
      var reloaded = makePhone(GITHUB);
      reloaded.store['hs.remote'] = phone.store['hs.remote'];
      eq('the address is remembered across a reload',
        reloaded.Updates.apkUrl(),
        'https://you.github.io/horde-studio-mobile/HordeStudio-latest.apk');

      /* 5 - reset drops it, back to the plain address */
      phone.Updates.reset();
      eq('reset forgets the version file',
        phone.Updates.apkUrl(), 'https://you.github.io/horde-studio-mobile/app');

      /* 6 - a bare filename is read relative to the address, so one channel
         works from Pages, raw.githubusercontent, a NAS or a home server */
      var rel = makePhone(JSON.stringify({
        apk: '1.4.7', apkCode: 12, apkUrl: 'HordeStudio-latest.apk',
        web: '1.4.7', webRev: '907db45367a0'
      }));
      rel.Updates.saveUrl('https://raw.githubusercontent.com/you/repo/main/docs/');
      return rel.Updates.check().then(function () {
        eq('a relative apkUrl is joined to the update address',
          rel.Updates.apkUrl(),
          'https://raw.githubusercontent.com/you/repo/main/docs/HordeStudio-latest.apk');
      });
    })
    .then(function () {
      console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
      process.exit(fail ? 1 : 0);
    })
    .catch(function (e) {
      console.log('  FAIL threw: ' + e.message);
      process.exit(1);
    });
}
