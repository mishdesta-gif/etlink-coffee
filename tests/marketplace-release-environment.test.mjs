import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReleaseEnvironment } from '../scripts/check-marketplace-release-environment.mjs';
const env = {
  ETLINK_APP_URL:'https://etlinkcoffee.com',
  NEXT_PUBLIC_SUPABASE_URL:'https://fzgnepvhwhvxukuyubzk.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_'+'publishable_synthetic_configuration_only',
  ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED:'true', ETLINK_PHASE2_ENABLED:'true',
  ETLINK_TRADING_APPROVED_APP_ORIGIN:'https://etlinkcoffee.com',
  ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN:'https://fzgnepvhwhvxukuyubzk.supabase.co',
};
test('release configuration requires real hosted origins and excludes synthetic Auth and test administrator credentials',()=>{
  assert.equal(checkReleaseEnvironment(env).pass,true);
  for (const mutation of [
    {ETLINK_APP_URL:'http://127.0.0.1:3102'},
    {NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329'},
    {ETLINK_SYNTHETIC_TEST_MODE:'true'}, {ETLINK_PHASE2_FIXTURE:'true'},
    {ETLINK_LOCAL_MVP_DEMO:'true'}, {ETLINK_STAGING_VALIDATION:'true'},
    {ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED:'false'},
    {ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN:'https://other.supabase.co'},
    {ETLINK_STAGING_TEST_SECRET_KEY:'synthetic-test-secret'},
    {NEXT_PUBLIC_UNSAFE:'sb_secret_synthetic_local_validator'},
  ]) assert.equal(checkReleaseEnvironment({...env,...mutation}).pass,false);
});
