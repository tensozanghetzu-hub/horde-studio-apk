/* Failed-send Retry: a send that dies after the Horde's internal retries
 * leaves a Retry chip on the user's own message, so nothing has to be
 * retyped. The app.js flow (set the flag on failure, clear it on success or
 * a fresh send) is wired in the chat handler; what's pinned here is the
 * renderer half — the chip appears exactly when, and only when, a user
 * message carries the flag.
 *
 *   node /home/user/tests/retry-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var VIEWS_SRC = path.join(ROOT, 'horde-studio-mobile', 'js', 'views.js');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  fetch: function () { return Promise.resolve({ ok: false }); },
  UI: {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    md: function (s) { return String(s || ''); },
    icon: function (name) { return '<svg data-icon="' + name + '"></svg>'; }
  },
  Store: { settings: { userName: 'Tester' } },
  document: {
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(VIEWS_SRC, 'utf8'), sandbox, { filename: 'views.js' });

var Views = sandbox.Views;
ok('Views.messageHtml is exported', typeof Views.messageHtml === 'function');

var char = { id: 'c1', name: 'Vera', avatar: null, systemPrompt: '' };
var base = { sessionId: 's1', id: 'm1', role: 'user', text: 'Is the door locked?', createdAt: 1 };

console.log('\nthe chip');

var flagged = Views.messageHtml(Object.assign({}, base, { retry: true }), char, sandbox.Store.settings);
ok('a flagged user message renders the Retry chip', /data-act="retry"/.test(flagged), flagged.slice(0, 200));
ok('the chip says Retry', /Retry<\/button>/.test(flagged));
ok('the chip uses the refresh icon', /data-icon="refresh"/.test(flagged));
ok('the chip is highlighted (class retry)', /class="chip retry"/.test(flagged));
ok('it still has the usual edit/delete chips', /data-act="edit"/.test(flagged) && /data-act="del"/.test(flagged));

var plain = Views.messageHtml(base, char, sandbox.Store.settings);
ok('an unflagged user message has no Retry chip', !/retry/i.test(plain));

var flaggedAssistant = Views.messageHtml(Object.assign({}, base, { role: 'assistant', retry: true }), char, sandbox.Store.settings);
ok('an assistant message never gets the chip', !/data-act="retry"/.test(flaggedAssistant));

var emptyFlagged = Views.messageHtml(Object.assign({}, base, { text: '', retry: true }), char, sandbox.Store.settings);
ok('the chip renders even for an empty message body', /data-act="retry"/.test(emptyFlagged));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
