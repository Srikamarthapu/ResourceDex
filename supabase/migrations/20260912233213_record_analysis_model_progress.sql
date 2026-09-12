-- Private progress is written only by the active server operation. Existing
-- scans remain readable, and previous results are preserved during reruns.
alter table public.scans add column analysis_progress jsonb;
alter table public.scans add constraint scans_analysis_progress_object
  check (analysis_progress is null or jsonb_typeof(analysis_progress)='object');
