-- Contractor "new items" notifications.
-- Replaces routine work orders: items are assigned, then the admin clicks
-- "Notify" on the contractor to email a summary + portal link.
--
-- An item is pending notification when it has a contractor, is still open for
-- the contractor (not contractor_complete / complete / cancelled), and
-- contractor_notified_at is null.

alter table public.maintenance_items
  add column if not exists contractor_notified_at timestamptz;

create index if not exists maintenance_items_pending_notify_idx
  on public.maintenance_items (contractor_id)
  where contractor_notified_at is null and contractor_id is not null;

-- Reset the notified stamp when the item becomes "new" to a contractor again:
--  * reassigned to a different contractor (or unassigned)
--  * sent back from contractor_complete for more work
create or replace function public.reset_contractor_notified()
returns trigger
language plpgsql
as $function$
begin
  if old.contractor_id is distinct from new.contractor_id then
    new.contractor_notified_at := null;
  elsif old.status = 'contractor_complete'
    and new.status in ('assigned', 'in_progress')
    and new.contractor_notified_at is not distinct from old.contractor_notified_at then
    new.contractor_notified_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_maintenance_items_reset_notified on public.maintenance_items;
create trigger trg_maintenance_items_reset_notified
  before update of contractor_id, status on public.maintenance_items
  for each row execute function public.reset_contractor_notified();

-- Portal: expose contractor_notified_at so the portal can tag recently notified items as "New".
create or replace function public.get_portal_items(p_token text)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
  result json;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return '[]'::json; end if;
  select json_agg(row_to_json(t)) into result from (
    select
      mi.id, mi.item_number, mi.title, mi.description, mi.status,
      mi.created_at, mi.updated_at, mi.contractor_notified_at,
      json_build_object(
        'id', u.id, 'unit_identifier', u.unit_identifier, 'address', u.address,
        'owners', coalesce((
          select json_agg(json_build_object('name', uo.name, 'email', uo.email, 'phone', uo.phone) order by uo.created_at)
          from unit_owners uo where uo.unit_id = u.id
        ), '[]'::json),
        'project', json_build_object('id', p.id, 'name', p.name, 'development_company', p.development_company)
      ) as unit,
      case when tr.id is not null then json_build_object('id', tr.id, 'name', tr.name) else null end as trade,
      case when wo.id is not null then json_build_object('id', wo.id, 'work_order_number', wo.work_order_number, 'status', wo.status) else null end as work_order,
      coalesce((select json_agg(json_build_object('id', cc.id, 'author', cc.author, 'content', cc.content, 'created_at', cc.created_at) order by cc.created_at) from contractor_comments cc where cc.maintenance_item_id = mi.id), '[]'::json) as comments,
      coalesce((select json_agg(json_build_object(
          'id', att.id, 'file_url', att.file_url, 'file_name', att.file_name, 'file_type', att.file_type,
          'photo_type', att.photo_type, 'uploaded_by', att.uploaded_by, 'created_at', att.created_at
        ) order by att.created_at) from maintenance_item_attachments att where att.maintenance_item_id = mi.id), '[]'::json) as attachments
    from maintenance_items mi
    join units u on u.id = mi.unit_id
    join projects p on p.id = u.project_id
    left join trades tr on tr.id = mi.trade_id
    left join work_orders wo on wo.id = mi.work_order_id
    where mi.contractor_id = v_contractor_id and mi.status <> 'complete'
    order by p.name, u.unit_identifier, mi.created_at desc
  ) t;
  return coalesce(result, '[]'::json);
end;
$function$;
