/* v1.45.0 transcript export: two formats, one assembly, and neither one edited.
 *
 * The .txt export grew up inside the function that wrote it, which meant a second
 * format could only be added by copying that logic and slowly drifting from it. So
 * App.transcriptParts decides the rows once — speaker labels, images, retired facts
 * — and App.renderTranscriptTxt / renderTranscriptMd only say them in their own
 * voice. What must NOT happen to either file: display scripts. A rule that shortens
 * a name on screen must not rewrite the record, so both renderers are asserted here
 * against settings with the switch on and a rule that would strip the emphasis.
 *
 * Generic: invented chats, no character card, no network.
 *
 *   node /home/user/tests/export-md-test.js
 */
'use strict';

var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

var CHARS = {
  c1: { id: 'c1', name: 'Nadia', persona: 'A lighthouse keeper.' },
  c2: { id: 'c2', name: 'Boris', persona: 'Her brother.' }
};
var SESSION = {
  id: 's1', charId: 'c1', title: 'Harbour & Lighthouse', createdAt: Date.UTC(2026, 0, 7, 9, 30),
  summary: 'She remembers the tide.\nShe remembers the argument too.',
  sceneCast: ['Nadia', 'Boris'],
  facts: [
    { text: 'The boat is called Sorrow', from: 12, to: null },
    { text: 'The keeper is dead', from: 5, to: 31 }
  ]
};
var MESSAGES = [
  { id: 'm1', role: 'user', text: 'a *bold* claim' },
  { id: 'm2', role: 'assistant', text: 'Boris: *He grins.* "Thanks, buddy."' },
  { id: 'm3', role: 'assistant', text: 'Nadia: *She nods.*', image: 'data:image/png;base64,AAA', imageCaption: 'the lamp' },
  { id: 'm4', role: 'user', text: 'and an image with no caption', image: 'blob:xyz' }
];
var bare = { id: 's2', charId: 'c1', title: 'New chat', createdAt: Date.UTC(2026, 0, 8), summary: '', facts: [] };

function build(opts) {
  opts = opts || {};
  var downloads = [], toasts = [];
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: function () {},
    navigator: { userAgent: 'node', onLine: true },
    document: {
      addEventListener: function () {},
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, appendChild: function () {}, querySelector: function () { return null; } }; }
    },
    UI: {
      esc: function (x) {
        return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      },
      icon: function () { return ''; },
      toast: function (m) { toasts.push(String(m)); },
      sheet: function () { return Promise.resolve(null); },
      closeSheet: function () {},
      uid: function (p) { return p + '-1'; },
      fmtTime: function () { return 'now'; },
      download: function (name, text, mime) { downloads.push({ name: name, text: text, mime: mime }); },
      inputBox: function () { return Promise.resolve(null); }
    },
    IDB: {
      get: function (store, id) {
        if (opts.reject) return Promise.reject(new Error('the store is closed'));
        return Promise.resolve(id === 's2' ? bare : SESSION);
      },
      getAll: function () { return Promise.resolve([]); },
      put: function () { return Promise.resolve(); }
    },
    Store: {
      settings: {
        userName: 'Quinn', maxTokens: 400, regexOn: opts.scripts === true,
        regexScripts: opts.scripts === true
          ? [{ id: 'r1', name: 'no emphasis', pattern: '\\*([^*]+)\\*', replacement: '$1', flags: 'gi', enabled: true }]
          : []
      },
      characters: [],
      getMessages: function () { return Promise.resolve(MESSAGES); },
      getCharacter: function (id) { return Promise.resolve(CHARS[id] || null); },
      saveSettings: function () { return Promise.resolve(); }
    },
    Views: { chats: function () {}, thread: function () {}, characters: function () {} }
  };
  sb.window = sb; sb.global = sb;
  /* the real builders, so the export is tested against the same speaker resolution
     and the same fact shapes the chat itself uses */
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), sb, { filename: 'app.js' });
  return { sb: sb, App: sb.App, downloads: downloads, toasts: toasts };
}

