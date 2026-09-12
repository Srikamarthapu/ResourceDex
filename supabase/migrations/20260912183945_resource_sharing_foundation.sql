-- ResourceDex manual sharing foundation. Public rows contain public-safe facts only.
-- Workflow writes are deliberately limited to validated, atomic commands below.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table public.areas (
  id text primary key,
  label text not null,
  region_label text not null,
  active boolean not null default true
);
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'uploading' check (status in ('uploading','ready','analyzing','completed','failed')),
  original_path text,
  normalized_path text,
  width integer,
  height integer,
  upload_operation_key text not null,
  upload_metadata jsonb not null default '{}',
  image_hash text,
  analysis_operation_key text,
  analysis_started_at timestamptz,
  analysis_deadline_at timestamptz,
  analysis_version integer not null default 0,
  candidates jsonb not null default '[]',
  analysis_error text,
  model text,
  prompt_version text,
  schema_version text,
  token_usage jsonb not null default '{}',
  limit_reached boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,upload_operation_key)
);
create unique index one_active_analysis_per_owner on public.scans(owner_id) where status='analyzing';
create index scans_owner on public.scans(owner_id,created_at desc);
create table public.analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_key text not null,
  status text not null,
  output jsonb,
  image_hash text,
  finished_at timestamptz,
  error_code text,
  model text,
  prompt_version text,
  schema_version text,
  reserved_cost_usd numeric not null default 0 check(reserved_cost_usd >= 0),
  token_usage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(scan_id,operation_key)
);
create index analysis_attempts_owner_time on public.analysis_attempts(owner_id,created_at);
create table public.image_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  storage_path text not null unique,
  kind text not null check(kind in ('original','normalized','listing')),
  status text not null default 'ready' check(status in ('pending','ready','deleted')),
  mime_type text not null,
  width integer not null check(width > 0),
  height integer not null check(height > 0),
  content_hash text,
  created_at timestamptz not null default now()
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  candidate_id text,
  scan_id uuid references public.scans(id) on delete set null,
  title text not null default '' check(char_length(title)<=80),
  category text not null default 'other' check(category in ('wood','metal','hardware','tools','containers','craft','other')),
  description text not null default '' check(char_length(description)<=1000),
  quantity integer check(quantity > 0),
  unit text not null default 'pieces' check(char_length(unit) between 1 and 40),
  lot_label text check(char_length(lot_label)<=80),
  condition text not null default 'unknown' check(condition in ('new','used','damaged','unknown')),
  working_status text not null default 'not_applicable' check(working_status in ('working','not_working','not_tested','not_applicable')),
  material text not null default 'Unknown' check(char_length(material)<=120),
  dimensions text not null default '' check(char_length(dimensions)<=120),
  area_id text references public.areas(id),
  image_path text,
  image_alt text not null default '' check(char_length(image_alt)<=300),
  status text not null default 'draft' check(status in ('draft','available','reserved','completed','withdrawn')),
  moderation_state text not null default 'visible' check(moderation_state in ('visible','hidden')),
  revision integer not null default 1 check(revision > 0),
  owner_confirmed_at timestamptz,
  published_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_sample boolean not null default false,
  unique(owner_id,scan_id,candidate_id)
);
create index resources_discovery on public.resources(status,area_id,category,published_at desc) where moderation_state='visible';
create index resources_owner on public.resources(owner_id,created_at desc);
create index resources_search on public.resources using gin(to_tsvector('english', title || ' ' || description || ' ' || material));
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id),
  requester_id uuid not null references auth.users(id) on delete cascade,
  resource_revision integer not null,
  note text not null default '' check(char_length(note)<=500),
  proposed_window text not null default '' check(char_length(proposed_window)<=200),
  status text not null default 'pending' check(status in ('pending','accepted','declined','canceled','fulfilled')),
  reason text check(char_length(reason)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create unique index one_accepted_request on public.requests(resource_id) where status='accepted';
create unique index one_active_request_per_person on public.requests(resource_id,requester_id) where status in ('pending','accepted');
create index requests_requester on public.requests(requester_id,created_at desc);
create index requests_resource on public.requests(resource_id,status);
create table public.pickup_arrangements (
  request_id uuid primary key references public.requests(id) on delete cascade,
  meeting_place text not null check(char_length(meeting_place) between 3 and 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check(char_length(timezone) between 1 and 80),
  instructions text not null default '' check(char_length(instructions)<=1000),
  revision integer not null default 1,
  agreed_revision integer,
  agreed_at timestamptz,
  change_request_note text check(char_length(change_request_note)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at > starts_at),
  check(agreed_revision is null or agreed_revision=revision)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.resources(id),
  reason text not null check(reason in ('unsafe','prohibited','misleading','other')),
  note text not null default '' check(char_length(note)<=1000),
  status text not null default 'open' check(status in ('open','reviewed','closed')),
  created_at timestamptz not null default now()
);
create table private.command_results (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  operation_key text not null check(char_length(operation_key) between 1 and 120),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation,operation_key)
);
create table private.operator_users (user_id uuid primary key references auth.users(id) on delete cascade);
create table private.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  entity_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER code lives outside the exposed schema, has a fixed empty
-- search_path, and checks a verified actor before any privileged write.
create function private.require_verified_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and is_anonymous is not true) then
    raise exception 'Sign in with a verified email account to continue.' using errcode='42501';
  end if;
  return actor;
