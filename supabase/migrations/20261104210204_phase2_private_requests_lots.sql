-- Phase 2 LOCAL CANDIDATE. Never apply hosted without reviewed fingerprint approval.
-- Additive tables/RPCs; existing Phase 1 RLS and managed Auth remain unchanged.
-- Actor UUIDs come only from private.trade_actor(), like existing audit actors;
-- no new REFERENCES privilege/dependency on provider-managed auth.users is needed.
begin;
create table public.buyer_requests (
 id uuid primary key, reference text not null unique default 'REQ-'||gen_random_uuid()::text,
 business_id uuid not null references public.businesses(id), created_by uuid not null,
 status text not null default 'draft' check(status in ('draft','submitted','in_review','qualified','closed','withdrawn')),
 revision integer not null default 1 check(revision>0), payload jsonb not null, reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.coffee_lots (
 id uuid primary key, reference text not null unique default 'LOT-'||gen_random_uuid()::text,
 business_id uuid not null references public.businesses(id), created_by uuid not null,
 status text not null default 'draft' check(status in ('draft','submitted','in_review','approved','rejected','withdrawn','exhausted')),
 revision integer not null default 1 check(revision>0), payload jsonb not null, reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index buyer_requests_queue on public.buyer_requests(status,created_at,id);
create index buyer_requests_business on public.buyer_requests(business_id,created_at,id);
create index coffee_lots_queue on public.coffee_lots(status,created_at,id);
create index coffee_lots_business on public.coffee_lots(business_id,created_at,id);
create table public.trade_record_history (
 id uuid primary key default gen_random_uuid(), domain text not null check(domain in ('request','lot')),
 record_id uuid not null, business_id uuid not null references public.businesses(id), revision integer not null,
 status text not null, payload jsonb not null, actor_id uuid not null, reason text, created_at timestamptz not null default now(),
 unique(domain,record_id,revision)
);
alter table public.buyer_requests enable row level security;
alter table public.coffee_lots enable row level security;
alter table public.trade_record_history enable row level security;
revoke all on public.buyer_requests,public.coffee_lots,public.trade_record_history from public,anon,authenticated,service_role;
grant select on public.buyer_requests,public.coffee_lots,public.trade_record_history to authenticated;

-- No unrelated permission acquires trading authority. Existing scopes remain explicit.
alter table public.staff_grants drop constraint staff_grants_permission_check;
alter table public.staff_grants add constraint staff_grants_permission_check check(permission in
 ('staff.manage','verification.review','inquiry.manage','audit.read','trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage'));

-- Recheck wall-clock session expiry after authorization-lock waits. Reuse existing
-- postgres SELECT/BYPASSRLS; no Auth grants, policies, ownership or provider changes.
create function private.trade_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor=private.require_user();
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=actor
 and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp())) then
 raise exception 'Active current session required' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function private.trade_actor() from public,anon,authenticated;

create function private.trade_capability(b uuid,c text,approved boolean default true) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.businesses x join public.capabilities a on a.business_id=x.id
 where x.id=b and x.archived_at is null and a.capability=c and a.status<>'suspended'
 and (not approved or (a.status='approved' and a.expires_at>clock_timestamp() and a.revoked_at is null))
 and (c<>'supplier' or lower(trim(x.country))='ethiopia'))
