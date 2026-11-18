-- Local release candidate only. Hosted application requires separate approval.
-- Historical commission terms, receipts and audit rows are never rewritten.
begin;
alter table private.commission_terms add column payment_policy text check(payment_policy is null or payment_policy='supplier_30_70');
create table private.supplier_payment_milestones (
 id uuid primary key, deal_id uuid not null references private.coffee_deals(id),
 milestone text not null check(milestone in ('supplier_first_payment','export_and_final_payment')),
 payment_reference text not null check(length(trim(payment_reference)) between 3 and 120),
 export_reference text not null default '', created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 check((milestone='supplier_first_payment' and export_reference='') or (milestone='export_and_final_payment' and length(trim(export_reference)) between 3 and 120)),unique(deal_id,milestone)
);
alter table private.supplier_payment_milestones enable row level security;
revoke all on private.supplier_payment_milestones from public,anon,authenticated,service_role;
create trigger immutable_record before update or delete on private.supplier_payment_milestones for each row execute function private.immutable_audit();

-- Archived businesses are historical, never live candidates or staff operations.
create or replace function private.trade_reader(d text,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.businesses where id=b and archived_at is null) and
 (private.member(b) or private.staff(case when d='request' then 'trading.requests.review' else 'trading.lots.review' end,b) or private.staff('trading.matches.manage',b))
$$;
create or replace function private.trade_match_staff(m uuid,p text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_matches x join public.businesses b on b.id=x.buyer_business_id join public.businesses s on s.id=x.supplier_business_id
 where x.id=m and b.archived_at is null and s.archived_at is null and private.staff(p,b.id) and private.staff(p,s.id) and not private.member(b.id) and not private.member(s.id))
$$;
create policy unarchived_verification on public.capabilities as restrictive for select to authenticated using(exists(select 1 from public.businesses b where b.id=business_id and b.archived_at is null));
create or replace function public.create_commission_terms(m uuid,payer uuid,calculation text,amount numeric,currency text,earning_trigger text,starts timestamptz,expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare x private.trade_matches;i uuid;v integer;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into x from private.trade_matches where id=m;
 if x.id is null or not private.trade_match_staff(m,'trading.commissions.manage') or not private.trade_match_current(m) or payer is null or payer<>x.supplier_business_id then raise exception 'Current independent commission authority required' using errcode='42501';end if;
 if calculation is null or calculation<>'percentage' or amount is null or amount<0.5 or amount>2 or (calculation='percentage' and amount>100)
 or currency is null or currency !~ '^[A-Z]{3}$' or earning_trigger is null or earning_trigger<>'confirmed_delivery'
 or starts is null or expires is null or expires<=starts or expires<=clock_timestamp() then raise exception 'Invalid commission terms';end if;
 select coalesce(max(t.version),0)+1 into v from private.commission_terms t where t.match_id=m and t.business_id=payer;
 insert into private.commission_terms(match_id,business_id,version,calculation,amount,basis,currency,earning_trigger,effective_from,expires_at,created_by,payment_policy)
 values(m,payer,v,calculation,amount,case when calculation='percentage' then 'coffee_value' else 'fixed_service_fee' end,currency,earning_trigger,starts,expires,auth.uid(),'supplier_30_70') returning id into i;
 perform private.trade_event(payer,'trade.commission.proposed',i,'New immutable commission terms version.');return i;
end $$;
-- New progression requires accepted supplier-only terms under the launch policy.
create or replace function private.trade_commission_ready(m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.trade_matches x join private.commission_terms t on t.match_id=x.id and t.business_id=x.supplier_business_id
 where x.id=m and t.version=(select max(z.version) from private.commission_terms z where z.match_id=m and z.business_id=x.supplier_business_id)
 and t.payment_policy='supplier_30_70' and t.calculation='percentage' and t.amount between 0.5 and 2
 and t.effective_from<=clock_timestamp() and t.expires_at>clock_timestamp()
 and exists(select 1 from private.commission_acceptances a join public.memberships mem on mem.user_id=a.accepted_by and mem.business_id=a.business_id join public.businesses b on b.id=mem.business_id join auth.users u on u.id=mem.user_id
 where a.terms_id=t.id and mem.active and mem.role in ('owner','admin') and b.archived_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp())))
 and not exists(select 1 from private.commission_terms t join private.trade_matches x on x.id=t.match_id where t.match_id=m and t.business_id<>x.supplier_business_id)
