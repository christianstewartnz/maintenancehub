-- "Assigned" now means the contractor has actually been told about the item.
--
-- Before: giving an item a contractor moved it straight to Assigned, so Assigned
-- couldn't tell you whether anyone had contacted the contractor yet.
-- Now: an item with a contractor stays Logged until it is sent to them — the
-- "Notify" email, or "Mark as told" (both stamp contractor_notified_at) — and
-- only then becomes Assigned.
--
-- Rule (for items without steps; a job with steps takes its status from them):
--   Logged/Assigned item  → Assigned  iff it has a contractor AND contractor_notified_at is set
--                         → Logged    otherwise
-- Statuses past Assigned (in progress, contractor complete, complete) are untouched.
--
-- Setting an item from Logged to Assigned by hand (status dropdown, "advance",
-- an email update) with the same contractor counts as "they've been told", so it
-- stamps contractor_notified_at rather than being reverted.
--
-- Reassigning to a different contractor clears contractor_notified_at
-- (trg_maintenance_items_reset_notified), so the item drops back to Logged until
-- the new contractor is notified. This trigger's name sorts after that one, so it
-- sees the cleared stamp.

create or replace function public.sync_assigned_status()
returns trigger language plpgsql as $function$
begin
  if new.has_steps then return new; end if;

  -- Explicit Logged → Assigned with the contractor unchanged: treat as told
  if tg_op = 'UPDATE'
     and old.status = 'logged' and new.status = 'assigned'
     and new.contractor_id is not null
     and new.contractor_id is not distinct from old.contractor_id
     and new.contractor_notified_at is null then
    new.contractor_notified_at := now();
  end if;

  if new.status = 'assigned' and (new.contractor_id is null or new.contractor_notified_at is null) then
    new.status := 'logged';
  elsif new.status = 'logged' and new.contractor_id is not null and new.contractor_notified_at is not null then
    new.status := 'assigned';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_maintenance_items_sync_assigned on public.maintenance_items;
create trigger trg_maintenance_items_sync_assigned
  before insert or update on public.maintenance_items
  for each row execute function public.sync_assigned_status();

-- New steps start Logged; the trigger above moves them on once notified
create or replace function public.add_item_step(
  p_parent_id uuid,
  p_trade_id uuid default null,
  p_contractor_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_before_step_id uuid default null,
  p_auto_contractor boolean default true
) returns uuid
language plpgsql
set search_path = public
as $function$
declare
  v_parent maintenance_items%rowtype;
  v_project uuid;
  v_next_no int;
  v_order int;
  v_contractor uuid := p_contractor_id;
  v_id uuid;
begin
  select * into v_parent from maintenance_items where id = p_parent_id for update;
  if not found then raise exception 'Item not found'; end if;
  if v_parent.parent_item_id is not null then
    raise exception '% is already a step — add the step to its parent instead', v_parent.item_number;
  end if;
  select project_id into v_project from units where id = v_parent.unit_id;

  -- First step: move the item's own work into step 1
  if not v_parent.has_steps and (v_parent.trade_id is not null or v_parent.contractor_id is not null) then
    insert into maintenance_items (item_number, unit_id, parent_item_id, step_order, title, description,
                                   trade_id, contractor_id, status, scheduled_date, contractor_notified_at, work_order_id)
    values (v_parent.item_number || '-1', v_parent.unit_id, v_parent.id, 1, v_parent.title, null,
            v_parent.trade_id, v_parent.contractor_id, v_parent.status,
            v_parent.scheduled_date, v_parent.contractor_notified_at, v_parent.work_order_id);
    update maintenance_items set contractor_id = null, trade_id = null, work_order_id = null, scheduled_date = null
    where id = v_parent.id;
  end if;

  if v_contractor is null and p_auto_contractor and p_trade_id is not null then
    select contractor_id into v_contractor from project_trade_assignments
    where project_id = v_project and trade_id = p_trade_id limit 1;
  end if;

  select coalesce(max(nullif(regexp_replace(item_number, '^.*-', ''), '')::int), 0) + 1
    into v_next_no
  from maintenance_items where parent_item_id = v_parent.id and item_number ~ '-[0-9]+$';

  if p_before_step_id is not null then
    select step_order into v_order from maintenance_items where id = p_before_step_id and parent_item_id = v_parent.id;
    if v_order is null then raise exception 'Step to insert before was not found on %', v_parent.item_number; end if;
    update maintenance_items set step_order = step_order + 1 where parent_item_id = v_parent.id and step_order >= v_order;
  else
    select coalesce(max(step_order), 0) + 1 into v_order from maintenance_items where parent_item_id = v_parent.id;
  end if;

  insert into maintenance_items (item_number, unit_id, parent_item_id, step_order, title, description, trade_id, contractor_id, status)
  values (v_parent.item_number || '-' || v_next_no, v_parent.unit_id, v_parent.id, v_order,
          coalesce(nullif(trim(p_title), ''), v_parent.title), nullif(trim(p_description), ''),
          p_trade_id, v_contractor, 'logged')
  returning id into v_id;

  return v_id;
end;
$function$;

-- Backfill: existing Assigned items that were never notified go back to Logged.
-- Skip the activity log / updated_at triggers so this housekeeping doesn't flood
-- every item's history. Jobs with steps re-derive via the step rollup.
alter table public.maintenance_items disable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items disable trigger trg_maintenance_items_updated_at;

update public.maintenance_items
set status = status  -- sync_assigned_status() normalises it
where not has_steps
  and status in ('logged', 'assigned');

alter table public.maintenance_items enable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items enable trigger trg_maintenance_items_updated_at;
