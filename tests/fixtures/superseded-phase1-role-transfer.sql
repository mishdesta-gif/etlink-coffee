-- Forward-only Phase 1 corrective migration. Depends on the four reviewed 20261103 migrations.
-- LOCAL CANDIDATE ONLY. Never run without separate staging approval.
begin;
create role etlink_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
-- postgres needs membership and temporary schema CREATE only to transfer ownership.
grant etlink_executor to postgres;
grant usage on schema public,private,auth,storage to etlink_executor;
grant create on schema public,private to etlink_executor;
alter default privileges for role etlink_executor revoke execute on functions from public,anon,authenticated;
alter default privileges for role etlink_executor in schema public revoke all on tables from public,anon,authenticated;
alter default privileges for role etlink_executor in schema public revoke all on sequences from public,anon,authenticated;
alter default privileges for role postgres revoke execute on functions from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public,anon,authenticated;

-- Active sessions are checked against current server-side Auth records, never user_metadata.
create function private.active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=auth.uid() and u.email_confirmed_at is not null
 and (u.banned_until is null or u.banned_until<=now())
 and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()))
$$;
revoke all on function private.active_user() from public,anon,authenticated;
grant execute on function private.active_user() to authenticated;

-- Trigger locks serialize authorization changes and sensitive operations across sessions.
-- Deliberately coarse Phase 1 lock: one global authorization mutation lane.
create function private.authorization_lock() returns void language sql volatile security invoker set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(194781,1)
$$;
revoke all on function private.authorization_lock() from public,anon,authenticated;
create function private.lock_authorization_change() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.authorization_lock(); return null; end $$;
revoke all on function private.lock_authorization_change() from public,anon,authenticated;
create trigger membership_authorization_lock before insert or update or delete on public.memberships for each statement execute function private.lock_authorization_change();
create trigger staff_authorization_lock before insert or update or delete on public.staff_grants for each statement execute function private.lock_authorization_change();
create trigger business_authorization_lock before update or delete on public.businesses for each statement execute function private.lock_authorization_change();

-- Do not permit a client to directly spend login quotas or insert guest inquiries.
revoke execute on function public.guard_auth(text),public.submit_inquiry(text,text,text,text,text,text,text) from public,anon,authenticated;
create or replace function public.guard_auth(fingerprint text) returns void language plpgsql security invoker set search_path='' as $$
begin raise exception 'Public quota guard retired; trusted ingress required' using errcode='42501'; end $$;

