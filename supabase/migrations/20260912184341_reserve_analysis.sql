-- Reserve a conservative cost allowance before any provider call. Serialize budget
-- checks across instances; process-local counters cannot enforce a shared ceiling.
create function public.reserve_analysis(p_owner uuid, p_scan uuid, p_operation_key text, p_cost numeric, p_daily_ceiling numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  result_id uuid;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_cost is null or p_daily_ceiling is null or p_cost <= 0 or p_daily_ceiling <= 0 or p_cost > p_daily_ceiling
     or p_cost::text in ('NaN','Infinity','-Infinity') or p_daily_ceiling::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid analysis budget';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('resourcedex-ai-budget', 0));
  if not exists(select 1 from public.scans where id=p_scan and owner_id=p_owner and status='analyzing' and analysis_operation_key=p_operation_key and analysis_deadline_at>now()) then
    raise exception 'Analysis ownership or active run mismatch';
  end if;
  select id into result_id from public.analysis_attempts where scan_id=p_scan and owner_id=p_owner and operation_key=p_operation_key;
  if result_id is not null then return result_id; end if;
  if (select count(*) from public.analysis_attempts where owner_id=p_owner and created_at>now()-interval '1 hour')>=10
    or (select count(*) from public.analysis_attempts where owner_id=p_owner and created_at>=day_start)>=30
    or coalesce((select sum(reserved_cost_usd) from public.analysis_attempts where created_at>=day_start),0)+p_cost>p_daily_ceiling then
    raise exception 'Analysis usage limit reached';
  end if;
  insert into public.analysis_attempts(scan_id,owner_id,operation_key,status,reserved_cost_usd)
    values(p_scan,p_owner,p_operation_key,'running',p_cost) returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.reserve_analysis(uuid,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.reserve_analysis(uuid,uuid,text,numeric,numeric) to service_role;

-- Complete both durable records together; stale provider responses never win.
create function public.complete_analysis(p_owner uuid,p_scan uuid,p_operation_key text,p_attempt uuid,p_result jsonb,p_model text,p_prompt text,p_schema text,p_tokens jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare owned_scan public.scans%rowtype;
begin
  select * into owned_scan from public.scans where id=p_scan and owner_id=p_owner for update;
  if not found or owned_scan.status<>'analyzing' or owned_scan.analysis_operation_key<>p_operation_key or owned_scan.analysis_deadline_at<=now() then
    raise exception 'Identification expired or was replaced';
  end if;
  if not exists(select 1 from public.analysis_attempts where id=p_attempt and scan_id=p_scan and owner_id=p_owner and operation_key=p_operation_key and status='running') then
    raise exception 'Analysis attempt mismatch';
  end if;
  if p_result is null or jsonb_typeof(p_result->'candidates') is distinct from 'array' or jsonb_array_length(p_result->'candidates')>12 then
    raise exception 'Invalid detection result';
  end if;
  update public.scans set status='completed',candidates=p_result->'candidates',limit_reached=(p_result->>'limitReached')::boolean,
    analysis_version=coalesce(analysis_version,0)+1,model=p_model,prompt_version=p_prompt,schema_version=p_schema,token_usage=coalesce(p_tokens,'{}'::jsonb),updated_at=now()
    where id=p_scan;
  update public.analysis_attempts set status='completed',output=p_result,model=p_model,prompt_version=p_prompt,schema_version=p_schema,
    token_usage=coalesce(p_tokens,'{}'::jsonb),finished_at=now() where id=p_attempt;
end;
$$;
revoke all on function public.complete_analysis(uuid,uuid,text,uuid,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_analysis(uuid,uuid,text,uuid,jsonb,text,text,text,jsonb) to service_role;
