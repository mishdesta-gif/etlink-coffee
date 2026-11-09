import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database,asUser,ids,seedUsers } from './database.mjs';

test('scoped staff, invitation lifecycle, revoked membership and privileged delivery jobs',async t=>{
  const db=await database();await seedUsers(db);
  const sql=(s,p=[])=>db.query(s,p);const reject=async(s,p=[])=>assert.rejects(()=>sql(s,p));
  await asUser(db,ids.alice);const a=(await sql("select public.register_business('Synthetic A','Ethiopia','domestic_buyer','buyer','Synthetic domestic buyer information') as id")).rows[0].id;
  await asUser(db,ids.bob);const b=(await sql("select public.register_business('Synthetic B','Ethiopia','exporter','supplier','Synthetic Ethiopian exporter information') as id")).rows[0].id;
  await db.exec('reset role');await sql("insert into public.staff_grants(user_id,permission,business_id) values($1,'verification.review',$2),($3,'staff.manage',null)",[ids.reviewer,a,ids.manager]);
  await t.test('business-scoped staff cannot see or decide another tenant application',async()=>{
    await asUser(db,ids.reviewer,'aal2');const apps=(await sql('select * from public.capabilities')).rows;assert.equal(apps.length,1);assert.equal(apps[0].business_id,a);
    assert.equal((await sql("select public.has_permission('verification.review',$1) as p",[b])).rows[0].p,false);
    await db.exec('reset role');const c=(await sql('select id from public.capabilities where business_id=$1',[b])).rows[0].id;
    await asUser(db,ids.reviewer,'aal2');await reject("select public.review_capability($1,1,'under_review','Cross tenant decision',null)",[c]);
    await reject("select public.review_capability($1,1,'under_review',null,null)",[apps[0].id]);
  });
  await t.test('expired and revoked-inviter team invitations fail; staff requires MFA and independence',async()=>{
    await asUser(db,ids.alice);await sql("select public.create_invitation($1,'viewer@example.test','viewer',null,$2)",[a,'b'.repeat(64)]);
    await db.exec('reset role');await sql("update public.invitations set expires_at=now()-interval '1 second' where token_hash=$1",['b'.repeat(64)]);
    await asUser(db,ids.viewer);await reject('select public.accept_invitation($1)',['b'.repeat(64)]);
    await asUser(db,ids.manager,'aal2');await reject("select public.create_invitation(null,'manager@example.test',null,array['verification.review'],$1)",['c'.repeat(64)]);
    await sql("select public.create_invitation(null,'viewer@example.test',null,array['inquiry.manage'],$1)",['d'.repeat(64)]);
    await asUser(db,ids.viewer);await reject('select public.accept_invitation($1)',['d'.repeat(64)]);
    await asUser(db,ids.viewer,'aal2');await sql('select public.accept_invitation($1)',['d'.repeat(64)]);assert.equal((await sql("select public.has_permission('inquiry.manage') as p")).rows[0].p,true);
    await asUser(db,ids.manager,'aal2');await sql("select public.create_invitation(null,'support@example.test',null,array['inquiry.manage'],$1)",['e'.repeat(64)]);
    const grant=(await sql("select id from public.staff_grants where user_id=$1 and permission='inquiry.manage'",[ids.viewer])).rows[0].id;
    await sql('select public.revoke_staff($1)',[grant]);
    await asUser(db,ids.viewer,'aal2');assert.equal((await sql("select public.has_permission('inquiry.manage') as p")).rows[0].p,false);
    await db.exec('reset role');await sql("update public.staff_grants set revoked_at=now() where user_id=$1",[ids.manager]);
    await asUser(db,ids.support,'aal2');await reject('select public.accept_invitation($1)',['e'.repeat(64)]);
  });
  await t.test('all exposed Phase 1 tables use RLS and direct client writes are denied',async()=>{
    await db.exec('reset role');const tables=(await sql("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'")).rows;
    assert.deepEqual(tables.map(r=>r.relname).sort(),['profiles','businesses','memberships','capabilities','capability_history','staff_grants','invitations','documents','inquiries','inquiry_messages','notifications','notification_deliveries','audit_events'].sort());assert.ok(tables.every(r=>r.relrowsecurity));
    await asUser(db,ids.alice);
    for(const {relname} of tables){const permission=(await sql('select has_table_privilege(current_user,$1,\'INSERT\') as i,has_table_privilege(current_user,$1,\'UPDATE\') as u,has_table_privilege(current_user,$1,\'DELETE\') as d',[`public.${relname}`])).rows[0];assert.deepEqual(permission,{i:false,u:false,d:false});}
    await reject("select private.rate_limit('bypass',999,1)");await reject('select private.require_user()');
  });
  await t.test('delivery jobs disabled by default and callable only by service role',async()=>{
    await asUser(db,ids.alice);await reject('select * from public.claim_notification_deliveries(10)');
    await asUser(db,null,'aal1','service_role');assert.equal((await sql('select * from public.claim_notification_deliveries(10)')).rows.length,0);
    await db.exec('reset role');await sql("update public.notification_deliveries set status='pending'");
    await asUser(db,null,'aal1','service_role');const jobs=(await sql('select * from public.claim_notification_deliveries(1)')).rows;assert.equal(jobs.length,1);
    const j=jobs[0];
    await reject('select public.finish_notification_delivery($1,$2,false,$3)',[j.delivery_id,j.lease_token,'Sensitive raw provider body']);
    await sql('select public.finish_notification_delivery($1,$2,false,$3)',[j.delivery_id,j.lease_token,'provider_unavailable']);
    await reject('select public.finish_notification_delivery($1,$2,true,null)',[j.delivery_id,j.lease_token]);
    await db.exec('reset role');const d=(await sql('select * from public.notification_deliveries where id=$1',[j.delivery_id])).rows[0];assert.equal(d.attempts,1);assert.equal(d.status,'failed');assert.ok(d.next_attempt_at);
    await sql("update public.notification_deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[j.delivery_id]);
    await asUser(db,null,'aal1','service_role');const retry=(await sql('select * from public.claim_notification_deliveries(50)')).rows.find(x=>x.delivery_id===j.delivery_id);assert.ok(retry);assert.notEqual(retry.lease_token,j.lease_token);
    await reject('select public.finish_notification_delivery($1,$2,true,null)',[j.delivery_id,j.lease_token]);
    await sql('select public.finish_notification_delivery($1,$2,true,null)',[retry.delivery_id,retry.lease_token]);
    await db.exec('reset role');assert.equal((await sql('select status from public.notification_deliveries where id=$1',[j.delivery_id])).rows[0].status,'sent');
  });
  await db.close();
});
