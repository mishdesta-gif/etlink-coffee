import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('actual staging runner selects a unique invitation role in the current application form without submitting',()=>{
 const result=spawnSync(process.execPath,['scripts/investigate-invitation-selector.mjs'],{encoding:'utf8',windowsHide:true,timeout:30000,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE}});
 assert.equal(result.status,0,'Offline invitation role regression failed');
 const evidence=JSON.parse(result.stdout);
 assert.equal(evidence.runnerLocatorCount,1);
 assert.equal(evidence.runnerLocatorMatches,1);
 assert.equal(evidence.runnerSelectedViewer,true);
 assert.equal(evidence.actionCalls,0);
 assert.equal(evidence.attemptedNetwork,0);
 assert.equal(evidence.formsSubmitted,0);
});
