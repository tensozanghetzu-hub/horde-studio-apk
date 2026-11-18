var fs=require('fs'),vm=require('vm');
var src=fs.readFileSync('/home/user/horde-studio-mobile/js/store.js','utf8');
// pull the three constants out and compare them as the migration would
function grab(name){
  var i=src.indexOf('var '+name+' = ');
  var j=src.indexOf(';\n',i);
  var chunk=src.slice(i,j+1);
  var sb={};vm.runInNewContext(chunk+'\nthis.out='+name+';',sb,{});
  return sb.out;
}
var D=grab('DEFAULT_SYSTEM'), OLD=grab('LEGACY_SYSTEM'), STAR=grab('LEGACY_SYSTEM_STARRED'), PRE=grab('LEGACY_SYSTEM');
console.log('new default asks for asterisks:',/asterisk italics/.test(D));
console.log('new default forbids asterisks:',/no asterisks/.test(D));
console.log('legacy(pre-v1.16) differs from new default:',OLD!==D);
console.log('legacy(starred) differs from new default:',STAR!==D);
console.log('legacy(starred) contains the bad line:',/asterisk italics/.test(STAR));
console.log();
function migrates(saved){ return saved===OLD||saved===STAR; }
console.log('=== who gets upgraded ===');
[['never touched (pre-1.16 default)',OLD],
 ['never touched (starred default)',STAR],
 ['edited by one character',STAR.replace('immersive','emersive')],
 ['user wrote their own', 'You are {{char}}. Be brief.'],
 ['already the new default', D]].forEach(function(t){
  console.log('  '+(migrates(t[1])?'UPGRADED ':'left alone')+' — '+t[0]);
});
