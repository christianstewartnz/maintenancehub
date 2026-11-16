-- Archive maintenance items.
-- An archived item keeps its data, photos and history but is hidden from the
-- maintenance list (unless "Show archived" is on), dashboard, sign-off queue,
-- contractor notify counts, reports and the contractor portal.
-- Restoring an item clears archived_at.

alter table public.maintenance_items
  add column if not exists archived_at timestamptz;

create index if not exists maintenance_items_active_idx
  on public.maintenance_items (created_at desc)
  where archived_at is null;

-- Contractor portal: never show archived items.
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
    where mi.contractor_id = v_contractor_id and mi.status <> 'complete' and mi.archived_at is null
    order by p.name, u.unit_identifier, mi.created_at desc
  ) t;
  return coalesce(result, '[]'::json);
end;
$function$;
