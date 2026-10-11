-- Run this migration in the Supabase SQL Editor for an existing project.
-- The trigger must insert show_seats even though client writes are revoked.
create or replace function public.populate_show_seats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.show_seats (show_id, seat_id, status)
  select new.id, s.id, 'available'
  from public.seats s
  where s.screen_id = new.screen_id
  on conflict (show_id, seat_id) do nothing;
  return new;
end;
$$;

-- Existing trigger continues to call the replaced function.

-- Admins may delete catalog movies. The schema cascades this deletion to
-- their shows, show_seats, bookings, and payments.
drop policy if exists "Admins can delete movies" on public.movies;
create policy "Admins can delete movies"
  on public.movies for delete to authenticated
  using (public.is_admin());
grant delete on public.movies to authenticated;
