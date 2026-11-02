-- Apply once to a new Supabase project. All times are Asia/Kolkata.
create extension if not exists btree_gist;
create table public.users(id uuid primary key references auth.users(id) on delete cascade);
create table customer_profiles(id uuid primary key references auth.users(id), name text, mobile text);
create table admin_users(user_id uuid primary key references auth.users(id));
create function is_admin() returns boolean language sql security definer stable set search_path=public as $$ select exists(select 1 from admin_users where user_id=auth.uid()) $$;
create table turf_facilities(id uuid primary key default gen_random_uuid(),name text not null,active boolean default true,hourly_paise integer not null check(hourly_paise>0),weekend_paise integer,peak_paise integer,cancellation_hours integer default 24);
create table turf_operating_hours(id uuid primary key default gen_random_uuid(),facility_id uuid references turf_facilities,weekday integer check(weekday between 0 and 6),opens time not null,closes time not null,unique(facility_id,weekday));
create table promotional_coupons(code text primary key,percent integer check(percent between 0 and 100),expires_at timestamptz,active boolean default true);
create sequence booking_reference_seq;
create table bookings(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),facility_id uuid not null references turf_facilities,reference text unique,booking_date date not null,start_time time not null,duration_minutes integer not null check(duration_minutes in (30,60,90,120)),period tstzrange not null,status text not null check(status in ('held','confirmed','expired','cancelled')),expires_at timestamptz,amount_paise integer not null check(amount_paise>0),customer_name text not null,mobile text not null,order_id text unique,created_at timestamptz default now(),exclude using gist(facility_id with =,period with &&) where(status in ('held','confirmed')));
create table booking_slots(id uuid primary key default gen_random_uuid(),facility_id uuid references turf_facilities,period tstzrange not null,reason text);
create table booking_payments(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,payment_id text unique not null,amount_paise integer not null,status text not null,created_at timestamptz default now());
create table payment_transactions(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,event_id text unique,payload jsonb,created_at timestamptz default now());
create table booking_cancellations(id uuid primary key default gen_random_uuid(),booking_id uuid unique references bookings,reason text,created_at timestamptz default now());
create table refunds(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,amount_paise integer,status text default 'pending',gateway_id text);
create table email_notifications(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,kind text,send_at timestamptz default now(),status text default 'pending',unique(booking_id,kind));
create table audit_logs(id bigint generated always as identity primary key,booking_id uuid references bookings,action text,created_at timestamptz default now());
-- Deny access by default; customers only see their own records.
do $$ declare t text; begin foreach t in array array['users','customer_profiles','admin_users','turf_facilities','turf_operating_hours','promotional_coupons','bookings','booking_slots','booking_payments','payment_transactions','booking_cancellations','refunds','email_notifications','audit_logs'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy own_profile on customer_profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy booking_read on bookings for select to authenticated using(user_id=auth.uid() or is_admin());
create policy facility_read on turf_facilities for select using(active or is_admin());
create policy hours_read on turf_operating_hours for select using(true);
create policy admin_facilities on turf_facilities for all to authenticated using(is_admin()) with check(is_admin());
create policy admin_hours on turf_operating_hours for all to authenticated using(is_admin()) with check(is_admin());
create policy admin_blocks on booking_slots for all to authenticated using(is_admin()) with check(is_admin());
create policy admin_coupons on promotional_coupons for all to authenticated using(is_admin()) with check(is_admin());
create function available_slots(p_date date) returns table(start_time time,status text,price_per_hour numeric) language sql security definer set search_path=public as $$
select s::time,case when s at time zone 'Asia/Kolkata' <= now() then 'unavailable' when exists(select 1 from booking_slots x where x.facility_id=f.id and x.period && tstzrange(s at time zone 'Asia/Kolkata',(s+interval '30 minutes') at time zone 'Asia/Kolkata','[)')) then 'maintenance' when exists(select 1 from bookings b where b.facility_id=f.id and b.status='confirmed' and b.period && tstzrange(s at time zone 'Asia/Kolkata',(s+interval '30 minutes') at time zone 'Asia/Kolkata','[)')) then 'booked' when exists(select 1 from bookings b where b.facility_id=f.id and b.status='held' and b.expires_at>now() and b.period && tstzrange(s at time zone 'Asia/Kolkata',(s+interval '30 minutes') at time zone 'Asia/Kolkata','[)')) then 'reserved' else 'available' end, (case when extract(dow from p_date) in (0,6) then coalesce(f.weekend_paise,f.hourly_paise) else f.hourly_paise end)/100.0
from turf_facilities f join turf_operating_hours h on h.facility_id=f.id and h.weekday=extract(dow from p_date),lateral generate_series(p_date+h.opens,p_date+h.closes-interval '30 minutes',interval '30 minutes') s where f.active order by s $$;
create function reserve_booking(p_user uuid,p_date date,p_start time,p_duration integer,p_name text,p_mobile text,p_coupon text default '') returns bookings language plpgsql security definer set search_path=public as $$
declare f turf_facilities; h turf_operating_hours; result bookings; rng tstzrange; amount integer; discount integer;
begin
select * into f from turf_facilities where active order by id limit 1 for update;
if not found then raise exception 'No active facility'; end if;
select * into h from turf_operating_hours where facility_id=f.id and weekday=extract(dow from p_date);
if h.id is null or p_duration not in(30,60,90,120) or extract(minute from p_start)::integer%30<>0 or extract(second from p_start)<>0 or p_start<h.opens or p_date+p_start+make_interval(mins=>p_duration)>p_date+h.closes then raise exception 'Outside operating hours'; end if;
rng:=tstzrange((p_date+p_start) at time zone 'Asia/Kolkata',(p_date+p_start+make_interval(mins=>p_duration)) at time zone 'Asia/Kolkata','[)');
if lower(rng)<=now() then raise exception 'Select a future time'; end if;
update bookings set status='expired' where status='held' and expires_at<=now();
if exists(select 1 from booking_slots where facility_id=f.id and period && rng) then raise exception 'Slot blocked'; end if;
amount:=(case when extract(dow from p_date) in (0,6) then coalesce(f.weekend_paise,f.hourly_paise) else f.hourly_paise end)*p_duration/60;
if p_coupon<>'' then select percent into discount from promotional_coupons where code=p_coupon and active and (expires_at is null or expires_at>now()); if discount is null then raise exception 'Invalid coupon'; end if; amount:=amount*(100-discount)/100; end if;
insert into bookings(user_id,facility_id,booking_date,start_time,duration_minutes,period,status,expires_at,amount_paise,customer_name,mobile) values(p_user,f.id,p_date,p_start,p_duration,rng,'held',now()+interval '10 minutes',amount,p_name,p_mobile) returning * into result; return result;
end $$;
revoke all on function reserve_booking(uuid,date,time,integer,text,text,text) from public,anon,authenticated;
grant execute on function reserve_booking(uuid,date,time,integer,text,text,text) to service_role;
create function confirm_payment(p_order text,p_payment text,p_amount integer) returns text language plpgsql security definer set search_path=public as $$
declare b bookings; r text;
begin
select * into b from bookings where order_id=p_order for update;
if not found or b.amount_paise<>p_amount then raise exception 'Payment mismatch'; end if;
if b.status='confirmed' then return b.reference; end if;
if b.status<>'held' or b.expires_at<=now() then raise exception 'Reservation expired; manual payment reconciliation required'; end if;
r:='SBL-CRT-'||to_char(b.booking_date,'YYYYMMDD')||'-'||lpad(nextval('booking_reference_seq')::text,6,'0');
insert into booking_payments(booking_id,payment_id,amount_paise,status) values(b.id,p_payment,p_amount,'captured');
update bookings set status='confirmed',reference=r where id=b.id;
insert into email_notifications(booking_id,kind,send_at) values(b.id,'confirmation',now()),(b.id,'reminder_24h',greatest(now(),lower(b.period)-interval '24 hours')),(b.id,'reminder_1h',greatest(now(),lower(b.period)-interval '1 hour')) on conflict do nothing;
insert into audit_logs(booking_id,action) values(b.id,'payment_verified');return r;
end $$;
revoke all on function confirm_payment(text,text,integer) from public,anon,authenticated;
grant execute on function confirm_payment(text,text,integer) to service_role;
