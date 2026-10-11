-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - ROW LEVEL SECURITY (RLS)
-- ==============================================================

-- 1. Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.movies enable row level security;
alter table public.screens enable row level security;
alter table public.seats enable row level security;
alter table public.shows enable row level security;
alter table public.show_seats enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

-- 2. Drop existing policies if any
drop policy if exists "Profiles are viewable by owner" on public.profiles;
drop policy if exists "Profiles can be updated by owner" on public.profiles;
drop policy if exists "Movies are viewable by everyone" on public.movies;
drop policy if exists "Admins can insert movies" on public.movies;
drop policy if exists "Admins can delete movies" on public.movies;
drop policy if exists "Admins can update movies" on public.movies;
drop policy if exists "Screens are viewable by everyone" on public.screens;
drop policy if exists "Seats are viewable by everyone" on public.seats;
drop policy if exists "Shows are viewable by everyone" on public.shows;
drop policy if exists "Show seats are viewable by everyone" on public.show_seats;
drop policy if exists "Authenticated profiles may be created" on public.profiles;
drop policy if exists "Users can view own bookings" on public.bookings;
drop policy if exists "Users can insert own bookings" on public.bookings;
drop policy if exists "Users can view own payments" on public.payments;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can view all bookings" on public.bookings;
drop policy if exists "Admins can view all show seats" on public.show_seats;
drop policy if exists "Admins can view all payments" on public.payments;
drop policy if exists "Admins can insert cinemas" on public.screens;
drop policy if exists "Admins can update cinemas" on public.screens;
drop policy if exists "Admins can delete cinemas" on public.screens;

-- 3. Profiles Policies
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles can be updated by owner"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Authenticated profiles may be created"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

-- 4. Public Catalog Policies (Read-only for movies, screens, seats, shows, show_seats)
create policy "Movies are viewable by everyone"
  on public.movies for select
  to public
  using (true);

create policy "Admins can insert movies" on public.movies
  for insert to authenticated with check (public.is_admin());
create policy "Admins can delete movies" on public.movies
  for delete to authenticated using (public.is_admin());
create policy "Admins can update movies" on public.movies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Screens are viewable by everyone"
  on public.screens for select
  to public
  using (true);

create policy "Seats are viewable by everyone"
  on public.seats for select
  to public
  using (true);

create policy "Shows are viewable by everyone"
  on public.shows for select
  to public
  using (true);

create policy "Show seats are viewable by everyone"
  on public.show_seats for select
  to public
  using (true);

-- 5. Bookings Policies (Restricted to authenticated owner)
create policy "Users can view own bookings"
  on public.bookings for select
  to authenticated
  using (auth.uid() = user_id);

-- 6. Payments Policies (Restricted to booking owner)
create policy "Users can view own payments"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.user_id = auth.uid()
    )
  );

create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using (public.is_admin());
create policy "Admins can view all bookings" on public.bookings
  for select to authenticated using (public.is_admin());
create policy "Admins can view all show seats" on public.show_seats
  for select to authenticated using (public.is_admin());
create policy "Admins can view all payments" on public.payments
  for select to authenticated using (public.is_admin());
create policy "Admins can insert cinemas" on public.screens
  for insert to authenticated with check (public.is_admin());
create policy "Admins can update cinemas" on public.screens
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete cinemas" on public.screens
  for delete to authenticated using (public.is_admin());

-- 7. Grant Permissions to anon and authenticated
grant usage on schema public to anon, authenticated;
grant select on public.movies to anon, authenticated;
grant insert on public.movies to authenticated;
grant update on public.movies to authenticated;
grant delete on public.movies to authenticated;
grant select on public.screens to anon, authenticated;
grant select on public.seats to anon, authenticated;
grant select on public.shows to anon, authenticated;
grant select on public.show_seats to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.bookings to authenticated;
grant select on public.payments to authenticated;
grant insert, update, delete on public.screens to authenticated;

revoke all on function public.hold_seats(uuid, uuid[]) from public, anon;
revoke all on function public.pay_booking(uuid) from public, anon;
revoke all on function public.release_expired_holds() from public, anon;
revoke all on function public.get_show_seat_map(uuid) from public, anon;
revoke all on function public.get_booking_details(uuid) from public, anon;
grant execute on function public.hold_seats(uuid, uuid[]) to authenticated;
grant execute on function public.pay_booking(uuid) to authenticated;
grant execute on function public.release_expired_holds() to authenticated;
grant execute on function public.get_show_seat_map(uuid) to authenticated;
-- Seat maps are public for browsing before sign-in; the function exposes only seat state.
grant execute on function public.get_show_seat_map(uuid) to anon;
grant execute on function public.get_booking_details(uuid) to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_show_data(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_show_data(uuid) to authenticated;

-- 8. Block Direct Client Writes (Security Definer RPC only)
revoke insert, update, delete on public.show_seats from anon, authenticated;
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;

-- 9. Real-time Publication (PRD Section 4.6)
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
