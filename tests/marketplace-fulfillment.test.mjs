import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, ids } from './database.mjs';
import { fulfillmentFixture, acceptedPhysicalSample } from './helpers/fulfillment-fixture.mjs';
import { tradeInput } from './trading-database.mjs';

test('samples, distinct stock commitments, bilateral deals and earned commission enforce private workflows', async t => {
  const f = await fulfillmentFixture();
  const { db } = f;
  const sample = randomUUID(), allocation = randomUUID(), reservation = randomUUID(), deal = randomUUID();
  const sampleStep = (revision, status) => db.query('select public.update_coffee_sample($1,$2,$3,$4,$5)', [sample, revision, status, 'Synthetic private carrier', 'PRIVATE-TRACKING-ONLY']);
  const allocate = (id = allocation, quantity = 1000) => db.query('select public.allocate_coffee_stock($1,$2,$3,$4)', [f.match, sample, id, quantity]);
  const advance = (revision, status) => db.query('select public.advance_coffee_deal($1,$2,$3,$4)', [deal, revision, status, 'PRIVATE-EVIDENCE-ONLY']);
  const projection = async b => (await db.query('select public.my_marketplace_operations($1) as data', [b])).rows[0].data;
  const ownerView = async business => {
    await asUser(db, business === f.buyer ? ids.alice : ids.bob);
    const view = await projection(business);
    await asUser(db, ids.reviewer, 'aal2');
    return view;
  };
  try {
    await t.test('anonymous direct access denied and private functions have restricted execution', async () => {
      await asUser(db, null, 'aal1', 'anon');
      await assert.rejects(db.query('select public.my_marketplace_operations($1)', [f.buyer]), { code: '42501' });
      await asUser(db, ids.alice);
      await assert.rejects(db.query('select * from private.coffee_samples'), { code: '42501' });
      await db.exec('reset role');
      const { rows } = await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('service_role',p.oid,'execute') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('request_coffee_sample','allocate_coffee_stock','advance_coffee_deal','record_commission_receipt')");
      assert.equal(rows.length, 4);
      for (const row of rows) { assert.equal(row.prosecdef, true); assert.deepEqual(row.proconfig, ['search_path=""']); assert.equal(row.anon, false); assert.equal(row.service, false); }
    });
    await t.test('sample acceptance requires physical progress and creates no stock commitment', async () => {
      await asUser(db, ids.alice);
      await db.query('select public.request_coffee_sample($1,1,$2,300)', [f.buyerOffer, sample]);
      await db.query('select public.request_coffee_sample($1,1,$2,300)', [f.buyerOffer, sample]);
      await assert.rejects(sampleStep(1, 'accepted'));
      await asUser(db, ids.reviewer, 'aal1'); await assert.rejects(sampleStep(1, 'dispatched'), { code: '42501' });
      await asUser(db, ids.reviewer, 'aal2'); await sampleStep(1, 'dispatched');
      assert.equal((await db.query('select public.admin_marketplace_operations() as data')).rows[0].data.samples.length, 1);
      await assert.rejects(sampleStep(1, 'cancelled'), { code: '40001' });
      await asUser(db, ids.bob); await assert.rejects(sampleStep(2, 'received'), { code: '42501' });
      await asUser(db, ids.alice); await sampleStep(2, 'received'); await sampleStep(3, 'accepted');
      const view = await projection(f.buyer);
      assert.equal(view.samples[0].status, 'accepted'); assert.deepEqual(view.allocations, []);
      assert(!JSON.stringify(view).includes('PRIVATE-TRACKING-ONLY'));
    });
    await t.test('allocation and reservation are separate, bounded and do not double count', async () => {
      await asUser(db, ids.alice); await assert.rejects(allocate(), { code: '42501' });
      await asUser(db, ids.reviewer, 'aal2'); await allocate(); await allocate();
      await assert.rejects(allocate(randomUUID(), 1), /Insufficient unallocated quantity/);
      assert.equal((await ownerView(f.buyer)).allocations[0].reservation_status, null);
      await db.query('select public.reserve_coffee_stock($1,$2,$3)', [allocation, reservation, new Date(Date.now() + 86400000).toISOString()]);
      assert.equal((await ownerView(f.buyer)).allocations[0].reservation_status, 'reserved');
      assert.equal((await ownerView(f.supplier)).stock[0].available_kg, 1000);
      assert.equal((await ownerView(f.supplier)).stock[0].reserved_kg, 1000);
      await assert.rejects(db.query("select public.release_coffee_stock('allocation',$1,1)", [allocation]), /Release the reservation first/);
      await asUser(db, ids.bob);
      await assert.rejects(db.query("select public.save_trade_record('lot',$1,$2,3,$3,'submitted')", [f.supplier, f.lot, tradeInput({ quantity: '1', unit: 'kg' })]), /Allocated or fulfilled source/);
    });
    await t.test('deal requires both private interested quotes and both representatives', async () => {
      await asUser(db, ids.reviewer, 'aal2');
      await db.query('select public.create_coffee_deal($1,$2,1,$3,1,$4)', [reservation, f.buyerOffer, f.supplierOffer, deal]);
      await assert.rejects(advance(1, 'confirmed'), /Both current representatives/);
      await asUser(db, ids.alice); await db.query("select public.confirm_coffee_deal($1,$2,'terms')", [deal, f.buyer]);
      await assert.rejects(db.query("select public.confirm_coffee_deal($1,$2,'terms')", [deal, f.supplier]), { code: '42501' });
      await asUser(db, ids.bob); await db.query("select public.confirm_coffee_deal($1,$2,'terms')", [deal, f.supplier]);
      await asUser(db, ids.reviewer, 'aal2'); await advance(1, 'confirmed'); await advance(2, 'contract_signed');
      await assert.rejects(advance(3, 'cancelled'), /Signed deals/);
      assert.equal((await ownerView(f.buyer)).fees[0].amount, '350.000000');
      assert.deepEqual((await ownerView(f.supplier)).fees, []);
    });
    await t.test('recipient projections exclude counterparties, internal source graph, prices and evidence', async () => {
      for (const [user, business, hidden, price] of [[ids.alice, f.buyer, f.supplier, '7'], [ids.bob, f.supplier, f.buyer, '5']]) {
        await asUser(db, user); const view = await projection(business); const text = JSON.stringify(view);
        assert.equal(view.deals[0].price, price);
        for (const value of [hidden, f.match, f.request, ...(user===ids.alice?[f.lot]:[]), f.buyerOffer, f.supplierOffer, 'PRIVATE-EVIDENCE-ONLY', 'PRIVATE-TRACKING-ONLY']) assert(!text.includes(value), 'Private field leaked');
        await assert.rejects(projection(hidden), { code: '42501' });
      }
    });
    await t.test('completion needs delivery confirmations, consumes quantity, and earns only the configured fees', async () => {
      await asUser(db, ids.reviewer, 'aal2'); await advance(3, 'in_transit'); await advance(4, 'delivered');
      await assert.rejects(advance(5, 'completed'), /Both representatives/);
      for (const [user, business] of [[ids.alice, f.buyer], [ids.bob, f.supplier]]) {
        await asUser(db, user); await db.query("select public.confirm_coffee_deal($1,$2,'delivery')", [deal, business]);
      }
      await asUser(db, ids.reviewer, 'aal2'); await advance(5, 'completed');
      assert.equal((await ownerView(f.supplier)).fees[0].amount, '20.000000');
      assert.equal((await ownerView(f.buyer)).allocations[0].status, 'fulfilled');
      assert.equal((await ownerView(f.supplier)).stock[0].fulfilled_kg, 1000);
      assert.equal((await ownerView(f.supplier)).stock[0].available_kg, 1000);
      await assert.rejects(allocate(randomUUID(), 1), /Insufficient unallocated quantity/);
    });
    await t.test('commission receipts are idempotent, bounded, immutable and staff-only', async () => {
      await asUser(db, ids.alice); const fee = (await projection(f.buyer)).fees[0];
      const id = randomUUID();
      const pay = amount => db.query('select public.record_commission_receipt($1,$2,$3,$4)', [fee.id, id, amount, 'SYNTHETIC-RECEIPT-001']);
      await assert.rejects(pay(100), { code: '42501' });
      await asUser(db, ids.reviewer, 'aal2'); await pay(100); await pay(100);
      await assert.rejects(pay(101), /Payment identity changed/);
      await assert.rejects(db.query('select public.record_commission_receipt($1,$2,251,$3)', [fee.id, randomUUID(), 'SYNTHETIC-RECEIPT-002']), /exceeds outstanding/);
      assert.equal((await ownerView(f.buyer)).fees[0].paid, '100.000000');
      await db.exec('reset role'); await assert.rejects(db.exec('delete from private.commission_receipts'), /append-only/);
      assert.equal((await db.query("select count(*)::int as n from public.notification_deliveries where status<>'disabled'")).rows[0].n, 0);
    });
  } finally { await db.close(); }
});

