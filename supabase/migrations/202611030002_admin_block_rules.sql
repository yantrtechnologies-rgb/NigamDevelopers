-- Require meaningful block reasons, expose block ranges, and reject past blocks.
create or replace function admin_dashboard() returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  select jsonb_build_object(
    'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.booking_date desc,b.start_time desc) from bookings b),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'reason',s.reason,'start_at',lower(s.period),'end_at',upper(s.period)) order by lower(s.period)) from booking_slots s where upper(s.period)>now()),'[]'::jsonb),
    'revenue_paise',coalesce((select sum(amount_paid_paise) from bookings where status='confirmed'),0),
    'confirmed_count',(select count(*) from bookings where status='confirmed')
  ) into result;
  return result;
end $$;

create or replace function admin_block_period(p_date date,p_start time,p_duration integer,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare f turf_facilities; rng tstzrange; block_id uuid;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'A reason is required'; end if;
  select * into f from turf_facilities where active order by id limit 1;
  if p_duration<30 or p_duration>1080 or p_duration%30<>0 then raise exception 'Invalid duration'; end if;
  rng:=tstzrange((p_date+p_start) at time zone 'Asia/Kolkata',(p_date+p_start+make_interval(mins=>p_duration)) at time zone 'Asia/Kolkata','[)');
  if lower(rng)<=now() then raise exception 'Past dates and times cannot be blocked'; end if;
  if exists(select 1 from bookings where facility_id=f.id and status in ('held','confirmed') and period && rng) then raise exception 'A booking already exists in this period'; end if;
  insert into booking_slots(facility_id,period,reason) values(f.id,rng,trim(p_reason)) returning id into block_id;
  return block_id;
end $$;
revoke all on function admin_block_period(date,time,integer,text) from public,anon;
grant execute on function admin_block_period(date,time,integer,text) to authenticated;
