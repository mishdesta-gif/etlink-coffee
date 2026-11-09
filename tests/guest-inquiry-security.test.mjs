import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {ingressIdentity} from '../src/lib/foundation/ingress-policy.ts';
const input=['general','Synthetic Phase 1 visitor','synthetic-general@example.invalid','SYNTHETIC-INQ-GEN-01','Ethiopia','SYNTHETIC Phase 1 inquiry validation only; no commercial request or confidential information.','',null,null];
async function setup(){const db=await database();for(const [name,id]of Object.entries(ids).filter(([,id])=>[ids.alice,ids.bob,ids.reviewer,ids.support].includes(id))){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${name}@example.test`]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[id]);}return db;}
const submit=(db,args=input)=>db.query('select public.submit_trusted_inquiry($1,$2,$3,$4,$5,$6,$7,$8,$9) as reference',args);
test('guest inquiry: signed ingress rejects forged, missing and stale proofs; forwarding headers cannot choose identity',()=>{
 const now=1800000000000,config={edgeSecret:'synthetic-edge-'.repeat(4),identitySecret:'synthetic-id-'.repeat(4),synthetic:'false',appUrl:'http://127.0.0.1:3104',supabaseUrl:'http://127.0.0.1:54329'};
 const proof=(ip,time)=>createHmac('sha256',config.edgeSecret).update(`${time}\n${ip}`).digest('hex');
 const good=new Headers({'x-etlink-client-ip':'127.0.0.1','x-etlink-edge-time':String(now),'x-etlink-edge-signature':proof('127.0.0.1',now)}),identity=ingressIdentity(good,'inquiry',config,now);
 good.set('x-forwarded-for','203.0.113.99');assert.equal(ingressIdentity(good,'inquiry',config,now),identity);
 for(const delta of [-60001,60001]){const h=new Headers(good);h.set('x-etlink-edge-time',String(now+delta));h.set('x-etlink-edge-signature',proof('127.0.0.1',now+delta));assert.throws(()=>ingressIdentity(h,'inquiry',config,now));}
 for(const [key,value]of [['x-etlink-client-ip','203.0.113.55'],['x-etlink-edge-signature','0'.repeat(64)],['x-etlink-edge-time','']]){const h=new Headers(good);h.set(key,value);assert.throws(()=>ingressIdentity(h,'inquiry',config,now));}
 assert.throws(()=>ingressIdentity(new Headers(),'inquiry',config,now));
});
test('guest inquiry: client RPC/table writes denied and committed budget cannot be reset by failed submissions',async t=>{
 const db=await setup();t.after(()=>db.close());
 for(const [id,role]of [[null,'anon'],[ids.alice,'authenticated']]){await asUser(db,id,'aal1',role);await assert.rejects(()=>submit(db));await assert.rejects(()=>db.query("select public.reserve_ingress_budget('inquiry',$1)",['a'.repeat(64)]));await assert.rejects(()=>db.query("select public.submit_inquiry('general','Synthetic guest','synthetic@example.invalid','Synthetic business','Ethiopia','Synthetic test input long enough','')"));await assert.rejects(()=>db.query("insert into public.inquiries(category,name,email,business_name,country,message) values('general','Synthetic guest','synthetic@example.invalid','Synthetic business','Ethiopia','Synthetic valid input but unauthorized client')"));}
 await asUser(db,null,'aal1','service_role');
 for(let i=0;i<3;i++){assert.equal((await db.query("select public.reserve_ingress_budget('inquiry',$1) as allowed",['b'.repeat(64)])).rows[0].allowed,true);const bad=[...input];bad[2]='not-an-email';await assert.rejects(()=>submit(db,bad));}
 assert.equal((await db.query("select public.reserve_ingress_budget('inquiry',$1) as allowed",['b'.repeat(64)])).rows[0].allowed,false);await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from public.inquiries')).rows[0].n,0);
});
test('guest inquiry: database revalidates malformed input, treats SQL/HTML as text, and gives distinct references',async t=>{
 const db=await setup();t.after(()=>db.close());await asUser(db,null,'aal1','service_role');
 for(const [index,value]of [[0,'invalid'],[1,'x'],[1,'bad\r\nname'],[2,'invalid-email'],[3,'x'],[4,'x'],[5,'short'],[5,'x'.repeat(4001)],[6,'bot'],[6,null],[1,null]]){const args=[...input];args[index]=value;await assert.rejects(()=>submit(db,args));}
 const text=[...input];text[5]="SYNTHETIC <script>alert('qa')</script> ' OR 1=1; -- treated only as text";const first=(await submit(db,text)).rows[0].reference,second=(await submit(db,text)).rows[0].reference;assert.match(first,/^INQ-[0-9a-f-]{36}$/);assert.notEqual(first,second);
 await db.exec('reset role');const rows=(await db.query('select user_id,message from public.inquiries')).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.user_id===null&&r.message===text[5]));
});
test('guest inquiry: only current MFA inquiry officer can read/triage; internal notes, revisions and audit stay protected',async t=>{
 const db=await setup();t.after(()=>db.close());await db.query("insert into public.staff_grants(user_id,permission) values($1,'inquiry.manage'),($2,'verification.review')",[ids.support,ids.reviewer]);await asUser(db,null,'aal1','service_role');await submit(db);await db.exec('reset role');const row=(await db.query('select id,reference from public.inquiries')).rows[0];
 for(const [id,aal]of [[ids.alice,'aal2'],[ids.bob,'aal2'],[ids.reviewer,'aal2'],[ids.support,'aal1']]){await asUser(db,id,aal);assert.equal((await db.query('select id from public.inquiries where id=$1',[row.id])).rows.length,0);}
 await asUser(db,null,'aal1','anon');await assert.rejects(()=>db.query('select id from public.inquiries'));
 await asUser(db,ids.support,'aal2');assert.equal((await db.query('select reference from public.inquiries')).rows[0].reference,row.reference);
 const update=(v,internal=true)=>db.query("select public.manage_inquiry($1,$2,'in_review','normal',null,'SYNTHETIC local triage note; no external communication.',$3)",[row.id,v,internal]);await assert.rejects(()=>update(null));await assert.rejects(()=>update(1,false));await update(1);await assert.rejects(()=>update(1));
 assert.equal((await db.query('select internal from public.inquiry_messages')).rows[0].internal,true);
 await db.exec('reset role');await db.query("update public.staff_grants set revoked_at=now() where user_id=$1 and permission='inquiry.manage'",[ids.support]);await asUser(db,ids.support,'aal2');assert.equal((await db.query('select id from public.inquiries')).rows.length,0);assert.equal((await db.query('select id from public.inquiry_messages')).rows.length,0);await assert.rejects(()=>update(2));
 await db.exec('reset role');const audits=(await db.query("select new_state from public.audit_events where action like 'inquir%'")).rows;assert.ok(audits.length>=3);assert.ok(audits.every(a=>!JSON.stringify(a).includes('synthetic-general@example.invalid')&&!JSON.stringify(a).includes('triage note')));await assert.rejects(()=>db.query('delete from public.audit_events'));assert.ok((await db.query('select status from public.notification_deliveries')).rows.every(r=>r.status==='disabled'));
});
