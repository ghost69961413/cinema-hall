// ==============================================================
// CINEMA HALL TICKET BOOKING SYSTEM - SUPABASE CLIENT WRAPPER
// ==============================================================

class SupabaseService {
  constructor() {
    this.client = null;
    this.currentUser = null;
    this.init();
  }

  init() {
    if (window.APP_CONFIG && window.APP_CONFIG.isConfigured() && window.supabase) {
      try {
        this.client = window.supabase.createClient(
          window.APP_CONFIG.SUPABASE_URL,
          window.APP_CONFIG.SUPABASE_ANON_KEY
        );

        // Fetch current session
        this.client.auth.getSession().then(({ data: { session } }) => {
          this.currentUser = session ? session.user : null;
          this.triggerAuthChange(this.currentUser);
        });

        // Listen for auth state changes
        this.client.auth.onAuthStateChange((_event, session) => {
          this.currentUser = session ? session.user : null;
          this.triggerAuthChange(this.currentUser);
        });
      } catch (e) {
        console.error('Failed to initialize Supabase client:', e);
        this.client = null;
      }
    } else {
      this.client = null;
    }
  }

  isReady() {
    return Boolean(this.client);
  }

  async getCurrentUser() {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.currentUser = data.session ? data.session.user : null;
    return this.currentUser;
  }

  async isAdmin() {
    if (!this.client) return false;
    const { data, error } = await this.client.rpc('is_admin');
    if (error) throw error;
    return Boolean(data);
  }

  triggerAuthChange(user) {
    window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
  }

  async signUp(email, password, fullName) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });
    if (error) throw error;
    return data;
  }

  async signIn(email, password) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    this.currentUser = data.user;
    return data;
  }

  async signInAdmin(username, password) {
    if (!this.client) throw new Error('Supabase client not initialized');
    if (username.trim().toLowerCase() !== 'cinemaad') throw new Error('Invalid admin username or password.');
    const { data, error } = await this.client.auth.signInWithPassword({
      email: 'cinemaad@districtcinemas.com',
      password
    });
    if (error) throw error;
    this.currentUser = data.user;
    try {
      if (!await this.isAdmin()) throw new Error('This account does not have admin access.');
    } catch (adminError) {
      await this.signOut();
      throw adminError;
    }
    return data;
  }

  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.currentUser = null;
  }

  // Database Queries
  async fetchMovies() {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.from('movies').select('*').order('title');
    if (error) throw error;
    return data;
  }

  async fetchScreens() {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.from('screens').select('*');
    if (error) throw error;
    return data;
  }

  async fetchShows() {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client
      .from('shows')
      .select('*, movies(*), screens(*)')
      .gte('starts_at', new Date(Date.now() - 3600000).toISOString())
      .order('starts_at');
    if (error) throw error;
    return data;
  }

  // RPC 6.4: Get Seat Map
  async fetchSeatMap(showId) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.rpc('get_show_seat_map', { p_show_id: showId });
    if (error) throw error;
    return data;
  }

  // RPC 6.1: Hold Seats
  async holdSeats(showId, seatIds) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.rpc('hold_seats', {
      p_show_id: showId,
      p_seat_ids: seatIds
    });
    if (error) throw error;
    return data; // Returns booking UUID
  }

  // RPC 6.2: Pay Booking
  async payBooking(bookingId) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.rpc('pay_booking', {
      p_booking_id: bookingId
    });
    if (error) throw error;
    return data; // Returns 'confirmed'
  }

  // RPC 6.3: Release Expired Holds
  async releaseExpiredHolds() {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.rpc('release_expired_holds');
    if (error) throw error;
    return data;
  }

  // RPC 6.5: Get Booking Details
  async fetchBookingDetails(bookingId) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client.rpc('get_booking_details', {
      p_booking_id: bookingId
    });
    if (error) throw error;
    return data;
  }

  async fetchBookingExpiry(bookingId) {
    if (!this.client) throw new Error('Supabase client not initialized');
    const { data, error } = await this.client
      .from('bookings')
      .select('expires_at')
      .eq('id', bookingId)
      .single();
    if (error) throw error;
    return data.expires_at;
  }

  // Realtime F4: Subscribe to live seat changes on show_seats
  subscribeToSeatChanges(showId, onUpdate) {
    if (!this.client) return null;
    const channel = this.client
      .channel('seats-' + showId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'show_seats', filter: `show_id=eq.${showId}` },
        (payload) => onUpdate(payload)
      );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onUpdate({ type: 'reload', status });
    });
    return channel;
  }

  subscribeToCatalogChanges(onUpdate) {
    if (!this.client) return null;
    const channel = this.client
      .channel('public-cinema-catalog')
      .on('postgres_changes', { event:'*', schema:'public', table:'movies' }, onUpdate)
      .on('postgres_changes', { event:'*', schema:'public', table:'screens' }, onUpdate)
      .on('postgres_changes', { event:'*', schema:'public', table:'shows' }, onUpdate);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onUpdate({ type:'reload', status });
    });
    return channel;
  }
}

window.SupabaseBackend = new SupabaseService();