$$;
create or replace function private.earn_deal_commission(d private.coffee_deals,trigger_name text) returns void language plpgsql security definer set search_path='' as $$
declare t private.commission_terms;quote jsonb;quantity numeric;fee numeric;i uuid;x private.trade_matches;match_uuid uuid;
begin
 select a.quantity_kg,a.match_id into quantity,match_uuid from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where r.id=d.reservation_id;
 select * into x from private.trade_matches where id=match_uuid;
 for t in select * from private.commission_terms where id=any(d.commission_snapshot) and earning_trigger=trigger_name and payment_policy is null loop
  if t.calculation='fixed' and exists(select 1 from private.commission_receivables where terms_id=t.id) then continue;end if;
  select payload into quote from private.trade_offer_versions where (offer_id,version)=(case when t.business_id=x.buyer_business_id then d.buyer_offer else d.supplier_offer end,case when t.business_id=x.buyer_business_id then d.buyer_version else d.supplier_version end);
  fee=round(case when t.calculation='fixed' then t.amount else quantity*(quote->>'price')::numeric*t.amount/100 end,6);
  insert into private.commission_receivables(deal_id,terms_id,business_id,amount,currency) values(d.id,t.id,t.business_id,fee,t.currency) on conflict(deal_id,terms_id) do nothing returning id into i;
  if i is not null then perform private.trade_event(t.business_id,'commission.earned',i,'Commission earned at its exact agreed deal milestone.');end if;
 end loop;
