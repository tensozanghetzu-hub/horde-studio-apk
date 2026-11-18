var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;
function E(k,c,st){return {keys:k,content:c,enabled:true,stage:st||'',constant:false};}
var book=[E(['gate'],'ACT ONE version.','act one'),E(['gate'],'ACT TWO version.','act two'),E(['gate'],'UNSTAGED.')];
var sample=API.loreSample([{role:'user',text:'a'},{role:'assistant',text:'b'},{role:'user',text:'c'},{role:'assistant',text:'the gate'}]);

console.log('=== blank stage (the default) ===');
var d=API.loreDiagnostics(book,sample,API.LORE_LIMIT,API.LORE_BUDGET,'');
console.log('  admitted',d.admitted,'| stageSkipped',d.stageSkipped,'| stageBlank',d.stageBlank,'| darkWithoutStage',d.stageDarkWithoutStage);
d.rows.forEach(function(r,i){if(r.stageDark)console.log("  #"+i+" "+r.reason);});
console.log();
console.log('=== a matching stage ===');
var d2=API.loreDiagnostics(book,sample,API.LORE_LIMIT,API.LORE_BUDGET,'act two');
console.log('  admitted',d2.admitted,'| stageSkipped',d2.stageSkipped,'| stageBlank',d2.stageBlank);
d2.rows.forEach(function(r,i){if(r.stageDark)console.log('  #'+i+r.reason);});
console.log();
console.log('=== a different stage ===');
var d3=API.loreDiagnostics(book,sample,API.LORE_LIMIT,API.LORE_BUDGET,'act three');
console.log('  admitted',d3.admitted,'| stageSkipped',d3.stageSkipped,'| darkWithoutStage',d3.stageDarkWithoutStage);
d3.rows.forEach(function(r,i){if(r.stageDark)console.log('  #'+i+r.reason);});
