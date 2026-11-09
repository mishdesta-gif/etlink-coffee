import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { database,asUser,ids,seedUsers,trustedInquiry } from './database.mjs';

test('Phase 1 database authorization and workflow acceptance',async t=>{
  const db=await database();await seedUsers(db);
  let a,b,cap,document;
  const sql=(s,p=[])=>db.query(s,p);
  const reject=async(s,p=[])=>assert.rejects(()=>sql(s,p));
  await t.test('confirmed registration creates owner and isolated capabilities; no automatic staff grant',async()=>{
    await asUser(db,ids.unconfirmed);await reject("select public.register_business('Blocked buyer','Ethiopia','domestic_buyer','buyer','Business registration details')");
    await asUser(db,ids.alice);a=(await sql("select public.register_business('Synthetic importer A','Germany','overseas_buyer','buyer','Synthetic importer seeking Guji coffee') as id")).rows[0].id;
    assert.equal((await sql('select role from public.memberships')).rows[0].role,'owner');
    assert.equal((await sql('select * from public.staff_grants')).rows.length,0);
    await asUser(db,ids.bob);b=(await sql("select public.register_business('Synthetic supplier B','Ethiopia','exporter','supplier','Synthetic supplier onboarding details') as id")).rows[0].id;
    assert.equal((await sql('select id from public.businesses')).rows.length,1);
    assert.equal((await sql('select * from public.capabilities where business_id=$1',[a])).rows.length,0);
    await reject("insert into public.memberships(business_id,user_id,role) values($1,$2,'owner')",[a,ids.bob]);
    await reject("update public.capabilities set status='approved' where business_id=$1",[b]);
  });
  await t.test('unverified buyer entitlement, supplier gating and legal trading remain explicit',async()=>{
    await asUser(db,ids.alice);const ent=(await sql('select public.entitlements($1) as e',[a])).rows[0].e;
    assert.equal(ent.buyer_request_eligible,true);assert.equal(ent.buyer_restricted_eligible,false);assert.equal(ent.trading_enabled,false);assert.equal(ent.exporter_to_exporter_cleared,false);
    await asUser(db,ids.bob);const supplier=(await sql('select public.entitlements($1) as e',[b])).rows[0].e;assert.equal(supplier.supplier_lot_eligible,false);
    assert.equal((await sql("select tablename from pg_tables where schemaname='public' and tablename in ('coffee_lots','buyer_requests','offers')")).rows.length,0);
  });
  await t.test('staff permissions require MFA and cannot be self-issued',async()=>{
    await reject("insert into public.staff_grants(user_id,permission) values($1,'staff.manage')",[ids.bob]);
    await reject("select public.create_invitation(null,'viewer@example.test',null,array['staff.manage'],$1)",['a'.repeat(64)]);
    await db.exec('reset role');await sql("insert into public.staff_grants(user_id,permission) values($1,'verification.review'),($2,'inquiry.manage'),($3,'staff.manage'),($3,'audit.read')",[ids.reviewer,ids.support,ids.manager]);
    await asUser(db,ids.reviewer);assert.equal((await sql('select * from public.capabilities')).rows.length,0);
    assert.equal((await sql("select public.has_permission('verification.review') as ok")).rows[0].ok,false);
    await asUser(db,ids.reviewer,'aal2');cap=(await sql('select * from public.capabilities where business_id=$1',[b])).rows[0];
    assert.ok(cap);
  });
  await t.test('review transitions, stale decision prevention, expiration, suspension, no self-approval',async()=>{
    await reject("select public.review_capability($1,1,'approved','Reviewed supporting evidence',now()+interval '1 year')",[cap.id]);
    await sql("select public.review_capability($1,1,'under_review','Beginning independent review',null)",[cap.id]);
    await reject("select public.review_capability($1,1,'approved','Reviewed supporting evidence',now()+interval '1 year')",[cap.id]);
    await reject("select public.review_capability($1,2,'approved','Reviewed supporting evidence',now()-interval '1 day')",[cap.id]);
    await sql("select public.review_capability($1,2,'approved','Reviewed supporting evidence',now()+interval '1 year')",[cap.id]);
    await asUser(db,ids.bob);assert.equal((await sql('select public.entitlements($1) as e',[b])).rows[0].e.supplier_lot_eligible,true);
    await asUser(db,ids.reviewer,'aal2');await sql("select public.review_capability($1,3,'suspended','Verification revoked pending review',null)",[cap.id]);
    await asUser(db,ids.bob);assert.equal((await sql('select public.entitlements($1) as e',[b])).rows[0].e.supplier_lot_eligible,false);
    await reject("select public.submit_capability($1,'supplier','Attempt to bypass suspension')",[b]);
    await db.exec('reset role');await sql("insert into public.staff_grants(user_id,permission) values($1,'verification.review')",[ids.bob]);
    await asUser(db,ids.bob,'aal2');await reject("select public.review_capability($1,4,'under_review','Attempt own business approval',null)",[cap.id]);
    await db.exec('reset role');await sql("update public.capabilities set status='approved',expires_at=now()-interval '1 day',revision=revision+1 where id=$1",[cap.id]);
    await asUser(db,ids.bob);assert.equal((await sql('select public.entitlements($1) as e',[b])).rows[0].e.supplier_lot_eligible,false);
  });
  await t.test('cross-business RPCs and storage reads fail; document policies isolate objects',async()=>{
    await asUser(db,ids.alice);document=(await sql("select public.prepare_document($1,'Synthetic license','application/pdf',100,$2) as id",[a,'f'.repeat(64)])).rows[0].id;
    await sql("insert into storage.objects(bucket_id,name,owner_id,metadata) values('verification',$1,$2,'{\"mimetype\":\"application/pdf\",\"size\":100}'::jsonb)",[`${a}/${document}`,ids.alice]);
    assert.equal((await sql('select * from storage.objects')).rows.length,0);
    await reject('select public.finalize_document($1,$2,$3,$4,$5)',[document,ids.alice,'f'.repeat(64),'application/pdf',100]);
    await asUser(db,null,'aal1','service_role');await sql('select public.finalize_document($1,$2,$3,$4,$5)',[document,ids.alice,'f'.repeat(64),'application/pdf',100]);await asUser(db,ids.alice);
    await reject("insert into storage.objects(bucket_id,name) values('verification','unregistered/path')");
    await asUser(db,ids.bob);assert.equal((await sql('select * from public.documents where business_id=$1',[a])).rows.length,0);assert.equal((await sql('select * from storage.objects')).rows.length,0);
    await reject("select public.prepare_document($1,'Stolen doc','application/pdf',100,$2)",[a,'f'.repeat(64)]);
    await reject("select public.update_business($1,'Hijacked name','Germany')",[a]);
    await reject("select public.submit_capability($1,'supplier','Unauthorized capability application')",[a]);
    await asUser(db,ids.reviewer,'aal2');assert.equal((await sql('select * from storage.objects')).rows.length,1);
    await asUser(db,ids.support,'aal2');assert.equal((await sql('select * from storage.objects')).rows.length,0);
    await db.exec('reset role');assert.equal((await sql('select * from storage.buckets where public')).rows.length,0);
  });
  await t.test('team invitations bind confirmed email, expire and are single use; viewers cannot mutate',async()=>{
    await asUser(db,ids.alice);const hash=createHash('sha256').update('synthetic token').digest('hex');
    await sql("select public.create_invitation($1,'viewer@example.test','viewer',null,$2)",[a,hash]);
    await reject('select token_hash from public.invitations');
    await asUser(db,ids.bob);await reject('select public.accept_invitation($1)',[hash]);
    await asUser(db,ids.viewer);await sql('select public.accept_invitation($1)',[hash]);await reject('select public.accept_invitation($1)',[hash]);
    assert.equal((await sql('select * from public.businesses')).rows.length,1);
    await reject("select public.prepare_document($1,'No permission','application/pdf',100,$2)",[a,'f'.repeat(64)]);
    await reject("select public.submit_capability($1,'supplier','Viewer cannot submit capability')",[a]);
    await reject("select public.set_member($1,$2,'admin',true)",[a,ids.viewer]);
    await asUser(db,ids.alice);await reject("select public.set_member($1,$2,'viewer',false)",[a,ids.alice]);
    await sql("select public.set_member($1,$2,'viewer',false)",[a,ids.viewer]);
    await asUser(db,ids.viewer);assert.equal((await sql('select * from public.businesses')).rows.length,0);assert.equal((await sql('select * from storage.objects')).rows.length,0);
  });
  await t.test('guest inquiry intake, anti-spam, assignment, immutable notes, support scope',async()=>{
    await asUser(db,null,'aal1','anon');
    await assert.rejects(()=>trustedInquiry(db,"select public.submit_inquiry('general','Guest','guest@example.test','Synthetic business','Ethiopia','A sufficiently long synthetic inquiry','spam')"));
    const ref=(await trustedInquiry(db,"select public.submit_inquiry('exporter_to_exporter','Guest','guest@example.test','Synthetic exporter','Ethiopia','Synthetic inquiry requires legal eligibility review','') as ref")).rows[0].ref;assert.match(ref,/^INQ-/);
    await reject('select * from public.inquiries');
    // Direct legacy intake is now denied even with a valid payload.
    await reject("select public.submit_inquiry('general','Guest','guest@example.test','Synthetic business','Ethiopia','A sufficiently long synthetic inquiry','')");
    await asUser(db,ids.reviewer,'aal2');assert.equal((await sql('select * from public.inquiries')).rows.length,0);
    await asUser(db,ids.support,'aal2');const q=(await sql('select * from public.inquiries where reference=$1',[ref])).rows[0];
    await sql("select public.manage_inquiry($1,1,'in_review','high',$2,'Internal triage note',true)",[q.id,ids.support]);
    await reject("select public.manage_inquiry($1,1,'resolved','normal',null,'Stale write',true)",[q.id]);
    await reject("select public.manage_inquiry($1,2,'resolved','normal',$2,'Unauthorized assignee',true)",[q.id,ids.alice]);
    await reject("select public.manage_inquiry($1,2,'resolved','normal',null,'External guest reply blocked',false)",[q.id]);
    await reject("update public.inquiry_messages set body='Rewritten'");
    await asUser(db,ids.alice);assert.equal((await sql('select * from public.inquiry_messages')).rows.length,0);
  });
  await t.test('notification confidentiality, recipient isolation, delivery records and read protection',async()=>{
    await asUser(db,ids.alice);const notes=(await sql('select * from public.notifications')).rows;assert.ok(notes.length);
    for(const n of notes){assert.equal(n.recipient_id,ids.alice);assert.ok(!n.message.includes('Synthetic'));}
    assert.equal((await sql('select * from public.notification_deliveries')).rows.length,notes.length);
    assert.ok((await sql('select * from public.notification_deliveries')).rows.every(d=>d.status==='disabled'));
    const id=notes[0].id;await asUser(db,ids.bob);await sql('select public.mark_notification($1)',[id]);
    await asUser(db,ids.alice);assert.equal((await sql('select read_at from public.notifications where id=$1',[id])).rows[0].read_at,null);
    await sql('select public.mark_notification($1)',[id]);assert.ok((await sql('select read_at from public.notifications where id=$1',[id])).rows[0].read_at);
    await reject("insert into public.notifications(recipient_id,event_key,kind,message) values($1,'fake','fake','Fake notification')",[ids.bob]);
  });
  await t.test('audit records append only, scoped, and stripped of confidential content',async()=>{
    await asUser(db,ids.alice);assert.equal((await sql('select * from public.audit_events')).rows.length,0);
    await asUser(db,ids.manager,'aal2');const events=(await sql('select * from public.audit_events')).rows;assert.ok(events.some(e=>e.action==='capabilities.update'));assert.ok(events.some(e=>e.action==='inquiries.update'));
    await asUser(db,ids.bob);const history=(await sql('select * from public.capability_history where capability_id=$1 order by revision',[cap.id])).rows;assert.ok(history.some(h=>h.status==='approved'&&h.expires_at));assert.ok(history.some(h=>h.status==='suspended'&&h.revoked_at));await reject("update public.capability_history set details='Rewritten evidence'");
    await asUser(db,ids.manager,'aal2');
    assert.ok(!JSON.stringify(events).includes('guest@example.test'));assert.ok(!JSON.stringify(events).includes('Synthetic importer seeking'));
    await reject("update public.audit_events set reason='Tampered'");await reject('delete from public.audit_events');
    await db.exec('reset role');await reject("update public.audit_events set reason='Tampered'");
  });
  await db.close();
});
