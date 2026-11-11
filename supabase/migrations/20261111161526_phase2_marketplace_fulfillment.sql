-- Local MVP candidate. Hosted application requires separate owner approval.
begin;

create table private.coffee_samples (
 id uuid primary key, reference text not null unique default 'SMP-'||gen_random_uuid(),
 match_id uuid not null references private.trade_matches(id), quantity_grams numeric(10,3) not null check(quantity_grams>0 and quantity_grams<=5000),
 status text not null default 'requested' check(status in ('requested','dispatched','received','accepted','rejected','cancelled')),
 revision integer not null default 1, carrier text, tracking_reference text,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table private.stock_allocations (
 id uuid primary key, reference text not null unique default 'ALC-'||gen_random_uuid(),
 match_id uuid not null references private.trade_matches(id), sample_id uuid not null references private.coffee_samples(id),
 quantity_kg numeric(18,6) not null check(quantity_kg>0), status text not null default 'allocated' check(status in ('allocated','released','fulfilled')),
 revision integer not null default 1, created_by uuid not null, created_at timestamptz not null default clock_timestamp()
);
create table private.stock_reservations (
 id uuid primary key, reference text not null unique default 'RSV-'||gen_random_uuid(),
 allocation_id uuid not null references private.stock_allocations(id),
 expires_at timestamptz not null, status text not null default 'reserved' check(status in ('reserved','committed','released','fulfilled')),
 revision integer not null default 1, created_by uuid not null, created_at timestamptz not null default clock_timestamp()
);
create unique index one_active_reservation on private.stock_reservations(allocation_id) where status='reserved';
create table private.coffee_deals (
 id uuid primary key, reference text not null unique default 'DEAL-'||gen_random_uuid(),
 reservation_id uuid not null unique references private.stock_reservations(id),
 buyer_offer uuid not null, buyer_version integer not null, supplier_offer uuid not null, supplier_version integer not null,
 commission_snapshot uuid[] not null,
 status text not null default 'draft' check(status in ('draft','confirmed','contract_signed','in_transit','delivered','completed','cancelled')),
 revision integer not null default 1, contract_reference text, delivery_reference text,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 foreign key(buyer_offer,buyer_version) references private.trade_offer_versions(offer_id,version),
 foreign key(supplier_offer,supplier_version) references private.trade_offer_versions(offer_id,version)
);
create table private.deal_confirmations (
 deal_id uuid not null references private.coffee_deals(id), business_id uuid not null references public.businesses(id),
 kind text not null check(kind in ('terms','delivery')), actor_id uuid not null, created_at timestamptz not null default clock_timestamp(),
 primary key(deal_id,business_id,kind,actor_id)
);
create table private.commission_receivables (
 id uuid primary key default gen_random_uuid(), reference text not null unique default 'FEE-'||gen_random_uuid(),
 deal_id uuid not null references private.coffee_deals(id), terms_id uuid not null references private.commission_terms(id),
 business_id uuid not null references public.businesses(id), amount numeric(24,6) not null check(amount>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'), earned_at timestamptz not null default clock_timestamp(),
 unique(deal_id,terms_id)
);
create table private.commission_receipts (
 id uuid primary key, receivable_id uuid not null references private.commission_receivables(id),
 amount numeric(24,6) not null check(amount>0), payment_reference text not null unique check(length(trim(payment_reference)) between 3 and 120),
 recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
create table private.fulfillment_history (
 id bigint generated always as identity primary key, entity text not null, object_id uuid not null,
 revision integer not null, status text not null, actor_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
create index samples_match_idx on private.coffee_samples(match_id,created_at);
create index allocations_match_idx on private.stock_allocations(match_id,status);
create index reservations_allocation_idx on private.stock_reservations(allocation_id);
create index receipts_receivable_idx on private.commission_receipts(receivable_id);
create index receivables_business_idx on private.commission_receivables(business_id,earned_at);
create index fulfillment_history_object_idx on private.fulfillment_history(object_id,id);

do $$ declare t text; begin
 foreach t in array array['coffee_samples','stock_allocations','stock_reservations','coffee_deals','deal_confirmations','commission_receivables','commission_receipts','fulfillment_history'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['deal_confirmations','commission_receivables','commission_receipts','fulfillment_history'] loop
  execute format('create trigger immutable_record before update or delete on private.%I for each row execute function private.immutable_audit()',t);
 end loop;
end $$;

create function private.fulfillment_history_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.fulfillment_history(entity,object_id,revision,status,actor_id) values(TG_TABLE_NAME,new.id,new.revision,new.status,auth.uid());
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['coffee_samples','stock_allocations','stock_reservations','coffee_deals'] loop
  execute format('create trigger fulfillment_history after insert or update on private.%I for each row execute function private.fulfillment_history_record()',t);
 end loop;
end $$;

create function private.fulfillment_visible(m uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member(b) and exists(select 1 from private.trade_matches x where x.id=m and
 ((x.buyer_business_id=b and private.trade_capability(b,'buyer')) or (x.supplier_business_id=b and private.trade_capability(b,'supplier'))))
$$;
create function private.fulfillment_staff(m uuid,p text default 'trading.matches.manage') returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.trade_actor();
 if not private.trade_match_staff(m,p) then raise exception 'Independent current MFA authority required' using errcode='42501';end if;
end $$;

create function public.request_coffee_sample(offer uuid,offer_version integer,i uuid,grams numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare o private.trade_offers;x private.trade_matches;s private.coffee_samples;
begin
 perform private.authorization_lock();perform private.trade_actor();
 select * into o from private.trade_offers where id=offer;select * into x from private.trade_matches where id=o.match_id;
 if o.id is null or o.business_id<>x.buyer_business_id or not private.member(o.business_id,array['owner','admin','trader']) or not private.trade_offer_current(offer,offer_version)
 or offer_version<>(select max(version) from private.trade_offer_versions where offer_id=offer) then raise exception 'Current buyer quote required' using errcode='42501';end if;
 if i is null or grams is null or grams<=0 or grams>5000 then raise exception 'Invalid sample quantity';end if;
 select * into s from private.coffee_samples where id=i;
 if s.id is not null then
  if s.match_id=o.match_id and s.created_by=auth.uid() and s.quantity_grams=grams then return i;end if;
  raise exception 'Sample request identity changed';
 end if;
 insert into private.coffee_samples(id,match_id,quantity_grams,created_by) values(i,o.match_id,grams,auth.uid());
 perform private.trade_event(o.business_id,'sample.requested',i,'Physical sample requested through ET Link.');return i;
end $$;

create function public.update_coffee_sample(i uuid,v integer,next_status text,carrier_name text default '',tracking text default '') returns void language plpgsql security definer set search_path='' as $$
declare s private.coffee_samples;x private.trade_matches;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into s from private.coffee_samples where id=i for update;
 select * into x from private.trade_matches where id=s.match_id;
 if s.id is null then raise exception 'Sample unavailable' using errcode='42501';end if;
 if next_status in ('dispatched','cancelled') then perform private.fulfillment_staff(s.match_id);
 elsif not private.member(x.buyer_business_id,array['owner','admin','trader']) or not private.trade_capability(x.buyer_business_id,'buyer') then
  raise exception 'Current buyer representative required' using errcode='42501';
 end if;
 if v is null or s.revision<>v then raise exception 'Sample changed' using errcode='40001';end if;
 if not ((s.status='requested' and next_status in ('dispatched','cancelled')) or (s.status='dispatched' and next_status in ('received','cancelled')) or (s.status='received' and next_status in ('accepted','rejected'))) then raise exception 'Invalid sample transition';end if;
 if next_status='dispatched' and (coalesce(length(trim(carrier_name)),0) not between 2 and 100 or coalesce(length(trim(tracking)),0) not between 3 and 120) then raise exception 'Private dispatch evidence required';end if;
 update private.coffee_samples set status=next_status,revision=revision+1,updated_at=clock_timestamp(),
 carrier=case when next_status='dispatched' then trim(carrier_name) else carrier end,
 tracking_reference=case when next_status='dispatched' then trim(tracking) else tracking_reference end where id=i;
 perform private.trade_event(x.buyer_business_id,'sample.'||next_status,i,'Physical sample status recorded. Sample acceptance does not allocate or reserve stock.');
end $$;

create function public.allocate_coffee_stock(m uuid,sample uuid,i uuid,quantity numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare x private.trade_matches;s private.coffee_samples;a private.stock_allocations;l public.coffee_lots;r public.buyer_requests;used_lot numeric;used_request numeric;
begin
 perform private.authorization_lock();perform private.fulfillment_staff(m);select * into x from private.trade_matches where id=m;
 if not private.trade_match_current(m) or not private.trade_commission_ready(m) then raise exception 'Current verified sources and accepted commission terms required' using errcode='42501';end if;
 select * into s from private.coffee_samples where id=sample;
 if s.id is null or s.match_id<>m or s.status<>'accepted' or i is null or quantity is null or quantity<=0 or quantity>999999999 then raise exception 'Accepted sample and positive allocation required';end if;
 select * into a from private.stock_allocations where id=i;
 if a.id is not null then
  if a.match_id=m and a.sample_id=sample and a.quantity_kg=quantity then return i;end if;
  raise exception 'Allocation identity changed';
 end if;
 select * into l from public.coffee_lots where id=x.lot_id for update;select * into r from public.buyer_requests where id=x.request_id for update;
 select coalesce(sum(allocated.quantity_kg),0) into used_lot from private.stock_allocations allocated join private.trade_matches t on t.id=allocated.match_id where t.lot_id=x.lot_id and allocated.status<>'released';
 select coalesce(sum(allocated.quantity_kg),0) into used_request from private.stock_allocations allocated join private.trade_matches t on t.id=allocated.match_id where t.request_id=x.request_id and allocated.status<>'released';
 if used_lot+quantity>(l.payload->>'quantity_kg')::numeric or used_request+quantity>(r.payload->>'quantity_kg')::numeric then raise exception 'Insufficient unallocated quantity';end if;
 insert into private.stock_allocations(id,match_id,sample_id,quantity_kg,created_by) values(i,m,sample,quantity,auth.uid());
 perform private.trade_event(null,'stock.allocated',i,'ET Link recorded a separate stock allocation.');return i;
end $$;

create function public.reserve_coffee_stock(allocation uuid,i uuid,expires timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare a private.stock_allocations;r private.stock_reservations;
begin
 perform private.authorization_lock();select * into a from private.stock_allocations where id=allocation for update;perform private.fulfillment_staff(a.match_id);
 if a.id is null or a.status<>'allocated' or not private.trade_match_current(a.match_id) or not private.trade_commission_ready(a.match_id) then raise exception 'Current active allocation required';end if;
 if i is null or expires is null or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' then raise exception 'Reservation expiry must be within 30 days';end if;
 select * into r from private.stock_reservations where id=i;
 if r.id is not null then if r.allocation_id=allocation and r.expires_at=expires then return i;else raise exception 'Reservation identity changed';end if;end if;
 if exists(select 1 from private.coffee_deals d join private.stock_reservations z on z.id=d.reservation_id where z.allocation_id=allocation and d.status<>'cancelled') then raise exception 'Allocation already belongs to a deal';end if;
 update private.stock_reservations set status='released',revision=revision+1 where allocation_id=allocation and status='reserved' and expires_at<=clock_timestamp();
 insert into private.stock_reservations(id,allocation_id,expires_at,created_by) values(i,allocation,expires,auth.uid());
 perform private.trade_event(null,'stock.reserved',i,'ET Link recorded a timed stock reservation.');return i;
end $$;

create function public.release_coffee_stock(domain text,i uuid,v integer) returns void language plpgsql security definer set search_path='' as $$
declare a private.stock_allocations;r private.stock_reservations;
begin
 perform private.authorization_lock();
 if domain='reservation' then select * into r from private.stock_reservations where id=i for update;select * into a from private.stock_allocations where id=r.allocation_id;
 elsif domain='allocation' then select * into a from private.stock_allocations where id=i for update;
 else raise exception 'Unknown stock operation';end if;
 perform private.fulfillment_staff(a.match_id);
 if a.id is null or a.status<>'allocated' then raise exception 'Active allocation required';end if;
 if exists(select 1 from private.coffee_deals d join private.stock_reservations z on z.id=d.reservation_id where z.allocation_id=a.id and d.status<>'cancelled') then raise exception 'Cancel the unsigned deal first';end if;
 if domain='reservation' then
  if r.revision is distinct from v then raise exception 'Reservation changed' using errcode='40001';end if;
  if r.status<>'reserved' then raise exception 'Active reservation required';end if;
  update private.stock_reservations set status='released',revision=revision+1 where id=i;
 else
  if a.revision is distinct from v then raise exception 'Allocation changed' using errcode='40001';end if;
  if exists(select 1 from private.stock_reservations where allocation_id=i and status='reserved' and expires_at>clock_timestamp()) then raise exception 'Release the reservation first';end if;
  update private.stock_reservations set status='released',revision=revision+1 where allocation_id=i and status='reserved';
  update private.stock_allocations set status='released',revision=revision+1 where id=i;
 end if;
 perform private.trade_event(null,'stock.'||domain||'.released',i,'ET Link explicitly released the stock commitment.');
end $$;

-- Preserve the declared quantity and source revisions behind allocations/deals.
create function private.protect_allocated_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.authorization_lock();
 if exists(select 1 from private.stock_allocations a join private.trade_matches x on x.id=a.match_id
 where a.status<>'released' and ((TG_TABLE_NAME='coffee_lots' and x.lot_id=old.id) or (TG_TABLE_NAME='buyer_requests' and x.request_id=old.id))) then
  raise exception 'Allocated or fulfilled source cannot be edited; release eligible commitments first';
 end if;
 return new;
end $$;
create trigger protect_allocated_source before update or delete on public.coffee_lots for each row execute function private.protect_allocated_source();
create trigger protect_allocated_source before update or delete on public.buyer_requests for each row execute function private.protect_allocated_source();

create function private.fulfillment_quote_ready(q uuid,v integer,m uuid,b uuid,quantity numeric) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_offers o join private.trade_offer_versions z on z.offer_id=o.id where o.id=q and z.version=v and o.match_id=m and o.business_id=b
 and private.trade_offer_current(q,v) and v=(select max(version) from private.trade_offer_versions where offer_id=q) and (z.payload->>'quantity_kg')::numeric>=quantity
 and exists(select 1 from private.trade_offer_responses p where p.offer_id=q and p.version=v and p.response='interested'))
$$;

create function public.create_coffee_deal(reservation uuid,buyer_quote uuid,buyer_quote_version integer,supplier_quote uuid,supplier_quote_version integer,i uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.stock_reservations;a private.stock_allocations;x private.trade_matches;terms uuid[];existing private.coffee_deals;
begin
 perform private.authorization_lock();select * into r from private.stock_reservations where id=reservation for update;select * into a from private.stock_allocations where id=r.allocation_id;
 perform private.fulfillment_staff(a.match_id);select * into x from private.trade_matches where id=a.match_id;
 if r.status is distinct from 'reserved' or r.expires_at<=clock_timestamp() or a.status<>'allocated' or not private.trade_match_current(x.id) or not private.trade_commission_ready(x.id) then raise exception 'Current reservation and accepted terms required';end if;
 if not private.fulfillment_quote_ready(buyer_quote,buyer_quote_version,x.id,x.buyer_business_id,a.quantity_kg)
 or not private.fulfillment_quote_ready(supplier_quote,supplier_quote_version,x.id,x.supplier_business_id,a.quantity_kg) then raise exception 'Separate current interested buyer and supplier quotes required';end if;
 select array_agg(t.id order by t.id) into terms from private.commission_terms t where t.match_id=x.id and t.version=(select max(z.version) from private.commission_terms z where z.match_id=x.id and z.business_id=t.business_id);
 if exists(select 1 from private.commission_terms t join private.trade_offers q on q.match_id=x.id and q.business_id=t.business_id join private.trade_offer_versions z on z.offer_id=q.id
  where t.id=any(terms) and ((q.id=buyer_quote and z.version=buyer_quote_version) or (q.id=supplier_quote and z.version=supplier_quote_version)) and t.currency<>z.payload->>'currency') then raise exception 'Commission currency must match the payer quote';end if;
 select * into existing from private.coffee_deals where id=i;
 if existing.id is not null then
  if existing.reservation_id=reservation and existing.buyer_offer=buyer_quote and existing.buyer_version=buyer_quote_version and existing.supplier_offer=supplier_quote and existing.supplier_version=supplier_quote_version then return i;end if;
  raise exception 'Deal identity changed';
 end if;
 insert into private.coffee_deals(id,reservation_id,buyer_offer,buyer_version,supplier_offer,supplier_version,commission_snapshot,created_by)
 values(i,reservation,buyer_quote,buyer_quote_version,supplier_quote,supplier_quote_version,terms,auth.uid());
 perform private.trade_event(null,'deal.draft',i,'Separate recorded deal terms require both representatives to confirm.');return i;
end $$;

create function public.confirm_coffee_deal(i uuid,b uuid,kind text) returns void language plpgsql security definer set search_path='' as $$
declare d private.coffee_deals;a private.stock_allocations;r private.stock_reservations;x private.trade_matches;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into d from private.coffee_deals where id=i;
 select * into r from private.stock_reservations where id=d.reservation_id;select * into a from private.stock_allocations where id=r.allocation_id;select * into x from private.trade_matches where id=a.match_id;
 if d.id is null or not private.fulfillment_visible(x.id,b) or not private.member(b,array['owner','admin']) then raise exception 'Current authorized representative required' using errcode='42501';end if;
 if kind='terms' then
  if d.status<>'draft' or r.expires_at<=clock_timestamp() or r.status<>'reserved' or not private.trade_match_current(x.id)
   or not private.trade_offer_current(d.buyer_offer,d.buyer_version) or not private.trade_offer_current(d.supplier_offer,d.supplier_version) then raise exception 'Deal terms changed or expired';end if;
 elsif kind='delivery' then if d.status<>'delivered' then raise exception 'Delivery must be recorded first';end if;
 else raise exception 'Unknown confirmation';end if;
 insert into private.deal_confirmations(deal_id,business_id,kind,actor_id) values(i,b,kind,auth.uid()) on conflict do nothing;
 if found then perform private.trade_event(b,'deal.confirmed.'||kind,i,'Authorized representative confirmed their private deal record.');end if;
end $$;

create function private.deal_confirmation_ready(d uuid,b uuid,k text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.deal_confirmations c join public.memberships mem on mem.business_id=c.business_id and mem.user_id=c.actor_id
 join auth.users u on u.id=c.actor_id where c.deal_id=d and c.business_id=b and c.kind=k and mem.active and mem.role in ('owner','admin')
 and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
$$;

create function private.earn_deal_commission(d private.coffee_deals,trigger_name text) returns void language plpgsql security definer set search_path='' as $$
declare t private.commission_terms;quote jsonb;quantity numeric;fee numeric;i uuid;x private.trade_matches;match_uuid uuid;
begin
 select a.quantity_kg,a.match_id into quantity,match_uuid from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where r.id=d.reservation_id;
 select * into x from private.trade_matches where id=match_uuid;
 for t in select * from private.commission_terms where id=any(d.commission_snapshot) and earning_trigger=trigger_name loop
  if t.calculation='fixed' and exists(select 1 from private.commission_receivables where terms_id=t.id) then continue;end if;
  select payload into quote from private.trade_offer_versions where (offer_id,version)=(case when t.business_id=x.buyer_business_id then d.buyer_offer else d.supplier_offer end,case when t.business_id=x.buyer_business_id then d.buyer_version else d.supplier_version end);
  fee=round(case when t.calculation='fixed' then t.amount else quantity*(quote->>'price')::numeric*t.amount/100 end,6);
  insert into private.commission_receivables(deal_id,terms_id,business_id,amount,currency) values(d.id,t.id,t.business_id,fee,t.currency) on conflict(deal_id,terms_id) do nothing returning id into i;
  if i is not null then perform private.trade_event(t.business_id,'commission.earned',i,'Commission earned at its exact agreed deal milestone.');end if;
 end loop;
end $$;

create function public.advance_coffee_deal(i uuid,v integer,next_status text,evidence text default '') returns void language plpgsql security definer set search_path='' as $$
declare d private.coffee_deals;r private.stock_reservations;a private.stock_allocations;x private.trade_matches;
begin
 perform private.authorization_lock();select * into d from private.coffee_deals where id=i for update;
 select * into r from private.stock_reservations where id=d.reservation_id;select * into a from private.stock_allocations where id=r.allocation_id;select * into x from private.trade_matches where id=a.match_id;
 perform private.fulfillment_staff(x.id);
 if d.id is null or d.revision is distinct from v then raise exception 'Deal changed' using errcode='40001';end if;
 if next_status='cancelled' then
  if d.status not in ('draft','confirmed') then raise exception 'Signed deals require a separately reviewed resolution';end if;
  update private.stock_reservations set status='released',revision=revision+1 where id=r.id and status='reserved';
  update private.stock_allocations set status='released',revision=revision+1 where id=a.id;
 elsif (d.status='draft' and next_status='confirmed') or (d.status='confirmed' and next_status='contract_signed') then
  if r.status<>'reserved' or r.expires_at<=clock_timestamp() or not private.trade_match_current(x.id) or not private.trade_commission_ready(x.id)
   or not private.trade_offer_current(d.buyer_offer,d.buyer_version) or not private.trade_offer_current(d.supplier_offer,d.supplier_version)
   or not private.deal_confirmation_ready(i,x.buyer_business_id,'terms') or not private.deal_confirmation_ready(i,x.supplier_business_id,'terms') then raise exception 'Both current representatives must confirm before reservation expiry';end if;
 elsif not ((d.status='contract_signed' and next_status='in_transit') or (d.status='in_transit' and next_status='delivered') or (d.status='delivered' and next_status='completed')) then raise exception 'Invalid deal transition';
 end if;
 if next_status in ('contract_signed','delivered') and coalesce(length(trim(evidence)),0) not between 3 and 120 then raise exception 'Private milestone evidence reference required';end if;
 if next_status='completed' and (not private.deal_confirmation_ready(i,x.buyer_business_id,'delivery') or not private.deal_confirmation_ready(i,x.supplier_business_id,'delivery')) then raise exception 'Both representatives must confirm delivery';end if;
 update private.coffee_deals set status=next_status,revision=revision+1,contract_reference=case when next_status='contract_signed' then trim(evidence) else contract_reference end,
 delivery_reference=case when next_status='delivered' then trim(evidence) else delivery_reference end where id=i;
 if next_status='contract_signed' then
  update private.stock_reservations set status='committed',revision=revision+1 where id=r.id;
  perform private.earn_deal_commission(d,'signed_sale_contract');
 end if;
 if next_status='completed' then
  update private.stock_reservations set status='fulfilled',revision=revision+1 where id=r.id;
  update private.stock_allocations set status='fulfilled',revision=revision+1 where id=a.id;
  perform private.earn_deal_commission(d,'confirmed_delivery');
 end if;
 perform private.trade_event(null,'deal.'||next_status,i,'ET Link recorded an explicit deal milestone.');
end $$;

create function public.record_commission_receipt(receivable uuid,i uuid,amount_received numeric,payment_reference text) returns void language plpgsql security definer set search_path='' as $$
declare f private.commission_receivables;d private.coffee_deals;a private.stock_allocations;p private.commission_receipts;paid numeric;
begin
 perform private.authorization_lock();select * into f from private.commission_receivables where id=receivable for update;
 select * into d from private.coffee_deals where id=f.deal_id;select a1.* into a from private.stock_allocations a1 join private.stock_reservations r on r.allocation_id=a1.id where r.id=d.reservation_id;
 perform private.fulfillment_staff(a.match_id,'trading.commissions.manage');
 if f.id is null or i is null or amount_received is null or amount_received<=0 or coalesce(length(trim(payment_reference)),0) not between 3 and 120 then raise exception 'Invalid commission payment record';end if;
 select * into p from private.commission_receipts where id=i;
 if p.id is not null then if p.receivable_id=receivable and p.amount=amount_received and p.payment_reference=trim(payment_reference) then return;else raise exception 'Payment identity changed';end if;end if;
 select coalesce(sum(amount),0) into paid from private.commission_receipts where receivable_id=receivable;
 if paid+amount_received>f.amount then raise exception 'Payment exceeds outstanding commission';end if;
 insert into private.commission_receipts values(i,receivable,amount_received,trim(payment_reference),auth.uid(),clock_timestamp());
 perform private.trade_event(f.business_id,'commission.payment.recorded',i,'ET Link recorded an externally received commission payment.');
end $$;

-- Safe business projection intentionally omits counterparty IDs, source graph,
-- private shipment/contract references, other party prices and internal notes.
create function private.stock_balance(lot uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',l.id,'reference',l.reference,'declared_kg',(l.payload->>'quantity_kg')::numeric,
 'allocated_kg',coalesce((select sum(a.quantity_kg) from private.stock_allocations a join private.trade_matches x on x.id=a.match_id where x.lot_id=l.id and a.status='allocated'),0),
 'reserved_kg',coalesce((select sum(a.quantity_kg) from private.stock_allocations a join private.trade_matches x on x.id=a.match_id join private.stock_reservations r on r.allocation_id=a.id where x.lot_id=l.id and (r.status='committed' or (r.status='reserved' and r.expires_at>clock_timestamp()))),0),
 'fulfilled_kg',coalesce((select sum(a.quantity_kg) from private.stock_allocations a join private.trade_matches x on x.id=a.match_id where x.lot_id=l.id and a.status='fulfilled'),0),
 'available_kg',greatest(0,(l.payload->>'quantity_kg')::numeric-coalesce((select sum(a.quantity_kg) from private.stock_allocations a join private.trade_matches x on x.id=a.match_id where x.lot_id=l.id and a.status<>'released'),0))) from public.coffee_lots l where l.id=lot
$$;
create function public.my_marketplace_operations(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare samples jsonb;allocations jsonb;deals jsonb;fees jsonb;stock jsonb;
begin
 perform private.trade_actor();if not private.member(b) then raise exception 'Current membership required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'reference',s.reference,'quantity_grams',s.quantity_grams,'status',s.status,'revision',s.revision,'buyer',x.buyer_business_id=b) order by s.created_at desc),'[]') into samples
 from private.coffee_samples s join private.trade_matches x on x.id=s.match_id where private.fulfillment_visible(x.id,b);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'reference',a.reference,'quantity_kg',a.quantity_kg,'status',a.status,
 'reservation_status',(select case when r.status='reserved' and r.expires_at<=clock_timestamp() then 'expired' else r.status end from private.stock_reservations r where r.allocation_id=a.id order by r.created_at desc limit 1),
 'reserved_until',(select r.expires_at from private.stock_reservations r where r.allocation_id=a.id order by r.created_at desc limit 1)) order by a.created_at desc),'[]') into allocations
 from private.stock_allocations a where private.fulfillment_visible(a.match_id,b);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'reference',d.reference,'status',d.status,'quantity_kg',a.quantity_kg,
 'price',(case when b=x.buyer_business_id then bv.payload else sv.payload end)->>'price',
 'currency',(case when b=x.buyer_business_id then bv.payload else sv.payload end)->>'currency',
 'terms_confirmed',private.deal_confirmation_ready(d.id,b,'terms'),
 'delivery_confirmed',private.deal_confirmation_ready(d.id,b,'delivery')) order by d.created_at desc),'[]') into deals
 from private.coffee_deals d join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id join private.trade_matches x on x.id=a.match_id
 join private.trade_offer_versions bv on bv.offer_id=d.buyer_offer and bv.version=d.buyer_version join private.trade_offer_versions sv on sv.offer_id=d.supplier_offer and sv.version=d.supplier_version where private.fulfillment_visible(x.id,b);
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'reference',f.reference,'amount',f.amount::text,'currency',f.currency,'earned_at',f.earned_at,
 'paid',coalesce((select sum(p.amount) from private.commission_receipts p where p.receivable_id=f.id),0)::text) order by f.earned_at desc),'[]') into fees
 from private.commission_receivables f where f.business_id=b;
 select coalesce(jsonb_agg(private.stock_balance(l.id)),'[]') into stock from (select id from public.coffee_lots where business_id=b and private.trade_capability(b,'supplier') order by created_at desc limit 100) l;
 return jsonb_build_object('samples',samples,'allocations',allocations,'deals',deals,'fees',fees,'stock',stock);
end $$;

create function public.admin_marketplace_operations() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare samples jsonb;allocations jsonb;reservations jsonb;deals jsonb;fees jsonb;history jsonb;stock jsonb;
begin
 perform private.trade_actor();
 select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc),'[]') into samples from private.coffee_samples s where private.trade_match_staff(s.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('reserved_kg',case when exists(select 1 from private.stock_reservations r where r.allocation_id=a.id and (r.status='committed' or (r.status='reserved' and r.expires_at>clock_timestamp()))) then a.quantity_kg else 0 end) order by a.created_at desc),'[]') into allocations from private.stock_allocations a where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('expired',r.expires_at<=clock_timestamp()) order by r.created_at desc),'[]') into reservations from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('buyer_confirmed',exists(select 1 from private.deal_confirmations c join private.trade_matches x on x.id=a.match_id where c.deal_id=d.id and c.business_id=x.buyer_business_id and c.kind='terms'),
 'supplier_confirmed',exists(select 1 from private.deal_confirmations c join private.trade_matches x on x.id=a.match_id where c.deal_id=d.id and c.business_id=x.supplier_business_id and c.kind='terms')) order by d.created_at desc),'[]') into deals from private.coffee_deals d join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('amount',f.amount::text,'paid',coalesce((select sum(p.amount) from private.commission_receipts p where p.receivable_id=f.id),0)::text) order by f.earned_at desc),'[]') into fees from private.commission_receivables f join private.coffee_deals d on d.id=f.deal_id join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.commissions.manage');
 select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') into history from private.fulfillment_history h where
 exists(select 1 from private.coffee_samples s where s.id=h.object_id and private.trade_match_staff(s.match_id,'trading.matches.manage')) or
 exists(select 1 from private.stock_allocations a where a.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage')) or
 exists(select 1 from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where r.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage')) or
 exists(select 1 from private.coffee_deals d join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where d.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage'));
 select coalesce(jsonb_agg(private.stock_balance(l.id)),'[]') into stock from (select id from public.coffee_lots where private.staff('trading.matches.manage',business_id) and not private.member(business_id) order by created_at desc limit 100) l;
 return jsonb_build_object('samples',samples,'allocations',allocations,'reservations',reservations,'deals',deals,'fees',fees,'history',history,'stock',stock);
end $$;

-- Revoke default EXECUTE from every helper and entry point added by this file.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in ('fulfillment_history_record','fulfillment_visible','fulfillment_staff','fulfillment_quote_ready','deal_confirmation_ready','protect_allocated_source','earn_deal_commission','stock_balance')) or
 (n.nspname='public' and p.proname in ('request_coffee_sample','update_coffee_sample','allocate_coffee_stock','reserve_coffee_stock','release_coffee_stock','create_coffee_deal','confirm_coffee_deal','advance_coffee_deal','record_commission_receipt','my_marketplace_operations','admin_marketplace_operations')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
commit;
