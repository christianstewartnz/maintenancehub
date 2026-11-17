-- Steps: split a maintenance item into ordered steps, each a real maintenance
-- item with its own instruction, trade, contractor, status, photos and comments.
--
-- e.g. MI-0166 "Water pipes banging" (the parent / job)
--   MI-0166-1  Plumbing          cut access hole, strap pipe
--   MI-0166-2  General Building  make good the hole
--   MI-0166-3  Painting          plaster and paint ceiling
--
-- * A step's number is fixed; its position is step_order (reorderable).
-- * A step with no description uses the parent's description ("same instructions").
-- * A parent with steps has no contractor; its status is derived from its steps.
-- * Replaces the short-lived maintenance_item_trades ("additional trades") feature.

-- 1. Remove additional trades (never used in production data)
drop table if exists public.maintenance_item_trades cascade;
drop function if exists public.log_item_trade_change() cascade;
drop function if exists public.item_trade_before_update() cascade;
drop function if exists public.contractor_on_item(uuid, uuid);
drop function if exists public.portal_update_status(text, uuid, text, uuid);

create or replace function public.portal_update_status(p_token text, p_item_id uuid, p_status text)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return json_build_object('error', 'Invalid token'); end if;
  if p_status not in ('in_progress', 'contractor_complete') then return json_build_object('error', 'Invalid status'); end if;
  update maintenance_items set status = p_status
  where id = p_item_id and contractor_id = v_contractor_id;
  return json_build_object('success', true);
end;
$function$;
grant execute on function public.portal_update_status(text, uuid, text) to anon, authenticated;

create or replace function public.portal_add_comment(p_token text, p_item_id uuid, p_author text, p_content text)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
  v_comment json;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return json_build_object('error', 'Invalid token'); end if;
  if not exists (select 1 from maintenance_items where id = p_item_id and contractor_id = v_contractor_id) then
    return json_build_object('error', 'Unauthorized');
  end if;
  insert into contractor_comments (maintenance_item_id, author, content)
  values (p_item_id, p_author, p_content)
  returning row_to_json(contractor_comments.*) into v_comment;
  return v_comment;
end;
$function$;

-- 2. Columns
alter table public.maintenance_items
  add column if not exists parent_item_id uuid references public.maintenance_items(id) on delete cascade,
  add column if not exists step_order int,
  add column if not exists has_steps boolean not null default false;

create index if not exists maintenance_items_parent_idx on public.maintenance_items (parent_item_id, step_order);

-- 3. Derived status for a parent, from its (non-archived) steps
create or replace function public.derive_parent_status(p_parent_id uuid)
returns text language sql stable as $function$
  select case
    when count(*) = 0 then null
    when bool_and(status = 'complete') then 'complete'
    when bool_and(status in ('contractor_complete', 'complete')) then 'contractor_complete'
    when bool_or(status in ('in_progress', 'contractor_complete', 'complete')) then 'in_progress'
    when bool_or(status = 'assigned') then 'assigned'
    else 'logged'
  end
  from maintenance_items
  where parent_item_id = p_parent_id and archived_at is null;
$function$;

-- 4. Parent guard (BEFORE UPDATE): no contractor on a parent with steps,
--    "complete" cascades to its steps, and status always follows the steps.
create or replace function public.parent_item_before_update()
returns trigger language plpgsql as $function$
declare
  v_derived text;
begin
  if not new.has_steps then return new; end if;

  if new.contractor_id is not null and new.contractor_id is distinct from old.contractor_id then
    raise exception '% is split into steps — assign contractors on its steps instead', new.item_number;
  end if;

  -- Signing off the job signs off every step
  if new.status = 'complete' and old.status is distinct from 'complete' then
    perform set_config('app.step_cascade', '1', true);
    update maintenance_items set status = 'complete'
    where parent_item_id = new.id and archived_at is null and status <> 'complete';
    perform set_config('app.step_cascade', '', true);
  end if;

  -- Archiving the job archives its steps; restoring brings back the ones archived with it
  if new.archived_at is distinct from old.archived_at then
    perform set_config('app.step_cascade', '1', true);
    if new.archived_at is not null then
      update maintenance_items set archived_at = new.archived_at
      where parent_item_id = new.id and archived_at is null;
    else
      update maintenance_items set archived_at = null
      where parent_item_id = new.id and archived_at = old.archived_at;
    end if;
    perform set_config('app.step_cascade', '', true);
    return new;  -- keep status as it was while archived steps are out of the count
  end if;

  v_derived := derive_parent_status(new.id);
  if v_derived is not null then
    new.status := v_derived;
    if v_derived = 'complete' and old.status is distinct from 'complete' then
      new.completed_at := now();
    elsif v_derived <> 'complete' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_maintenance_items_parent_guard on public.maintenance_items;
