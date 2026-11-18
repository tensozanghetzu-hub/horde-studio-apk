var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;
sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}});};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));

var char={id:'c1',name:card.name,persona:card.description,scenario:card.scenario,
  examples:card.mes_example,postHistory:(card.data&&card.data.post_history_instructions)||'',lorebook:[]};
var session={id:'s1',title:chat.title,summary:chat.summary,facts:chat.facts,continuity:chat.continuity,
  memAt:chat.memAt||0,messageCount:chat.messages.length};
var settings={systemPrompt:'',userName:'Blu',userPersona:'',temperature:.85,maxTokens:400,contextMessages:40,maxContextChars:26000};

var msgs=chat.messages.slice(-40).map(function(m){return {role:m.role,text:m.text};});
var out=API.buildChat(char,session,msgs,settings,null);
var all=out.map(function(m){return '['+m.role.toUpperCase()+']\n'+m.content;}).join('\n\n');
fs.writeFileSync('/home/user/tmp/prompt.txt',all);

var i=all.indexOf('Story so far');
console.log('=== the MEMORY the model reads (verbatim) ===');
console.log(all.slice(i,i+1100));
console.log();
console.log('=== prompt totals ===');
console.log('chars:',all.length,'| est tokens:',Math.round(all.length/4));
console.log('replies included:',msgs.filter(function(m){return m.role==='assistant';}).length);
