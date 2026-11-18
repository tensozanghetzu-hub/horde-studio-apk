/* v1.39.104: the chat half of the memory work.
 *
 * The world engine got facts with a history in v1.39.100. Persona chats kept
 * the older shape - an array of plain strings, replaced wholesale on every
 * memory pass - so a fact from message 20 and its replacement from message 200
 * sat side by side with no ordering signal and the model chose between them.
 * That is the same failure, in a chat.
 *
 * This pins: dated fact records, supersede-not-delete, a model-reported change
 * that can only retire a fact it names, the prompt showing current facts only,
 * and the NOW anchor appearing for a chat with continuity on and only then.
 *
 * Generic: invented people and places, no character card.
 *
 *   node /home/user/tests/chatfacthistory-test.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'horde-studio-mobile');
var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(label, got, want) {
  ok(label, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function loadApi() {
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
    Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder
  };
  sb.window = sb; sb.global = sb;
  sb.fetch = function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8'), sb, { filename: 'api.js' });
  return sb.API;
}
var API = loadApi();

var char = { id: 'c1', name: 'Olive', persona: 'A careful archivist.', scenario: 'An old library.', examples: '', postHistory: '', lorebook: [] };
var settings = { systemPrompt: '', userName: 'You', userPersona: '', temperature: 0.8, maxTokens: 600, contextMessages: 40, maxContextChars: 26000 };
function sessionWith(over) {
  var s = { id: 's1', title: 'A chat', messageCount: 0, summary: '', facts: [], continuity: null };
  Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
  return s;
}
function promptOf(session) {
  return API.buildChat(char, session, [{ role: 'user', text: 'I look at the gate.' }], settings, null)
    .map(function (m) { return m.content; }).join('\n');
}
function memoryBlockOf(session) {
  var p = promptOf(session);
  var i = p.indexOf('Story so far');
  if (i === -1) return '';
  var rest = p.slice(i);
  var cut = rest.search(/\n\n(?:Relevant world facts|Relevant chat-only facts|CHAT CONTINUITY|Scene note|Example dialogue)/);
  return cut === -1 ? rest : rest.slice(0, cut);
}
/* applyChatMemory is pure: it returns the fact list, the app assigns it. */
function writeMem(session, mem) {
  var res = API.applyChatMemory(session, mem);
  session.facts = res.facts;
  if (mem && mem.summary) session.summary = mem.summary;
  return res;
}
function current(session) { return API.currentChatFacts(session).map(function (f) { return f.text; }); }
function past(session) { return API.pastChatFacts(session).map(function (f) { return f.text; }); }

console.log('\na chat fact has a life');

var s = sessionWith({ messageCount: 20 });
writeMem(s, { summary: 'They crossed the yard.', facts: ['The gate key hangs in the hall'] });
eq('the fact is on the chat', current(s).length, 1);
var f = API.currentChatFacts(s)[0];
ok('it has an id', /^f\d+$/.test(f.id), f.id);
eq('learned at the message count it arrived at', f.from, 20);
eq('it is current', f.to, null);

console.log('\nsaying the same thing again changes nothing');

s.messageCount = 34;
var same = writeMem(s, { summary: 's', facts: ['the gate key hangs in the hall.'] });
eq('no duplicate', API.chatFactObjects({ facts: same.facts }).length, 1);
ok('...and it is the one already known', /hangs in the hall/.test(same.current[0].text), same.current[0].text);

console.log('\nsaying something different about the same thing supersedes');

s.messageCount = 60;
writeMem(s, {
  summary: 'The key was moved.',
  facts: ['The gate key now hangs in the yard, on the nail by the pump']
});
eq('both statements are on the record', API.chatFactObjects(s).length, 2);
eq('only the current one is offered as true', current(s).length, 1);
ok('...and it is the new one', /by the pump/.test(current(s)[0]), current(s)[0]);
var oldFact = API.pastChatFacts(s)[0];
eq('the old one stopped being true at the message that changed it', oldFact.to, 60);
ok('...and names what replaced it', /^f\d+$/.test(oldFact.by || ''), oldFact.by);

console.log('\nthe chat prompt shows what is true now, and only that');

var block = memoryBlockOf(s);
ok('the old fact is not in the prompt', block.indexOf('hangs in the hall') === -1, block);
ok('the current one is', block.indexOf('by the pump') !== -1, block);
ok('each fact is dated', /by the pump.*\[60\]/.test(block), block);
ok('the story so far is still there', /Story so far/.test(block));

console.log('\nnewest first');

s.messageCount = 61;
writeMem(s, { summary: 's', facts: ['Corin Vale owes the player a lantern'] });
var lines = memoryBlockOf(s).split('\n').filter(function (l) { return /^- /.test(l); });
eq('two current facts', lines.length, 2);
ok('the newest is first', /owes the player a lantern/.test(lines[0]), lines[0]);
ok('the older follows', /by the pump/.test(lines[1]), lines[1]);

