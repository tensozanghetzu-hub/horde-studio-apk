var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});

// what the app sends as "recent" - the last N messages, as the prompt does
function recentOf(n){
  return chat.messages.slice(-n).map(function(m){return (m.role==='user'?'You: ':'')+m.text;}).join('\n');
}
[6,14,40].forEach(function(n){
  var hits=API._loreHits(entries,recentOf(n),6,1536,'');
  var bytes=hits.reduce(function(a,e){return a+e.content.length;},0);
  console.log('recent='+String(n).padStart(2)+' messages | hits: '+hits.length+' | bytes: '+bytes+'/1536');
  hits.forEach(function(e){ console.log('    ['+e.keys.slice(0,3).join(', ')+'] '+e.content.slice(0,70).replace(/\n/g,' ')); });
  console.log();
});