-- Name sorts after trg_maintenance_items_completed_at so it has the final say on completed_at
create trigger trg_maintenance_items_parent_guard before update on public.maintenance_items
  for each row execute function public.parent_item_before_update();

-- 5. Step changes roll up to the parent (AFTER)
create or replace function public.step_rollup()
returns trigger language plpgsql as $function$
declare
  v_parent uuid;
begin
  if current_setting('app.step_cascade', true) = '1' then return null; end if;
  foreach v_parent in array array[
    case when tg_op <> 'INSERT' then old.parent_item_id end,
    case when tg_op <> 'DELETE' then new.parent_item_id end
  ] loop
    continue when v_parent is null;
    update maintenance_items p
    set has_steps = exists (select 1 from maintenance_items s where s.parent_item_id = p.id and s.archived_at is null),
        updated_at = now()
    where p.id = v_parent;
  end loop;
  return null;
end;
$function$;

drop trigger if exists trg_maintenance_items_step_rollup on public.maintenance_items;
create trigger trg_maintenance_items_step_rollup
  after insert or delete or update of status, parent_item_id, archived_at on public.maintenance_items
  for each row execute function public.step_rollup();

-- 6. Add a step. The first time, the item's own trade/contractor/status/date move
--    into step 1 so nothing is retyped. p_before_step_id inserts ahead of that step.
--    p_contractor_id null + p_auto_contractor = the project's contractor for the trade.
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
          p_trade_id, v_contractor, case when v_contractor is not null then 'assigned' else 'logged' end)
  returning id into v_id;

  return v_id;
end;
$function$;

-- 7. Move a step up (-1) or down (+1)
create or replace function public.move_item_step(p_step_id uuid, p_direction int)
returns void language plpgsql set search_path = public as $function$
declare
  v_step maintenance_items%rowtype;
  v_other maintenance_items%rowtype;
begin
  select * into v_step from maintenance_items where id = p_step_id;
  if v_step.parent_item_id is null then raise exception 'Not a step'; end if;
  if p_direction < 0 then
    select * into v_other from maintenance_items
    where parent_item_id = v_step.parent_item_id and step_order < v_step.step_order
    order by step_order desc limit 1;
  else
    select * into v_other from maintenance_items
    where parent_item_id = v_step.parent_item_id and step_order > v_step.step_order
    order by step_order asc limit 1;
  end if;
  if v_other.id is null then return; end if;
  update maintenance_items set step_order = v_other.step_order where id = v_step.id;
  update maintenance_items set step_order = v_step.step_order where id = v_other.id;
end;
$function$;

