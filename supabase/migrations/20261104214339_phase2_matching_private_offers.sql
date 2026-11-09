-- Local-only Phase 2 candidate. No automated identity introduction or reservation.
begin;
create table private.trade_matches (
 id uuid primary key default gen_random_uuid(),reference text not null unique default 'MAT-'||gen_random_uuid()::text,
 request_id uuid not null references public.buyer_requests(id),request_revision integer not null,
 lot_id uuid not null references public.coffee_lots(id),lot_revision integer not null,
 buyer_business_id uuid not null references public.businesses(id),supplier_business_id uuid not null references public.businesses(id),
 approved_by uuid not null,reason text not null check(length(reason) between 5 and 1000),created_at timestamptz not null default clock_timestamp(),
 check(buyer_business_id<>supplier_business_id),unique(request_id,request_revision,lot_id,lot_revision)
);
create table private.commission_terms (
 id uuid primary key default gen_random_uuid(),reference text not null unique default 'COM-'||gen_random_uuid()::text,
 match_id uuid not null references private.trade_matches(id),business_id uuid not null references public.businesses(id),
 version integer not null check(version>0),calculation text not null check(calculation in ('percentage','fixed')),
 amount numeric(18,6) not null check(amount>0),basis text not null check(basis in ('coffee_value','fixed_service_fee')),
 currency text not null check(currency ~ '^[A-Z]{3}$'),earning_trigger text not null check(earning_trigger in ('signed_sale_contract','confirmed_delivery')),
 effective_from timestamptz not null,expires_at timestamptz not null,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 check(expires_at>effective_from),check(calculation<>'percentage' or (amount<=100 and basis='coffee_value')),
 check(calculation<>'fixed' or basis='fixed_service_fee'),unique(match_id,business_id,version)
);
create table private.commission_acceptances (
 terms_id uuid primary key references private.commission_terms(id),business_id uuid not null references public.businesses(id),
 accepted_by uuid not null,accepted_at timestamptz not null default clock_timestamp()
);
create table private.trade_offers (
 id uuid primary key,reference text not null unique default 'OFF-'||gen_random_uuid()::text,
 match_id uuid not null references private.trade_matches(id),business_id uuid not null references public.businesses(id),created_at timestamptz not null default clock_timestamp()
);
create table private.trade_offer_versions (
 offer_id uuid not null references private.trade_offers(id),version integer not null check(version>0),
 payload jsonb not null,valid_until timestamptz not null,commission_snapshot uuid[] not null,
 issued_by uuid not null,issued_at timestamptz not null default clock_timestamp(),primary key(offer_id,version)
);
create table private.trade_offer_responses (
 id uuid primary key,offer_id uuid not null,version integer not null,business_id uuid not null references public.businesses(id),
 response text not null check(response in ('interested','declined','counter')),counter_payload jsonb,
 actor_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(offer_id,version) references private.trade_offer_versions(offer_id,version),unique(offer_id,version,business_id)
);
create index commission_business_idx on private.commission_terms(business_id,created_at);
create index offers_business_idx on private.trade_offers(business_id,created_at);
do $$ declare t text;begin
 foreach t in array array['trade_matches','commission_terms','commission_acceptances','trade_offers','trade_offer_versions','trade_offer_responses'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_record before update or delete on private.%I for each row execute function private.immutable_audit()',t);
 end loop;
end $$;

-- Identity graph and raw prices are never directly granted to client roles.
create function private.trade_match_current(m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_matches x join public.buyer_requests r on r.id=x.request_id join public.coffee_lots l on l.id=x.lot_id
 where x.id=m and r.revision=x.request_revision and l.revision=x.lot_revision and r.status='qualified' and l.status='approved'
 and private.trade_capability(x.buyer_business_id,'buyer') and private.trade_capability(x.supplier_business_id,'supplier')
 and r.payload->>'trade_type'<>'exporter_to_exporter' and l.payload->>'trade_type'<>'exporter_to_exporter'
 and (r.payload->>'window_end')::date>=(clock_timestamp() at time zone 'UTC')::date and (l.payload->>'window_end')::date>=(clock_timestamp() at time zone 'UTC')::date)
$$;
create function private.trade_match_staff(m uuid,p text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_matches x where x.id=m and private.staff(p,x.buyer_business_id) and private.staff(p,x.supplier_business_id)
 and not private.member(x.buyer_business_id) and not private.member(x.supplier_business_id))
$$;
create function private.trade_commission_ready(m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.commission_terms where match_id=m)
 and not exists(select 1 from private.commission_terms t where t.match_id=m
 and t.version=(select max(z.version) from private.commission_terms z where z.match_id=t.match_id and z.business_id=t.business_id)
 and (t.effective_from>clock_timestamp() or t.expires_at<=clock_timestamp() or not exists(select 1 from private.commission_acceptances a where a.terms_id=t.id
 and exists(select 1 from public.memberships mem join public.businesses biz on biz.id=mem.business_id where mem.business_id=t.business_id and mem.user_id=a.accepted_by and mem.active and mem.role in ('owner','admin') and biz.archived_at is null))))
$$;
revoke all on function private.trade_match_current(uuid),private.trade_match_staff(uuid,text),private.trade_commission_ready(uuid) from public,anon,authenticated;

create function private.trade_event(b uuid,k text,i uuid,r text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(actor_id,business_id,action,object_id,new_state,reason) values(auth.uid(),b,k,i::text,jsonb_build_object('status','recorded'),r);
 if b is not null then perform private.trade_notify(b,'trading_commercial',k||':'||i||':'||gen_random_uuid());end if;
 perform private.trade_notify_staff(b,k||':'||i||':'||gen_random_uuid());
end $$;
revoke all on function private.trade_event(uuid,text,uuid,text) from public,anon,authenticated;

create function public.approve_trade_match(req uuid,rv integer,lot uuid,lv integer,reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.buyer_requests;l public.coffee_lots;i uuid;
begin
 perform private.authorization_lock();perform private.trade_actor();
 select * into r from public.buyer_requests where id=req for update;select * into l from public.coffee_lots where id=lot for update;
 if r.id is null or l.id is null or not private.staff('trading.matches.manage',r.business_id) or not private.staff('trading.matches.manage',l.business_id)
 or private.member(r.business_id) or private.member(l.business_id) or r.business_id=l.business_id then raise exception 'Independent MFA matching officer required' using errcode='42501';end if;
 if rv is null or lv is null or r.revision<>rv or l.revision<>lv then raise exception 'Record changed. Reload before trying again.' using errcode='40001';end if;
 if not private.trade_capability(r.business_id,'buyer') or not private.trade_capability(l.business_id,'supplier') then raise exception 'Current independent approvals required' using errcode='42501';end if;
 if r.status<>'qualified' or l.status<>'approved' or r.payload->>'trade_type'='exporter_to_exporter' or r.payload->>'trade_type' is distinct from l.payload->>'trade_type'
 or lower(trim(r.payload->>'origin'))<>lower(trim(l.payload->>'origin')) or lower(trim(r.payload->>'grade'))<>lower(trim(l.payload->>'grade'))
 or r.payload->>'process'<>l.payload->>'process' or (r.payload->>'quantity_kg')::numeric>(l.payload->>'quantity_kg')::numeric
 or (r.payload->>'window_end')::date<(l.payload->>'window_start')::date or (l.payload->>'window_end')::date<(r.payload->>'window_start')::date
 or (r.payload->>'window_end')::date<(clock_timestamp() at time zone 'UTC')::date or (l.payload->>'window_end')::date<(clock_timestamp() at time zone 'UTC')::date
 or coalesce(length(trim(reason)),0) not between 5 and 1000 then raise exception 'Ineligible candidate or missing reason';end if;
 insert into private.trade_matches(request_id,request_revision,lot_id,lot_revision,buyer_business_id,supplier_business_id,approved_by,reason)
 values(req,rv,lot,lv,r.business_id,l.business_id,auth.uid(),trim(reason)) on conflict(request_id,request_revision,lot_id,lot_revision) do nothing returning id into i;
 if i is null then select id into i from private.trade_matches where request_id=req and request_revision=rv and lot_id=lot and lot_revision=lv;
 else perform private.trade_event(null,'trade.match.approved',i,'Manual matching approval; identity remains private.');end if;
 return i;
end $$;

create function public.create_commission_terms(m uuid,payer uuid,calculation text,amount numeric,currency text,earning_trigger text,starts timestamptz,expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare x private.trade_matches;i uuid;v integer;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into x from private.trade_matches where id=m;
 if x.id is null or not private.trade_match_staff(m,'trading.commissions.manage') or not private.trade_match_current(m) or payer is null or payer not in (x.buyer_business_id,x.supplier_business_id) then raise exception 'Current independent commission authority required' using errcode='42501';end if;
 if calculation is null or calculation not in ('percentage','fixed') or amount is null or amount<=0 or amount>999999999 or (calculation='percentage' and amount>100)
 or currency is null or currency !~ '^[A-Z]{3}$' or earning_trigger is null or earning_trigger not in ('signed_sale_contract','confirmed_delivery')
 or starts is null or expires is null or expires<=starts or expires<=clock_timestamp() then raise exception 'Invalid commission terms';end if;
 select coalesce(max(t.version),0)+1 into v from private.commission_terms t where t.match_id=m and t.business_id=payer;
 insert into private.commission_terms(match_id,business_id,version,calculation,amount,basis,currency,earning_trigger,effective_from,expires_at,created_by)
 values(m,payer,v,calculation,amount,case when calculation='percentage' then 'coffee_value' else 'fixed_service_fee' end,currency,earning_trigger,starts,expires,auth.uid()) returning id into i;
 perform private.trade_event(payer,'trade.commission.proposed',i,'New immutable commission terms version.');return i;
end $$;

create function public.accept_commission_terms(i uuid) returns void language plpgsql security definer set search_path='' as $$
declare t private.commission_terms;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into t from private.commission_terms where id=i;
 if t.id is null or not private.member(t.business_id,array['owner','admin']) or not private.trade_match_current(t.match_id) then raise exception 'Current payer representative required' using errcode='42501';end if;
 if t.version<>(select max(z.version) from private.commission_terms z where z.match_id=t.match_id and z.business_id=t.business_id) or t.effective_from>clock_timestamp() or t.expires_at<=clock_timestamp() then raise exception 'Commission terms expired or changed';end if;
 insert into private.commission_acceptances(terms_id,business_id,accepted_by) values(i,t.business_id,auth.uid()) on conflict do nothing;
 if found then perform private.trade_event(t.business_id,'trade.commission.accepted',i,'Payer accepted exact terms version; no fee earned or stock reserved.');end if;
end $$;

create function private.trade_quote_payload(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Quote required';end if;
 for k in select jsonb_object_keys(p) loop if k<>all(array['origin','grade','process','quantity_kg','price','currency','incoterm']) then raise exception 'Confidential or unsupported quote field';end if;end loop;
 if coalesce(p->>'origin','') not in ('Yirgacheffe','Sidama','Guji','Harrar','Jimma','Limu','Nekemte/Wollega','Kaffa','Bench Maji','Bale','Other Ethiopian origin')
 or coalesce(p->>'grade','') not in ('1','2','3','4','5','6','7','8','9','ungraded') or coalesce(p->>'process','') not in ('washed','natural','honey','other')
 or coalesce(p->>'quantity_kg','') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' or coalesce(p->>'price','') !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
 or coalesce(p->>'currency','') !~ '^[A-Z]{3}$' or coalesce(p->>'incoterm','') not in ('EXW','FCA','FOB','CFR','CIF','DAP','to_be_agreed') then raise exception 'Invalid structured quote';end if;
 if (p->>'quantity_kg')::numeric<=0 or (p->>'price')::numeric<=0 then raise exception 'Positive quote quantity and price required';end if;
 return p;
end $$;
revoke all on function private.trade_quote_payload(jsonb) from public,anon,authenticated;

create function public.issue_trade_offer(m uuid,recipient uuid,i uuid,v integer,p jsonb,expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare x private.trade_matches;o private.trade_offers;lastv integer;normalized jsonb;terms uuid[];r public.buyer_requests;l public.coffee_lots;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into x from private.trade_matches where id=m;
 if x.id is null or not private.trade_match_staff(m,'trading.offers.issue') or not private.trade_match_current(m) then raise exception 'Current independent offer authority required' using errcode='42501';end if;
 if not private.trade_commission_ready(m) then raise exception 'Current commission terms must be accepted before protected progression';end if;
 if recipient is null or recipient not in (x.buyer_business_id,x.supplier_business_id) or i is null or v is null or v<0 or expires is null or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' then raise exception 'Invalid quote recipient or validity';end if;
 normalized=private.trade_quote_payload(p);select * into r from public.buyer_requests where id=x.request_id;select * into l from public.coffee_lots where id=x.lot_id;
 if lower(normalized->>'origin')<>lower(l.payload->>'origin') or normalized->>'process'<>l.payload->>'process'
 or (normalized->>'grade'<>'ungraded' and normalized->>'grade'<>regexp_replace(lower(trim(l.payload->>'grade')),'^grade[[:space:]]*','')) then raise exception 'Quote origin, process or grade differs from approved lot';end if;
 if (normalized->>'quantity_kg')::numeric>least((r.payload->>'quantity_kg')::numeric,(l.payload->>'quantity_kg')::numeric) then raise exception 'Quote exceeds declared quantity; no reservation implied';end if;
 select * into o from private.trade_offers where id=i for update;
 if o.id is not null and (o.match_id<>m or o.business_id<>recipient) then raise exception 'Quote unavailable' using errcode='42501';end if;
 select coalesce(max(version),0) into lastv from private.trade_offer_versions where offer_id=i;
 if v<>lastv then raise exception 'Record changed. Reload before trying again.' using errcode='40001';end if;
 select array_agg(t.id order by t.id) into terms from private.commission_terms t where t.match_id=m and t.version=(select max(z.version) from private.commission_terms z where z.match_id=m and z.business_id=t.business_id);
 if o.id is null then insert into private.trade_offers(id,match_id,business_id) values(i,m,recipient);end if;
 insert into private.trade_offer_versions(offer_id,version,payload,valid_until,commission_snapshot,issued_by) values(i,v+1,normalized,expires,terms,auth.uid());
 perform private.trade_event(recipient,'trade.offer.issued',i,'Immutable private quote issued; no identity disclosure or stock reservation.');
 return i;
end $$;

create function private.trade_offer_current(i uuid,v integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_offers o join private.trade_offer_versions z on z.offer_id=o.id
 where o.id=i and z.version=v and z.valid_until>clock_timestamp() and private.trade_match_current(o.match_id) and private.trade_commission_ready(o.match_id)
 and z.commission_snapshot=(select array_agg(t.id order by t.id) from private.commission_terms t where t.match_id=o.match_id and t.version=(select max(x.version) from private.commission_terms x where x.match_id=t.match_id and x.business_id=t.business_id)))
$$;
revoke all on function private.trade_offer_current(uuid,integer) from public,anon,authenticated;

create function public.respond_trade_offer(i uuid,v integer,response text,counter_payload jsonb,response_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o private.trade_offers;lastv integer;valid timestamptz;p jsonb;existing private.trade_offer_responses;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into o from private.trade_offers where id=i;
 if o.id is null or not private.member(o.business_id,array['owner','admin','trader']) or not private.trade_match_current(o.match_id) or not private.trade_commission_ready(o.match_id) then raise exception 'Current quote recipient required' using errcode='42501';end if;
 select max(version) into lastv from private.trade_offer_versions where offer_id=i;
 select valid_until into valid from private.trade_offer_versions where offer_id=i and version=lastv;
 if v is null or v<>lastv or valid<=clock_timestamp() or not private.trade_offer_current(i,v) then raise exception 'Quote expired or changed';end if;
 if response is null or response not in ('interested','declined','counter') or response_id is null then raise exception 'Invalid response';end if;
 if response='counter' then p=private.trade_quote_payload(counter_payload);elsif counter_payload is not null then raise exception 'Counter terms only for counterproposal';end if;
 select * into existing from private.trade_offer_responses where id=response_id;
 if existing.id is not null then if existing.offer_id=i and existing.version=v and existing.business_id=o.business_id and existing.response=response and existing.counter_payload is not distinct from p then return;else raise exception 'Invalid response identity';end if;end if;
 insert into private.trade_offer_responses(id,offer_id,version,business_id,response,counter_payload,actor_id) values(response_id,i,v,o.business_id,response,p,auth.uid());
 perform private.trade_event(o.business_id,'trade.offer.response',i,'Recipient response recorded for staff review; no contract or reservation.');
end $$;

-- Recipient-safe projections. No counterpart IDs, raw lot/request graph, asking prices,
-- contacts, arbitrary internal text or cross-recipient quotes in these return values.
create function public.my_trading_commercial(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare terms jsonb;offers jsonb;
begin
 perform private.trade_actor();if not private.member(b) then raise exception 'Business membership required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'version',t.version,'calculation',t.calculation,'amount',t.amount,'basis',t.basis,'currency',t.currency,'earning_trigger',t.earning_trigger,'effective_from',t.effective_from,'expires_at',t.expires_at,'accepted',exists(select 1 from private.commission_acceptances a where a.terms_id=t.id)) order by t.created_at desc),'[]') into terms
 from private.commission_terms t where t.business_id=b and private.trade_match_current(t.match_id) and t.version=(select max(z.version) from private.commission_terms z where z.match_id=t.match_id and z.business_id=b);
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'version',v.version,'payload',v.payload,'valid_until',v.valid_until,'issued_at',v.issued_at,
 'response',(select jsonb_build_object('response',r.response,'counter_payload',r.counter_payload,'created_at',r.created_at) from private.trade_offer_responses r where r.offer_id=o.id and r.version=v.version and r.business_id=b)) order by v.issued_at desc),'[]') into offers
 from private.trade_offers o join private.trade_offer_versions v on v.offer_id=o.id where o.business_id=b and private.trade_offer_current(o.id,v.version);
 return jsonb_build_object('commissions',terms,'offers',offers);
end $$;

create function public.admin_trading_commercial() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare matches jsonb;terms jsonb;offers jsonb;responses jsonb;
begin
 perform private.trade_actor();
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'reference',x.reference,'request_id',x.request_id,'lot_id',x.lot_id,'buyer_business_id',x.buyer_business_id,'supplier_business_id',x.supplier_business_id,'reason',x.reason,'current',private.trade_match_current(x.id)) order by x.created_at desc),'[]') into matches from (select * from private.trade_matches m where private.trade_match_staff(m.id,'trading.matches.manage') or private.trade_match_staff(m.id,'trading.offers.issue') or private.trade_match_staff(m.id,'trading.commissions.manage') order by created_at desc limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into terms from (select t.*,exists(select 1 from private.commission_acceptances a where a.terms_id=t.id) as accepted from private.commission_terms t where private.trade_match_staff(t.match_id,'trading.commissions.manage') or private.trade_match_staff(t.match_id,'trading.offers.issue') order by t.created_at desc limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into offers from (select o.id,o.reference,o.match_id,o.business_id,v.version,v.payload,v.valid_until from private.trade_offers o join private.trade_offer_versions v on v.offer_id=o.id where private.trade_match_staff(o.match_id,'trading.offers.issue') order by v.issued_at desc limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into responses from (select r.* from private.trade_offer_responses r join private.trade_offers o on o.id=r.offer_id where private.trade_match_staff(o.match_id,'trading.offers.issue') order by r.created_at desc limit 100) x;
 return jsonb_build_object('matches',matches,'commissions',terms,'offers',offers,'responses',responses);
end $$;

-- Explicit signatures, no PUBLIC or anonymous EXECUTE default leakage.
revoke all on function public.approve_trade_match(uuid,integer,uuid,integer,text),public.create_commission_terms(uuid,uuid,text,numeric,text,text,timestamptz,timestamptz),public.accept_commission_terms(uuid),public.issue_trade_offer(uuid,uuid,uuid,integer,jsonb,timestamptz),public.respond_trade_offer(uuid,integer,text,jsonb,uuid),public.my_trading_commercial(uuid),public.admin_trading_commercial() from public,anon,authenticated;
grant execute on function public.approve_trade_match(uuid,integer,uuid,integer,text),public.create_commission_terms(uuid,uuid,text,numeric,text,text,timestamptz,timestamptz),public.accept_commission_terms(uuid),public.issue_trade_offer(uuid,uuid,uuid,integer,jsonb,timestamptz),public.respond_trade_offer(uuid,integer,text,jsonb,uuid),public.my_trading_commercial(uuid),public.admin_trading_commercial() to authenticated;

-- Extend recipient authorization without weakening any existing Phase 1 branch.
create or replace function private.notification_authorized(u uuid,b uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=u and email_confirmed_at is not null and (banned_until is null or banned_until<=clock_timestamp())) and
 case
 when k='verification_queue' then b is not null and exists(select 1 from public.businesses where id=b and archived_at is null) and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='verification.review' and g.revoked_at is null and (g.business_id is null or g.business_id=b))
 when k='inquiry_queue' then b is null and exists(select 1 from public.staff_grants g where g.user_id=u and g.permission='inquiry.manage' and g.revoked_at is null)
 when k in ('registration','verification','inquiry','trading_record') then b is null or exists(select 1 from public.memberships m join public.businesses biz on biz.id=m.business_id where m.user_id=u and m.business_id=b and m.active and biz.archived_at is null)
 when k='trading_commercial' then b is not null and (private.trade_capability(b,'buyer') or private.trade_capability(b,'supplier')) and exists(select 1 from public.memberships m join public.businesses biz on biz.id=m.business_id where m.user_id=u and m.business_id=b and m.active and biz.archived_at is null)
 when k='trading_queue' then exists(select 1 from public.staff_grants g where g.user_id=u and g.revoked_at is null and g.permission in ('trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage') and (g.business_id is null or g.business_id=b))
 else false end
$$;
create function private.trade_notify(b uuid,k text,event text) returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;begin
 for recipient in select distinct user_id from public.memberships where business_id=b and active loop
 perform private.notify(recipient,b,event,k,'There is an update in your private ET Link workspace.');end loop;
end $$;
create function private.trade_notify_staff(b uuid,event text) returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;begin
 for recipient in select distinct user_id from public.staff_grants where revoked_at is null and permission in ('trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage') and (business_id is null or business_id=b) loop
 perform private.notify(recipient,b,event,'trading_queue','There is an update in your authorized ET Link action queues.');end loop;
end $$;
create function private.trade_record_notify() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.trade_notify(new.business_id,'trading_record',TG_TABLE_NAME||':'||new.id||':'||new.revision);
 if new.status<>'draft' then perform private.trade_notify_staff(new.business_id,TG_TABLE_NAME||':'||new.id||':'||new.revision);end if;return new;
end $$;
revoke all on function private.trade_notify(uuid,text,text),private.trade_notify_staff(uuid,text),private.trade_record_notify() from public,anon,authenticated;
create trigger request_notification after insert or update on public.buyer_requests for each row execute function private.trade_record_notify();
create trigger lot_notification after insert or update on public.coffee_lots for each row execute function private.trade_record_notify();
commit;
