import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('Netlify build fails before compilation with incomplete configuration and never echoes secret values',()=>{
 const marker='private-build-probe-do-not-display';
 const result=spawnSync(process.execPath,['scripts/build-netlify.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NEXT_PUBLIC_UNSAFE:'sb_secret_'+marker,ETLINK_STAGING_TEST_SECRET_KEY:marker}});
 assert.equal(result.status,1);assert.match(result.stderr,/Release configuration is incomplete/);assert(!result.stdout.includes(marker));assert(!result.stderr.includes(marker));
});
