-- Bind explicit publication consent to the exact revisions shown in preview.
-- A retry preserves both the selection and its reviewed revisions.
drop function public.publish_resources(uuid[],text);
drop function private.publish_resources(uuid[],text);
create function private.publish_resources(resource_ids uuid[], operation_key text, expected_revisions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_actor(); existing private.command_results; item public.resources; payload jsonb:=jsonb_build_object('resource_ids',resource_ids,'expected_revisions',expected_revisions); result jsonb; count_found integer:=0;
begin
  if resource_ids is null or array_position(resource_ids,null) is not null or cardinality(resource_ids)<1 or cardinality(resource_ids)>20 or cardinality(resource_ids)<>(select count(distinct id) from unnest(resource_ids) id) then raise exception 'Select between 1 and 20 distinct drafts.'; end if;
  if jsonb_typeof(expected_revisions) is distinct from 'object' then raise exception 'Review the current resource details before publishing.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':publish:' || operation_key,0));
  select * into existing from private.command_results c where c.actor_id=actor and c.operation='publish' and c.operation_key=publish_resources.operation_key;
  if found then
    if existing.payload<>payload then raise exception 'This operation key was already used for a different selection.'; end if;
    return existing.result;
  end if;
  for item in select * from public.resources where id=any(resource_ids) order by id for update loop
    count_found:=count_found+1;
    if item.owner_id<>actor or item.status not in ('draft','withdrawn') or item.moderation_state<>'visible' then raise exception 'Only your visible drafts and withdrawn resources can be published.'; end if;
    if nullif(expected_revisions->>item.id::text,'')::integer is distinct from item.revision then raise exception 'A selected resource changed in another tab. Review its latest details before publishing.'; end if;
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

create function public.publish_resources(resource_ids uuid[],operation_key text,expected_revisions jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.publish_resources(resource_ids,operation_key,expected_revisions);$$;
revoke all on function public.publish_resources(uuid[],text,jsonb),private.publish_resources(uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_resources(uuid[],text,jsonb),private.publish_resources(uuid[],text,jsonb) to authenticated;
