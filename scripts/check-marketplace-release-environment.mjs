// Offline validation only; values and credentials are never printed.
import path from 'node:path';

export function checkReleaseEnvironment(env) {
  const failures = [];
  const need = (condition, message) => { if (!condition) failures.push(message); };
  const target=env.ETLINK_RELEASE_TARGET||'production';
  const acceptance=target==='private-acceptance';
  const acceptanceOrigin='https://calm-mochi-f4cd34.netlify.app';
  need(target==='production'||acceptance,'Unknown release target rejected.');
  need(!env.CONTEXT||env.CONTEXT==='production','Deploy previews and branch publishing are disabled for this release.');
  need(env.ETLINK_APP_URL===(acceptance?acceptanceOrigin:'https://etlinkcoffee.com'),'Exact approved HTTPS application origin is required.');
  if(acceptance){
    need(env.NETLIFY==='true'&&env.CONTEXT==='production','Private acceptance requires the Netlify production deployment context.');
    need(env.URL===acceptanceOrigin,'Assigned Netlify site URL must match the approved acceptance hostname.');
    need(env.BRANCH==='codex/netlify-launch-20261111','Private acceptance requires the reviewed release branch.');
    need(env.ETLINK_PRIVATE_ACCESS_REVIEWED==='true','Netlify private visitor access must be independently reviewed before acceptance.');
  }else{
    need(!env.ETLINK_PRIVATE_ACCESS_REVIEWED||env.ETLINK_PRIVATE_ACCESS_REVIEWED==='false','Private acceptance approval must be removed for public cutover.');
  }
  need(env.NEXT_PUBLIC_SUPABASE_URL==='https://fzgnepvhwhvxukuyubzk.supabase.co','Approved Supabase project must match; another target requires release review.');
  need(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'),'A Supabase publishable client key is required.');
  for (const name of ['ETLINK_SYNTHETIC_TEST_MODE','ETLINK_PHASE2_FIXTURE','ETLINK_LOCAL_MVP_DEMO','ETLINK_STAGING_VALIDATION']) {
    need(!env[name] || env[name]==='false',name+' must be false or absent.');
  }
  need(env.ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED==='true','Provider Auth protection must be verified before enabling account actions.');
  need(env.ETLINK_PHASE2_ENABLED==='true','Marketplace release requires reviewed migrations and explicit activation.');
  need(env.ETLINK_TRADING_APPROVED_APP_ORIGIN===env.ETLINK_APP_URL,'Trading application approval must match.');
  need(env.ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN===env.NEXT_PUBLIC_SUPABASE_URL,'Trading database approval must match.');
  need(!env.ETLINK_STAGING_TEST_SECRET_KEY,'Staging administrator test credentials must not be deployed.');
  need(env.ETLINK_TRANSACTIONAL_EMAIL_SEND_APPROVED!=='true'&&env.ETLINK_NOTIFICATIONS_ENABLED!=='true','Optional transactional mail remains disabled for this release.');
  for (const [name,value] of Object.entries(env)) if (name.startsWith('NEXT_PUBLIC_')) {
    let privileged = /^(?:sb_secret_|re_)/.test(value||'');
    if (value?.startsWith('eyJ')) {
      try { privileged ||= JSON.parse(Buffer.from(value.split('.')[1],'base64url')).role==='service_role'; }
      catch { privileged=true; }
    }
    need(!privileged,'Privileged credential rejected in '+name+'.');
  }
  return {pass:failures.length===0, failures};
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve('scripts/check-marketplace-release-environment.mjs')) {
  const result = checkReleaseEnvironment(process.env);
  console.log(JSON.stringify({scope:'Offline configuration check; does not prove hosted controls or migration state',...result},null,2));
  if (!result.pass) process.exitCode=1;
}