end;
$$;
create function private.owns_resource(resource uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.resources where id=resource and owner_id=auth.uid());
$$;
create function private.can_read_resource(resource uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.resources r where r.id=resource and (
    r.owner_id=auth.uid() or (r.moderation_state='visible' and r.status in ('available','reserved')) or
    (r.status='completed' and exists(select 1 from public.requests q where q.resource_id=r.id and q.requester_id=auth.uid() and q.status='fulfilled'))
  ));
$$;
create function private.can_read_pickup(request uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.requests q join public.resources r on r.id=q.resource_id
    where q.id=request and (r.owner_id=auth.uid() or q.requester_id=auth.uid())
    and (q.status='accepted' or (q.status='fulfilled' and q.fulfilled_at > now()-interval '30 days') or (r.owner_id=auth.uid() and q.status='canceled' and q.updated_at > now()-interval '30 days'))
    and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null));
$$;
create function private.can_read_profile(profile uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select profile=auth.uid() or exists(select 1 from public.resources r where r.owner_id=profile and r.status in ('available','reserved') and r.moderation_state='visible')
    or exists(select 1 from public.requests q join public.resources r on r.id=q.resource_id where
      (r.owner_id=auth.uid() and q.requester_id=profile) or (q.requester_id=auth.uid() and r.owner_id=profile));
$$;
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name) values(new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Community member'),60));
  return new;
end;
$$;
create trigger create_user_profile after insert on auth.users for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.areas enable row level security;
alter table public.scans enable row level security;
alter table public.analysis_attempts enable row level security;
alter table public.image_assets enable row level security;
alter table public.resources enable row level security;
alter table public.requests enable row level security;
alter table public.pickup_arrangements enable row level security;
alter table public.reports enable row level security;
alter table private.command_results enable row level security;
alter table private.operator_users enable row level security;
alter table private.audit_events enable row level security;
create policy profile_read on public.profiles for select to anon,authenticated using(private.can_read_profile(id));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy areas_read on public.areas for select to anon,authenticated using(active);
create policy scans_read on public.scans for select to authenticated using(owner_id=(select auth.uid()));
create policy image_assets_read on public.image_assets for select to authenticated using(owner_id=(select auth.uid()));
create policy resources_read on public.resources for select to anon,authenticated using(private.can_read_resource(id));
create policy requests_read on public.requests for select to authenticated using(requester_id=(select auth.uid()) or private.owns_resource(resource_id));
create policy pickup_read on public.pickup_arrangements for select to authenticated using(private.can_read_pickup(request_id));
create policy reports_read on public.reports for select to authenticated using(reporter_id=(select auth.uid()));
grant select on public.profiles,public.areas,public.resources to anon,authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select on public.scans,public.image_assets,public.requests,public.pickup_arrangements,public.reports to authenticated;
grant all on public.profiles,public.areas,public.scans,public.analysis_attempts,public.image_assets,public.resources,public.requests,public.pickup_arrangements,public.reports to service_role;
grant all on all tables in schema private to service_role;
grant usage,select on all sequences in schema private to service_role;
grant execute on function private.owns_resource(uuid),private.can_read_resource(uuid),private.can_read_pickup(uuid),private.can_read_profile(uuid) to anon,authenticated;

create function private.save_resource(input jsonb, resource_id uuid default null, expected_revision integer default null) returns public.resources
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); current_row public.resources; saved public.resources;
begin
  if resource_id is not null then
    select * into current_row from public.resources where id=resource_id for update;
    if not found or current_row.owner_id<>actor then raise exception 'Resource is unavailable.'; end if;
    if current_row.status not in ('draft','available','withdrawn') then raise exception 'Cancel the reservation before editing this resource.'; end if;
    if expected_revision is null or current_row.revision<>expected_revision then raise exception 'This resource changed. Refresh it before saving.'; end if;
  end if;
  if nullif(input->>'image_path','') is not null and not exists(select 1 from public.image_assets a where a.storage_path=input->>'image_path' and a.owner_id=actor and a.kind='listing' and a.status='ready') then raise exception 'Choose one of your prepared listing photos.'; end if;
  if nullif(input->>'scan_id','') is not null and not exists(select 1 from public.scans where id=(input->>'scan_id')::uuid and owner_id=actor) then raise exception 'Scan is unavailable.'; end if;
  if resource_id is null then
    insert into public.resources(owner_id,title,category,description,quantity,unit,lot_label,condition,working_status,material,dimensions,area_id,image_path,image_alt,scan_id,candidate_id)
    values(actor,trim(coalesce(input->>'title','')),coalesce(input->>'category','other'),trim(coalesce(input->>'description','')),nullif(input->>'quantity','')::integer,coalesce(nullif(input->>'unit',''),'pieces'),nullif(input->>'lot_label',''),coalesce(input->>'condition','unknown'),coalesce(input->>'working_status','not_applicable'),coalesce(nullif(input->>'material',''),'Unknown'),coalesce(input->>'dimensions',''),nullif(input->>'area_id',''),nullif(input->>'image_path',''),coalesce(input->>'image_alt',''),nullif(input->>'scan_id','')::uuid,nullif(input->>'candidate_id','')) returning * into saved;
  else
    update public.resources set title=trim(coalesce(input->>'title','')),category=coalesce(input->>'category','other'),description=trim(coalesce(input->>'description','')),quantity=nullif(input->>'quantity','')::integer,unit=coalesce(nullif(input->>'unit',''),'pieces'),lot_label=nullif(input->>'lot_label',''),condition=coalesce(input->>'condition','unknown'),working_status=coalesce(input->>'working_status','not_applicable'),material=coalesce(nullif(input->>'material',''),'Unknown'),dimensions=coalesce(input->>'dimensions',''),area_id=nullif(input->>'area_id',''),image_path=nullif(input->>'image_path',''),image_alt=coalesce(input->>'image_alt',''),revision=revision+1,owner_confirmed_at=null,updated_at=now() where id=resource_id returning * into saved;
    if saved.status='available' then
      perform private.validate_publication(saved);
      update public.requests set status='canceled',reason='Listing updated; request again.',updated_at=now() where requests.resource_id=save_resource.resource_id and status='pending';
    end if;
  end if;
  return saved;
