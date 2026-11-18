import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tradingDatabase,seedTrading,tradeInput,asUser,ids} from './trading-database.mjs';
const migration=await fs.readFile('supabase/migrations/20261118142516_phase2_launch_safeguards.sql','utf8');

test('launch policy enforces supplier fees, payment milestones and archived-data isolation',async t=>{
 const db=await tradingDatabase();
 try {
  await db.exec(migration);
  const {buyer,supplier}=await seedTrading(db,{approveBuyer:true});
  const request=randomUUID(),lot=randomUUID();
  for(const [user,domain,business,id] of [[ids.alice,'request',buyer,request],[ids.bob,'lot',supplier,lot]]){
   await asUser(db,user);await db.query("select public.save_trade_record($1,$2,$3,0,$4,'submitted')",[domain,business,id,tradeInput({quantity:'1000',unit:'kg'})]);
   await asUser(db,ids.reviewer,'aal2');await db.query("select public.review_trade_record($1,$2,1,'in_review','Synthetic review started')",[domain,id]);
   await db.query('select public.review_trade_record($1,$2,2,$3,$4)',[domain,id,domain==='request'?'qualified':'approved','Synthetic reviewed source']);
  }
  const match=(await db.query('select public.approve_trade_match($1,3,$2,3,$3) id',[request,lot,'Synthetic manually approved match'])).rows[0].id;
  const starts=new Date(Date.now()-60000).toISOString(),expires=new Date(Date.now()+86400000).toISOString();
  const propose=(payer,calculation,amount)=>db.query("select public.create_commission_terms($1,$2,$3,$4,'USD','confirmed_delivery',$5,$6) id",[match,payer,calculation,amount,starts,expires]);
  let terms;
  await t.test('buyer fees, fixed fees, out-of-range rates and AAL1 are rejected',async()=>{
   await assert.rejects(propose(buyer,'percentage',1),{code:'42501'});
   for(const [calculation,rate] of [['fixed',1],['percentage',0.49],['percentage',2.01]])await assert.rejects(propose(supplier,calculation,rate));
   await asUser(db,ids.reviewer,'aal1');await assert.rejects(propose(supplier,'percentage',1),{code:'42501'});
   await asUser(db,ids.reviewer,'aal2');terms=(await propose(supplier,'percentage',1.5)).rows[0].id;
  });
  await asUser(db,ids.bob);await db.query('select public.accept_commission_terms($1)',[terms]);
  await asUser(db,ids.reviewer,'aal2');
  await assert.rejects(db.query('select public.issue_trade_offer($1,$2,$3,0,$4,$5)',[match,supplier,randomUUID(),{origin:'Guji',grade:'1',process:'washed',quantity_kg:'1000',price:'5',currency:'EUR',incoterm:'FOB'},expires]),/currency must match/);
  const quotes=[];
  for(const [business,user,price] of [[buyer,ids.alice,'7'],[supplier,ids.bob,'5']]){
   const id=randomUUID();await asUser(db,ids.reviewer,'aal2');
   await db.query('select public.issue_trade_offer($1,$2,$3,0,$4,$5)',[match,business,id,{origin:'Guji',grade:'1',process:'washed',quantity_kg:'1000',price,currency:'USD',incoterm:'FOB'},expires]);
   await asUser(db,user);await db.query("select public.respond_trade_offer($1,1,'interested',null,$2)",[id,randomUUID()]);quotes.push(id);
  }
  const sample=randomUUID(),allocation=randomUUID(),reservation=randomUUID(),deal=randomUUID();
  await asUser(db,ids.alice);await db.query('select public.request_coffee_sample($1,1,$2,300)',[quotes[0],sample]);
  await asUser(db,ids.reviewer,'aal2');await db.query("select public.update_coffee_sample($1,1,'dispatched','Synthetic carrier','Synthetic tracking')",[sample]);
  await asUser(db,ids.alice);await db.query("select public.update_coffee_sample($1,2,'received','','')",[sample]);await db.query("select public.update_coffee_sample($1,3,'accepted','','')",[sample]);
  await asUser(db,ids.reviewer,'aal2');await db.query('select public.allocate_coffee_stock($1,$2,$3,1000)',[match,sample,allocation]);await db.query('select public.reserve_coffee_stock($1,$2,$3)',[allocation,reservation,expires]);
  await db.query('select public.create_coffee_deal($1,$2,1,$3,1,$4)',[reservation,quotes[0],quotes[1],deal]);
  for(const [user,business] of [[ids.alice,buyer],[ids.bob,supplier]]){await asUser(db,user);await db.query("select public.confirm_coffee_deal($1,$2,'terms')",[deal,business]);}
  const advance=async(v,status)=>{await asUser(db,ids.reviewer,'aal2');return db.query('select public.advance_coffee_deal($1,$2,$3,$4)',[deal,v,status,'Synthetic evidence']);};
  await advance(1,'confirmed');await advance(2,'contract_signed');
  const milestone=(id,name,payment='Synthetic supplier payment',exported='')=>db.query('select public.record_supplier_payment_milestone($1,$2,$3,$4,$5)',[deal,id,name,payment,exported]);
  let fee;
  await t.test('signing earns no scheduled commission; first supplier payment unlocks only 30%',async()=>{
   assert.equal((await db.query('select public.admin_marketplace_operations() data')).rows[0].data.fees.length,0);
   await asUser(db,ids.alice);await assert.rejects(milestone(randomUUID(),'supplier_first_payment'),{code:'42501'});
   await asUser(db,ids.reviewer,'aal2');const first=randomUUID();await milestone(first,'supplier_first_payment');await milestone(first,'supplier_first_payment');
   fee=(await db.query('select public.admin_marketplace_operations() data')).rows[0].data.fees[0];
   assert.equal(fee.amount,'75.000000');assert.equal(fee.payable,'22.500000');
   await assert.rejects(db.query('select public.record_commission_receipt($1,$2,23,$3)',[fee.id,randomUUID(),'Synthetic too early']),/exceeds outstanding/);
   await db.query('select public.record_commission_receipt($1,$2,22.5,$3)',[fee.id,randomUUID(),'Synthetic first 30 percent']);
   await assert.rejects(milestone(randomUUID(),'export_and_final_payment','Synthetic final payment','Synthetic export'),/Completed export/);
  });
  await advance(3,'in_transit');await advance(4,'delivered');
  for(const [user,business] of [[ids.alice,buyer],[ids.bob,supplier]]){await asUser(db,user);await db.query("select public.confirm_coffee_deal($1,$2,'delivery')",[deal,business]);}await advance(5,'completed');
  await t.test('export plus final payment unlocks remaining 70%, preserving exact totals and privacy',async()=>{
   await assert.rejects(milestone(randomUUID(),'export_and_final_payment'),/Export and final/);
   await milestone(randomUUID(),'export_and_final_payment','Synthetic final payment','Synthetic export reference');
   const f=(await db.query('select public.admin_marketplace_operations() data')).rows[0].data.fees[0];assert.equal(f.payable,'75.000000');
   await db.query('select public.record_commission_receipt($1,$2,52.5,$3)',[fee.id,randomUUID(),'Synthetic remaining 70 percent']);
   await asUser(db,ids.alice);assert.equal((await db.query('select public.my_marketplace_operations($1) data',[buyer])).rows[0].data.fees.length,0);
   await db.exec('reset role');await assert.rejects(db.exec('delete from private.supplier_payment_milestones'),/append-only/);
  });
  await t.test('archiving hides historical trades and fees without deleting commercial history',async()=>{
   await db.exec('reset role');await db.query('update public.businesses set archived_at=now() where id=$1',[supplier]);
   await asUser(db,ids.reviewer,'aal2');assert.equal((await db.query('select id from public.coffee_lots')).rows.length,0);
   const operations=(await db.query('select public.admin_marketplace_operations() data')).rows[0].data;
   assert.equal(operations.fees.length,0);assert.equal(operations.deals.length,0);assert.equal(operations.stock.length,0);
   assert.equal((await db.query('select public.admin_trading_commercial() data')).rows[0].data.matches.length,0);
   await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from private.commission_receipts')).rows[0].n,2);
  });
  await t.test('new RPC is least-privileged and payment evidence cannot be read directly',async()=>{
   const rights=(await db.query("select has_function_privilege('anon','public.record_supplier_payment_milestone(uuid,uuid,text,text,text)','execute') anon,has_function_privilege('service_role','public.record_supplier_payment_milestone(uuid,uuid,text,text,text)','execute') service,has_function_privilege('authenticated','private.commission_payable(uuid)','execute') helper")).rows[0];
   assert.deepEqual(rights,{anon:false,service:false,helper:false});
   await asUser(db,ids.reviewer,'aal2');await assert.rejects(db.query('select * from private.supplier_payment_milestones'),{code:'42501'});
  });
 } finally {await db.close();}
});
