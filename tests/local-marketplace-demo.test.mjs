import test from 'node:test';
import fs from 'node:fs/promises';
import {preparePrivateQuotes} from './helpers/fulfillment-fixture.mjs';
import assert from 'node:assert/strict';
import { tradingDatabase, seedTrading, asUser, ids } from './trading-database.mjs';
import { seedLocalMarketplace } from './helpers/local-marketplace-demo.mjs';

test('local marketplace demo seeds eligible private sources through guarded RPCs without automatic matching', async () => {
  const db = await tradingDatabase();
  try {
    const { buyer, supplier } = await seedTrading(db, { approveBuyer: false, approveSupplier: false });
    await db.query("insert into public.staff_grants(user_id,permission) values($1,'verification.review')", [ids.reviewer]);
    const seeded = await seedLocalMarketplace(db, buyer, supplier);
    const { rows: [request] } = await db.query('select id,status,revision from public.buyer_requests');
    const { rows: [lot] } = await db.query('select id,status,revision from public.coffee_lots');
    assert.deepEqual(request, { id: seeded.request, status: 'qualified', revision: 3 });
    assert.deepEqual(lot, { id: seeded.lot, status: 'approved', revision: 3 });
    assert.equal((await db.query('select count(*)::int as n from private.trade_matches')).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.notification_deliveries where status<>'disabled'")).rows[0].n, 0);
    await asUser(db, ids.alice);
    assert.equal((await db.query('select id from public.coffee_lots')).rows.length, 0);
    await asUser(db, ids.bob);
    assert.equal((await db.query('select id from public.buyer_requests')).rows.length, 0);
    await asUser(db, ids.reviewer, 'aal1');
    await assert.rejects(db.query('select public.approve_trade_match($1,3,$2,3,$3)', [request.id, lot.id, 'Synthetic password-only denial']), { code: '42501' });
  } finally { await db.close(); }
});

test('local preview uses current supplier-only commission policy and never seeds buyer fees',async()=>{
 const db=await tradingDatabase();try{
  await db.exec(await fs.readFile('supabase/migrations/20261118142516_phase2_launch_safeguards.sql','utf8'));
  const {buyer,supplier}=await seedTrading(db,{approveBuyer:false,approveSupplier:false});
  await db.query("insert into public.staff_grants(user_id,permission) values($1,'verification.review')",[ids.reviewer]);
  const records=await seedLocalMarketplace(db,buyer,supplier);
  await preparePrivateQuotes(db,{buyer,supplier,...records,launchPolicy:true});
  await db.exec('reset role');
  const fees=(await db.query('select business_id,amount,payment_policy from private.commission_terms')).rows;
  assert.equal(fees.length,1);assert.equal(fees[0].business_id,supplier);assert.equal(Number(fees[0].amount),1.5);assert.equal(fees[0].payment_policy,'supplier_30_70');
 }finally{await db.close();}
});
