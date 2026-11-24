-- Admin option: receive contractor alerts for every project, not just items you're responsible for.
-- Existing users get true so their alerts don't change until go-live.
alter table public.notification_preferences add column if not exists alerts_all_projects boolean not null default false;
update public.notification_preferences set alerts_all_projects = true;
