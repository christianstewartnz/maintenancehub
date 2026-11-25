-- Work orders can be archived (hidden from lists, kept for history), and are only
-- editable while they're a draft: once sent, notes / project / contractor are locked.
-- Additive: the live app keeps working before the new code is deployed.

alter table public.work_orders add column if not exists archived_at timestamptz;

create index if not exists work_orders_archived_at_idx on public.work_orders (archived_at);

create or replace function public.mh_work_order_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' and (
       new.notes is distinct from old.notes
    or new.project_id is distinct from old.project_id
    or new.contractor_id is distinct from old.contractor_id
  ) then
    raise exception 'Work order % has been sent and can no longer be edited', old.work_order_number
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_lock_after_send on public.work_orders;
create trigger work_orders_lock_after_send
  before update on public.work_orders
  for each row execute function public.mh_work_order_lock();
