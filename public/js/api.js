// ==============================================================
// CINEMA HALL TICKET BOOKING SYSTEM - UNIFIED DATA LAYER
// Transparently switches between Supabase (PostgreSQL) and MockDb
// ==============================================================

class CinemaApi {
  constructor() {
    this.mode = (window.APP_CONFIG && window.APP_CONFIG.isConfigured()) ? 'supabase' : 'mock';
  }

  getMode() {
    if (window.APP_CONFIG && window.APP_CONFIG.isConfigured() && window.SupabaseBackend && window.SupabaseBackend.isReady()) {
      return 'supabase';
    }
    return 'mock';
  }

  isSupabase() {
    return this.getMode() === 'supabase';
  }

  async isAdmin() {
    if (this.isSupabase()) return await window.SupabaseBackend.isAdmin();
    const user = window.MockDbEngine.getCurrentUser();
    return Boolean(user && user.role === 'admin' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname));
  }

  async getCurrentUser() {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.getCurrentUser();
    }
    return window.MockDbEngine.getCurrentUser();
  }

  async login(email, password) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.signIn(email, password);
    } else {
      const user = {
        id: 'user-' + Math.random().toString(36).substring(2, 9),
        email: email,
        full_name: email.split('@')[0]
      };
      window.MockDbEngine.setCurrentUser(user);
      return { user };
    }
  }

  async adminLogin(username, password) {
    const adminLoginName = username.trim().toLowerCase();
    if (!['cinemaad', 'cinemaad@districtcinemas.com'].includes(adminLoginName)) {
      throw new Error('Enter cinemaad or cinemaad@districtcinemas.com.');
    }
    if (!this.isSupabase()) {
      const isLocalTest = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      if (!isLocalTest || password !== 'cinemapas123') throw new Error('Invalid admin username or password.');
      const user = {
        id: 'local-cinema-admin',
        email: 'cinemaad@districtcinemas.com',
        full_name: 'Cinema Admin',
        role: 'admin'
      };
      window.MockDbEngine.setCurrentUser(user);
      return { user };
    }
    return await window.SupabaseBackend.signInAdmin(username, password);
  }

  async signup(email, password, fullName) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.signUp(email, password, fullName);
    } else {
      const user = {
        id: 'user-' + Math.random().toString(36).substring(2, 9),
        email: email,
        full_name: fullName || email.split('@')[0]
      };
      window.MockDbEngine.setCurrentUser(user);
      return { user };
    }
  }

  async logout() {
    if (this.isSupabase()) {
      await window.SupabaseBackend.signOut();
    } else {
      window.MockDbEngine.setCurrentUser(null);
    }
  }

  switchUser(user) {
    if (!this.isSupabase()) {
      window.MockDbEngine.setCurrentUser(user);
    }
  }

  getDemoUsers() {
    return window.MockDbEngine.getDemoUsers();
  }

  async getMovies() {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.fetchMovies();
    }
    return window.MockDbEngine.movies;
  }

  async getShows() {
    if (this.isSupabase()) {
      const shows = await window.SupabaseBackend.fetchShows();
      return shows.map(s => ({
        id: s.id,
        movie_id: s.movie_id,
        screen_id: s.screen_id,
        starts_at: s.starts_at,
        ticket_price: parseFloat(s.ticket_price),
        movie: s.movies,
        screen: s.screens
      }));
    } else {
      return window.MockDbEngine.shows.map(s => ({
        ...s,
        ticket_price: parseFloat(s.ticket_price),
        movie: window.MockDbEngine.movies.find(m => m.id === s.movie_id),
        screen: window.MockDbEngine.screens.find(sc => sc.id === s.screen_id)
      }));
    }
  }

  async getSeatMap(showId) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.fetchSeatMap(showId);
    }
    return window.MockDbEngine.get_show_seat_map(showId);
  }

  async holdSeats(showId, seatIds) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.holdSeats(showId, seatIds);
    }
    return window.MockDbEngine.hold_seats(showId, seatIds);
  }

  async payBooking(bookingId) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.payBooking(bookingId);
    }
    return window.MockDbEngine.pay_booking(bookingId);
  }

  async releaseExpiredHolds() {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.releaseExpiredHolds();
    }
    return window.MockDbEngine.release_expired_holds();
  }

  async getBookingDetails(bookingId) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.fetchBookingDetails(bookingId);
    }
    return window.MockDbEngine.get_booking_details(bookingId);
  }

  async getBookingExpiry(bookingId) {
    if (this.isSupabase()) {
      return await window.SupabaseBackend.fetchBookingExpiry(bookingId);
    }
    const details = window.MockDbEngine.get_booking_details(bookingId);
    return details ? details.expires_at : null;
  }

  async fastForwardHold(bookingId) {
    if (this.isSupabase()) {
      // In Supabase, call release_expired_holds
      return await window.SupabaseBackend.releaseExpiredHolds();
    }
    return window.MockDbEngine.fastForwardHold(bookingId);
  }

  async simulateConcurrency(showId, seatId) {
    return await window.MockDbEngine.simulate50ConcurrentHolds(showId, seatId);
  }

  subscribeToSeatChanges(showId, onUpdate) {
    if (this.isSupabase()) {
      return window.SupabaseBackend.subscribeToSeatChanges(showId, onUpdate);
    }
    const handler = (e) => {
      if (e.key === 'cinema_mock_db_v1') onUpdate();
    };
    window.addEventListener('storage', handler);
    window.addEventListener('database-updated', onUpdate);
    return {
      unsubscribe: () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener('database-updated', onUpdate);
      }
    };
  }

  subscribeToCatalogChanges(onUpdate) {
    if (this.isSupabase()) return window.SupabaseBackend.subscribeToCatalogChanges(onUpdate);
    window.addEventListener('database-catalog-updated', onUpdate);
    return { unsubscribe: () => window.removeEventListener('database-catalog-updated', onUpdate) };
  }

  getDbInspectionData() {
    return {
      mode: this.getMode(),
      movies: window.MockDbEngine.movies,
      screens: window.MockDbEngine.screens,
      shows: window.MockDbEngine.shows,
      seatsCount: window.MockDbEngine.seats.length,
      showSeatsCount: window.MockDbEngine.show_seats.length,
      bookings: window.MockDbEngine.bookings,
      payments: window.MockDbEngine.payments
    };
  }
}

window.API = new CinemaApi();
