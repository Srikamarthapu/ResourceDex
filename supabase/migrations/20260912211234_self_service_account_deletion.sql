-- Account removal spans Postgres, Storage, and Auth. A durable marker hides
-- listings immediately and closes writes before the retryable cleanup begins.
create table private.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public,anon,authenticated;
grant all on private.account_deletions to service_role;

create function private.account_is_active(account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=account_id)
    and not exists(select 1 from private.account_deletions where user_id=account_id);
$$;
revoke all on function private.account_is_active(uuid) from public,anon,authenticated;

create function private.lock_active_account(account_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(account_id::text,731011));
  if account_id is null or not private.account_is_active(account_id) then
    raise exception 'This account is being deleted or no longer exists.' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.lock_active_account(uuid) from public,anon,authenticated;

create or replace function private.require_verified_actor() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  perform private.lock_active_account(actor);
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and is_anonymous is not true) then
    raise exception 'Sign in with a verified email account to continue.' using errcode='42501';
  end if;
  return actor;
end;
$$;

-- Include service writes and signed uploads: both may already be in flight when
-- deletion starts. FK checks alone do not protect the Storage object namespace.
create function private.guard_account_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_active_account((to_jsonb(new)->>tg_argv[0])::uuid);
  return new;
end;
$$;
revoke all on function private.guard_account_content() from public,anon,authenticated;
create trigger active_account before insert or update on public.profiles for each row execute function private.guard_account_content('id');
create trigger active_account before insert or update on public.resources for each row execute function private.guard_account_content('owner_id');
create trigger active_account before insert or update on public.scans for each row execute function private.guard_account_content('owner_id');
create trigger active_account before insert or update on public.scan_reviews for each row execute function private.guard_account_content('owner_id');
create trigger active_account before insert or update on public.image_assets for each row execute function private.guard_account_content('owner_id');
create trigger active_account before insert or update on public.analysis_attempts for each row execute function private.guard_account_content('owner_id');
create trigger active_account before insert or update on public.requests for each row execute function private.guard_account_content('requester_id');
create trigger active_account before insert or update on public.reports for each row execute function private.guard_account_content('reporter_id');
create trigger active_account before insert or update on private.command_results for each row execute function private.guard_account_content('actor_id');

create function private.guard_account_storage() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.bucket_id in ('scan-images','listing-images') then
    perform private.lock_active_account(split_part(new.name,'/',1)::uuid);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_account_storage() from public,anon,authenticated;
create trigger resourcedex_active_account before insert or update on storage.objects
  for each row execute function private.guard_account_storage();

create or replace function private.can_read_resource(resource uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.resources r where r.id=resource
    and private.account_is_active(r.owner_id) and (
      r.owner_id=auth.uid() or (r.moderation_state='visible' and r.status in ('available','reserved')) or
      (r.status='completed' and exists(select 1 from public.requests q where q.resource_id=r.id and q.requester_id=auth.uid() and q.status='fulfilled'))
    ));
$$;

create function private.begin_account_deletion(account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Separate transaction from cleanup: do not hold this exclusive account lock
  -- while waiting for resource row locks held by another participant.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_id::text,731011));
  if not exists(select 1 from auth.users where id=account_id) then
    raise exception 'Account no longer exists.';
  end if;
  insert into private.account_deletions(user_id) values(account_id) on conflict do nothing;
end;
$$;

create function private.remove_account_records(account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.account_deletions where user_id=account_id) then
    raise exception 'Account deletion has not been confirmed.';
  end if;
  -- Release another owner's resource if this departing user held its reservation.
  update public.resources r set status='available',revision=revision+1,updated_at=now()
    where r.owner_id<>account_id and r.status='reserved' and private.account_is_active(r.owner_id)
      and exists(select 1 from public.requests q where q.resource_id=r.id and q.requester_id=account_id and q.status='accepted');
  delete from private.command_results c where c.actor_id=account_id
    or (c.operation='request' and c.payload->>'resource_id' in (select id::text from public.resources where owner_id=account_id));
  delete from private.audit_events e where e.actor_id=account_id
    or e.entity_id in (select id from public.resources where owner_id=account_id);
  -- These foreign keys intentionally do not cascade ordinary listing deletions.
  -- Pickup arrangements cascade from these requests, including the other party's.
  delete from public.requests q where q.requester_id=account_id
    or q.resource_id in (select id from public.resources where owner_id=account_id);
  delete from public.reports r where r.reporter_id=account_id
    or r.resource_id in (select id from public.resources where owner_id=account_id);
  delete from public.resources where owner_id=account_id;
  delete from public.scan_reviews where owner_id=account_id;
  delete from public.analysis_attempts where owner_id=account_id;
  delete from public.image_assets where owner_id=account_id;
  delete from public.scans where owner_id=account_id;
  delete from public.profiles where id=account_id;
end;
$$;

-- Only the verified server endpoint can invoke these commands with an account ID.
revoke all on function private.begin_account_deletion(uuid),private.remove_account_records(uuid) from public,anon,authenticated;
grant execute on function private.begin_account_deletion(uuid),private.remove_account_records(uuid) to service_role;
create function public.begin_account_deletion(p_owner uuid) returns void
language sql security invoker set search_path='' as $$ select private.begin_account_deletion(p_owner); $$;
create function public.remove_account_records(p_owner uuid) returns void
language sql security invoker set search_path='' as $$ select private.remove_account_records(p_owner); $$;
revoke all on function public.begin_account_deletion(uuid),public.remove_account_records(uuid) from public,anon,authenticated;
grant execute on function public.begin_account_deletion(uuid),public.remove_account_records(uuid) to service_role;
