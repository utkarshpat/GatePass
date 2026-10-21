import {readFile} from 'node:fs/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
/** Fixed public files only: never accepts an arbitrary disk path or an authenticated response. */
export async function loadPwaAssets(){
 const definitions=[
  ['/manifest.webmanifest','manifest.webmanifest','application/manifest+json; charset=utf-8'],
  ['/service-worker.js','service-worker.js','text/javascript; charset=utf-8'],
  ['/pwa/offline.html','offline.html','text/html; charset=utf-8'],
  ['/pwa/offline.css','offline.css','text/css; charset=utf-8'],
  ...['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png'].map(name=>['/pwa/'+name,'../../assets/pwa/'+name,'image/png']),
 ];
 const files=new Map(await Promise.all(definitions.map(async([path,file,type])=>[path,{type,body:await readFile(new URL(file,import.meta.url))}] as const)));
 return (req:IncomingMessage,res:ServerResponse)=>{
  if(req.method!=='GET'||!files.has(req.url??''))return false;
  const path=req.url!,file=files.get(path)!;
  res.setHeader('Content-Type',file.type);res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control',path==='/service-worker.js'||path==='/manifest.webmanifest'?'no-cache':'public, max-age=3600');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Referrer-Policy','no-referrer');
  if(path==='/service-worker.js')res.setHeader('Service-Worker-Allowed','/');
  res.end(file.body);return true;
 };
}
export const pwaHead='<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="GatePass"><link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png"><link rel="icon" type="image/png" href="/pwa/icon-192.png">';
