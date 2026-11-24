/* Prompt inspector previews the same prompt builder used for generation, without exposing credentials. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var root=path.join(__dirname,'..'), captured=null, buildArgs=null;
var session={id:'s1',charId:'a',title:'Test',summary:'A remembered fact.',facts:[],overrides:{note:'Clipped style'},sceneNote:'Rain outside',sceneNotePlacement:'end',sceneNoteFrequency:1,groupCharIds:['a','b'],speakerMode:'manual',nextSpeakerId:'b'};
var cast={a:{id:'a',name:'Alpha',persona:'First.'},b:{id:'b',name:'Beta',persona:'Second.'}};
/* what the builders would have recorded on a real chat: the numbers come from
   API.lastAssembly(), so the test feeds the same shape and checks what the sheet
   does with it — including a credential planted inside the request body. */
var asm={shape:'chat',available:80,window:40,messageCap:40,ceilingIsDefault:false,scanTurns:6,sent:33,
  trimmedByBudget:7,droppedByCap:0,examplesDropped:true,bytes:24000,cap:128000,overCap:false,
  historyTokens:6000,cardTokens:900,replyTokens:600,modelWindow:8192,
  lore:{total:12,admitted:6,limit:10,budget:5000,turns:6,compat:false,skipped:[{entry:4,why:'budget',both:false,keys:'the ridge',chars:900}]}};
var planBody={model:'x:free',temperature:0.7,top_p:1,max_tokens:600,stream:false,models:['x:free','y:free'],
  messages:[{role:'system',content:'System prompt with rain and style.'},{role:'user',content:'Hello'}],
  reasoning:{enabled:false},_leak:'sk-or-v1-'+'a'.repeat(64)};
