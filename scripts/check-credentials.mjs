// Offline scan. Never print matching values or source excerpts.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {parseEnv} from 'node:util';
const localEnvironment=fs.existsSync('.env.local')?parseEnv(fs.readFileSync('.env.local','utf8')):{};
const serverSecretNames=['ETLINK_STORAGE_VALIDATOR_SECRET_KEY','ETLINK_INGRESS_SECRET_KEY','ETLINK_EDGE_ASSERTION_SECRET','ETLINK_ABUSE_IDENTITY_SECRET','ETLINK_STAGING_TEST_SECRET_KEY','ETLINK_NOTIFICATION_WORKER_SECRET_KEY','ETLINK_EMAIL_PROVIDER_API_KEY'];
const serverSecrets=serverSecretNames.flatMap(name=>[process.env[name],localEnvironment[name]]).filter(value=>typeof value==='string'&&value.length>=12);
const findings=[];
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
const tracked=cp.execFileSync('git',['ls-files','--cached','-z']).toString().split('\0').filter(Boolean);
const trackedEnv=tracked.filter(p=>/(^|\/)\.env(?:\.|$)/.test(p)&&!p.endsWith('.env.example'));
for(const file of trackedEnv)findings.push({file,type:'tracked environment file'});
const patterns=[
  ['Supabase credential literal',/sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g],
  ['Resend credential literal',/\bre_[A-Za-z0-9]{24,}\b/g],
  ['private key material',/-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['database password URI',/postgres(?:ql)?:\/\/[^\s'"<>:]+:[^\s'"<>@]+@/g],
  ['AWS access key',/\bAKIA[A-Z0-9]{16}\b/g],
  ['JWT credential literal',/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];
for(const file of files){
  if(file.includes('baseline/')||!(/\.(?:ts|tsx|js|mjs|json|md|sql|ya?ml|txt)$/.test(file)||file.endsWith('.env.example')))continue;
  const source=fs.readFileSync(file,'utf8');
  for(const [type,pattern] of patterns){
    const hits=[...source.matchAll(pattern)].filter(m=>m[0]!=='sb_secret_synthetic_local_validator');
    if(hits.length)findings.push({file,type,count:hits.length});
  }
}
const environmentChecks=[];
for(const name of fs.readdirSync('.').filter(n=>n==='.env'||n.startsWith('.env.'))){
  if(!fs.statSync(name).isFile())continue;
  const ignored=cp.spawnSync('git',['check-ignore','--quiet',name]).status===0;
  environmentChecks.push({file:name,ignored,example:name==='.env.example'});
  if(name!=='.env.example'&&!ignored)findings.push({file:name,type:'unignored environment file'});
  for(const line of fs.readFileSync(name,'utf8').split(/\r?\n/)){
    const match=line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/);if(!match)continue;
    const value=match[2].replace(/^['"]|['"]$/g,'');let privileged=value.startsWith('sb_secret_');
    if(value.startsWith('eyJ')){try{privileged||=JSON.parse(Buffer.from(value.split('.')[1],'base64url')).role==='service_role';}catch{}}
    if(privileged)findings.push({file:name,type:'privileged credential in public variable',variable:match[1]});
  }
}
let clientFiles=0;
function scanClient(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())scanClient(file);else if(/\.(?:js|map|json)$/.test(file)){clientFiles++;const source=fs.readFileSync(file,'utf8');const values=['sb_secret_synthetic_local_validator',...serverSecrets];if(values.some(v=>source.includes(v)))findings.push({file,type:'server-only credential in browser artifact'});}}}
scanClient('.next/static');
const report={scope:'Offline heuristic scan; no matching credential values are printed',trackedEnvironmentFiles:trackedEnv,environmentChecks,browserArtifactsScanned:clientFiles,findings};
fs.mkdirSync('review',{recursive:true});
fs.writeFileSync('review/phase1-credential-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=1;
