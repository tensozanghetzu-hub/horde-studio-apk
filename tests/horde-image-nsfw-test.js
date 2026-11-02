/* Horde image NSFW routing: model-reference tags plus the job-level NSFW flag. */
'use strict';
var fs=require('fs'), vm=require('vm'), path=require('path');
var SRC=path.join(__dirname,'..','horde-studio-mobile','js','horde.js');
var pass=0,fail=0;
function ok(label,cond,extra){if(cond){pass++;console.log('  ok   '+label);}else{fail++;console.log('  FAIL '+label+(extra?' -> '+extra:''));}}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
var STATUS=[
 {type:'image',name:'Aster NSFW Mix',count:3,eta:4,jobs:0,performance:10},
 {type:'image',name:'Clean Base',count:5,eta:2,jobs:0,performance:12},
 {type:'image',name:'Offline Adult Checkpoint',count:0,eta:0,jobs:0,performance:0},
 {type:'image',name:'Unlisted in reference',count:2,eta:3,jobs:0,performance:5}
];
var REFERENCE={
 'Aster NSFW Mix':{name:'Aster NSFW Mix',nsfw:true},
 'Clean Base':{name:'Clean Base',nsfw:false},
 'Offline Adult Checkpoint':{name:'Offline Adult Checkpoint',nsfw:true},
 'Ref-only Adult Model':{name:'Ref-only Adult Model',nsfw:true}
};
function makeHorde(status,reference){
 var sb={console:console,JSON:JSON,Math:Math,Date:Date,Promise:Promise,Object:Object,Array:Array,String:String,Number:Number,RegExp:RegExp,Error:Error,setTimeout:setTimeout,clearTimeout:clearTimeout,AbortController:AbortController,DOMException:DOMException};
 sb.window=sb; var h={payloads:[]};
 function response(data){return Promise.resolve({ok:true,status:200,headers:{get:function(){return null;}},text:function(){return Promise.resolve(JSON.stringify(data));},json:function(){return Promise.resolve(data);}});}
 sb.fetch=function(url,opts){
  url=String(url);
  if(url.indexOf('models.aihorde.net/model_references/v2/image_generation')>=0) return response(reference);
  if(url.indexOf('/status/models?type=image')>=0) return response(status);
  if(url.indexOf('/generate/async')>=0){h.payloads.push(JSON.parse(opts.body));return response({id:'img-job'});}
  if(url.indexOf('/generate/check/img-job')>=0) return response({done:true});
  if(url.indexOf('/generate/status/img-job')>=0) return response({generations:[{img:'https://example.test/image.png',model:'Aster NSFW Mix',seed:7}]});
  return response({});
 };
 vm.runInNewContext(fs.readFileSync(SRC,'utf8'),sb,{filename:'horde.js'}); h.Horde=sb.Horde; return h;
}
var H=makeHorde(STATUS,REFERENCE), api=H.Horde;
ok('image NSFW sentinel is exposed',typeof api.ANY_NSFW_IMAGE==='string'&&api.ANY_NSFW_IMAGE.length>0);
ok('image sentinel has a readable label',api.imageModelLabel(api.ANY_NSFW_IMAGE)==='Any available (NSFW-tagged)');
ok('ordinary image model labels remain unchanged',api.imageModelLabel('Clean Base')==='Clean Base');
var run=api.anyNsfwImageModels().then(function(names){
 ok('filter intersects official NSFW tags with models that have workers',same(names,['Aster NSFW Mix']),JSON.stringify(names));
 return api.generateImage({model:api.ANY_NSFW_IMAGE,prompt:'adult fantasy portrait',nsfw:true,width:512,height:512,maxWait:2});
}).then(function(result){
 var p=H.payloads[0];
 ok('filtered request reaches Horde with only the online NSFW-tagged model',same(p.models,['Aster NSFW Mix']),JSON.stringify(p.models));
 ok('Allow NSFW is sent on the request',p.nsfw===true);
 ok('censoring is off only for an explicitly NSFW request',p.censor_nsfw===false);
 ok('image job still resolves normally',result.url==='https://example.test/image.png');
 return api.generateImage({model:'Clean Base',prompt:'safe landscape',nsfw:false,width:512,height:512,maxWait:2});
}).then(function(){
 var p=H.payloads[1];
 ok('normal model selection remains pinned',same(p.models,['Clean Base']));
 ok('normal images remain non-NSFW and censored by default',p.nsfw===false&&p.censor_nsfw===true);
 var none=makeHorde(STATUS.map(function(x){return Object.assign({},x,{count:0});}),REFERENCE).Horde;
 return none.anyNsfwImageModels().then(function(models){
   ok('no eligible workers gives an empty candidate list',models.length===0);
   return none.generateImage({model:none.ANY_NSFW_IMAGE,prompt:'x',nsfw:true,maxWait:2}).then(function(){
     ok('sentinel fails clearly when none are available',false,'resolved unexpectedly');
   },function(e){ok('sentinel fails clearly when none are available',/no online NSFW-tagged image models/i.test(e.message),e.message);});
 });
});
run.then(function(){console.log('\nhorde-image-nsfw-test: '+(fail?fail+' failed, ':'')+pass+' ok');process.exit(fail?1:0);})
.catch(function(e){console.error(e&&e.stack||e);process.exit(1);});
