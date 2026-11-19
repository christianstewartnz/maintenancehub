-- Record when the owner(s) of a unit were sent their 90-day maintenance
-- reminder email. Once set, the unit's "Maint. Due" date shows green
-- ("Reminded") instead of amber/red — our job is only to remind the owner,
-- not to chase the form. Additive: nullable column, no existing code affected.

alter table public.units
  add column if not exists maintenance_reminder_sent_at timestamptz;

comment on column public.units.maintenance_reminder_sent_at is
  'When the owners were emailed their 90-day maintenance form reminder (null = not yet reminded).';