var wrote=null, toastMsg='';
var sb={console:console,document:{addEventListener:function(){}},
  navigator:{userAgent:'node',clipboard:{writeText:function(v){wrote=v;return Promise.resolve();}}},
  UI:{esc:function(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');},icon:function(){return '';},toast:function(m){toastMsg=m;},sheet:function(opts){captured=opts;return Promise.resolve(null);}},
  Store:{settings:{systemPrompt:'Stay safe.',maxTokens:600,provider:'openrouter'},getCharacter:function(id){return Promise.resolve(cast[id]||null);},getMessages:function(){return Promise.resolve([{role:'user',text:'Hello'}]);}},
  IDB:{get:function(){return Promise.resolve(session);}},
  API:{lastAssembly:function(){return asm;},resetAssembly:function(){},
    chatRequestPlan:function(){return {body:planBody,wantStream:false,reasoningGuarded:true}},
  HORDE_CTX_TOKENS:8192,DEFAULT_MAX_TOKENS:400,maxTokensOf:function(s){return (s&&s.maxTokens)||400;},
    buildChat:function(char,sess,messages,settings,note){buildArgs={kind:'chat',char:char,session:sess,messages:messages,settings:settings,note:note};return [{role:'system',content:'System prompt with rain and style.'},{role:'user',content:'Hello'}];},
    buildPrompt:function(char,sess,messages,settings,note,budget){buildArgs={kind:'horde',char:char,session:sess,messages:messages,settings:settings,note:note,budget:budget};return 'Exact Horde prompt';}},
  Promise:Promise,Array:Array,Object:Object,String:String,Math:Math,Date:Date,setTimeout:setTimeout,setInterval:function(){},clearInterval:function(){}};
sb.window=sb; sb.global=sb;
vm.runInNewContext(fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8'),sb,{filename:'app.js'});
var pass=0,fail=0;
function ok(label,cond){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label);}}
(async function(){
  await sb.App.promptInspector('s1');
  ok('inspector uses the manually selected group speaker',buildArgs&&buildArgs.char.id==='b');
  ok('inspector uses the actual API prompt builder and style override',buildArgs&&buildArgs.note==='Clipped style');
  ok('inspector shows message roles, token estimate, and exact prompt text',captured&&captured.title==='Prompt & context inspector'&&/System prompt \/ context/.test(captured.body)&&/tokens/.test(captured.body)&&/System prompt with rain and style/.test(captured.body));
  ok('the cuts the builders recorded get their own block',/What this request left out/.test(captured.body));
  ok('…opened by default, because it is the reason to open the sheet',/<details open[^>]*><summary[^>]*>What this request left out/.test(captured.body));
  ok('…naming the messages the ceiling did not offer',/40 of the 80 messages in this chat were not offered/.test(captured.body));
  ok('…attributing the rest to the history budget, with its number',/7 more dropped so the transcript fit the history budget of 6,000 tokens/.test(captured.body));
  ok('…and reporting the examples as the last resort they are',/example dialogue was dropped/.test(captured.body));
  ok('lore rows are admitted-over-ceiling, not merely found',/Lorebook: 12 entries, 6 in this prompt[^<]*ceiling 10 entries and 5,000 bytes[^<]*6 turns/.test(captured.body));
  ok('…and a cut entry is named with the reason it was cut',/\u201Cthe ridge\u201D \u2014 the byte budget \(entry 5\)/.test(captured.body));
  ok('the model window is quoted with what the card and reply take from it',/window is read as 8,192 tokens[^<]*take 1,500/.test(captured.body));
  ok('the request body is a fold, not a dump',/<summary[^>]*>Request body/.test(captured.body)&&/<details style="margin:9px[^>]*><summary[^>]*>Request body/.test(captured.body));
  ok('…showing the fields the wire gets, with the messages collapsed to a count',/shown block by block above/.test(captured.body)&&/x:free/.test(captured.body));
  ok('…and redacting a credential that sits inside the body',captured.body.indexOf('[credential redacted]')!==-1&&captured.body.indexOf('sk-or-v1-aaaaaaaa')===-1);
  ok('…with a copy action wired in the mount, not in the button markup',/id="pi-copy"/.test(captured.body)&&typeof captured.onMount==='function');
  /* the sheet is not the artefact — the clipboard is. Press the button. */
  var btn={},root={querySelector:function(sel){return sel==='#pi-copy'?btn:null;}};
  captured.onMount(root);
  ok('the mount wires the button it was handed',typeof btn.onclick==='function');
  if(typeof btn.onclick==='function') btn.onclick();
  await new Promise(function(r){setTimeout(r,0);});
  ok('pressing it copies the FULL body, messages included',wrote!==null&&/"messages":\s*\[/.test(wrote),wrote===null?'nothing written':wrote.slice(0,90));
  ok('…with the credential inside it replaced',wrote!==null&&wrote.indexOf('[credential redacted]')!==-1&&wrote.indexOf('sk-or-v1-aaaaaaaa')===-1,wrote&&wrote.slice(0,120));
  ok('…and the user is told what was done to it',/Request copied/.test(toastMsg)&&/replaced/.test(toastMsg),toastMsg);
  session.nextSpeakerId='';
  await sb.App.promptInspector('s1');
  ok('manual group preview warns when no next speaker was selected',captured&&/real reply still requires your manual selection/.test(captured.body));
  sb.Store.settings.provider='horde';
  await sb.App.promptInspector('s1');
  ok('Horde preview uses its plain-text prompt builder and token budget',buildArgs&&buildArgs.kind==='horde'&&buildArgs.budget===7528&&/Exact Horde prompt/.test(captured.body));
  ok('a Horde preview says where its request is built instead of inventing a body',/assembled in horde.js/.test(captured.body)&&!/Request body/.test(captured.body));
  ok('…and still reports what the builder cut',/What this request left out/.test(captured.body));
  console.log('\nprompt-inspector-test: '+(fail?fail+' failed, ':'')+pass+' ok');
  process.exit(fail?1:0);
})().catch(function(e){console.error(e);process.exit(1);});
