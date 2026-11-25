-- Contractors give an estimate of hours as well as cost when requesting a work order.
-- Optional, like estimated_cost; for a multi-item request it's the total for all items
-- (the same value on every row of the group).
-- Additive only: nothing the deployed app uses is changed.

alter table public.work_order_requests add column if not exists estimated_hours numeric(8, 2)
  check (estimated_hours is null or estimated_hours >= 0);

comment on column public.work_order_requests.estimated_hours is
  'Contractor''s estimate of hours (optional). For a group, the total for all its items.';
