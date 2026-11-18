var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var char={name:'Narrator',persona:'x',scenario:'',examples:'',lorebook:[]};
var s={systemPrompt:'You are {{char}}. Write naturally.',userName:'Blu',temperature:.8,maxTokens:400,contextMessages:40};
function sysOf(hist){
  var out=API.buildChat(char,{},hist,s,null,null);
  return out[out.length-1].content;
}
var clean=[{role:'user',text:'I look around.'},{role:'assistant',text:'The hall is quiet. "Stay close," she says.'}];
var starred=chat.messages.slice(-12).map(function(m){return {role:m.role,text:m.text};});
console.log('=== clean chat: does it get the lock? ===');
console.log(JSON.stringify(sysOf(clean).slice(0,90)));
console.log('lock present:',/FORMAT FOR THIS REPLY/.test(sysOf(clean)));
console.log();
console.log('=== starred history: does it? ===');
var sys=sysOf(starred);
console.log('lock present:',/FORMAT FOR THIS REPLY/.test(sys));
console.log('it is the LAST message:',sys.slice(0,60));
console.log();
console.log('=== does it survive alongside a finalNote (the reroll/continuity path)? ===');
var out=API.buildChat(char,{},starred,s,null,'Where things stand right now: act two.');
var last=out[out.length-1].content;
console.log('lock present:',/FORMAT FOR THIS REPLY/.test(last));
console.log('finalNote present:',/Where things stand/.test(last));
console.log('order: lock then note ->', last.indexOf('FORMAT FOR THIS REPLY') < last.indexOf('Where things stand'));
