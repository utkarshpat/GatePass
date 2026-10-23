import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {NameReadings,googleInputTools} from '../visits/NameReadings.ts';

// Separate development opt-in. No credentials or personal names in this configuration.
export async function localNameReadings(root:string){
 let provider=process.env.GATEPASS_NAME_READINGS??'off';
 if(process.env.GATEPASS_NAME_READINGS===undefined&&process.env.NODE_ENV!=='test'){
  try{const config:unknown=JSON.parse(await readFile(join(root,'guard-name-readings.json'),'utf8'));
   if(config&&typeof config==='object'&&!Array.isArray(config)&&Object.keys(config).join('|')==='provider')provider=String((config as {provider:unknown}).provider);
  }catch{} // Missing or invalid optional configuration leaves names in English.
 }
 return new NameReadings(provider==='google-input-tools'?googleInputTools():null);
}
