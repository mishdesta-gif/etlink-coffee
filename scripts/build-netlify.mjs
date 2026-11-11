// Build only. This command cannot create a site, upload a deploy or change DNS.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {checkReleaseEnvironment} from './check-marketplace-release-environment.mjs';
const result=checkReleaseEnvironment(process.env);
if(!result.pass){
 console.error('Release configuration is incomplete. Values are withheld.');
 for(const failure of result.failures)console.error(failure);
 process.exitCode=1;
}else{
 console.log('PASS: Canonical origin, real Supabase target, disabled fixtures and server credential boundaries.');
 const build=spawnSync(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'build','--webpack'],{stdio:'inherit',windowsHide:true});
 process.exitCode=build.status??1;
}