end;
$$;

create function private.validate_publication(resource public.resources) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if char_length(trim(resource.title))<3 or char_length(trim(resource.description))<10 then raise exception 'Add a title and a description of at least 10 characters.'; end if;
  if resource.quantity is null and nullif(trim(resource.lot_label),'') is null then raise exception 'Add a positive quantity or name the whole lot.'; end if;
  if resource.category='tools' and resource.working_status='not_applicable' then raise exception 'State whether this tool works or has not been tested.'; end if;
  if resource.area_id is null or not exists(select 1 from public.areas where id=resource.area_id and active) then raise exception 'Choose a pickup area.'; end if;
  if char_length(trim(resource.image_alt))<3 then raise exception 'Describe the listing photo for people using screen readers.'; end if;
  if resource.image_path is null or not exists(select 1 from public.image_assets a join storage.objects o on o.name=a.storage_path and o.bucket_id='listing-images' where a.storage_path=resource.image_path and a.owner_id=resource.owner_id and a.kind='listing' and a.status='ready') then raise exception 'Prepare and approve a listing photo before publishing.'; end if;
end;
$$;

create function private.publish_resources(resource_ids uuid[], operation_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); existing private.command_results; item public.resources; payload jsonb:=to_jsonb(resource_ids); result jsonb; count_found integer:=0;
begin
  if cardinality(resource_ids)<1 or cardinality(resource_ids)>20 or cardinality(resource_ids)<>(select count(distinct id) from unnest(resource_ids) id) then raise exception 'Select between 1 and 20 distinct drafts.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':publish:' || operation_key,0));
  select * into existing from private.command_results c where c.actor_id=actor and c.operation='publish' and c.operation_key=publish_resources.operation_key;
  if found then
    if existing.payload<>payload then raise exception 'This operation key was already used for a different selection.'; end if;
    return existing.result;
  end if;
  for item in select * from public.resources where id=any(resource_ids) order by id for update loop
    count_found:=count_found+1;
    if item.owner_id<>actor or item.status not in ('draft','withdrawn') or item.moderation_state<>'visible' then raise exception 'Only your visible drafts and withdrawn resources can be published.'; end if;
    perform private.validate_publication(item);
  end loop;
  if count_found<>cardinality(resource_ids) then raise exception 'One selected resource is unavailable.'; end if;
  update public.resources set status='available',published_at=now(),owner_confirmed_at=now(),updated_at=now() where id=any(resource_ids);
  result:=jsonb_build_object('resource_ids',resource_ids);
  insert into private.command_results values(actor,'publish',operation_key,payload,result,now());
  insert into private.audit_events(actor_id,entity_id,action) select actor,id,'listing_published' from unnest(resource_ids) id;
  return result;
