import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import {database,asUser,seedUsers,ids} from './database.mjs';
import {ingressIdentity,syntheticIngress,assertAuthProviderReady} from '../src/lib/foundation/ingress-policy.ts';

const setup=async()=>{const db=await database();await seedUsers(db);return db;};
const business=async(db,user=ids.alice,c='Ethiopia',k='domestic_buyer',cap='buyer')=>{
  await asUser(db,user);return (await db.query("select public.register_business('SYNTHETIC remediation business',$1,$2,$3,'SYNTHETIC evidence for local remediation') as id",[c,k,cap])).rows[0].id;
};
const owner=async db=>db.exec('reset role');

test('remediation: signed trusted edge identities reject spoofing, stale proofs and hosted test bypasses',()=>{
  const now=1800000000000;const edgeSecret='synthetic-edge-'.repeat(4);const identitySecret='synthetic-identity-'.repeat(4);
  const config={edgeSecret,identitySecret,authProtectionReviewed:'true'};
  const headers=new Headers({'x-etlink-client-ip':'192.0.2.8','x-etlink-edge-time':String(now)});
  headers.set('x-etlink-edge-signature',createHmac('sha256',edgeSecret).update(`${now}\n192.0.2.8`).digest('hex'));
  const id=ingressIdentity(headers,'inquiry',config,now);assert.match(id,/^[a-f0-9]{64}$/);
  headers.set('x-forwarded-for','192.0.2.9');assert.equal(ingressIdentity(headers,'inquiry',config,now),id);
  assert.doesNotThrow(()=>assertAuthProviderReady({authProtectionReviewed:'true'})); // No ingress key/edge prerequisite for login.
  assert.throws(()=>assertAuthProviderReady({authProtectionReviewed:'false'}));
  assert.throws(()=>ingressIdentity(headers,'inquiry',config,now+60001));
  headers.set('x-etlink-client-ip','192.0.2.9');assert.throws(()=>ingressIdentity(headers,'inquiry',config,now));
  assert.throws(()=>ingressIdentity(new Headers(),'inquiry',{},now));
  assert.equal(syntheticIngress({synthetic:'true',appUrl:'http://127.0.0.1:3102',supabaseUrl:'https://fzgnepvhwhvxukuyubzk.supabase.co'}),false);
  assert.equal(syntheticIngress({synthetic:'true',appUrl:'http://127.0.0.1:3102',supabaseUrl:'http://127.0.0.1:54329'}),true);
});

test('remediation: clients cannot spend quotas or bypass trusted inquiry ingress; reservations persist denials',async t=>{
  const db=await setup();t.after(()=>db.close());
  for(const [id,role] of [[null,'anon'],[ids.alice,'authenticated']]){
    await asUser(db,id,'aal1',role);
    await assert.rejects(()=>db.query('select public.guard_auth($1)',['a'.repeat(64)]));
    await assert.rejects(()=>db.query("select public.reserve_ingress_budget('auth',$1)",['a'.repeat(64)]));
    for(const fn of ['submit_inquiry','submit_trusted_inquiry'])await assert.rejects(()=>db.query(`select public.${fn}('general','Synthetic guest','guest@example.test','Synthetic business','Ethiopia','Synthetic message for isolated testing','')`));
  }
  await asUser(db,null,'aal1','service_role');
  await assert.rejects(()=>db.query("select public.reserve_ingress_budget('auth',$1)",['b'.repeat(64)]));
  const reserve=()=>db.query("select public.reserve_ingress_budget('inquiry',$1) as ok",['b'.repeat(64)]);
  for(let n=0;n<3;n++)assert.equal((await reserve()).rows[0].ok,true);
  for(let n=0;n<3;n++)assert.equal((await reserve()).rows[0].ok,false);
  assert.equal((await db.query("select public.reserve_ingress_budget('inquiry',$1) as ok",['c'.repeat(64)])).rows[0].ok,true);
  await assert.rejects(()=>db.query("select public.reserve_ingress_budget('auth',null)"));
  const inquiry=(args)=>db.query('select public.submit_trusted_inquiry($1,$2,$3,$4,$5,$6,$7,$8,$9) as ref',args);
  const input=['general','Synthetic guest','guest@example.test','Synthetic business','Ethiopia','Synthetic message for isolated testing','',null,null];
  assert.match((await inquiry(input)).rows[0].ref,/^INQ-/);
  for(const [index,value] of [[1,'bad\r\nname'],[2,'bad\r\n@example.test'],[5,'x'.repeat(4001)],[6,'spam'],[7,ids.alice]]){
    const bad=[...input];bad[index]=value;await assert.rejects(()=>inquiry(bad));
  }
  const signed=[...input];signed[7]=ids.alice;signed[8]=ids.alice;await inquiry(signed);
  await asUser(db,ids.alice);assert.equal((await db.query('select * from public.inquiries')).rows.length,1);
  await asUser(db,ids.bob);assert.equal((await db.query('select * from public.inquiries')).rows.length,0);
});

