import {randomUUID} from 'node:crypto';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
import type {OutlookActionCodec} from './OutlookActionCodec.ts';
export type OutlookCardConfig={providerId:string;origin:string};
export function validateOutlookCardConfig(c:OutlookCardConfig){const url=new URL(c.origin);if(!isUuid(c.providerId)||url.origin!==c.origin||url.protocol!=='https:'||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname==='127.0.0.1'||url.hostname==='[::1]')throw new Error('PUBLIC_HTTPS_OUTLOOK_ORIGIN_REQUIRED');return c;}
export class OutlookApprovalCard{
 #config:OutlookCardConfig;#codec:OutlookActionCodec;
 constructor(config:OutlookCardConfig,codec:OutlookActionCodec){this.#config=validateOutlookCardConfig(config);this.#codec=codec;}
 async render(job:any,to:string){const d=job.details;if(job.templateCode!=='HOST_APPROVAL_REQUEST'||job.recipientKind!=='EMPLOYEE'||!isUuid(job.visitRequestId)||typeof job.recipientEmployeeId!=='string'||!d||!isUuid(d.visitRequestId)||d.visitRequestId.toLowerCase()!==job.visitRequestId.toLowerCase())throw new Error('INVALID_OUTLOOK_APPROVAL');
  const expires=Math.min(Date.parse(d.validUntilUtc),Date.now()+7*86400000);const actions=[];
  for(const decision of ['APPROVED','DENIED'] as const){const capability=await this.#codec.issue({v:1,visit:job.visitRequestId.toLowerCase(),host:job.recipientEmployeeId,snapshot:String(d.snapshotHash).toLowerCase(),decision,clientKey:randomUUID(),expires});
   actions.push({type:'Action.Http',title:decision==='APPROVED'?'Approve':'Reject',method:'POST',url:this.#config.origin+'/api/outlook/decision',headers:[{name:'Content-Type',value:'application/json'}],body:JSON.stringify({capability})});}
  actions.push({type:'Action.OpenUrl',title:'View details',url:this.#config.origin+'/approval/'+job.visitRequestId.toLowerCase()});
  return{$schema:'http://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.0',originator:this.#config.providerId,hideOriginalBody:true,expectedActors:[to],correlationId:randomUUID(),body:[{type:'TextBlock',text:'Visit approval',size:'Large',weight:'Bolder',wrap:true},{type:'FactSet',facts:[['Visitor',d.personName],['Request',d.publicReference],['Office',d.locationName],['Project',d.projectName],['Host',d.hostName],['Purpose',d.purpose]].filter(([,v])=>v).map(([title,value])=>({title,value:String(value)}))}],actions};
 }
}
export function outlookCardScript(card:unknown){return '<script type="application/adaptivecard+json">'+JSON.stringify(card).replace(/</gu,'\\u003c').replace(/>/gu,'\\u003e').replace(/&/gu,'\\u0026')+'</script>';}
