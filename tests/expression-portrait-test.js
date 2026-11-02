/* Expression portraits are optional, match private mood text, and stay display-only. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var root=path.join(__dirname,'..');
var sb={console:console,document:{addEventListener:function(){}},UI:{esc:function(x){return String(x||'');},icon:function(){return '';},toast:function(){}},Store:{},Promise:Promise,Array:Array,Object:Object,String:String,Math:Math,Date:Date,setTimeout:setTimeout,setInterval:function(){},clearInterval:function(){}};
sb.window=sb; sb.global=sb;
vm.runInNewContext(fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8'),sb,{filename:'app.js'});
var pass=0,fail=0;
function ok(label,cond){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label);}}
var char={expressionPortraits:[{label:'Amused',keys:['amused','teasing'],src:'data:image/png;base64,portrait-a'},{label:'Worried',keys:['uneasy','worried'],src:'https://example.test/worried.jpg'}]};
ok('portrait match is case-insensitive and can match a mood phrase',sb.App.expressionPortraitFor(char,'quietly AMUSED and teasing')==='data:image/png;base64,portrait-a');
ok('unmatched moods fall back to the ordinary avatar',sb.App.expressionPortraitFor(char,'calm and focused')==='');
var views=fs.readFileSync(path.join(root,'horde-studio-mobile/js/views.js'),'utf8');
var app=fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8');
var store=fs.readFileSync(path.join(root,'horde-studio-mobile/js/store.js'),'utf8');
ok('character editor supports optional portrait labels, mood keys, URLs, and uploads',/Expression portraits · optional/.test(views)&&/data-expr-keys/.test(views)&&/data-expr-file/.test(views));
ok('generated state mood is saved on the message and selects its portrait',/msg\.speakerMood = newState\.mood/.test(app)&&/msg\.speakerPortrait = App\.expressionPortraitFor/.test(app)&&/m\.speakerPortrait/.test(views));
ok('portrait definitions round-trip in a private card extension',/expressionPortraitsFromCard/.test(store)&&/extensions\.horde_studio/.test(store)&&/expression_portraits/.test(store));
var apiCtx={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder,fetch:function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('')}});}};
apiCtx.window=apiCtx; apiCtx.global=apiCtx;
vm.runInNewContext(fs.readFileSync(path.join(root,'horde-studio-mobile/js/api.js'),'utf8'),apiCtx,{filename:'api.js'});
var payload=apiCtx.API.buildChat({id:'c',name:'Mara',persona:'Archivist.',scenario:'',greeting:'',examples:'',postHistory:'',lorebook:[],expressionPortraits:char.expressionPortraits},{id:'s',summary:'',facts:[]},[{role:'user',text:'Hello'}],{systemPrompt:'Stay in character.',userName:'You',maxTokens:600},null);
var serialized=JSON.stringify(payload);
ok('portrait images and mapping rules never enter the model prompt',serialized.indexOf('data:image/png;base64,portrait-a')<0&&serialized.indexOf('worried.jpg')<0&&serialized.indexOf('expressionPortraits')<0);
console.log('\nexpression-portrait-test: '+(fail?fail+' failed, ':'')+pass+' ok');
process.exit(fail?1:0);
