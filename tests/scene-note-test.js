/* Per-chat scene-note cadence and placement preserve baseline prompt behavior. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var root=path.join(__dirname,'..');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder,fetch:function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('')}});}};
sb.window=sb; sb.global=sb;
vm.runInNewContext(fs.readFileSync(path.join(root,'horde-studio-mobile/js/api.js'),'utf8'),sb,{filename:'api.js'});
var API=sb.API, pass=0,fail=0;
function ok(label,cond){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label);}}
var char={id:'c1',name:'Mara',persona:'A careful archivist.',scenario:'In the old library.',examples:'',postHistory:'Card-wide ending instruction.',lorebook:[]};
var settings={systemPrompt:'Stay in character.',userName:'You',userPersona:'',temperature:0.8,maxTokens:600,contextMessages:40,maxContextChars:26000};
function prompt(session,history){return API.buildChat(char,session,history,settings,null)[0].content;}
var session={id:'a',summary:'The archive is locked.',facts:['The clock is broken.'],sceneNote:'Rain keeps tapping at the west window.',sceneNotePlacement:'character',sceneNoteFrequency:2};
var first=prompt(session,[{role:'user',text:'I enter the room.'}]);
ok('frequency 2 includes scene note before any completed assistant replies',first.indexOf('Scene note: Rain keeps tapping at the west window.')>=0);
ok('character placement precedes triggered lore and memory',first.indexOf('Scene note:')<first.indexOf('Story so far:'));
var second=prompt(session,[{role:'user',text:'I enter the room.'},{role:'assistant',text:'The door shuts.'},{role:'user',text:'I look around.'}]);
ok('frequency 2 omits the note after one assistant reply',second.indexOf('Scene note:')<0);
var third=prompt(session,[{role:'user',text:'I enter the room.'},{role:'assistant',text:'The door shuts.'},{role:'user',text:'I look around.'},{role:'assistant',text:'The lamps flicker.'},{role:'user',text:'I wait.'}]);
ok('frequency 2 inserts again after two assistant replies',third.indexOf('Scene note:')>=0);
var memorySession=Object.assign({},session,{sceneNotePlacement:'memory',sceneNoteFrequency:1});
var memoryPrompt=prompt(memorySession,[{role:'user',text:'The clock ticks.'}]);
ok('memory placement follows the chat memory block',memoryPrompt.indexOf('Story so far:')<memoryPrompt.indexOf('Scene note:'));
ok('memory placement stays before the character card post-history text',memoryPrompt.indexOf('Scene note:')<memoryPrompt.indexOf('Card-wide ending instruction.'));
var endSession=Object.assign({},session,{sceneNotePlacement:'end',sceneNoteFrequency:1});
var endPrompt=prompt(endSession,[{role:'user',text:'The clock ticks.'}]);
ok('end placement follows card post-history text',endPrompt.indexOf('Card-wide ending instruction.')<endPrompt.indexOf('Scene note:'));
var off=prompt(Object.assign({},session,{sceneNote:''}),[{role:'user',text:'I enter the room.'}]);
ok('blank scene notes have no effect',off.indexOf('Scene note:')<0);
var app=fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8');
var store=fs.readFileSync(path.join(root,'horde-studio-mobile/js/store.js'),'utf8');
ok('chat settings expose note, placement, and frequency controls',/id="cs-scene"/.test(app)&&/id="cs-scene-place"/.test(app)&&/id="cs-scene-frequency"/.test(app));
ok('scene-note settings save to and fork with the session',/s\.sceneNote = sceneNote/.test(app)&&/s2\.sceneNote = old\.sceneNote/.test(app)&&/sceneNoteFrequency:\s*1/.test(store));
console.log('\nscene-note-test: '+(fail?fail+' failed, ':'')+pass+' ok');
process.exit(fail?1:0);
