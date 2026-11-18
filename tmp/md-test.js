var fs=require('fs'),vm=require('vm');
var Store={settings:{plainEmphasis:true}};
var sb={console:console,document:{getElementById:function(){return {classList:{add(){},remove(){},contains(){return false}},style:{},innerHTML:'',textContent:'',hidden:false};}},Store:Store,String:String,RegExp:RegExp};
sb.window=sb;
var src=fs.readFileSync('/home/user/horde-studio-mobile/js/ui.js','utf8');
// expose md via the module's global attach
src=src.replace('})(window);','})(window);');
vm.runInNewContext(src,sb,{filename:'ui.js'});
var md=sb.UI && sb.UI.md;
if(!md){ console.log('UI keys:',Object.keys(sb.UI||{}).slice(0,10)); process.exit(1); }
var sample='*Her *head *tilts. *Bird-like. *Predatory. *Scholarly.*';
console.log('INPUT:  '+sample);
var out=md(sample);
console.log('OUTPUT: '+out);
console.log();
var sample2='*I *want *to *know *what *else *you *can *do.*';
console.log('INPUT:  '+sample2);
console.log('OUTPUT: '+md(sample2));