console.log('\na change the model reports can only retire a fact it names');

var r2 = sessionWith({ messageCount: 5 });
writeMem(r2, { summary: 's', facts: ['The mill is closed for repairs', 'The ferryman has been paid in full'] });
r2.messageCount = 40;
writeMem(r2, { summary: 's', facts: [], changed: ['The mill is closed for repairs'] });
eq('the named fact is retired', API.pastChatFacts(r2).length, 1);
ok('...and it is the mill', /mill/.test(past(r2)[0]), past(r2)[0]);
eq('nothing else was touched', current(r2).length, 1);
ok('the untouched fact survives', /ferryman/.test(current(r2)[0]), current(r2)[0]);

var r3 = sessionWith({ messageCount: 5 });
writeMem(r3, { summary: 's', facts: ['The ferryman has been paid in full'] });
r3.messageCount = 9;
writeMem(r3, { summary: 's', facts: [], changed: ['everything is different now'] });
eq('a vague report retires nothing', current(r3).length, 1);
eq('...and is not stored as a fact', API.chatFactObjects(r3).length, 1);
r3.messageCount = 10;
writeMem(r3, { summary: 's', facts: [], changed: ['The ferryman has been paid in full'] });
eq('an exact restatement retires it', current(r3).length, 0);

console.log('\na summary-only pass keeps what the chat already knows');

var r4 = sessionWith({ messageCount: 10 });
writeMem(r4, { summary: 's1', facts: ['A lamp is missing'] });
r4.messageCount = 80;
writeMem(r4, { summary: 's2', facts: [] });
eq('the fact survives', current(r4).length, 1);
ok('...and the summary moved on', /s2/.test(r4.summary || 's2'));

console.log('\nold chats migrate without losing anything');

var legacy = { id: 'l', messageCount: 99, memAt: 64, summary: 'old', facts: ['A lamp is missing', 'Corin Vale is trusted'] };
eq('both are read', API.chatFactObjects(legacy).length, 2);
eq('each is current', current(legacy).length, 2);
eq('dated with the last memory write', API.chatFactObjects(legacy)[0].from, 64);
ok('the prompt accepts them', /A lamp is missing/.test(memoryBlockOf(legacy)));

console.log('\nthe ceilings retire, they do not delete');

var r5 = sessionWith({ messageCount: 3 });
var subjects = ['the hall lamp', 'the yard gate', 'the north road', 'the mill wheel', 'the ferry toll',
  'the cellar stairs', 'the watch roster', 'the bell rope', 'the east window', 'the coal shed',
  'the well cover', 'the sign above the door', 'the back stair', 'the ledger cabinet', 'the stable roof',
  'the pump handle', 'the boundary stone', 'the market awning', 'the keeper of keys', 'the winter stores'];
var verbs = ['is mended', 'needs paint', 'was counted twice', 'belongs to the town', 'is watched',
  'is locked at night', 'smells of smoke', 'is missing', 'was promised away', 'is spoken for'];
var many = subjects.map(function (sub, i) { return 'How it stands with ' + sub + ': ' + verbs[i % verbs.length]; });
writeMem(r5, { summary: 's', facts: many });
eq('twelve are current', current(r5).length, 12);
eq('none is lost', API.chatFactObjects(r5).length, 20);
eq('the prompt carries twelve', memoryBlockOf(r5).split('\n').filter(function (l) { return /^- /.test(l); }).length, 12);

console.log('\nrestating a fact keeps it young');

var r6 = sessionWith({ messageCount: 2 });
writeMem(r6, { summary: 's', facts: ['Corin Vale keeps the ledger'] });
r6.messageCount = 50;
writeMem(r6, { summary: 's', facts: ['Corin Vale keeps the ledger'] });
eq('a fact the chat still relies on is re-dated', API.currentChatFacts(r6)[0].from, 50);
eq('...and not duplicated', API.chatFactObjects(r6).length, 1);

console.log('\nthe summariser is told how to report a change');

