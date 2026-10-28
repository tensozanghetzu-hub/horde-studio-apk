/* chat-settings-save-test — regression for the Style note form appearing to
   close but never saving. UI.sheet clears its form before resolving; the
   submit callback must snapshot inputs before that happens. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'js/app.js'), 'utf8');
const start = appSrc.indexOf('App.chatSettingsSheet = function (sessionId) {');
const end = appSrc.indexOf('\n  };', start) + 5;
const bodySrc = appSrc.slice(start, end);
let passed = 0, failed = 0;
function ok(label, condition, extra) {
  if (condition) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? ' → ' + extra : '')); }
}

const session = { id: 's1', title: 'Test chat', overrides: null };
let saved = null, openedHtml = '';
let nextAction = 'save';
const inputs = {
  '#cs-temp': { value: '' },
  '#cs-maxtok': { value: '' },
  '#cs-note': { value: 'Keep each reply brief and end on a complete sentence.' }
};
const sandbox = {
  App: {}, console, Promise, Object, String, parseInt, parseFloat,
  IDB: { get: () => Promise.resolve(session) },
  Store: { putSession: s => { saved = JSON.parse(JSON.stringify(s)); session.overrides = s.overrides; return Promise.resolve(s); } },
  UI: {
    toast: () => {},
    /* Mirror UI.sheet's important contract: click callback runs with the
       live body, then the sheet clears it before its promise resolves. */
    sheet: opts => {
      openedHtml = opts.body;
      if (nextAction === 'cancel') return Promise.resolve(null);
      const liveBody = { querySelector: sel => inputs[sel] };
      const action = opts.actions[nextAction === 'reset' ? 1 : 0];
      const result = action.onClick ? action.onClick(liveBody) : action.value;
      liveBody.querySelector = () => null; // form is gone after close
      return Promise.resolve(result);
    }
  },
  $: () => null,
  esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
};
vm.createContext(sandbox);
vm.runInContext(bodySrc, sandbox);

(async function () {
  console.log('A — save captures values before the sheet clears');
  sandbox.App.chatSettingsSheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('style note was persisted in the chat override', !!saved &&
     saved.overrides && saved.overrides.note === inputs['#cs-note'].value,
     JSON.stringify(saved));
  ok('empty global overrides remain unset', !!saved && !('temperature' in saved.overrides));

  console.log('B — reopening pre-fills the saved style note');
  nextAction = 'cancel';
  sandbox.App.chatSettingsSheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('saved note appears in the textarea markup', openedHtml.includes('>' + inputs['#cs-note'].value + '</textarea>'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
