var fs=require('fs'),vm=require('vm'),cp=require('child_process');
function loadAt(tag){
  var src=cp.execSync('git show '+tag+':horde-studio-mobile/js/api.js',{maxBuffer:1e8}).toString();
  // expose parseMemory if this vintage doesn't export it
  src=src.replace('summarize: summarize,', 'summarize: summarize, parseMemory: parseMemory,');
  var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
  sb.window=sb;sb.global=sb;
  sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}});};
  try{ vm.runInNewContext(src,sb,{filename:'api-'+tag+'.js'}); }catch(e){ return {err:e.message}; }
  return sb.API||{err:'no API'};
}
var story='Blu completes his second day at Hogwarts with extraordinary demonstrations across Charms and Herbology, '+
 'revealing abilities far beyond first-year level. McGonagall warns him to camouflage his talent for survival. '+
 'She names five potential peers among the first years, and asks about the shadows he keeps';
var BARE='{"summary":"'+story;
var PRE='Here is the summary:\n'+BARE;
['v1.39.66','v1.39.80','v1.39.89','v1.39.100','v1.39.104','v1.39.106'].forEach(function(tag){
  var API=loadAt(tag);
  if(API.err){ console.log(tag.padEnd(10)+' load failed: '+API.err); return; }
  function probe(raw){
    var r=API.parseMemory(raw), s=r.summary||'';
    var wrapper=/\{"summary"/.test(s)||/^Here is/.test(s);
    return (r.ok?'ok':'REJECT')+(wrapper?' [WRAPPER STORED]':' [clean]');
  }
  console.log(tag.padEnd(10)+'| bare: '+probe(BARE).padEnd(28)+'| preamble: '+probe(PRE));
});
