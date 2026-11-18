-- Manual status changes between Logged and Assigned.
--
-- With the contractor unchanged:
--  * setting an item to Assigned by hand (from any status) stamps
--    contractor_notified_at — "they've already been told outside the hub";
--  * setting it to Logged by hand clears the stamp, so it counts as not sent and
--    goes back on the Notify list (otherwise the trigger would flip it straight
--    back to Assigned).
-- Picking Assigned on a Contractor Complete item therefore counts as told too
-- (the reset trigger clears the stamp, then this one re-stamps it). Sign-off
-- "send back" goes to In Progress, so it still re-notifies as before.

create or replace function public.sync_assigned_status()
returns trigger language plpgsql as $function$
begin
  if new.has_steps then return new; end if;

  if tg_op = 'UPDATE'
     and new.contractor_id is not null
     and new.contractor_id is not distinct from old.contractor_id then
    -- Explicitly set to Assigned (from any status): treat as told
    if old.status <> 'assigned' and new.status = 'assigned' and new.contractor_notified_at is null then
      new.contractor_notified_at := now();
    -- Explicitly set to Logged (from any status): treat as not told yet
    elsif old.status <> 'logged' and new.status = 'logged'
          and new.contractor_notified_at is not distinct from old.contractor_notified_at then
      new.contractor_notified_at := null;
    end if;
  end if;

  if new.status = 'assigned' and (new.contractor_id is null or new.contractor_notified_at is null) then
    new.status := 'logged';
  elsif new.status = 'logged' and new.contractor_id is not null and new.contractor_notified_at is not null then
    new.status := 'assigned';
  end if;
  return new;
end;
$function$;