grant execute on function public.add_item_step(uuid, uuid, uuid, text, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.move_item_step(uuid, int) to authenticated, service_role;

-- 8. Email updates go on a step, not on a parent with steps
create or replace function public.apply_email_update(p_item_number text, p_note text, p_new_status text DEFAULT NULL::text, p_contractor_email text DEFAULT NULL::text, p_email_message_id text DEFAULT NULL::text, p_email_subject text DEFAULT NULL::text, p_email_from text DEFAULT NULL::text, p_email_to text DEFAULT NULL::text, p_email_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item maintenance_items%rowtype;
  v_flow text[] := array['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete'];
  v_status_to text;
  v_contractor_id uuid;
  v_match_count int := 0;
  v_update_id uuid;
  v_notes text[] := '{}';
begin
  if coalesce(trim(p_note), '') = '' then
    raise exception 'p_note is required';
  end if;

  select * into v_item from maintenance_items
  where item_number = upper(trim(p_item_number))
  for update;
  if not found then
    raise exception 'Item % not found', p_item_number;
  end if;

  if v_item.has_steps and (p_new_status is not null or p_contractor_email is not null) then
    raise exception '% is split into steps (%) — apply status/contractor updates to the relevant step',
      v_item.item_number,
      (select string_agg(s.item_number || ' ' || coalesce(t.name, 'no trade'), ', ' order by s.step_order)
       from maintenance_items s left join trades t on t.id = s.trade_id where s.parent_item_id = v_item.id);
  end if;

  if p_email_message_id is not null and exists (
    select 1 from item_updates
    where maintenance_item_id = v_item.id and email_message_id = p_email_message_id
  ) then
    return jsonb_build_object('item_number', v_item.item_number, 'skipped', true,
                              'reason', 'this email was already applied to this item');
  end if;

  if p_contractor_email is not null and v_item.contractor_id is null then
    select count(*), min(id::text)::uuid into v_match_count, v_contractor_id
    from contractors
    where is_active and lower(trim(email)) = lower(trim(p_contractor_email));
    if v_match_count <> 1 then
      v_contractor_id := null;
      v_notes := v_notes || format('contractor email %s matched %s active contractors; contractor not set',
                                   p_contractor_email, v_match_count);
    end if;
  end if;

  if p_new_status is not null then
    if p_new_status not in ('assigned', 'in_progress', 'contractor_complete') then
      raise exception 'Status % is not allowed from email updates (allowed: assigned, in_progress, contractor_complete)', p_new_status;
    end if;
    if array_position(v_flow, p_new_status) <= array_position(v_flow, v_item.status) then
      v_notes := v_notes || format('status not changed: item is already %s', v_item.status);
    elsif p_new_status = 'assigned' and v_item.contractor_id is null and v_contractor_id is null then
      v_notes := v_notes || 'status not changed: no contractor on the item or matched from the email';
    else
      v_status_to := p_new_status;
    end if;
  end if;

  perform set_config('app.performed_by', 'claude', true);

  if v_status_to is not null or v_contractor_id is not null then
    update maintenance_items
    set status = coalesce(v_status_to, status),
        contractor_id = coalesce(contractor_id, v_contractor_id)
    where id = v_item.id;
  end if;

  insert into item_updates (maintenance_item_id, author, content, source,
                            email_message_id, email_subject, email_from, email_to, email_date,
                            status_from, status_to)
  values (v_item.id, 'claude', trim(p_note), 'email',
          p_email_message_id, p_email_subject, p_email_from, p_email_to, p_email_date,
          case when v_status_to is not null then v_item.status end, v_status_to)
  returning id into v_update_id;

  insert into activity_log (maintenance_item_id, action, details, performed_by)
  values (v_item.id, 'email_update',
          jsonb_build_object('update_id', v_update_id, 'email_subject', p_email_subject,
                             'email_from', p_email_from, 'status_from', v_item.status,
                             'status_to', v_status_to),
          'claude');

  perform set_config('app.performed_by', '', true);

  return jsonb_build_object(
    'item_number', v_item.item_number,
    'skipped', false,
    'status_from', v_item.status,
    'status_to', coalesce(v_status_to, v_item.status),
    'status_changed', v_status_to is not null,
    'contractor_set', v_contractor_id is not null,
    'notes', to_jsonb(v_notes)
  );
end;
$function$;

-- 9. Contractor portal. Steps are ordinary items with a contractor, so they're
--    already listed; this adds the job (parent) context: its title/instructions,
--    its photos and comments, every step on the job, and who they're waiting on.
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
      mi.id, mi.item_number, mi.title,
      coalesce(mi.description, par.description) as description,
      (mi.parent_item_id is not null and mi.description is null) as inherits_description,
      mi.status, mi.scheduled_date,
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
        ) order by att.created_at) from maintenance_item_attachments att where att.maintenance_item_id in (mi.id, par.id)), '[]'::json) as attachments
    from maintenance_items mi
    join units u on u.id = mi.unit_id
    join projects p on p.id = u.project_id
    left join maintenance_items par on par.id = mi.parent_item_id
    left join trades tr on tr.id = mi.trade_id
    left join work_orders wo on wo.id = mi.work_order_id
    where mi.contractor_id = v_contractor_id and mi.status <> 'complete' and mi.archived_at is null
      and (par.id is null or par.archived_at is null)
    order by p.name, u.unit_identifier, mi.created_at desc
  ) t;
  return coalesce(result, '[]'::json);
end;
$function$;
