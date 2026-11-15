-- Email-driven updates from the daily "Maintenance email check" routine.
-- item_updates holds internal (admin-only) notes. Unlike contractor_comments,
-- these are NOT returned by get_portal_items, so contractors never see them.

create table if not exists public.item_updates (
  id uuid primary key default gen_random_uuid(),
  maintenance_item_id uuid not null references public.maintenance_items(id) on delete cascade,
  author text not null default 'claude',
  content text not null,
  source text not null default 'email',
  email_message_id text,
  email_subject text,
  email_from text,
  email_to text,
  email_date timestamptz,
  status_from text,
  status_to text,
  created_at timestamptz not null default now()
);

create index if not exists item_updates_item_idx
  on public.item_updates (maintenance_item_id, created_at);

-- The same email can never be applied to the same item twice.
create unique index if not exists item_updates_email_dedupe
  on public.item_updates (maintenance_item_id, email_message_id)
  where email_message_id is not null;

alter table public.item_updates enable row level security;

drop policy if exists admin_all_item_updates on public.item_updates;
create policy admin_all_item_updates on public.item_updates
  for all to authenticated using (true) with check (true);

-- Let callers record who made a change (defaults to 'system' as before).
create or replace function public.log_status_change()
returns trigger
language plpgsql
as $function$
declare
  v_by text := coalesce(nullif(current_setting('app.performed_by', true), ''), 'system');
begin
  if old.status is distinct from new.status then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    values (new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status), v_by);
  end if;
  if old.contractor_id is distinct from new.contractor_id and new.contractor_id is not null then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    values (new.id, 'contractor_assigned', jsonb_build_object('contractor_id', new.contractor_id), v_by);
  end if;
  if old.work_order_id is distinct from new.work_order_id and new.work_order_id is not null then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    values (new.id, 'work_order_added', jsonb_build_object('work_order_id', new.work_order_id), v_by);
  end if;
  return new;
end;
$function$;

-- Guarded entry point for the routine. Rules enforced here, not just in the prompt:
--  * a note is always required (every change is explained on the item)
--  * status may only move FORWARD, and only to assigned / in_progress / contractor_complete
--    ('complete' stays a manual sign-off; backwards moves become note-only)
--  * moving to 'assigned' needs a contractor: either already on the item, or
--    p_contractor_email matching exactly one active contractor (set only if the item has none)
--  * the same email message is applied to an item at most once
create or replace function public.apply_email_update(
  p_item_number text,
  p_note text,
  p_new_status text default null,
  p_contractor_email text default null,
  p_email_message_id text default null,
  p_email_subject text default null,
  p_email_from text default null,
  p_email_to text default null,
  p_email_date timestamptz default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
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

  if p_email_message_id is not null and exists (
    select 1 from item_updates
    where maintenance_item_id = v_item.id and email_message_id = p_email_message_id
  ) then
    return jsonb_build_object('item_number', v_item.item_number, 'skipped', true,
                              'reason', 'this email was already applied to this item');
  end if;

  -- Contractor match (only used when the item has no contractor yet)
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

-- Not callable from the browser/portal; the routine runs it as the database owner.
revoke execute on function public.apply_email_update(text, text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
