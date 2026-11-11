import { randomUUID } from 'node:crypto';
import { asUser, ids } from '../database.mjs';
import { tradingDatabase, seedTrading, tradeInput } from '../trading-database.mjs';

export async function preparePrivateQuotes(db, { buyer, supplier, request, lot }) {
  await asUser(db, ids.reviewer, 'aal2');
  const match = (await db.query('select public.approve_trade_match($1,3,$2,3,$3) as id', [request, lot, 'Synthetic manual selection of current verified sources.'])).rows[0].id;
  const terms = [];
  for (const [business, calculation, amount, trigger] of [[buyer, 'percentage', 5, 'signed_sale_contract'], [supplier, 'fixed', 20, 'confirmed_delivery']]) {
    await asUser(db, ids.reviewer, 'aal2');
    const id = (await db.query('select public.create_commission_terms($1,$2,$3,$4,$5,$6,$7,$8) as id', [match, business, calculation, amount, 'USD', trigger, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 7 * 86400000).toISOString()])).rows[0].id;
    await asUser(db, business === buyer ? ids.alice : ids.bob);
    await db.query('select public.accept_commission_terms($1)', [id]);
    terms.push(id);
  }
  const offers = [];
  for (const [business, user, price] of [[buyer, ids.alice, '7'], [supplier, ids.bob, '5']]) {
    const id = randomUUID();
    await asUser(db, ids.reviewer, 'aal2');
    await db.query('select public.issue_trade_offer($1,$2,$3,0,$4,$5)', [match, business, id, { origin: 'Guji', grade: '1', process: 'washed', quantity_kg: '1000', price, currency: 'USD', incoterm: 'FOB' }, new Date(Date.now() + 86400000).toISOString()]);
    await asUser(db, user);
    await db.query("select public.respond_trade_offer($1,1,'interested',null,$2)", [id, randomUUID()]);
    offers.push(id);
  }
  return { match, terms, buyerOffer: offers[0], supplierOffer: offers[1] };
}

export async function fulfillmentFixture() {
  const db = await tradingDatabase();
  try {
    const { buyer, supplier } = await seedTrading(db, { approveBuyer: true, approveSupplier: true });
    const request = randomUUID(), lot = randomUUID();
    for (const [user, domain, business, id, quantity] of [[ids.alice, 'request', buyer, request, '1000'], [ids.bob, 'lot', supplier, lot, '2000']]) {
      await asUser(db, user);
      await db.query("select public.save_trade_record($1,$2,$3,0,$4,'submitted')", [domain, business, id, tradeInput({ quantity, unit: 'kg' })]);
      await asUser(db, ids.reviewer, 'aal2');
      await db.query("select public.review_trade_record($1,$2,1,'in_review','Synthetic source review started.')", [domain, id]);
      await db.query('select public.review_trade_record($1,$2,2,$3,$4)', [domain, id, domain === 'request' ? 'qualified' : 'approved', 'Synthetic source ready for allocation.']);
    }
    return { db, buyer, supplier, request, lot, ...await preparePrivateQuotes(db, { buyer, supplier, request, lot }) };
  } catch (error) { await db.close(); throw error; }
}

export async function acceptedPhysicalSample(f) {
  const id = randomUUID();
  await asUser(f.db, ids.alice);
  await f.db.query('select public.request_coffee_sample($1,1,$2,300)', [f.buyerOffer, id]);
  await asUser(f.db, ids.reviewer, 'aal2');
  await f.db.query("select public.update_coffee_sample($1,1,'dispatched','Synthetic carrier','Synthetic tracking')", [id]);
  await asUser(f.db, ids.alice);
  await f.db.query("select public.update_coffee_sample($1,2,'received')", [id]);
  await f.db.query("select public.update_coffee_sample($1,3,'accepted')", [id]);
  return id;
}
