-- Saving reviewed public edits records the owner confirmation for the new
-- revision. Draft saves still require explicit publication confirmation.
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
    values(actor,trim(coalesce(input->>'title','')),coalesce(input->>'category','other'),trim(coalesce(input->>'description','')),nullif(input->>'quantity','')::integer,coalesce(nullif(input->>'unit',''),'pieces'),nullif(input->>'lot_label',''),coalesce(input->>'condition','unknown'),coalesce(input->>'working_status','not_applicable'),coalesce(nullif(input->>'material',''),'Unknown'),coalesce(input->>'dimensions',''),nullif(input->>'area_id',''),nullif(input->>'image_path',''),coalesce(input->>'image_alt',''),nullif(input->>'scan_id','')::uuid,nullif(input->>'candidate_id','')) returning * into saved;
  else
    update public.resources set title=trim(coalesce(input->>'title','')),category=coalesce(input->>'category','other'),description=trim(coalesce(input->>'description','')),quantity=nullif(input->>'quantity','')::integer,unit=coalesce(nullif(input->>'unit',''),'pieces'),lot_label=nullif(input->>'lot_label',''),condition=coalesce(input->>'condition','unknown'),working_status=coalesce(input->>'working_status','not_applicable'),material=coalesce(nullif(input->>'material',''),'Unknown'),dimensions=coalesce(input->>'dimensions',''),area_id=nullif(input->>'area_id',''),image_path=nullif(input->>'image_path',''),image_alt=coalesce(input->>'image_alt',''),revision=revision+1,owner_confirmed_at=case when status='available' then now() else null end,updated_at=now() where id=resource_id returning * into saved;
    if saved.status='available' then
      perform private.validate_publication(saved);
      update public.requests set status='canceled',reason='Listing updated; request again.',updated_at=now() where requests.resource_id=save_resource.resource_id and status='pending';
    end if;
  end if;
  return saved;
end;
$$;
