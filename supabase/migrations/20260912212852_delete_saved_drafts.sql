-- Remember removed scan candidates so a stale browser retry cannot recreate a
-- deleted draft. A new upload or identification produces new candidate IDs.
create table private.deleted_draft_candidates (
  owner_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  candidate_id text not null,
  deleted_at timestamptz not null default now(),
  primary key(owner_id,scan_id,candidate_id)
);
alter table private.deleted_draft_candidates enable row level security;
revoke all on private.deleted_draft_candidates from public,anon,authenticated;
grant all on private.deleted_draft_candidates to service_role;

create function private.guard_deleted_draft_candidate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.scan_id is not null and new.candidate_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.owner_id::text || ':' || new.scan_id::text || ':' || new.candidate_id, 912124));
    if exists(select 1 from private.deleted_draft_candidates d
      where d.owner_id=new.owner_id and d.scan_id=new.scan_id and d.candidate_id=new.candidate_id) then
      raise exception 'This draft was deleted. Start a new photo or identification to create it again.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_deleted_draft_candidate() from public,anon,authenticated;
create trigger prevent_deleted_draft_retry before insert on public.resources
  for each row execute function private.guard_deleted_draft_candidate();

create function private.delete_resource_drafts(resource_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.require_verified_actor();
  item public.resources;
  candidate_lock bigint;
  deleted_ids uuid[] := '{}';
begin
  if resource_ids is null or array_position(resource_ids,null) is not null
    or cardinality(resource_ids)<1 or cardinality(resource_ids)>1000
    or cardinality(resource_ids)<>(select count(distinct id) from unnest(resource_ids) id) then
    raise exception 'Select between 1 and 1000 distinct drafts.';
  end if;

  -- Acquire candidate locks before resource row locks, in the same order as a
  -- candidate INSERT. Otherwise a duplicate insert could wait on our DELETE
  -- while holding the very advisory lock that deletion needs.
  for candidate_lock in
    select distinct pg_catalog.hashtextextended(
      r.owner_id::text || ':' || r.scan_id::text || ':' || r.candidate_id, 912124)
    from public.resources r where r.id=any(resource_ids) and r.owner_id=actor
      and r.scan_id is not null and r.candidate_id is not null order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(candidate_lock);
  end loop;

  -- Publication and autosave use these same row locks. Check again after the
  -- lock: a listing published in another tab must never be deleted as a draft.
  for item in select * from public.resources where id=any(resource_ids) order by id for update loop
    if item.owner_id<>actor or item.status<>'draft' or item.published_at is not null then
      raise exception 'Only your unpublished drafts can be deleted. Refresh your resources and try again.';
    end if;
    deleted_ids := array_append(deleted_ids,item.id);
  end loop;
  -- Missing rows are harmless on a retry after the first response was lost.
  insert into private.deleted_draft_candidates(owner_id,scan_id,candidate_id)
    select owner_id,scan_id,candidate_id from public.resources where id=any(deleted_ids)
      and scan_id is not null and candidate_id is not null on conflict do nothing;
  delete from public.resources where id=any(deleted_ids);
  -- Photos and scans may be shared by other drafts or published resources.
  -- Retain them; account deletion remains responsible for account-wide cleanup.
  return deleted_ids;
end;
$$;
create function public.delete_resource_drafts(resource_ids uuid[]) returns uuid[]
language sql security invoker set search_path='' as $$
  select private.delete_resource_drafts(resource_ids);
$$;
revoke all on function private.delete_resource_drafts(uuid[]),public.delete_resource_drafts(uuid[]) from public,anon,authenticated;
grant execute on function private.delete_resource_drafts(uuid[]),public.delete_resource_drafts(uuid[]) to authenticated;