test('expired reservations are unusable and explicit release restores allocation capacity', async () => {
  const f = await fulfillmentFixture();
  try {
    const sample = await acceptedPhysicalSample(f), allocation = randomUUID(), reservation = randomUUID();
    await asUser(f.db, ids.reviewer, 'aal2');
    await f.db.query('select public.allocate_coffee_stock($1,$2,$3,1000)', [f.match, sample, allocation]);
    await f.db.query('select public.reserve_coffee_stock($1,$2,$3)', [allocation, reservation, new Date(Date.now()+86400000).toISOString()]);
    await f.db.exec('reset role');
    await f.db.query("update private.stock_reservations set expires_at=clock_timestamp()-interval '1 second' where id=$1", [reservation]);
    await asUser(f.db, ids.alice);
    const view = (await f.db.query('select public.my_marketplace_operations($1) as data', [f.buyer])).rows[0].data;
    assert.equal(view.allocations[0].reservation_status, 'expired');
    await asUser(f.db, ids.reviewer, 'aal2');
    await assert.rejects(f.db.query('select public.create_coffee_deal($1,$2,1,$3,1,$4)', [reservation, f.buyerOffer, f.supplierOffer, randomUUID()]), /Current reservation/);
    await f.db.query("select public.release_coffee_stock('allocation',$1,1)", [allocation]);
    await f.db.query('select public.allocate_coffee_stock($1,$2,$3,1000)', [f.match, sample, randomUUID()]);
  } finally { await f.db.close(); }
});

