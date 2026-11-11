import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import fs from 'node:fs/promises';
import {tradingDatabase,seedTrading,tradeInput,asUser,ids} from './trading-database.mjs';
test('Phase 2 catalog: least privilege, private graph, future grants and preserved Phase 1 migrations',async()=>{
 const db=await tradingDatabase();try{
 const functions=(await db.query("select n.nspname as schema,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')")).rows;
 assert(functions.every(f=>f.owner==='postgres'&&f.proconfig?.includes('search_path=""')));assert(functions.filter(f=>f.schema==='public').every(f=>!f.anon_execute));
 for(const name of ['trade_matches','commission_terms','commission_acceptances','trade_offers','trade_offer_versions','trade_offer_responses']){const r=(await db.query("select relrowsecurity,has_table_privilege('authenticated',oid,'SELECT') as client_select,has_table_privilege('anon',oid,'SELECT') as anon_select from pg_class where oid=$1::regclass",['private.'+name])).rows[0];assert(r.relrowsecurity&&!r.client_select&&!r.anon_select);}
 for(const role of ['anon','authenticated']){await db.exec('reset role');await db.exec('set role '+role);for(const table of ['buyer_requests','coffee_lots','trade_record_history'])await assert.rejects(()=>db.exec('delete from public.'+table));}
 await db.exec('reset role');await db.exec("create function public.synthetic_future_trade_fn() returns boolean language sql as 'select true'");assert.equal((await db.query("select has_function_privilege('authenticated','public.synthetic_future_trade_fn()','EXECUTE') as execute")).rows[0].execute,false);
 const baseline=JSON.parse(await fs.readFile('tests/fixtures/phase1-migration-hashes.json','utf8'));for(const f of baseline)assert.equal(createHash('sha256').update(await fs.readFile(f.path)).digest('hex'),f.sha256);
 }finally{await db.close();}
});
test('Phase 2 domestic request, trading invitation independence and self-review restrictions',async()=>{
 const db=await tradingDatabase();try{
 const {buyer,supplier}=await seedTrading(db);await asUser(db,ids.alice);await assert.rejects(()=>db.query("select save_trade_record('request',$1,$2,0,$3,'submitted')",[buyer,randomUUID(),tradeInput({trade_type:'domestic'})]),/Ethiopian/);
 await asUser(db,ids.viewer);const domestic=(await db.query("select register_business('Synthetic domestic buyer','Ethiopia','domestic_buyer','buyer','Synthetic domestic sourcing request') as id")).rows[0].id;
 const req=randomUUID();await db.query("select save_trade_record('request',$1,$2,0,$3,'submitted')",[domestic,req,tradeInput({trade_type:'domestic'})]);
 await db.exec('reset role');await db.query("insert into staff_grants(user_id,permission,business_id) values($1,'trading.requests.review',$2)",[ids.viewer,domestic]);await asUser(db,ids.viewer,'aal2');await assert.rejects(()=>db.query("select review_trade_record('request',$1,1,'in_review','Synthetic self-review denied')",[req]),/Independent/);
 await asUser(db,ids.reviewer,'aal2');await assert.rejects(()=>db.query("select create_trading_invitation('viewer@example.test',array['trading.offers.issue'],$1)",['b'.repeat(64)]),/manager/);
 await db.exec('reset role');await db.query("insert into staff_grants(user_id,permission) values($1,'staff.manage')",[ids.manager]);await asUser(db,ids.manager,'aal2');await db.query("select create_trading_invitation('support@example.test',array['trading.offers.issue'],$1)",['b'.repeat(64)]);
 await asUser(db,ids.support);await assert.rejects(()=>db.query('select accept_invitation($1)',['b'.repeat(64)]),/MFA/);await asUser(db,ids.support,'aal2');await db.query('select accept_invitation($1)',['b'.repeat(64)]);
 assert.equal((await db.query("select has_permission('trading.offers.issue') as ok")).rows[0].ok,true);assert.equal((await db.query("select has_permission('verification.review') as ok")).rows[0].ok,false);
 await asUser(db,ids.bob);const lot=randomUUID();await db.query("select save_trade_record('lot',$1,$2,0,$3,'submitted')",[supplier,lot,tradeInput()]);await db.exec('reset role');await db.query("update capabilities set expires_at=clock_timestamp()-interval '1 second',revision=revision+1 where business_id=$1",[supplier]);await asUser(db,ids.bob);await assert.rejects(()=>db.query("select save_trade_record('lot',$1,$2,1,$3,'submitted')",[supplier,lot,tradeInput()]));
 }finally{await db.close();}
});
test('Phase 2 authenticated record creation quotas are actor-bound and cannot be reset directly',async()=>{
 const db=await tradingDatabase();try{
 const {buyer}=await seedTrading(db);await asUser(db,ids.alice);
 for(let i=0;i<20;i++)await db.query("select save_trade_record('request',$1,$2,0,$3,'draft')",[buyer,randomUUID(),tradeInput()]);
 await assert.rejects(()=>db.query("select save_trade_record('request',$1,$2,0,$3,'draft')",[buyer,randomUUID(),tradeInput()]),/Too many/);
 assert.equal((await db.query('select count(*)::int as n from buyer_requests')).rows[0].n,20);await assert.rejects(()=>db.exec('delete from private.rate_limits'));
 }finally{await db.close();}
});
