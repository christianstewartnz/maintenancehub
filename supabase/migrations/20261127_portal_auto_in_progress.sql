-- No more "Mark as In Progress" button in the contractor portal: an item moves to
-- In Progress as soon as its contractor does something with it in the portal
-- (adds a comment, uploads a photo, sets a booked date).
--
-- Only Logged/Assigned items move; anything further along is left alone.
-- Returns the item's status afterwards (null if the token/item don't match).

create or replace function public.portal_mark_started(p_token text, p_item_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_contractor contractors%rowtype;
  v_status text;
begin
  select * into v_contractor from contractors where portal_token = p_token limit 1;
  if not found then return null; end if;

  perform set_config('app.performed_by', v_contractor.company_name, true);
  update maintenance_items set status = 'in_progress'
  where id = p_item_id and contractor_id = v_contractor.id
    and status in ('logged', 'assigned') and not has_steps;
  perform set_config('app.performed_by', '', true);

  select status into v_status from maintenance_items
  where id = p_item_id and contractor_id = v_contractor.id;
  return v_status;
end;
$function$;

grant execute on function public.portal_mark_started(text, uuid) to anon, authenticated, service_role;
