import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database,asUser,seedUsers,ids,trustedInquiry } from './database.mjs';

const hash='a'.repeat(64);
async function business(db,user=ids.alice,name='SYNTHETIC hardening tenant') {
  await asUser(db,user);
  return (await db.query("select public.register_business($1,'Ethiopia','domestic_buyer','buyer','SYNTHETIC application for permanent security tests') as id",[name])).rows[0].id;
}
async function owner(db){await db.exec('reset role');}
async function service(db){await asUser(db,null,'aal1','service_role');}

test('hardening: future public/private definer functions and tables fail closed under Supabase defaults',async()=>{
  const db=await database();
  await db.exec(`
    create function public.future_public_probe() returns text language sql security definer set search_path='' as $$ select 'synthetic'::text $$;
    create function private.future_private_probe() returns text language sql security definer set search_path='' as $$ select 'synthetic'::text $$;
    create table public.future_table_probe(id bigint generated always as identity primary key);
  `);
  for(const role of ['anon','authenticated']){
    for(const fn of ['public.future_public_probe()','private.future_private_probe()'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,fn])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.future_table_probe','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_sequence_privilege($1,'public.future_table_probe_id_seq','USAGE,SELECT,UPDATE') as allowed",[role])).rows[0].allowed,false);
  }
  await asUser(db,null,'aal1','anon');await assert.rejects(()=>db.query('select public.future_public_probe()'));
  await asUser(db,ids.alice);await assert.rejects(()=>db.query('select private.future_private_probe()'));
  const functions=(await db.query("select n.nspname,p.proname,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef")).rows;
  assert.ok(functions.every(f=>f.proconfig?.includes('search_path=""')));
  assert.deepEqual(functions.filter(f=>f.anon_exec).map(f=>f.proname).sort(),[]);
  for(const fn of ['public.finalize_document(uuid,uuid,text,text,integer)','public.claim_notification_deliveries(integer)','public.authorize_notification_delivery(uuid,uuid)','private.notification_authorized(uuid,uuid,text)'])assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",[fn])).rows[0].allowed,false);
  await db.close();
});

test('hardening: inquiry/review revisions reject null, stale, future, invalid and unauthorized mutations',async()=>{
  const db=await database();await seedUsers(db);const b=await business(db);
  await owner(db);await db.query("insert into public.staff_grants(user_id,permission) values($1,'inquiry.manage'),($2,'verification.review')",[ids.support,ids.reviewer]);
  const cap=(await db.query('select id from public.capabilities where business_id=$1',[b])).rows[0].id;
  await asUser(db,null,'aal1','anon');const ref=(await trustedInquiry(db,"select public.submit_inquiry('general','Synthetic guest','hardening@example.test','Synthetic business','Ethiopia','SYNTHETIC inquiry revision regression','') as ref")).rows[0].ref;
  await asUser(db,ids.support,'aal2');const inquiry=(await db.query('select id from public.inquiries where reference=$1',[ref])).rows[0].id;
  const change=(v,status='in_review')=>db.query("select public.manage_inquiry($1,$2,$3,'normal',null,'Synthetic regression note',true)",[inquiry,v,status]);
  for(const v of [null,0,-1,2,2147483647,'1.5','1 OR 1=1'])await assert.rejects(()=>change(v));
  assert.equal((await db.query('select revision from public.inquiries where id=$1',[inquiry])).rows[0].revision,1);
  assert.equal((await db.query('select count(*)::int as n from public.inquiry_messages where inquiry_id=$1',[inquiry])).rows[0].n,0);
  await asUser(db,ids.alice);await assert.rejects(()=>change(1));
  await asUser(db,ids.support);await assert.rejects(()=>change(1));
  await asUser(db,ids.support,'aal2');await change(1);await assert.rejects(()=>change(1));
  const contenders=await Promise.allSettled([change(2),change(2)]);
  assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(contenders.filter(r=>r.status==='rejected').length,1);
  assert.equal((await db.query('select revision from public.inquiries where id=$1',[inquiry])).rows[0].revision,3);
  await asUser(db,ids.reviewer,'aal2');
  for(const v of [null,0,-1,2])await assert.rejects(()=>db.query("select public.review_capability($1,$2,'under_review','Synthetic explicit revision guard',null)",[cap,v]),e=>e.message.includes('Application changed'));
  assert.equal((await db.query('select revision from public.capabilities where id=$1',[cap])).rows[0].revision,1);
  await db.close();
});

