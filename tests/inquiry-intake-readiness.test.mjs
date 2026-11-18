import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inquiryIntakeConfigured} from '../src/lib/foundation/ingress-policy.ts';
test('public form stays disabled without separate guest-ingress protection',()=>{
  const config={appUrl:'https://etlinkcoffee.com',supabaseUrl:'https://staging.example.invalid'};
  const key=['sb','secret','synthetic','local','validator'].join('_');
  assert.equal(inquiryIntakeConfigured(config,key),false);
  assert.equal(inquiryIntakeConfigured({...config,synthetic:'true'},key),false);
  assert.equal(inquiryIntakeConfigured({...config,edgeSecret:'a'.repeat(32),identitySecret:'b'.repeat(32)}),false);
  assert.equal(inquiryIntakeConfigured({...config,edgeSecret:'a'.repeat(32),identitySecret:'b'.repeat(32)},key),true);
  assert.equal(inquiryIntakeConfigured({appUrl:'http://127.0.0.1:3103',supabaseUrl:'http://127.0.0.1:54329',synthetic:'true'},key),true);
});
