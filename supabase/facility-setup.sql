-- Run after schema.sql on a new project. Prices are in paise.
-- This app supports one active facility.
insert into turf_facilities(name,hourly_paise,weekend_paise)
select 'Nigam''s Turf',120000,120000
where not exists(select 1 from turf_facilities where active);
update turf_facilities set name='Nigam''s Turf',hourly_paise=120000,weekend_paise=120000 where active;
insert into turf_operating_hours(facility_id,weekday,opens,closes)
select f.id,d,'05:00'::time,'23:00'::time
from turf_facilities f cross join generate_series(0,6) d where f.active
on conflict(facility_id,weekday) do update set opens=excluded.opens,closes=excluded.closes;