test('remediation: invitation archive, expiry, revoked inviter/recipient and wrong account fail closed',async t=>{
  const db=await setup();t.after(()=>db.close());const b=await business(db);
  const invite=async(hash)=>{await asUser(db,ids.alice);await db.query("select public.create_invitation($1,'viewer@example.test','viewer',null,$2)",[b,hash]);};
  const accept=async(hash)=>{await asUser(db,ids.viewer);return db.query('select public.accept_invitation($1)',[hash]);};
  await invite('1'.repeat(64));await owner(db);await db.query('update businesses set archived_at=now() where id=$1',[b]);await assert.rejects(()=>accept('1'.repeat(64)));
  await owner(db);await db.query('update businesses set archived_at=null where id=$1',[b]);
  await invite('2'.repeat(64));await owner(db);await db.query("update invitations set expires_at=now()-interval '1 second' where token_hash=$1",['2'.repeat(64)]);await assert.rejects(()=>accept('2'.repeat(64)));
  await invite('3'.repeat(64));await owner(db);await db.query('update memberships set active=false where business_id=$1 and user_id=$2',[b,ids.alice]);await assert.rejects(()=>accept('3'.repeat(64)));
  await owner(db);await db.query('update memberships set active=true where business_id=$1 and user_id=$2',[b,ids.alice]);await db.query("insert into memberships(business_id,user_id,role,active) values($1,$2,'viewer',false)",[b,ids.viewer]);
  await assert.rejects(()=>accept('3'.repeat(64)));await owner(db);assert.equal((await db.query('select accepted_at from invitations where token_hash=$1',['3'.repeat(64)])).rows[0].accepted_at,null);
  await asUser(db,ids.bob);await assert.rejects(()=>db.query('select public.accept_invitation($1)',['3'.repeat(64)]));
});

test('remediation: supplier country and archived verification enforced across every write boundary',async t=>{
  const db=await setup();t.after(()=>db.close());
  await assert.rejects(()=>business(db,ids.alice,'Germany','overseas_buyer','supplier'));
  const b=await business(db,ids.alice,'Ethiopia','overseas_buyer','supplier');
  await assert.rejects(()=>db.query("select public.update_business($1,'Synthetic changed country','Germany')",[b]));
  await owner(db);await assert.rejects(()=>db.query("update businesses set country='Germany' where id=$1",[b]));
  await db.query("insert into staff_grants(user_id,permission) values($1,'verification.review')",[ids.reviewer]);
  const cap=(await db.query('select id from capabilities where business_id=$1',[b])).rows[0].id;
  await db.query('update businesses set archived_at=now() where id=$1',[b]);
  await asUser(db,ids.reviewer,'aal2');await assert.rejects(()=>db.query("select public.review_capability($1,1,'under_review','Synthetic independent review',null)",[cap]));
  await owner(db);await db.query('update businesses set archived_at=null where id=$1',[b]);
  await asUser(db,ids.reviewer,'aal2');await db.query("select public.review_capability($1,1,'under_review','Synthetic independent review',null)",[cap]);
  await db.query("select public.review_capability($1,2,'approved','Synthetic independent approval',now()+interval '1 year')",[cap]);
  await asUser(db,ids.alice);assert.equal((await db.query('select public.entitlements($1) as e',[b])).rows[0].e.supplier_lot_eligible,true);
  await asUser(db,ids.bob);assert.equal((await db.query('select public.entitlements($1) as e',[b])).rows[0].e.supplier_lot_eligible,false);
});

