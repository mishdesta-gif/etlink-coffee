import {test} from 'node:test';import assert from 'node:assert/strict';
import {assessCandidate} from '../src/lib/trading/matching.ts';
const input={origin:'Guji',grade:'1',process:'washed',trade_type:'international',quantity_kg:1000,window_start:'2099-01-01',window_end:'2099-02-01',price:85,currency:'USD',price_unit:'feresula'};
const request={business_id:'buyer',status:'qualified',payload:input};const lot={business_id:'supplier',status:'approved',payload:{...input,price:4,price_unit:'kg'}};
test('manual matching explains fit and price units without disclosing or auto-approving',()=>{
 assert.equal(assessCandidate(request,lot).compatible,true);assert.match(assessCandidate(request,lot).warnings.join(),/covers asking/);
 assert.match(assessCandidate(request,{...lot,payload:{...lot.payload,currency:'ETB'}}).warnings.join(),/no automatic FX/);
 for(const p of [{origin:'Sidama'},{grade:'2'},{process:'natural'},{quantity_kg:999},{window_end:'2000-01-01'},{trade_type:'exporter_to_exporter'}])assert.equal(assessCandidate(request,{...lot,payload:{...lot.payload,...p}}).compatible,false);
 assert.equal(assessCandidate(request,{...lot,business_id:'buyer'}).compatible,false);
});

test('malformed quantities and availability windows never appear as compatible candidates',()=>{
 for(const value of [undefined,'not-a-number',0,-1,Infinity]){
  for(const side of ['request','lot']){
   const invalid={...(side==='request'?request:lot),payload:{...input,quantity_kg:value}};
   const result=side==='request'?assessCandidate(invalid,lot):assessCandidate(request,invalid);
   assert.equal(result.compatible,false);
   assert.match(result.reasons.join(),/valid positive quantity/);
  }
 }
 for(const patch of [{window_start:undefined},{window_end:'2099-02-31'},
  {window_start:'2099-02-02',window_end:'2099-02-01'},{window_end:'not-a-date'}]){
  assert.equal(assessCandidate(request,{...lot,payload:{...lot.payload,...patch}}).compatible,false);
 }
 const missing={...input};delete missing.grade;
 assert.equal(assessCandidate({...request,payload:missing},{...lot,payload:missing}).compatible,false);
});

test('invalid private price data never claims that a target covers an asking price',()=>{
 for(const patch of [{price:'not-a-number'},{price:-1},{price_unit:'unknown'},{price_unit:'toString'}]){
  const assessment=assessCandidate(request,{...lot,payload:{...lot.payload,...patch}});
  assert.doesNotMatch(assessment.warnings.join(),/covers asking/);
  assert.match(assessment.warnings.join(),/valid prices and units/);
 }
});
