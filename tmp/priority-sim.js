var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});

var window4=chat.messages.slice(-4);
var newest=(window4[window4.length-1].text||'').toLowerCase();
var all=window4.map(function(m){return m.text;}).join('\n').toLowerCase();

// score: matched in the NEWEST message first, then constant, then number of keys matched
function score(e){
  var inNewest=(e.keys||[]).some(function(k){return k && newest.indexOf(String(k).toLowerCase())!==-1;});
  var matchedKeys=(e.keys||[]).filter(function(k){return k && all.indexOf(String(k).toLowerCase())!==-1;}).length;
  return {inNewest:inNewest,matchedKeys:matchedKeys};
}
var cands=entries.map(function(e,i){
  var s=score(e);
  var hit=(e.keys||[]).some(function(k){return k && all.indexOf(String(k).toLowerCase())!==-1;});
  return hit?{i:i,e:e,s:s}:null;
}).filter(Boolean);

console.log('=== matches in the NEWEST message (what the reply is about) ===');
cands.filter(function(c){return c.s.inNewest;}).forEach(function(c){
  console.log('  #'+c.i+' ('+c.e.content.length+' chars) '+c.e.content.slice(0,58).replace(/\n/g,' '));
});
console.log();
console.log('=== matches only earlier in the window ===');
cands.filter(function(c){return !c.s.inNewest;}).forEach(function(c){
  console.log('  #'+c.i+' ('+c.e.content.length+' chars) '+c.e.content.slice(0,58).replace(/\n/g,' '));
});
console.log();
console.log('=== newest-first, then budget, cap 6 ===');
var ordered=cands.slice().sort(function(a,b){
  if(a.s.inNewest!==b.s.inNewest) return a.s.inNewest?-1:1;
  if((b.s.matchedKeys)!==(a.s.matchedKeys)) return b.s.matchedKeys-a.s.matchedKeys;
  return 3-a.e.keys.length; // more specific key sets first
});
var used=0,picked=[];
ordered.forEach(function(c){
  if(picked.length>=6) return;
  var cost=c.e.content.length;
  if(picked.length && used+cost>1536) return;
  picked.push(c); used+=cost;
});
picked.forEach(function(c){console.log('  #'+c.i+' '+c.e.content.slice(0,58).replace(/\n/g,' '));});
console.log('  bytes:',used+'/1536');
console.log('  Draconica included:', picked.some(function(c){return c.i===20;}));
