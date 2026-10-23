import type {IncomingMessage,ServerResponse} from 'node:http';
import {HttpFailure,readJsonBody} from '../transport/ApiHandler.ts';
import type {Session} from '../transport/ApiHandler.ts';
import type {WorkspaceChanges} from './WorkspaceChanges.ts';
import {createHash} from 'node:crypto';

type Subscription={workspace:'ADMIN'|'GUARD'|'RECEPTION';locationId:number;projectLocationId?:string};
type Staff={session(req:IncomingMessage):Session;verify(s:Session):Promise<boolean>};
export class WorkspaceEventRoutes {
 private staff:Staff;private changes:WorkspaceChanges;private authorize:(s:Session,input:Subscription)=>Promise<Set<string>>;
 #pending=0;#pendingByKey=new Map<string,number>();
 constructor(staff:Staff,changes:WorkspaceChanges,authorize:(s:Session,input:Subscription)=>Promise<Set<string>>){this.staff=staff;this.changes=changes;this.authorize=authorize;}
 handles(path:string){return path==='/api/workspace/events';}
 async handle(req:IncomingMessage,res:ServerResponse){
  const session=this.staff.session(req);if(!await this.staff.verify(session))throw new HttpFailure(401);
  const d=await readJsonBody(req);
  if(Object.keys(d).some(k=>!['workspace','locationId','projectLocationId'].includes(k))||typeof d.workspace!=='string'||!['ADMIN','GUARD','RECEPTION'].includes(d.workspace)||!Number.isInteger(d.locationId)||Number(d.locationId)<=0||Number(d.locationId)>2147483647||d.projectLocationId!==undefined&&(d.workspace!=='ADMIN'||typeof d.projectLocationId!=='string'||!/^[1-9][0-9]{0,18}$/u.test(d.projectLocationId)||BigInt(d.projectLocationId)>9223372036854775807n))throw new HttpFailure(400);
  const key=createHash('sha256').update(session.sessionToken).digest('hex'),pending=this.#pendingByKey.get(key)??0;
  if(this.changes.connections+this.#pending>=4||this.changes.capacity(session.sessionToken)<=pending)throw new HttpFailure(429);
  this.#pending++;this.#pendingByKey.set(key,pending+1);
  try{
   const topics=await this.authorize(session,d as Subscription);
   if(!res.destroyed)this.changes.open(session.sessionToken,topics,res);
  }finally{this.#pending--;const count=this.#pendingByKey.get(key)!-1;if(count)this.#pendingByKey.set(key,count);else this.#pendingByKey.delete(key);}
 }
}
