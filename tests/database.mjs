import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';

// An isolated real PostgreSQL engine. Auth and Storage tables/functions below are
// minimal test contracts, not an emulation of Supabase Auth or its Storage service.
export const bootstrapSQL = `
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    alter table auth.users add column banned_until timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    -- Match the observed provider-owned, RLS-enabled tables with no Auth policies.
    create role supabase_auth_admin nologin;
    alter schema auth owner to supabase_auth_admin;
    alter table auth.users owner to supabase_auth_admin;
    alter table auth.sessions owner to supabase_auth_admin;
    alter table auth.users enable row level security;
    alter table auth.sessions enable row level security;
    -- Existing hosted postgres has SELECT + BYPASSRLS; a new grant-only role does not.
    grant select on auth.users,auth.sessions to postgres with grant option;
    grant usage on schema auth to postgres;
    grant anon,authenticated,service_role to postgres;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth, storage to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon, authenticated;
    grant select,insert,update,delete on storage.objects to service_role;
  `;
export async function database({supabaseDefaults=true,remediation=true}={}) {
  const db = new PGlite();
  await db.exec(bootstrapSQL);
  // Match the defaults actually observed in staging, not just vanilla PostgreSQL.
  if(supabaseDefaults)await db.exec(`
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  `);
  await db.exec(await fs.readFile('supabase/migrations/202611030001_foundation.sql','utf8'));
  await db.exec(await fs.readFile('supabase/migrations/202611030002_notification_jobs.sql','utf8'));
  await db.exec(await fs.readFile('supabase/migrations/202611030003_document_lifecycle.sql','utf8'));
  await db.exec(await fs.readFile('supabase/migrations/202611030004_verification_history.sql','utf8'));
  if(remediation)await db.exec(await fs.readFile('supabase/migrations/20261104100651_phase1_auth_compatibility.sql','utf8'));
  return db;
}
export async function asUser(db,id,aal='aal1',role='authenticated',sessionId=id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",[id||'',JSON.stringify({sub:id,aal,session_id:sessionId})]);
  await db.exec(`set role ${role}`);
}
export const ids={alice:'11111111-1111-4111-8111-111111111111',bob:'22222222-2222-4222-8222-222222222222',reviewer:'33333333-3333-4333-8333-333333333333',support:'44444444-4444-4444-8444-444444444444',viewer:'55555555-5555-4555-8555-555555555555',unconfirmed:'66666666-6666-4666-8666-666666666666',manager:'77777777-7777-4777-8777-777777777777'};
export async function seedUsers(db) {
  for(const [name,id] of Object.entries(ids)){
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,`${name}@example.test`,name==='unconfirmed'?null:'2026-01-01T00:00:00Z']);
    await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[id]);
  }
}

// Simulates the already-authorized server ingress, never a browser RPC call.
export async function trustedInquiry(db,query,params=[]) {
  const state=(await db.query("select current_user as role,current_setting('request.jwt.claim.sub',true) as sub,current_setting('request.jwt.claims',true) as claims")).rows[0];
  await asUser(db,null,'aal1','service_role');
  try { return await db.query(query.replace('public.submit_inquiry(','public.submit_trusted_inquiry('),params); }
  finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[state.sub||'',state.claims||'{}']);
    await db.exec(`set role ${state.role}`);
  }
}