$$;
create function private.trade_reader(d text,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member(b) or private.staff(case when d='request' then 'trading.requests.review' else 'trading.lots.review' end,b)
 or private.staff('trading.matches.manage',b)
$$;
revoke all on function private.trade_capability(uuid,text,boolean),private.trade_reader(text,uuid) from public,anon,authenticated;
grant execute on function private.trade_reader(text,uuid) to authenticated;
create policy buyer_requests_read on public.buyer_requests for select to authenticated using(private.trade_reader('request',business_id) and (private.member(business_id) or status<>'draft'));
create policy coffee_lots_read on public.coffee_lots for select to authenticated using(private.trade_reader('lot',business_id) and (private.member(business_id) or status<>'draft'));
create policy trade_history_read on public.trade_record_history for select to authenticated using(private.trade_reader(domain,business_id) and (private.member(business_id) or status<>'draft'));

create function private.trade_payload(d text,p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare q numeric; kg numeric; u text; money numeric; a date; z date; k text;
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Trade details required'; end if;
 for k in select jsonb_object_keys(p) loop
  if k<>all(array['origin','grade','process','quantity','unit','price','currency','price_unit','trade_type','incoterm','destination','location','window_start','window_end','specifications','packaging','sample_requirements','document_requirements']) then raise exception 'Unknown trade field'; end if;
 end loop;
 if coalesce(length(trim(p->>'origin')),0) not between 2 and 160 or coalesce(length(trim(p->>'grade')),0) not between 1 and 80
 or coalesce(p->>'process','') not in ('washed','natural','honey','other')
 or coalesce(p->>'trade_type','') not in ('international','domestic','exporter_to_exporter') then raise exception 'Check trade details'; end if;
 foreach k in array array['destination','location','specifications','packaging','sample_requirements','document_requirements'] loop
  if length(coalesce(p->>k,''))>1000 or coalesce(p->>k,'') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' then raise exception 'Invalid trade text'; end if;
 end loop;
 if d='request' and coalesce(length(trim(p->>'destination')),0)<2 or d='lot' and coalesce(length(trim(p->>'location')),0)<2 then raise exception 'Destination or location required'; end if;
 if coalesce(p->>'quantity','') !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then raise exception 'Invalid quantity'; end if;
 q=(p->>'quantity')::numeric;u=p->>'unit';
 if q<=0 or u is null or u not in ('kg','feresula','lb') then raise exception 'Invalid quantity unit'; end if;
 kg=round(case u when 'feresula' then q*17 when 'lb' then q/2.2046226218 else q end,6);
 if kg<=0 then raise exception 'Quantity too small'; end if;
 if coalesce(p->>'price','')<>'' then
  if p->>'price' !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then raise exception 'Invalid price'; end if;
  money=(p->>'price')::numeric;
  if money<=0 or coalesce(p->>'currency','') !~ '^[A-Z]{3}$' or coalesce(p->>'price_unit','') not in ('kg','feresula','lb') then raise exception 'Invalid price unit or currency'; end if;
 elsif d='lot' then raise exception 'Private asking price required'; end if;
 if coalesce(p->>'window_start','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'window_end','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Dates required'; end if;
 a=(p->>'window_start')::date;z=(p->>'window_end')::date;if z<a then raise exception 'Invalid date range'; end if;
 if coalesce(p->>'incoterm','to_be_agreed') not in ('EXW','FCA','FOB','CFR','CIF','DAP','to_be_agreed') then raise exception 'Invalid incoterm';end if;
 return p||jsonb_build_object('quantity_kg',kg,'incoterm',coalesce(p->>'incoterm','to_be_agreed'));
end $$;
revoke all on function private.trade_payload(text,jsonb) from public,anon,authenticated;

create function private.trade_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.trade_record_history(domain,record_id,business_id,revision,status,payload,actor_id,reason)
 values(case when TG_TABLE_NAME='buyer_requests' then 'request' else 'lot' end,new.id,new.business_id,new.revision,new.status,new.payload,auth.uid(),new.reason);
 return new;
end $$;
revoke all on function private.trade_history() from public,anon,authenticated;
create trigger request_history after insert or update on public.buyer_requests for each row execute function private.trade_history();
create trigger lot_history after insert or update on public.coffee_lots for each row execute function private.trade_history();
create trigger trade_history_immutable before update or delete on public.trade_record_history for each row execute function private.immutable_audit();
create trigger request_audit after insert or update on public.buyer_requests for each row execute function private.audit();
create trigger lot_audit after insert or update on public.coffee_lots for each row execute function private.audit();

create function public.save_trade_record(d text,b uuid,i uuid,v integer,p jsonb,s text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;oldrow record; normalized jsonb; table_name text;
begin
 perform private.authorization_lock();actor=private.trade_actor();
 if d is null or d not in ('request','lot') or i is null or v is null or v<0 then raise exception 'Invalid trade record'; end if;
 if not private.member(b,array['owner','admin','trader','operations']) or not private.trade_capability(b,case when d='request' then 'buyer' else 'supplier' end,d='lot') then raise exception 'Business capability or role required' using errcode='42501'; end if;
 if p->>'trade_type'='domestic' and not exists(select 1 from public.businesses where id=b and lower(trim(country))='ethiopia') then raise exception 'Domestic trading requires an Ethiopian business' using errcode='42501';end if;
 table_name=case when d='request' then 'buyer_requests' else 'coffee_lots' end;
 execute format('select * from public.%I where id=$1 for update',table_name) into oldrow using i;
 if oldrow.id is not null and oldrow.business_id<>b then raise exception 'Record unavailable' using errcode='42501'; end if;
 -- Repeat creation with the same id is idempotent; it does not create a second record.
 if v=0 and oldrow.id is not null then return i; end if;
 if (oldrow.id is null and v<>0) or (oldrow.id is not null and oldrow.revision<>v) then raise exception 'Record changed. Reload before trying again.' using errcode='40001'; end if;
 if s is null or s not in ('draft','submitted','withdrawn') then raise exception 'Invalid transition'; end if;
 if oldrow.id is null and s='withdrawn' or oldrow.id is not null and oldrow.status in ('withdrawn','closed','exhausted') then raise exception 'Invalid transition'; end if;
 if s='withdrawn' and oldrow.id is not null then normalized=oldrow.payload;
 else normalized=private.trade_payload(d,p);end if;
 -- Editing reviewed input forces resubmission, never preserves staff approval.
 if oldrow.id is not null and oldrow.status in ('qualified','approved','in_review','rejected') and s='draft' then raise exception 'Reviewed records must be resubmitted or withdrawn'; end if;
 -- Quota identity is derived only from the current actor, never a browser-chosen key.
 perform private.rate_limit('phase2_record:'||actor::text||':'||d||case when oldrow.id is null then ':create' else ':edit' end,case when oldrow.id is null then 20 else 100 end,3600);
 if oldrow.id is null then
  execute format('insert into public.%I(id,business_id,created_by,payload,status) values($1,$2,$3,$4,$5)',table_name) using i,b,actor,normalized,s;
 else execute format('update public.%I set payload=$1,status=$2,revision=revision+1,reason=null,updated_at=now() where id=$3',table_name) using normalized,s,i;end if;
 return i;
end $$;
revoke all on function public.save_trade_record(text,uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_trade_record(text,uuid,uuid,integer,jsonb,text) to authenticated;

create function public.review_trade_record(d text,i uuid,v integer,s text,r text) returns void
language plpgsql security definer set search_path='' as $$
declare rowdata record; table_name text;
begin
 perform private.authorization_lock();perform private.trade_actor();
 if d is null or d not in ('request','lot') or v is null or v<1 or coalesce(length(trim(r)),0) not between 5 and 1000 then raise exception 'Review reason and revision required'; end if;
 table_name=case when d='request' then 'buyer_requests' else 'coffee_lots' end;
 execute format('select * from public.%I where id=$1 for update',table_name) into rowdata using i;
 if rowdata.id is null or not private.staff(case when d='request' then 'trading.requests.review' else 'trading.lots.review' end,rowdata.business_id)
 or private.member(rowdata.business_id) then raise exception 'Independent MFA reviewer required' using errcode='42501';end if;
 if rowdata.revision<>v then raise exception 'Record changed. Reload before trying again.' using errcode='40001';end if;
 if not private.trade_capability(rowdata.business_id,case when d='request' then 'buyer' else 'supplier' end,d='lot') then raise exception 'Business no longer eligible' using errcode='42501';end if;
 if s is null or not ((rowdata.status='submitted' and s='in_review') or (rowdata.status='in_review' and ((d='request' and s in ('qualified','closed')) or (d='lot' and s in ('approved','rejected'))))) then raise exception 'Invalid transition';end if;
 if rowdata.payload->>'trade_type'='exporter_to_exporter' and s in ('qualified','approved') then raise exception 'Transaction-specific legal clearance not implemented';end if;
 execute format('update public.%I set status=$1,reason=$2,revision=revision+1,updated_at=now() where id=$3',table_name) using s,trim(r),i;
end $$;
revoke all on function public.review_trade_record(text,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.review_trade_record(text,uuid,integer,text,text) to authenticated;

create function public.create_trading_invitation(email_address text,perms text[],hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 perform private.authorization_lock();perform private.trade_actor();
 if not private.staff('staff.manage') then raise exception 'MFA staff manager required' using errcode='42501';end if;
 if perms is null or cardinality(perms)=0 or not perms<@array['trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage']
 or email_address is null or length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation';end if;
 perform private.rate_limit('trading_invitation:'||auth.uid()::text,20,3600);
 insert into public.invitations(email,permissions,token_hash,invited_by) values(lower(trim(email_address)),perms,hash,auth.uid()) returning id into i;return i;
end $$;
revoke all on function public.create_trading_invitation(text,text[],text) from public,anon,authenticated;
grant execute on function public.create_trading_invitation(text,text[],text) to authenticated;
commit;
