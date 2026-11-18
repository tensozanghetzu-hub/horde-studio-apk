var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

/* A modest, steady habit: 5 asterisks in every reply - under the 12-per-reply
   trigger, so only the window rule can catch it. Same habit, same rate.
   The only variable is how long the replies are. */
function run(pad){
  var card={name:'C',description:'d',examples:''};
  var hist=[];
  for(var i=0;i<30;i++){
    hist.push({role:'user',text:'a question'});
    hist.push({role:'assistant',text:'*one* *two* and *three* prose ' + 'filler '.repeat(pad)});
  }
  var sys=API.buildChat(card,{},hist,{userName:'You',persona:'',systemPrompt:''});
  var tail=sys[sys.length-1].content;
  var shown=sys.filter(function(m){return m.role!=='system';}).length;
  var stars=hist.filter(function(m){return m.role==='assistant';}).slice(-shown).reduce(function(a,m){return a+(m.text.match(/\*/g)||[]).length;},0);
  var perReply=hist[1].text.match(/\*/g).length;
  return {lock:/FORMAT FOR THIS REPLY/.test(tail),shown:shown,stars:stars,perReply:perReply};
}
[1,120,400,1500,3000].forEach(function(pad){
  var r=run(pad);
  console.log('replies '+String(r.perReply).padStart(2)+' asterisks each, ~'+String(400+pad*7).padStart(5)+' chars -> '+String(r.shown).padStart(2)+' messages kept, '+r.stars+' asterisks in window | styleLock '+(r.lock?'FIRES':'QUIET  <-- habit missed'));
});
