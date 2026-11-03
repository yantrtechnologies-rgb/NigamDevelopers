-- New bookings must be 1 hour, 1.5 hours, or 2 hours.
create or replace function enforce_booking_duration() returns trigger language plpgsql set search_path=public as $$
begin
  if new.duration_minutes not in (60,90,120) then
    raise exception 'Bookings must be 60, 90, or 120 minutes';
  end if;
  return new;
end $$;

drop trigger if exists bookings_allowed_duration on bookings;
create trigger bookings_allowed_duration before insert or update of duration_minutes on bookings
for each row execute function enforce_booking_duration();
