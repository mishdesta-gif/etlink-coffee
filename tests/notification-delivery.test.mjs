import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverStagingNotifications} from '../src/lib/foundation/notification-delivery.ts';
import {resendTransport} from '../src/lib/foundation/resend-transport.ts';
const job={delivery_id:'11111111-1111-4111-8111-111111111111',notification_id:'22222222-2222-4222-8222-222222222222',recipient_id:'33333333-3333-4333-8333-333333333333',lease_token:'44444444-4444-4444-8444-444444444444'};
const config={enabled:true,externalSendApproved:true,projectUrl:'https://fzgnepvhwhvxukuyubzk.supabase.co',from:'sender@example.test',allowedRecipients:['controlled@example.test'],appOrigin:'http://127.0.0.1:3103'};
function harness(){const sent=[],finished=[];let claims=0;return {sent,finished,get claims(){return claims;},repository:{claim:async()=>{claims++;return [job];},recipient:async()=>({email:'controlled@example.test',confirmed:true,banned:false}),authorize:async()=>true,finish:async(...args)=>finished.push(args)},send:async message=>sent.push(message)};}

test('email worker: disabled/unapproved/other-project modes make no DB claim or send',async()=>{
 const h=harness();assert.equal((await deliverStagingNotifications({...config,enabled:false},h.repository,h.send)).status,'disabled');
 await assert.rejects(()=>deliverStagingNotifications({...config,externalSendApproved:false},h.repository,h.send));
 await assert.rejects(()=>deliverStagingNotifications({...config,projectUrl:'https://other-project.supabase.co'},h.repository,h.send));
 assert.equal(h.claims,0);assert.equal(h.sent.length,0);
});
test('email worker: current authorization, verified recipient and exact allowlist enforced',async()=>{
 for(const replacement of [{recipient:async()=>({email:'other@example.test',confirmed:true,banned:false})},{recipient:async()=>({email:'controlled@example.test',confirmed:false,banned:false})},{recipient:async()=>({email:'controlled@example.test',confirmed:true,banned:true})},{authorize:async()=>false}]){
  const h=harness();Object.assign(h.repository,replacement);const result=await deliverStagingNotifications(config,h.repository,h.send);
  assert.equal(result.failed,1);assert.equal(h.sent.length,0);assert.equal(h.finished[0][2],'invalid_recipient');
 }
});
test('email worker: generic content, stable idempotency and current lease acknowledgement',async()=>{
 const h=harness();const result=await deliverStagingNotifications(config,h.repository,h.send);assert.equal(result.sent,1);
 assert.equal(h.sent[0].idempotencyKey,'etlink-notification/'+job.delivery_id);
 assert.ok(!h.sent[0].text.includes(job.recipient_id));assert.ok(h.sent[0].text.includes('/portal'));
 assert.deepEqual(h.finished[0],[job,true,null]);
});
test('email worker: provider acceptance with failed DB acknowledgement is not reported sent',async()=>{
 const h=harness();h.repository.finish=async()=>{throw Error('Sensitive SQL details must not escape');};
 const result=await deliverStagingNotifications(config,h.repository,h.send);
 assert.equal(result.uncertain,1);assert.equal(result.sent,0);assert.equal(h.sent.length,1);
});
test('email transport: request contract and provider errors tested entirely in memory',async()=>{
 const h=harness();await deliverStagingNotifications(config,h.repository,h.send);
 let request;
 await resendTransport('synthetic-provider-key',async(url,init)=>{request={url,init};return new Response('{}',{status:200});})(h.sent[0]);
 assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.init.headers['Idempotency-Key'],h.sent[0].idempotencyKey);
 assert.equal(JSON.parse(request.init.body).to[0],'controlled@example.test');
  assert.throws(()=>resendTransport(''));
 for(const [status,code] of [[429,'rate_limited'],[503,'provider_unavailable'],[400,'invalid_recipient']]){
  await assert.rejects(()=>resendTransport('synthetic-provider-key',async()=>new Response('Sensitive provider body',{status}))(h.sent[0]),error=>error.code===code&&!error.message.includes('Sensitive'));
 }
});
