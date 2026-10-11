-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - SEED DATA
-- ==============================================================

-- 1. Create a Demo Profile (for testing if needed)
insert into public.profiles (id, full_name)
values ('00000000-0000-0000-0000-000000000001', 'Demo Cinephile')
on conflict (id) do nothing;

-- 2. Insert Screens
insert into public.screens (id, name, screen_type)
values
  ('11111111-1111-1111-1111-111111111111', 'Audi 1 - Dolby Atmos', 'Dolby Atmos 7.1'),
  ('22222222-2222-2222-2222-222222222222', 'Audi 2 - IMAX Laser', 'IMAX 4K Laser')
on conflict (name) do update
set screen_type = excluded.screen_type;

-- 3. Insert Physical Seats for Audi 1 and Audi 2
-- Rows: A, B (Recliner, 8 seats)
-- Rows: C, D (Prime, 10 seats)
-- Rows: E, F (Classic, 10 seats)

do $$
declare
  v_scr1 uuid := '11111111-1111-1111-1111-111111111111';
  v_scr2 uuid := '22222222-2222-2222-2222-222222222222';
  r text;
  n int;
  tier text;
begin
  -- Audi 1 seats
  foreach r in array array['A', 'B', 'C', 'D', 'E', 'F'] loop
    tier := case
      when r in ('A', 'B') then 'Recliner'
      when r in ('C', 'D') then 'Prime'
      else 'Classic'
    end;
    for n in 1..case when r in ('A', 'B') then 8 else 10 end loop
      insert into public.seats (screen_id, row_label, seat_number, tier)
      values (v_scr1, r, n, tier)
      on conflict (screen_id, row_label, seat_number) do nothing;
    end loop;
  end loop;

  -- Audi 2 seats
  foreach r in array array['A', 'B', 'C', 'D', 'E', 'F'] loop
    tier := case
      when r in ('A', 'B') then 'Recliner'
      when r in ('C', 'D') then 'Prime'
      else 'Classic'
    end;
    for n in 1..case when r in ('A', 'B') then 8 else 10 end loop
      insert into public.seats (screen_id, row_label, seat_number, tier)
      values (v_scr2, r, n, tier)
      on conflict (screen_id, row_label, seat_number) do nothing;
    end loop;
  end loop;
end $$;

-- 4. Insert Movies
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
on conflict (id) do update
set title = excluded.title,
    duration_min = excluded.duration_min,
    poster_url = excluded.poster_url;

-- 5. Insert Shows (for today and tomorrow)
insert into public.shows (id, movie_id, screen_id, starts_at, ticket_price)
values
  (
    '11110000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    (current_date + interval '14 hours'),
    280.00
  ),
  (
    '11110000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    (current_date + interval '18 hours 30 minutes'),
    320.00
  ),
  (
    '22220000-0000-0000-0000-000000000001',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    (current_date + interval '15 hours'),
    350.00
  ),
  (
    '22220000-0000-0000-0000-000000000002',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    (current_date + interval '19 hours 45 minutes'),
    400.00
  ),
  (
    '11110000-0000-0000-0000-000000000003',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111',
    (current_date + interval '1 day 16 hours'),
    300.00
  ),
  (
    '22220000-0000-0000-0000-000000000003',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '22222222-2222-2222-2222-222222222222',
    (current_date + interval '1 day 13 hours 30 minutes'),
    250.00
  )
on conflict (screen_id, starts_at) do nothing;

-- 6. Guarantee show_seats rows for all shows
insert into public.show_seats (show_id, seat_id, status)
select sh.id, s.id, 'available'
from public.shows sh
join public.seats s on s.screen_id = sh.screen_id
on conflict (show_id, seat_id) do nothing;

-- 7. Pre-seed a few booked seats for realistic demo presentation
do $$
declare
  v_show_id uuid := '11110000-0000-0000-0000-000000000001';
  v_demo_user uuid := '00000000-0000-0000-0000-000000000001';
  v_booking uuid;
  v_seat1 uuid;
  v_seat2 uuid;
begin
  select id into v_seat1 from seats where screen_id = '11111111-1111-1111-1111-111111111111' and row_label = 'C' and seat_number = 5;
  select id into v_seat2 from seats where screen_id = '11111111-1111-1111-1111-111111111111' and row_label = 'C' and seat_number = 6;

  if v_seat1 is not null and v_seat2 is not null then
    insert into bookings (id, user_id, show_id, status, total_amount, expires_at)
    values ('99999999-9999-9999-9999-999999999999', v_demo_user, v_show_id, 'confirmed', 560.00, now() + interval '10 days')
    on conflict (id) do nothing
    returning id into v_booking;

    if v_booking is not null then
      insert into payments (booking_id, amount)
      values (v_booking, 560.00)
      on conflict (booking_id) do nothing;

      update show_seats
         set status = 'booked', booking_id = v_booking, hold_expires_at = null
       where show_id = v_show_id and seat_id in (v_seat1, v_seat2);
    end if;
  end if;
end $$;
