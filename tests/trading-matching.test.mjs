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
