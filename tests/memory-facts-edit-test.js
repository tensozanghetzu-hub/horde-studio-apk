/* memory-facts-edit-test — facts in a chat's Memory sheet must have clear
   edit/delete controls, and Save must persist edits into both storage and
   the currently open session used by the next prompt. */
'use strict';
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js/app.js'), 'utf8');
const start = app.indexOf('App.memorySheet = function (sessionId) {');
const end = app.indexOf('\n  };', start) + 5;
const block = app.slice(start, end);
let pass = 0, fail = 0;
function ok(label, yes) { if (yes) { pass++; console.log('  ok   ' + label); } else { fail++; console.log('  FAIL ' + label); } }
console.log('A — each saved fact has an explicit edit control');
ok('fact rows render an edit action', /data-edit-fact/.test(block));
ok('editing opens a prefilled multiline input', /UI\.input\('Edit fact',\s*\{\s*value:\s*facts\[i\],\s*multiline:\s*true/.test(block));
ok('edited text replaces the selected fact and rerenders', block.indexOf('facts[i] = edited;') !== -1 && block.indexOf('render(body);', block.indexOf('facts[i] = edited;')) !== -1);
console.log('B — deletion remains available and visibly labeled');
ok('fact rows render an explicit delete action', /data-del-fact/.test(block));
ok('delete still confirms before removing the fact', /UI\.confirm\('Remove fact\?'/i.test(block));
console.log('C — Save makes the edited list live for the next prompt');
ok('Save persists the updated fact list', /s\.facts\s*=\s*facts[\s\S]{0,160}Store\.putSession\(s\)/.test(block));
ok('Save refreshes the active in-memory session', /App\.state\.session\s*=\s*s/.test(block));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
