// Test-only assertion. Decoded claims identify the test fixture; never authorize access.
import assert from 'node:assert/strict';
export function assertExpiredStorageLink({url,issuedAt,now=Date.now(),status,ok,body}){
 const target=new URL(url);
 assert.equal(target.origin,'https://fzgnepvhwhvxukuyubzk.supabase.co','Unexpected staging target');
 assert.ok(target.pathname.startsWith('/storage/v1/object/sign/verification/'),'Unexpected document route');
 assert.ok(Number.isFinite(issuedAt)&&now-issuedAt>=70000,'Fixture link must already be expired');
 const claims=JSON.parse(Buffer.from((target.searchParams.get('token')||'').split('.')[1]||'','base64url'));
 assert.ok(Number.isFinite(claims.exp)&&claims.exp<Math.floor(now/1000),'Fixture expiration must be in the past');
 assert.equal(ok,false,'Expired link must not return a successful download');
 assert.equal(status,400,'Require the confirmed provider rejection status');
 const result=JSON.parse(body);
 assert.equal(result.error,'InvalidJWT','Require the confirmed provider rejection code');
 assert.ok(typeof result.message==='string'&&(/expir/i.test(result.message)||/exp.*claim.*timestamp.*check failed/i.test(result.message)),'Require an expiration-specific rejection, not an unrelated JWT failure');
}
