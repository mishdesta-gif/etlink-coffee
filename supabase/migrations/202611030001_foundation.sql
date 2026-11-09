-- Phase 1 only. Apply to a new, isolated development/staging Supabase project after review.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
-- Defaults belong to the creating role. Global PUBLIC function execution must be
-- removed globally; a schema-only REVOKE cannot subtract that inherited grant.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema private revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id),
  display_name text not null default '' check (length(display_name) <= 100),
  optional_notifications boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  country text not null check (length(trim(country)) between 2 and 80),
  kind text not null check (kind in ('overseas_buyer','domestic_buyer','farmer','cooperative','trader','exporter','exporter_sourcing')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.memberships (
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','trader','operations','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id);
create table public.capabilities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  capability text not null check (capability in ('buyer','supplier')),
  status text not null default 'submitted' check (status in ('submitted','under_review','more_information_required','approved','rejected','suspended')),
  details text not null check (length(details) between 10 and 4000),
  revision integer not null default 1,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id,capability),
  check (status <> 'approved' or (reviewed_by is not null and expires_at is not null))
);
create table public.staff_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  permission text not null check (permission in ('staff.manage','verification.review','inquiry.manage','audit.read')),
  business_id uuid references public.businesses(id),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique nulls not distinct (user_id,permission,business_id)
);
create index staff_grants_user_idx on public.staff_grants(user_id) where revoked_at is null;
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text check (role in ('admin','trader','operations','viewer')),
  permissions text[],
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '3 days',
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((business_id is not null and role is not null and permissions is null) or (business_id is null and role is null and cardinality(permissions)>0))
);
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  created_by uuid not null references auth.users(id),
  object_path text not null unique,
  label text not null check (length(label) between 2 and 100),
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default 'INQ-' || gen_random_uuid()::text,
  user_id uuid references auth.users(id),
  category text not null check (category in ('buyer','supplier','exporter_to_exporter','general')),
  name text not null check (length(name) between 2 and 100),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  business_name text not null check (length(business_name) between 2 and 160),
  country text not null check (length(country) between 2 and 80),
  message text not null check (length(message) between 20 and 4000),
  status text not null default 'new' check (status in ('new','in_review','awaiting_response','resolved','closed')),
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  assigned_to uuid references auth.users(id),
  due_at timestamptz not null default now()+interval '2 days',
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index inquiries_queue_idx on public.inquiries(status,created_at);
create index inquiries_user_idx on public.inquiries(user_id);
create table public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id),
  actor_id uuid not null references auth.users(id),
  internal boolean not null default true,
  body text not null check (length(body) between 2 and 4000),
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id),
  business_id uuid references public.businesses(id),
  event_key text not null,
  kind text not null,
  -- Content is intentionally generic: details are read through authorized screens.
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id,event_key)
);
create index notifications_recipient_idx on public.notifications(recipient_id,created_at);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id),
  channel text not null default 'email' check (channel='email'),
  status text not null default 'disabled' check (status in ('disabled','pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text,
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  business_id uuid,
  action text not null,
  object_id text not null,
  previous_state jsonb,
  new_state jsonb,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
create index audit_events_business_idx on public.audit_events(business_id,id);
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

create function private.require_user() returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirmed sign-in required' using errcode='42501';
  end if;
  return auth.uid();
end $$;
create function private.member(b uuid, roles text[] default array['owner','admin','trader','operations','viewer']) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships m join public.businesses b on b.id=m.business_id
    where m.business_id=$1 and m.user_id=auth.uid() and m.active and m.role=any($2) and b.archived_at is null)
$$;
create function private.staff(p text,b uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal','')='aal2' and exists(select 1 from public.staff_grants g
    where g.user_id=auth.uid() and g.revoked_at is null and g.permission=p
    and (g.business_id is null or g.business_id=b))
$$;
create function public.has_permission(p text,b uuid default null) returns boolean
language sql stable security invoker set search_path='' as $$ select private.staff(p,b) $$;
create function public.guard_auth(fingerprint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request'; end if;
 perform private.rate_limit('auth-global',100,60);
 perform private.rate_limit('auth:'||fingerprint,10,600);
end $$;
create function public.entitlements(b uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'buyer_request_eligible',private.member(b,array['owner','admin','trader','operations']) and exists(select 1 from public.capabilities where business_id=b and capability='buyer' and status<>'suspended'),
 'buyer_restricted_eligible',private.member(b) and exists(select 1 from public.capabilities where business_id=b and capability='buyer' and status='approved' and expires_at>now() and revoked_at is null),
 'supplier_lot_eligible',private.member(b,array['owner','admin','trader','operations']) and exists(select 1 from public.capabilities where business_id=b and capability='supplier' and status='approved' and expires_at>now() and revoked_at is null),
 'trading_enabled',false,'exporter_to_exporter_cleared',false)
$$;
create function private.rate_limit(k text, maximum integer, seconds integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.rate_limits values(k,now(),1) on conflict(key) do update set
 hits=case when private.rate_limits.window_start < now()-make_interval(secs=>seconds) then 1 else private.rate_limits.hits+1 end,
 window_start=case when private.rate_limits.window_start < now()-make_interval(secs=>seconds) then now() else private.rate_limits.window_start end
 returning hits into n;
 if n>maximum then raise exception 'Too many requests. Please try later.' using errcode='P0001'; end if;
end $$;
create function private.audit() returns trigger language plpgsql security definer set search_path='' as $$
declare oldj jsonb; newj jsonb; bid uuid;
begin
 -- Never log inquiry bodies, email, document paths, names, or invitation hashes.
 if TG_OP<>'INSERT' then oldj=jsonb_strip_nulls(jsonb_build_object('status',to_jsonb(old)->'status','role',to_jsonb(old)->'role','active',to_jsonb(old)->'active','revision',to_jsonb(old)->'revision','revoked_at',to_jsonb(old)->'revoked_at')); end if;
 newj=jsonb_strip_nulls(jsonb_build_object('status',to_jsonb(new)->'status','role',to_jsonb(new)->'role','active',to_jsonb(new)->'active','revision',to_jsonb(new)->'revision','revoked_at',to_jsonb(new)->'revoked_at'));
 bid=case when TG_TABLE_NAME='businesses' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'business_id')::uuid end;
 insert into public.audit_events(actor_id,business_id,action,object_id,previous_state,new_state,reason)
 values(auth.uid(),bid,TG_TABLE_NAME||'.'||lower(TG_OP),coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'user_id'),oldj,newj,to_jsonb(new)->>'reason');
 return new;
end $$;
create function private.immutable_audit() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Audit history is append-only'; end $$;
create trigger audit_immutable before update or delete on public.audit_events for each row execute function private.immutable_audit();
do $$ declare t text; begin
 foreach t in array array['businesses','memberships','capabilities','staff_grants','invitations','documents','inquiries','inquiry_messages'] loop
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit()',t);
 end loop;
end $$;
create function private.notify(u uuid,b uuid,k text,kind text,msg text) returns void language plpgsql security definer set search_path='' as $$
declare nid uuid;
begin
 if not private.notification_authorized(u,b,kind) then return; end if;
 insert into public.notifications(recipient_id,business_id,event_key,kind,message) values(u,b,k,kind,msg) on conflict do nothing returning id into nid;
 if nid is not null then insert into public.notification_deliveries(notification_id) values(nid); end if;
end $$;

create function private.notification_authorized(u uuid,b uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=u and email_confirmed_at is not null) and
 case
 when k='verification_queue' then b is not null and exists(select 1 from public.businesses where id=b and archived_at is null) and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='verification.review' and g.revoked_at is null and (g.business_id is null or g.business_id=b))
 when k='inquiry_queue' then b is null and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='inquiry.manage' and g.business_id is null and g.revoked_at is null)
 when k in ('registration','verification','inquiry') then b is null or exists(select 1 from public.memberships m join public.businesses biz on biz.id=m.business_id where m.user_id=u and m.business_id=b and m.active and biz.archived_at is null)
 else false end
