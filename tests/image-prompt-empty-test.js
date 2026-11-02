/* The AI Horde image dialog must start with a blank prompt on every open. */
'use strict';
var fs=require('fs'), path=require('path');
var src=fs.readFileSync(path.join(__dirname,'..','horde-studio-mobile','js','app.js'),'utf8');
var start=src.indexOf('  App.imageSheet = function () {');
var end=src.indexOf('  App.runImage = function (prompt, size, nsfw) {',start);
if(start<0||end<0) throw new Error('Could not find imageSheet source block');
var block=src.slice(start,end);
var match=block.match(/<textarea\s+id="img-prompt"[^>]*>([\s\S]*?)<\/textarea>/);
if(!match) throw new Error('Could not find the image prompt textarea');
if(match[1].trim()!=='') throw new Error('Image prompt textarea is prefilled: '+match[1]);
if(/var\s+(?:last|subject|suggested)\s*=/.test(block)) throw new Error('Image prompt is still derived from chat/character state');
if(!/placeholder="Describe the image you want to create/.test(block)) throw new Error('Empty prompt has no helpful placeholder');
console.log('image-prompt-empty-test: prompt opens empty and is not inferred from chat or character state');