test('hardening: stored metadata, uploader, tenant, hash, lifecycle and validator authority must all agree',async()=>{
  const db=await database();await seedUsers(db);const a=await business(db);const b=await business(db,ids.bob,'SYNTHETIC other tenant');
  const prepare=async()=>{await asUser(db,ids.alice);return (await db.query("select public.prepare_document($1,'Synthetic PDF','application/pdf',100,$2) as id",[a,hash])).rows[0].id;};
  const insert=async(i,metadata={mimetype:'application/pdf',size:100},u=ids.alice)=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('verification',$1,$2,$3)",[`${a}/${i}`,u,JSON.stringify(metadata)]);
  const finalize=(i,u=ids.alice,sha=hash,mime='application/pdf',size=100)=>db.query('select public.finalize_document($1,$2,$3,$4,$5)',[i,u,sha,mime,size]);
  const i=await prepare();await assert.rejects(()=>insert(i,{mimetype:'application/pdf',size:100},ids.bob));await insert(i);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await assert.rejects(()=>finalize(i)); // A correct end-user record still cannot self-attest.
  await asUser(db,ids.bob);await assert.rejects(()=>db.query("select public.prepare_document($1,'Cross tenant','application/pdf',100,$2)",[a,hash]));
  await service(db);for(const args of [[ids.bob,hash,'application/pdf',100],[ids.alice,null,'application/pdf',100],[ids.alice,'b'.repeat(64),'application/pdf',100],[ids.alice,hash,'image/jpeg',100],[ids.alice,hash,'application/pdf',101]])await assert.rejects(()=>finalize(i,...args));
  for(const metadata of [{mimetype:'image/jpeg',size:100},{mimetype:'application/pdf',size:8192},{mimetype:'application/pdf'},{}]){
    await owner(db);await db.query('update storage.objects set metadata=$2 where name=$1',[`${a}/${i}`,JSON.stringify(metadata)]);
    await service(db);await assert.rejects(()=>finalize(i));
  }
  await owner(db);await db.query("update storage.objects set metadata='{\"mimetype\":\"application/pdf\",\"size\":100}'::jsonb,owner_id=$2 where name=$1",[`${a}/${i}`,ids.bob]);
  await service(db);await assert.rejects(()=>finalize(i));
  await owner(db);await db.query('update storage.objects set owner_id=$2 where name=$1',[`${a}/${i}`,ids.alice]);await db.query('update businesses set archived_at=now() where id=$1',[a]);
  await service(db);await assert.rejects(()=>finalize(i));
  await owner(db);await db.query('update businesses set archived_at=null where id=$1',[a]);await db.query("update memberships set active=false where business_id=$1 and user_id=$2",[a,ids.alice]);
  await service(db);await assert.rejects(()=>finalize(i));
  await owner(db);await db.query("update memberships set active=true where business_id=$1 and user_id=$2",[a,ids.alice]);
  await db.query("update memberships set role='viewer' where business_id=$1 and user_id=$2",[a,ids.alice]);await service(db);await assert.rejects(()=>finalize(i));
  await owner(db);await db.query("update memberships set role='owner' where business_id=$1 and user_id=$2",[a,ids.alice]);
  await service(db);await finalize(i);await finalize(i); // Valid retries are idempotent.
  await asUser(db,ids.alice);assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  assert.equal((await db.query("update storage.objects set metadata='{}'::jsonb returning id")).rows.length,0);
  assert.equal((await db.query('select metadata from storage.objects')).rows[0].metadata.mimetype,'application/pdf');
  await asUser(db,ids.bob);assert.equal((await db.query('select * from storage.objects')).rows.length,0);assert.equal((await db.query('select * from documents where business_id=$1',[a])).rows.length,0);assert.ok(b);
  await db.close();
});

test('hardening: verification/inquiry notifications reauthorize grants, business scope and leased sends',async()=>{
  const db=await database();await seedUsers(db);const a=await business(db);const b=await business(db,ids.bob,'SYNTHETIC second business');
  await owner(db);await db.query("insert into public.staff_grants(user_id,permission,business_id) values($1,'verification.review',$2),($3,'inquiry.manage',null)",[ids.reviewer,a,ids.support]);
  await asUser(db,ids.alice);await db.query("select public.submit_capability($1,'buyer','SYNTHETIC changed evidence to notify scoped verifier')",[a]);
  await asUser(db,ids.reviewer);assert.equal((await db.query("select * from notifications where kind='verification_queue'")).rows.length,0);
  await asUser(db,ids.reviewer,'aal2');const note=(await db.query("select * from notifications where kind='verification_queue'")).rows[0];assert.equal(note.business_id,a);
  await owner(db);const delivery=(await db.query('select id from notification_deliveries where notification_id=$1',[note.id])).rows[0].id;await db.query("update notification_deliveries set status='pending' where id=$1",[delivery]);await db.query("update staff_grants set business_id=$2 where user_id=$1 and permission='verification.review'",[ids.reviewer,b]);
  await service(db);assert.equal((await db.query('select * from public.claim_notification_deliveries(50)')).rows.length,0);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from notifications where id=$1',[note.id])).rows.length,0);
  await owner(db);await db.query("update staff_grants set business_id=$2 where user_id=$1 and permission='verification.review'",[ids.reviewer,a]);
  await service(db);const job=(await db.query('select * from public.claim_notification_deliveries(50)')).rows[0];assert.equal(job.delivery_id,delivery);assert.equal((await db.query('select public.authorize_notification_delivery($1,$2) as allowed',[delivery,job.lease_token])).rows[0].allowed,true);
  await owner(db);await db.query("update staff_grants set revoked_at=now() where user_id=$1 and permission='verification.review'",[ids.reviewer]);
  await service(db);assert.equal((await db.query('select public.authorize_notification_delivery($1,$2) as allowed',[delivery,job.lease_token])).rows[0].allowed,false);await assert.rejects(()=>db.query('select public.finish_notification_delivery($1,$2,true,null)',[delivery,job.lease_token]));await db.query("select public.finish_notification_delivery($1,$2,false,'invalid_recipient')",[delivery,job.lease_token]);
  await asUser(db,null,'aal1','anon');await trustedInquiry(db,"select public.submit_inquiry('general','Synthetic guest','notify-hardening@example.test','Synthetic company','Ethiopia','SYNTHETIC inquiry queue notification','')");
  await owner(db);await db.query("update notification_deliveries d set status='pending' from notifications n where d.notification_id=n.id and n.kind='inquiry_queue'");await db.query("update staff_grants set revoked_at=now() where user_id=$1 and permission='inquiry.manage'",[ids.support]);
  await service(db);assert.equal((await db.query('select * from public.claim_notification_deliveries(50)')).rows.length,0);
  await asUser(db,ids.support,'aal2');assert.equal((await db.query("select * from notifications where kind='inquiry_queue'")).rows.length,0);
  await db.close();
});