(async function () {
  var env = build({ scripts: true });
  var App = env.App;

  console.log('\nA — one assembly, two voices');

  await App.exportTranscript('s1');
  await App.exportTranscript('s1', 'md');
  eq('both formats were written', env.downloads.length, 2);
  var txt = env.downloads[0], md = env.downloads[1];
  eq('the .txt keeps its name and type', [txt.name, txt.mime].join(' | '), 'Nadia-Harbour_Lighthouse.txt | text/plain');
  eq('the .md gets the same stem and its own type', [md.name, md.mime].join(' | '), 'Nadia-Harbour_Lighthouse.md | text/markdown');
  ok('the unsafe characters are gone from the filename, so a title with a slash cannot draw a folder',
    txt.name.indexOf('&') === -1 && txt.name.indexOf('/') === -1, txt.name);
  ok('the plain export still opens with the two header lines it has always had',
    /^# Nadia — Harbour & Lighthouse\n# /.test(txt.text), JSON.stringify(txt.text.slice(0, 60)));
  ok('the markdown export gives the same facts as a title and a byline',
    /^# Nadia — Harbour & Lighthouse\n\n_Exported /.test(md.text), JSON.stringify(md.text.slice(0, 70)));
  ok('…and says how much it is', /4 messages_/.test(md.text), md.text.slice(0, 140));

  console.log('\nB — the rows are decided once');

  ok('the user turn is named for the persona in both',
    /^Quinn: a \*bold\* claim$/m.test(txt.text) && /\*\*Quinn:\*\* a \*bold\* claim/.test(md.text));
  ok('a labelled reply is credited to its speaker, not to the card',
    /^Boris: \*He grins\./m.test(txt.text) && /^\*\*Boris:\*\* \*He grins\./m.test(md.text),
    'TXT ' + txt.text.slice(0, 150) + ' || MD ' + md.text.slice(0, 150));
  ok('…and the card’s own unlabelled line stays Nadia’s in both formats',
    /^Nadia: \*She nods\.\*$/m.test(txt.text) && /\*\*Nadia:\*\* \*She nods\./.test(md.text));
  ok('an image is a path in the txt, as it has always been',
    /\[image: data:image\/png;base64,AAA\]/.test(txt.text));
  ok('…and a figure in the markdown, with its caption as the alt text',
    /!\[the lamp\]\(data:image\/png;base64,AAA\)/.test(md.text));
  ok('an image with no caption is admitted to, not silently dropped',
    /_\(image attached\)_/.test(md.text));

  console.log('\nC — display scripts are not part of a record');

  ok('the .txt keeps what the model wrote', /\*bold\* claim/.test(txt.text) && /\*She nods\.\*/.test(txt.text),
    txt.text.slice(0, 200));
  ok('the .md does too', /\*bold\* claim/.test(md.text) && /\*He grins\.\*/.test(md.text));
  ok('…and that is structural, not a lucky setting: app.js does not call the engine',
    !/applyDisplayScripts/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')));
  ok('…while the same settings do strip it on screen, so the rule is really armed',
    env.sb.API.applyDisplayScripts('a *bold* claim', env.sb.Store.settings) === 'a bold claim',
    env.sb.API.applyDisplayScripts('a *bold* claim', env.sb.Store.settings));

  console.log('\nD — what the chat remembered');

  ok('the summary becomes a blockquote, every line of it',
    /^> She remembers the tide\.\n> She remembers the argument too\.$/m.test(md.text),
    (md.text.match(/## What the chat remembered[\s\S]*$/) || [''])[0].slice(0, 200));
  ok('…while the txt keeps the older flat form', /Memory: She remembers the tide\./.test(txt.text));
  ok('a current fact says when it was learned, in both',
    /- The boat is called Sorrow \(from message 12\)/.test(md.text) &&
    /\n- The boat is called Sorrow/.test(txt.text));
  ok('a retired fact is kept and marked, not deleted',
    /The keeper is dead \(stopped being true at message 31\)/.test(md.text) &&
    /No longer true:\n- The keeper is dead \(until message 31\)/.test(txt.text));

  console.log('\nE — the edges');

  var empty = build({});
  await empty.App.exportTranscript('s2', 'md');
  var bareMd = empty.downloads[0].text;
  ok('a chat with no memory gets no memory section',
    bareMd.indexOf('## What the chat remembered') === -1 && bareMd.indexOf('---') === -1, bareMd.slice(0, 160));
  ok('…but it is still a document with a title', /^# Nadia — New chat\n\n_Exported /.test(bareMd), bareMd.slice(0, 60));

  var broken = build({ reject: true });
  await broken.App.exportTranscript('s1', 'md');
  eq('a failing store writes no file', broken.downloads.length, 0);
  ok('…and says what happened instead of looking idle',
    /Could not export this chat: the store is closed/.test(broken.toasts.join(' | ')), broken.toasts.join(' | '));

  var noChar = build({});
  noChar.sb.Store.getCharacter = function () { return Promise.resolve(null); };
  await noChar.App.exportTranscript('s1');
  ok('a chat whose character was deleted still exports, under a fallback name',
    /^# Character — /.test(noChar.downloads[0].text) && /^Character-Harbour_Lighthouse\.txt$/.test(noChar.downloads[0].name),
    noChar.downloads[0].name + ' | ' + noChar.downloads[0].text.slice(0, 40));

  var noMsgs = build({});
  noMsgs.sb.Store.getMessages = function () { return Promise.resolve([]); };
  await noMsgs.App.exportTranscript('s1', 'md');
  ok('an empty chat exports as an empty document, not as a crash',
    noMsgs.downloads.length === 1 && /0 messages_/.test(noMsgs.downloads[0].text),
    JSON.stringify(noMsgs.downloads[0] && noMsgs.downloads[0].text.slice(0, 80)));

  console.log('\nF — the sheet offers it');

  var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  ok('the export sheet has a Markdown row next to the other two',
    /data-a="md"/.test(appSrc) && /For publishing \(\.md\)/.test(appSrc));
  ok('…and the row leads to the same function with the format',
    /App\.exportTranscript\(id, 'md'\)/.test(appSrc));
  ok('the txt path is unchanged for anyone who used it before',
    /if \(a === 'text'\) App\.exportTranscript\(id\);/.test(appSrc));
  eq('both renderers are reachable on App, so a format can be tested without a DOM',
    [typeof App.renderTranscriptTxt, typeof App.renderTranscriptMd, typeof App.transcriptParts].join(','),
    'function,function,function');

  console.log('\n' + (fail ? 'FAILED — ' : 'ok — ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
