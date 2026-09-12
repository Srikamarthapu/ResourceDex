-- A reused operation key cannot dispatch again after its attempt ended.
create or replace function public.reserve_analysis(p_owner uuid, p_scan uuid, p_operation_key text, p_cost numeric, p_daily_ceiling numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  result_id uuid;
  prior_status text;
  owned_scan public.scans;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_cost is null or p_daily_ceiling is null or p_cost <= 0 or p_daily_ceiling <= 0 or p_cost > p_daily_ceiling
     or p_cost::text in ('NaN','Infinity','-Infinity') or p_daily_ceiling::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid analysis budget';
  end if;
  select * into owned_scan from public.scans where id=p_scan and owner_id=p_owner for update;
  if not found or owned_scan.status<>'analyzing' or owned_scan.analysis_operation_key is distinct from p_operation_key or owned_scan.analysis_deadline_at is null or owned_scan.analysis_deadline_at<=now() then
    raise exception 'Analysis ownership or active run mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('resourcedex-ai-budget', 0));
  select id,status into result_id,prior_status from public.analysis_attempts where scan_id=p_scan and owner_id=p_owner and operation_key=p_operation_key;
  if result_id is not null then
    if prior_status<>'running' then raise exception 'Analysis attempt already ended'; end if;
    return result_id;
  end if;
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
