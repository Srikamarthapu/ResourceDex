-- Keep owner corrections separate from immutable detection output, versioned by
-- analysis. Ordinary clients may read their own review but cannot fabricate it.
create table public.scan_reviews (
  scan_id uuid not null references public.scans(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  analysis_version integer not null check(analysis_version > 0),
  revision integer not null default 1 check(revision > 0),
  candidates jsonb not null check(jsonb_typeof(candidates)='array' and jsonb_array_length(candidates)<=24),
  updated_at timestamptz not null default now(),
  primary key(scan_id,analysis_version)
);
create index scan_reviews_owner on public.scan_reviews(owner_id);
alter table public.scan_reviews enable row level security;
revoke all on public.scan_reviews from anon,authenticated;
grant select on public.scan_reviews to authenticated;
grant all on public.scan_reviews to service_role;
create policy scan_reviews_read on public.scan_reviews for select to authenticated using(owner_id=(select auth.uid()));

create function public.save_scan_review(p_owner uuid,p_scan uuid,p_analysis_version integer,p_expected_revision integer,p_candidates jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare owned_scan public.scans; current_revision integer; next_revision integer;
begin
  select * into owned_scan from public.scans where id=p_scan for update;
  if not found or owned_scan.owner_id is distinct from p_owner then
    raise exception 'Review ownership conflict.';
  end if;
  if p_analysis_version is null or p_analysis_version<1 or owned_scan.analysis_version is distinct from p_analysis_version or owned_scan.status not in ('completed','failed') then
    raise exception 'Analysis revision conflict; reload the saved review.';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' then raise exception 'Invalid review candidates.'; end if;
  if jsonb_array_length(p_candidates)>24 or (select count(*) from jsonb_array_elements(p_candidates) candidate where candidate->>'review_status' is distinct from 'removed')>12 then raise exception 'Too many active review candidates.'; end if;
  select revision into current_revision from public.scan_reviews where scan_id=p_scan and analysis_version=p_analysis_version for update;
  if p_expected_revision is null or p_expected_revision<>coalesce(current_revision,0) then
    raise exception 'Review revision conflict; reload the saved review.';
  end if;
  insert into public.scan_reviews(scan_id,owner_id,analysis_version,candidates)
    values(p_scan,p_owner,p_analysis_version,p_candidates)
  on conflict(scan_id,analysis_version) do update set
    candidates=excluded.candidates,revision=scan_reviews.revision+1,updated_at=now()
  returning revision into next_revision;
  return next_revision;
end;
$$;
revoke all on function public.save_scan_review(uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_scan_review(uuid,uuid,integer,integer,jsonb) to service_role;
