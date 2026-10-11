# Cinema Hall Ticket Booking System 🍿
> **DBMS Course Project** • Built with **Supabase (PostgreSQL 15+, Auth, pg_cron)** & **District-App Inspired Frontend**

[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_15+-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License](https://img.shields.io/badge/Course-DBMS_Project-blue.svg)](#)

---

## 📌 Project Overview
A cinema hall ticket booking system where the **database, not the application, guarantees that a seat is never sold twice**.

### Key Problem Addressed
When multiple users book concurrently:
1. Two users can attempt to buy the same seat at the exact same moment (**Race Condition / Double Booking**).
2. Users who select seats and abandon payment block those seats from being sold to others (**Zombie Holds**).

### Solution
- The customer selects up to 6 seats on a modern **District-style seat map**.
- Chosen seats are reserved in an **all-or-nothing PostgreSQL transaction** for a strict **5-minute hold window**.
- If payment is simulated and recorded in time, the seats become permanently **`booked`**.
- If unpaid when the timer expires, the database automatically releases them back to **`available`** for everyone.

---

## 🚀 Quick Start (Instant Live Demo)

### 1. Launch the Web Application
No Node.js or npm dependencies required! Start the built-in Python web server:

```bash
python3 serve.py 3000
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

> **💡 Instant Out-of-the-Box Mode:** The frontend comes with a high-fidelity **In-Memory ACID Engine** active by default, allowing you to test the full 5-minute hold timer, seat selection constraints, simulated checkout, confirmation ticket, and database table inspector immediately.

---

### 2. Connect to Live Supabase (Optional / Course Submission)
To run on your actual Supabase cloud database:

1. Create a free project on [Supabase](https://supabase.com).
2. In the Supabase Dashboard, go to **SQL Editor** -> **New Query**.
3. Copy and run the master script: **[`sql/full_setup.sql`](sql/full_setup.sql)**.
4. Go to **Project Settings** -> **API** and copy your **Project URL** and **Anon Key**.
5. In the District Cinema web app, click the **Status Pill** in the top navigation bar (`⚙️ In-Memory Engine`), paste your credentials, and click **Connect Supabase**!

---

### 3. Run the Automated Concurrency Test Suite
We provide an automated multi-threaded test runner that verifies:
- 50 parallel hold calls on the exact same seat (exactly 1 succeeds, 49 roll back).
- Atomicity (if 1 of 4 seats is taken, zero seats are held).
- Valid payment within the hold window.
- Expiration rejection and lazy seat reclamation.

Run the test:
```bash
python3 tests/concurrency_test.py
```

Output:
```
=================================================================
CINEMA HALL TICKET BOOKING SYSTEM - CONCURRENCY VERIFICATION
=================================================================

[TEST 1] Testing 50 parallel hold_seats calls on seat-10...
 -> Successful reservations: 1
 -> Rejected/Rolled back:     49
PASS: Exactly 1 transaction succeeded, 49 correctly rolled back without race conditions.

[TEST 2] Testing hold of 4 seats where 1 is already held...
 -> Caught expected rollback: One or more seats are no longer available
PASS: Atomicity verified. Partial holds were prevented and all rows remain available.

[TEST 3] Testing pay_booking within hold window...
PASS: Payment confirmed, show_seats updated to 'booked', payment recorded.

[TEST 4] Testing expired hold payment rejection and lazy release...
 -> Caught expected expiry rejection: Booking expired or not found
PASS: Expired hold rejected, and seat was successfully reclaimed by next user.

=================================================================
ALL DBMS TEST CASES PASSED WITH 100% COMPLIANCE
=================================================================
```

---

## 🗄️ Database Design

### Tables Overview
1. **`profiles`** - User accounts linked with `auth.users`.
2. **`movies`** - Film catalog (title, language, duration, synopsis, poster).
3. **`screens`** - Cinema halls (e.g., Audi 1 - Dolby Atmos, Audi 2 - IMAX Laser).
4. **`seats`** - Physical seats layout (`row_label`, `seat_number`, `tier`).
5. **`shows`** - Screenings with specific date, time, and ticket price.
6. **`bookings`** - Reservations with status (`pending`, `confirmed`, `expired`), amount, and 5-min `expires_at`.
7. **`show_seats`** - Live seat state per show (`available`, `held`, `booked`), `booking_id`, and `hold_expires_at`.
8. **`payments`** - Financial ledger recording confirmed transactions.

### Core PostgreSQL Functions
- **`hold_seats(p_show_id uuid, p_seat_ids uuid[])`**:
  - Validates seat limit (1 to 6 seats).
  - Uses `SELECT ... FOR UPDATE ORDER BY seat_id` to acquire row locks in deterministic order (prevents deadlocks).
  - All-or-nothing atomic update: if any seat is taken, transaction rolls back.
  - Returns `booking_id` with 5-minute expiry.
- **`pay_booking(p_booking_id uuid)`**:
  - Validates that hold has not expired (`expires_at > now()`).
  - Converts seat statuses from `held` to `booked`.
  - Records payment entry into `payments` table.
  - Updates booking status to `confirmed`.
- **`release_expired_holds()`**:
  - Sweeps `show_seats` where `status = 'held' AND hold_expires_at < now()`, resetting them to `available`.
  - Scheduled automatically via `pg_cron` every minute.

---

## 🎨 District-App Inspired UI Highlights

- **Dark Neon Aesthetic:** Ambient glow, crisp typography, and sleek card gradients.
- **Curved Screen Visual:** Ambient projection glow directing audience focus down to the screen.
- **Tiered Seating Layout:** Distinct tiers for Recliner, Prime, and Classic seating with center aisle division.
- **5-Minute Live Hold Timer:** Prominent countdown banner with live tick-down and Fast-Forward (+5m) testing button.
- **Multi-User Concurrency & Cross-Tab Sync:** Session switcher in the top bar (`Alex Rivera (User 1)` $\leftrightarrow$ `Priya Sharma (User 2)` $\leftrightarrow$ `Rahul Verma (User 3)`). You can open two browser windows or tabs side by side: when User 1 holds a seat, it immediately turns into an amber pulsing lock (`🔒`) for User 2 in real time, preventing anyone else from holding or booking it!
- **Simulated Payment Modal:** Itemized cinema bill with subtotal, convenience fee, and GST.
- **District Ticket Pass:** Authentic perforated cinema ticket with barcode, booking ID, and download/print button.
- **Live Database Inspector & Concurrency Lab:** Built-in modal allowing professors and students to inspect raw database rows and run the 50-user parallel race-condition stress test live in the browser.

---

## 📂 Project Structure

```
cinema-hall/
├── PRD.md                  # Official Product Requirements Document
├── SUBMISSION_REPORT.md    # Formatted Academic Report (PO, PSO, SDG, ERD, Proofs)
├── README.md               # Project documentation & setup instructions
├── serve.py                # Zero-dependency local web server
│
├── sql/
│   ├── 01_schema.sql       # PostgreSQL DDL, ENUMs, tables, and triggers
│   ├── 02_functions.sql    # hold_seats, pay_booking, release_expired_holds
│   ├── 03_rls.sql          # Row Level Security policies and grants
│   ├── 04_seed.sql         # Seed data (movies, screens, seats, showtimes)
│   ├── 05_cron.sql         # pg_cron 1-minute schedule script
│   ├── full_setup.sql      # Single master setup script for Supabase
│   └── test_queries.sql    # Pure SQL verification script
│
├── tests/
│   └── concurrency_test.py # 50-thread concurrent stress testing script
│
└── public/
    ├── index.html          # District cinema web application
    ├── css/
    │   └── style.css       # District design system, seat grid & animations
    └── js/
        ├── config.js       # Configuration storage (Supabase URL & Key)
        ├── mockDb.js       # High-fidelity In-Memory ACID engine
        ├── supabaseClient.js# Supabase JS client integration
        ├── api.js          # Unified data layer
        └── app.js          # State management, seat selection & timers
```

---

## 🎓 Academic Submission Details
See **[`SUBMISSION_REPORT.md`](SUBMISSION_REPORT.md)** for:
- Detailed **PO Mapping** (PO1, PO2, PO3, PO5, PO9)
- **PSO Mapping** (PSO1, PSO2)
- **SDG Alignment** (SDG 9 & SDG 11) with justifications
- Formal **3NF Normalization Proof** & **Mermaid ER Diagram**
- **Deadlock-Free Concurrency Proof**
