-- Run once on an existing database to add admin dashboard access.
-- In this project, public.screens is the cinema list (name, screen_type).

alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer', 'admin'));

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

drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can view all bookings" on public.bookings;
drop policy if exists "Admins can view all show seats" on public.show_seats;
drop policy if exists "Admins can view all payments" on public.payments;
drop policy if exists "Admins can insert cinemas" on public.screens;
drop policy if exists "Admins can insert movies" on public.movies;
drop policy if exists "Admins can update cinemas" on public.screens;
drop policy if exists "Admins can delete cinemas" on public.screens;

create policy "Admins can view all profiles" on public.profiles for select to authenticated using (public.is_admin());
create policy "Admins can view all bookings" on public.bookings for select to authenticated using (public.is_admin());
create policy "Admins can view all show seats" on public.show_seats for select to authenticated using (public.is_admin());
create policy "Admins can view all payments" on public.payments for select to authenticated using (public.is_admin());
create policy "Admins can insert movies" on public.movies for insert to authenticated with check (public.is_admin());
create policy "Admins can insert cinemas" on public.screens for insert to authenticated with check (public.is_admin());
create policy "Admins can update cinemas" on public.screens for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete cinemas" on public.screens for delete to authenticated using (public.is_admin());

-- Admins can add shows and update their movie, time, and ticket price from the dashboard.
drop policy if exists "Admins can insert shows" on public.shows;
create policy "Admins can insert shows" on public.shows for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins can update shows" on public.shows;
create policy "Admins can update shows" on public.shows for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to authenticated;
grant insert on public.movies to authenticated;
grant insert, update, delete on public.screens to authenticated;
grant insert, update on public.shows to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_show_data(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_show_data(uuid) to authenticated;

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

-- Promote one account after it has signed up:
-- update public.profiles set role = 'admin' where id = '<user id>';
