var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var msgs=chat.messages.map(function(m){return {role:m.role,text:m.text};});
var sample=API.loreSample(msgs);

// what lore sees
console.log('lore window     :', sample.parts.length,'messages,',sample.text.length,'chars');

// what trimHistory would return at the default budget
function trim(history,n,maxChars){var m=history.slice(-n);var t=m.reduce(function(a,x){return a+((x.text||'').length);},0);while(t>maxChars&&m.length>4){t-=(m.shift().text||'').length;}return m;}
var hist=trim(msgs,40,24000);
console.log('history window  :', hist.length,'messages,',hist.reduce(function(a,x){return a+x.text.length;},0),'chars');

// do they describe the same "now"?
var newestIdx=msgs.length-1;
var loreOldest=msgs.length-sample.parts.length;
var histOldest=msgs.length-hist.length;
console.log('\nlore reaches back to message',loreOldest,'| history reaches back to',histOldest);
console.log('lore sees',(loreOldest-histOldest),'messages the model never gets');
var userTurns=function(arr){var u=0;arr.forEach(function(m){if(m.role==='user')u++;});return u;};
console.log('lore window covers',userTurns(msgs.slice(loreOldest)),'player turns; history covers',userTurns(hist));

// does the recency RANKING change shape with the window?
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var entries=card.data.character_book.entries.map(function(e){return {keys:e.keys||[],content:e.content||'',enabled:e.enabled!==false,stage:e.stage||'',constant:e.constant===true};});
[4,10,20,40].forEach(function(n){
  var s2=API.loreSample(msgs.slice(0==0?msgs.length-n:0));
  var r=API.loreRanks(entries,s2,'');
  var admitted=API._loreHits ? null : null;
  var d=API.loreDiagnostics(entries,s2,API.LORE_LIMIT,API.LORE_BUDGET,'');
  console.log('  window '+String(n).padStart(2)+' msgs -> admitted '+d.admitted+' | Draconica '+(d.rows[20].matched?'IN':'out')+' ('+d.rows[20].reason+')');
});
