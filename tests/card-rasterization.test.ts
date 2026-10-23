import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import{createHash}from'node:crypto';
import{BinaryBitmap,DecodeHintType,HybridBinarizer,RGBLuminanceSource,QRCodeReader}from'@zxing/library';
import{PassCardRenderer}from'../src/printing/PassCardRenderer.ts';import{NodeQrMatrixEncoder}from'../src/printing/NodeQrMatrixEncoder.ts';import{rasterizeCardPng}from'../src/printing/CardPngRasterizer.ts';
import type{PassCardData}from'../src/printing/PassCardRenderer.ts';
const sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??'../node_modules/sharp');
const[organisationLogoPng,applicationLogoPng,organisationIconPng]=await Promise.all(['sopra-steria-logo.png','gatepass-logo.png','sopra-steria-icon.png'].map(p=>readFile(new URL('../assets/brand/'+p,import.meta.url))));
const renderer=new PassCardRenderer(new NodeQrMatrixEncoder(),{organisationLogoPng,applicationLogoPng,organisationIconPng});
const data:PassCardData={personName:'Rohan Mehta · रोहन मेहता',requestType:'DIGITAL_ID',publicReference:'V-SAMPLE',publicPassNumber:'GP-SAMPLE',visitStatus:'APPROVED',locationName:'Noida',validFromUtc:'2026-10-23T00:00:00.000Z',validUntilUtc:'2026-10-24T00:00:00.000Z',employeeId:'EMP004',hostEmployeeId:null,hostName:null,purpose:'Forgot physical ID',assignedProjectCount:1,assignedProjects:[{code:'DEMO-PRJ-001',name:'Project 1'}]};
test('opaque card encoding preserves every decoded pixel with JPEG and transparent PNG photos',async()=>{
 for(const transparent of[false,true]){
  const photo=await sharp({create:{width:120,height:160,channels:4,background:{r:130,g:90,b:200,alpha:transparent?0.4:1}}})[transparent?'png':'jpeg']().toBuffer();
  const svg=await renderer.render(data,photo,transparent?'image/png':'image/jpeg',createHash('sha256').update('Opaque card regression '+transparent).digest('base64url'));
  const before=await sharp(svg,{density:300}).resize(1712,1080).png().toBuffer(),after=await rasterizeCardPng(sharp,svg);
  const meta=await sharp(after).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,1712);assert.equal(meta.height,1080);assert.equal(meta.channels,3);assert.equal(meta.hasAlpha,false);
  assert.deepEqual(await sharp(after).ensureAlpha().raw().toBuffer(),await sharp(before).ensureAlpha().raw().toBuffer());
 }
});
test('the exact optimized download pipeline retains readable branded QR credentials for each card type',async()=>{
 const photo=await sharp({create:{width:120,height:160,channels:3,background:'#a0c0e0'}}).png().toBuffer();
 for(const requestType of['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL']as const){
  const token=createHash('sha256').update('Optimized opaque '+requestType).digest('base64url');
  const details=requestType==='EXTERNAL'?{employeeId:null,hostEmployeeId:'EMP019',hostName:'Ananya Rao',assignedProjectCount:0,assignedProjects:[]}:{};
  const svg=await renderer.render({...data,...details,requestType,visitStatus:requestType==='EXTERNAL'?'PENDING':'APPROVED'},photo,'image/png',token),png=await rasterizeCardPng(sharp,svg);
  let decoded:string|undefined;
  for(const angle of[0,90,180,270]){
   const raw=await sharp(png).rotate(angle).greyscale().raw().toBuffer({resolveWithObject:true});
   const luminance=new RGBLuminanceSource(new Uint8ClampedArray(raw.data.buffer,raw.data.byteOffset,raw.data.byteLength),raw.info.width,raw.info.height);
   try{decoded=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(luminance)),new Map([[DecodeHintType.TRY_HARDER,true]])).getText();break;}catch{/* Independent detector can choose a false orientation candidate. */}
  }
  assert.equal(decoded,token,requestType+' PNG must decode to the exact credential');
 }
});
