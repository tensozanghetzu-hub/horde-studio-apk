/* Group chat keeps manual speaker selection as the default and only auto-picks on request. */
'use strict';
var fs=require('fs'),vm=require('vm'),path=require('path');
var root=path.join(__dirname,'..');
var doc={addEventListener:function(){}};
var sb={console:console,document:doc,UI:{esc:function(x){return String(x||'');},icon:function(){return '';},toast:function(){}},Store:{},Promise:Promise,Array:Array,Object:Object,String:String,Math:Math,Date:Date,setTimeout:setTimeout,setInterval:function(){},clearInterval:function(){}};
sb.window=sb; sb.global=sb;
vm.runInNewContext(fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8'),sb,{filename:'app.js'});
var App=sb.App,pass=0,fail=0;
function ok(label,cond){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label);}}
var cast=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
ok('auto mode starts with the first group member',App.nextGroupSpeaker(cast,[]).id==='a');
ok('auto mode advances round-robin after the last speaker',App.nextGroupSpeaker(cast,[{role:'assistant',speakerId:'a'}]).id==='b');
ok('auto mode wraps to the first member',App.nextGroupSpeaker(cast,[{role:'assistant',speakerId:'c'}]).id==='a');
ok('manual selection is the new-session default',/groupCharIds:\s*\[\], speakerMode:\s*'manual', nextSpeakerId:\s*''/.test(fs.readFileSync(path.join(root,'horde-studio-mobile/js/store.js'),'utf8')));
var app=fs.readFileSync(path.join(root,'horde-studio-mobile/js/app.js'),'utf8');
var views=fs.readFileSync(path.join(root,'horde-studio-mobile/js/views.js'),'utf8');
var html=fs.readFileSync(path.join(root,'horde-studio-mobile/index.html'),'utf8');
ok('chat list has a group-creation action',/id="chats-group"/.test(html)&&/App\.createGroupChat\(\)/.test(app));
ok('group creation requires at least two selected members',/ids\.length < 2/.test(app)&&/s\.groupCharIds = selected\.map/.test(app));
ok('the chat composer exposes the next-speaker picker',/id="group-speaker"/.test(html)&&/App\.pickGroupSpeaker\(\)/.test(app));
ok('manual mode blocks sending until a speaker is chosen',/Choose the next speaker before sending/.test(app));
ok('automatic mode is explicit and uses round-robin',/Auto · round-robin/.test(app)&&/App\.nextGroupSpeaker\(groupMembers, st\.messages\)/.test(app));
ok('assistant messages retain each speaker name and avatar',/msg\.speakerName = char\.name/.test(app)&&/m\.speakerName \|\| char\.name/.test(views)&&/m\.speakerAvatar/.test(views));
ok('split assistant bursts keep the selected speaker on every bubble',/speakerId: first\.speakerId/.test(app)&&/speakerPortrait: first\.speakerPortrait/.test(app));
ok('group sessions keep participant identity when reopened and forked',/Array\.isArray\(s\.groupCharIds\)/.test(app)&&/s2\.groupCharIds = \(old\.groupCharIds/.test(app));
console.log('\ngroupchat-test: '+(fail?fail+' failed, ':'')+pass+' ok');
process.exit(fail?1:0);
