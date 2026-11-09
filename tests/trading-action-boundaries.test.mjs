import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as validation from '../src/lib/foundation/validation.ts';
import * as types from '../src/lib/trading/types.ts';

test('trading stays closed unless the local or explicitly approved hosted target matches', () => {
 const source = fs.readFileSync('src/lib/trading/config.ts', 'utf8');
 const {outputText} = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
 });
 const hosted = {
  ETLINK_PHASE2_ENABLED: 'true',
  ETLINK_APP_URL: 'https://coffee.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://coffee-db.example',
  ETLINK_TRADING_APPROVED_APP_ORIGIN: 'https://coffee.example',
  ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN: 'https://coffee-db.example',
 };
 function available(overrides) {
  const exports = {};
  vm.runInNewContext(outputText, {exports, URL, require() {}, process: {env: {...hosted, ...overrides}}});
  return exports.tradingAvailable();
 }
 assert.equal(available({}), true);
 assert.equal(available({ETLINK_PHASE2_ENABLED: 'false'}), false);
 assert.equal(available({ETLINK_TRADING_APPROVED_APP_ORIGIN: ''}), false);
 assert.equal(available({ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN: ''}), false);
 assert.equal(available({ETLINK_APP_URL: 'https://preview.example'}), false);
 assert.equal(available({NEXT_PUBLIC_SUPABASE_URL: 'https://other-db.example'}), false);
 assert.equal(available({ETLINK_SYNTHETIC_TEST_MODE: 'true'}), false);
 assert.equal(available({ETLINK_PHASE2_FIXTURE: 'true'}), false);
 assert.equal(available({ETLINK_APP_URL: 'http://127.0.0.1:3102', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329'}), true);
});

function fixture({rpcThrow=false,gateThrow=false,rpcError=null,authThrow=false}={}){
 const calls=[],exports={};
 const modules={
  'next/cache':{revalidatePath(){}},'node:crypto':{},
  '@/lib/supabase/server':{authenticatedClient:async()=>{if(authThrow)throw Error('Synthetic private authentication diagnostic');return {db:{rpc:async(name,args)=>{if(rpcThrow)throw Error('Synthetic confidential provider detail: bearer-secret and private price');calls.push({name,args});return {error:rpcError};}}};},appUrl:()=> 'http://127.0.0.1:3102'},
  '@/lib/trading/config':{requireTrading(){if(gateThrow)throw Error('Synthetic internal configuration detail');}},
  '@/lib/foundation/validation':validation,'@/lib/trading/types':types,
 };
 // Load the optional pure module when the correction is implemented.
 if(fs.existsSync('src/lib/trading/validation.ts')){
  const policy={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/trading/validation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:policy,Date,Error});modules['@/lib/trading/validation']=policy;
 }
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/portal/trading/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{}},Date,Error,require:name=>{assert(Object.hasOwn(modules,name),'Unexpected action dependency');return modules[name];}});
 return {calls,run:form=>exports.tradingMutation({},form)};
}
function commission(starts='2026-01-01',ends='2026-12-31'){
 return new Map(Object.entries({operation:'commission',match_id:'11111111-1111-4111-8111-111111111111',payer:'22222222-2222-4222-8222-222222222222',calculation:'percentage',amount:'5',currency:'USD',earning_trigger:'signed_sale_contract',effective_from:starts,expires_at:ends}));
}
function form(values){const f=new FormData();for(const [key,value]of values)f.set(key,value);return f;}
test('Phase 2 rejects impossible calendar dates before commission RPC instead of normalizing them',async()=>{
 for(const invalid of ['2026-02-29','2026-02-31','2026-04-31','0000-01-01','2026-13-01','2026-01-01T12:30']){
  const f=fixture();const result=await f.run(form(commission(invalid)));assert.equal(result.ok,false);assert.equal(f.calls.length,0,'Invalid date reached privileged RPC');assert.doesNotMatch(result.message,/Invalid time value/);
 }
});
test('Phase 2 preserves exact valid leap-day and UTC end-of-day commission boundaries',async()=>{
 const f=fixture();const result=await f.run(form(commission('2028-02-29','2028-03-01')));assert.equal(result.ok,true);assert.equal(f.calls[0].args.starts,'2028-02-29T00:00:00.000Z');assert.equal(f.calls[0].args.expires,'2028-03-01T23:59:59.000Z');
});
test('Phase 2 unexpected provider failures never serialize confidential exception text',async()=>{
 const result=await fixture({rpcThrow:true}).run(form(commission()));assert.equal(result.ok,false);assert.doesNotMatch(result.message,/bearer-secret|private price|confidential provider/);
});
test('Phase 2 disabled-runtime errors expose no internal configuration and make no RPC',async()=>{
 const f=fixture({gateThrow:true});const result=await f.run(form(commission()));assert.equal(result.ok,false);assert.doesNotMatch(result.message,/internal configuration/);assert.equal(f.calls.length,0);
});
test('Phase 2 preserves safe actionable permission, stale revision and commission failure messages',async()=>{
 for(const [error,expected]of [[{code:'42501',message:'Synthetic secret'},/eligibility, permission and MFA/],[{code:'40001',message:'Synthetic secret'},/record changed/],[{message:'Synthetic commission secret'},/commission terms must be accepted/],[{message:'Synthetic private SQL detail'},/Change not saved/]]){
  const result=await fixture({rpcError:error}).run(form(commission()));assert.equal(result.ok,false);assert.match(result.message,expected);assert.doesNotMatch(result.message,/Synthetic|secret|SQL detail/);
 }
});
test('Phase 2 authentication exceptions fail closed without privileged RPC or private diagnostics',async()=>{
 const f=fixture({authThrow:true});const result=await f.run(form(commission()));assert.equal(result.ok,false);assert.equal(f.calls.length,0);assert.doesNotMatch(result.message,/private authentication/);
});
