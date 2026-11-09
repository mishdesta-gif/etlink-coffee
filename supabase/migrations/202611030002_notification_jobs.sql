-- Foundation only: delivery starts disabled; no provider or external communication is enabled.
begin;
create function public.claim_notification_deliveries(batch_size integer default 10)
returns table(delivery_id uuid,notification_id uuid,recipient_id uuid,message text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
 if batch_size is null or batch_size not between 1 and 50 then raise exception 'Invalid batch size'; end if;
 update public.notification_deliveries d set status='failed',lease_until=null,lease_token=null,last_error_code='timeout'
 where d.status='processing' and d.lease_until<now() and d.attempts>=5;
 return query
 with eligible as (
   select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
   where d.attempts<5 and ((d.status in ('pending','failed') and coalesce(d.next_attempt_at,now())<=now()) or (d.status='processing' and d.lease_until<now()))
   and private.notification_authorized(n.recipient_id,n.business_id,n.kind)
   order by d.created_at,d.id for update of d skip locked limit batch_size
 ), claimed as (
   update public.notification_deliveries d set status='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid()
   from eligible e where d.id=e.id returning d.id,d.notification_id,d.lease_token
 ) select c.id,c.notification_id,n.recipient_id,n.message,c.lease_token from claimed c join public.notifications n on n.id=c.notification_id;
end $$;
-- A future sender must recheck this immediately before calling its provider.
-- No sender or provider is enabled by these foundation functions.
create function public.authorize_notification_delivery(i uuid,lease uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
 where d.id=i and d.lease_token=lease and d.status='processing' and d.lease_until>now()
 and private.notification_authorized(n.recipient_id,n.business_id,n.kind))
$$;
create function public.finish_notification_delivery(i uuid,lease uuid,success boolean,code text default null) returns void
language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries;
begin
 select * into d from public.notification_deliveries where id=i for update;
 if not found or d.status<>'processing' or d.lease_token is distinct from lease or d.lease_until<=now() then raise exception 'Delivery lease is not current'; end if;
 if success is null then raise exception 'Delivery result is required'; end if;
 if success and not public.authorize_notification_delivery(i,lease) then raise exception 'Recipient authorization revoked' using errcode='42501'; end if;
 if code is not null and code not in ('provider_unavailable','rate_limited','invalid_recipient','timeout','unknown') then raise exception 'Use a redacted error code'; end if;
 update public.notification_deliveries set status=case when success then 'sent' else 'failed' end,
 last_error_code=case when success then null else coalesce(code,'unknown') end,lease_until=null,lease_token=null,
 next_attempt_at=case when success or d.attempts>=5 then null else now()+make_interval(secs=>least(3600,60*power(2,d.attempts-1)::integer)) end where id=i;
end $$;
revoke execute on function public.claim_notification_deliveries(integer),public.authorize_notification_delivery(uuid,uuid),public.finish_notification_delivery(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(integer),public.authorize_notification_delivery(uuid,uuid),public.finish_notification_delivery(uuid,uuid,boolean,text) to service_role;
commit;