end;
$$;

create function private.withdraw_resource(resource_id uuid) returns public.resources
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); item public.resources;
begin
  select * into item from public.resources where id=resource_id for update;
  if not found or item.owner_id<>actor then raise exception 'Resource is unavailable.'; end if;
  if item.status='completed' then raise exception 'A collected resource cannot be withdrawn.'; end if;
  update public.requests set status='canceled',reason='The owner withdrew this resource.',updated_at=now() where requests.resource_id=withdraw_resource.resource_id and status in ('pending','accepted');
  update public.resources set status='withdrawn',updated_at=now() where id=resource_id returning * into item;
  return item;
end;
$$;

create function private.create_request(resource_id uuid,note text,proposed_window text,operation_key text) returns public.requests
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); item public.resources; request public.requests; existing private.command_results; payload jsonb:=jsonb_build_object('resource_id',resource_id,'note',note,'proposed_window',proposed_window);
begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':request:' || operation_key,0));
  select * into existing from private.command_results c where c.actor_id=actor and c.operation='request' and c.operation_key=create_request.operation_key;
  if found then
    if existing.payload<>payload then raise exception 'This operation key was already used for a different request.'; end if;
    select * into request from public.requests where id=(existing.result->>'id')::uuid;
    return request;
  end if;
  select * into item from public.resources where id=resource_id for update;
  if not found or item.status<>'available' or item.moderation_state<>'visible' then raise exception 'This resource is no longer available.'; end if;
  if item.owner_id=actor then raise exception 'You cannot request your own resource.'; end if;
  if exists(select 1 from public.requests q where q.resource_id=create_request.resource_id and q.requester_id=actor and q.status in ('pending','accepted')) then raise exception 'You already have an active request for this resource.'; end if;
  insert into public.requests(resource_id,requester_id,resource_revision,note,proposed_window) values(resource_id,actor,item.revision,coalesce(note,''),coalesce(proposed_window,'')) returning * into request;
  insert into private.command_results values(actor,'request',operation_key,payload,jsonb_build_object('id',request.id),now());
  return request;
end;
$$;

create function private.transition_request(request_id uuid,action text,reason text default '') returns public.requests
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); request public.requests; item public.resources; resource uuid;
begin
  select resource_id into resource from public.requests where id=request_id;
  -- Always lock resource first across all commands, then request: no lock inversion.
  select * into item from public.resources where id=resource for update;
  select * into request from public.requests where id=request_id for update;
  if request.id is null or actor not in (item.owner_id,request.requester_id) then raise exception 'Request is unavailable.'; end if;
  if action='accept' then
    if actor<>item.owner_id then raise exception 'Only the owner can accept a request.'; end if;
    if request.status='accepted' and item.status='reserved' then return request; end if;
    if request.status<>'pending' or item.status<>'available' or item.moderation_state<>'visible' or request.resource_revision<>item.revision then raise exception 'This resource or request changed. Refresh before accepting.'; end if;
    update public.requests set status='declined',reason='The owner accepted another request.',updated_at=now() where resource_id=item.id and status='pending' and id<>request_id;
    update public.requests set status='accepted',updated_at=now() where id=request_id returning * into request;
    update public.resources set status='reserved',updated_at=now() where id=item.id;
  elsif action='decline' then
    if actor<>item.owner_id then raise exception 'Only the owner can decline a request.'; end if;
    if request.status='declined' then return request; end if;
    if request.status<>'pending' then raise exception 'Only a pending request can be declined.'; end if;
    update public.requests set status='declined',reason=nullif(transition_request.reason,''),updated_at=now() where id=request_id returning * into request;
  elsif action='cancel' then
    if request.status='canceled' then return request; end if;
    if request.status not in ('pending','accepted') then raise exception 'This request is already closed.'; end if;
    if request.status='accepted' then update public.resources set status='available',updated_at=now() where id=item.id and status='reserved' and moderation_state='visible'; end if;
    update public.requests set status='canceled',reason=nullif(transition_request.reason,''),updated_at=now() where id=request_id returning * into request;
  elsif action='complete' then
    if actor<>item.owner_id then raise exception 'Only the owner can record collection.'; end if;
    if request.status='fulfilled' then return request; end if;
    if request.status<>'accepted' or item.status<>'reserved' or item.moderation_state<>'visible' then raise exception 'Only an accepted reservation can be marked collected.'; end if;
    update public.requests set status='fulfilled',fulfilled_at=now(),updated_at=now() where id=request_id returning * into request;
    update public.resources set status='completed',completed_at=now(),updated_at=now() where id=item.id;
    insert into private.audit_events(actor_id,entity_id,action) values(actor,item.id,'handoff_recorded');
  else raise exception 'Unknown request action.';
  end if;
  return request;
