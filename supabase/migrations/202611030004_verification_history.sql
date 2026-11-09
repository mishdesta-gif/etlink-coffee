begin;
-- Verification evidence is business data, kept separately from redacted operational audit records.
create table public.capability_history (
 id uuid primary key default gen_random_uuid(),
 capability_id uuid not null references public.capabilities(id),
 business_id uuid not null references public.businesses(id),
 revision integer not null,
 actor_id uuid references auth.users(id),
 status text not null,
 details text not null,
 business_snapshot jsonb not null,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 reason text,
 expires_at timestamptz,
 revoked_at timestamptz,
 document_ids uuid[] not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(capability_id,revision)
);
create index capability_history_business_idx on public.capability_history(business_id,created_at);
alter table public.capability_history enable row level security;
revoke all on public.capability_history from public,anon,authenticated;
grant select on public.capability_history to authenticated;
create policy capability_history_read on public.capability_history for select to authenticated using (private.member(business_id) or private.staff('verification.review',business_id));
create trigger capability_history_immutable before update or delete on public.capability_history for each row execute function private.immutable_audit();
create function private.snapshot_capability() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.capability_history(capability_id,business_id,revision,actor_id,status,details,business_snapshot,reviewed_by,reviewed_at,reason,expires_at,revoked_at,document_ids)
 select new.id,new.business_id,new.revision,auth.uid(),new.status,new.details,jsonb_build_object('name',b.name,'country',b.country,'kind',b.kind),new.reviewed_by,new.reviewed_at,new.reason,new.expires_at,new.revoked_at,
 coalesce((select array_agg(d.id order by d.id) from public.documents d where d.business_id=new.business_id and d.status='uploaded'),array[]::uuid[])
 from public.businesses b where b.id=new.business_id;
 return new;
end $$;
create trigger capability_snapshot after insert or update on public.capabilities for each row execute function private.snapshot_capability();
revoke execute on function private.snapshot_capability() from public,anon,authenticated;
commit;
