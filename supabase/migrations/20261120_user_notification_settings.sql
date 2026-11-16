-- Per-user email notification settings.
--  * notify_email: where this user's notifications go (null = their login email)
--  * maintenance_due_email: opt in/out of the daily 90-day maintenance-due alert

alter table public.notification_preferences
  add column if not exists notify_email text,
  add column if not exists maintenance_due_email boolean not null default true;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_notify_email_check;
alter table public.notification_preferences
  add constraint notification_preferences_notify_email_check
  check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
