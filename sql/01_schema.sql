-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - DATABASE SCHEMA
-- DBMS Course Project
-- Stack: Supabase (PostgreSQL 15+)
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

-- 3. PROFILES (Linked with Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer', 'admin'));

-- 4. MOVIES
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

-- 5. SCREENS
create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  screen_type text default 'Standard'
);

-- 6. PHYSICAL SEATS
create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references public.screens(id) on delete cascade,
  row_label text not null,
  seat_number int not null,
  tier text default 'Standard', -- e.g. Recliner, Prime, Classic
  unique (screen_id, row_label, seat_number)
);

-- 7. SHOWS
create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete cascade,
  screen_id uuid not null references public.screens(id) on delete cascade,
  starts_at timestamptz not null,
  ticket_price numeric(8,2) not null check (ticket_price > 0),
  unique (screen_id, starts_at)
);

-- 8. BOOKINGS
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  status booking_status not null default 'pending',
  total_amount numeric(10,2) not null check (total_amount >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 9. SHOW SEATS (State table per seat per show)
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

-- 10. PAYMENTS
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  paid_at timestamptz not null default now()
);

-- 11. INDEXES
create index if not exists idx_show_seats_held on public.show_seats (hold_expires_at)
  where status = 'held';

create index if not exists idx_shows_starts_at on public.shows (starts_at);
create index if not exists idx_bookings_user_id on public.bookings (user_id);
create index if not exists idx_seats_screen on public.seats (screen_id);

-- 12. DEFAULT SEAT MAP FOR EVERY NEW CINEMA SCREEN
create or replace function public.populate_screen_seats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.seats (screen_id, row_label, seat_number, tier)
  select new.id, layout.row_label, seat_number, layout.tier
  from (values
    ('A', 8, 'Recliner'), ('B', 8, 'Recliner'),
    ('C', 10, 'Prime'), ('D', 10, 'Prime'),
    ('E', 10, 'Classic'), ('F', 10, 'Classic')
  ) as layout(row_label, seat_count, tier)
  cross join lateral generate_series(1, layout.seat_count) as seat_numbers(seat_number);
  return new;
end;
$$;

drop trigger if exists trg_populate_screen_seats on public.screens;
create trigger trg_populate_screen_seats
  after insert on public.screens
  for each row execute function public.populate_screen_seats();

-- 13. AUTOMATIC PROFILE CREATION TRIGGER (SUPABASE AUTH)
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

-- 13. AUTOMATIC SHOW_SEATS GENERATION TRIGGER
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
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_populate_show_seats on public.shows;
create trigger trg_populate_show_seats
  after insert on public.shows
  for each row execute procedure public.populate_show_seats();
