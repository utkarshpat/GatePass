import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const sharp=require(process.env.GATEPASS_SHARP_PATH??join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
const source=await readFile(new URL('../assets/brand/gatepass-logo.png',import.meta.url));
const trimmed=await sharp(source).flatten({background:'#ffffff'}).trim({background:'#ffffff',threshold:15}).png().toBuffer();
await mkdir(new URL('../assets/pwa/',import.meta.url),{recursive:true});
// The maskable logo's complete bounds fit within the central 80%-diameter safe circle.
for(const[name,size,scale]of [['icon-192.png',192,.88],['icon-512.png',512,.88],['icon-maskable-512.png',512,.56],['apple-touch-icon.png',180,.82]]){
 const content=await sharp(trimmed).resize(Math.floor(size*scale),Math.floor(size*scale),{fit:'inside'}).png().toBuffer();
 await sharp({create:{width:size,height:size,channels:3,background:'#ffffff'}}).composite([{input:content,gravity:'centre'}]).png().toFile(fileURLToPath(new URL('../assets/pwa/'+name,import.meta.url)));
}
console.log('GatePass PWA icons generated from the supplied original logo.');
