import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';import{inflateRawSync,crc32}from'node:zlib';
test('export worker emits valid compressed UTF-8 ZIP entries and escaped worksheet cells',async()=>{
 let result:any;const self:any={postMessage(value:any){result=value;}},context=vm.createContext({self,TextEncoder,Uint8Array,Uint32Array,Blob,Response,CompressionStream});
 vm.runInContext(readFileSync(new URL('../src/app/register-export-worker.js',import.meta.url),'utf8'),context);
 const header=Array.from({length:26},(_,i)=>'Column '+i),row=header.map(()=>'<Tamil & हिन्दी "value">');await self.onmessage({data:{header,rows:[row]}});assert(result.blob instanceof Blob);
 const bytes=Buffer.from(await result.blob.arrayBuffer());let offset=0,count=0,sheet='';
 while(bytes.readUInt32LE(offset)===0x04034b50){
  const method=bytes.readUInt16LE(offset+8),compressed=bytes.readUInt32LE(offset+18),size=bytes.readUInt32LE(offset+22),nameBytes=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),name=bytes.toString('utf8',offset+30,offset+30+nameBytes),start=offset+30+nameBytes+extra;
  assert.equal(method,8);const data=inflateRawSync(bytes.subarray(start,start+compressed));assert.equal(data.length,size);assert.equal(crc32(data),bytes.readUInt32LE(offset+14));if(name==='xl/worksheets/sheet1.xml')sheet=data.toString('utf8');offset=start+compressed;count++;
 }
 assert.equal(count,6);assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal((sheet.match(/<row r=/gu)??[]).length,2);assert.equal((sheet.match(/<c r=/gu)??[]).length,52);assert(sheet.includes('&lt;Tamil &amp; हिन्दी &quot;value&quot;&gt;'));
});
test('worker rejects rows beyond the export limit or inconsistent column counts',async()=>{
 let result:any;const self:any={postMessage(value:any){result=value;}},context=vm.createContext({self,TextEncoder,Uint8Array,Uint32Array,Blob,Response,CompressionStream});vm.runInContext(readFileSync(new URL('../src/app/register-export-worker.js',import.meta.url),'utf8'),context);
 await self.onmessage({data:{header:Array(26).fill('h'),rows:[['wrong']]}});assert.equal(typeof result.error,'string');assert.equal(result.blob,undefined);
 await self.onmessage({data:{header:Array(26).fill('h'),rows:Array(10001).fill(Array(26).fill('x'))}});assert.equal(typeof result.error,'string');
});
