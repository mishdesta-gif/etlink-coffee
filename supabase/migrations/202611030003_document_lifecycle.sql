begin;
alter table public.documents add column status text not null default 'pending' check (status in ('pending','uploaded'));
-- Only a trusted server validator can release an uploaded object. End-user JWTs
-- cannot attest to their own content validation, even through a direct RPC call.
create function public.finalize_document(i uuid,u uuid,sha text,mime text,bytes integer) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents; o storage.objects;
begin
 select * into d from public.documents where id=i for update;
 if not found or u is null or d.created_by is distinct from u
 or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null)
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
end $$;
revoke execute on function public.finalize_document(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.finalize_document(uuid,uuid,text,text,integer) to service_role;
alter policy verification_upload on storage.objects with check (
 bucket_id='verification' and owner_id=auth.uid()::text and exists(select 1 from public.documents d where d.object_path=name and d.status='pending' and d.created_by=auth.uid() and private.member(d.business_id,array['owner','admin','operations']))
);
alter policy verification_read on storage.objects using (
 bucket_id='verification' and exists(select 1 from public.documents d where d.object_path=name and d.status='uploaded' and (private.member(d.business_id) or private.staff('verification.review',d.business_id)))
);
create function private.review_queue_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare reviewer record;
begin
 if TG_TABLE_NAME='capabilities' and new.status<>'submitted' then return new; end if;
 if TG_TABLE_NAME='documents' and new.status<>'uploaded' then return new; end if;
 for reviewer in select distinct user_id from public.staff_grants where permission='verification.review' and revoked_at is null and (business_id is null or business_id=new.business_id) loop
   perform private.notify(reviewer.user_id,new.business_id,TG_TABLE_NAME||'-queue:'||new.id||':'||coalesce(to_jsonb(new)->>'revision','1'),'verification_queue','A verification item needs review in the authorized staff queue.');
 end loop;
 return new;
end $$;
create trigger capability_queue after insert or update on public.capabilities for each row execute function private.review_queue_notification();
create trigger document_queue after update on public.documents for each row execute function private.review_queue_notification();
revoke execute on function private.review_queue_notification() from public,anon,authenticated;
commit;
