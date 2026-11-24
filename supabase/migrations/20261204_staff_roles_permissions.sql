-- Staff roles and per-project access.
--
--  * profiles.role: 'admin' sees and manages everything; 'staff' only sees the
--    projects they're assigned to in project_staff.
--  * profiles.is_active: a deactivated user sees nothing.
--  * project_staff: who looks after each project; one row per project can be the
--    main contact (is_primary). An item with no Responsible person falls to the
--    project's main contact (mh_item_responsible).
--
-- Safe for the live app: every existing user is made 'admin', and admins pass
-- every new policy exactly as they passed the old "authenticated → true" ones.
-- Only users switched to 'staff' are scoped. Portal (anon) policies are untouched.

-- 1. profiles: role, active flag, phone ------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'staff',
  add column if not exists is_active boolean not null default true,
  add column if not exists phone text;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff'));

-- Existing users keep full access until they're switched to staff at go-live.
update public.profiles set role = 'admin' where role <> 'admin';

-- 2. project_staff ----------------------------------------------------------------

create table if not exists public.project_staff (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create unique index if not exists project_staff_one_primary
  on public.project_staff (project_id) where is_primary;
create index if not exists project_staff_user_idx on public.project_staff (user_id);

-- Christian (admin) starts as main contact on every project.
insert into public.project_staff (project_id, user_id, is_primary)
select p.id, pr.id, true
from public.projects p
cross join public.profiles pr
where pr.email = 'christian.stewart@stratum-mgt.co.nz'
on conflict (project_id, user_id) do nothing;

-- 3. Access helpers (security definer so policies don't recurse through RLS) ------

create or replace function public.mh_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.mh_is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function public.mh_can_access_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select mh_is_admin() or exists (
    select 1 from project_staff ps join profiles pr on pr.id = ps.user_id
    where ps.project_id = p_project_id and ps.user_id = auth.uid() and pr.is_active
  );
$$;

create or replace function public.mh_can_access_unit(p_unit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select mh_is_admin() or exists (
    select 1 from units u
    join project_staff ps on ps.project_id = u.project_id and ps.user_id = auth.uid()
    join profiles pr on pr.id = ps.user_id and pr.is_active
    where u.id = p_unit_id
  );
$$;

create or replace function public.mh_can_access_item(p_item_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select mh_is_admin() or exists (
    select 1 from maintenance_items mi
    join units u on u.id = mi.unit_id
    join project_staff ps on ps.project_id = u.project_id and ps.user_id = auth.uid()
    join profiles pr on pr.id = ps.user_id and pr.is_active
    where mi.id = p_item_id
  );
$$;

-- The project's main contact (null if none).
create or replace function public.mh_project_contact(p_project_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from project_staff where project_id = p_project_id and is_primary limit 1;
$$;

-- Who is responsible for an item: its own Responsible person, else its parent
-- job's (for steps), else the project's main contact.
create or replace function public.mh_item_responsible(p_item_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(mi.assigned_to, par.assigned_to, mh_project_contact(u.project_id))
  from maintenance_items mi
  join units u on u.id = mi.unit_id
  left join maintenance_items par on par.id = mi.parent_item_id
  where mi.id = p_item_id;
$$;

revoke execute on function public.mh_item_responsible(uuid) from anon;
revoke execute on function public.mh_project_contact(uuid) from anon;

-- 4. Guards: only admins change roles, activation, contractor archive / portal link

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the service role and SQL console: allowed.
  if auth.uid() is not null and not mh_is_admin()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Only an admin can change roles or deactivate users';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.contractors_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not mh_is_admin()
     and (new.is_active is distinct from old.is_active or new.portal_token is distinct from old.portal_token) then
    raise exception 'Only an admin can archive a contractor or change their portal link';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contractors_guard on public.contractors;
create trigger trg_contractors_guard before update on public.contractors
  for each row execute function public.contractors_guard();

-- 5. Policies (authenticated). Admin path is first so it short-circuits. ------------

alter table public.project_staff enable row level security;

drop policy if exists project_staff_read on public.project_staff;
create policy project_staff_read on public.project_staff
  for select to authenticated using (mh_can_access_project(project_id));
drop policy if exists project_staff_admin_write on public.project_staff;
create policy project_staff_admin_write on public.project_staff
  for all to authenticated using (mh_is_admin()) with check (mh_is_admin());

-- profiles: everyone reads (names on items); admins may update anyone (guarded above)
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated using (mh_is_admin()) with check (mh_is_admin());

-- projects: staff see/edit their own; only admins create or delete
drop policy if exists admin_all_projects on public.projects;
drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_select on public.projects for select to authenticated using (mh_can_access_project(id));
create policy projects_insert on public.projects for insert to authenticated with check (mh_is_admin());
create policy projects_update on public.projects for update to authenticated
  using (mh_can_access_project(id)) with check (mh_can_access_project(id));
create policy projects_delete on public.projects for delete to authenticated using (mh_is_admin());

-- tables keyed by project_id
drop policy if exists admin_all_units on public.units;
drop policy if exists units_scoped on public.units;
create policy units_scoped on public.units for all to authenticated
  using (mh_can_access_project(project_id)) with check (mh_can_access_project(project_id));

drop policy if exists admin_all_trades on public.trades;
drop policy if exists trades_scoped on public.trades;
create policy trades_scoped on public.trades for all to authenticated
  using (mh_can_access_project(project_id)) with check (mh_can_access_project(project_id));

drop policy if exists admin_all_project_trade_assignments on public.project_trade_assignments;
drop policy if exists project_trade_assignments_scoped on public.project_trade_assignments;
create policy project_trade_assignments_scoped on public.project_trade_assignments for all to authenticated
  using (mh_can_access_project(project_id)) with check (mh_can_access_project(project_id));

drop policy if exists admin_all_work_orders on public.work_orders;
drop policy if exists work_orders_scoped on public.work_orders;
create policy work_orders_scoped on public.work_orders for all to authenticated
  using (mh_can_access_project(project_id)) with check (mh_can_access_project(project_id));

drop policy if exists admin_all_project_documents on public.project_documents;
drop policy if exists project_documents_scoped on public.project_documents;
create policy project_documents_scoped on public.project_documents for all to authenticated
  using (mh_can_access_project(project_id)) with check (mh_can_access_project(project_id));

-- keyed by unit_id
drop policy if exists "Authenticated users can manage unit owners" on public.unit_owners;
drop policy if exists "Authenticated users can view unit owners" on public.unit_owners;
drop policy if exists unit_owners_scoped on public.unit_owners;
create policy unit_owners_scoped on public.unit_owners for all to authenticated
  using (mh_can_access_unit(unit_id)) with check (mh_can_access_unit(unit_id));

drop policy if exists admin_all_maintenance_items on public.maintenance_items;
drop policy if exists maintenance_items_scoped on public.maintenance_items;
create policy maintenance_items_scoped on public.maintenance_items for all to authenticated
  using (mh_can_access_unit(unit_id)) with check (mh_can_access_unit(unit_id));

-- keyed by maintenance_item_id
drop policy if exists admin_all_activity_log on public.activity_log;
drop policy if exists activity_log_scoped on public.activity_log;
create policy activity_log_scoped on public.activity_log for all to authenticated
  using (mh_can_access_item(maintenance_item_id)) with check (mh_can_access_item(maintenance_item_id));

drop policy if exists admin_all_comments on public.contractor_comments;
drop policy if exists contractor_comments_scoped on public.contractor_comments;
create policy contractor_comments_scoped on public.contractor_comments for all to authenticated
  using (mh_can_access_item(maintenance_item_id)) with check (mh_can_access_item(maintenance_item_id));

drop policy if exists admin_all_attachments on public.maintenance_item_attachments;
drop policy if exists attachments_scoped on public.maintenance_item_attachments;
create policy attachments_scoped on public.maintenance_item_attachments for all to authenticated
  using (mh_can_access_item(maintenance_item_id)) with check (mh_can_access_item(maintenance_item_id));

drop policy if exists admin_all_item_updates on public.item_updates;
drop policy if exists item_updates_scoped on public.item_updates;
create policy item_updates_scoped on public.item_updates for all to authenticated
  using (mh_can_access_item(maintenance_item_id)) with check (mh_can_access_item(maintenance_item_id));

-- contractors are shared: any active user reads/adds/edits; only admins delete
-- (archive and portal-link changes are admin-only via contractors_guard)
drop policy if exists admin_all_contractors on public.contractors;
drop policy if exists contractors_select on public.contractors;
drop policy if exists contractors_insert on public.contractors;
drop policy if exists contractors_update on public.contractors;
drop policy if exists contractors_delete on public.contractors;
create policy contractors_select on public.contractors for select to authenticated using (mh_is_active_user());
create policy contractors_insert on public.contractors for insert to authenticated with check (mh_is_active_user());
create policy contractors_update on public.contractors for update to authenticated
  using (mh_is_active_user()) with check (mh_is_active_user());
create policy contractors_delete on public.contractors for delete to authenticated using (mh_is_admin());

drop policy if exists admin_all_contractor_contacts on public.contractor_contacts;
drop policy if exists contractor_contacts_active on public.contractor_contacts;
create policy contractor_contacts_active on public.contractor_contacts for all to authenticated
  using (mh_is_active_user()) with check (mh_is_active_user());
