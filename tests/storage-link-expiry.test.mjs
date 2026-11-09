import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertExpiredStorageLink} from './helpers/assert-expired-storage-link.mjs';
const now=1800000000000;
const url=exp=>'https://fzgnepvhwhvxukuyubzk.supabase.co/storage/v1/object/sign/verification/synthetic/file?token=synthetic.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.synthetic';
const fixture={url:url(now/1000-30),issuedAt:now-90000,now,status:400,ok:false,body:JSON.stringify({error:'InvalidJWT',message:'"exp" claim timestamp check failed'})};
test('storage expiry: confirmed provider expiration-claim rejection and expired wording are accepted',()=>{assert.doesNotThrow(()=>assertExpiredStorageLink(fixture));assert.doesNotThrow(()=>assertExpiredStorageLink({...fixture,body:JSON.stringify({error:'InvalidJWT',message:'JWT expired'})}));});
test('storage expiry: successful downloads, wrong status and unrelated errors fail',()=>{for(const change of [{ok:true,status:200},{status:500},{body:JSON.stringify({error:'InvalidJWT',message:'Invalid signature'})},{body:JSON.stringify({error:'Other',message:'JWT expired'})},{body:'unparseable'}])assert.throws(()=>assertExpiredStorageLink({...fixture,...change}));});
test('storage expiry: premature, missing expiration and wrong-target fixtures fail',()=>{for(const change of [{issuedAt:now-1000},{url:url(now/1000+30)},{url:url(undefined)},{url:fixture.url.replace('fzgnepvhwhvxukuyubzk','another-project')},{url:fixture.url.replace('/verification/','/other/')}])assert.throws(()=>assertExpiredStorageLink({...fixture,...change}));});
