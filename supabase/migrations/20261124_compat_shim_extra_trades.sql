-- TEMPORARY compatibility shim.
-- 20261123_item_steps dropped maintenance_item_trades while the deployed app
-- (commit 17793e5) still read it, which emptied the live maintenance list.
-- This restores just enough for that build to work. Once the steps version is
-- deployed, drop these in a cleanup migration:
--   drop table public.maintenance_item_trades;
--   drop function public.contractor_on_item(uuid, uuid);
--   drop function public.portal_update_status(text, uuid, text, uuid);

create table if not exists public.maintenance_item_trades (
  id uuid primary key default gen_random_uuid(),
  maintenance_item_id uuid not null references public.maintenance_items(id) on delete cascade,
  trade_id uuid not null references public.trades(id) on delete cascade,
  contractor_id uuid references public.contractors(id) on delete set null,
  status text not null default 'logged',
  scheduled_date date,
  completed_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.maintenance_item_trades enable row level security;
drop policy if exists admin_all_maintenance_item_trades on public.maintenance_item_trades;
create policy admin_all_maintenance_item_trades on public.maintenance_item_trades
  for all to authenticated using (true) with check (true);

create or replace function public.contractor_on_item(p_item_id uuid, p_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public as $function$
  select exists (select 1 from maintenance_items where id = p_item_id and contractor_id = p_contractor_id);
$function$;

-- 4-arg form the deployed portal calls (no default, so 3-arg calls stay unambiguous)
create or replace function public.portal_update_status(p_token text, p_item_id uuid, p_status text, p_item_trade_id uuid)
 returns json language sql security definer as $function$
  select public.portal_update_status(p_token, p_item_id, p_status);
$function$;
grant execute on function public.portal_update_status(text, uuid, text, uuid) to anon, authenticated;
grant execute on function public.contractor_on_item(uuid, uuid) to anon, authenticated, service_role;
