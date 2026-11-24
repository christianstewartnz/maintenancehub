-- Portal release gate + responsible contact on the contractor portal.
--
-- With several staff, each person notifies contractors about their own items
-- (see /api/contractors/[id]/notify). The portal used to show every item with a
-- contractor straight away, so a contractor could see another staff member's
-- items before that person had sent them. Now an item only shows on the portal
-- once it has been "released" — the first time the contractor is told about it
-- (Notify email or "Mark as told").
--
--  - maintenance_items.portal_released_at: when the item became visible on the
--    current contractor's portal. Cleared when the contractor changes. Unlike
--    contractor_notified_at it is NOT cleared when an item is sent back from
--    contractor_complete — the contractor already knows about it, so it stays put.
--  - get_portal_items_v2(token): get_portal_items + the release gate + the item's
--    responsible person {name, email, phone} as the contractor's contact.
--  - portal_item_visible(token, item_id): the same visibility rule, for the portal
--    API routes (status, comments, booked date, photos).
--
-- Additive only. get_portal_items (used by the live app on main) and the existing
-- triggers/functions are untouched; run supabase/cutover/portal_release_backfill.sql
-- at go-live to release everything the old portal currently shows.

-- 1. Column ---------------------------------------------------------------------

alter table public.maintenance_items
  add column if not exists portal_released_at timestamptz;

comment on column public.maintenance_items.portal_released_at is
  'When the item became visible on its contractor''s portal (first notified). Cleared on contractor change; kept when sent back.';

-- 2. Backfill: everything already notified is released as of that time ------------
-- Jobs split into steps are skipped: they never show on the portal (their steps do),
-- and touching them re-runs the step status rollup. The activity log / updated_at
-- triggers are paused so this housekeeping doesn't add a history entry to every item.

alter table public.maintenance_items disable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items disable trigger trg_maintenance_items_updated_at;

update public.maintenance_items
set portal_released_at = contractor_notified_at
where contractor_notified_at is not null
  and portal_released_at is null
  and not has_steps;

alter table public.maintenance_items enable trigger trg_maintenance_items_log_changes;
alter table public.maintenance_items enable trigger trg_maintenance_items_updated_at;

-- 3. Trigger ----------------------------------------------------------------------
-- Postgres fires same-timing row triggers in name order. This one is named to run
-- after trg_maintenance_items_reset_notified (clears contractor_notified_at on a
-- contractor change / send-back) and trg_maintenance_items_sync_assigned (stamps
-- contractor_notified_at when status is set to Assigned by hand), so it sees the
-- final contractor_notified_at for the row.
--
-- Plain "before update" (not "update of contractor_notified_at"): sync_assigned can
-- stamp contractor_notified_at without it being in the UPDATE's column list.

create or replace function public.maintenance_items_portal_release()
returns trigger language plpgsql set search_path = public as $function$
begin
  if tg_op = 'UPDATE' and new.contractor_id is distinct from old.contractor_id then
    new.portal_released_at := null;
  end if;

  if new.contractor_notified_at is not null and new.portal_released_at is null then
    new.portal_released_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_maintenance_items_zz_portal_release on public.maintenance_items;
create trigger trg_maintenance_items_zz_portal_release
  before insert or update on public.maintenance_items
  for each row execute function public.maintenance_items_portal_release();

-- 4. Portal visibility for one item (portal API routes) -----------------------------
-- Same rule as get_portal_items_v2's where clause.

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

-- 5. get_portal_items_v2 ----------------------------------------------------------
-- get_portal_items (20261201_portal_access_contact) plus:
--   * and mi.portal_released_at is not null
--   * responsible: the item's responsible person (mh_item_responsible: Responsible →
--     parent job's → project main contact) as {name, email, phone}. If that person
--     has been deactivated, the project's main contact is used instead; null if
--     neither is an active user.

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

-- 6. Grants -----------------------------------------------------------------------
-- Like the existing portal RPCs: callable by anon (the portal has no login; the
-- token is the credential). Revoke from PUBLIC first so access is exactly this list.

revoke execute on function public.get_portal_items_v2(text) from public;
revoke execute on function public.portal_item_visible(text, uuid) from public;
grant execute on function public.get_portal_items_v2(text) to anon, authenticated, service_role;
grant execute on function public.portal_item_visible(text, uuid) to anon, authenticated, service_role;

-- The 1204 revoke from anon had no effect because PUBLIC still had execute.
-- Signed-in users and the server need these; the portal reaches them through
-- security-definer functions, which run as their owner.
revoke execute on function public.mh_item_responsible(uuid) from public, anon;
revoke execute on function public.mh_project_contact(uuid) from public, anon;
grant execute on function public.mh_item_responsible(uuid) to authenticated, service_role;
grant execute on function public.mh_project_contact(uuid) to authenticated, service_role;
