-- Run in your own Supabase project's SQL editor.
-- This table stores patient contact information. Keep access server-only.
create extension if not exists pgcrypto;
create table if not exists public.online_bookings (
 id uuid primary key default gen_random_uuid(),
 slot_date date not null,
 slot_time text not null,
 mode text not null check(mode in ('video','audio')),
 patient_name text not null,
 mobile text not null,
 amount_paise integer not null check(amount_paise>0),
 status text not null default 'held' check(status in ('held','paid','expired','cancelled')),
 held_until timestamptz not null default (now()+interval '15 minutes'),
 razorpay_order_id text unique,
 razorpay_payment_id text unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create unique index if not exists one_live_online_booking_per_slot
 on public.online_bookings(slot_date,slot_time) where status in ('held','paid');
create index if not exists online_bookings_date on public.online_bookings(slot_date);
alter table public.online_bookings enable row level security;
revoke all on public.online_bookings from anon, authenticated, public;
grant all on public.online_bookings to service_role;

create or replace function public.phc_reserve_online_slot(p_date date,p_time text,p_mode text,p_name text,p_mobile text,p_fee integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare booking_id uuid; min_slot int; is_sunday bool; today_ist date; time_ist time;
begin
 today_ist=(now() at time zone 'Asia/Kolkata')::date;
 time_ist=(now() at time zone 'Asia/Kolkata')::time;
 if p_date is null or p_date<today_ist or p_date>today_ist+90 then raise exception 'Invalid date';end if;
 if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid time';end if;
 min_slot=split_part(p_time,':',1)::int*60+split_part(p_time,':',2)::int;
 is_sunday=extract(dow from p_date)=0;
 if not ( (min_slot>=660 and min_slot+30<=840 and mod(min_slot-660,30)=0) or
  (not is_sunday and min_slot>=1020 and min_slot+30<=1200 and mod(min_slot-1020,30)=0) ) then
  raise exception 'Outside clinic hours';
 end if;
 if p_date=today_ist and p_time::time<=time_ist then raise exception 'Past time';end if;
 if p_mode not in('video','audio') or length(trim(p_name)) not between 2 and 80 or p_mobile !~ '^\d{10}$' or p_fee<1 then raise exception 'Invalid booking information';end if;
 -- Clear expired holds before attempting the unique-slot insert.
 update public.online_bookings set status='expired' where slot_date=p_date and slot_time=p_time and status='held' and held_until<=now();
 insert into public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise)
 values(p_date,p_time,p_mode,trim(p_name),p_mobile,p_fee) returning id into booking_id;
 return booking_id;
end;$$;

create or replace function public.phc_attach_order(p_id uuid,p_order text)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.online_bookings set razorpay_order_id=p_order where id=p_id and status='held' and held_until>now();
 if not found then raise exception 'Hold expired';end if;
end;$$;

create or replace function public.phc_cancel_held_slot(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.online_bookings set status='cancelled' where id=p_id and status='held' and razorpay_order_id is null;
end;$$;

create or replace function public.phc_confirm_paid_slot(p_order text,p_payment text,p_amount integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare booked uuid;
begin
 if p_order is null or p_payment is null or p_amount<1 then return false; end if;
 update public.online_bookings set status='paid',paid_at=now(),razorpay_payment_id=coalesce(razorpay_payment_id,p_payment)
 where razorpay_order_id=p_order and amount_paise=p_amount and status='held'
 returning id into booked;
 if booked is not null then return true;end if;
 return exists(select 1 from public.online_bookings where razorpay_order_id=p_order and razorpay_payment_id=p_payment and status='paid');
end;$$;

revoke all on function public.phc_reserve_online_slot(date,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.phc_attach_order(uuid,text) from public,anon,authenticated;
revoke all on function public.phc_cancel_held_slot(uuid) from public,anon,authenticated;
revoke all on function public.phc_confirm_paid_slot(text,text,integer) from public,anon,authenticated;
grant execute on function public.phc_reserve_online_slot(date,text,text,text,text,integer) to service_role;
grant execute on function public.phc_attach_order(uuid,text) to service_role;
grant execute on function public.phc_cancel_held_slot(uuid) to service_role;
grant execute on function public.phc_confirm_paid_slot(text,text,integer) to service_role;

-- OPTIONAL: clinic administrator can view confirmed appointments from SQL Editor:
-- select slot_date,slot_time,mode,patient_name,mobile,paid_at
-- from public.online_bookings where status='paid' order by slot_date,slot_time;
