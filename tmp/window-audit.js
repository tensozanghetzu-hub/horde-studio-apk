var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API||sb.window.API;
var chat=JSON.parse(fs.readFileSync('/home/user/uploads/The Narrator — Hogwarts_ Book One-Meeting Neville on the Hogwarts Express.hordechat.json','utf8'));
var msgs=chat.messages.map(function(m){return {role:m.role,text:m.text};});
console.log('total messages:',msgs.length);

var sample=API.loreSample(msgs);
console.log('lore window:      ', API.LORE_SCAN_MESSAGES,'messages,', sample.text.length,'chars');
console.log('  ...and in that window:', sample.parts.length, 'parts');

// how many turns does each window cover?
function turnsInWindow(n){var w=msgs.slice(-n);var u=0;w.forEach(function(m){if(m.role==='user')u++;});return u;}
console.log('  ...covering', turnsInWindow(20),'player turns');
console.log('  first 40 messages cover', (function(){var u=0;msgs.slice(0,40).forEach(function(m){if(m.role==='user')u++;});return u;})(),'player turns');

// the style lock: does a LOCKED chat change verdict with window size?
var stars=msgs.filter(function(m){return m.role!=='user';}).map(function(m){return (m.text.match(/\*/g)||[]).length;});
console.log('\nasterisks per assistant message, last 12:', stars.slice(-12).join(' '));
[8,12,20,40].forEach(function(n){
  var v=API.styleLock(msgs.slice(-n));
  console.log('  styleLock on last '+String(n).padStart(2)+' messages ->', v?('FIRES: '+v.slice(0,58).replace(/\n/g,' ')):'quiet');
});

console.log('\n=== what the lore window costs against the history budget ===');
var card=JSON.parse(fs.readFileSync('/home/user/uploads/The_Narrator_Hogwarts_Book_One.json','utf8'));
var settings={model:'x',historyTokens:0};
var def=API.historyBudgetTokens?API.historyBudgetTokens(settings,4000,900):null;
console.log('  historyBudgetTokens(default) =', def, 'tokens');
console.log('  lore window chars =', sample.text.length, '->', Math.round(sample.text.length/4), 'tokens');
