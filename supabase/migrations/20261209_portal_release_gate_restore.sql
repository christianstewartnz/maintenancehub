-- Restore the portal release gate (undoes 20261208).
--
-- Items show on a contractor's portal again only once that contractor has been
-- notified about them (portal_released_at, set when contractor_notified_at is first
-- stamped by Notify email, Outlook draft or "Mark as told"), so other staff's
-- unsent items never show early. Same function bodies as 20261206.

create or replace function public.portal_item_visible(p_token text, p_item_id uuid)
returns boolean
language sql stable security definer set search_path = public as $function$
  select exists (
    select 1
    from maintenance_items mi
    join contractors c on c.id = mi.contractor_id
    left join maintenance_items par on par.id = mi.parent_item_id
    where c.portal_token = p_token
      and mi.id = p_item_id
      and mi.status <> 'complete'
      and mi.archived_at is null
      and not mi.portal_hidden
      and mi.portal_released_at is not null
      and (par.id is null or par.archived_at is null)
  );
$function$;

create or replace function public.get_portal_items_v2(p_token text)
 returns json
 language plpgsql
 stable
 security definer
 set search_path = public
as $function$
declare
  v_contractor_id uuid;
  result json;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return '[]'::json; end if;
  select json_agg(row_to_json(t)) into result from (
    select
      mi.id, mi.item_number, mi.title,
      coalesce(mi.description, par.description) as description,
      (mi.parent_item_id is not null and mi.description is null) as inherits_description,
      mi.status, mi.scheduled_date,
      mi.created_at, mi.updated_at, mi.contractor_notified_at,
      json_build_object(
        'id', u.id, 'unit_identifier', u.unit_identifier, 'address', u.address,
        'access_contact_name', u.access_contact_name, 'access_contact_phone', u.access_contact_phone,
        'access_contact_email', u.access_contact_email,
        'owners', coalesce((
          select json_agg(json_build_object('name', uo.name, 'email', uo.email, 'phone', uo.phone) order by uo.created_at)
          from unit_owners uo where uo.unit_id = u.id
        ), '[]'::json),
        'project', json_build_object('id', p.id, 'name', p.name, 'development_company', p.development_company)
      ) as unit,
      case when tr.id is not null then json_build_object('id', tr.id, 'name', tr.name) else null end as trade,
      case when par.id is not null then json_build_object('id', par.id, 'item_number', par.item_number, 'title', par.title) else null end as parent,
      case when par.id is not null then (
        select json_agg(json_build_object(
                 'item_number', s.item_number, 'trade', st.name, 'contractor', sc.company_name,
                 'status', s.status, 'is_mine', s.id = mi.id) order by s.step_order)
        from maintenance_items s
        left join trades st on st.id = s.trade_id
        left join contractors sc on sc.id = s.contractor_id
        where s.parent_item_id = par.id and s.archived_at is null
      ) end as steps,
      case when par.id is not null then (
        select json_agg(json_build_object('trade', st.name, 'contractor', sc.company_name) order by s.step_order)
        from maintenance_items s
        left join trades st on st.id = s.trade_id
        left join contractors sc on sc.id = s.contractor_id
        where s.parent_item_id = par.id and s.archived_at is null
          and s.step_order < mi.step_order and s.status not in ('contractor_complete', 'complete')
      ) end as waiting_on,
      case when wo.id is not null then json_build_object('id', wo.id, 'work_order_number', wo.work_order_number, 'status', wo.status) else null end as work_order,
      coalesce((select json_agg(json_build_object('id', cc.id, 'author', cc.author, 'content', cc.content, 'created_at', cc.created_at) order by cc.created_at)
                from contractor_comments cc where cc.maintenance_item_id in (mi.id, par.id)), '[]'::json) as comments,
      coalesce((select json_agg(json_build_object(
          'id', att.id, 'file_url', att.file_url, 'file_name', att.file_name, 'file_type', att.file_type,
          'photo_type', att.photo_type, 'uploaded_by', att.uploaded_by, 'created_at', att.created_at
        ) order by att.created_at) from maintenance_item_attachments att where att.maintenance_item_id in (mi.id, par.id)), '[]'::json) as attachments,
      (
        select json_build_object(
                 'name', coalesce(nullif(trim(pr.full_name), ''), split_part(pr.email, '@', 1)),
                 'email', pr.email,
                 'phone', nullif(trim(pr.phone), ''))
        from profiles pr
        where pr.is_active
          and pr.id in (mh_item_responsible(mi.id), mh_project_contact(p.id))
        order by (pr.id = mh_item_responsible(mi.id)) desc
        limit 1
      ) as responsible
    from maintenance_items mi
    join units u on u.id = mi.unit_id
    join projects p on p.id = u.project_id
    left join maintenance_items par on par.id = mi.parent_item_id
    left join trades tr on tr.id = mi.trade_id
    left join work_orders wo on wo.id = mi.work_order_id
    where mi.contractor_id = v_contractor_id and mi.status <> 'complete' and mi.archived_at is null
      and not mi.portal_hidden
      and mi.portal_released_at is not null
      and (par.id is null or par.archived_at is null)
    order by p.name, u.unit_identifier, mi.created_at desc
  ) t;
  return coalesce(result, '[]'::json);
end;
$function$;
