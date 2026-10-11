-- ==============================================================
-- CINEMA HALL TICKET BOOKING SYSTEM - DBMS VERIFICATION & TEST SUITE
-- Tests for ACID Properties, Concurrency, and Constraints
-- ==============================================================

-- --------------------------------------------------------------
-- TEST 1: All-or-nothing hold transaction (Atomicity)
-- --------------------------------------------------------------
-- Scenario: User tries to hold 3 seats, but one is already booked.
-- Expected outcome: Transaction rolls back, 0 seats held.

do $$
declare
  v_show_id uuid := '11110000-0000-0000-0000-000000000001';
  v_seat_avail1 uuid;
  v_seat_avail2 uuid;
  v_seat_taken uuid;
  v_err text;
begin
  -- Select 2 available seats and 1 booked seat
  select seat_id into v_seat_avail1 from show_seats where show_id = v_show_id and status = 'available' limit 1;
  select seat_id into v_seat_avail2 from show_seats where show_id = v_show_id and status = 'available' and seat_id <> v_seat_avail1 limit 1;
  select seat_id into v_seat_taken from show_seats where show_id = v_show_id and status = 'booked' limit 1;

  begin
    perform hold_seats(v_show_id, array[v_seat_avail1, v_seat_avail2, v_seat_taken]);
    raise notice 'FAIL: Expected exception was not raised';
  exception
    when others then
      v_err := sqlerrm;
      raise notice 'PASS Test 1: Atomicity verified. Rolled back with error: "%"', v_err;
  end;

  -- Verify that v_seat_avail1 is STILL available (no partial hold)
  assert (select status from show_seats where show_id = v_show_id and seat_id = v_seat_avail1) = 'available',
    'FAIL: Seat status was modified despite rollback!';
  raise notice 'PASS Test 1: Verified that no seats were partially held.';
end $$;

-- --------------------------------------------------------------
-- TEST 2: Successful hold & 5-minute hold validation
-- --------------------------------------------------------------
do $$
declare
  v_show_id uuid := '11110000-0000-0000-0000-000000000001';
  v_seat1 uuid;
  v_seat2 uuid;
  v_booking_id uuid;
  v_expires timestamptz;
begin
  select seat_id into v_seat1 from show_seats where show_id = v_show_id and status = 'available' order by seat_id limit 1;
  select seat_id into v_seat2 from show_seats where show_id = v_show_id and status = 'available' and seat_id <> v_seat1 order by seat_id limit 1;

  v_booking_id := hold_seats(v_show_id, array[v_seat1, v_seat2]);
  raise notice 'PASS Test 2: Held seats successfully. Booking ID: %', v_booking_id;

  select expires_at into v_expires from bookings where id = v_booking_id;
  assert v_expires > now() + interval '4 minutes 50 seconds', 'FAIL: Expiry timer incorrect';
  raise notice 'PASS Test 2: Hold timer correctly set to 5 minutes (Expires at: %)', v_expires;
end $$;

-- --------------------------------------------------------------
-- TEST 3: Payment within hold window (Consistency & Durability)
-- --------------------------------------------------------------
do $$
declare
  v_show_id uuid := '11110000-0000-0000-0000-000000000001';
  v_seat uuid;
  v_booking_id uuid;
  v_result text;
begin
  select seat_id into v_seat from show_seats where show_id = v_show_id and status = 'available' limit 1;
  v_booking_id := hold_seats(v_show_id, array[v_seat]);

  -- Execute payment
  v_result := pay_booking(v_booking_id);
  assert v_result = 'confirmed', 'FAIL: pay_booking did not confirm';

  -- Check show_seats status is now 'booked'
  assert (select status from show_seats where show_id = v_show_id and seat_id = v_seat) = 'booked',
    'FAIL: Seat was not updated to booked';

  -- Check payment row exists
  assert (select count(*) from payments where booking_id = v_booking_id) = 1,
    'FAIL: Payment record was not created';

  raise notice 'PASS Test 3: Payment processed, seats booked, payment ledger verified.';
end $$;

-- --------------------------------------------------------------
-- TEST 4: Pay after expiry failure
-- --------------------------------------------------------------
do $$
declare
  v_show_id uuid := '11110000-0000-0000-0000-000000000001';
  v_seat uuid;
  v_booking_id uuid;
  v_err text;
begin
  select seat_id into v_seat from show_seats where show_id = v_show_id and status = 'available' limit 1;
  v_booking_id := hold_seats(v_show_id, array[v_seat]);

  -- Force expire booking
  update bookings set expires_at = now() - interval '1 second' where id = v_booking_id;
  update show_seats set hold_expires_at = now() - interval '1 second' where booking_id = v_booking_id;

  begin
    perform pay_booking(v_booking_id);
    raise notice 'FAIL: Payment succeeded on expired booking';
  exception
    when others then
      v_err := sqlerrm;
      raise notice 'PASS Test 4: Expired booking payment rejected as expected: "%"', v_err;
  end;
end $$;

-- --------------------------------------------------------------
-- TEST 5: Automatic hold release cleanup
-- --------------------------------------------------------------
do $$
declare
  v_released int;
begin
  v_released := release_expired_holds();
  raise notice 'PASS Test 5: release_expired_holds() executed cleanly. % expired seats freed.', v_released;
end $$;
