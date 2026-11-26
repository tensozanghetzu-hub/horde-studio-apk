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
const activeSession = { id: 's1', title: 'Test chat', overrides: null };
let saved = null, openedHtml = '';
let nextAction = 'save';
const inputs = {
  '#cs-temp': { value: '' },
  '#cs-maxtok': { value: '' },
  '#cs-note': { value: 'Keep each reply brief and end on a complete sentence.' },
  '#cs-scene': { value: 'Rain at the west window.' },
  '#cs-scene-place': { value: 'memory' },
  '#cs-scene-frequency': { value: '2' },
  /* v1.48.1: the Scene cast field is new here, and it is in this suite on purpose —
     it is captured in the same onClick as the rest, so it inherits the exact bug
     this file exists to keep dead. */
  '#cs-cast': { value: 'Vlad\nMira\nVlad' }
};
let stripRenders = 0;
const sandbox = {
  /* the sheet repaints the Scene strip when the chat it edited is the one on
     screen, so the sandbox needs that function to exist — and counting the calls
     is what pins that the repaint happened, rather than tolerating it */
  App: { state: { session: activeSession }, renderSceneCast: () => { stripRenders++; } }, console, Promise, Object, String, parseInt, parseFloat,
  IDB: { get: () => Promise.resolve(session) },
  Store: {
    putSession: s => { saved = JSON.parse(JSON.stringify(s)); Object.assign(session, s); return Promise.resolve(s); },
    /* the sheet reads the chat's character to be able to say what it could and
       could not detect; nothing in this suite is about that, and the field renders
       its fallback when there is no character to ask */
    getCharacter: () => Promise.resolve(null)
  },
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
/* parseCast/applyCast are shipped next to the sheet and the sheet calls them by
   name, so slice those two in rather than restating them — a stub that agrees with
   itself proves nothing about what the phone runs */
function sliceFn(name) {
  const s = appSrc.indexOf(`  App.${name} = function (`);
  const e = appSrc.indexOf('\n  };', s) + 5;
  return appSrc.slice(s, e);
}
vm.runInContext(sliceFn('parseCast') + '\n' + sliceFn('applyCast') + '\nvar CAST_REV = 9;\n' + bodySrc, sandbox);

(async function () {
  console.log('A — save captures values before the sheet clears');
  sandbox.App.chatSettingsSheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('the scene cast was captured before the close too',
     !!saved && JSON.stringify(saved.sceneCast) === JSON.stringify(['Vlad', 'Mira']),
     JSON.stringify(saved && saved.sceneCast));
  ok('…and marked as the player’s own, so no later scan undoes it',
     !!saved && saved.castEdited === true, JSON.stringify(saved && saved.castEdited));
  ok('…and the open chat’s strip was repainted, so the bar appears without reopening it',
     stripRenders === 1, String(stripRenders));
  ok('style note was persisted in the chat override', !!saved &&
     saved.overrides && saved.overrides.note === inputs['#cs-note'].value,
     JSON.stringify(saved));
  ok('empty generation overrides remain unset', !!saved && !('temperature' in saved.overrides));
  ok('scene note text, placement, and frequency persist independently', !!saved &&
     saved.sceneNote === inputs['#cs-scene'].value && saved.sceneNotePlacement === 'memory' && saved.sceneNoteFrequency === 2);
  ok('the still-open chat receives the fresh in-memory settings',
     sandbox.App.state.session.overrides.note === inputs['#cs-note'].value && sandbox.App.state.session.sceneNote === inputs['#cs-scene'].value);

  console.log('B — reopening pre-fills the saved style note');
  nextAction = 'cancel';
  sandbox.App.chatSettingsSheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('saved style and scene notes appear in the textarea markup', openedHtml.includes('>' + inputs['#cs-note'].value + '</textarea>') && openedHtml.includes('>' + inputs['#cs-scene'].value + '</textarea>'));
  ok('…and so does the cast, one name per line, which is the shape the box edits',
     openedHtml.includes('>Vlad\nMira</textarea>'), openedHtml.slice(openedHtml.indexOf('cs-cast') - 20, openedHtml.indexOf('cs-cast') + 160));

  console.log('C — reset refreshes the active chat too');
  nextAction = 'reset';
  sandbox.App.chatSettingsSheet('s1');
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('reset removes active overrides and scene note immediately', sandbox.App.state.session.overrides === null && sandbox.App.state.session.sceneNote === '');
  /* a cast is not a style: it is a statement about who is standing in the room in
     this chat, and "reset to defaults" has no business emptying the room */
  ok('…and the cast survives it', JSON.stringify(sandbox.App.state.session.sceneCast) === JSON.stringify(['Vlad', 'Mira']),
     JSON.stringify(sandbox.App.state.session.sceneCast));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