test('revoked representatives cannot leave usable consent and unsigned cancellation releases commitments without earned fees', async () => {
  const f = await fulfillmentFixture();
  try {
    const sample = await acceptedPhysicalSample(f), allocation = randomUUID(), reservation = randomUUID(), deal = randomUUID();
    await asUser(f.db, ids.reviewer, 'aal2');
    await f.db.query('select public.allocate_coffee_stock($1,$2,$3,1000)', [f.match, sample, allocation]);
    await f.db.query('select public.reserve_coffee_stock($1,$2,$3)', [allocation, reservation, new Date(Date.now()+86400000).toISOString()]);
    await f.db.query('select public.create_coffee_deal($1,$2,1,$3,1,$4)', [reservation, f.buyerOffer, f.supplierOffer, deal]);
    for (const [user,business] of [[ids.alice,f.buyer],[ids.bob,f.supplier]]) {
      await asUser(f.db,user); await f.db.query("select public.confirm_coffee_deal($1,$2,'terms')",[deal,business]);
    }
    await f.db.exec('reset role');
    await f.db.query('update public.memberships set active=false where user_id=$1', [ids.bob]);
    await asUser(f.db, ids.reviewer, 'aal2');
    await assert.rejects(f.db.query("select public.advance_coffee_deal($1,1,'confirmed','')",[deal]),/Both current representatives/);
    await f.db.query("select public.advance_coffee_deal($1,1,'cancelled','')",[deal]);
    await f.db.exec('reset role');
    assert.equal((await f.db.query('select status from private.stock_allocations where id=$1',[allocation])).rows[0].status,'released');
    assert.equal((await f.db.query('select status from private.stock_reservations where id=$1',[reservation])).rows[0].status,'released');
    assert.equal((await f.db.query('select count(*)::int as n from private.commission_receivables')).rows[0].n,0);
    await assert.rejects(f.db.exec('delete from private.fulfillment_history'),/append-only/);
  } finally { await f.db.close(); }
});
