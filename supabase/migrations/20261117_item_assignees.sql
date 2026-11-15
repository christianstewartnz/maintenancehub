-- Assign maintenance items to a Maintenance Hub user (staff member).
-- assigned_to = NULL means "unassigned": it shows for everyone in "My items".

-- 1. profiles: a readable list of app users (auth.users isn't exposed to the browser)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Keep profiles in sync with auth.users (new invites get a profile automatically)
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$function$;

drop trigger if exists on_auth_user_profile on auth.users;
create trigger on_auth_user_profile
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, email, full_name)
select id, email, nullif(raw_user_meta_data->>'full_name', '') from auth.users
on conflict (id) do nothing;

-- 2. maintenance_items.assigned_to
alter table public.maintenance_items
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists maintenance_items_assigned_to_idx
  on public.maintenance_items (assigned_to);

-- 3. Log assignment changes in the item's activity
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
  if old.assigned_to is distinct from new.assigned_to then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    values (new.id, 'assignee_changed',
            jsonb_build_object(
              'from', old.assigned_to, 'to', new.assigned_to,
              'to_name', (select coalesce(full_name, split_part(email, '@', 1)) from profiles where id = new.assigned_to)),
            v_by);
  end if;
  return new;
end;
$function$;
