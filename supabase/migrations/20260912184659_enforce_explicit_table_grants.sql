-- Platform defaults can differ between new local and hosted projects. Remove any
-- inherited table privileges before installing only the intended browser access.
revoke all on public.profiles,public.areas,public.scans,public.analysis_attempts,public.image_assets,public.resources,public.requests,public.pickup_arrangements,public.reports from anon,authenticated;
grant select on public.profiles,public.areas,public.resources to anon,authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select on public.scans,public.image_assets,public.requests,public.pickup_arrangements,public.reports to authenticated;
