var fs=require('fs'),vm=require('vm'),cp=require('child_process');
function load(file){
  var src=fs.readFileSync(file,'utf8');
  var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
  sb.window=sb;sb.global=sb;
  sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}});};
  vm.runInNewContext(src,sb,{filename:'api.js'});
  return sb.API;
}
function loadTag(tag){
  var src=cp.execSync('git show '+tag+':horde-studio-mobile/js/api.js',{maxBuffer:1e8}).toString();
  src=src.replace('summarize: summarize,','summarize: summarize, parseMemory: parseMemory,');
  var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
  sb.window=sb;sb.global=sb;
  sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}});};
  vm.runInNewContext(src,sb,{filename:'api.js'});
  return sb.API;
}
var now=load('/home/user/horde-studio-mobile/js/api.js');
var before=loadTag('v1.39.105');

/* legitimate prose summaries that happen to contain the word "summary" */
var cases={
 'prose starting "Summary:"':     'Summary: they argued at the mill and she left before dawn.',
 'prose "Here is a summary:"':    'Here is a summary: the mill burned and the yard went quiet.',
 'prose, word summary no colon':  'The summary they gave the warden did not match the ledger at all.',
 'prose, "in summary,"':          'In summary, the two of them never spoke again after the ferry crossing.',
 'prose with quoted summary:':    'She read the line that began "summary:" and stopped reading.',
 'normal prose':                  'She arrives at the mill well after dark and finds the door standing open.'
};
function run(API,raw){
  var r=API.parseMemory(raw);
  return (r.ok?'STORED len='+(r.summary||'').length:'REJECTED ('+r.reason+')');
}
console.log('case'.padEnd(32)+'| v1.39.105'.padEnd(42)+'| v1.39.106 (mine)');
console.log('-'.repeat(112));
Object.keys(cases).forEach(function(k){
  console.log(k.padEnd(32)+'| '+run(before,cases[k]).padEnd(40)+'| '+run(now,cases[k]));
});
