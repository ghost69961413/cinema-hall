// ==============================================================
// CINEMA HALL TICKET BOOKING SYSTEM - IN-MEMORY RELATIONAL ENGINE
// Faithfully models the PostgreSQL Schema, Constraints & Functions
// ==============================================================

const DEMO_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', email: 'alex@districtcinemas.com', full_name: 'Alex Rivera (User 1)' },
  { id: '00000000-0000-0000-0000-000000000002', email: 'priya@districtcinemas.com', full_name: 'Priya Sharma (User 2)' },
  { id: '00000000-0000-0000-0000-000000000003', email: 'rahul@districtcinemas.com', full_name: 'Rahul Verma (User 3)' }
];

class MockDatabase {
  constructor() {
    this.storageKey = 'cinema_mock_db_v1';
    this.sharedRevision = 0;
    this.sharedConnected = false;
    this.pendingWrite = Promise.resolve();
    this.pendingWriteCount = 0;
    this.init();
    this.ready = this.connectSharedDatabase();
    this.sharedPoll = setInterval(() => this.refreshSharedDatabase(), 1200);

    // Listen to real-time storage events from other browser tabs/windows
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === this.storageKey) {
          this.init();
          window.dispatchEvent(new CustomEvent('database-updated'));
        }
      });
    }
  }

  getCurrentUser() {
    const raw = sessionStorage.getItem('cinema_active_user');
    if (raw) {
      try { return JSON.parse(raw); } catch (e) {}
    }
    return null;
  }

  setCurrentUser(user) {
    if (user) {
      sessionStorage.setItem('cinema_active_user', JSON.stringify(user));
      this.init();
      if (!this.profiles.some(p => p.id === user.id)) {
        this.profiles.push({ id: user.id, full_name: user.full_name || user.email });
        this.persist();
      }
    } else {
      sessionStorage.removeItem('cinema_active_user');
    }
  }

  getDemoUsers() {
    return DEMO_USERS;
  }

  syncFromStorage() {
    this.init();
  }

  async connectSharedDatabase() {
    try {
      const response = await fetch('/api/mock-db', { cache: 'no-store' });
      if (!response.ok) return;
      this.sharedConnected = true;
      const shared = await response.json();
      if (shared.data) this.applySharedData(shared);
      else await this.writeSharedDatabase();
    } catch (_) {
      // File-based/static development servers keep using the browser-local mock database.
    }
  }

  async refreshSharedDatabase() {
    if (!this.sharedConnected || this.pendingWriteCount > 0) return;
    try {
      const response = await fetch('/api/mock-db', { cache: 'no-store' });
      if (!response.ok) return;
      const shared = await response.json();
      if (shared.data && shared.revision > this.sharedRevision) {
        const oldCatalog = JSON.stringify({ movies: this.movies, screens: this.screens, shows: this.shows });
        this.applySharedData(shared);
        if (oldCatalog !== JSON.stringify({ movies: this.movies, screens: this.screens, shows: this.shows })) {
          window.dispatchEvent(new CustomEvent('database-catalog-updated'));
        }
        window.dispatchEvent(new CustomEvent('database-updated'));
      }
    } catch (_) {
      // Keep the local mock usable if the shared development endpoint is unavailable.
    }
  }

  applySharedData(shared) {
    this.sharedRevision = shared.revision || 0;
    Object.assign(this, shared.data);
    localStorage.setItem(this.storageKey, JSON.stringify(shared.data));
  }

  writeSharedDatabase() {
    if (!this.sharedConnected) return Promise.resolve();
    const data = this.serialize();
    this.pendingWriteCount++;
    this.pendingWrite = this.pendingWrite.then(async () => {
      try {
        const response = await fetch('/api/mock-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        });
        if (response.ok) this.sharedRevision = (await response.json()).revision || this.sharedRevision;
      } catch (_) {
        // The browser-local copy remains the fallback when the API is unavailable.
      }
    }).finally(() => { this.pendingWriteCount--; });
    return this.pendingWrite;
  }

  serialize() {
    return {
      profiles: this.profiles,
      movies: this.movies,
      screens: this.screens,
      seats: this.seats,
      shows: this.shows,
      show_seats: this.show_seats,
      bookings: this.bookings,
      payments: this.payments
    };
  }

  init() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.profiles = parsed.profiles || [];
        this.movies = parsed.movies || [];
        this.screens = parsed.screens || [];
        this.seats = parsed.seats || [];
        this.shows = parsed.shows || [];
        this.show_seats = parsed.show_seats || [];
        this.bookings = parsed.bookings || [];
        this.payments = parsed.payments || [];
        return;
      } catch (e) {
        console.warn('Failed to parse cached mock db, re-seeding...', e);
      }
    }
    this.seedDefaultData();
  }

  persist() {
    const data = this.serialize();
    localStorage.setItem(this.storageKey, JSON.stringify(data));
    this.writeSharedDatabase();
  }

  seedDefaultData() {
    this.profiles = DEMO_USERS.map(u => ({ id: u.id, full_name: u.full_name }));

    // Screens
    this.screens = [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Audi 1 - Dolby Atmos', screen_type: 'Dolby Atmos 7.1' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Audi 2 - IMAX Laser', screen_type: 'IMAX 4K Laser' }
    ];

    // Seats layout:
    // Rows A, B (Recliner, 8 seats)
    // Rows C, D (Prime, 10 seats)
    // Rows E, F (Classic, 10 seats)
    this.seats = [];
    ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'].forEach(screenId => {
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(row => {
        const tier = (row === 'A' || row === 'B') ? 'Recliner' : (row === 'C' || row === 'D') ? 'Prime' : 'Classic';
        const count = (row === 'A' || row === 'B') ? 8 : 10;
        for (let num = 1; num <= count; num++) {
          this.seats.push({
            id: `seat-${screenId.slice(0, 4)}-${row}-${num}`,
            screen_id: screenId,
            row_label: row,
            seat_number: num,
            tier: tier
          });
        }
      });
    });

    // Movies
    this.movies = [
      {
        id: 'movie-dune-2',
        title: 'Dune: Part Two',
        language: 'English',
        duration_min: 166,
        genre: 'Sci-Fi / Action',
        rating: 'UA',
        poster_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
        synopsis: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.'
      },
      {
        id: 'movie-oppenheimer',
        title: 'Oppenheimer',
        language: 'English',
        duration_min: 180,
        genre: 'Biography / Drama',
        rating: 'A',
        poster_url: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=800&auto=format&fit=crop&q=80',
        synopsis: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.'
      },
      {
        id: 'movie-interstellar',
        title: 'Interstellar',
        language: 'English',
        duration_min: 169,
        genre: 'Sci-Fi / Adventure',
        rating: 'UA',
        poster_url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=800&auto=format&fit=crop&q=80',
        synopsis: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity survival.'
      },
      {
        id: 'movie-spiderman',
        title: 'Spider-Man: Across the Spider-Verse',
        language: 'English',
        duration_min: 140,
        genre: 'Animation / Action',
        rating: 'U',
        poster_url: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=800&auto=format&fit=crop&q=80',
        synopsis: 'Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People.'
      }
    ];

    // Shows
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    this.shows = [
      {
        id: 'show-dune-audi1-1',
        movie_id: 'movie-dune-2',
        screen_id: '11111111-1111-1111-1111-111111111111',
        starts_at: `${todayStr}T14:00:00+05:30`,
        ticket_price: 280.00
      },
      {
        id: 'show-dune-audi1-2',
        movie_id: 'movie-dune-2',
        screen_id: '11111111-1111-1111-1111-111111111111',
        starts_at: `${todayStr}T18:30:00+05:30`,
        ticket_price: 320.00
      },
      {
        id: 'show-opp-audi2-1',
        movie_id: 'movie-oppenheimer',
        screen_id: '22222222-2222-2222-2222-222222222222',
        starts_at: `${todayStr}T15:00:00+05:30`,
        ticket_price: 350.00
      },
      {
        id: 'show-opp-audi2-2',
        movie_id: 'movie-oppenheimer',
        screen_id: '22222222-2222-2222-2222-222222222222',
        starts_at: `${todayStr}T19:45:00+05:30`,
        ticket_price: 400.00
      },
      {
        id: 'show-interstellar-audi1-3',
        movie_id: 'movie-interstellar',
        screen_id: '11111111-1111-1111-1111-111111111111',
        starts_at: `${todayStr}T21:45:00+05:30`,
        ticket_price: 300.00
      }
    ];

    // Populate show_seats for all shows
    this.show_seats = [];
    this.shows.forEach(show => {
      const screenSeats = this.seats.filter(s => s.screen_id === show.screen_id);
      screenSeats.forEach(s => {
        this.show_seats.push({
          show_id: show.id,
          seat_id: s.id,
          status: 'available',
          booking_id: null,
          hold_expires_at: null
        });
      });
    });

    // Bookings & Payments lists
    this.bookings = [];
    this.payments = [];

    // Pre-book seats C5 and C6 in Show 1 for realism
    const targetSeats = this.show_seats.filter(
      ss => ss.show_id === 'show-dune-audi1-1' &&
      (ss.seat_id.endsWith('-C-5') || ss.seat_id.endsWith('-C-6'))
    );
    if (targetSeats.length === 2) {
      const demoBkId = 'booking-preseed-001';
      this.bookings.push({
        id: demoBkId,
        user_id: DEMO_USERS[0].id,
        show_id: 'show-dune-audi1-1',
        status: 'confirmed',
        total_amount: 560.00,
        expires_at: new Date(Date.now() + 864000000).toISOString(),
        created_at: new Date().toISOString()
      });
      this.payments.push({
        id: 'pay-preseed-001',
        booking_id: demoBkId,
        amount: 560.00,
        paid_at: new Date().toISOString()
      });
      targetSeats.forEach(ss => {
        ss.status = 'booked';
        ss.booking_id = demoBkId;
      });
    }

    this.persist();
  }

  // ----------------------------------------------------------------
  // CORE FUNCTIONS MATCHING POSTGRESQL PL/PGSQL SPECIFICATION
  // ----------------------------------------------------------------

  // Function 6.3: Release expired holds
  release_expired_holds() {
    this.syncFromStorage();
    const now = new Date();
    let freedCount = 0;

    this.show_seats.forEach(ss => {
      if (ss.status === 'held' && ss.hold_expires_at && new Date(ss.hold_expires_at) < now) {
        ss.status = 'available';
        ss.booking_id = null;
        ss.hold_expires_at = null;
        freedCount++;
      }
    });

    this.bookings.forEach(b => {
      if (b.status === 'pending' && new Date(b.expires_at) < now) {
        b.status = 'expired';
      }
    });

    if (freedCount > 0) this.persist();
    return freedCount;
  }

  // Function 6.1: Hold seats (all-or-nothing, 5 minutes)
  hold_seats(p_show_id, p_seat_ids) {
    this.syncFromStorage();
    this.release_expired_holds();

    if (!Array.isArray(p_seat_ids) || p_seat_ids.length === 0 || p_seat_ids.length > 6) {
      throw new Error('Select between 1 and 6 seats');
    }

    const show = this.shows.find(s => s.id === p_show_id);
    if (!show) {
      throw new Error('Show not found');
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    // Deadlock-free simulation: sort seat IDs deterministically
    const sortedSeatIds = [...p_seat_ids].sort();

    // Verify all seats are currently available (or have an expired hold)
    for (const seatId of sortedSeatIds) {
      const ss = this.show_seats.find(row => row.show_id === p_show_id && row.seat_id === seatId);
      if (!ss) {
        throw new Error('Seat not found in show');
      }
      const isAvailable = (ss.status === 'available') ||
        (ss.status === 'held' && ss.hold_expires_at && new Date(ss.hold_expires_at) < now);

      if (!isAvailable) {
        const seat = this.seats.find(s => s.id === seatId);
        const label = seat ? `${seat.row_label}${seat.seat_number}` : 'One or more seats';
        throw new Error(`${label} is temporarily held by another customer (5-minute lock)`);
      }
    }

    // Atomic Insertion into bookings
    const currentUser = this.getCurrentUser();
    const userId = currentUser ? currentUser.id : 'guest-user';

    const bookingId = 'bk-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
    const totalAmount = show.ticket_price * sortedSeatIds.length;

    this.bookings.push({
      id: bookingId,
      user_id: userId,
      show_id: p_show_id,
      status: 'pending',
      total_amount: totalAmount,
      expires_at: expiry.toISOString(),
      created_at: now.toISOString()
    });

    // Atomic Update of show_seats
    sortedSeatIds.forEach(seatId => {
      const ss = this.show_seats.find(row => row.show_id === p_show_id && row.seat_id === seatId);
      ss.status = 'held';
      ss.booking_id = bookingId;
      ss.hold_expires_at = expiry.toISOString();
    });

    this.persist();
    return bookingId;
  }

  // Function 6.2: Pay booking (checks hold is valid)
  pay_booking(p_booking_id) {
    this.syncFromStorage();
    const now = new Date();
    const booking = this.bookings.find(b => b.id === p_booking_id);

    if (!booking) {
      throw new Error('Booking expired or not found');
    }

    if (booking.status !== 'pending' || new Date(booking.expires_at) <= now) {
      throw new Error('Booking expired or not found');
    }

    // Check show_seats held count
    const heldSeats = this.show_seats.filter(ss => ss.booking_id === p_booking_id && ss.status === 'held');
    if (heldSeats.length === 0) {
      throw new Error('Seats are no longer held');
    }

    // Mark show_seats as booked
    heldSeats.forEach(ss => {
      ss.status = 'booked';
      ss.hold_expires_at = null;
    });

    // Insert payment record
    const payId = 'pay-' + Math.random().toString(36).substring(2, 9);
    this.payments.push({
      id: payId,
      booking_id: p_booking_id,
      amount: booking.total_amount,
      paid_at: now.toISOString()
    });

    // Mark booking as confirmed
    booking.status = 'confirmed';
    this.persist();
    return 'confirmed';
  }

  // Layout query helper: get_show_seat_map
  get_show_seat_map(p_show_id) {
    this.syncFromStorage();
    this.release_expired_holds();
    const show = this.shows.find(s => s.id === p_show_id);
    if (!show) return [];

    const screenSeats = this.seats.filter(s => s.screen_id === show.screen_id);
    const currentUser = this.getCurrentUser();
    const currentUserId = currentUser ? currentUser.id : null;

    return screenSeats.map(s => {
      const ss = this.show_seats.find(row => row.show_id === p_show_id && row.seat_id === s.id) || {
        status: 'available',
        hold_expires_at: null,
        booking_id: null
      };

      const booking = ss.booking_id ? this.bookings.find(b => b.id === ss.booking_id) : null;
      const isHeldByMe = (ss.status === 'held' && booking && currentUserId && booking.user_id === currentUserId);

      return {
        seat_id: s.id,
        row_label: s.row_label,
        seat_number: s.seat_number,
        tier: s.tier,
        status: ss.status,
        hold_expires_at: ss.hold_expires_at,
        is_held_by_me: Boolean(isHeldByMe)
      };
    }).sort((a, b) => {
      if (a.row_label !== b.row_label) return a.row_label.localeCompare(b.row_label);
      return a.seat_number - b.seat_number;
    });
  }

  // Confirmation query helper: get_booking_details
  get_booking_details(p_booking_id) {
    this.syncFromStorage();
    const booking = this.bookings.find(b => b.id === p_booking_id);
    if (!booking) return null;

    const show = this.shows.find(s => s.id === booking.show_id);
    const movie = show ? this.movies.find(m => m.id === show.movie_id) : null;
    const screen = show ? this.screens.find(sc => sc.id === show.screen_id) : null;
    const payment = this.payments.find(p => p.booking_id === booking.id);

    const bookedSeats = this.show_seats
      .filter(ss => ss.booking_id === booking.id)
      .map(ss => {
        const seat = this.seats.find(s => s.id === ss.seat_id);
        return {
          seat_id: seat.id,
          row_label: seat.row_label,
          seat_number: seat.seat_number,
          tier: seat.tier
        };
      })
      .sort((a, b) => {
        if (a.row_label !== b.row_label) return a.row_label.localeCompare(b.row_label);
        return a.seat_number - b.seat_number;
      });

    return {
      booking_id: booking.id,
      show_id: booking.show_id,
      status: booking.status,
      total_amount: booking.total_amount,
      expires_at: booking.expires_at,
      created_at: booking.created_at,
      movie_title: movie ? movie.title : 'Cinema Feature',
      movie_language: movie ? movie.language : 'English',
      screen_name: screen ? screen.name : 'Main Screen',
      show_time: show ? show.starts_at : new Date().toISOString(),
      ticket_price: show ? show.ticket_price : 0,
      seats: bookedSeats,
      payment: payment ? { amount: payment.amount, paid_at: payment.paid_at } : null
    };
  }

  fastForwardHold(bookingId) {
    const b = this.bookings.find(row => row.id === bookingId);
    if (b) {
      const past = new Date(Date.now() - 5000).toISOString();
      b.expires_at = past;
      this.show_seats.forEach(ss => {
        if (ss.booking_id === bookingId) {
          ss.hold_expires_at = past;
        }
      });
      this.persist();
      return true;
    }
    return false;
  }

  async simulate50ConcurrentHolds(showId, targetSeatId) {
    let successCount = 0;
    let failCount = 0;
    const results = [];
    const prevUser = this.currentUser;

    for (let i = 1; i <= 50; i++) {
      try {
        const uId = `virtual-user-${i}`;
        this.currentUser = { id: uId, email: `${uId}@district.com`, full_name: `Virtual User ${i}` };
        const bk = this.hold_seats(showId, [targetSeatId]);
        successCount++;
        results.push({ user: `User #${i}`, outcome: 'SUCCESS', message: 'Acquired row lock & held seat', bookingId: bk });
      } catch (err) {
        failCount++;
        results.push({ user: `User #${i}`, outcome: 'ROLLED BACK', message: err.message });
      }
    }

    this.currentUser = prevUser;
    return { successCount, failCount, results };
  }

  resetAll() {
    localStorage.removeItem(this.storageKey);
    this.seedDefaultData();
    this.persist();
  }
}

window.MockDbEngine = new MockDatabase();
