-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - COMPLETE MASTER SETUP
-- Run this single script in Supabase SQL Editor
-- DBMS Course Project
-- ==============================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. ENUM TYPES
do $$ begin
  create type seat_status as enum ('available', 'held', 'booked');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type booking_status as enum ('pending', 'confirmed', 'expired');
exception
  when duplicate_object then null;
end $$;

-- 3. TABLES

-- Profiles (Linked with Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer', 'admin'));

-- Movies
create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  language text not null,
  duration_min int not null check (duration_min > 0),
  genre text,
  rating text default 'UA',
  poster_url text,
  synopsis text,
  created_at timestamptz not null default now()
);

-- Screens
create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  screen_type text default 'Standard'
);

-- Seats (Physical layout)
create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references public.screens(id) on delete cascade,
  row_label text not null,
  seat_number int not null,
  tier text default 'Standard',
  unique (screen_id, row_label, seat_number)
);

-- Shows
create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete cascade,
  screen_id uuid not null references public.screens(id) on delete cascade,
  starts_at timestamptz not null,
  ticket_price numeric(8,2) not null check (ticket_price > 0),
  unique (screen_id, starts_at)
);

-- Bookings
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  status booking_status not null default 'pending',
  total_amount numeric(10,2) not null check (total_amount >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Show Seats (State per seat per show)
create table if not exists public.show_seats (
  show_id uuid not null references public.shows(id) on delete cascade,
  seat_id uuid not null references public.seats(id) on delete cascade,
  status seat_status not null default 'available',
  booking_id uuid references public.bookings(id) on delete set null,
  hold_expires_at timestamptz,
  primary key (show_id, seat_id),
  check (status = 'available' or booking_id is not null),
  check (status <> 'held' or hold_expires_at is not null)
);

-- Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  paid_at timestamptz not null default now()
);

-- 4. INDEXES
create index if not exists idx_show_seats_held on public.show_seats (hold_expires_at)
  where status = 'held';
create index if not exists idx_shows_starts_at on public.shows (starts_at);
create index if not exists idx_bookings_user_id on public.bookings (user_id);
create index if not exists idx_seats_screen on public.seats (screen_id);

-- 5. TRIGGERS

-- Auto create profile on auth signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'Cinema Guest')
  )
  on conflict (id) do update
  set full_name = excluded.full_name;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto populate show_seats when a new show is scheduled
create or replace function public.populate_show_seats()
returns trigger as $$
begin
  insert into public.show_seats (show_id, seat_id, status)
  select new.id, s.id, 'available'
  from public.seats s
  where s.screen_id = new.screen_id
  on conflict (show_id, seat_id) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_populate_show_seats on public.shows;
create trigger trg_populate_show_seats
  after insert on public.shows
  for each row execute procedure public.populate_show_seats();

-- 6. CORE FUNCTIONS

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.admin_show_data(p_show_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select jsonb_build_object(
    'show', (select jsonb_build_object(
      'id', sh.id, 'starts_at', sh.starts_at, 'ticket_price', sh.ticket_price,
      'screen_id', sc.id, 'screen_name', sc.name, 'screen_type', sc.screen_type
    ) from public.shows sh join public.screens sc on sc.id = sh.screen_id where sh.id = p_show_id),
    'summary', jsonb_build_object(
      'total_seats', (select count(*) from public.show_seats where show_id = p_show_id),
      'booked_seats', (select count(*) from public.show_seats where show_id = p_show_id and status = 'booked'),
      'held_seats', (select count(*) from public.show_seats where show_id = p_show_id and status = 'held' and hold_expires_at > now()),
      'available_seats', (select count(*) from public.show_seats where show_id = p_show_id and (status = 'available' or (status = 'held' and hold_expires_at <= now()))),
      'total_bookings', (select count(*) from public.bookings where show_id = p_show_id),
      'amount_collected', (select coalesce(sum(pay.amount), 0) from public.payments pay join public.bookings b on b.id = pay.booking_id where b.show_id = p_show_id and b.status = 'confirmed')
    ),
    'booked_seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', s.row_label || s.seat_number::text,
        'user_name', coalesce(p.full_name, 'Guest'),
        'user_email', coalesce(u.email, ''),
        'booking_id', b.id,
        'booked_at', coalesce(pay.paid_at, b.created_at),
        'amount', coalesce(pay.amount / nullif(seat_totals.seat_count, 0), sh.ticket_price)
      ) order by coalesce(pay.paid_at, b.created_at) desc)
      from public.show_seats ss
      join public.seats s on s.id = ss.seat_id
      join public.bookings b on b.id = ss.booking_id
      left join public.profiles p on p.id = b.user_id
      left join auth.users u on u.id = b.user_id
      join public.shows sh on sh.id = b.show_id
      left join public.payments pay on pay.booking_id = b.id
      cross join lateral (select count(*)::numeric as seat_count from public.show_seats x where x.booking_id = b.id and x.status = 'booked') seat_totals
      where ss.show_id = p_show_id and ss.status = 'booked'
    ), '[]'::jsonb),
    'held_seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'show_name', m.title,
        'show_time', sh.starts_at,
        'seat', s.row_label || s.seat_number::text,
        'user_name', coalesce(p.full_name, 'Guest'),
        'user_email', coalesce(u.email, ''),
        'hold_expires_at', ss.hold_expires_at
      ) order by ss.hold_expires_at asc)
      from public.show_seats ss
      join public.seats s on s.id = ss.seat_id
      join public.bookings b on b.id = ss.booking_id
      left join public.profiles p on p.id = b.user_id
      left join auth.users u on u.id = b.user_id
      join public.shows sh on sh.id = ss.show_id
      join public.movies m on m.id = sh.movie_id
      where ss.show_id = p_show_id and ss.status = 'held' and ss.hold_expires_at > now()
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


