import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as validation from '../src/lib/foundation/validation.ts';
const marker='SYNTHETIC_INTERNAL_SQL_TOKEN_DIAGNOSTIC';
const form=values=>{const f=new FormData();for(const [k,v]of Object.entries(values))f.set(k,v);return f;};
const inquiry=()=>form({category:'general',name:'Synthetic visitor',email:'synthetic@example.test',business_name:'Synthetic business',country:'Germany',message:'Synthetic inquiry with no real customer data.',website:''});
const review=expires_at=>form({operation:'review',id:'11111111-1111-4111-8111-111111111111',revision:'1',status:'approved',reason:'Synthetic independent review',expires_at});
function fixture({failAt='',rpcError=null,thrown=new Error(marker)}={}){
 const calls=[],logs=[],authCalls=[];
 const maybe=stage=>{if(failAt===stage)throw thrown;};
 const db={rpc:async(name,args)=>{maybe('rpc');calls.push({name,args});return {data:'SYNTHETIC-REF',error:rpcError};},auth:{
  getSession:async()=>{maybe('session');return {data:{session:null}};},
  signInWithPassword:async()=>{maybe('login');return {data:{user:{email_confirmed_at:'synthetic-confirmed'}},error:null};},
  signUp:async()=>{maybe('register');return {data:{session:null},error:null};},
  resetPasswordForEmail:async()=>{maybe('forgot');return {error:null};},
  updateUser:async()=>{maybe('reset');authCalls.push('updated');return {error:null};},
  signOut:async()=>{maybe('signout');authCalls.push('signed-out');return {error:null};},
 }};
 const modules={
  'next/navigation':{redirect:path=>{throw Object.assign(Error('Synthetic redirect'),{destination:path});}},
  'next/headers':{cookies:async()=>({set(){}})},'next/cache':{revalidatePath(){}},'node:crypto':{},
  '@/lib/foundation/validation':validation,
  '@/lib/foundation/ingress-policy':{assertAuthProviderReady(){maybe('readiness');},assertStagingAuthEmail(){}},
  '@/lib/supabase/server':{serverClient:async()=>{maybe('client');return db;},authenticatedClient:async()=>{maybe('auth');return {db,user:{id:'synthetic-user'}};},appUrl:()=> 'http://127.0.0.1:3103'},
  '@/lib/supabase/document-validator':{},'@/lib/supabase/ingress':{protectedIngress:async()=>{maybe('ingress');return {db};}},
 };
 const load=file=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,Buffer,process:{env:{}},console:{error:(...args)=>logs.push(args)},require:name=>{assert(Object.hasOwn(modules,name),'Unexpected dependency');return modules[name];}});return exports;};
 // The pure shared helper logs through its own module's console. Capture it only
 // during awaited tests below; all Node tests run sequentially in this file.
 return {auth:load('src/app/auth/actions.ts'),portal:load('src/app/portal/actions.ts'),calls,logs,authCalls};
}
async function captureLogs(run){const original=console.error,logs=[];console.error=(...args)=>logs.push(args);try{return {value:await run(),logs};}finally{console.error=original;}}
test('Phase 1 unexpected client/auth failures never disclose exception text',async()=>{
 for(const failAt of ['client','auth']){
  const f=fixture({failAt});const {value}=await captureLogs(()=>f.auth.authenticate({},form({mode:failAt==='auth'?'reset':'login',email:'synthetic@example.test',password:'Synthetic-password!'})));
  assert.equal(value.ok,false);assert.doesNotMatch(value.message,/SYNTHETIC_INTERNAL/);assert.equal(f.calls.length,0);
 }
});
test('Phase 1 unexpected login/signup/recovery/reset exceptions remain generic',async()=>{
 for(const [mode,failAt]of [['login','login'],['register','register'],['forgot','forgot'],['reset','reset']]){
  const f=fixture({failAt});const {value}=await captureLogs(()=>f.auth.authenticate({},form({mode,email:'synthetic@example.test',password:'Synthetic-password!'})));
  assert.equal(value.ok,false);assert.doesNotMatch(value.message,/SYNTHETIC_INTERNAL/);
 }
});
test('Phase 1 thrown retirement failure preserves truthful password-update status without disclosure',async()=>{
 const f=fixture({failAt:'signout'});const {value}=await captureLogs(()=>f.auth.authenticate({},form({mode:'reset',password:'Synthetic-password!'})));
 assert.equal(value.ok,false);assert.match(value.message,/Password updated.*sessions/);assert.doesNotMatch(value.message,/SYNTHETIC_INTERNAL/);assert.deepEqual(f.authCalls,['updated']);
});
test('Phase 1 workspace and public inquiry unexpected failures are sanitized at every service boundary',async()=>{
 for(const failAt of ['auth','rpc']){const f=fixture({failAt});const {value}=await captureLogs(()=>f.portal.mutate({},form({operation:'profile',display_name:'Synthetic'})));assert.equal(value.ok,false);assert.doesNotMatch(value.message,/SYNTHETIC_INTERNAL/);}
 for(const failAt of ['client','session','ingress','rpc']){const f=fixture({failAt});const {value}=await captureLogs(()=>f.portal.sendInquiry({},inquiry()));assert.equal(value.ok,false);assert.doesNotMatch(value.message,/SYNTHETIC_INTERNAL/);}
});
test('Phase 1 safe validation and permission/stale-state messages remain actionable',async()=>{
 const f=fixture();assert.match((await f.auth.authenticate({},form({mode:'login',email:'bad',password:'x'}))).message,/email/);
 assert.match((await f.portal.mutate({},form({operation:'profile',display_name:''}))).message,/display name/);
 assert.match((await f.portal.sendInquiry({},form({category:'general'}))).message,/name/);assert.equal(f.calls.length,0);
 for(const [rpcError,pattern]of [[{code:'42501',message:marker},/permission/],[{message:'changed. Reload '+marker},/changed/],[{message:'Too many '+marker},/Too many/],[{message:'transition '+marker},/not allowed/],[{message:marker},/could not be saved/]]){
  const r=await fixture({rpcError}).portal.mutate({},form({operation:'profile',display_name:'Synthetic'}));assert.equal(r.ok,false);assert.match(r.message,pattern);assert.doesNotMatch(r.message,/SYNTHETIC_INTERNAL/);
 }
});
test('Phase 1 lookalike messages, stacks and non-Error thrown objects are not trusted',async()=>{
 for(const thrown of [new Error('Please check password: '+marker),Object.assign(new Error(marker),{stack:marker}),{message:marker,code:marker,name:'SafeActionError'},marker]){
  const f=fixture({failAt:'client',thrown});const {value}=await captureLogs(()=>f.auth.authenticate({},form({mode:'login',email:'synthetic@example.test',password:'Synthetic-password!'})));assert.equal(value.ok,false);assert.doesNotMatch(JSON.stringify(value),/SYNTHETIC_INTERNAL/);
 }
});
test('Phase 1 internal diagnostics are fixed-category metadata, never exception data',async()=>{
 const f=fixture({failAt:'client'});const {value,logs}=await captureLogs(()=>f.auth.authenticate({},form({mode:'login',email:'synthetic@example.test',password:'Synthetic-password!'})));
 const entries=[...logs,...f.logs];assert.equal(value.ok,false);assert.equal(entries.length,1);assert.match(JSON.stringify(entries),/ETLINK_ACTION_FAILURE/);assert.doesNotMatch(JSON.stringify(entries),/SYNTHETIC_INTERNAL|synthetic@example.test|Synthetic-password/);
});
test('Phase 1 impossible or malformed verification dates never reach privileged RPC',async()=>{
 for(const date of ['2099-02-31','2099-02-29','2100-02-29','2026-04-31','0000-01-01','2099-13-01','2099-00-01','2099-01-00','2099-1-01','2099-01-01T12:00',' 2099-01-01','not-a-date']){
  const f=fixture();const r=await f.portal.mutate({},review(date));assert.equal(r.ok,false,`Accepted ${date}`);assert.equal(f.calls.length,0,`RPC received ${date}`);assert.match(r.message,/valid.*date/i);
 }
});
test('Phase 1 valid leap/calendar dates retain exact UTC end-of-day and null expiry behavior',async()=>{
 for(const date of ['2000-02-29','2028-02-29','2099-02-28','2099-12-31','0001-01-01','9999-12-31','']){
  const f=fixture();const r=await f.portal.mutate({},review(date));assert.equal(r.ok,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'review_capability');assert.equal(f.calls[0].args.e,date?date+'T23:59:59.000Z':null);
 }
});
test('Phase 1 successful inquiry and verification outputs preserve existing workflow responses',async()=>{
 const f=fixture();const r=await f.portal.sendInquiry({},inquiry());assert.equal(r.ok,true);assert.match(r.message,/SYNTHETIC-REF/);assert.equal(f.calls[0].name,'submit_trusted_inquiry');
 const v=await f.portal.mutate({},review('2099-02-28'));assert.equal(v.ok,true);assert.match(v.message,/Verification decision recorded/);
});
