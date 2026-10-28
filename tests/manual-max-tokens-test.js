/* manual-max-tokens-test — tapping the displayed max-reply token count
   opens an exact numeric editor, with keyboard commit/cancel and bounded
   settings; the slider remains available and auto-finish stays bounded. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'horde-studio-mobile');
const views = fs.readFileSync(path.join(root, 'js/views.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
let passed = 0, failed = 0;
function ok(label, condition) {
  if (condition) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

console.log('A — max reply length remains adjustable by slider and exact entry');
ok('range slider still exists', /id="set-max" min="64" max="2048"/.test(views));
ok('displayed value is a tappable, accessible button', /button type="button" class="val val-edit" id="v-max"/.test(views));
ok('tap handler opens a numeric editor', /function openMaxEditor\(\)[\s\S]{0,500}input\.type = 'number'/.test(views));
ok('editor permits exact integer values', /input\.step = '1'/.test(views));
ok('editor has numeric mobile keyboard hint', /input\.inputMode = 'numeric'/.test(views));
ok('value is clamped to the supported range', /Math\.max\(64, Math\.min\(2048, n\)\)/.test(views));
ok('entered number is saved and slider follows it', /sc\.set\(patch\); maxSlider\.value = String\(n\)/.test(views));
ok('Enter commits and Escape cancels', /e\.key === 'Enter'[\s\S]{0,100}finish\(true\)[\s\S]{0,150}e\.key === 'Escape'[\s\S]{0,100}finish\(false\)/.test(views));
ok('replacement display remains editable', /display\.addEventListener\('click', openMaxEditor\)/.test(views));
ok('editor has dedicated compact styling', /\.max-token-entry/.test(css));
console.log('B — auto-finish remains for cutoffs, not open-ended expansion');
ok('auto-finish keeps a three-attempt ceiling', /var maxRounds = \(o\.autoFinish === false \|\| s\.autoFinish === false\) \? 1 : 3/.test(api));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
