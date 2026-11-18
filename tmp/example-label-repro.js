var fs=require('fs'),vm=require('vm');
var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,isNaN:isNaN,parseFloat:parseFloat,parseInt:parseInt,TextEncoder:TextEncoder,TextDecoder:TextDecoder};
sb.window=sb;sb.global=sb;sb.fetch=function(){return Promise.resolve({ok:false,text:function(){return Promise.resolve('');}})};
vm.runInNewContext(fs.readFileSync('/home/user/horde-studio-mobile/js/api.js','utf8'),sb,{filename:'api.js'});
var API=sb.API;

// a generic narrator card: three speakers, all written with inline labels
var card={ name:'The Keeper',
  description:'A dungeon narrator.',
  examples:'{{user}}: *I put the lantern down.*\n{{char}}: Brannoc: "You made good time."\n{{user}}: "The tunnel was shorter than the map said."\n{{char}}: Mera: "The map is old. The tunnel is not."\n{{char}}: *Neither of them looks at the door at the end of the hall.*'
};
var settings={userName:'You', persona:'', systemPrompt:''};

[0, 2].forEach(function(castSize){
  var session={ sceneCast: castSize===2?['Brannoc','Mera']:[], continuity:{} };
  var sys=API.buildChat(card,session,[{role:'assistant',text:'*The hall is quiet.*'}],settings)[0].content;
  var block=sys.split('Example dialogue')[1]||'';
  block=block.split('\n\n')[0].replace(/^[^\n]*\n/,'');
  console.log('=== sceneCast length '+castSize+' ===');
  console.log(block.trim());
  console.log();
});
