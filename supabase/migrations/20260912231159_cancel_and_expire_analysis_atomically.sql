-- Completion, cancellation and expiry lock the scan before its attempt. A late
-- provider result can therefore never replace a stopped or newer operation.
create function private.fail_analysis(
  p_owner uuid, p_scan uuid, p_operation_key text,
  p_code text, p_message text, p_expired_only boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare current_scan public.scans; current_attempt public.analysis_attempts;
begin
  if p_operation_key is null or p_code is null or char_length(p_code) not between 1 and 80
    or p_message is null or char_length(p_message) not between 1 and 500 then
    raise exception 'Invalid analysis failure details';
  end if;
  select * into current_scan from public.scans
    where id=p_scan and owner_id=p_owner for update;
  if not found or current_scan.status<>'analyzing'
    or current_scan.analysis_operation_key is distinct from p_operation_key then return false; end if;
  if p_expired_only and (current_scan.analysis_deadline_at is null or current_scan.analysis_deadline_at>now()) then return false; end if;
  select * into current_attempt from public.analysis_attempts
    where scan_id=p_scan and owner_id=p_owner and operation_key=p_operation_key for update;
  -- Older workers could fail an attempt before clearing its scan. Heal that
  -- mismatch without changing its recorded failure or reopening completion.
  if found and current_attempt.status not in ('running','failed') then return false; end if;
  update public.analysis_attempts set status='failed',error_code=p_code,finished_at=now()
    where scan_id=p_scan and owner_id=p_owner and operation_key=p_operation_key and status='running';
  update public.scans set status='failed',analysis_error=p_message,updated_at=now()
    where id=p_scan;
  -- Keep the photo, previous analysis, owner review and admission cost intact.
  return true;
end;
$$;
revoke all on function private.fail_analysis(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function private.fail_analysis(uuid,uuid,text,text,text,boolean) to service_role;

create function public.fail_analysis(
  p_owner uuid, p_scan uuid, p_operation_key text,
  p_code text, p_message text, p_expired_only boolean default false
) returns boolean language sql security invoker set search_path='' as $$
  select private.fail_analysis(p_owner,p_scan,p_operation_key,p_code,p_message,p_expired_only);
$$;
create function public.cancel_analysis(p_owner uuid,p_scan uuid,p_operation_key text)
returns boolean language sql security invoker set search_path='' as $$
  select private.fail_analysis(p_owner,p_scan,p_operation_key,'cancelled',
    'Identification stopped. Your photo and saved review are unchanged.',false);
$$;
revoke all on function public.fail_analysis(uuid,uuid,text,text,text,boolean),public.cancel_analysis(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_analysis(uuid,uuid,text,text,text,boolean),public.cancel_analysis(uuid,uuid,text) to service_role;

-- Serialize reservation against Stop as well. Without this row lock a request
-- that already read the old scan status could insert a running attempt after
-- cancellation committed, leaving the attempt out of sync with its scan.
create or replace function public.reserve_analysis(p_owner uuid, p_scan uuid, p_operation_key text, p_cost numeric, p_daily_ceiling numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  result_id uuid;
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
