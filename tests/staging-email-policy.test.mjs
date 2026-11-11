import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingAuthEmail} from '../src/lib/foundation/ingress-policy.ts';
test('staging registration can use an exact approved inbox list while rejecting other recipients',()=>{
 const allowed='buyer@example.test, supplier@example.test';
 assert.doesNotThrow(()=>assertStagingAuthEmail('register','buyer@example.test',true,allowed));
 assert.doesNotThrow(()=>assertStagingAuthEmail('register','SUPPLIER@example.test',true,allowed));
 assert.throws(()=>assertStagingAuthEmail('register','other@example.test',true,allowed));
 assert.throws(()=>assertStagingAuthEmail('forgot','buyer+other@example.test',true,allowed));
});
test('staging Auth email approval applies only to exact approved inbox and email-sending operations',()=>{
 for(const mode of ['register','forgot']){
  assert.throws(()=>assertStagingAuthEmail(mode,'other@example.test',true,'controlled@example.test'));
  assert.throws(()=>assertStagingAuthEmail(mode,'controlled@example.test',true,undefined));
  assert.doesNotThrow(()=>assertStagingAuthEmail(mode,'CONTROLLED@example.test',true,'controlled@example.test'));
 }
 assert.doesNotThrow(()=>assertStagingAuthEmail('login','other@example.test',true,'controlled@example.test'));
 assert.doesNotThrow(()=>assertStagingAuthEmail('register','other@example.test',false,undefined));
});
