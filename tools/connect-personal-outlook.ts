import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {openPersonalOutlook} from '../src/email/PersonalOutlookConnection.ts';
import {GraphMailTransport,GraphMailFailure} from '../src/email/GraphMailTransport.ts';

const command=process.argv[2]??'status';
try{
 if(!['connect','status','test','disconnect'].includes(command))throw new Error('OUTLOOK_COMMAND_INVALID');
 const config=command==='connect'?{clientId:process.env.GATEPASS_GRAPH_CLIENT_ID??'',sender:process.env.GATEPASS_MAIL_SENDER??''}:undefined;
 const {connection,config:selected}=await openPersonalOutlook(config);
 if(command==='connect'){
  await connection.connect(code=>{console.log('Microsoft sender sign-in: '+code.verificationUri);console.log('Enter code: '+code.userCode);console.log('Sign in as '+selected.sender+'. Code expires in '+Math.ceil(code.expiresIn/60)+' minutes.');});
  console.log('OUTLOOK_CONNECTED: '+selected.sender+'. No email sent.');
 }else if(command==='disconnect'){
  await connection.disconnect();console.log('OUTLOOK_DISCONNECTED: local token cache cleared. Existing Microsoft consent can be removed in your account permissions.');
 }else if(command==='status'){
  await connection.acquireToken();console.log('OUTLOOK_CONNECTED: '+selected.sender+'. No email sent.');
 }else{
  const recipient=process.argv[3];if(!recipient||recipient.length>320||!/^[^\s<>@\x00-\x1f]+@[^\s<>@\x00-\x1f]+\.[^\s<>@\x00-\x1f]+$/u.test(recipient))throw new Error('OUTLOOK_TEST_RECIPIENT_REQUIRED');
  const transport=new GraphMailTransport(selected.sender,()=>connection.acquireToken(),fetch,'delegated');
  await transport.send({notificationId:'connection-test-'+randomUUID(),to:recipient,subject:'GatePass — email connection test',html:'<!doctype html><html lang="en"><body style="font:15px Segoe UI,Arial,sans-serif;color:#172234"><img src="cid:gatepass-company-logo" width="180" alt="Sopra Steria"><h1 style="font-size:22px">Email connection verified</h1><p>This is a GatePass test email. No visit request or access approval was created.</p><p>GatePass</p></body></html>',inlineLogo:(await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url))).toString('base64')});
  console.log('OUTLOOK_TEST_ACCEPTED: Microsoft accepted the test email. Inbox delivery is not yet verified.');
 }
}catch(error){
 if(error instanceof GraphMailFailure){console.error('OUTLOOK_SEND_FAILED: HTTP '+error.httpStatus+'; '+error.providerCode+'. Provider acceptance was not confirmed.');process.exitCode=1;}
 else{
 const allowed=['OUTLOOK_CONFIGURATION_REQUIRED','OUTLOOK_SENDER_SIGN_IN_REQUIRED','OUTLOOK_CACHE_UNAVAILABLE','OUTLOOK_TEST_RECIPIENT_REQUIRED','OUTLOOK_COMMAND_INVALID','PRIVATE_STORE_BUSY'];
 const code=error instanceof Error&&allowed.includes(error.message)?error.message:'OUTLOOK_CONNECTION_UNAVAILABLE';
 console.error(code+': verify client ID, sender, delegated Mail.Send and Allow public client flows. Never paste tokens, passwords or client secrets into chat.');process.exitCode=1;
 }
}
