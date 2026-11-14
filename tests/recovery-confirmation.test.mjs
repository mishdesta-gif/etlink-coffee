import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {NextResponse} from 'next/server.js';
import {recoveryDestination} from '../src/lib/foundation/recovery-confirmation.ts';
const provider='https://fzgnepvhwhvxukuyubzk.supabase.co',app='http://127.0.0.1:3103';
function link(callback=app+'/auth/callback?next=reset') {const u=new URL(provider+'/auth/v1/verify');u.searchParams.set('token','a'.repeat(64));u.searchParams.set('type','recovery');u.searchParams.set('redirect_to',callback);return u;}

test('private acceptance recovery stays bound to its exact application origin and rejects local or other-site callbacks',()=>{
 const acceptance='https://calm-mochi-f4cd34.netlify.app';
 const expected=link(acceptance+'/auth/callback?next=reset').href;
 assert.equal(recoveryDestination(expected,provider,acceptance),expected);
 assert.throws(()=>recoveryDestination(link().href,provider,acceptance));
 assert.throws(()=>recoveryDestination(link('https://other.netlify.app/auth/callback?next=reset').href,provider,acceptance));
 assert.throws(()=>recoveryDestination(expected,provider,app));
});
test('recovery destination allows only the bound provider and reset callback, preserving PKCE flow identifiers',()=>{
 for(const callback of [app+'/auth/callback?next=reset',app+'/auth/callback?next=reset&sb_flow_id=syntheticFlow123'])assert.equal(recoveryDestination(link(callback).href,provider,app),link(callback).href);
});
test('malicious recovery destinations, duplicate parameters and callback injection are rejected',()=>{
 const attacks=[null,[], 'javascript:alert(1)',link().href+'#secret',link().href+'&type=recovery',link().href+'&unexpected=1',link().href.replace(provider,'https://evil.invalid'),link().href.replace('/auth/v1/verify','/auth/v1/verify/'),link().href.replace('token='+ 'a'.repeat(64),'token=bad'),link().href.replace('type=recovery','type=signup'),link().href.replace('https://','https://user@')];
 for(const callback of ['https://evil.invalid/auth/callback?next=reset',app+'/auth/callback?next=reset&next=reset',app+'/auth/callback?next=https://evil.invalid',app+'/auth/callback?next=reset#fragment',app+'/auth/callback?next=reset&sb_flow_id=bad',app+'/portal?next=reset'])attacks.push(link(callback).href);
 for(const raw of attacks)assert.throws(()=>recoveryDestination(raw,provider,app));
});
test('fake provider access requires explicitly enabled synthetic mode and exact loopback port',()=>{
 const fake=link().href.replace(provider,'http://127.0.0.1:54329');
 assert.throws(()=>recoveryDestination(fake,'http://127.0.0.1:54329',app));
 assert.equal(recoveryDestination(fake,'http://127.0.0.1:54329',app,true),fake);
 assert.throws(()=>recoveryDestination(fake.replace('54329','54330'),'http://127.0.0.1:54330',app,true));
});
function handler(){
 const exports={};const source=ts.transpileModule(fs.readFileSync('src/app/auth/recovery/continue/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,NextResponse,URL,URLSearchParams,TextDecoder,process:{env:{NEXT_PUBLIC_SUPABASE_URL:provider}},require:name=>({'next/server':{NextResponse},'@/lib/supabase/server':{appUrl:()=>app},'@/lib/foundation/recovery-confirmation':{recoveryDestination}}[name])});return exports;
}
function request({origin=app,site='same-origin',body=new URLSearchParams({confirmation_url:link().href}).toString(),contentType='application/x-www-form-urlencoded'}={}){
 const headers={'content-type':contentType};if(origin!==null)headers.origin=origin;if(site!==null)headers['sec-fetch-site']=site;
 return new Request(app+'/auth/recovery/continue',{method:'POST',headers,body});
}
test('continuation is POST-only and returns a private 303 without fetching the provider',async()=>{
 const route=handler();assert.equal(route.GET,undefined);assert.equal(route.HEAD,undefined);
 const response=await route.POST(request());assert.equal(response.status,303);assert.equal(response.headers.get('location'),link().href);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('continuation denies absent/foreign origins, cross-site requests and wrong content types',async()=>{
 const {POST}=handler();for(const options of [{origin:null},{origin:'null'},{origin:'https://evil.invalid'},{site:'cross-site'},{site:'same-site'}])assert.equal((await POST(request(options))).status,403);
 assert.equal((await POST(request({contentType:'application/json'}))).status,415);
});
test('explicit client confirmation receives a validated JSON destination without weakening Origin checks',async()=>{
 const valid=request();valid.headers.set('accept','application/json');const r=await handler().POST(valid);
 assert.equal(r.status,200);assert.equal((await r.json()).destination,link().href);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 const invalid=request({origin:'null'});invalid.headers.set('accept','application/json');assert.equal((await handler().POST(invalid)).status,403);
});
test('continuation bounds request bytes and rejects tampering with generic errors',async()=>{
 const {POST}=handler();assert.equal((await POST(request({body:'x'.repeat(8193)}))).status,413);
 for(const body of ['confirmation_url=secret-malicious-input',new URLSearchParams({confirmation_url:link().href}).toString()+'&confirmation_url=duplicate','unexpected=1']){
  const r=await POST(request({body}));assert.equal(r.status,303);assert.equal(r.headers.get('location'),app+'/auth/login?notice=invalid-link');assert.doesNotMatch(await r.text(),/secret-malicious-input/);
 }
});
