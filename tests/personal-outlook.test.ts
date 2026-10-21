import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ProtectedOutlookCache,PersonalOutlookConnection,senderAccount,validateOutlookConfig} from '../src/email/PersonalOutlookConnection.ts';
import {GraphMailTransport} from '../src/email/GraphMailTransport.ts';
const config={clientId:randomUUID(),sender:'sender@outlook.com'};
function fixture(){
 const files=new Map<string,Buffer>(),key=randomBytes(32),id='k_'+'1'.repeat(32);
 const directory:any={async read(name:string){if(!files.has(name))throw Object.assign(new Error(),{code:'ENOENT'});return Buffer.from(files.get(name)!);},async write(name:string,value:Buffer){files.set(name,Buffer.from(value));},async exclusive(_name:string,action:()=>Promise<unknown>){return action();}};
 const keys={async active(){return{id,key:Buffer.from(key)};},async resolve(requested:string){assert.equal(requested,id);return Buffer.from(key);}};
 const cache=new ProtectedOutlookCache(directory,keys,config);return{files,directory,keys,cache};
}
test('personal Outlook cache encrypts persisted refresh material, reloads, and binds app and sender',async()=>{
 const f=fixture();assert.equal(await f.cache.load(),'');await f.cache.save('refresh-token-secret');
 assert(!f.files.get('tokens.enc')!.toString().includes('refresh-token-secret'));assert.equal(await f.cache.load(),'refresh-token-secret');
 for(const changed of [{...config,sender:'other@outlook.com'},{...config,clientId:randomUUID()}])await assert.rejects(new ProtectedOutlookCache(f.directory,f.keys,changed).load(),/OUTLOOK_CACHE_UNAVAILABLE/u);
 const envelope=JSON.parse(f.files.get('tokens.enc')!.toString());envelope.tag=Buffer.alloc(16).toString('base64');f.files.set('tokens.enc',Buffer.from(JSON.stringify(envelope)));await assert.rejects(f.cache.load(),/OUTLOOK_CACHE_UNAVAILABLE/u);
});
test('malformed and oversized caches fail closed; configuration and sender ambiguity are rejected',async()=>{
 const f=fixture();f.files.set('tokens.enc',Buffer.from('{}'));await assert.rejects(f.cache.load());await assert.rejects(f.cache.save('x'.repeat(1048577)));
 assert.throws(()=>validateOutlookConfig({...config,clientId:'bad'}));assert.throws(()=>validateOutlookConfig({...config,sender:'a@outlook.com\r\nBcc:x@y.com'}));
 assert.throws(()=>senderAccount([],config.sender));assert.throws(()=>senderAccount([{username:config.sender},{username:config.sender}] as any,config.sender));
 assert.equal(senderAccount([{username:'SENDER@outlook.com'}] as any,config.sender).username,'SENDER@outlook.com');
});
test('wrong account interactive login is never persisted, and connect never sends mail',async()=>{
 const f=fixture();let account:any={username:'wrong@outlook.com'};const app:any={async acquireTokenByDeviceCode(){return{account,accessToken:'test-access'};},getTokenCache(){return{serialize:()=>'{"refresh":"secret"}'};}};
 const connection=new PersonalOutlookConnection(config,f.cache,f.directory,()=>app);await assert.rejects(connection.connect(()=>{}),/OUTLOOK_SENDER_SIGN_IN_REQUIRED/u);assert.equal(f.files.size,0);
 account={username:config.sender};assert.deepEqual(await connection.connect(()=>{}),{sender:config.sender});assert.equal(JSON.parse(f.files.get('connection.json')!.toString()).sender,config.sender);assert.equal(await f.cache.load(),'{"refresh":"secret"}');
});
test('silent refresh pins sender, persists rotated cache, and disconnect prevents further token use',async()=>{
 const f=fixture();await f.cache.save('old-cache');let stored='',username=config.sender;
 const app:any={getTokenCache(){return{deserialize:(s:string)=>{stored=s;},serialize:()=> 'rotated-cache',getAllAccounts:async()=>[{username}]};},async acquireTokenSilent(request:any){assert.equal(request.account.username,config.sender);return{account:{username:config.sender},accessToken:'new-access'};}};
 const connection=new PersonalOutlookConnection(config,f.cache,f.directory,()=>app);assert.equal(await connection.acquireToken(),'new-access');assert.equal(stored,'old-cache');assert.equal(await f.cache.load(),'rotated-cache');
 username='other@outlook.com';await assert.rejects(connection.acquireToken(),/OUTLOOK_SENDER_SIGN_IN_REQUIRED/u);await connection.disconnect();assert.equal(await f.cache.load(),'');await assert.rejects(connection.acquireToken(),/OUTLOOK_SENDER_SIGN_IN_REQUIRED/u);
});
test('delegated Graph sends as /me, keeps Sent Items, and propagates token failure without sending',async()=>{
 let calls=0;const message={notificationId:'connection-test',to:'colleague@example.com',subject:'Test',html:'<p>Test</p>'};
 const transport=new GraphMailTransport(config.sender,async()=>'access',async(url,init)=>{calls++;assert.equal(String(url),'https://graph.microsoft.com/v1.0/me/sendMail');assert.equal(JSON.parse(String(init!.body)).saveToSentItems,true);return new Response(null,{status:202});},'delegated');await transport.send(message);assert.equal(calls,1);
 await assert.rejects(new GraphMailTransport(config.sender,async()=>{throw new Error('private provider response');},async()=>{calls++;return new Response();},'delegated').send(message),{code:'PROVIDER_UNAVAILABLE'});assert.equal(calls,1);
});
test('Graph diagnostic keeps only status and allowlisted code, never provider message or unknown code',async()=>{
 const message={notificationId:'test',to:'test@example.com',subject:'Test',html:'Test'};
 for(const providerCode of ['ErrorSendAsDenied','ErrorNonExistentMailbox','sensitive-unknown-value']){
  const transport=new GraphMailTransport(config.sender,async()=>'token',async()=>new Response(JSON.stringify({error:{code:providerCode,message:'private response text'}}),{status:403}),'delegated');
  await assert.rejects(transport.send(message),(error:any)=>error.httpStatus===403&&error.providerCode===(providerCode==='sensitive-unknown-value'?'UNSPECIFIED':providerCode)&&!JSON.stringify(error).includes('private response text'));
 }
});
