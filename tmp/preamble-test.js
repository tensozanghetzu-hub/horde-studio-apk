var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;
sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}});};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

var story = 'Blu completes his second day at Hogwarts with extraordinary demonstrations across Charms and Herbology, ' +
  'revealing abilities beyond first-year level. He perceives the Trace as physical filaments. McGonagall warns him ' +
  'to camouflage his talent in Potions class for survival. She names five potential peers among the first years.';

// the model answers in JSON but says something first, and is cut off before the closing brace
var openJson = '{"summary":"' + story;
var cases = {
  'bare, truncated':                  openJson,
  'prefix + truncated':               'Here is the summary:\n' + openJson,
  'prefix + truncated (no newline)':  'Sure! ' + openJson,
  'fence + truncated':                '```json\n' + openJson,
  'prefix + complete':                'Here is the summary:\n{"summary":"' + story + '"}'
};
Object.keys(cases).forEach(function(k){
  var raw=cases[k];
  var r=API.parseMemory(raw);
  var sum=r.summary||'';
  console.log('--- '+k);
  console.log('    ok='+r.ok+' len='+sum.length+' reason='+(r.reason||'-'));
  if(sum) console.log('    starts: '+JSON.stringify(sum.slice(0,60)));
});
