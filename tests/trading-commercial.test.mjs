import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {tradingDatabase,seedTrading,tradeInput,asUser,ids} from './trading-database.mjs';
export const quote={origin:'Guji',grade:'1',process:'washed',quantity_kg:'1000',price:'7',currency:'USD',incoterm:'FOB'};
test('Phase 2 confidential trading, commissions and immutable offer progression',async t=>{
 const db=await tradingDatabase();try{
 const {buyer,supplier}=await seedTrading(db,{approveBuyer:true});const req=randomUUID(),lot=randomUUID(),off=randomUUID();let match,terms;
 const until=new Date(Date.now()+86400000).toISOString(),from=new Date(Date.now()-60000).toISOString();
 const issue=(v=0,p=quote)=>db.query('select issue_trade_offer($1,$2,$3,$4,$5,$6)',[match,buyer,off,v,p,until]);
 await asUser(db,ids.alice);await db.query("select save_trade_record('request',$1,$2,0,$3,'submitted')",[buyer,req,tradeInput()]);await asUser(db,ids.bob);await db.query("select save_trade_record('lot',$1,$2,0,$3,'submitted')",[supplier,lot,tradeInput({quantity:'200'})]);
 await asUser(db,ids.reviewer,'aal2');for(const [d,i,s]of [['request',req,'qualified'],['lot',lot,'approved']]){await db.query('select review_trade_record($1,$2,1,$3,$4)',[d,i,'in_review','Synthetic review started']);await db.query('select review_trade_record($1,$2,2,$3,$4)',[d,i,s,'Synthetic eligible record']);}
 await t.test('Only independent MFA matching officer approves compatible current revisions',async()=>{
  await asUser(db,ids.alice);await assert.rejects(()=>db.query('select approve_trade_match($1,3,$2,3,$3)',[req,lot,'Synthetic manual selection']));
  await asUser(db,ids.reviewer);await assert.rejects(()=>db.query('select approve_trade_match($1,3,$2,3,$3)',[req,lot,'Synthetic manual selection']));
  await asUser(db,ids.reviewer,'aal2');await assert.rejects(()=>db.query('select approve_trade_match($1,null,$2,3,$3)',[req,lot,'Synthetic stale selection']));
  match=(await db.query('select approve_trade_match($1,3,$2,3,$3) as id',[req,lot,'Synthetic compatible origin/process/grade/quantity'])).rows[0].id;
 });
 await t.test('Issuance blocked until exact current payer terms accepted',async()=>{
  await assert.rejects(()=>issue(),/commission terms/);
  terms=(await db.query("select create_commission_terms($1,$2,'percentage',5,'USD','signed_sale_contract',$3,$4) as id",[match,buyer,from,until])).rows[0].id;
  await assert.rejects(()=>issue(),/commission terms/);await asUser(db,ids.bob);await assert.rejects(()=>db.query('select accept_commission_terms($1)',[terms]));
  await asUser(db,ids.alice);await db.query('select accept_commission_terms($1)',[terms]);await asUser(db,ids.reviewer,'aal2');
  await assert.rejects(()=>issue(0,{...quote,supplier_business_id:supplier}),/unsupported quote field/);await assert.rejects(()=>issue(0,{...quote,origin:'Sidama'}),/differs from approved lot/);await issue();
 });
 await t.test('Recipient projection has no counterparty graph, raw prices or private terms of others',async()=>{
  await asUser(db,ids.alice);const data=(await db.query('select my_trading_commercial($1) as data',[buyer])).rows[0].data;assert.equal(data.offers.length,1);assert.equal(data.commissions[0].accepted,true);assert.equal(data.offers[0].payload.price,'7');
  for(const hidden of [supplier,match,req,lot,'Synthetic supplier secret identity','asking_price','supplier_business_id','match_id','commission_snapshot'])assert(!JSON.stringify(data).includes(hidden));
  await assert.rejects(()=>db.query('select * from private.trade_matches'));await assert.rejects(()=>db.query('select my_trading_commercial($1)',[supplier]));
  await asUser(db,ids.bob);assert.equal((await db.query('select my_trading_commercial($1) as d',[supplier])).rows[0].d.offers.length,0);
 });
 await t.test('Interest/counterproposal are immutable staff-mediated responses, no allocation or deal',async()=>{
  await asUser(db,ids.alice);const responseId=randomUUID();await db.query("select respond_trade_offer($1,1,'counter',$2,$3)",[off,{...quote,price:'6'},responseId]);await db.query("select respond_trade_offer($1,1,'counter',$2,$3)",[off,{...quote,price:'6'},responseId]);
  await asUser(db,ids.reviewer,'aal2');const admin=(await db.query('select admin_trading_commercial() as d')).rows[0].d;assert.equal(admin.responses.length,1);assert.equal(admin.responses[0].counter_payload.price,'6');await issue(1,{...quote,price:'6.5'});
  await db.exec('reset role');await assert.rejects(()=>db.query("update private.trade_offer_versions set payload='{}'"),/append-only/);assert.equal((await db.query("select tablename from pg_tables where tablename in ('allocations','reservations','deals','invoices')")).rows.length,0);
  await asUser(db,ids.alice);await assert.rejects(()=>db.query("select respond_trade_offer($1,1,'interested',null,$2)",[off,randomUUID()]),/changed/);
 });
 await t.test('Commission re-version invalidates prior quote snapshot even after new acceptance',async()=>{
  await asUser(db,ids.reviewer,'aal2');const next=(await db.query("select create_commission_terms($1,$2,'fixed',20,'USD','confirmed_delivery',$3,$4) as id",[match,buyer,from,until])).rows[0].id;
  await asUser(db,ids.alice);assert.equal((await db.query('select my_trading_commercial($1) as d',[buyer])).rows[0].d.offers.length,0);await assert.rejects(()=>db.query('select accept_commission_terms($1)',[terms]),/changed/);await db.query('select accept_commission_terms($1)',[next]);await assert.rejects(()=>db.query("select respond_trade_offer($1,2,'interested',null,$2)",[off,randomUUID()]),/changed/);
  await asUser(db,ids.reviewer,'aal2');await issue(2);
 });
 await t.test('Revoked staff, buyer verification, source edits and current sessions rechecked',async()=>{
  await db.exec('reset role');await db.query("update staff_grants set revoked_at=now() where user_id=$1 and permission='trading.offers.issue'",[ids.reviewer]);await asUser(db,ids.reviewer,'aal2');await assert.rejects(()=>issue(3),/authority/);
  await db.exec('reset role');await db.query("update capabilities set status='suspended',revision=revision+1 where business_id=$1",[buyer]);await asUser(db,ids.alice);assert.equal((await db.query('select my_trading_commercial($1) as d',[buyer])).rows[0].d.offers.length,0);await assert.rejects(()=>db.query("select respond_trade_offer($1,3,'interested',null,$2)",[off,randomUUID()]),/recipient/);
  await db.exec('reset role');assert.equal((await db.query("select count(*) as n from notification_deliveries where status<>'disabled'")).rows[0].n,0);
  const raw=(await db.query('select message from notifications')).rows;assert(raw.every(x=>!x.message.includes('secret identity')));
 });
 }finally{await db.close();}
});
