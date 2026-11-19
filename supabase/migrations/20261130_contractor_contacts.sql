-- Additional contacts for a contractor (beyond the main contact on the contractors row),
-- e.g. office manager, site supervisor, accounts.

create table if not exists public.contractor_contacts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists contractor_contacts_contractor_id_idx
  on public.contractor_contacts (contractor_id);

alter table public.contractor_contacts enable row level security;

drop policy if exists admin_all_contractor_contacts on public.contractor_contacts;
create policy admin_all_contractor_contacts on public.contractor_contacts
  for all to authenticated using (true) with check (true);
