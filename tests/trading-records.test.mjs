import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tradingDatabase,seedTrading,tradeInput,asUser,ids} from './trading-database.mjs';
test('Phase 2 requests/lots: guarded lifecycle, isolation and independent MFA review',async t=>{
 const db=await tradingDatabase();try{
 const {buyer,supplier}=await seedTrading(db,{approveSupplier:false});const request=randomUUID(),lot=randomUUID();
 const save=(d,b,i,v,p,s='submitted')=>db.query('select public.save_trade_record($1,$2,$3,$4,$5,$6)',[d,b,i,v,p,s]);
 await t.test('Unverified buyer submits unique request; approved supplier required even for lot draft',async()=>{
  await asUser(db,ids.alice);await save('request',buyer,request,0,tradeInput({price:''}));const rows=await db.query('select * from public.buyer_requests');assert.equal(rows.rows.length,1);assert.match(rows.rows[0].reference,/^REQ-/);assert.equal(rows.rows[0].payload.quantity_kg,1700);
  await save('request',buyer,request,0,tradeInput());assert.equal((await db.query('select * from public.buyer_requests')).rows.length,1);
  await asUser(db,ids.bob);await assert.rejects(()=>save('lot',supplier,lot,0,tradeInput(),'draft'),/capability or role/);
  await db.exec('reset role');await db.query("update capabilities set status='approved',reviewed_by=$2,expires_at='2099-12-31',revision=revision+1 where business_id=$1",[supplier,ids.reviewer]);
  await asUser(db,ids.bob);await save('lot',supplier,lot,0,tradeInput());assert.match((await db.query('select reference from coffee_lots')).rows[0].reference,/^LOT-/);
 });
 await t.test('Cross-tenant, viewer, anonymous and direct-write access denied',async()=>{
  await asUser(db,ids.alice);assert.equal((await db.query('select * from coffee_lots')).rows.length,0);await assert.rejects(()=>save('lot',supplier,lot,1,tradeInput()));await assert.rejects(()=>db.query("update buyer_requests set status='qualified'"));
  await db.exec('reset role');await db.query("insert into memberships(business_id,user_id,role) values($1,$2,'viewer')",[buyer,ids.viewer]);await asUser(db,ids.viewer);await assert.rejects(()=>save('request',buyer,randomUUID(),0,tradeInput()));
  await asUser(db,null,'aal1','anon');await assert.rejects(()=>db.query('select * from buyer_requests'));await assert.rejects(()=>save('request',buyer,randomUUID(),0,tradeInput()));
 });
 await t.test('Unsubmitted drafts and draft revision payloads are private to the business, not staff queues',async()=>{
  const draft=randomUUID();await asUser(db,ids.alice);await save('request',buyer,draft,0,tradeInput(),'draft');assert.equal((await db.query('select id from buyer_requests where id=$1',[draft])).rows.length,1);
  await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select id from buyer_requests where id=$1',[draft])).rows.length,0);assert.equal((await db.query('select id from trade_record_history where record_id=$1',[draft])).rows.length,0);
 });
 await t.test('Validation and optimistic revision reject null, invalid metadata and stale edits',async()=>{
  await asUser(db,ids.alice);for(const p of [tradeInput({quantity:'0'}),tradeInput({unit:'container'}),tradeInput({window_end:'2098-01-01'}),tradeInput({supplier_id:supplier}),tradeInput({process:null}),tradeInput({incoterm:'unsupported'})])await assert.rejects(()=>save('request',buyer,randomUUID(),0,p));
  await assert.rejects(()=>save('request',buyer,request,null,tradeInput()));await assert.rejects(()=>save('request',buyer,request,99,tradeInput()),/changed/);
 });
 await t.test('Reviewer must have MFA and independent scoped authority; legal clearance fail closed',async()=>{
  await asUser(db,ids.reviewer);await assert.rejects(()=>db.query("select review_trade_record('request',$1,1,'in_review','Synthetic independent review')",[request]),/MFA/);
  await asUser(db,ids.reviewer,'aal2');await db.query("select review_trade_record('request',$1,1,'in_review','Synthetic independent review')",[request]);await db.query("select review_trade_record('request',$1,2,'qualified','Synthetic request qualified')",[request]);
  await db.query("select review_trade_record('lot',$1,1,'in_review','Synthetic independent review')",[lot]);await db.query("select review_trade_record('lot',$1,2,'approved','Synthetic lot approved')",[lot]);
  await asUser(db,ids.alice);const legal=randomUUID();await save('request',buyer,legal,0,tradeInput({trade_type:'exporter_to_exporter'}));await asUser(db,ids.reviewer,'aal2');await db.query("select review_trade_record('request',$1,1,'in_review','Synthetic legal review')",[legal]);await assert.rejects(()=>db.query("select review_trade_record('request',$1,2,'qualified','Synthetic prohibited approval')",[legal]),/legal clearance/);
 });
 await t.test('Resubmission invalidates approval; immutable history and active grant/session revocation',async()=>{
  await asUser(db,ids.bob);await save('lot',supplier,lot,3,tradeInput({quantity:'90'}));assert.equal((await db.query('select status,revision from coffee_lots')).rows[0].status,'submitted');
  await assert.rejects(()=>db.query("update trade_record_history set status='approved'"));
  await db.exec('reset role');await db.query("update staff_grants set revoked_at=now() where user_id=$1",[ids.reviewer]);await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select * from buyer_requests')).rows.length,0);assert.equal((await db.query('select * from notifications')).rows.length,0);await assert.rejects(()=>db.query("select review_trade_record('lot',$1,4,'in_review','Synthetic revoked review')",[lot]));
  await db.exec('reset role');await db.query('delete from auth.sessions where user_id=$1',[ids.alice]);await asUser(db,ids.alice);assert.equal((await db.query('select * from buyer_requests')).rows.length,0);await assert.rejects(()=>save('request',buyer,randomUUID(),0,tradeInput()),/Active confirmed session/);
 });
 }finally{await db.close();}
});