-- 6.1 Hold seats (all-or-nothing, 5 minutes)
create or replace function hold_seats(p_show_id uuid, p_seat_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking uuid;
  v_updated int;
  v_price numeric;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if p_seat_ids is null or cardinality(p_seat_ids) = 0 or cardinality(p_seat_ids) > 6
     or cardinality(p_seat_ids) <> (select count(distinct x) from unnest(p_seat_ids) x) then
    raise exception 'Select between 1 and 6 seats';
  end if;

  -- lock the chosen rows in a fixed order to avoid deadlocks
  perform 1 from show_seats
   where show_id = p_show_id and seat_id = any(p_seat_ids)
   order by seat_id
   for update;

  select ticket_price into v_price from shows where id = p_show_id;
  if v_price is null then
    raise exception 'Show not found';
  end if;

  insert into bookings (user_id, show_id, total_amount, expires_at)
  values (v_user_id, p_show_id, v_price * cardinality(p_seat_ids), now() + interval '5 minutes')
  returning id into v_booking;

  update show_seats
     set status = 'held', booking_id = v_booking,
         hold_expires_at = now() + interval '5 minutes'
   where show_id = p_show_id
     and seat_id = any(p_seat_ids)
     and (status = 'available'
          or (status = 'held' and hold_expires_at < now()));
  get diagnostics v_updated = row_count;

  if v_updated <> cardinality(p_seat_ids) then
    raise exception 'Someone just took one of these seats';
  end if;

  return v_booking;
end;
$$;

-- 6.2 Pay and confirm (checks the hold is still valid)
create or replace function pay_booking(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount numeric;
  v_seats int;
  v_booked int;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select total_amount into v_amount from bookings
   where id = p_booking_id and user_id = v_user_id
     and status = 'pending' and expires_at > now()
   for update;

  if not found then
    raise exception 'Booking expired or not found';
  end if;

  select count(*) into v_seats from show_seats
   where booking_id = p_booking_id and status = 'held' and hold_expires_at > now();

  if v_seats = 0 then raise exception 'Seats are no longer held'; end if;

  update show_seats set status = 'booked', hold_expires_at = null
   where booking_id = p_booking_id and status = 'held' and hold_expires_at > now();
  get diagnostics v_booked = row_count;

  if v_booked <> v_seats then
    raise exception 'Seats are no longer held';
  end if;

  insert into payments (booking_id, amount) values (p_booking_id, v_amount);
  update bookings set status = 'confirmed' where id = p_booking_id;
  return 'confirmed';
end;
$$;

-- 6.3 Release expired holds (runs every minute or on-demand)
create or replace function release_expired_holds()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  update show_seats
     set status = 'available', booking_id = null, hold_expires_at = null
   where status = 'held' and hold_expires_at < now();
  get diagnostics v_count = row_count;

  update bookings set status = 'expired'
   where status = 'pending' and expires_at < now();

  return v_count;
end;
$$;

-- 6.4 Helper Function: Get Complete Seat Layout and Status for a Show
create or replace function get_show_seat_map(p_show_id uuid)
returns table (
  seat_id uuid,
  row_label text,
  seat_number int,
  tier text,
  status seat_status,
  hold_expires_at timestamptz,
  is_held_by_me boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_my_uid uuid := auth.uid();
begin
  -- First release any expired holds on the fly to guarantee real-time freshness
  perform release_expired_holds();

  return query
  select
    s.id as seat_id,
    s.row_label,
    s.seat_number,
    coalesce(s.tier, 'Standard') as tier,
    ss.status,
    ss.hold_expires_at,
    case
      when ss.status = 'held' and b.user_id = v_my_uid then true
      else false
    end as is_held_by_me
  from show_seats ss
  join seats s on s.id = ss.seat_id
  left join bookings b on b.id = ss.booking_id
  where ss.show_id = p_show_id
  order by s.row_label asc, s.seat_number asc;
end;
$$;

-- 6.5 Helper Function: Get Booking Details for Confirmation Pass
create or replace function get_booking_details(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result json;
begin
  select json_build_object(
    'booking_id', b.id,
    'show_id', b.show_id,
    'status', b.status,
    'total_amount', b.total_amount,
    'expires_at', b.expires_at,
    'created_at', b.created_at,
    'movie_title', m.title,
    'movie_language', m.language,
    'screen_name', sc.name,
    'show_time', sh.starts_at,
    'ticket_price', sh.ticket_price,
    'seats', (
      select coalesce(json_agg(
        json_build_object(
          'seat_id', s.id,
          'row_label', s.row_label,
          'seat_number', s.seat_number,
          'tier', s.tier
        ) order by s.row_label, s.seat_number
      ), '[]'::json)
      from show_seats ss
      join seats s on s.id = ss.seat_id
      where ss.booking_id = b.id
    ),
    'payment', (
      select json_build_object('amount', p.amount, 'paid_at', p.paid_at)
      from payments p
      where p.booking_id = b.id
      limit 1
    )
  ) into v_result
  from bookings b
  join shows sh on sh.id = b.show_id
  join movies m on m.id = sh.movie_id
  join screens sc on sc.id = sh.screen_id
  where b.id = p_booking_id and b.user_id = auth.uid();

  return v_result;
end;
$$;

-- 7. ROW LEVEL SECURITY (RLS)
alter table public.profiles enable row level security;
alter table public.movies enable row level security;
alter table public.screens enable row level security;
alter table public.seats enable row level security;
alter table public.shows enable row level security;
alter table public.show_seats enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

create policy "Profiles are viewable by owner" on public.profiles for select using (auth.uid() = id);
create policy "Profiles can be updated by owner" on public.profiles for update using (auth.uid() = id);
create policy "Movies are viewable by everyone" on public.movies for select to public using (true);
drop policy if exists "Admins can insert movies" on public.movies;
create policy "Admins can insert movies" on public.movies for insert to authenticated with check (public.is_admin());
create policy "Screens are viewable by everyone" on public.screens for select to public using (true);
create policy "Seats are viewable by everyone" on public.seats for select to public using (true);
create policy "Shows are viewable by everyone" on public.shows for select to public using (true);
create policy "Show seats are viewable by everyone" on public.show_seats for select to public using (true);
create policy "Users can view own bookings" on public.bookings for select to authenticated using (auth.uid() = user_id);
create policy "Users can view own payments" on public.payments for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = payments.booking_id and b.user_id = auth.uid())
);
create policy "Admins can view all profiles" on public.profiles for select to authenticated using (public.is_admin());
create policy "Admins can view all bookings" on public.bookings for select to authenticated using (public.is_admin());
create policy "Admins can view all show seats" on public.show_seats for select to authenticated using (public.is_admin());
create policy "Admins can view all payments" on public.payments for select to authenticated using (public.is_admin());
create policy "Admins can insert cinemas" on public.screens for insert to authenticated with check (public.is_admin());
create policy "Admins can update cinemas" on public.screens for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete cinemas" on public.screens for delete to authenticated using (public.is_admin());
create policy "Admins can insert shows" on public.shows for insert to authenticated with check (public.is_admin());
create policy "Admins can update shows" on public.shows for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.movies, public.screens, public.seats, public.shows, public.show_seats to anon, authenticated;
grant insert on public.movies to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.bookings, public.payments to authenticated;
grant insert, update, delete on public.screens to authenticated;
grant insert, update on public.shows to authenticated;
revoke all on function public.hold_seats(uuid, uuid[]) from public, anon;
revoke all on function public.pay_booking(uuid) from public, anon;
revoke all on function public.release_expired_holds() from public, anon;
revoke all on function public.get_show_seat_map(uuid) from public, anon;
revoke all on function public.get_booking_details(uuid) from public, anon;
grant execute on function public.hold_seats(uuid, uuid[]) to authenticated;
grant execute on function public.pay_booking(uuid) to authenticated;
grant execute on function public.release_expired_holds() to authenticated;
grant execute on function public.get_show_seat_map(uuid) to authenticated;
grant execute on function public.get_booking_details(uuid) to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_show_data(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_show_data(uuid) to authenticated;

-- Block Direct Client Writes (Security Definer RPC only)
revoke insert, update, delete on public.show_seats from anon, authenticated;
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;

-- Real-time Publication (PRD Section 4.6)
do $$ begin
  alter publication supabase_realtime add table public.show_seats;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.screens;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.movies;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.shows;
exception when duplicate_object then null; end $$;

create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('release-holds');
exception when others then null; end $$;
select cron.schedule('release-holds', '* * * * *', 'select public.release_expired_holds()');

-- 8. SEED DATA
insert into public.screens (id, name, screen_type)
values
  ('11111111-1111-1111-1111-111111111111', 'Audi 1 - Dolby Atmos', 'Dolby Atmos 7.1'),
  ('22222222-2222-2222-2222-222222222222', 'Audi 2 - IMAX Laser', 'IMAX 4K Laser')
on conflict (name) do update set screen_type = excluded.screen_type;

do $$
declare
  v_scr1 uuid := '11111111-1111-1111-1111-111111111111';
  v_scr2 uuid := '22222222-2222-2222-2222-222222222222';
  r text;
  n int;
  tier text;
begin
  foreach r in array array['A', 'B', 'C', 'D', 'E', 'F'] loop
    tier := case when r in ('A', 'B') then 'Recliner' when r in ('C', 'D') then 'Prime' else 'Classic' end;
    for n in 1..case when r in ('A', 'B') then 8 else 10 end loop
      insert into public.seats (screen_id, row_label, seat_number, tier)
      values (v_scr1, r, n, tier)
      on conflict (screen_id, row_label, seat_number) do nothing;
    end loop;
  end loop;

  foreach r in array array['A', 'B', 'C', 'D', 'E', 'F'] loop
    tier := case when r in ('A', 'B') then 'Recliner' when r in ('C', 'D') then 'Prime' else 'Classic' end;
    for n in 1..case when r in ('A', 'B') then 8 else 10 end loop
      insert into public.seats (screen_id, row_label, seat_number, tier)
      values (v_scr2, r, n, tier)
      on conflict (screen_id, row_label, seat_number) do nothing;
    end loop;
  end loop;
end $$;

insert into public.movies (id, title, language, duration_min, genre, rating, poster_url, synopsis)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Dune: Part Two',
    'English',
    166,
    'Sci-Fi / Action',
    'UA',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
    'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Oppenheimer',
    'English',
    180,
    'Biography / Drama',
    'A',
    'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=800&auto=format&fit=crop&q=80',
    'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Interstellar',
    'English',
    169,
    'Sci-Fi / Adventure',
    'UA',
    'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=800&auto=format&fit=crop&q=80',
    'When Earth becomes uninhabitable in the future, a farmer and ex-NASA pilot is tasked to pilot a spacecraft along with a team of researchers.'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'Spider-Man: Across the Spider-Verse',
    'English',
    140,
    'Animation / Action',
    'U',
    'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=800&auto=format&fit=crop&q=80',
    'Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.'
  )
on conflict (id) do update set title = excluded.title;

insert into public.shows (id, movie_id, screen_id, starts_at, ticket_price)
values
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', (current_date + interval '14 hours'), 280.00),
  ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', (current_date + interval '18 hours 30 minutes'), 320.00),
  ('22220000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', (current_date + interval '15 hours'), 350.00),
  ('22220000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', (current_date + interval '19 hours 45 minutes'), 400.00),
  ('11110000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', (current_date + interval '1 day 16 hours'), 300.00),
  ('22220000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', (current_date + interval '1 day 13 hours 30 minutes'), 250.00)
on conflict (screen_id, starts_at) do nothing;

insert into public.show_seats (show_id, seat_id, status)
select sh.id, s.id, 'available'
from public.shows sh
join public.seats s on s.screen_id = sh.screen_id
on conflict (show_id, seat_id) do nothing;
