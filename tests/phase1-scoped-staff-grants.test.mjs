import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { asUser, database, ids, seedUsers } from './database.mjs';

test('scoped grants enforce MFA, preserve history, and audit atomic grant and exact-ID revocation', async () => {
  const db = await database();
  try {
    await seedUsers(db);
    await asUser(db, ids.alice);
    const { rows: [{ id: business }] } = await db.query(
      "select public.register_business('Synthetic buyer','Germany','overseas_buyer','buyer','Synthetic sourcing') as id"
    );
    await db.exec('reset role');
    await db.query("insert into public.staff_grants(user_id,permission) values ($1,'staff.manage')", [ids.manager]);
    const historical = randomUUID();
    await db.query(
      "insert into public.staff_grants(id,user_id,permission,business_id,revoked_at) values ($1,$2,'verification.review',$3,now())",
      [historical, ids.viewer, business]
    );
    const history = () => db.query(
      'select g.granted_by,g.revoked_at,a.actor_id,a.action from public.staff_grants g join public.audit_events a on a.object_id=g.id::text where g.id=$1 order by a.id',
      [historical]
    );
    const before = (await history()).rows;
    await db.exec(await readFile('supabase/migrations/20261109160000_phase1_scoped_staff_grants.sql', 'utf8'));

    const grant = (user = ids.reviewer, permission = 'verification.review', scope = business) =>
      db.query('select public.grant_phase1_staff($1,$2,$3) as id', [user, permission, scope]);
    const permission = async () => (await db.query(
      "select public.has_permission('verification.review',$1) as allowed", [business]
    )).rows[0].allowed;
    const { rows: [acl] } = await db.query(`
      select p.prosecdef, p.proconfig,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated,
        has_function_privilege('anon',p.oid,'execute') as anon,
        has_function_privilege('service_role',p.oid,'execute') as service
      from pg_proc p where p.oid='public.grant_phase1_staff(uuid,text,uuid)'::regprocedure
    `);
    assert.deepEqual(acl, { prosecdef: true, proconfig: ['search_path=""'], authenticated: true, anon: false, service: false });

    await asUser(db, null, 'aal1', 'anon');
    await assert.rejects(() => grant(), { code: '42501' });
    await asUser(db, ids.manager, 'aal1');
    await assert.rejects(() => grant(), { code: '42501' });
    await asUser(db, ids.reviewer, 'aal2');
    await assert.rejects(() => grant(), { code: '42501' });
    await asUser(db, ids.manager, 'aal2');
    await assert.rejects(() => grant(ids.manager), { code: '42501' });
    for (const [permissionName, scope] of [
      ['staff.manage', null], ['audit.read', null], ['verification.review', null],
      ['verification.review', randomUUID()], ['inquiry.manage', business], [null, null],
    ]) await assert.rejects(() => grant(ids.reviewer, permissionName, scope), { code: '22023' });
    await assert.rejects(() => grant(ids.unconfirmed), { code: '22023' });
    await assert.rejects(() => grant(ids.viewer), { code: '23505' });
    await assert.rejects(() => db.query(
      "insert into public.staff_grants(user_id,permission) values ($1,'inquiry.manage')", [ids.reviewer]
    ), { code: '42501' });
    await assert.rejects(() => db.exec('update public.staff_grants set revoked_at=null'), { code: '42501' });

    await db.exec("reset role; alter table public.audit_events add constraint synthetic_audit_failure check (action <> 'staff_grants.insert') not valid");
    await asUser(db, ids.manager, 'aal2');
    await assert.rejects(() => grant(), { code: '23514' });
    await db.exec('reset role; alter table public.audit_events drop constraint synthetic_audit_failure');
    assert.equal((await db.query('select count(*)::int as n from public.staff_grants where user_id=$1', [ids.reviewer])).rows[0].n, 0);

    await asUser(db, ids.manager, 'aal2');
    const { rows: [{ id }] } = await grant();
    const { rows: [{ id: inquiry }] } = await grant(ids.reviewer, 'inquiry.manage', null);
    await assert.rejects(() => grant(), { code: '23505' });
    await asUser(db, ids.reviewer, 'aal1');
    assert.equal(await permission(), false);
    await asUser(db, ids.reviewer, 'aal2');
    assert.equal(await permission(), true);
    await asUser(db, ids.manager, 'aal2');
    await db.query('select public.revoke_staff($1)', [id]);
    await asUser(db, ids.reviewer, 'aal2');
    assert.equal(await permission(), false);
    assert.equal((await db.query("select public.has_permission('inquiry.manage') as allowed")).rows[0].allowed, true);
    await asUser(db, ids.manager, 'aal2');
    await db.query('select public.revoke_staff($1)', [inquiry]);
    await db.exec('reset role');
    const { rows: [record] } = await db.query('select granted_by, revoked_at from public.staff_grants where id=$1', [id]);
    assert.equal(record.granted_by, ids.manager);
    assert.ok(record.revoked_at);
    assert.deepEqual((await db.query(
      'select actor_id,action from public.audit_events where object_id=$1 order by id', [id]
    )).rows, [
      { actor_id: ids.manager, action: 'staff_grants.insert' },
      { actor_id: ids.manager, action: 'staff_grants.update' },
    ]);
    assert.deepEqual((await history()).rows, before);
  } finally {
    await db.close();
  }
});
