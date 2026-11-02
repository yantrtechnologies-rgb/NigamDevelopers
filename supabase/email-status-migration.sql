-- Run once in Supabase SQL Editor if schema.sql was already applied.
alter table email_notifications drop constraint if exists email_notifications_status_check;
alter table email_notifications add constraint email_notifications_status_check
  check(status in ('pending','sending','sent','failed'));
