import test from 'node:test';
import assert from 'node:assert/strict';
import ingress from '../netlify/edge-functions/contact-ingress.js';
import {ingressIdentity} from '../src/lib/foundation/ingress-policy.ts';
test('Netlify contact edge replaces forged assertions with trusted IP proof and server verifies it',async()=>{
 const original=globalThis.Netlify;
 try {
  globalThis.Netlify={env:{get:()=> 'synthetic-edge-proof-secret-at-least-32-bytes'}};
  let forwarded;
  const request=new Request('https://coffee.example/contact',{method:'POST',body:'synthetic form',headers:{'x-etlink-client-ip':'192.0.2.99','x-etlink-edge-time':'0','x-etlink-edge-signature':'a'.repeat(64),'x-forwarded-for':'192.0.2.99'}});
  await ingress(request,{ip:'192.0.2.1',next:async value=>{forwarded=value;return new Response('ok');}});
  assert.equal(forwarded.headers.get('x-etlink-client-ip'),'192.0.2.1');
  const identity=ingressIdentity(forwarded.headers,'inquiry',{edgeSecret:globalThis.Netlify.env.get(),identitySecret:'synthetic-private-identity-secret-32-bytes'});
  assert.match(identity,/^[a-f0-9]{64}$/);assert.equal(await forwarded.text(),'synthetic form');
 }finally{globalThis.Netlify=original;}
});
test('contact edge strips forged GET proofs and fails closed for POST without required configuration',async()=>{
 const original=globalThis.Netlify;
 try {
  globalThis.Netlify={env:{get:()=>undefined}};let forwarded;
  await ingress(new Request('https://coffee.example/contact',{headers:{'x-etlink-edge-signature':'forged'}}),{next:async value=>{forwarded=value;return new Response('ok');}});
  assert.equal(forwarded.headers.has('x-etlink-edge-signature'),false);
  const rejected=await ingress(new Request('https://coffee.example/contact',{method:'POST'}),{ip:'192.0.2.1',next:()=>{throw Error('Unprotected forwarding prohibited');}});
  assert.equal(rejected.status,503);assert.equal(rejected.headers.get('cache-control'),'no-store');
 }finally{globalThis.Netlify=original;}
});
