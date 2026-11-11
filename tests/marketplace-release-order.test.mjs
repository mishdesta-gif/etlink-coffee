import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { database, seedUsers, ids, asUser } from './database.mjs';
import { sources, verifySources } from '../scripts/prepare-marketplace-staging-release.mjs';

test('reviewed release preserves six hosted versions and exactly three pending source hashes',()=>{
  const files = verifySources();
  assert.equal(files.filter(f=>f.state==='applied').length,6);
  assert.deepEqual(files.filter(f=>f.state==='pending').map(f=>f.filename.slice(0,14)),['20261104210204','20261104214339','20261111161526']);
  assert.equal(new Set(files.map(f=>f.filename.slice(0,14))).size,9);
});

test('marketplace migrations apply after the already-hosted staff RPC without changing historical records or legacy policies',async()=>{
  const db = await database();
  try {
    await db.exec(await fs.readFile('supabase/migrations/'+sources[5][0],'utf8'));
    await seedUsers(db);
    await asUser(db,ids.alice);
    await db.query("select public.register_business('Synthetic release baseline','Germany','overseas_buyer','buyer','Synthetic baseline preservation fixture')");
    await db.exec('reset role');
    for (const user of Object.values(ids).slice(0,6)) await db.query("insert into public.staff_grants(user_id,permission,revoked_at) values($1,'inquiry.manage',now())",[user]);
    const snapshot = async()=> (await db.query(`select
      (select md5(coalesce(string_agg(to_jsonb(g)::text,'' order by id),'')) from public.staff_grants g) as grants,
      (select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by id),'')) from public.audit_events a) as audit,
      (select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by business_id,user_id),'')) from public.memberships m) as memberships,
      (select pg_get_functiondef('public.grant_phase1_staff(uuid,text,uuid)'::regprocedure)) as grant_rpc,
      (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename not in ('buyer_requests','coffee_lots','trade_record_history')) as policies`)).rows[0];
    const before = await snapshot();
    for (const [source] of sources.slice(6)) await db.exec(await fs.readFile('supabase/migrations/'+source,'utf8'));
    assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('select count(*)::int as total from public.staff_grants')).rows[0].total,6);
    assert.equal((await db.query('select count(*)::int as total from public.staff_grants where revoked_at is null')).rows[0].total,0);
    const acl = (await db.query(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in ('save_trade_record','approve_trade_match','request_coffee_sample','record_commission_receipt') and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')`)).rows[0];
    assert.equal(acl.n,4);
  } finally { await db.close(); }
});
