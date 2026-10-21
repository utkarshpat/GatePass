import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context:any={};vm.createContext(context);vm.runInContext(readFileSync(new URL('../src/app/photo-crop.js',import.meta.url),'utf8')+';globalThis.crop=photoCropSource;',context);
test('cover crop selects original source pixels instead of stretching a wide image into its preview box',()=>{
 const r=context.crop(400,200,{left:0,top:0,width:200,height:200},{left:25,top:50,width:75,height:100});
 assert.deepEqual({...r},{sx:125,sy:50,sw:75,sh:100});assert.equal(r.sw/r.sh,600/800);
 const mirrored=context.crop(400,200,{left:0,top:0,width:200,height:200},{left:25,top:50,width:75,height:100},true);assert.equal(mirrored.sx,200);
});
test('zoom and pan map to the visible source region without changing source aspect ratio',()=>{
 const r=context.crop(400,200,{left:-100,top:-100,width:400,height:400},{left:25,top:50,width:75,height:100});
 assert.deepEqual({...r},{sx:162.5,sy:75,sw:37.5,sh:50});
});
test('uncovered frames and invalid image sizes cannot silently save blank or malformed crops',()=>{
 assert.throws(()=>context.crop(0,200,{left:0,top:0,width:200,height:200},{left:0,top:0,width:75,height:100}));
 assert.throws(()=>context.crop(200,200,{left:0,top:0,width:200,height:200},{left:190,top:0,width:75,height:100}));
});