end $$;
create or replace function public.issue_trade_offer(m uuid,recipient uuid,i uuid,v integer,p jsonb,expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare x private.trade_matches;o private.trade_offers;lastv integer;normalized jsonb;terms uuid[];r public.buyer_requests;l public.coffee_lots;
begin
 perform private.authorization_lock();perform private.trade_actor();select * into x from private.trade_matches where id=m;
 if x.id is null or not private.trade_match_staff(m,'trading.offers.issue') or not private.trade_match_current(m) then raise exception 'Current independent offer authority required' using errcode='42501';end if;
 if not private.trade_commission_ready(m) then raise exception 'Current commission terms must be accepted before protected progression';end if;
 if recipient is null or recipient not in (x.buyer_business_id,x.supplier_business_id) or i is null or v is null or v<0 or expires is null or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' then raise exception 'Invalid quote recipient or validity';end if;
 normalized=private.trade_quote_payload(p);
 if recipient=x.supplier_business_id and exists(select 1 from private.commission_terms t where t.match_id=m and t.business_id=recipient and t.version=(select max(z.version) from private.commission_terms z where z.match_id=m and z.business_id=recipient) and t.currency<>normalized->>'currency') then raise exception 'Supplier quote and commission currency must match';end if;select * into r from public.buyer_requests where id=x.request_id;select * into l from public.coffee_lots where id=x.lot_id;
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
create function private.commission_payable(fee uuid) returns numeric language sql stable security definer set search_path='' as $$
 select case when t.payment_policy is null then f.amount
 when exists(select 1 from private.supplier_payment_milestones where deal_id=f.deal_id and milestone='export_and_final_payment') then f.amount
 when exists(select 1 from private.supplier_payment_milestones where deal_id=f.deal_id and milestone='supplier_first_payment') then round(f.amount*0.30,6) else 0 end
 from private.commission_receivables f join private.commission_terms t on t.id=f.terms_id where f.id=fee
$$;
revoke all on function private.commission_payable(uuid) from public,anon,authenticated,service_role;
create function public.record_supplier_payment_milestone(deal uuid,i uuid,milestone text,payment_reference text,export_reference text default '') returns void language plpgsql security definer set search_path='' as $$
declare d private.coffee_deals; x private.trade_matches; t private.commission_terms; existing private.supplier_payment_milestones; quantity numeric; match_uuid uuid; quote jsonb; fee numeric; fee_id uuid;
begin
 perform private.authorization_lock();
 select * into d from private.coffee_deals where id=deal for update;
 select a.quantity_kg,a.match_id into quantity,match_uuid from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where r.id=d.reservation_id;
 select * into x from private.trade_matches where id=match_uuid;
 perform private.fulfillment_staff(x.id,'trading.commissions.manage');
 if d.id is null or i is null or milestone is null or milestone not in ('supplier_first_payment','export_and_final_payment') or coalesce(length(trim(payment_reference)),0) not between 3 and 120 then raise exception 'Invalid supplier payment milestone';end if;
 if (milestone='supplier_first_payment' and coalesce(export_reference,'')<>'') or (milestone='export_and_final_payment' and coalesce(length(trim(export_reference)),0) not between 3 and 120) then raise exception 'Export and final payment evidence required';end if;
 select * into existing from private.supplier_payment_milestones where id=i;
 if existing.id is not null then
  if existing.deal_id=deal and existing.milestone=milestone and existing.payment_reference=trim(payment_reference) and existing.export_reference=trim(coalesce(export_reference,'')) then return;end if;
  raise exception 'Milestone identity changed';
 end if;
 if d.status not in ('contract_signed','in_transit','delivered','completed') then raise exception 'Signed deal required';end if;
 if milestone='export_and_final_payment' and (d.status<>'completed' or not exists(select 1 from private.supplier_payment_milestones p where p.deal_id=deal and p.milestone='supplier_first_payment')) then raise exception 'Completed export deal and first payment required';end if;
 select * into t from private.commission_terms where id=any(d.commission_snapshot) and business_id=x.supplier_business_id and payment_policy='supplier_30_70';
 if t.id is null or t.calculation<>'percentage' or t.amount<0.5 or t.amount>2 or not exists(select 1 from private.commission_acceptances where terms_id=t.id) then raise exception 'Accepted supplier commission terms required';end if;
 select payload into quote from private.trade_offer_versions where offer_id=d.supplier_offer and version=d.supplier_version;
 if quote->>'currency'<>t.currency then raise exception 'Commission currency must match supplier quote';end if;
 fee=round(quantity*(quote->>'price')::numeric*t.amount/100,6);
 if fee<=0 then raise exception 'Commission below ledger precision';end if;
 insert into private.supplier_payment_milestones values(i,deal,milestone,trim(payment_reference),trim(coalesce(export_reference,'')),auth.uid(),clock_timestamp());
 insert into private.commission_receivables(deal_id,terms_id,business_id,amount,currency) values(deal,t.id,t.business_id,fee,t.currency) on conflict(deal_id,terms_id) do nothing returning id into fee_id;
 perform private.trade_event(t.business_id,'commission.milestone.'||milestone,i,'ET Link recorded external supplier payment evidence; no money transferred.');
end $$;
revoke all on function public.record_supplier_payment_milestone(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_supplier_payment_milestone(uuid,uuid,text,text,text) to authenticated;
create or replace function public.record_commission_receipt(receivable uuid,i uuid,amount_received numeric,payment_reference text) returns void language plpgsql security definer set search_path='' as $$
declare f private.commission_receivables;d private.coffee_deals;a private.stock_allocations;p private.commission_receipts;paid numeric;
begin
 perform private.authorization_lock();select * into f from private.commission_receivables where id=receivable for update;
 select * into d from private.coffee_deals where id=f.deal_id;select a1.* into a from private.stock_allocations a1 join private.stock_reservations r on r.allocation_id=a1.id where r.id=d.reservation_id;
 perform private.fulfillment_staff(a.match_id,'trading.commissions.manage');
 if f.id is null or i is null or amount_received is null or amount_received<=0 or coalesce(length(trim(payment_reference)),0) not between 3 and 120 then raise exception 'Invalid commission payment record';end if;
 select * into p from private.commission_receipts where id=i;
 if p.id is not null then if p.receivable_id=receivable and p.amount=amount_received and p.payment_reference=trim(payment_reference) then return;else raise exception 'Payment identity changed';end if;end if;
 select coalesce(sum(amount),0) into paid from private.commission_receipts where receivable_id=receivable;
 if paid+amount_received>private.commission_payable(f.id) then raise exception 'Payment exceeds outstanding commission';end if;
 insert into private.commission_receipts values(i,receivable,amount_received,trim(payment_reference),auth.uid(),clock_timestamp());
 perform private.trade_event(f.business_id,'commission.payment.recorded',i,'ET Link recorded an externally received commission payment.');
end $$;
create or replace function public.my_marketplace_operations(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 'payable',private.commission_payable(f.id)::text,'paid',coalesce((select sum(p.amount) from private.commission_receipts p where p.receivable_id=f.id),0)::text) order by f.earned_at desc),'[]') into fees
 from private.commission_receivables f where f.business_id=b;
 select coalesce(jsonb_agg(private.stock_balance(l.id)),'[]') into stock from (select id from public.coffee_lots where business_id=b and private.trade_capability(b,'supplier') order by created_at desc limit 100) l;
 return jsonb_build_object('samples',samples,'allocations',allocations,'deals',deals,'fees',fees,'stock',stock);