-- Independent committed RPC budget reservation: failures in the subsequent Auth call cannot undo it.
create table private.ingress_budgets(key text primary key,window_start timestamptz not null,hits integer not null);
alter table private.ingress_budgets enable row level security;
revoke all on private.ingress_budgets from public,anon,authenticated;
create function public.reserve_ingress_budget(scope text,identity_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare amount integer; cap integer; span integer;
begin
 if scope is null or scope not in ('auth','inquiry') or identity_hash is null or identity_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid ingress budget'; end if;
 cap=case when scope='auth' then 10 else 3 end; span=case when scope='auth' then 600 else 3600 end;
 -- Expired keys only; no customer data. Keep expiry maintenance bounded per request.
 delete from private.ingress_budgets where key in (select key from private.ingress_budgets where window_start<now()-interval '1 day' limit 100);
 insert into private.ingress_budgets as q values(scope||':'||identity_hash,clock_timestamp(),1)
 on conflict(key) do update set hits=case when q.window_start<clock_timestamp()-make_interval(secs=>span) then 1 else least(q.hits+1,100000) end,
 window_start=case when q.window_start<clock_timestamp()-make_interval(secs=>span) then clock_timestamp() else q.window_start end returning hits into amount;
 return amount<=cap;
end $$;
revoke all on function public.reserve_ingress_budget(text,text) from public,anon,authenticated;
grant execute on function public.reserve_ingress_budget(text,text) to service_role;
create or replace function private.require_user() returns uuid language plpgsql security definer set search_path='' as $$
begin if not private.active_user() then raise exception 'Active confirmed session required' using errcode='42501'; end if; return auth.uid(); end $$;
create or replace function private.member(b uuid,roles text[] default array['owner','admin','trader','operations','viewer']) returns boolean language sql stable security definer set search_path='' as $$
 select private.active_user() and exists(select 1 from public.memberships m join public.businesses biz on biz.id=m.business_id where m.business_id=b and m.user_id=auth.uid() and m.active and m.role=any(roles) and biz.archived_at is null)
$$;
create or replace function private.staff(p text,b uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select private.active_user() and coalesce(auth.jwt()->>'aal','')='aal2' and exists(select 1 from public.staff_grants g where g.user_id=auth.uid() and g.revoked_at is null and g.permission=p and (g.business_id is null or g.business_id=b))
$$;

CREATE OR REPLACE FUNCTION public.create_invitation(b uuid, email_address text, team_role text, perms text[], hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i uuid;
begin
 perform private.authorization_lock();
 perform private.require_user();
 if b is null then
   if not private.staff('staff.manage') then raise exception 'Not permitted' using errcode='42501'; end if;
   if exists(select 1 from auth.users where id=auth.uid() and lower(email)=lower(trim(email_address))) then raise exception 'Independent staff invitation required' using errcode='42501'; end if;
   if perms is null or cardinality(perms)=0 or not perms <@ array['staff.manage','verification.review','inquiry.manage','audit.read'] then raise exception 'Invalid permissions'; end if;
 else
   if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
   if team_role='admin' and not private.member(b,array['owner']) then raise exception 'Only owner can invite administrators'; end if;
 end if;
 if hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token'; end if;
 perform private.rate_limit('invite:'||auth.uid(),20,3600);
 insert into public.invitations(business_id,email,role,permissions,token_hash,invited_by) values(b,lower(trim(email_address)),case when b is null then null else team_role end,case when b is null then perms else null end,hash,auth.uid()) returning id into i;
 return i;
end $function$
;

CREATE OR REPLACE FUNCTION public.accept_invitation(hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invitations; p text; em text;
begin
 perform private.authorization_lock();
 perform private.require_user(); if hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if; perform private.rate_limit('accept:'||auth.uid(),20,3600);
 select lower(email) into em from auth.users where id=auth.uid();
 select * into inv from public.invitations where token_hash=hash and accepted_at is null and expires_at>clock_timestamp() for update;
 if not found or inv.email is distinct from em then raise exception 'Invalid or expired invitation' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=inv.invited_by and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) then raise exception 'Inviter no longer authorized' using errcode='42501'; end if;
 if inv.business_id is null then
   if inv.invited_by=auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2' or not exists(select 1 from public.staff_grants where user_id=inv.invited_by and permission='staff.manage' and business_id is null and revoked_at is null) then raise exception 'MFA and independent active inviter required' using errcode='42501'; end if;
   foreach p in array inv.permissions loop
     insert into public.staff_grants(user_id,permission,granted_by) values(auth.uid(),p,inv.invited_by) on conflict(user_id,permission,business_id) do update set revoked_at=null,granted_by=inv.invited_by;
   end loop;
 else
   if not exists(select 1 from public.businesses where id=inv.business_id and archived_at is null) then raise exception 'Business is unavailable' using errcode='42501'; end if;
   if not exists(select 1 from public.memberships where business_id=inv.business_id and user_id=inv.invited_by and active and role=any(case when inv.role='admin' then array['owner'] else array['owner','admin'] end)) then raise exception 'Invitation no longer authorized'; end if;
   if exists(select 1 from public.memberships where business_id=inv.business_id and user_id=auth.uid() and not active) then raise exception 'Membership revoked; owner action required' using errcode='42501'; end if;
   insert into public.memberships(business_id,user_id,role) values(inv.business_id,auth.uid(),inv.role) on conflict do nothing;
 end if;
 update public.invitations set accepted_by=auth.uid(),accepted_at=now() where id=inv.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_member(b uuid, u uuid, r text, enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.memberships;
begin
 perform private.authorization_lock();
 perform private.require_user();
 -- Lock the business row to serialize concurrent team changes.
 perform 1 from public.businesses where id=b for update;
 select * into m from public.memberships where business_id=b and user_id=u;
 if not found or not private.member(b,array['owner']) or m.role='owner' or r not in ('admin','trader','operations','viewer') then raise exception 'Owner permission required; ownership is protected' using errcode='42501'; end if;
 update public.memberships set role=r,active=enabled where business_id=b and user_id=u;
end $function$
;

CREATE OR REPLACE FUNCTION public.review_capability(i uuid, v integer, s text, r text, e timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.capabilities; u record;
begin
 perform private.authorization_lock();
 perform private.require_user(); select * into a from public.capabilities where id=i for update;
 if not found or not private.staff('verification.review',a.business_id) or exists(select 1 from public.memberships where business_id=a.business_id and user_id=auth.uid()) then raise exception 'Independent authorized reviewer required' using errcode='42501'; end if;
 if not exists(select 1 from public.businesses where id=a.business_id and archived_at is null and (a.capability<>'supplier' or lower(trim(country))='ethiopia')) then raise exception 'Business not eligible for verification' using errcode='42501'; end if;
 if v is null or v<1 or a.revision is distinct from v then raise exception 'Application changed. Reload before reviewing.'; end if;
 if coalesce(length(trim(r)),0) not between 5 and 1000 then raise exception 'A review reason is required'; end if;
 if not ((a.status='submitted' and s='under_review') or (a.status='under_review' and s in ('approved','rejected','more_information_required')) or (a.status='approved' and s='suspended') or (a.status='suspended' and s='under_review')) then raise exception 'Invalid verification transition'; end if;
 if s='approved' and (e is null or e<=now() or e>now()+interval '2 years') then raise exception 'Valid expiry required (up to two years)'; end if;
 update public.capabilities set status=s,revision=revision+1,reviewed_by=auth.uid(),reviewed_at=now(),reason=trim(r),expires_at=case when s='approved' then e else null end,revoked_at=case when s='suspended' then now() else null end where id=i;
 for u in select user_id from public.memberships where business_id=a.business_id and active and role in ('owner','admin') loop
 perform private.notify(u.user_id,a.business_id,'verification:'||i||':'||(v+1),'verification','A business verification decision is ready in your workspace.'); end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.revoke_staff(i uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.authorization_lock();
 perform private.require_user();
 if not private.staff('staff.manage') or exists(select 1 from public.staff_grants where id=i and user_id=auth.uid()) then raise exception 'Independent staff manager required' using errcode='42501'; end if;
 update public.staff_grants set revoked_at=now() where id=i and revoked_at is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_business(b uuid, n text, c text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.authorization_lock();
 perform private.require_user();
 if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
 if exists(select 1 from public.businesses where id=b and kind<>'overseas_buyer') and lower(trim(c))<>'ethiopia' then raise exception 'Country must be Ethiopia'; end if;
 if c is null or (lower(trim(c))<>'ethiopia' and exists(select 1 from public.capabilities where business_id=b and capability='supplier')) then raise exception 'Supplier business must remain Ethiopian'; end if;
 update public.businesses set name=trim(n),country=trim(c) where id=b;
 -- Material profile changes require a new independent review of both capabilities.
 update public.capabilities set status='submitted',revision=revision+1,reviewed_by=null,reviewed_at=null,expires_at=null,revoked_at=now(),reason='Business profile changed; review required' where business_id=b and status<>'suspended';
end $function$
;

CREATE OR REPLACE FUNCTION public.register_business(n text, c text, k text, cap text, d text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b uuid;
begin
 perform private.authorization_lock();
 perform private.require_user(); perform private.rate_limit('business:'||auth.uid(),5,3600);
 if cap not in ('buyer','supplier') then raise exception 'Invalid capability'; end if;
 if cap='supplier' and lower(trim(c))<>'ethiopia' then raise exception 'Supplier capability requires an Ethiopian business'; end if;
 if k in ('domestic_buyer','farmer','cooperative','trader','exporter','exporter_sourcing') and lower(trim(c))<>'ethiopia' then raise exception 'This registration path requires Ethiopia'; end if;
 insert into public.businesses(name,country,kind,created_by) values(trim(n),trim(c),k,auth.uid()) returning id into b;
 insert into public.memberships(business_id,user_id,role) values(b,auth.uid(),'owner');
 insert into public.capabilities(business_id,capability,details) values(b,cap,trim(d));
 perform private.notify(auth.uid(),b,'business:'||b,'registration','Your business application was submitted for review.');
 return b;
end $function$
;

CREATE OR REPLACE FUNCTION public.submit_capability(b uuid, cap text, d text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.authorization_lock();
 perform private.require_user();
 if not private.member(b,array['owner','admin']) then raise exception 'Not permitted' using errcode='42501'; end if;
 if cap='supplier' and not exists(select 1 from public.businesses where id=b and lower(country)='ethiopia') then raise exception 'Supplier capability requires an Ethiopian business'; end if;
 perform private.rate_limit('capability:'||auth.uid(),10,3600);
 insert into public.capabilities(business_id,capability,details) values(b,cap,trim(d)) on conflict(business_id,capability) do update
 set details=excluded.details,status='submitted',revision=public.capabilities.revision+1,reviewed_by=null,reviewed_at=null,expires_at=null,revoked_at=null,reason=null
 where public.capabilities.status in ('submitted','more_information_required','rejected');
 if not found then raise exception 'Application cannot be changed in its current state'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.prepare_document(b uuid, n text, mime text, bytes integer, sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i uuid=gen_random_uuid();
begin
 perform private.authorization_lock();
 perform private.require_user();
 if not private.member(b,array['owner','admin','operations']) then raise exception 'Not permitted' using errcode='42501'; end if;
 perform private.rate_limit('document:'||auth.uid(),20,3600);
 if sha is null or sha !~ '^[a-f0-9]{64}$' then raise exception 'Valid content hash required'; end if;
 insert into public.documents(id,business_id,created_by,object_path,label,mime_type,size_bytes,content_sha256) values(i,b,auth.uid(),b::text||'/'||i::text,trim(n),mime,bytes,sha);
 return i;
end $function$
;

CREATE OR REPLACE FUNCTION public.manage_inquiry(i uuid, v integer, s text, p text, assignee uuid, note text, internal_note boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.inquiries;
begin
 perform private.authorization_lock();
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
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_notification(i uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin perform private.require_user(); update public.notifications set read_at=now() where id=i and recipient_id=auth.uid() and private.my_notification_authorized(business_id,kind); end $function$
;

CREATE OR REPLACE FUNCTION public.save_profile(n text, optional boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.authorization_lock();
 perform private.require_user();
 insert into public.profiles(user_id,display_name,optional_notifications) values(auth.uid(),trim(n),optional)
 on conflict(user_id) do update set display_name=excluded.display_name,optional_notifications=excluded.optional_notifications;
end $function$
;

CREATE OR REPLACE FUNCTION public.finalize_document(i uuid, u uuid, sha text, mime text, bytes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; o storage.objects;
begin
 perform private.authorization_lock();
 select * into d from public.documents where id=i for update;
 if not found or u is null or d.created_by is distinct from u
 or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null and (banned_until is null or banned_until<=now()))
 or not exists(select 1 from public.memberships m join public.businesses b on b.id=m.business_id where m.business_id=d.business_id and m.user_id=u and m.active and m.role in ('owner','admin','operations') and b.archived_at is null)
 then raise exception 'Authorized uploader required' using errcode='42501'; end if;
 if d.object_path is distinct from d.business_id::text||'/'||d.id::text
 or sha is null or sha !~ '^[a-f0-9]{64}$' or d.content_sha256 is distinct from sha
 or d.mime_type is distinct from mime or d.size_bytes is distinct from bytes
 then raise exception 'Validated content does not match prepared document'; end if;
 select * into o from storage.objects where bucket_id='verification' and name=d.object_path for share;
 if not found or o.owner_id is distinct from u::text or o.metadata->>'mimetype' is distinct from mime
 or o.metadata->>'size' is distinct from bytes::text then raise exception 'Stored object metadata or ownership does not match'; end if;
 update public.documents set status='uploaded' where id=i and status='pending';
end $function$
;

CREATE OR REPLACE FUNCTION private.notification_authorized(u uuid, b uuid, k text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from auth.users where id=u and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) and
 case
 when k='verification_queue' then b is not null and exists(select 1 from public.businesses where id=b and archived_at is null) and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='verification.review' and g.revoked_at is null and (g.business_id is null or g.business_id=b))
 when k='inquiry_queue' then b is null and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='inquiry.manage' and g.business_id is null and g.revoked_at is null)
 when k in ('registration','verification','inquiry') then b is null or exists(select 1 from public.memberships m join public.businesses biz on biz.id=m.business_id where m.user_id=u and m.business_id=b and m.active and biz.archived_at is null)
 else false end
$function$
;
create function private.enforce_business_eligibility() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.authorization_lock();
 if TG_TABLE_NAME='businesses' then
  if lower(trim(new.country))<>'ethiopia' and exists(select 1 from public.capabilities where business_id=new.id and capability='supplier') then raise exception 'Supplier business must remain Ethiopian'; end if;
 else
  if new.capability='supplier' and not exists(select 1 from public.businesses where id=new.business_id and lower(trim(country))='ethiopia' and archived_at is null) then raise exception 'Supplier requires active Ethiopian business'; end if;
  if new.status='approved' and not exists(select 1 from public.businesses where id=new.business_id and archived_at is null) then raise exception 'Archived business cannot be approved'; end if;
 end if;
 return new;
end $$;
revoke all on function private.enforce_business_eligibility() from public,anon,authenticated;
create trigger business_eligibility before insert or update on public.businesses for each row execute function private.enforce_business_eligibility();
create trigger capability_eligibility before insert or update on public.capabilities for each row execute function private.enforce_business_eligibility();
alter function public.entitlements(uuid) security invoker;
-- Its existing scoped SELECT grants and member helper suffice; no new client writes.

CREATE OR REPLACE FUNCTION public.submit_trusted_inquiry(cat text, n text, em text, bn text, c text, msg text, website text DEFAULT ''::text, actor uuid DEFAULT NULL::uuid, actor_session uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i uuid; ref text; staff_user record;
begin
 perform private.authorization_lock();
 if actor is not null and not exists(select 1 from auth.users u join auth.sessions se on se.user_id=u.id where u.id=actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and se.id=actor_session and (se.not_after is null or se.not_after>now())) then raise exception 'Active inquiry session required' using errcode='42501'; end if;
 if website is null or cat is null or n is null or em is null or bn is null or c is null or msg is null or octet_length(msg)>16000 or em ~ '[[:cntrl:]]' or n ~ '[[:cntrl:]]' or bn ~ '[[:cntrl:]]' or c ~ '[[:cntrl:]]' then raise exception 'Invalid inquiry input'; end if;
 if length(coalesce(website,''))>0 then raise exception 'Submission rejected'; end if;


 insert into public.inquiries(user_id,category,name,email,business_name,country,message) values(actor,cat,trim(n),lower(trim(em)),trim(bn),trim(c),trim(msg)) returning id,reference into i,ref;
 if actor is not null then perform private.notify(actor,null,'inquiry:'||i,'inquiry','Your inquiry was received. ET Link will review it.'); end if;
 for staff_user in select distinct user_id from public.staff_grants where permission='inquiry.manage' and business_id is null and revoked_at is null loop
 perform private.notify(staff_user.user_id,null,'inquiry-queue:'||i,'inquiry_queue','A new inquiry needs review.'); end loop;
 return ref;
end $function$
;
revoke all on function public.submit_trusted_inquiry(text,text,text,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_trusted_inquiry(text,text,text,text,text,text,text,uuid,uuid) to service_role;

-- Current-account checks also protect self-only RLS reads, not just mutation RPCs.
create policy active_account on public.profiles as restrictive for select to authenticated using(private.active_user());
create policy active_account on public.inquiries as restrictive for select to authenticated using(private.active_user());
create policy active_account on public.inquiry_messages as restrictive for select to authenticated using(private.active_user());
create policy active_account on public.staff_grants as restrictive for select to authenticated using(private.active_user());
create policy active_account on public.notifications as restrictive for select to authenticated using(private.active_user());
create policy active_account on public.notification_deliveries as restrictive for select to authenticated using(private.active_user());
alter table private.rate_limits enable row level security;
-- Restricted NOLOGIN execution role owns functions, not tables, has no RLS bypass or client membership.
grant select,insert,update on public.profiles,public.businesses,public.memberships,public.capabilities,public.staff_grants,public.invitations,public.documents,public.inquiries,public.notifications,public.notification_deliveries to etlink_executor;
grant select,insert on public.inquiry_messages,public.audit_events,public.capability_history to etlink_executor;
grant usage,select on sequence public.audit_events_id_seq to etlink_executor;
grant select,insert,update on private.rate_limits to etlink_executor;
grant select,insert,update,delete on private.ingress_budgets to etlink_executor;
grant select(id,email,email_confirmed_at,banned_until) on auth.users to etlink_executor;
grant select(id,user_id,not_after) on auth.sessions to etlink_executor;
grant select on storage.objects to etlink_executor;
-- PostgreSQL row-share locks require UPDATE privilege on at least one column.
-- A false WITH CHECK forbids actual updates, including id changes, for this role.
grant update(id) on storage.objects to etlink_executor;
grant execute on function auth.uid(),auth.jwt() to etlink_executor;
do $$ declare t text; f record; begin
 foreach t in array array['profiles','businesses','memberships','capabilities','staff_grants','invitations','documents','inquiries','inquiry_messages','notifications','notification_deliveries','audit_events','capability_history'] loop
  execute format('create policy executor_access on public.%I to etlink_executor using(true) with check(true)',t);
 end loop;
 create policy executor_access on private.rate_limits to etlink_executor using(true) with check(true);
 create policy executor_access on private.ingress_budgets to etlink_executor using(true) with check(true);
 -- SELECT only, scoped by SQL finalizer; role never receives storage object mutation privileges.
 create policy executor_object_read on storage.objects for select to etlink_executor using(bucket_id='verification');
 create policy executor_object_lock on storage.objects for update to etlink_executor using(bucket_id='verification') with check(false);
 for f in select p.oid::regprocedure as identity,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  execute format('grant execute on function %s to etlink_executor',f.identity);
  execute format('alter function %s owner to etlink_executor',f.identity);
 end loop;
end $$;
revoke create on schema public,private from etlink_executor;
-- Authenticated callers retain only existing, explicitly reviewed RPC/helper EXECUTE grants.
-- No changes to provider-managed supabase_admin defaults, Auth providers or bucket settings.
commit;
