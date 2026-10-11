==============================================================
PRODUCT REQUIREMENTS DOCUMENT
Cinema Hall Ticket Booking System
==============================================================
Project type : DBMS course project
Backend      : Supabase (PostgreSQL)
UI style     : District-app inspired
Version      : 1.0

--------------------------------------------------------------
1. PROJECT OVERVIEW
--------------------------------------------------------------
This is a cinema hall ticket booking system where the database,
not the application, guarantees that a seat is never sold twice.

Problem:
When many users book at once, two people can pick the same seat,
and users who select seats but never pay keep those seats blocked
for everyone else.

Solution:
The user picks seats on a District-style seat map. The chosen
seats are held for 5 minutes. If payment is recorded in time, the
seats become booked. If not, the database releases them for all
users.

Stack:
Supabase (PostgreSQL, Auth, pg_cron) with a simple web frontend.

--------------------------------------------------------------
2. TEAM AND SUBMISSION DETAILS
--------------------------------------------------------------
The group has exactly 4 members. One representative submits the
project submission form by 3 August, 5:00 PM.
Form link: https://forms.gle/XvNRRY1PtWCRfRi87

 #  | Member name | Roll number | Role in project
----+-------------+-------------+----------------
 1  |             |             |
 2  |             |             |
 3  |             |             |
 4  |             |             |

Before submitting:
[ ] Project title and summary (sections 1 and 3)
[ ] PO mapping (section 7)
[ ] PSO mapping (section 8)
[ ] SDG number(s) with justification (section 9)

--------------------------------------------------------------
3. SCOPE
--------------------------------------------------------------
The project covers only the features needed to show seat booking
with a temporary hold and a payment check.

In scope:
1. User sign up and login (Supabase Auth).
2. View movies and their shows (time, screen, price).
3. District-style seat map showing available, held and booked
   seats.
4. Select up to 6 seats and hold them for 5 minutes.
5. Record payment for the held seats (simulated Pay button,
   stored in the database).
6. Paid in time: seats become booked. Not paid: seats are
   released automatically.
7. Booking confirmation screen.

Out of scope:
Admin panel (movies and shows are added through seed SQL), real
payment gateway, live seat updates, refunds, food ordering,
coupons, QR tickets.

--------------------------------------------------------------
4. SEAT BOOKING LOGIC
--------------------------------------------------------------
Every seat of a show is in exactly one of three states, and only
the database changes it.

State      | Meaning                          | Changes to
-----------+----------------------------------+--------------------------
available  | Free for anyone                  | held, when a user proceeds
           |                                  | to pay
held       | Reserved for one user for 5 min  | booked if paid in time,
           |                                  | available if not
booked     | Payment confirmed                | Final

Booking flow:
1. User selects seats and presses Proceed.
2. The database tries to hold all chosen seats in one
   transaction. If any seat is already taken, nothing is held.
3. The user sees a 5-minute countdown and pays.
4. Payment recorded before expiry: seats become "booked" and the
   booking is "confirmed".
5. No payment by expiry: a scheduled job sets the seats back to
   "available" and the booking to "expired".

--------------------------------------------------------------
5. DATABASE DESIGN
--------------------------------------------------------------
Eight tables for one cinema hall with several screens. The table
show_seats holds one row per seat per show and stores the live
seat state.

create type seat_status as enum ('available', 'held', 'booked');
create type booking_status as enum ('pending', 'confirmed', 'expired');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null
);

create table movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  language text not null,
  duration_min int not null check (duration_min > 0)
);

create table screens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table seats (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references screens(id) on delete cascade,
  row_label text not null,
  seat_number int not null,
  unique (screen_id, row_label, seat_number)
);

