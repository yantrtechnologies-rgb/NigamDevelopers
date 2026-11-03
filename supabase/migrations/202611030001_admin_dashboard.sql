-- Owner dashboard support. Run once in the Supabase SQL Editor.
alter table bookings add column if not exists payment_method text not null default 'online'
  check (payment_method in ('online','cash','complimentary'));
alter table bookings add column if not exists amount_paid_paise integer not null default 0
  check (amount_paid_paise >= 0);
update bookings set amount_paid_paise=amount_paise where status='confirmed' and payment_method='online' and amount_paid_paise=0;

create or replace function admin_dashboard() returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  select jsonb_build_object(
    'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.booking_date desc,b.start_time desc) from bookings b),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.period)) from booking_slots s),'[]'::jsonb),
    'revenue_paise',coalesce((select sum(amount_paid_paise) from bookings where status='confirmed'),0),
    'confirmed_count',(select count(*) from bookings where status='confirmed')
  ) into result;
  return result;
end $$;

create or replace function admin_create_booking(p_date date,p_start time,p_duration integer,p_name text,p_mobile text,p_payment_method text)
returns bookings language plpgsql security definer set search_path=public as $$
declare f turf_facilities; h turf_operating_hours; result bookings; rng tstzrange; amount integer; ref text;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  if p_payment_method not in ('cash','complimentary') then raise exception 'Invalid payment method'; end if;
  select * into f from turf_facilities where active order by id limit 1 for update;
  select * into h from turf_operating_hours where facility_id=f.id and weekday=extract(dow from p_date);
  if h.id is null or p_duration not in(30,60,90,120) or p_start<h.opens or p_date+p_start+make_interval(mins=>p_duration)>p_date+h.closes then raise exception 'Outside operating hours'; end if;
  rng:=tstzrange((p_date+p_start) at time zone 'Asia/Kolkata',(p_date+p_start+make_interval(mins=>p_duration)) at time zone 'Asia/Kolkata','[)');
  if lower(rng)<=now() then raise exception 'Select a future time'; end if;
  update bookings set status='expired' where status='held' and expires_at<=now();
  if exists(select 1 from booking_slots where facility_id=f.id and period && rng) then raise exception 'Slot blocked'; end if;
  amount:=(p_duration/60)*120000+case when p_duration%60=30 then 70000 else 0 end;
  ref:='SBL-CRT-'||to_char(p_date,'YYYYMMDD')||'-'||lpad(nextval('booking_reference_seq')::text,6,'0');
  insert into bookings(user_id,facility_id,reference,booking_date,start_time,duration_minutes,period,status,amount_paise,amount_paid_paise,payment_method,customer_name,mobile)
  values(auth.uid(),f.id,ref,p_date,p_start,p_duration,rng,'confirmed',amount,case when p_payment_method='cash' then amount else 0 end,p_payment_method,left(trim(p_name),100),p_mobile) returning * into result;
  insert into audit_logs(booking_id,action) values(result.id,'admin_'||p_payment_method||'_booking');
  return result;
end $$;

create or replace function admin_block_period(p_date date,p_start time,p_duration integer,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare f turf_facilities; rng tstzrange; block_id uuid;
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  select * into f from turf_facilities where active order by id limit 1;
  if p_duration<30 or p_duration>1080 or p_duration%30<>0 then raise exception 'Invalid duration'; end if;
  rng:=tstzrange((p_date+p_start) at time zone 'Asia/Kolkata',(p_date+p_start+make_interval(mins=>p_duration)) at time zone 'Asia/Kolkata','[)');
  if exists(select 1 from bookings where facility_id=f.id and status in ('held','confirmed') and period && rng) then raise exception 'A booking already exists in this period'; end if;
  insert into booking_slots(facility_id,period,reason) values(f.id,rng,coalesce(nullif(trim(p_reason),''),'Owner block')) returning id into block_id;
  return block_id;
end $$;

create or replace function admin_remove_block(p_block uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Administrator access required'; end if;
  delete from booking_slots where id=p_block;
end $$;

revoke all on function admin_dashboard() from public,anon;
revoke all on function admin_create_booking(date,time,integer,text,text,text) from public,anon;
revoke all on function admin_block_period(date,time,integer,text) from public,anon;
revoke all on function admin_remove_block(uuid) from public,anon;
grant execute on function admin_dashboard() to authenticated;
grant execute on function admin_create_booking(date,time,integer,text,text,text) to authenticated;
grant execute on function admin_block_period(date,time,integer,text) to authenticated;
grant execute on function admin_remove_block(uuid) to authenticated;

-- Ensure online payment confirmation records received revenue.
create or replace function confirm_payment(p_order text,p_payment text,p_amount integer) returns text language plpgsql security definer set search_path=public as $$
declare b bookings; r text;
begin
select * into b from bookings where order_id=p_order for update;
if not found or b.amount_paise<>p_amount then raise exception 'Payment mismatch'; end if;
if b.status='confirmed' then return b.reference; end if;
if b.status<>'held' or b.expires_at<=now() then raise exception 'Reservation expired; manual payment reconciliation required'; end if;
r:='SBL-CRT-'||to_char(b.booking_date,'YYYYMMDD')||'-'||lpad(nextval('booking_reference_seq')::text,6,'0');
insert into booking_payments(booking_id,payment_id,amount_paise,status) values(b.id,p_payment,p_amount,'captured');
update bookings set status='confirmed',reference=r,amount_paid_paise=p_amount,payment_method='online' where id=b.id;
insert into email_notifications(booking_id,kind,send_at) values(b.id,'confirmation',now()),(b.id,'reminder_24h',greatest(now(),lower(b.period)-interval '24 hours')),(b.id,'reminder_1h',greatest(now(),lower(b.period)-interval '1 hour')) on conflict do nothing;
insert into audit_logs(booking_id,action) values(b.id,'payment_verified');return r;
end $$;
revoke all on function confirm_payment(text,text,integer) from public,anon,authenticated;
grant execute on function confirm_payment(text,text,integer) to service_role;
