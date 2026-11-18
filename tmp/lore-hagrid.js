var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});
// a moment early in a chat: Hagrid is mentioned in passing
var recent='Hagrid waves from across the platform. Then the train leaves and the conversation moves on to the Sorting.';

console.log('=== "Hagrid" mentioned once, early in a chat ===');
var hits=API._loreHits(entries,recent,6,1536,'');
hits.forEach(function(e){console.log('   ['+e.keys.slice(0,3).join(', ')+'] '+e.content.slice(0,55).replace(/\n/g,' '));});
console.log();
var d=API.loreDiagnostics(entries,recent,6,1536,'');
['#2 chapter (Hagrid keys)', '#21 Hagrid character card'].forEach(function(lbl,i){
  var idx=i===0?2:21;
  var row=d.rows[idx];
  console.log(lbl+': '+row.reason);
});
console.log();
console.log('=== the ordering problem, stated plainly ===');
console.log('entry 2 content length:',entries[2].content.length,'chars');
console.log('entry 21 content length:',entries[21].content.length,'chars');
console.log('both share the keys: hagrid, keeper of the keys');
