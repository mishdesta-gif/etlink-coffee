// Offline packaging only. No credentials, CLI execution or database connection.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const project = 'fzgnepvhwhvxukuyubzk';
export const sources = [
  ['202611030001_foundation.sql','20261104084707_phase1_foundation.sql','a4beed79e7f4d638d16a97ad96d86a9b75d62c698fd8c9402e4837855e64a957'],
  ['202611030002_notification_jobs.sql','20261104084755_phase1_notification_jobs.sql','3db47636d093b60473cb40ece6de45f5f6d668f9083cddab786d2d139749c7df'],
  ['202611030003_document_lifecycle.sql','20261104084759_phase1_document_lifecycle.sql','dd47de2cf6ada5afc7b092821628f9d16fcb4bbc46b00b292992356edef576cf'],
  ['202611030004_verification_history.sql','20261104084806_phase1_verification_history.sql','889dcea742978940ece76539dd3f8699fb966fbdd7a77b32eec8c655eee56203'],
  ['20261104100651_phase1_auth_compatibility.sql','20261104120816_phase1_auth_compatibility.sql','6f0eb49ac9afa0c1706f4bc8305ba5fc9daa610add42a857b43e770ce0ebea17'],
  ['20261109160000_phase1_scoped_staff_grants.sql','20261109160000_phase1_scoped_staff_grants.sql','cc15de38bf5f2c826716212db347f57c79d4b291a21b3a1575a851a84f8f0c72'],
  ['20261104210204_phase2_private_requests_lots.sql','20261104210204_phase2_private_requests_lots.sql','10f4b781213d8e2d8c807181c546587b6967dc11a197762149e7932acae05266'],
  ['20261104214339_phase2_matching_private_offers.sql','20261104214339_phase2_matching_private_offers.sql','2a3aa19635bd8211f4ba5f53211707381afdd7731e1ad76ca43be34d8846f64d'],
  ['20261111161526_phase2_marketplace_fulfillment.sql','20261111161526_phase2_marketplace_fulfillment.sql','a5471fc030d61a0d3227d45c23ee9be57bd11aca0570cd28e94225f4abd7f170'],
];
export function verifySources() {
  return sources.map(([source, filename, sha256], index) => {
    const bytes = fs.readFileSync(path.join('supabase/migrations',source));
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Reviewed migration changed: '+source);
    return {source, filename, sha256, bytes:bytes.length, state:index<6?'applied':'pending'};
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/prepare-marketplace-staging-release.mjs')) {
  const migrations = verifySources();
  const workdir = path.join('out','marketplace-staging-release-'+randomUUID());
  const directory = path.join(workdir,'supabase','migrations');
  fs.mkdirSync(directory,{recursive:true});
  for (const migration of migrations) fs.copyFileSync(path.join('supabase/migrations',migration.source),path.join(directory,migration.filename),fs.constants.COPYFILE_EXCL);
  const manifest = {project, name:'etlink-coffee-staging', cli:'3.0.0', workdir, migrations, applicationOrder:migrations.filter(m=>m.state==='pending').map(m=>m.filename), includeAllRequired:true, skipVaultRequired:true, hostedChanges:false};
  fs.writeFileSync(path.join(workdir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(manifest,null,2));
}
