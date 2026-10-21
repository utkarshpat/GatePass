import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OutlookActionCodec} from './OutlookActionCodec.ts';
import {OutlookActionTokenVerifier,validateOutlookTokenConfig} from './OutlookActionToken.ts';
import {OutlookApprovalCard,validateOutlookCardConfig} from './OutlookApprovalCard.ts';
export async function loadOutlookActions(env:NodeJS.ProcessEnv,origin:string){
 if(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED!==undefined&&!['true','false'].includes(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED))throw new Error('INVALID_OUTLOOK_ENABLE_FLAG');
 if(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED!=='true')return undefined;
 const config=validateOutlookCardConfig({origin,providerId:env.GATEPASS_OUTLOOK_PROVIDER_ID??''});
 const tokenConfig=validateOutlookTokenConfig({tenantId:env.GATEPASS_OUTLOOK_TENANT_ID??'',applicationId:env.GATEPASS_OUTLOOK_APPLICATION_ID??'',scope:env.GATEPASS_OUTLOOK_SCOPE??''});
 const path=env.GATEPASS_OUTLOOK_KEYS_MODULE??'';if(!isAbsolute(path))throw new Error('OUTLOOK_PROTECTED_KEYS_REQUIRED');
 const module=await import(pathToFileURL(path).href);if(typeof module.createOutlookActionKeys!=='function')throw new Error('OUTLOOK_PROTECTED_KEYS_REQUIRED');
 const keys=await module.createOutlookActionKeys();if(typeof keys?.active!=='function'||typeof keys?.resolve!=='function')throw new Error('OUTLOOK_PROTECTED_KEYS_REQUIRED');
 const codec=new OutlookActionCodec(keys,JSON.stringify({origin,provider:config.providerId,...tokenConfig}));
 return{config,codec,verifier:new OutlookActionTokenVerifier(tokenConfig),card:new OutlookApprovalCard(config,codec)};
}
