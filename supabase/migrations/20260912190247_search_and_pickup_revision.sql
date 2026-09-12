-- Search owner-reviewed listing facts and category using the same indexed
-- document in Postgres and the Data API. Stable ID ordering breaks timestamp ties.
alter table public.resources add column search_document tsvector generated always as (
  to_tsvector('english', title || ' ' || category || ' ' || description || ' ' || material)
) stored;
create index resources_search_document on public.resources using gin(search_document);
drop index public.resources_search;

-- Owner edits must bind the pickup revision they saw, just like agreement.
-- Revision zero means the owner saw no proposal. No legacy unguarded RPC remains.
drop function public.save_pickup(uuid,jsonb);
drop function private.save_pickup(uuid,jsonb);
create function private.save_pickup(request_id uuid,input jsonb,expected_revision integer) returns public.pickup_arrangements
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); request public.requests; item public.resources; arrangement public.pickup_arrangements; resource uuid; current_revision integer;
begin
  select resource_id into resource from public.requests where id=request_id;
  select * into item from public.resources where id=resource for update;
  select * into request from public.requests where id=request_id for update;
  if item.owner_id is distinct from actor or request.status is distinct from 'accepted' or item.status<>'reserved' then raise exception 'Only the owner of an accepted reservation can propose pickup.'; end if;
  select revision into current_revision from public.pickup_arrangements where pickup_arrangements.request_id=save_pickup.request_id for update;
  if expected_revision is null or expected_revision<>coalesce(current_revision,0) then raise exception 'Pickup details changed in another tab. Review the latest proposal before editing.'; end if;
  if not exists(select 1 from pg_timezone_names where name=input->>'timezone') then raise exception 'Choose a valid timezone.'; end if;
  insert into public.pickup_arrangements(request_id,meeting_place,starts_at,ends_at,timezone,instructions) values(request_id,trim(input->>'meeting_place'),(input->>'starts_at')::timestamptz,(input->>'ends_at')::timestamptz,input->>'timezone',coalesce(input->>'instructions',''))
  on conflict on constraint pickup_arrangements_pkey do update set meeting_place=excluded.meeting_place,starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,instructions=excluded.instructions,revision=pickup_arrangements.revision+1,agreed_revision=null,agreed_at=null,change_request_note=null,updated_at=now() returning * into arrangement;
  return arrangement;
end;
$$;
create function public.save_pickup(request_id uuid,input jsonb,expected_revision integer) returns public.pickup_arrangements language sql security invoker set search_path='' as $$select private.save_pickup(request_id,input,expected_revision);$$;
revoke all on function public.save_pickup(uuid,jsonb,integer),private.save_pickup(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_pickup(uuid,jsonb,integer),private.save_pickup(uuid,jsonb,integer) to authenticated;

-- Preserve explicit unknowns even when a direct API caller sends whitespace.
create or replace function private.save_resource(input jsonb, resource_id uuid default null, expected_revision integer default null) returns public.resources
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
    values(actor,trim(coalesce(input->>'title','')),coalesce(input->>'category','other'),trim(coalesce(input->>'description','')),nullif(input->>'quantity','')::integer,coalesce(nullif(input->>'unit',''),'pieces'),nullif(input->>'lot_label',''),coalesce(input->>'condition','unknown'),coalesce(input->>'working_status','not_applicable'),coalesce(nullif(trim(input->>'material'),''),'Unknown'),coalesce(trim(input->>'dimensions'),''),nullif(input->>'area_id',''),nullif(input->>'image_path',''),coalesce(input->>'image_alt',''),nullif(input->>'scan_id','')::uuid,nullif(input->>'candidate_id','')) returning * into saved;
  else
    update public.resources set title=trim(coalesce(input->>'title','')),category=coalesce(input->>'category','other'),description=trim(coalesce(input->>'description','')),quantity=nullif(input->>'quantity','')::integer,unit=coalesce(nullif(input->>'unit',''),'pieces'),lot_label=nullif(input->>'lot_label',''),condition=coalesce(input->>'condition','unknown'),working_status=coalesce(input->>'working_status','not_applicable'),material=coalesce(nullif(trim(input->>'material'),''),'Unknown'),dimensions=coalesce(trim(input->>'dimensions'),''),area_id=nullif(input->>'area_id',''),image_path=nullif(input->>'image_path',''),image_alt=coalesce(input->>'image_alt',''),revision=revision+1,owner_confirmed_at=case when status='available' then now() else null end,updated_at=now() where id=resource_id returning * into saved;
    if saved.status='available' then
      perform private.validate_publication(saved);
      update public.requests set status='canceled',reason='Listing updated; request again.',updated_at=now() where requests.resource_id=save_resource.resource_id and status='pending';
    end if;
  end if;
  return saved;
end;
$$;