end;
$$;

create function private.save_pickup(request_id uuid,input jsonb) returns public.pickup_arrangements
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); request public.requests; item public.resources; arrangement public.pickup_arrangements; resource uuid;
begin
  select resource_id into resource from public.requests where id=request_id;
  select * into item from public.resources where id=resource for update;
  select * into request from public.requests where id=request_id for update;
  if item.owner_id is distinct from actor or request.status is distinct from 'accepted' or item.status<>'reserved' then raise exception 'Only the owner of an accepted reservation can propose pickup.'; end if;
  if not exists(select 1 from pg_timezone_names where name=input->>'timezone') then raise exception 'Choose a valid timezone.'; end if;
  insert into public.pickup_arrangements(request_id,meeting_place,starts_at,ends_at,timezone,instructions) values(request_id,trim(input->>'meeting_place'),(input->>'starts_at')::timestamptz,(input->>'ends_at')::timestamptz,input->>'timezone',coalesce(input->>'instructions',''))
  on conflict on constraint pickup_arrangements_pkey do update set meeting_place=excluded.meeting_place,starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,instructions=excluded.instructions,revision=pickup_arrangements.revision+1,agreed_revision=null,agreed_at=null,change_request_note=null,updated_at=now() returning * into arrangement;
  return arrangement;
end;
$$;
create function private.respond_pickup(request_id uuid,expected_revision integer,action text,note text default '') returns public.pickup_arrangements
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); request public.requests; item public.resources; arrangement public.pickup_arrangements; resource uuid;
begin
  select resource_id into resource from public.requests where id=request_id;
  select * into item from public.resources where id=resource for update;
  select * into request from public.requests where id=request_id for update;
  if request.requester_id is distinct from actor or request.status is distinct from 'accepted' or item.status<>'reserved' then raise exception 'Pickup details are unavailable.'; end if;
  select * into arrangement from public.pickup_arrangements where pickup_arrangements.request_id=respond_pickup.request_id for update;
  if not found or arrangement.revision<>expected_revision then raise exception 'The pickup proposal changed. Review the latest version.'; end if;
  if action='agree' then
    update public.pickup_arrangements set agreed_revision=revision,agreed_at=now(),change_request_note=null,updated_at=now() where pickup_arrangements.request_id=respond_pickup.request_id returning * into arrangement;
  elsif action='request_change' then
    if char_length(trim(note))<1 then raise exception 'Add a short note explaining the change you need.'; end if;
    update public.pickup_arrangements set agreed_revision=null,agreed_at=null,change_request_note=note,updated_at=now() where pickup_arrangements.request_id=respond_pickup.request_id returning * into arrangement;
  else raise exception 'Unknown pickup action.';
  end if;
  return arrangement;
end;
$$;

create function private.report_resource(resource_id uuid,reason text,note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); report_id uuid;
begin
  if not exists(select 1 from public.resources where id=resource_id and status in ('available','reserved') and moderation_state='visible') then raise exception 'Resource is unavailable.'; end if;
  insert into public.reports(reporter_id,resource_id,reason,note) values(actor,resource_id,reason,coalesce(note,'')) returning id into report_id;
  return report_id;
