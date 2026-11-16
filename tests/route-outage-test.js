#!/usr/bin/env node
/* A free route that answers 503 for everything is out of capacity, not
   out of quota, and not the player's fault. The app says which, and offers
   the two things a player can do about it. */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var JS = path.join(ROOT, 'horde-studio-mobile', 'js');
var apiSrc = fs.readFileSync(path.join(JS, 'api.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

var mem = {};
var sb = {
  Promise: Promise, JSON: JSON, Object: Object, Date: Date, Array: Array, Math: Math,
  String: String, Number: Number, RegExp: RegExp, Error: Error, console: console,
  Uint8Array: Uint8Array, DataView: DataView, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
  setTimeout: function () {}, clearTimeout: function () {},
  localStorage: { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } },
  location: { hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
sb.window = sb;
vm.runInNewContext(apiSrc, sb, { filename: 'api.js' });
var API = sb.API;

console.log('a 503 is explained, not just reported');
[
  ['test/model:free', true],
  ['test/model', false]
].forEach(function (pair) {
  var model = pair[0], isFree = pair[1];
  var err = API.providerError(503, 'No available providers', model, null, { get: function () { return null; } }, true);
  ok(model + ' fails with status 503', err.status === 503);
  ok('…flagged as a provider outage', err.providerDown === true);
  ok('…says the provider is unavailable', /the provider behind this model is unavailable/.test(err.message));
  ok('…says nothing was lost', /Nothing was lost/.test(err.message));
  ok('…and that it already retried', /already retried it twice/.test(err.message));
  if (isFree) ok('…and names the free-route reason', /no availability guarantee/.test(err.message));
  else ok('…without blaming a free pool that is not in use', !/no availability guarantee/.test(err.message));
  ok('…and does not confuse it with a rate limit', !/rate limit/i.test(err.message), err.message);
  ok('the route log files it as a provider error',
    API.openRouterErrorDiagnosis(err).kind === 'provider_error');
});

['502', '503', '504'].forEach(function (code) {
  var e2 = API.providerError(Number(code), '', 'x:free', null, null, true);
  ok('HTTP ' + code + ' is treated the same way', e2.providerDown === true);
});

console.log('\na rate limit keeps its own, different advice');
var rl = API.providerError(429, 'rate limited', 'x:free', null, null, true);
ok('429 is not a provider outage', !rl.providerDown);
ok('…and points at the quota panel rather than at the provider',
  /quota panel/.test(rl.message), rl.message);
var auth = API.providerError(401, 'bad key', 'x', null, null, true);
ok('401 is not a provider outage', !auth.providerDown);
ok('…and points at the key', /API key was rejected/.test(auth.message));

console.log('\nthe app offers what can be done about it');
ok('a 5xx opens the outage sheet', /App\.routeFailureSheet\(e\)/.test(appSrc));
ok('…only for 5xx / provider-down',
  /e\.providerDown \|\| e\.status >= 500/.test(appSrc));
ok('the sheet says the chat is intact', /Your message and the chat are untouched/.test(appSrc));
ok('…names the free-route pool for a :free model', /Free routes share a pool/.test(appSrc));
ok('…offers Try again', /label: 'Try again'/.test(appSrc));
ok('…offers Choose model', /label: 'Choose model'/.test(appSrc));
ok('…and opens the model picker with a refresh', /App\.chooseModel\(true\)/.test(appSrc));
ok('a retry from the sheet regenerates the failed turn', /App\.routeFailureSheet[\s\S]*?App\.generateReply\(\)/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
