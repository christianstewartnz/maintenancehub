-- Contractor work order requests.
--
-- From the portal a contractor can ask for a work order on one of their items when
-- they think the job is chargeable work rather than fixing their own workmanship.
-- Staff see the request on the item (and the Work Orders page) and either create a
-- work order for it or decline it with a note the contractor sees on the portal.
--
--  - pending  : waiting for staff. At most one pending request per item + contractor.
--  - approved : staff created (or linked) a work order — work_order_id.
--  - declined : staff said no — response_note explains why.
--
-- The portal writes through /api/portal/[token]/request-work-order with the service
-- role after checking portal_item_visible, so anon gets no table access here.
-- Additive only: nothing the deployed app uses is changed.

create table if not exists public.work_order_requests (
  id uuid primary key default gen_random_uuid(),
  maintenance_item_id uuid not null references public.maintenance_items(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  estimated_cost numeric(12, 2) check (estimated_cost is null or estimated_cost >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  response_note text,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  work_order_id uuid references public.work_orders(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.work_order_requests is
  'A contractor asking (from the portal) for a work order on an item they consider chargeable, not a defect fix.';

create index if not exists work_order_requests_item_idx on public.work_order_requests (maintenance_item_id, created_at desc);
create index if not exists work_order_requests_pending_idx on public.work_order_requests (created_at desc) where status = 'pending';
create unique index if not exists work_order_requests_one_pending
  on public.work_order_requests (maintenance_item_id, contractor_id) where status = 'pending';

alter table public.work_order_requests enable row level security;

-- Staff see and answer requests on items they can access (same rule as comments).
drop policy if exists work_order_requests_scoped on public.work_order_requests;
create policy work_order_requests_scoped on public.work_order_requests for all to authenticated
  using (mh_can_access_item(maintenance_item_id)) with check (mh_can_access_item(maintenance_item_id));

revoke all on public.work_order_requests from anon;
grant select, insert, update, delete on public.work_order_requests to authenticated;
grant all on public.work_order_requests to service_role;

-- Realtime, so the sidebar Work Orders badge updates when a contractor sends a request.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_order_requests') then
    alter publication supabase_realtime add table public.work_order_requests;
  end if;
end $$;
