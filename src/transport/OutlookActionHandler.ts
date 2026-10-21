import type {IncomingMessage,ServerResponse} from 'node:http';
import {readJsonBody,HttpFailure} from './ApiHandler.ts';
import {OutlookDecisionService,OutlookDecisionError} from '../email/OutlookDecisionService.ts';
import {validateOutlookCardConfig} from '../email/OutlookApprovalCard.ts';
/** Microsoft-to-service webhook: independent bearer validation, no browser-cookie or Origin bypass for other APIs. */
export function createOutlookActionHandler(service:OutlookDecisionService,config:{origin:string;providerId:string}){
 validateOutlookCardConfig(config);let active=0;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  let admitted=false;
  try{
   if(req.url!=='/api/outlook/decision')throw new HttpFailure(404);
   if(!(req.socket as any).encrypted||req.headers.host!==new URL(config.origin).host)throw new HttpFailure(403);
   if(req.method!=='POST'){res.setHeader('Allow','POST');throw new HttpFailure(405);}
   if(active>=8)throw new HttpFailure(429);active++;admitted=true;
   if(req.headers.authorization&&req.headers['action-authorization'])throw new HttpFailure(400);
   const authorization=req.headers.authorization??req.headers['action-authorization'];
   const body=await readJsonBody(req);const result=await service.decide(authorization,body);
   res.setHeader('CARD-UPDATE-IN-BODY','true');res.setHeader('CARD-ACTION-STATUS',result.decision==='APPROVED'?'Visit approved.':'Visit rejected.');res.statusCode=200;
   res.end(JSON.stringify({type:'AdaptiveCard',version:'1.0',originator:config.providerId,body:[{type:'TextBlock',text:result.decision==='APPROVED'?'Visit approved':'Visit rejected',weight:'Bolder',wrap:true}],actions:[{type:'Action.OpenUrl',title:'View details',url:config.origin+'/approval/'+result.visitRequestId}]}));
  }catch(error){req.resume();const status=error instanceof OutlookDecisionError||error instanceof HttpFailure?error.status:503;
   res.statusCode=status;res.setHeader('CARD-ACTION-STATUS',({400:'Invalid action.',401:'Outlook identity could not be verified.',403:'This action is not available for this account.',409:'Request changed, expired or already decided. View details for its current status.',429:'Please try again shortly.'} as Record<number,string>)[status]??'Action unavailable. Please try again.');res.end(JSON.stringify({error:'OUTLOOK_ACTION_REJECTED'}));
  }finally{if(admitted)active--;}
 };
}