end;
$$;
create function private.moderate_resource(resource_id uuid,hide boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor();
begin
  if not exists(select 1 from private.operator_users where user_id=actor) then raise exception 'Operator access required.' using errcode='42501'; end if;
  perform 1 from public.resources where id=resource_id for update;
  if not found then raise exception 'Resource is unavailable.'; end if;
  if hide then
    update public.requests set status='canceled',reason='Resource removed from discovery by a community operator.',updated_at=now() where requests.resource_id=moderate_resource.resource_id and status in ('pending','accepted');
    update public.resources set moderation_state='hidden',status=case when status='reserved' then 'withdrawn' else status end,updated_at=now() where id=resource_id;
  else
    update public.resources set moderation_state='visible',status=case when status='available' then 'withdrawn' else status end,updated_at=now() where id=resource_id;
  end if;
  insert into private.audit_events(actor_id,entity_id,action) values(actor,resource_id,case when hide then 'resource_hidden' else 'resource_restored' end);
end;
$$;

-- Exposed RPCs are invokers; only individually granted private commands can run.
create function public.save_resource(input jsonb,resource_id uuid default null,expected_revision integer default null) returns public.resources language sql security invoker set search_path='' as $$select private.save_resource(input,resource_id,expected_revision);$$;
create function public.publish_resources(resource_ids uuid[],operation_key text) returns jsonb language sql security invoker set search_path='' as $$select private.publish_resources(resource_ids,operation_key);$$;
create function public.withdraw_resource(resource_id uuid) returns public.resources language sql security invoker set search_path='' as $$select private.withdraw_resource(resource_id);$$;
create function public.create_request(resource_id uuid,note text,proposed_window text,operation_key text) returns public.requests language sql security invoker set search_path='' as $$select private.create_request(resource_id,note,proposed_window,operation_key);$$;
create function public.transition_request(request_id uuid,action text,reason text default '') returns public.requests language sql security invoker set search_path='' as $$select private.transition_request(request_id,action,reason);$$;
create function public.save_pickup(request_id uuid,input jsonb) returns public.pickup_arrangements language sql security invoker set search_path='' as $$select private.save_pickup(request_id,input);$$;
create function public.respond_pickup(request_id uuid,expected_revision integer,action text,note text default '') returns public.pickup_arrangements language sql security invoker set search_path='' as $$select private.respond_pickup(request_id,expected_revision,action,note);$$;
create function public.report_resource(resource_id uuid,reason text,note text default '') returns uuid language sql security invoker set search_path='' as $$select private.report_resource(resource_id,reason,note);$$;
create function public.moderate_resource(resource_id uuid,hide boolean) returns void language sql security invoker set search_path='' as $$select private.moderate_resource(resource_id,hide);$$;

grant execute on function public.save_resource(jsonb,uuid,integer),private.save_resource(jsonb,uuid,integer),public.publish_resources(uuid[],text),private.publish_resources(uuid[],text),public.withdraw_resource(uuid),private.withdraw_resource(uuid),public.create_request(uuid,text,text,text),private.create_request(uuid,text,text,text),public.transition_request(uuid,text,text),private.transition_request(uuid,text,text),public.save_pickup(uuid,jsonb),private.save_pickup(uuid,jsonb),public.respond_pickup(uuid,integer,text,text),private.respond_pickup(uuid,integer,text,text),public.report_resource(uuid,text,text),private.report_resource(uuid,text,text),public.moderate_resource(uuid,boolean),private.moderate_resource(uuid,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('scan-images','scan-images',false,10485760,array['image/jpeg','image/png','image/webp']),
  ('listing-images','listing-images',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy scan_upload on storage.objects for insert to authenticated with check(bucket_id='scan-images' and (storage.foldername(name))[1]=(select auth.uid())::text and (select private.require_verified_actor())=(select auth.uid()));
create policy scan_read on storage.objects for select to authenticated using(bucket_id='scan-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy listing_read on storage.objects for select to anon,authenticated using(bucket_id='listing-images' and ((storage.foldername(name))[1]=(select auth.uid())::text or exists(select 1 from public.resources r where r.image_path=name and private.can_read_resource(r.id))));
grant execute on function private.require_verified_actor() to authenticated;

-- No fabricated community listings. These named areas are explicit demo choices.
insert into public.areas(id,label,region_label) values
  ('campus','Campus & student spaces','Demo community'),
  ('northside','Northside','Demo community'),
  ('downtown','Downtown','Demo community'),
  ('westside','Westside','Demo community'),
  ('eastside','Eastside','Demo community')
on conflict do nothing;
