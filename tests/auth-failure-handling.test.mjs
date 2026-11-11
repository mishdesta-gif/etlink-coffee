import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as validation from '../src/lib/foundation/validation.ts';

function actions({logoutError=null,updateError=null,userError=null}={}){
 const scopes=[];
 let updates=0;
 const db={auth:{getUser:async()=>({data:{user:userError?null:{email_confirmed_at:'synthetic-confirmed'}},error:userError}),updateUser:async()=>{updates++;return {error:updateError};},signOut:async options=>{scopes.push(options?.scope);return {error:logoutError};}}};
 const exports={};
 const modules={
  'next/navigation':{redirect:path=>{throw Object.assign(new Error('Synthetic redirect'),{destination:path});}},
  '@/lib/foundation/ingress-policy':{assertAuthProviderReady(){},assertStagingAuthEmail(){}},
  '@/lib/supabase/server':{serverClient:async()=>db,authenticatedClient:async()=>({db,user:{id:'synthetic-user'}}),appUrl:()=> 'http://127.0.0.1:3102'},
  '@/lib/foundation/validation':validation,
 };
 const source=ts.transpileModule(fs.readFileSync('src/app/auth/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,process:{env:{}},require:name=>{assert.ok(Object.hasOwn(modules,name),'Unexpected action dependency');return modules[name];},Buffer});
 return {actions:exports,scopes,updates:()=>updates};
}
function resetForm(){const form=new FormData();form.set('mode','reset');form.set('password','Synthetic-new-password-456!');return form;}

test('password reset never reports complete success when global session retirement fails',async()=>{
 const fixture=actions({logoutError:{message:'Synthetic provider failure with confidential detail'}});
 const state=await fixture.actions.authenticate({},resetForm());
 assert.equal(state.ok,false);
 assert.match(state.message,/Password updated.*other sessions/i);
 assert.doesNotMatch(state.message,/confidential detail/);
 assert.deepEqual(fixture.scopes,['global']);
});
test('failed password update does not claim a changed password or attempt session retirement',async()=>{
 const fixture=actions({updateError:{message:'Synthetic provider detail'}});
 const state=await fixture.actions.authenticate({},resetForm());
 assert.equal(state.ok,false);assert.match(state.message,/could not be changed/);assert.equal(fixture.scopes.length,0);
});
test('successful password reset still retires global sessions before reporting success',async()=>{
 const fixture=actions();const state=await fixture.actions.authenticate({},resetForm());
 assert.equal(state.ok,true);assert.match(state.message,/Sign in again/);assert.deepEqual(fixture.scopes,['global']);
});
test('repeating password setup after session retirement prompts sign-in without updating the password',async()=>{
 const fixture=actions({userError:{name:'AuthSessionMissingError',status:400}});
 const state=await fixture.actions.authenticate({},resetForm());
 assert.equal(state.ok,false);
 assert.match(state.message,/session has ended.*sign in/i);
 assert.equal(fixture.updates(),0);
 assert.deepEqual(fixture.scopes,[]);
});
test('logout failure redirects to a generic visible warning instead of an unqualified success',async()=>{
 const fixture=actions({logoutError:{message:'Synthetic private provider detail'}});
 await assert.rejects(fixture.actions.signOut(),error=>error.destination==='/auth/login?notice=signout-incomplete');
});
test('logout success explicitly retires global sessions and follows the normal login redirect',async()=>{
 const fixture=actions();await assert.rejects(fixture.actions.signOut(),error=>error.destination==='/auth/login');
 assert.deepEqual(fixture.scopes,['global']);
});
