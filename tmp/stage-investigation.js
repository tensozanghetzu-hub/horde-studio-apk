var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

function E(keys,content,stage){return {keys:keys,content:content,enabled:true,stage:stage||'',constant:false};}
var book=[
  E(['gate'],'ACT ONE: the gate is sealed.','act one'),
  E(['gate'],'ACT TWO: the gate stands open.','act two'),
  E(['gate'],'ACT THREE: the gate is gone.','act three'),
  E(['gate'],'UNSTAGED: a gate exists somewhere.')
];
var sample=API.loreSample([{role:'user',text:'a'},{role:'assistant',text:'b'},{role:'user',text:'c'},{role:'assistant',text:'the gate'}]);
console.log('=== the reported problem: a staged book with a blank stage ===');
var d=API.loreDiagnostics(book,sample,10,5000,'');
console.log('admitted:',d.admitted,'of',d.rows.length);
d.rows.forEach(function(r,i){console.log('  #'+i+' stage="'+book[i].stage+'" -> '+r.reason);});
console.log();
console.log('the summary line the Lore screen would print:');
console.log('  "'+d.admitted+' of '+d.rows.length+' entries are in the prompt now"');
console.log('  ...which does not say that three of them are dark because no stage is set.');
console.log();
var dark=d.rows.filter(function(r){return /wrong stage/.test(r.reason);}).length;
console.log('entries dark for stage reasons:',dark,'| visible only per-row as "wrong stage (act one)"');
