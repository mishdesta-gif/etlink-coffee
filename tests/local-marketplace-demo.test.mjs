import test from 'node:test';
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
