var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});
var recent=chat.messages.slice(-14).map(function(m){return (m.role==='user'?'You: ':'')+m.text;}).join('\n');
var d=API.loreDiagnostics(entries,recent,6,1536,'');
console.log('admitted:',d.admitted,'| bytes used:',d.used+'/'+d.cap,'| total entries:',entries.length);
console.log();
var byReason={};
d.rows.forEach(function(r,i){ (byReason[r.reason]=byReason[r.reason]||[]).push(i); });
Object.keys(byReason).forEach(function(k){
  console.log('● '+k+'  ('+byReason[k].length+')');
  byReason[k].forEach(function(i){
    var e=entries[i];
    console.log('    #'+i+' ['+(e.keys.slice(0,4).join(', ')||'(no keys)')+'] '+e.content.slice(0,60).replace(/\n/g,' '));
  });
});
