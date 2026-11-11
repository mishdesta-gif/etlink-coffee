begin;

-- Cross-user writes are restricted to the existing MFA-protected staff boundary.
create function public.grant_phase1_staff(target_user uuid, requested_permission text, target_business uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  operator_id uuid;
  grant_id uuid;
begin
  perform private.authorization_lock();
  operator_id := private.require_user();
  if not private.staff('staff.manage') or target_user is null or target_user = operator_id then
    raise exception 'Independent staff manager required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from auth.users
    where id = target_user and email_confirmed_at is not null
      and (banned_until is null or banned_until <= now())
  ) then
    raise exception 'Confirmed active recipient required' using errcode = '22023';
  end if;

  if requested_permission = 'inquiry.manage' and target_business is null then
    null;
  elsif requested_permission = 'verification.review' and target_business is not null
    and exists (select 1 from public.businesses where id = target_business and archived_at is null) then
    null;
  else
    raise exception 'Unsupported staff permission or scope' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.staff_grants g
    where g.user_id = target_user and g.permission = requested_permission
      and g.revoked_at is null
      and (g.business_id is null or target_business is null or g.business_id = target_business)
  ) then
    raise exception 'Conflicting active staff grant' using errcode = '23505';
  end if;

  -- The unique constraint also blocks reuse of a revoked tuple. Preserve history.
  insert into public.staff_grants(user_id, permission, business_id, granted_by)
  values (target_user, requested_permission, target_business, operator_id)
  returning id into grant_id;
  return grant_id;
end;
$$;

revoke all on function public.grant_phase1_staff(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.grant_phase1_staff(uuid, text, uuid) to authenticated;

commit;
