var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});
var msgs=chat.messages.map(function(m){return {role:m.role,text:m.text};});

var win=API.requestWindow(msgs,{});
var sample=win.sample;
console.log('window: '+win.messages.length+' messages ('+win.turns+' turns), '+sample.text.length+' chars');
var d=API.loreDiagnostics(entries,sample,API.LORE_LIMIT,API.LORE_BUDGET,'');
console.log('lore: '+d.admitted+' of '+d.rows.length+' admitted, '+d.used+'/'+d.cap);
console.log('Draconica (#20): '+d.rows[20].reason);
console.log('styleLock fires on the window:', /FORMAT/.test(API.styleLock(win.messages)));

// the real card's examples, end to end
var ch={name:card.name,description:card.data.description||card.description,persona:card.data.description||'',scenario:card.data.scenario||'',examples:card.data.mes_example||card.data.example_dialogue||'',systemPrompt:''};
if(!ch.examples){ch.examples=(card.data.character_book?null:null)||'';}
var sys=API.buildChat(ch,{},msgs.slice(-20),{userName:'You',persona:'',systemPrompt:''})[0].content;
var ex=(sys.split('Example dialogue')[1]||'').split('\n\n')[0];
var stacked=ex.split('\n').filter(function(l){return /^[A-Z][\w ]*: [A-Z][\w ]*:/.test(l);});
console.log('stacked labels in the example block:', stacked.length);
if(ex) console.log(ex.trim().split('\n').slice(0,4).join('\n'));
