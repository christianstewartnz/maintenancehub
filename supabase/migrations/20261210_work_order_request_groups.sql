-- Work order requests covering several items of one unit.
--
-- From the portal a contractor can now request one work order for several of their
-- items on the same unit. Each item still gets its own work_order_requests row (so the
-- per-item status, the one-pending-per-item index and the deployed code keep working);
-- rows sent together share a group_id. Staff answer the whole group at once: approving
-- puts every item in it on one work order, declining declines them all.
--
-- Older rows have group_id = null and stand on their own.
-- Additive only: nothing the deployed app uses is changed.

alter table public.work_order_requests add column if not exists group_id uuid;

comment on column public.work_order_requests.group_id is
  'Requests sent together (one work order for several items of a unit) share this id; null = a single-item request.';

create index if not exists work_order_requests_group_idx
  on public.work_order_requests (group_id) where group_id is not null;
