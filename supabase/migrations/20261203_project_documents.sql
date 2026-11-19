-- Per-project documents (e.g. the maintenance form + maintenance letter) that are
-- attached to the 90-day maintenance reminder email drafts for that project's units.
-- Files live in the private `project-documents` bucket at `<project_id>/<uuid>-<name>`.
-- Uploads, downloads and deletes go through API routes using the service role, so the
-- bucket needs no storage policies. Additive: new table + bucket only.

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  attach_to_reminder boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_documents_project_idx
  on public.project_documents (project_id, created_at);

alter table public.project_documents enable row level security;

drop policy if exists admin_all_project_documents on public.project_documents;
create policy admin_all_project_documents on public.project_documents
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-documents', 'project-documents', false, 20971520)
on conflict (id) do nothing;
