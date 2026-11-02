/* Chat-scoped lorebook entries stay within their session and only inject on keyword hits. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var SRC=path.join(__dirname,'..','horde-studio-mobile','js','api.js');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder,fetch:function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('')}});}};
sb.window=sb; sb.global=sb;
vm.runInNewContext(fs.readFileSync(SRC,'utf8'),sb,{filename:'api.js'});
var API=sb.API, pass=0,fail=0;
function ok(label,cond,extra){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label+(extra?' -> '+extra:''));}}
var char={id:'c1',name:'Mara',persona:'A careful archivist.',scenario:'An old library.',examples:'',postHistory:'',lorebook:[{keys:['archive bell'],content:'The character-wide archive bell rings at dusk.',enabled:true}]};
var settings={systemPrompt:'Stay in character.',userName:'You',userPersona:'',temperature:0.8,maxTokens:600,contextMessages:40,maxContextChars:26000};
function prompt(session,history){return API.buildChat(char,session,history,settings,null)[0].content;}
var sessionA={id:'a',summary:'',facts:[],chatLorebook:[{keys:['silver gate'],content:'In this timeline, the silver gate is sealed.',enabled:true},{keys:['secret passage'],content:'This entry is disabled.',enabled:false}]};
var sessionB={id:'b',summary:'',facts:[],chatLorebook:[]};
var both=prompt(sessionA,[{role:'user',text:'The archive bell sounds near the silver gate.'}]);
ok('existing character lore still injects',both.indexOf('The character-wide archive bell rings at dusk.')>=0);
ok('active session lore injects on its keyword',both.indexOf('In this timeline, the silver gate is sealed.')>=0);
ok('disabled session entry stays out',both.indexOf('This entry is disabled.')<0);
var other=prompt(sessionB,[{role:'user',text:'The silver gate is mentioned.'}]);
ok('another chat with the same character does not inherit this session lore',other.indexOf('In this timeline, the silver gate is sealed.')<0);
var noHit=prompt(sessionA,[{role:'user',text:'A quiet morning in town.'}]);
ok('session lore stays absent until a keyword appears',noHit.indexOf('In this timeline, the silver gate is sealed.')<0);
ok('character lore still works independently of session lore',noHit.indexOf('The character-wide archive bell rings at dusk.')<0);
var oldSession=prompt({id:'old',summary:'',facts:[]},[{role:'user',text:'The silver gate is mentioned.'}]);
ok('legacy sessions without a chatLorebook remain valid',oldSession.indexOf('Relevant chat-only facts:')<0);
var app=fs.readFileSync(path.join(__dirname,'..','horde-studio-mobile','js','app.js'),'utf8');
var store=fs.readFileSync(path.join(__dirname,'..','horde-studio-mobile','js','store.js'),'utf8');
ok('chat menu links to a chat-only lorebook editor',/data-a="chatlore"/.test(app)&&/App\.chatLoreBookSheet\(id\)/.test(app));
ok('chat lore editor exposes trigger, content, enabled, save, and remove controls',/id="clk"/.test(app)&&/id="clc"/.test(app)&&/id="cle"/.test(app)&&/label: 'Save'/.test(app)&&/label: 'Remove'/.test(app));
ok('editor saves and removes entries on the chat session, not the character',/session\.chatLorebook = entries/.test(app)&&/Store\.putSession\(session\)/.test(app));
ok('new sessions initialize an empty chat lorebook',/chatLorebook:\s*\[\]/.test(store));
ok('forked timelines copy chat-scoped lore entries and clone keyword arrays',/s2\.chatLorebook\s*=\s*\(old\.chatLorebook\s*\|\|\s*\[\]\)\.map/.test(app)&&/keys:\s*\(e\.keys\s*\|\|\s*\[\]\)\.slice\(\)/.test(app));
console.log('\nchat-lorebook-test: '+(fail?fail+' failed, ':'')+pass+' ok');
process.exit(fail?1:0);
