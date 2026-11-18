var fs=require('fs'),vm=require('vm'),cp=require('child_process');
function loadTag(tag){
  var src=cp.execSync('git show '+tag+':horde-studio-mobile/js/api.js',{maxBuffer:1e8}).toString();
  src=src.replace('summarize: summarize,','summarize: summarize, parseMemory: parseMemory,');
  var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
  sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
  vm.runInNewContext(src,sb,{filename:'api.js'});return sb.API;
}
var a=loadTag('v1.39.105'), b=loadTag('v1.39.106');
var probes=[
 ['valid JSON, complete','{"summary":"They crossed the yard before dawn.","facts":["a debt is owed","the mill is shut"]}'],
 ['valid JSON + changed','{"summary":"The mill reopened.","facts":["the mill runs"],"changed":["the mill is shut"]}'],
 ['JSON, summary first, cut','{"summary":"They crossed the yard before dawn and kept walking until'],
 ['prefixed JSON, cut','Here is the summary:\n{"summary":"They crossed the yard and kept walking until'],
 ['prefixed JSON, complete','Here is the summary:\n{"summary":"They crossed the yard before dawn."}'],
 ['fenced JSON, cut','```json\n{"summary":"They crossed the yard before dawn and kept walking until'],
 ['plain prose','They crossed the yard before dawn and nobody spoke.'],
 ['prose over 800','They crossed the yard before dawn and nobody spoke. '.repeat(30)],
 ['refusal','I cannot summarize this because no transcript was provided.'],
 ['stub','Okay.'],
 ['empty',''],
 ['prose mentioning summary','In summary, they crossed the yard and nobody spoke.'],
 ['JSON stub','{"summary":"hi"}']
];
var diff=0;
console.log('probe'.padEnd(28)+'| same? | v1.39.105 -> v1.39.106');
console.log('-'.repeat(100));
probes.forEach(function(p){
  function r(API){var x=API.parseMemory(p[1]);return JSON.stringify([x.ok,!!x.salvaged,(x.summary||'').slice(0,50),x.reason||'',x.facts.length,x.changed.length]);}
  var A=r(a),B=r(b),same=A===B;
  if(!same)diff++;
  console.log(p[0].padEnd(28)+'| '+(same?' yes ':'CHANGED').padEnd(6)+'| '+(same?A:A+'\n'+' '.repeat(37)+B));
});
console.log('\nunchanged: '+(probes.length-diff)+'/'+probes.length);
