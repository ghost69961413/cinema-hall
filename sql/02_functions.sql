-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - CORE FUNCTIONS
-- ==============================================================

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
