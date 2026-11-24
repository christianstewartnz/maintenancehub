-- GO-LIVE CUTOVER for the portal release gate (not a migration — run once, by hand,
-- right after the staff-permissions code is deployed to main).
--
-- Requires migration 20261206_portal_release.sql.
--
-- The new portal (get_portal_items_v2) only shows items with portal_released_at set.
-- The migration released everything that had been notified; this releases the rest of
-- what the OLD portal (get_portal_items) shows today — items with a contractor that
-- were never notified — so no contractor loses an item they can currently see.
-- From here on, items are released only when they're notified.
--
-- Same filter as get_portal_items: contractor set, not archived, not complete,
-- not hidden from the portal (steps of an archived job are archived with it).
-- Activity log / updated_at triggers are paused so this doesn't add history entries.

begin;

alter table public.maintenance_items disable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items disable trigger trg_maintenance_items_updated_at;

update public.maintenance_items
set portal_released_at = coalesce(contractor_notified_at, now())
where portal_released_at is null
  and contractor_id is not null
  and archived_at is null
  and status <> 'complete'
  and not portal_hidden
  and not has_steps;

alter table public.maintenance_items enable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items enable trigger trg_maintenance_items_updated_at;

commit;

-- Check: should return 0 (items the old portal shows that the new one doesn't).
-- select count(*) from maintenance_items mi
-- left join maintenance_items par on par.id = mi.parent_item_id
-- where mi.contractor_id is not null and mi.status <> 'complete' and mi.archived_at is null
--   and not mi.portal_hidden and (par.id is null or par.archived_at is null)
--   and mi.portal_released_at is null;