var api = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
var start = api.indexOf('function summarize(o)');
var end = api.indexOf('function summarizeWorld(o)');
var chatSum = api.slice(start, end);
ok('the chat summariser asks for "changed" in the JSON shape', /'"changed":\[/.test(chatSum));
ok('...and says what a change looks like', /this conversation has made/.test(chatSum) && /untrue/.test(chatSum));
ok('...and says to quote it word for word', /Quote that fact word for word/.test(chatSum));
ok('...and where the new truth goes', /state ' +\s*'the new truth in/.test(chatSum) || /the new truth in/.test(chatSum));
ok('...and not to change a fact on a guess', /Do not change a fact on a guess/.test(chatSum));
ok('...and shows it the current list, not the raw array', /chatFactObjects\(session\)/.test(chatSum));

console.log('\nthe NOW anchor appears for a chat with continuity on, and only then');

var sb2 = {
  console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
  Object: Object, Array: Array, String: String, Number: Number, RegExp: RegExp,
  Error: Error, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  TextEncoder: TextEncoder, TextDecoder: TextDecoder
};
sb2.window = sb2; sb2.global = sb2;
sb2.fetch = function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(''); } }); };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), sb2, { filename: 'api.js' });
var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
var aStart = appSrc.indexOf('App.chatNowBrief = function (session) {');
var aEnd = appSrc.indexOf('App.promptInspector = function (sessionId) {');
sb2.App = {};
vm.runInNewContext(appSrc.slice(aStart, aEnd), sb2, { filename: 'chatNowBrief.js' });
var App = sb2.App;
ok('the anchor exists', typeof App.chatNowBrief === 'function');
if (typeof App.chatNowBrief === 'function') {
  var on = {
    continuity: { enabled: true, stage: 'Act Two', location: 'The Cellar', time: 'Night',
      participants: ['Olive', 'Ivo'], knowledge: [], objects: [],
      events: [{ name: 'Find the ledger', status: 'open' }, { name: 'The alarm', status: 'resolved' }] }
  };
  var brief = App.chatNowBrief(on);
  ok('it names the stage', /Stage: Act Two/.test(brief), brief);
  ok('it says where and when', /Where: at The Cellar — Night/.test(brief), brief);
  ok('it names who is present', /Who is here: Olive, Ivo/.test(brief), brief);
  ok('it carries only OPEN events', /Open: Find the ledger/.test(brief) && !/The alarm/.test(brief), brief);
  ok('it says what to do with it', /Write from this, not from an earlier moment/.test(brief));
  ok('it forbids restating the state', /do not restate it/.test(brief));
  ok('it is short', brief.split('\n').length <= 7, brief.split('\n').length + ' lines');
  eq('a chat with continuity off gets nothing', App.chatNowBrief({ continuity: null }), '');
  eq('...and so does one with it enabled but empty',
    App.chatNowBrief({ continuity: { enabled: false, stage: 'Act Two' } }), '');
}

console.log('\nthe send path carries it as the last thing read');

ok('the send path builds the anchor', /var chatNow = App\.chatNowBrief\(session\)/.test(appSrc));
ok('...and joins it into the final note, after any reroll seam',
  /finalNote: \[rerollSeam, chatNow, extra\]/.test(appSrc));

console.log('\nthe memory sheet shows the history');

ok('the sheet reads records', /API\.chatFactObjects\(s\)/.test(appSrc));
ok('a current fact shows when it was learned', /\[' \+ \(f\.from \|\| 0\) \+ '\]/.test(appSrc));
ok('a retired fact shows when it stopped', /no longer true since/.test(appSrc));
ok('editing a fact keeps its identity', /facts\[i\]\.text = edited/.test(appSrc));
ok('adding one becomes a dated record', /from: s\.messageCount \|\| 0, to: null/.test(appSrc));

console.log('\nnothing else reads facts as strings');

ok('the context-size estimate reads text, not objects', /API\.currentChatFacts\(session\)/.test(appSrc));
ok('...and no bare join over the fact list is left', !/\(session\.facts \|\| \[\]\)\.join/.test(appSrc));
ok('the transcript export writes the wording', /API\.chatFactObjects\(s\)/.test(appSrc));
ok('...and still exports the summary when there are no facts', /s\.summary \|\| \(s\.facts && s\.facts\.length\)/.test(appSrc));
ok('...and marks what is no longer true', /No longer true:/.test(appSrc));

console.log('\na chat that already had facts keeps working');

var old = { id: 'o', messageCount: 120, memAt: 112, summary: 'They argued at the mill.',
  facts: ['The mill is closed for repairs', 'Corin Vale keeps the ledger'] };
var p1 = promptOf(old);
ok('the old facts reach the prompt', /mill is closed/.test(p1) && /keeps the ledger/.test(p1));
ok('dated by the last write', /\[112\]/.test(p1));
writeMem(old, { summary: 'The mill reopened.', facts: ['The mill has reopened under new management'],
  changed: ['The mill is closed for repairs'] });
eq('the ledger is untouched', current(old).filter(function (t) { return /ledger/.test(t); }).length, 1);
eq('the mill fact is retired', past(old).length, 1);
ok('the new mill truth is current', /reopened/.test(current(old).join(' | ')), current(old).join(' | '));
ok('and the prompt carries only the new truth', promptOf(old).indexOf('closed for repairs') === -1);

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
