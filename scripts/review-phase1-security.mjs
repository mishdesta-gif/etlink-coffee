// Local-only review probes. No network, credentials, or live Supabase data.
// Models the public default grants actually observed on the staging database.
import fs from 'node:fs/promises';
import { database,asUser,ids,seedUsers,trustedInquiry } from '../tests/database.mjs';

const db=await database(); // One shared provider-restriction contract for all local harnesses.
await seedUsers(db);
const results=[];
const record=(id,description,expected,actual)=>results.push({id,description,expected,actual,status:expected===actual?'PASS':'FINDING'});
const sql=(s,p=[])=>db.query(s,p);

// Confirm present table and function grants despite Supabase's broader defaults.
await asUser(db,ids.alice);
const tables=(await sql("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows;
record('RLS','All 13 application tables enable RLS',true,tables.length===13&&tables.every(t=>t.relrowsecurity));
const writeChecks=await Promise.all(tables.map(t=>sql("select has_table_privilege('authenticated',$1,'INSERT') or has_table_privilege('authenticated',$1,'UPDATE') or has_table_privilege('authenticated',$1,'DELETE') as writes",[`public.${t.relname}`])));
record('DIRECT-WRITES','Client table writes denied under actual Supabase default-grant model',false,writeChecks.some(r=>r.rows[0].writes));
const workers=(await sql("select has_function_privilege('authenticated','public.claim_notification_deliveries(integer)','EXECUTE') or has_function_privilege('anon','public.claim_notification_deliveries(integer)','EXECUTE') as allowed")).rows[0].allowed;
record('WORKER-ACL','Clients cannot claim email jobs',false,workers);

await db.exec('reset role');
await db.exec("create function public.review_only_acl_probe() returns text language sql security definer set search_path='' as $$ select 'synthetic'::text $$");
record('DEFAULT-ACL','Future functions do not inherit anonymous execution',false,(await sql("select has_function_privilege('anon','public.review_only_acl_probe()','EXECUTE') as allowed")).rows[0].allowed);

await sql("insert into public.staff_grants(user_id,permission) values($1,'verification.review'),($2,'inquiry.manage')",[ids.reviewer,ids.support]);
await asUser(db,ids.alice);
const business=(await sql("select public.register_business('SYNTHETIC review business','Ethiopia','domestic_buyer','buyer','SYNTHETIC security review application') as id")).rows[0].id;
const capability=(await sql('select id from public.capabilities where business_id=$1',[business])).rows[0].id;
await asUser(db,ids.reviewer,'aal2');
let nullVersionAccepted=false;
try{await sql("select public.review_capability($1,null,'under_review','SYNTHETIC null revision review',null)",[capability]);nullVersionAccepted=true;}catch{}
record('REVIEW-VERSION','Review rejects a null expected revision',false,nullVersionAccepted);

await asUser(db,null,'aal1','anon');
const ref=(await trustedInquiry(db,"select public.submit_inquiry('general','Synthetic guest','review@example.test','Synthetic inquiry business','Ethiopia','SYNTHETIC inquiry for null revision review','') as ref")).rows[0].ref;
await asUser(db,ids.support,'aal2');
const inquiry=(await sql('select id from public.inquiries where reference=$1',[ref])).rows[0].id;
let nullInquiryAccepted=false;
try{await sql("select public.manage_inquiry($1,null,'in_review','normal',null,'SYNTHETIC null revision note',true)",[inquiry]);nullInquiryAccepted=true;}catch{}
record('INQUIRY-VERSION','Inquiry mutation rejects a null expected revision',false,nullInquiryAccepted);

await asUser(db,ids.alice);
const document=(await sql("select public.prepare_document($1,'SYNTHETIC declared PDF','application/pdf',100,$2) as id",[business,'f'.repeat(64)])).rows[0].id;
await sql("insert into storage.objects(bucket_id,name,owner_id,metadata) values('verification',$1,$2,'{\"mimetype\":\"image/jpeg\",\"size\":8192}'::jsonb)",[`${business}/${document}`,ids.alice]);
await asUser(db,null,'aal1','service_role');
let mismatchedUploadAccepted=false;
try{await sql('select public.finalize_document($1,$2,$3,$4,$5)',[document,ids.alice,'f'.repeat(64),'application/pdf',100]);mismatchedUploadAccepted=true;}catch{}
record('UPLOAD-BOUNDARY','Finalize rejects mismatched declared/upload metadata',false,mismatchedUploadAccepted);

// No external provider exists here: this probes only whether a revoked reviewer
// could still be selected as an email recipient when delivery is later enabled.
await db.exec('reset role');
const delivery=(await sql("select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.recipient_id=$1 and n.kind='verification_queue' limit 1",[ids.reviewer])).rows[0].id;
await sql("update public.notification_deliveries set status='pending' where id=$1",[delivery]);
await sql("update public.staff_grants set revoked_at=now() where user_id=$1 and permission='verification.review'",[ids.reviewer]);
await asUser(db,null,'aal1','service_role');
const jobs=(await sql('select * from public.claim_notification_deliveries(50)')).rows;
record('REVOKED-RECIPIENT','Email claim excludes a revoked verification officer',false,jobs.some(j=>j.recipient_id===ids.reviewer));

await db.close();
const report={environment:'Local in-memory PostgreSQL only; models observed staging default ACLs',reviewPhase:'after-local-hardening',results};
await fs.writeFile('review/phase1-staging-security-probes.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.status==='FINDING'))process.exitCode=1;
