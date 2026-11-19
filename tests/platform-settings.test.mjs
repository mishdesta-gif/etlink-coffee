import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(fs.readFileSync('src/app/admin/settings/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
async function render({allowed=false,error=null,signedIn=true,trading=false}={}){
 const exports={},calls=[];
 const modules={'next/link':{default:()=>null},'next/navigation':{redirect:()=>{throw Error('LOGIN_REQUIRED');}},'@/lib/supabase/server':{authenticatedClient:async()=>{if(!signedIn)throw Error('no session');return {db:{rpc:async(name,args)=>{calls.push({name,args});return {data:allowed,error};}}};}},'@/components/foundation/shell':{FoundationShell:()=>null},'@/lib/trading/config':{tradingAvailable:()=>trading}};
 vm.runInNewContext(code,{exports,process:{env:{}},require:name=>modules[name]??require(name)});
 return {element:await exports.default(),calls};
}
test('platform settings require a current server-side staff.manage permission and deny provider errors',async()=>{
 for(const input of [{allowed:false},{allowed:true,error:{code:'42501'}}])assert.equal((await render(input)).element.props.title,'Staff access required.');
 const result=await render({allowed:true});assert.equal(result.element.props.title,'Platform settings');assert.deepEqual(result.calls.map(c=>c.name),['has_permission']);assert.equal(result.calls[0].args.p,'staff.manage');assert.equal(result.calls[0].args.b,null);
 await assert.rejects(render({signedIn:false}),/LOGIN_REQUIRED/);
});

const textOf=value=>value==null?'':Array.isArray(value)?value.map(textOf).join(' '):typeof value==='object'?textOf(value.props?.children):String(value);
test('platform settings explain release-disabled workflows without hiding permission requirements',async()=>{
 const disabled=textOf((await render({allowed:true})).element);
 assert.match(disabled,/Disabled by release control/);assert.match(disabled,/Staff management alone does not authorize/);
 const enabled=textOf((await render({allowed:true,trading:true})).element);
 assert.match(enabled,/Enabled for the configured deployment/);assert.doesNotMatch(enabled,/Disabled by release control/);
});
