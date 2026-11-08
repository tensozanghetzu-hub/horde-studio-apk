/* Generic per-chat continuity: isolation, approval-ready proposals, and stage-gated lore. */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var sb = { console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, Object: Object,
  Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error, isNaN: isNaN,
  parseFloat: parseFloat, parseInt: parseInt, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
  fetch: function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); } };
sb.window = sb; sb.global = sb;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), sb, { filename: 'api.js' });
var API = sb.API, pass = 0, fail = 0;
function ok(label, condition, extra) { if (condition) { pass++; console.log('  ok   ' + label); } else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); } }
var char = { id: 'c1', name: 'Mara', persona: 'A careful archivist.', scenario: 'An old library.', examples: '', postHistory: '', lorebook: [
  { keys: ['sealed gate'], content: 'Stage-independent: the library has a west wing.', enabled: true },
  { keys: ['sealed gate'], content: 'At the trial stage, the gate has cracked.', enabled: true, stage: 'The trial' }
] };
var settings = { systemPrompt: 'Stay in character.', userName: 'You', userPersona: '', temperature: 0.8, maxTokens: 600, contextMessages: 40, maxContextChars: 26000 };
function prompt(session, text) { return API.buildChat(char, session, [{ role: 'user', text: text || 'The sealed gate is here.' }], settings, null)[0].content; }
var a = { id: 'a', continuity: { enabled: true, stage: 'The trial', location: 'Archive', time: 'Evening', participants: ['Mara'], knowledge: [
  { who: 'Mara', fact: 'the gate is cracked', basis: 'witnessed it' },
  { who: '{{user}}', fact: 'the note is forged', basis: 'was told by Mara' },
  { who: 'Narrator only', fact: 'the key is cursed', basis: 'hidden world truth' },
  { who: 'Ivo', fact: 'the door is trapped', basis: 'inferred from scratches' }
], objects: [{ name: 'Brass key', state: 'bent but usable', holder: 'Mara', basis: 'picked up from floor' }], events: [
  { name: 'Find the missing ledger', status: 'open', detail: 'Last seen in the archive' },
  { name: 'Disable the bell', status: 'resolved', detail: 'Confirmed by Mara' }
] }, chatLorebook: [
  { keys: ['sealed gate'], content: 'Chat-only: this timeline has a silver gate.', enabled: true },
  { keys: ['sealed gate'], content: 'Stage-locked chat secret.', enabled: true, stage: 'After the trial' }
] };
var pa = prompt(a);
ok('enabled continuity state is injected into a character-independent prompt', pa.indexOf('CHAT CONTINUITY LEDGER') >= 0 && pa.indexOf('Location: Archive') >= 0);
ok('scene participants and stage are included', pa.indexOf('Present in scene: Mara') >= 0 && pa.indexOf('Stage: The trial') >= 0);
ok('present NPC knowledge is tracked with provenance', pa.indexOf('Mara knows: the gate is cracked (basis: witnessed it)') >= 0);
ok('off-scene NPC knowledge is excluded from the prompt', pa.indexOf('Ivo knows:') < 0);
ok('player knowledge and narrator-only truth remain distinct', pa.indexOf('Facts explicitly known to {{user}}') >= 0 && pa.indexOf('Narrator-only world facts') >= 0);
ok('object state and resolved/open events are injected', pa.indexOf('Brass key: bent but usable') >= 0 && pa.indexOf('Find the missing ledger') >= 0 && pa.indexOf('Disable the bell') >= 0);
ok('matching stage-gated character and chat lore is injected', pa.indexOf('At the trial stage, the gate has cracked.') >= 0 && pa.indexOf('Chat-only: this timeline has a silver gate.') >= 0);
ok('nonmatching stage-gated lore is withheld', pa.indexOf('Stage-locked chat secret.') < 0);
var b = prompt({ id: 'b', continuity: { enabled: true, stage: 'Before the trial', participants: ['Ivo'], knowledge: [], objects: [], events: [] }, chatLorebook: [] });
ok('another chat with the same character receives no continuity leaks', b.indexOf('Archive') < 0 && b.indexOf('Mara knows:') < 0 && b.indexOf('silver gate') < 0);
var disabled = prompt({ id: 'c', continuity: { enabled: false, stage: 'The trial' }, chatLorebook: [] });
ok('opt-out default suppresses continuity and stage-gated lore', disabled.indexOf('CHAT CONTINUITY LEDGER') < 0 && disabled.indexOf('At the trial stage') < 0);
ok('stage-independent lore continues to work when continuity is off', disabled.indexOf('Stage-independent: the library has a west wing.') >= 0);

