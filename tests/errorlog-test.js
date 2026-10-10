/* v1.22.0 — the error log: toasts fade in two seconds, the log stays.
 *
 *   - the App-updates screen renders the stored log (newest first) and
 *     offers a Clear with a confirm
 *   - the stored log is capped (the wrapper keeps the newest 200); entries
 *     are rendered escaped, so a hostile provider message cannot inject HTML
 *   - Logs.push never throws, normalises whitespace, and truncates; the
 *     window error / unhandledrejection hooks route crashes into the log
 *
 *   node /home/user/tests/errorlog-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var LOG_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'errorlog.js');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 15); }); }

function makeSandbox() {
  var logState = {
    entries: [
      { t: 1759999999000, m: 'install: the download did not finish (https://x/HordeStudio-latest.apk)' },
      { t: 1759999998000, m: 'update: Could not reach https://x — check the address and your connection.' },
      { t: 1759999997000, m: 'crash: <script>evil()</script> (app.js:12)' }
    ],
    pushed: [],
    cleared: 0
  };
  var toasts = [];
  var listeners = {};

  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    _listeners: listeners,
    HSAndroid: {
      logError: function (m) { logState.pushed.push(m); },
      errorLog: function () { return JSON.stringify(logState.entries); },
      clearErrorLog: function () { logState.cleared++; logState.entries = []; },
      updateInfo: function () { return '{"apk":"1.22.0","apkCode":45,"overlay":true,"rev":"abcd1234"}'; },
      jobStatus: function () { return '{"state":"done","result":"ok"}'; }
    },
    UI: {
      esc: function (s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      md: function (s) { return String(s || ''); },
      icon: function () { return ''; },
      toast: function (t) { toasts.push(String(t)); },
      confirm: function (title, body, opts) {
        sandbox._confirm = { title: title, body: body, opts: opts };
        return Promise.resolve(sandbox._confirmAnswer !== false);
      }
    },
    Store: {
      VERSION: '1.22.0',
      settings: { userName: 'Sam', updateUrl: 'https://x/' },
      saveSettings: function () { return Promise.resolve(); }
    },
    document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; } }
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(LOG_SRC, 'utf8'), sandbox, { filename: 'errorlog.js' });
  vm.runInContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });
  return { sandbox: sandbox, log: logState, toasts: toasts };
}

function renderSettingsUpdate(env) {
  var sb = env.sandbox;
  var els = {
    '#errlog-box': { innerHTML: '' },
    '#btn-log-clear': { addEventListener: function (ev, fn) { this._click = fn; } }
  };
  var body = {
    _els: els,
    innerHTML: '',
    querySelector: function (sel) { return els[sel] || null; }
  };
  sb.document.querySelector = function (sel) { return sel === '#settings-x-body' ? body : null; };
  sb.Views.settingsUpdate({});
  return body;
}

(async function main() {
  /* ---- the screen renders the stored log, newest first ---------------- */
  var env = makeSandbox();
  var body = renderSettingsUpdate(env);
  ok('screen: the log section is present', body.innerHTML.indexOf('Error log') !== -1 &&
    body.innerHTML.indexOf('btn-log-clear') !== -1);
  ok('screen: the 200-entry cap is explained', /newest 200/.test(body.innerHTML));
  var box = body._els['#errlog-box'];
  ok('screen: entries rendered', box.innerHTML.indexOf('install: the download did not finish') !== -1,
    box.innerHTML.slice(0, 200));
  ok('screen: newest first',
    box.innerHTML.indexOf('install:') < box.innerHTML.indexOf('update:') &&
    box.innerHTML.indexOf('update:') < box.innerHTML.indexOf('crash:'));
  ok('screen: entries are escaped', box.innerHTML.indexOf('<script>evil()</script>') === -1 &&
    box.innerHTML.indexOf('&lt;script&gt;') !== -1, box.innerHTML.slice(0, 300));
  ok('screen: a timestamp is shown', /errlog-when/.test(box.innerHTML));

  /* ---- empty state ----------------------------------------------------- */
  env = makeSandbox();
  env.log.entries = [];
  body = renderSettingsUpdate(env);
  ok('empty: says so plainly', body._els['#errlog-box'].innerHTML.indexOf('Nothing has gone wrong here yet') !== -1,
    body._els['#errlog-box'].innerHTML);

  /* ---- clear: confirmed ------------------------------------------------ */
  env = makeSandbox();
  body = renderSettingsUpdate(env);
  var nBefore = env.log.entries.length;
  body._els['#btn-log-clear']._click.call(body._els['#btn-log-clear']);
  await tick();
  ok('clear: asks first', !!env.sandbox._confirm);
  ok('clear: log emptied', env.log.cleared === 1 && env.log.entries.length === 0);
  ok('clear: re-renders the empty state', body._els['#errlog-box'].innerHTML.indexOf('Nothing has gone wrong') !== -1);
  ok('clear: toasted', env.toasts.join('|').indexOf('Error log cleared') !== -1, env.toasts.join('|'));
  ok('clear: the old entries are gone, not hidden', nBefore === 3 && env.log.entries.length === 0);

  /* ---- clear: declined ------------------------------------------------- */
  env = makeSandbox();
  body = renderSettingsUpdate(env);
  env.sandbox._confirmAnswer = false;
  body._els['#btn-log-clear']._click.call(body._els['#btn-log-clear']);
  await tick();
  ok('clear: declining keeps the log', env.log.cleared === 0 && env.log.entries.length === 3);

  /* ---- Logs module ------------------------------------------------------ */
  var Logs = env.sandbox.Logs;
  ok('module: exposed', !!Logs && typeof Logs.push === 'function' && typeof Logs.list === 'function');
  Logs.push('');
  Logs.push('   ');
  ok('module: empty messages are dropped', env.log.pushed.length === 0);
  Logs.push('  install:   boom   \n  ');
  ok('module: whitespace normalised', env.log.pushed.length === 1 && env.log.pushed[0] === 'install: boom',
    JSON.stringify(env.log.pushed));
  Logs.push('x'.repeat(500));
  ok('module: long messages truncated', env.log.pushed[1].length === 301 && env.log.pushed[1].slice(0, 3) === 'xxx',
    String(env.log.pushed[1].length));
  var threw = false;
  try {
    var broken = makeSandbox();
    broken.sandbox.HSAndroid.logError = function () { throw new Error('disk on fire'); };
    broken.sandbox.Logs.push('boom');
    broken.sandbox.Logs.clear();
  } catch (e) { threw = true; }
  ok('module: a broken log never throws', threw === false);

  /* ---- crash hooks ------------------------------------------------------ */
  env = makeSandbox();
  var L = env.sandbox._listeners;
  (L.error || []).forEach(function (fn) {
    fn({ message: 'Cannot read properties of undefined', filename: 'js/app.js', lineno: 42 });
  });
  (L.unhandledrejection || []).forEach(function (fn) {
    fn({ reason: { message: 'the provider said no' } });
  });
  ok('hook: window errors land in the log',
    env.log.pushed.length === 2 && /crash: Cannot read properties/.test(env.log.pushed[0]) &&
    /app\.js:42/.test(env.log.pushed[0]), JSON.stringify(env.log.pushed));
  ok('hook: unhandled rejections land in the log',
    /crash: unhandled promise rejection: the provider said no/.test(env.log.pushed[1]),
    JSON.stringify(env.log.pushed));

  console.log('');
  if (fail) { console.log(fail + ' FAILED, ' + pass + ' ok'); process.exit(1); }
  console.log('errorlog-test: ' + pass + ' ok');
})().catch(function (e) {
  console.log('  FAIL threw ' + (e && e.stack || e));
  process.exit(1);
});
