/* The file-picker contract (v1.28.2).
 *
 * The web side declares what it accepts ("accept"), and the native
 * onShowFileChooser decides what the system picker may show. The two must
 * agree, or multi-format imports break in pickers that honor the intent's
 * type (Xplore showed "Filter: application/json" and hid the .horde_world
 * files the app imports just fine).
 *
 * The contract:
 *  - the world import's accept list names .horde_world AND .json (so the
 *    native rule sees multiple types);
 *  - the native handler keeps the picker open (wildcard type) unless the
 *    page asks for exactly one well-known family (image/*,
 *    application/json).
 *
 *   node /home/user/tests/filepicker-contract-test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function src(p) { return path.join(ROOT, p); }

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

var webJs = fs.readFileSync(src('horde-studio-mobile/js/app.js'), 'utf8') +
  fs.readFileSync(src('horde-studio-mobile/js/views.js'), 'utf8');
var calls = webJs.match(/pickFile\('([^']+)'\)/g) || [];

console.log('\nthe web side names what it accepts');
ok('there are file picks in the app', calls.length >= 5, String(calls.length));

var worldPick = calls.filter(function (c) { return c.indexOf('.horde_world') !== -1; });
ok('the world import is among them', worldPick.length === 1, worldPick.join(' | '));
if (worldPick.length === 1) {
  var list = worldPick[0].replace(/pickFile\('|'\)/g, '').split(',');
  ok('…and it asks for .horde_world, .json and application/json',
     list.indexOf('.horde_world') !== -1 && list.indexOf('.json') !== -1 &&
     list.indexOf('application/json') !== -1, list.join(','));
  ok('…as more than one type (so the native rule opens the picker)', list.length > 1,
     String(list.length));
}

console.log('\nthe native side keeps the picker honest');
var java = fs.readFileSync(src('apk-build/src/com/hordestudio/mobile/MainActivity.java'), 'utf8');
var start = java.indexOf('onShowFileChooser');
var block = start === -1 ? '' : java.slice(start, start + 2000);
ok('the handler exists', !!block);
ok('…defaults to showing everything', block.indexOf('String type = "*/*";') !== -1);
ok('…and narrows only on exactly one accepted type',
   block.indexOf('accept.length == 1') !== -1 &&
   block.indexOf('accept[0].trim()') !== -1,
   block.slice(0, 200));
ok('…an extension type (no MIME of its own) can never narrow the picker',
   /startsWith\("image\/"\)/.test(block) && /equals\("application\/json"\)/.test(block));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