var raw = 'The room grew quiet.\n<continuity_update>{"reason":"Mara showed the key","changes":[' +
  '{"type":"participant","op":"add","name":"Ivo"},' +
  '{"type":"knowledge","op":"add","who":"Ivo","fact":"the key is bent","basis":"Mara showed it to him"},' +
  '{"type":"object","op":"set","name":"Brass key","state":"bent","holder":"Ivo","basis":"he took it"},' +
  '{"type":"event","op":"resolve","name":"Find the missing ledger","detail":"Located in the archive"}]}</continuity_update>';
var proposal = API.parseContinuityUpdate(raw);
ok('tagged model proposal parses into bounded structured changes', !!proposal && proposal.changes.length === 4);
ok('tagged state is stripped from user-visible prose', API.stripContinuityUpdate(raw) === 'The room grew quiet.');
ok('stream hides an unfinished proposal tag', API.hideContinuityUpdate('visible prose<continuity_update>{"changes":') === 'visible prose');
var applied = API.applyContinuityProposal(a.continuity, proposal);
ok('proposal application updates only approved ledger data', applied.participants.indexOf('Ivo') >= 0 && applied.objects[0].holder === 'Ivo' && applied.events[0].status === 'resolved');
ok('knowledge proposal retains its provenance', applied.knowledge.some(function (x) { return x.who === 'Ivo' && x.basis === 'Mara showed it to him'; }));
ok('unapproved source state remains unchanged', a.continuity.participants.length === 1 && a.continuity.events[0].status === 'open');
ok('invalid or provenance-free knowledge suggestions are rejected', API.parseContinuityUpdate('<continuity_update>{"changes":[{"type":"knowledge","op":"add","who":"Ivo","fact":"a secret"}]}</continuity_update>') === null);
var imported = API.parseLorebookFile(JSON.stringify({ entries: [{ keys: ['gate'], content: 'A stage fact.', stage: 'Act two' }] }));
ok('lorebook import preserves optional stage metadata', imported.length === 1 && imported[0].stage === 'Act two');
var app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
var store = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
var views = fs.readFileSync(path.join(ROOT, 'js/views.js'), 'utf8');
ok('new sessions default to opt-in continuity', /continuity:\s*\{\s*enabled:\s*false/.test(store));
ok('app provides continuity editor and user-approved review actions', /App\.continuitySheet\s*=/.test(app) && /App\.reviewContinuityProposal\s*=/.test(app) && /Apply approved changes/.test(app));
ok('reply handler stores proposals only for enabled chats and hides tags', /session\.continuity\.enabled === true/.test(app) && /API\.stripContinuityUpdate/.test(app) && /API\.hideContinuityUpdate/.test(app));
ok('continuity is included in per-chat export/import and timeline forks', /continuity:\s*s\.continuity/.test(app) && /s\.continuity\s*=\s*API\.normalizeContinuity/.test(app) && /s2\.continuity\s*=/.test(app));
ok('message actions expose pending continuity proposals for review', /data-act="continuity-review"/.test(views) && /App\.reviewContinuityProposal\(msg\)/.test(app));
ok('timeline stage is editable on lore entries and carried through card import/export', /Timeline stage \(optional, exact match\)/.test(app) && /stage:\s*e\.stage\s*\|\|\s*''/.test(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8')));
console.log('\ncontinuity-test: ' + (fail ? fail + ' failed, ' : '') + pass + ' ok');
process.exit(fail ? 1 : 0);
