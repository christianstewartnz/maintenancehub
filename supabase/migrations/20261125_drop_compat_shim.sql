-- Remove the temporary shim from 20261124_compat_shim_extra_trades.sql.
-- The steps version (commit eaa9482) is deployed and no longer uses these.
drop function if exists public.portal_update_status(text, uuid, text, uuid);
drop function if exists public.contractor_on_item(uuid, uuid);
drop table if exists public.maintenance_item_trades;
