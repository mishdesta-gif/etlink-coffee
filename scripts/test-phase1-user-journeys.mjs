// Local application only: isolated build, fake Auth/Storage and migrated local PostgreSQL.
// No .env file copied, no hosted target, no existing build/evidence overwritten.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const root=process.cwd(),run=randomUUID();
const reuse=process.argv.find(x=>x.startsWith('--reuse-build='))?.slice(14);
const evidence=path.join(root,'out','phase1-journeys-'+run);
const build=reuse?path.resolve(root,reuse):path.join(evidence,'build');
fs.mkdirSync(evidence);
if(reuse&&(!build.startsWith(path.join(root,'out','phase1-journeys-'))||!fs.existsSync(path.join(build,'.next','BUILD_ID'))))throw Error('Only prior isolated Phase 1 journey build may be reused');
const inputs=['src','public','next.config.ts','tsconfig.json','postcss.config.mjs','package.json','next-env.d.ts'];
if(!reuse){fs.mkdirSync(build);for(const name of inputs)if(fs.existsSync(name))fs.cpSync(name,path.join(build,name),{recursive:true,errorOnExist:true,force:false});fs.symlinkSync(path.join(root,'node_modules'),path.join(build,'node_modules'),'junction');}
else{
 const verify=relative=>{const original=path.join(root,relative),copy=path.join(build,relative);if(fs.statSync(original).isDirectory()){for(const name of fs.readdirSync(original))verify(path.join(relative,name));}else if(!fs.existsSync(copy)||!fs.readFileSync(original).equals(fs.readFileSync(copy)))throw Error('Stale isolated source snapshot');};
 for(const name of inputs.filter(x=>x!=='next-env.d.ts'))verify(name);
}
for(const [source,target]of [['tests/browser/public.spec.ts','01-public.spec.ts'],['tests/integration/workspace.spec.ts','02-workspace.spec.ts'],['tests/integration/phase1-journeys.spec.ts','03-phase1-journeys.spec.ts']]){
 fs.writeFileSync(path.join(evidence,target),fs.readFileSync(source,'utf8').replaceAll('review/phase1-',path.relative(root,evidence).replaceAll('\\','/')+'/phase1-'),{flag:'wx'});
}
const env={...process.env};
for(const key of Object.keys(env))if(/KEY|TOKEN|SECRET|PASS|SMTP|SUPABASE|ETLINK|DATABASE_URL/i.test(key))delete env[key];
if(fs.existsSync('.env.local'))for(const [,key]of fs.readFileSync('.env.local','utf8').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm))delete env[key];
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key-never-live',ETLINK_APP_URL:'http://127.0.0.1:3102',ETLINK_PHASE2_ENABLED:'false',ETLINK_PHASE2_FIXTURE:'false',ETLINK_PHASE1_JOURNEYS:'true',ETLINK_SYNTHETIC_TEST_MODE:'true',ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED:'true',ETLINK_STORAGE_VALIDATOR_SECRET_KEY:'sb_secret_synthetic_local_validator',ETLINK_INGRESS_SECRET_KEY:'sb_secret_synthetic_local_validator',ETLINK_NOTIFICATIONS_ENABLED:'false',ETLINK_TRANSACTIONAL_EMAIL_SEND_APPROVED:'false',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:''});
const results=[];
function execute(name,args,cwd,extra={}){
 const result=spawnSync(process.execPath,args,{cwd,env:{...env,...extra},stdio:'inherit',windowsHide:true,timeout:360000});
 results.push({name,exit:result.status,error:result.error?.code||null});
 if(result.status!==0)throw Error(name+' failed');
}
let passed=false;
try{
 if(!reuse)execute('isolated fake-only build',[path.join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],build);
 for(const mode of ['configured','unconfigured']){
  const configuration={testDir:evidence,testMatch:mode==='configured'?['01-public.spec.ts','02-workspace.spec.ts','03-phase1-journeys.spec.ts']:['01-public.spec.ts'],workers:1,timeout:90000,outputDir:path.join(evidence,'results-'+mode),reporter:[['list'],['json',{outputFile:path.join(evidence,mode+'.json')}]],use:{baseURL:'http://127.0.0.1:3102',channel:process.env.CI?'chromium':'msedge',headless:true,trace:'off',screenshot:'off',actionTimeout:15000},webServer:[...(mode==='configured'?[{command:'node tests/fixture-server.mjs',cwd:root,url:'http://127.0.0.1:54329/_fixture/health',reuseExistingServer:false}]:[]),{command:'npm run start -- --hostname 127.0.0.1 --port 3102',cwd:build,url:'http://127.0.0.1:3102',reuseExistingServer:false}]};
  const configFile=path.join(evidence,mode+'.mjs');fs.writeFileSync(configFile,"import {defineConfig} from '@playwright/test';export default defineConfig("+JSON.stringify(configuration)+');\n',{flag:'wx'});
  execute(mode+' browser journeys',[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',configFile,mode==='configured'?'--grep-invert':'--grep','account screens fail closed'],root,{ETLINK_APP_URL:mode==='configured'?'http://127.0.0.1:3102':''});
 }
 passed=true;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 const manifest=[];function hashInputs(relative){const p=path.join(root,relative);if(fs.statSync(p).isDirectory()){for(const name of fs.readdirSync(p))hashInputs(path.join(relative,name));}else manifest.push({file:relative,sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}
 for(const name of inputs)hashInputs(name);
 fs.writeFileSync(path.join(evidence,'summary.json'),JSON.stringify({run,scope:'Local fake-only application journeys; original Phase 1 migrations only; no hosted calls',buildDirectory:path.relative(root,build),evidenceDirectory:path.relative(root,evidence),results,passed,realCredentialsUsed:false,transactionalEmailEnabled:false,tradingEnabled:false,inputs:manifest},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({run,evidenceDirectory:path.relative(root,evidence),buildDirectory:path.relative(root,build),results,passed}));
}
