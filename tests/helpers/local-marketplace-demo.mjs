import { randomUUID } from 'node:crypto';
import { asUser, ids } from '../database.mjs';
import { tradeInput } from '../trading-database.mjs';

// Only used by the isolated loopback fixture. Exercise the real local RPCs so
// the demonstration retains approval, revision, audit and confidentiality rules.
export async function seedLocalMarketplace(db, buyer, supplier) {
  await asUser(db, ids.reviewer, 'aal2');
  for (const business of [buyer, supplier]) {
    const { rows: [application] } = await db.query('select id,revision from public.capabilities where business_id=$1', [business]);
    await db.query("select public.review_capability($1,$2,'under_review',$3,null)",
      [application.id, application.revision, 'SYNTHETIC local demonstration review started.']);
    await db.query("select public.review_capability($1,$2,'approved',$3,$4)",
      [application.id, application.revision + 1, 'SYNTHETIC local demonstration eligibility approved.', new Date(Date.now() + 30 * 86400000).toISOString()]);
  }
  const request = randomUUID(), lot = randomUUID();
  for (const [user, domain, business, id, quantity, price] of [
    [ids.alice, 'request', buyer, request, '1000', '7'],
    [ids.bob, 'lot', supplier, lot, '2000', '5'],
  ]) {
    await asUser(db, user);
    await db.query("select public.save_trade_record($1,$2,$3,0,$4,'submitted')",
      [domain, business, id, tradeInput({ quantity, unit: 'kg', price })]);
    await asUser(db, ids.reviewer, 'aal2');
    await db.query("select public.review_trade_record($1,$2,1,'in_review',$3)", [domain, id, 'SYNTHETIC local source review started.']);
    await db.query('select public.review_trade_record($1,$2,2,$3,$4)',
      [domain, id, domain === 'request' ? 'qualified' : 'approved', 'SYNTHETIC source ready for manual ET Link matching.']);
  }
  await db.exec('reset role');
  return { request, lot };
}