test('remediation: revoked sessions, bans, expiry and current grants override stale aal2 claims',async t=>{
  const db=await setup();t.after(()=>db.close());const b=await business(db);
  await owner(db);await db.query("insert into staff_grants(user_id,permission) values($1,'verification.review')",[ids.reviewer]);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from capabilities')).rows.length,1);
  await owner(db);await db.query('delete from auth.sessions where id=$1',[ids.reviewer]);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from capabilities')).rows.length,0);
  await assert.rejects(()=>db.query("select public.save_profile('Stale session',true)"));
  await owner(db);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.reviewer]);await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ids.reviewer]);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query("select public.has_permission('verification.review') as p")).rows[0].p,false);
  await owner(db);await db.query('update auth.users set banned_until=null where id=$1',[ids.reviewer]);await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[ids.reviewer]);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from capabilities')).rows.length,0);
  await owner(db);await db.query('update auth.sessions set not_after=null where id=$1',[ids.reviewer]);await db.query('update staff_grants set revoked_at=now() where user_id=$1',[ids.reviewer]);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from capabilities')).rows.length,0);
  await owner(db);await db.query('update memberships set active=false where business_id=$1',[b]);
  await asUser(db,ids.alice);assert.equal((await db.query('select public.entitlements($1) as e',[b])).rows[0].e.buyer_request_eligible,false);
});

test('remediation: existing guarded owner, no application role or managed Auth changes, invoker entitlements',async t=>{
  const db=await setup();t.after(()=>db.close());
  assert.equal((await db.query("select exists(select 1 from pg_roles where rolname='etlink_executor') as exists")).rows[0].exists,false);
  const funcs=(await db.query("select p.proname,n.nspname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner,has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')")).rows;
  assert.ok(funcs.every(f=>f.owner==='postgres'&&f.proconfig.includes('search_path=""')));
  assert.equal(funcs.find(f=>f.proname==='entitlements').prosecdef,false);
  assert.ok(funcs.filter(f=>f.prosecdef).every(f=>!f.anon_exec));
  await db.exec('create function public.synthetic_future_default() returns int language sql set search_path=\'\' as $$select 1$$');
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.synthetic_future_default()','EXECUTE') as allowed",[role])).rows[0].allowed,false);
  const auth=(await db.query("select relname,relrowsecurity,pg_get_userbyid(relowner) as owner from pg_class where oid in ('auth.users'::regclass,'auth.sessions'::regclass)")).rows;
  assert.ok(auth.every(t=>t.relrowsecurity&&t.owner==='supabase_auth_admin'));
  assert.equal((await db.query("select count(*)::int as n from pg_policies where schemaname='auth'")).rows[0].n,0);
  for(const role of ['anon','authenticated']){
    await asUser(db,ids.alice,'aal1',role);
    await assert.rejects(()=>db.query('select id from auth.users'));
    await assert.rejects(()=>db.query('select id from auth.sessions'));
    await assert.rejects(()=>db.exec('create table public.forbidden_runtime_ddl(id int)'));
  }
  const sql=await fs.readFile('supabase/migrations/20261104100651_phase1_auth_compatibility.sql','utf8');
  assert.doesNotMatch(sql,/\bcreate\s+role\b|\bowner\s+to\b/i);
  assert.doesNotMatch(sql,/\b(?:grant|revoke)\b[^;]*\bon\s+(?:table\s+)?auth\./i);
  assert.doesNotMatch(sql,/\balter\s+(?:table|schema|function)\s+auth\./i);
  assert.doesNotMatch(sql,/\b(?:create|alter|drop)\s+policy\b[^;]*\bon\s+auth\./i);
  assert.doesNotMatch(sql,/\b(?:create|alter|drop)\s+policy\b[^;]*\bon\s+storage\./i);
  const active=(await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  // Phase 1's isolated bootstrap intentionally excludes the forward-only Phase 2 candidates.
  const foundation=active.filter(f=>!f.includes('_phase2_'));
  assert.deepEqual(foundation,['202611030001_foundation.sql','202611030002_notification_jobs.sql','202611030003_document_lifecycle.sql','202611030004_verification_history.sql','20261104100651_phase1_auth_compatibility.sql','20261109160000_phase1_scoped_staff_grants.sql']);
  assert.ok(!active.includes('20261104092218_phase1_security_remediation.sql'));
});

test('Auth restriction regression: archived role-transfer candidate fails under hosted Auth RLS',async t=>{
  const db=await database({remediation:false});t.after(()=>db.close());await seedUsers(db);
  await db.exec(await fs.readFile('tests/fixtures/superseded-phase1-role-transfer.sql','utf8'));
  await asUser(db,ids.alice,'aal1','etlink_executor');
  assert.equal((await db.query('select count(id)::int as n from auth.users')).rows[0].n,0);
  assert.equal((await db.query('select count(id)::int as n from auth.sessions')).rows[0].n,0);
  await asUser(db,ids.alice);
  assert.equal((await db.query('select private.active_user() as ok')).rows[0].ok,false);
  await assert.rejects(()=>db.query("select public.register_business('Synthetic should fail','Ethiopia','domestic_buyer','buyer','Synthetic regression proves provider mismatch')"),/Active confirmed session required/);
});
