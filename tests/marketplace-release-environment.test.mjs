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

const privateAcceptance={...env,ETLINK_RELEASE_TARGET:'private-acceptance',
  ETLINK_APP_URL:'https://calm-mochi-f4cd34.netlify.app',
  ETLINK_TRADING_APPROVED_APP_ORIGIN:'https://calm-mochi-f4cd34.netlify.app',
  NETLIFY:'true',CONTEXT:'production',URL:'https://calm-mochi-f4cd34.netlify.app',
  BRANCH:'codex/netlify-launch-20261111',ETLINK_PRIVATE_ACCESS_REVIEWED:'true'};

test('private acceptance permits only the exact reviewed Netlify site and branch, with all readiness gates intact',()=>{
  assert.equal(checkReleaseEnvironment(privateAcceptance).pass,true);
  for(const mutation of [
    {ETLINK_RELEASE_TARGET:'preview'},{ETLINK_RELEASE_TARGET:'production'},
    {ETLINK_APP_URL:'https://other.netlify.app',ETLINK_TRADING_APPROVED_APP_ORIGIN:'https://other.netlify.app'},
    {ETLINK_APP_URL:'https://calm-mochi-f4cd34.netlify.app.evil.invalid'},
    {ETLINK_APP_URL:'https://calm-mochi-f4cd34.netlify.app/'},
    {URL:'https://other.netlify.app'},{URL:undefined},{NETLIFY:undefined},
    {CONTEXT:'deploy-preview'},{CONTEXT:'branch-deploy'},{CONTEXT:undefined},
    {BRANCH:'main'},{BRANCH:undefined},{ETLINK_PRIVATE_ACCESS_REVIEWED:'false'},
    {ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED:'false'},{ETLINK_PHASE2_ENABLED:'false'},
    {NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},
    {ETLINK_TRADING_APPROVED_APP_ORIGIN:'https://etlinkcoffee.com'},
    {ETLINK_STAGING_TEST_SECRET_KEY:'synthetic-test-secret'},
    {ETLINK_SYNTHETIC_TEST_MODE:'true'},{ETLINK_TRANSACTIONAL_EMAIL_SEND_APPROVED:'true'},
  ])assert.equal(checkReleaseEnvironment({...privateAcceptance,...mutation}).pass,false);
});

test('production stays canonical and rejects leftover acceptance approval or arbitrary Netlify hosts',()=>{
  assert.equal(checkReleaseEnvironment({...env,ETLINK_RELEASE_TARGET:'production'}).pass,true);
  assert.equal(checkReleaseEnvironment({...env,ETLINK_PRIVATE_ACCESS_REVIEWED:'true'}).pass,false);
  assert.equal(checkReleaseEnvironment({...env,ETLINK_APP_URL:privateAcceptance.ETLINK_APP_URL}).pass,false);
});