create table shows (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references movies(id),
  screen_id uuid not null references screens(id),
  starts_at timestamptz not null,
  ticket_price numeric(8,2) not null check (ticket_price > 0),
  unique (screen_id, starts_at)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  show_id uuid not null references shows(id),
  status booking_status not null default 'pending',
  total_amount numeric(10,2) not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table show_seats (
  show_id uuid not null references shows(id) on delete cascade,
  seat_id uuid not null references seats(id),
  status seat_status not null default 'available',
  booking_id uuid references bookings(id),
  hold_expires_at timestamptz,
  primary key (show_id, seat_id),
  check (status = 'available' or booking_id is not null),
  check (status <> 'held' or hold_expires_at is not null)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  amount numeric(10,2) not null,
  paid_at timestamptz not null default now()
);

create index idx_show_seats_held on show_seats (hold_expires_at)
  where status = 'held';

Key points:
- The composite primary key (show_id, seat_id) allows only one
  row per seat per show.
- The CHECK constraints block impossible states, such as a held
  seat with no booking or expiry time.
- A payment row linked to a booking is the proof that the user
  paid.

--------------------------------------------------------------
6. CORE DATABASE FUNCTIONS
--------------------------------------------------------------
Three PostgreSQL functions carry the whole booking logic. The
frontend calls the first two through Supabase RPC.

6.1 Hold seats (all-or-nothing, 5 minutes)

create or replace function hold_seats(p_show_id uuid, p_seat_ids uuid[])
returns uuid
language plpgsql
security definer
as $$
declare
  v_booking uuid;
  v_updated int;
  v_price numeric;
begin
  if array_length(p_seat_ids, 1) is null or array_length(p_seat_ids, 1) > 6 then
    raise exception 'Select between 1 and 6 seats';
  end if;

  -- lock the chosen rows in a fixed order to avoid deadlocks
  perform 1 from show_seats
   where show_id = p_show_id and seat_id = any(p_seat_ids)
   order by seat_id
   for update;

  select ticket_price into v_price from shows where id = p_show_id;

  insert into bookings (user_id, show_id, total_amount, expires_at)
  values (auth.uid(), p_show_id, v_price * array_length(p_seat_ids, 1),
          now() + interval '5 minutes')
  returning id into v_booking;

  update show_seats
     set status = 'held', booking_id = v_booking,
         hold_expires_at = now() + interval '5 minutes'
   where show_id = p_show_id
     and seat_id = any(p_seat_ids)
     and (status = 'available'
          or (status = 'held' and hold_expires_at < now()));
  get diagnostics v_updated = row_count;

  if v_updated <> array_length(p_seat_ids, 1) then
    raise exception 'One or more seats are no longer available';  -- rolls back everything
  end if;

  return v_booking;
end;
$$;

6.2 Pay and confirm (checks the hold is still valid)

create or replace function pay_booking(p_booking_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  v_amount numeric;
  v_seats int;
  v_booked int;
begin
  select total_amount into v_amount from bookings
   where id = p_booking_id and user_id = auth.uid()
     and status = 'pending' and expires_at > now()
   for update;
  if not found then
    raise exception 'Booking expired or not found';
  end if;

  select count(*) into v_seats from show_seats where booking_id = p_booking_id;

  update show_seats set status = 'booked', hold_expires_at = null
   where booking_id = p_booking_id and status = 'held';
  get diagnostics v_booked = row_count;

  if v_booked <> v_seats then
    raise exception 'Seats are no longer held';
  end if;

  insert into payments (booking_id, amount) values (p_booking_id, v_amount);
  update bookings set status = 'confirmed' where id = p_booking_id;
  return 'confirmed';
end;
$$;

6.3 Release expired holds (runs every minute)

create or replace function release_expired_holds()
returns int
language plpgsql
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

select cron.schedule('release-holds', '* * * * *', 'select release_expired_holds()');

If two users press Proceed on the same seat at the same moment,
row locks let exactly one UPDATE succeed and the other
transaction rolls back. The hold query also treats an expired
hold as free, so a seat never stays blocked while waiting for the
scheduled job.

--------------------------------------------------------------
7. PO MAPPING
--------------------------------------------------------------
The project maps to 5 of the 12 Program Outcomes, using the
standard PO wording. Check the titles against your department's
list before submitting.

PO1 - Engineering knowledge
  Applies DBMS fundamentals: ER design, normalization, SQL,
  constraints, transactions and locking.

PO2 - Problem analysis
  Analyses the real problem of double booking and abandoned
  payments, and reduces it to seat states and a hold timer.

PO3 - Design and development of solutions
  Designs the schema and the hold, pay and release functions that
  solve the problem.

PO5 - Modern tool usage
  Uses Supabase, PostgreSQL, Row Level Security and pg_cron to
  build and run the system.

PO9 - Individual and team work
  The 4-member group divides database design, backend functions,
  frontend and testing among themselves.

--------------------------------------------------------------
8. PSO MAPPING
--------------------------------------------------------------
The project maps to 2 Program Specific Outcomes. PSO wording
differs by department, so the descriptions below are generic;
replace them with the exact PSO text from your department before
submitting.

PSO1 - Design and develop database-driven software systems
  Builds a complete booking system whose core logic lives in a
  normalized PostgreSQL database with transactions and
  constraints.

PSO2 - Use modern platforms and tools to build reliable, secure
       applications
  Uses a cloud database platform (Supabase) with authentication,
  access control and scheduled jobs to keep data consistent.

--------------------------------------------------------------
9. SDG ALIGNMENT
--------------------------------------------------------------
The project mainly supports SDG 9, with SDG 11 as a secondary
goal.

SDG 9 - Industry, Innovation and Infrastructure
  Gives a cinema a reliable digital booking infrastructure where
  data stays consistent under heavy use, with no double-sold
  seats.

SDG 11 - Sustainable Cities and Communities
  Makes entertainment services in cities easier to access: users
  book from their phones without queues, and unpaid seats return
  to sale instead of staying empty.

--------------------------------------------------------------
10. DBMS CONCEPTS AND TESTING
--------------------------------------------------------------
The project demonstrates these DBMS concepts, each tied to a part
of the system.

Concept                       | Where it appears
------------------------------+-------------------------------------------
ER design and normalization   | Separate seats (physical layout) and
                              | show_seats (per-show state)
Keys and constraints          | Primary, foreign, unique and CHECK
                              | constraints in the schema
ACID transactions             | hold_seats and pay_booking succeed or
                              | roll back as one unit
Concurrency control           | SELECT ... FOR UPDATE row locks and
                              | conditional UPDATE
Deadlock prevention           | Rows are always locked in seat_id order
Indexing                      | Partial index on held seats for fast
                              | expiry lookup
Stored functions, scheduled   | Three PL/pgSQL functions and one pg_cron
jobs                          | job
Access control                | Supabase Auth plus Row Level Security so
                              | clients change seats only through the
                              | functions

Test cases:
- 50 parallel hold_seats calls on one seat: exactly 1 succeeds.
- Hold 4 seats where 1 is already taken: no seat is held.
- Hold seats and do not pay: they return to "available" after
  5 minutes.
- Call pay_booking after expiry: it fails and the seats stay
  available.

==============================================================
END OF DOCUMENT
==============================================================
