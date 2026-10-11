-- Give every newly added cinema a default physical seat map. The trigger is
-- SECURITY DEFINER because authenticated clients cannot insert into seats.
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

-- Backfill screens added before the trigger existed, without changing halls
-- that already have a seat layout.
insert into public.seats (screen_id, row_label, seat_number, tier)
select screen.id, layout.row_label, seat_number, layout.tier
from public.screens as screen
cross join (values
  ('A', 8, 'Recliner'), ('B', 8, 'Recliner'),
  ('C', 10, 'Prime'), ('D', 10, 'Prime'),
  ('E', 10, 'Classic'), ('F', 10, 'Classic')
) as layout(row_label, seat_count, tier)
cross join lateral generate_series(1, layout.seat_count) as seat_numbers(seat_number)
where not exists (
  select 1 from public.seats existing_seat where existing_seat.screen_id = screen.id
)
on conflict (screen_id, row_label, seat_number) do nothing;

-- Add any missing per-show seat states for existing shows; existing holds and
-- bookings are preserved because of the conflict handling.
insert into public.show_seats (show_id, seat_id, status)
select sh.id, seat.id, 'available'
from public.shows as sh
join public.seats as seat on seat.screen_id = sh.screen_id
on conflict (show_id, seat_id) do nothing;