end $$;
create or replace function public.my_trading_commercial(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare terms jsonb;offers jsonb;
begin
 perform private.trade_actor();if not private.member(b) then raise exception 'Business membership required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'version',t.version,'calculation',t.calculation,'amount',t.amount,'basis',t.basis,'currency',t.currency,'earning_trigger',t.earning_trigger,'payment_policy',t.payment_policy,'effective_from',t.effective_from,'expires_at',t.expires_at,'accepted',exists(select 1 from private.commission_acceptances a where a.terms_id=t.id)) order by t.created_at desc),'[]') into terms
 from private.commission_terms t where t.business_id=b and private.trade_match_current(t.match_id) and t.version=(select max(z.version) from private.commission_terms z where z.match_id=t.match_id and z.business_id=b);
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'version',v.version,'payload',v.payload,'valid_until',v.valid_until,'issued_at',v.issued_at,
 'response',(select jsonb_build_object('response',r.response,'counter_payload',r.counter_payload,'created_at',r.created_at) from private.trade_offer_responses r where r.offer_id=o.id and r.version=v.version and r.business_id=b)) order by v.issued_at desc),'[]') into offers
 from private.trade_offers o join private.trade_offer_versions v on v.offer_id=o.id where o.business_id=b and private.trade_offer_current(o.id,v.version);
 return jsonb_build_object('commissions',terms,'offers',offers);
end $$;
create or replace function public.admin_marketplace_operations() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare samples jsonb;allocations jsonb;reservations jsonb;deals jsonb;fees jsonb;history jsonb;stock jsonb;
begin
 perform private.trade_actor();
 select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc),'[]') into samples from private.coffee_samples s where private.trade_match_staff(s.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('reserved_kg',case when exists(select 1 from private.stock_reservations r where r.allocation_id=a.id and (r.status='committed' or (r.status='reserved' and r.expires_at>clock_timestamp()))) then a.quantity_kg else 0 end) order by a.created_at desc),'[]') into allocations from private.stock_allocations a where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('expired',r.expires_at<=clock_timestamp()) order by r.created_at desc),'[]') into reservations from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('buyer_confirmed',exists(select 1 from private.deal_confirmations c join private.trade_matches x on x.id=a.match_id where c.deal_id=d.id and c.business_id=x.buyer_business_id and c.kind='terms'),
 'supplier_confirmed',exists(select 1 from private.deal_confirmations c join private.trade_matches x on x.id=a.match_id where c.deal_id=d.id and c.business_id=x.supplier_business_id and c.kind='terms')) order by d.created_at desc),'[]') into deals from private.coffee_deals d join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.matches.manage');
 select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('amount',f.amount::text,'payable',private.commission_payable(f.id)::text,'paid',coalesce((select sum(p.amount) from private.commission_receipts p where p.receivable_id=f.id),0)::text) order by f.earned_at desc),'[]') into fees from private.commission_receivables f join private.coffee_deals d on d.id=f.deal_id join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where private.trade_match_staff(a.match_id,'trading.commissions.manage');
 select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') into history from private.fulfillment_history h where
 exists(select 1 from private.coffee_samples s where s.id=h.object_id and private.trade_match_staff(s.match_id,'trading.matches.manage')) or
 exists(select 1 from private.stock_allocations a where a.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage')) or
 exists(select 1 from private.stock_reservations r join private.stock_allocations a on a.id=r.allocation_id where r.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage')) or
 exists(select 1 from private.coffee_deals d join private.stock_reservations r on r.id=d.reservation_id join private.stock_allocations a on a.id=r.allocation_id where d.id=h.object_id and private.trade_match_staff(a.match_id,'trading.matches.manage'));
 select coalesce(jsonb_agg(private.stock_balance(l.id)),'[]') into stock from (select id from public.coffee_lots where exists(select 1 from public.businesses b where b.id=coffee_lots.business_id and b.archived_at is null) and private.staff('trading.matches.manage',business_id) and not private.member(business_id) order by created_at desc limit 100) l;
 return jsonb_build_object('samples',samples,'allocations',allocations,'reservations',reservations,'deals',deals,'fees',fees,'history',history,'stock',stock);
end $$;
commit;
