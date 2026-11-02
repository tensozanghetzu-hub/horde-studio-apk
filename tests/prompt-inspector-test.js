/* Prompt inspector previews the same prompt builder used for generation, without exposing credentials. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var root=path.join(__dirname,'..'), captured=null, buildArgs=null;
var session={id:'s1',charId:'a',title:'Test',summary:'A remembered fact.',facts:[],overrides:{note:'Clipped style'},sceneNote:'Rain outside',sceneNotePlacement:'end',sceneNoteFrequency:1,groupCharIds:['a','b'],speakerMode:'manual',nextSpeakerId:'b'};
var cast={a:{id:'a',name:'Alpha',persona:'First.'},b:{id:'b',name:'Beta',persona:'Second.'}};
var sb={console:console,document:{addEventListener:function(){}},
  UI:{esc:function(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');},icon:function(){return '';},toast:function(){},sheet:function(opts){captured=opts;return Promise.resolve(null);}},
  Store:{settings:{systemPrompt:'Stay safe.',maxTokens:600,provider:'openrouter'},getCharacter:function(id){return Promise.resolve(cast[id]||null);},getMessages:function(){return Promise.resolve([{role:'user',text:'Hello'}]);}},
  IDB:{get:function(){return Promise.resolve(session);}},
  API:{HORDE_CTX_TOKENS:8192,
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
  session.nextSpeakerId='';
  await sb.App.promptInspector('s1');
  ok('manual group preview warns when no next speaker was selected',captured&&/real reply still requires your manual selection/.test(captured.body));
  sb.Store.settings.provider='horde';
  await sb.App.promptInspector('s1');
  ok('Horde preview uses its plain-text prompt builder and token budget',buildArgs&&buildArgs.kind==='horde'&&buildArgs.budget===7528&&/Exact Horde prompt/.test(captured.body));
  console.log('\nprompt-inspector-test: '+(fail?fail+' failed, ':'')+pass+' ok');
  process.exit(fail?1:0);
})().catch(function(e){console.error(e);process.exit(1);});
