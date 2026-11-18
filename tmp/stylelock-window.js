var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

// THE SAME HABIT at the same rate: 2 asterisks per reply, every reply.
// The only difference is how long the replies are.
function run(pad){
  var card={name:'C',description:'d',examples:''};
  var hist=[];
  for(var i=0;i<30;i++){
    hist.push({role:'user',text:'short question '+i});
    hist.push({role:'assistant',text:'*a* the answer, and then some more prose here ' + 'filler '.repeat(pad)});
  }
  var sys=API.buildChat(card,{},hist,{userName:'You',persona:'',systemPrompt:''});
  var tail=sys[sys.length-1].content;
  var histMsgs=sys.filter(function(m){return m.role!=='system';}).length;
  return {lock:/FORMAT FOR THIS REPLY/.test(tail), msgs:histMsgs, stars:hist.filter(function(m){return m.role==='assistant';}).slice(-12).reduce(function(a,m){return a+(m.text.match(/\*/g)||[]).length;},0)};
}
[1, 300].forEach(function(pad){
  var r=run(pad);
  console.log('replies '+(pad===1?'~40 chars':'~1,800 chars')+' -> history shown to model: '+r.msgs+' messages | asterisks in last 12 replies: '+r.stars+' | styleLock '+(r.lock?'FIRES':'QUIET'));
});
