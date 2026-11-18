var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});
var full=chat.messages.map(function(m){return {role:m.role,text:m.text};});
[4,10,20,40].forEach(function(win){
  // temporarily simulate by slicing
  var sample=API.loreSample(full.slice(0, win===40?full.length:full.length));
  var s2={text:full.slice(-win).map(function(m){return m.text;}).join('\n'),
          newest:full[full.length-1].text,
          parts:full.slice(-win).map(function(m){return m.text;})};
  var d=API.loreDiagnostics(entries,s2,API.LORE_LIMIT,API.LORE_BUDGET,'');
  var got=d.rows.map(function(r,i){return r.reason==='matched'?i:-1;}).filter(function(i){return i>=0;});
  console.log('window '+String(win).padStart(2)+': '+got.length+' entries, Draconica '+(got.indexOf(20)>=0?'IN ':'OUT'));
  console.log('        '+got.map(function(i){return '#'+i;}).join(' '));
});