$$;
create function private.my_notification_authorized(b uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.notification_authorized(auth.uid(),b,k)
 and case when k='verification_queue' then private.staff('verification.review',b)
          when k='inquiry_queue' then private.staff('inquiry.manage') else true end
$$;

create function public.save_profile(n text,optional boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_user();
 insert into public.profiles(user_id,display_name,optional_notifications) values(auth.uid(),trim(n),optional)
 on conflict(user_id) do update set display_name=excluded.display_name,optional_notifications=excluded.optional_notifications;
end $$;
create function public.register_business(n text,c text,k text,cap text,d text) returns uuid language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 perform private.require_user(); perform private.rate_limit('business:'||auth.uid(),5,3600);
 if cap not in ('buyer','supplier') then raise exception 'Invalid capability'; end if;
 if cap='supplier' and lower(trim(c))<>'ethiopia' then raise exception 'Supplier capability requires an Ethiopian business'; end if;
 if k in ('domestic_buyer','farmer','cooperative','trader','exporter','exporter_sourcing') and lower(trim(c))<>'ethiopia' then raise exception 'This registration path requires Ethiopia'; end if;
 insert into public.businesses(name,country,kind,created_by) values(trim(n),trim(c),k,auth.uid()) returning id into b;
 insert into public.memberships(business_id,user_id,role) values(b,auth.uid(),'owner');
 insert into public.capabilities(business_id,capability,details) values(b,cap,trim(d));
 perform private.notify(auth.uid(),b,'business:'||b,'registration','Your business application was submitted for review.');
 return b;
end $$;
create function public.update_business(b uuid,n text,c text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_user();
 if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
 if exists(select 1 from public.businesses where id=b and kind<>'overseas_buyer') and lower(trim(c))<>'ethiopia' then raise exception 'Country must be Ethiopia'; end if;
 update public.businesses set name=trim(n),country=trim(c) where id=b;
 -- Material profile changes require a new independent review of both capabilities.
 update public.capabilities set status='submitted',revision=revision+1,reviewed_by=null,reviewed_at=null,expires_at=null,revoked_at=now(),reason='Business profile changed; review required' where business_id=b and status<>'suspended';
end $$;
create function public.submit_capability(b uuid,cap text,d text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_user();
 if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
 if cap='supplier' and not exists(select 1 from public.businesses where id=b and lower(country)='ethiopia') then raise exception 'Supplier capability requires an Ethiopian business'; end if;
 perform private.rate_limit('capability:'||auth.uid(),10,3600);
 insert into public.capabilities(business_id,capability,details) values(b,cap,trim(d)) on conflict(business_id,capability) do update
 set details=excluded.details,status='submitted',revision=public.capabilities.revision+1,reviewed_by=null,reviewed_at=null,expires_at=null,revoked_at=null,reason=null
 where public.capabilities.status in ('submitted','more_information_required','rejected');
 if not found then raise exception 'Application cannot be changed in its current state'; end if;
end $$;
create function public.review_capability(i uuid,v integer,s text,r text,e timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.capabilities; u record;
begin
 perform private.require_user(); select * into a from public.capabilities where id=i for update;
 if not found or not private.staff('verification.review',a.business_id) or exists(select 1 from public.memberships where business_id=a.business_id and user_id=auth.uid()) then raise exception 'Independent authorized reviewer required' using errcode='42501'; end if;
 if v is null or v<1 or a.revision is distinct from v then raise exception 'Application changed. Reload before reviewing.'; end if;
 if coalesce(length(trim(r)),0) not between 5 and 1000 then raise exception 'A review reason is required'; end if;
 if not ((a.status='submitted' and s='under_review') or (a.status='under_review' and s in ('approved','rejected','more_information_required')) or (a.status='approved' and s='suspended') or (a.status='suspended' and s='under_review')) then raise exception 'Invalid verification transition'; end if;
 if s='approved' and (e is null or e<=now() or e>now()+interval '2 years') then raise exception 'Valid expiry required (up to two years)'; end if;
 update public.capabilities set status=s,revision=revision+1,reviewed_by=auth.uid(),reviewed_at=now(),reason=trim(r),expires_at=case when s='approved' then e else null end,revoked_at=case when s='suspended' then now() else null end where id=i;
 for u in select user_id from public.memberships where business_id=a.business_id and active and role in ('owner','admin') loop
 perform private.notify(u.user_id,a.business_id,'verification:'||i||':'||(v+1),'verification','A business verification decision is ready in your workspace.'); end loop;
end $$;

-- Tokens are generated on the server; only SHA-256 hashes are stored. No outbound email is sent.
create function public.create_invitation(b uuid,email_address text,team_role text,perms text[],hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 perform private.require_user();
 if b is null then
   if not private.staff('staff.manage') then raise exception 'Not permitted' using errcode='42501'; end if;
   if exists(select 1 from auth.users where id=auth.uid() and lower(email)=lower(trim(email_address))) then raise exception 'Independent staff invitation required' using errcode='42501'; end if;
   if perms is null or cardinality(perms)=0 or not perms <@ array['staff.manage','verification.review','inquiry.manage','audit.read'] then raise exception 'Invalid permissions'; end if;
 else
   if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
   if team_role='admin' and not private.member(b,array['owner']) then raise exception 'Only owner can invite administrators'; end if;
 end if;
 if hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token'; end if;
 perform private.rate_limit('invite:'||auth.uid(),20,3600);
 insert into public.invitations(business_id,email,role,permissions,token_hash,invited_by) values(b,lower(trim(email_address)),case when b is null then null else team_role end,case when b is null then perms else null end,hash,auth.uid()) returning id into i;
 return i;
end $$;
create function public.accept_invitation(hash text) returns void language plpgsql security definer set search_path='' as $$
declare inv public.invitations; p text; em text;
begin
 perform private.require_user(); perform private.rate_limit('accept:'||auth.uid(),20,3600);
 select lower(email) into em from auth.users where id=auth.uid();
 select * into inv from public.invitations where token_hash=hash and accepted_at is null and expires_at>now() for update;
 if not found or inv.email is distinct from em then raise exception 'Invalid or expired invitation' using errcode='42501'; end if;
 if inv.business_id is null then
   if inv.invited_by=auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2' or not exists(select 1 from public.staff_grants where user_id=inv.invited_by and permission='staff.manage' and business_id is null and revoked_at is null) then raise exception 'MFA and independent active inviter required' using errcode='42501'; end if;
   foreach p in array inv.permissions loop
     insert into public.staff_grants(user_id,permission,granted_by) values(auth.uid(),p,inv.invited_by) on conflict(user_id,permission,business_id) do update set revoked_at=null,granted_by=inv.invited_by;
   end loop;
 else
   if not exists(select 1 from public.memberships where business_id=inv.business_id and user_id=inv.invited_by and active and role=any(case when inv.role='admin' then array['owner'] else array['owner','admin'] end)) then raise exception 'Invitation no longer authorized'; end if;
   insert into public.memberships(business_id,user_id,role) values(inv.business_id,auth.uid(),inv.role) on conflict do nothing;
 end if;
 update public.invitations set accepted_by=auth.uid(),accepted_at=now() where id=inv.id;
end $$;
create function public.set_member(b uuid,u uuid,r text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.memberships;
begin
 perform private.require_user();
 -- Lock the business row to serialize concurrent team changes.
 perform 1 from public.businesses where id=b for update;
 select * into m from public.memberships where business_id=b and user_id=u;
 if not found or not private.member(b,array['owner']) or m.role='owner' or r not in ('admin','trader','operations','viewer') then raise exception 'Owner permission required; ownership is protected' using errcode='42501'; end if;
 update public.memberships set role=r,active=enabled where business_id=b and user_id=u;
end $$;
create function public.revoke_staff(i uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_user();
 if not private.staff('staff.manage') or exists(select 1 from public.staff_grants where id=i and user_id=auth.uid()) then raise exception 'Independent staff manager required' using errcode='42501'; end if;
 update public.staff_grants set revoked_at=now() where id=i and revoked_at is null;
end $$;

-- Guest intake is RPC-only. These email/global quotas also apply to direct Data API calls.
create function public.submit_inquiry(cat text,n text,em text,bn text,c text,msg text,website text default '') returns text language plpgsql security definer set search_path='' as $$
declare i uuid; ref text; staff_user record;
begin
 if length(coalesce(website,''))>0 then raise exception 'Submission rejected'; end if;
 perform private.rate_limit('inquiry-global',100,3600);
 perform private.rate_limit('inquiry-email:'||md5(lower(trim(em))),3,3600);
 insert into public.inquiries(user_id,category,name,email,business_name,country,message) values(auth.uid(),cat,trim(n),lower(trim(em)),trim(bn),trim(c),trim(msg)) returning id,reference into i,ref;
 if auth.uid() is not null then perform private.notify(auth.uid(),null,'inquiry:'||i,'inquiry','Your inquiry was received. ET Link will review it.'); end if;
 for staff_user in select distinct user_id from public.staff_grants where permission='inquiry.manage' and business_id is null and revoked_at is null loop
 perform private.notify(staff_user.user_id,null,'inquiry-queue:'||i,'inquiry_queue','A new inquiry needs review.'); end loop;
 return ref;
end $$;
create function public.manage_inquiry(i uuid,v integer,s text,p text,assignee uuid,note text,internal_note boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare q public.inquiries;
begin
 perform private.require_user();
 if not private.staff('inquiry.manage') then raise exception 'Not permitted' using errcode='42501'; end if;
 select * into q from public.inquiries where id=i for update;
 if not found or v is null or v<1 or q.revision is distinct from v then raise exception 'Inquiry changed. Reload before editing.'; end if;
 if assignee is not null and not exists(select 1 from public.staff_grants where user_id=assignee and permission='inquiry.manage' and business_id is null and revoked_at is null) then raise exception 'Assignee must be an authorized inquiry officer'; end if;
 if not ((q.status='new' and s in ('new','in_review','closed')) or (q.status='in_review' and s in ('in_review','awaiting_response','resolved','closed')) or (q.status='awaiting_response' and s in ('awaiting_response','in_review','resolved','closed')) or (q.status='resolved' and s in ('resolved','in_review','closed')) or (q.status='closed' and s='in_review')) then raise exception 'Invalid inquiry transition'; end if;
 if not internal_note and q.user_id is null then raise exception 'Guest replies require an approved external communication channel'; end if;
 update public.inquiries set status=s,priority=p,assigned_to=assignee,revision=revision+1 where id=i;
 if length(trim(coalesce(note,'')))>0 then insert into public.inquiry_messages(inquiry_id,actor_id,internal,body) values(i,auth.uid(),internal_note,trim(note)); end if;
 if q.user_id is not null then perform private.notify(q.user_id,null,'inquiry-update:'||i||':'||(v+1),'inquiry','Your inquiry has an update in your workspace.'); end if;
end $$;
create function public.mark_notification(i uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_user(); update public.notifications set read_at=now() where id=i and recipient_id=auth.uid() and private.my_notification_authorized(business_id,kind); end $$;
create function public.prepare_document(b uuid,n text,mime text,bytes integer,sha text) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid=gen_random_uuid();
begin
 perform private.require_user();
 if not private.member(b,array['owner','admin','operations']) then raise exception 'Not permitted' using errcode='42501'; end if;
 perform private.rate_limit('document:'||auth.uid(),20,3600);
 if sha is null or sha !~ '^[a-f0-9]{64}$' then raise exception 'Valid content hash required'; end if;
 insert into public.documents(id,business_id,created_by,object_path,label,mime_type,size_bytes,content_sha256) values(i,b,auth.uid(),b::text||'/'||i::text,trim(n),mime,bytes,sha);
 return i;
end $$;

-- RLS: all client mutations go through narrowly authorized functions.
do $$ declare t text; begin
 foreach t in array array['profiles','businesses','memberships','capabilities','staff_grants','invitations','documents','inquiries','inquiry_messages','notifications','notification_deliveries','audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 end loop;
end $$;
grant select on public.profiles,public.businesses,public.memberships,public.capabilities,public.staff_grants,public.documents,public.inquiries,public.inquiry_messages,public.notifications,public.notification_deliveries,public.audit_events to authenticated;
-- Invitation hashes are never selectable, including by staff.
grant select(id,business_id,email,role,permissions,invited_by,expires_at,accepted_at,created_at) on public.invitations to authenticated;
create policy profiles_own on public.profiles for select to authenticated using (user_id=auth.uid());
create policy businesses_read on public.businesses for select to authenticated using (private.member(id) or private.staff('verification.review',id));
create policy memberships_read on public.memberships for select to authenticated using (private.member(business_id));
create policy capabilities_read on public.capabilities for select to authenticated using (private.member(business_id) or private.staff('verification.review',business_id));
create policy staff_read on public.staff_grants for select to authenticated using (user_id=auth.uid() or private.staff('staff.manage'));
create policy invitation_read on public.invitations for select to authenticated using ((business_id is not null and private.member(business_id,array['owner','admin'])) or (business_id is null and private.staff('staff.manage')));
create policy documents_read on public.documents for select to authenticated using (private.member(business_id) or private.staff('verification.review',business_id));
create policy inquiries_read on public.inquiries for select to authenticated using (user_id=auth.uid() or private.staff('inquiry.manage'));
create policy inquiry_messages_read on public.inquiry_messages for select to authenticated using (private.staff('inquiry.manage') or (not internal and exists(select 1 from public.inquiries where id=inquiry_id and user_id=auth.uid())));
create policy notifications_read on public.notifications for select to authenticated using (recipient_id=auth.uid() and private.my_notification_authorized(business_id,kind));
create policy deliveries_read on public.notification_deliveries for select to authenticated using (exists(select 1 from public.notifications where id=notification_id));
create policy audit_read on public.audit_events for select to authenticated using (private.staff('audit.read',business_id));

-- Supabase Storage: only verification uploads in Phase 1; future buckets deny access by default.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('verification','verification',false,5242880,array['application/pdf','image/png','image/jpeg']),
 ('licenses','licenses',false,5242880,array['application/pdf','image/png','image/jpeg']),
 ('agreements','agreements',false,5242880,array['application/pdf']),
 ('samples','samples',false,5242880,array['application/pdf','image/png','image/jpeg']),
 ('transactions','transactions',false,5242880,array['application/pdf'])
 on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id=any(array['verification','licenses','agreements','samples','transactions']) and
 (public is distinct from false or file_size_limit is null or file_size_limit>5242880 or allowed_mime_types is null or not allowed_mime_types <@ array['application/pdf','image/png','image/jpeg'])) then
 raise exception 'Existing storage bucket configuration requires review before migration';
 end if;
end $$;
create policy verification_upload on storage.objects for insert to authenticated with check (
 bucket_id='verification' and exists(select 1 from public.documents d where d.object_path=name and d.created_by=auth.uid() and private.member(d.business_id,array['owner','admin','operations']))
);
create policy verification_read on storage.objects for select to authenticated using (
 bucket_id='verification' and exists(select 1 from public.documents d where d.object_path=name and (private.member(d.business_id) or private.staff('verification.review',d.business_id)))
);

-- Deny PostgreSQL's default PUBLIC function execution, including all definer helpers.
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.member(uuid,text[]),private.staff(text,uuid),private.my_notification_authorized(uuid,text) to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array['has_permission','guard_auth','entitlements','save_profile','register_business','update_business','submit_capability','review_capability','create_invitation','accept_invitation','set_member','revoke_staff','submit_inquiry','manage_inquiry','mark_notification','prepare_document']) loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.has_permission(text,uuid),public.entitlements(uuid),public.save_profile(text,boolean),public.register_business(text,text,text,text,text),public.update_business(uuid,text,text),public.submit_capability(uuid,text,text),public.review_capability(uuid,integer,text,text,timestamptz),public.create_invitation(uuid,text,text,text[],text),public.accept_invitation(text),public.set_member(uuid,uuid,text,boolean),public.revoke_staff(uuid),public.manage_inquiry(uuid,integer,text,text,uuid,text,boolean),public.mark_notification(uuid),public.prepare_document(uuid,text,text,integer,text) to authenticated;
grant execute on function public.submit_inquiry(text,text,text,text,text,text,text) to anon,authenticated;
grant execute on function public.guard_auth(text) to anon,authenticated;
-- Current RPC grants are explicit; future-object defaults were hardened above.
commit;
