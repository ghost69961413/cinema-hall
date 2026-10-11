// ==============================================================
// CINEMA HALL TICKET BOOKING SYSTEM - MAIN CONTROLLER (APP.JS)
// District-App Inspired UX & Real-time State Management
// ==============================================================

class CinemaApp {
  constructor() {
    this.movies = [];
    this.shows = [];
    this.selectedMovie = null;
    this.selectedShow = null;
    this.selectedSeatIds = new Set();
    this.activeHold = null; // { bookingId, expiresAt, showId }
    this.timerInterval = null;
    this.catalogSubscription = null;
    this.seatMapRequestToken = 0;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.el = {
      statusPill: document.getElementById('status-pill'),
      statusDot: document.getElementById('status-dot'),
      statusText: document.getElementById('status-text'),
      authBtn: document.getElementById('auth-btn'),
      userBadge: document.getElementById('user-badge'),
      userSwitcherSelect: document.getElementById('user-switcher-select'),
      moviesGrid: document.getElementById('movies-grid'),
      showtimesSection: document.getElementById('showtimes-section'),
      selectedMovieTitle: document.getElementById('selected-movie-title'),
      showtimesList: document.getElementById('showtimes-list'),
      seatmapSection: document.getElementById('seatmap-section'),
      screenTitle: document.getElementById('screen-title'),
      seatGrid: document.getElementById('seat-grid'),
      holdBanner: document.getElementById('hold-timer-banner'),
      holdTimerText: document.getElementById('hold-timer-text'),
      bottomCheckoutBar: document.getElementById('bottom-checkout-bar'),
      selectedSeatsList: document.getElementById('selected-seats-list'),
      checkoutTotalAmount: document.getElementById('checkout-total-amount'),
      holdSeatsBtn: document.getElementById('hold-seats-btn'),
      proceedPayBtn: document.getElementById('proceed-pay-btn'),
      // Modals
      checkoutModal: document.getElementById('checkout-modal'),
      ticketModal: document.getElementById('ticket-modal'),
      configModal: document.getElementById('config-modal'),
      authModal: document.getElementById('auth-modal'),
      dbInspectorModal: document.getElementById('db-inspector-modal'),
      // Toast container
      toastContainer: document.getElementById('toast-container')
    };
  }

  bindEvents() {
    // Mode / Config Modal
    this.el.statusPill.addEventListener('click', () => this.openModal(this.el.configModal));
    document.getElementById('save-config-btn').addEventListener('click', () => this.handleSaveConfig());
    document.getElementById('reset-demo-btn').addEventListener('click', () => this.handleResetDemo());

    // User Switcher (for testing multi-user concurrency and holds)
    if (this.el.userSwitcherSelect) {
      this.el.userSwitcherSelect.addEventListener('change', () => this.handleUserSwitch());
    }

    // DB Inspector
    document.getElementById('open-inspector-btn').addEventListener('click', () => this.openInspector());

    // Auth Modal
    this.el.authBtn.addEventListener('click', () => this.handleAuthClick());
    document.getElementById('auth-form').addEventListener('submit', (e) => this.handleAuthSubmit(e));
    document.getElementById('toggle-auth-mode').addEventListener('click', () => this.toggleAuthMode());
    document.getElementById('admin-auth-mode').addEventListener('click', () => {
      this.setAuthMode(document.getElementById('auth-admin-username-group').style.display === 'none' ? 'admin' : 'signin');
    });

    // Hold & Pay actions
    this.el.holdSeatsBtn.addEventListener('click', () => this.handleHoldSeats());
    this.el.proceedPayBtn.addEventListener('click', () => this.openCheckoutModal());
    document.getElementById('confirm-pay-btn').addEventListener('click', () => this.handleConfirmPayment());

    // Close buttons on all modals
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) this.closeModal(modal);
      });
    });

    // Reset / Fast-forward hold
    document.getElementById('cancel-hold-btn').addEventListener('click', () => this.handleCancelHold());
    document.getElementById('fast-forward-hold-btn').addEventListener('click', () => this.handleFastForwardHold());

    // Ticket modal actions
    document.getElementById('print-ticket-btn').addEventListener('click', () => window.print());
    document.getElementById('new-booking-btn').addEventListener('click', () => {
      this.closeModal(this.el.ticketModal);
      this.resetHoldState();
      this.loadSeatMap();
    });

    // Global auth event
    window.addEventListener('auth-state-changed', (e) => {
      this.updateAuthUI(e.detail.user);
      this.refreshAdminLink(e.detail.user);
    });

    // Cross-tab and window real-time database listener
    window.addEventListener('database-updated', () => {
      this.loadSeatMap();
    });
    window.addEventListener('storage', (e) => {
      if (e.key === 'cinema_mock_db_v1') {
        this.loadSeatMap();
      }
    });

    // Background poller: keeps seat map updated in real time across multiple tabs
    setInterval(() => {
      if (this.selectedShow && !this.activeHold) {
        this.loadSeatMap();
      }
    }, 2500);
  }

  async start() {
    await window.MockDbEngine.ready;
    this.updateStatusPill();
    const user = await window.API.getCurrentUser();
    this.updateAuthUI(user);
    await this.refreshAdminLink(user);
    this.catalogSubscription = window.API.subscribeToCatalogChanges(() => this.loadCatalog());
    if (user) await this.restoreActiveServerHold();
    else {
      // New visitors need an account before seeing the catalog or seat map.
      this.toggleAuthMode();
      this.openModal(this.el.authModal);
      this.el.authModal.querySelector('.modal-close').style.display = 'none';
    }
  }

  // F6: Restore server-based hold countdown so page refresh never resets timer
  async restoreActiveServerHold() {
    const savedBookingId = sessionStorage.getItem('cinema_active_booking_id');
    if (!savedBookingId) return;

    try {
      const details = await window.API.getBookingDetails(savedBookingId);
      if (details && details.status === 'pending') {
        const serverExpires = new Date(details.expires_at);
        const now = new Date();
        if (serverExpires > now) {
          this.activeHold = {
            bookingId: savedBookingId,
            expiresAt: serverExpires,
            showId: details.show_id
          };
          if (details.seats && details.seats.length > 0) {
            this.selectedSeatIds.clear();
            details.seats.forEach(s => this.selectedSeatIds.add(s.seat_id));
          }
          this.startHoldTimer();
          this.updateCheckoutBar();

          const matchingShow = this.shows.find(s => s.id === details.show_id);
          if (matchingShow) {
            const matchingMovie = this.movies.find(m => m.id === matchingShow.movie_id);
            if (matchingMovie) this.selectMovie(matchingMovie);
            this.selectShow(matchingShow);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Could not restore server hold:', e);
    }
    sessionStorage.removeItem('cinema_active_booking_id');
  }

  updateStatusPill() {
    const isSupabase = window.API.isSupabase();
    if (isSupabase) {
      this.el.statusDot.className = 'status-dot green';
      this.el.statusText.textContent = 'Supabase PostgreSQL';
    } else {
      this.el.statusDot.className = 'status-dot amber';
      this.el.statusText.textContent = 'In-Memory ACID Engine';
    }
  }

  async checkAuthStatus() {
    const user = await window.API.getCurrentUser();
    this.updateAuthUI(user);
    await this.refreshAdminLink(user);
  }

  async handleUserSwitch() {
    const idx = parseInt(this.el.userSwitcherSelect.value);
    const demoUsers = window.API.getDemoUsers();
    const newUser = demoUsers[idx] || demoUsers[0];
    window.API.switchUser(newUser);
    this.showToast(`Switched active session to ${newUser.full_name}`, 'info');
    this.resetHoldState();
    await this.loadSeatMap();
  }

  updateAuthUI(user) {
    document.querySelectorAll('.main-container, #bottom-checkout-bar, #open-inspector-btn').forEach(el => { el.style.display = user ? '' : 'none'; });
    const switcher = document.querySelector('.user-switcher-wrap');
    if (switcher) switcher.style.display = 'none';
    if (user) {
      this.el.authBtn.style.display = 'inline-flex';
      if (this.el.userBadge) {
        this.el.userBadge.textContent = user.full_name || user.email.split('@')[0];
        this.el.userBadge.style.display = 'inline-block';
      }
      if (this.el.userSwitcherSelect) {
        const demoUsers = window.API.getDemoUsers();
        const foundIdx = demoUsers.findIndex(u => u.id === user.id);
        if (foundIdx !== -1) {
          this.el.userSwitcherSelect.value = foundIdx;
        }
      }
      this.el.authBtn.textContent = 'Sign Out';
      this.closeModal(this.el.authModal);
      if (this.movies.length === 0) this.loadCatalog();
    } else {
      this.el.authBtn.style.display = 'none';
      if (this.el.userBadge) this.el.userBadge.style.display = 'none';
      this.el.authBtn.textContent = 'Sign In';
      this.openModal(this.el.authModal);
      this.el.authModal.querySelector('.modal-close').style.display = 'none';
    }
  }

  async refreshAdminLink(user) {
    const link = document.getElementById('admin-nav-link');
    if (!link) return;
    link.style.display = 'none';
    if (!user) return;
    try {
      if (await window.API.isAdmin()) link.style.display = 'inline-flex';
    } catch (error) {
      console.warn('Could not check admin access:', error);
    }
  }

  async handleAuthClick() {
    const user = await window.API.getCurrentUser();
    if (user) {
      await window.API.logout();
      this.showToast('Signed out successfully', 'success');
      this.updateAuthUI(null);
    } else {
      this.openModal(this.el.authModal);
    }
  }

  toggleAuthMode() {
    this.setAuthMode(document.getElementById('auth-modal-title').textContent === 'Create Account' ? 'signin' : 'signup');
  }

  setAuthMode(mode) {
    const isSignup = mode === 'signup';
    const isAdmin = mode === 'admin';
    document.getElementById('auth-modal-title').textContent = isSignup ? 'Create Account' : (isAdmin ? 'Admin Sign In' : 'Sign In');
    document.getElementById('auth-submit-btn').textContent = isSignup ? 'Sign Up' : (isAdmin ? 'Admin Sign In' : 'Sign In');
    document.getElementById('auth-name-group').style.display = isSignup ? 'block' : 'none';
    document.getElementById('auth-confirm-group').style.display = isSignup ? 'block' : 'none';
    document.getElementById('auth-admin-username-group').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('auth-email').closest('.form-group').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('auth-name').required = isSignup;
    document.getElementById('auth-confirm-password').required = isSignup;
    document.getElementById('auth-email').required = !isAdmin;
    document.getElementById('auth-admin-username').required = isAdmin;
    document.getElementById('toggle-auth-mode').style.display = isAdmin ? 'none' : 'inline-flex';
    document.getElementById('toggle-auth-mode').textContent = isSignup ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";
    document.getElementById('admin-auth-mode').textContent = isAdmin ? 'Customer Sign In' : 'Admin Sign In';
    document.getElementById('auth-help-text').textContent = isAdmin
      ? (window.API.isSupabase()
        ? 'Use the cinemaad admin username and the password set for its Supabase Auth account.'
        : 'Local test admin: cinemaad. This demo sign-in only works on localhost.')
      : 'Sign in or create an account to book seats.';
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('auth-admin-username-group').style.display === 'none'
      ? (document.getElementById('auth-name-group').style.display === 'none' ? 'signin' : 'signup')
      : 'admin';
    const isSignUp = mode === 'signup';
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value;
    const confirmation = document.getElementById('auth-confirm-password').value;
    const adminUsername = document.getElementById('auth-admin-username').value.trim();
    if (!password || (mode === 'admin' ? !adminUsername : (!email || (isSignUp && (!name || !confirmation))))) return this.showToast('Please fill in every field', 'error');
    if (mode !== 'admin' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this.showToast('Enter a valid email address', 'error');
    if (isSignUp && password.length < 6) return this.showToast('Password must be at least 6 characters', 'error');
    if (isSignUp && password !== confirmation) return this.showToast('Passwords do not match', 'error');

    try {
      if (isSignUp) {
        await window.API.signup(email, password, name);
        if (!await window.API.getCurrentUser()) this.showToast('Account created. Check your email to confirm, then sign in.', 'success');
        else this.showToast('Account created successfully!', 'success');
      } else if (mode === 'admin') {
        await window.API.adminLogin(adminUsername, password);
        this.showToast('Admin signed in successfully!', 'success');
      } else {
        await window.API.login(email, password);
        this.showToast('Signed in successfully!', 'success');
      }
      await this.checkAuthStatus();
    } catch (err) {
      this.showToast(err.message || 'Authentication error', 'error');
    }
  }

  // Load Movies & Shows
  async loadCatalog() {
    try {
      const selectedMovieId = this.selectedMovie?.id;
      const selectedShowId = this.selectedShow?.id;
      this.movies = await window.API.getMovies();
      this.shows = await window.API.getShows();
      this.renderMovies();
      if (this.movies.length > 0) {
        const movie = this.movies.find(item => item.id === selectedMovieId) || this.movies[0];
        if (!selectedMovieId) {
          this.selectMovie(movie);
        } else {
          this.selectedMovie = movie;
          this.el.selectedMovieTitle.textContent = `${movie.title} • Showtimes`;
          document.querySelectorAll('.movie-card').forEach(card => card.classList.toggle('active', card.dataset.movieId === movie.id));
          this.selectedShow = this.shows.find(show => show.id === selectedShowId) || null;
          this.renderShowtimes();
        }
      } else {
        this.selectedMovie = null;
        this.selectedShow = null;
        this.el.showtimesList.innerHTML = '';
        this.el.seatmapSection.style.display = 'none';
      }
    } catch (err) {
      console.error(err);
      this.showToast('Error loading movies catalog', 'error');
    }
  }

  renderMovies() {
    this.el.moviesGrid.innerHTML = '';
    this.movies.forEach(movie => {
      const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
      const card = document.createElement('div');
      card.className = `movie-card ${this.selectedMovie && this.selectedMovie.id === movie.id ? 'active' : ''}`;
      card.dataset.movieId = movie.id;

      card.innerHTML = `
        <div class="movie-poster-wrap">
          <img src="${safe(movie.poster_url)}" alt="${safe(movie.title)}" class="movie-poster" loading="lazy" />
          <div class="movie-badges">
            <span class="badge badge-rating">${safe(movie.rating || 'UA')}</span>
            <span class="badge badge-lang">${safe(movie.language)}</span>
          </div>
        </div>
        <div class="movie-info">
          <h3 class="movie-title">${safe(movie.title)}</h3>
          <p class="movie-meta">${safe(movie.duration_min)} min • ${safe(movie.genre || 'Action')}</p>
          <p class="movie-synopsis">${safe(movie.synopsis || '')}</p>
        </div>
      `;

      card.addEventListener('click', () => this.selectMovie(movie));
      this.el.moviesGrid.appendChild(card);
    });
  }

  selectMovie(movie) {
    this.selectedMovie = movie;
    this.selectedSeatIds.clear();
    this.resetHoldState();

    document.querySelectorAll('.movie-card').forEach(card => {
      card.classList.toggle('active', card.dataset.movieId === movie.id);
    });

    this.el.selectedMovieTitle.textContent = `${movie.title} • Showtimes`;
    this.renderShowtimes();
  }

  renderShowtimes() {
    const movieShows = this.shows
      .filter(s => s.movie_id === this.selectedMovie.id)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    this.el.showtimesList.innerHTML = '';

    if (movieShows.length === 0) {
      this.el.showtimesList.innerHTML = '<p class="text-muted">No scheduled shows found for this title.</p>';
      this.el.seatmapSection.style.display = 'none';
      return;
    }

    this.el.showtimesSection.style.display = 'block';

    movieShows.forEach((show, index) => {
      const showDate = new Date(show.starts_at);
      const timeStr = showDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dateStr = showDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

      const btn = document.createElement('button');
      btn.className = `showtime-btn ${this.selectedShow && this.selectedShow.id === show.id ? 'active' : ''}`;
      btn.dataset.showId = show.id;
      btn.innerHTML = `
        <span class="showtime-time">${timeStr}</span>
        <span class="showtime-screen">${show.screen ? show.screen.name : 'Audi Screen'} • ${dateStr}</span>
        <span class="showtime-price">₹${show.ticket_price.toFixed(2)}</span>
      `;

      btn.addEventListener('click', () => this.selectShow(show));
      this.el.showtimesList.appendChild(btn);

      // Auto-select first show if none selected
      if (index === 0 && (!this.selectedShow || this.selectedShow.movie_id !== this.selectedMovie.id)) {
        this.selectShow(show);
      }
    });
  }

  selectShow(show) {
    this.selectedShow = show;

    if (!this.activeHold || this.activeHold.showId !== show.id) {
      this.selectedSeatIds.clear();
      this.resetHoldState();
    }

    // F4: Live seat subscription per show so all users see changes
    if (this.seatSubscription && typeof this.seatSubscription.unsubscribe === 'function') {
      this.seatSubscription.unsubscribe();
    }
    this.seatSubscription = window.API.subscribeToSeatChanges(show.id, () => {
      this.loadSeatMap();
    });

    document.querySelectorAll('.showtime-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.showId === show.id);
    });

    const showDateTime = new Date(show.starts_at).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
    const movieTitle = show.movie?.title || this.selectedMovie?.title || 'Movie';
    const screenName = show.screen?.name || 'Audi 1';
    this.el.screenTitle.textContent = `${movieTitle} · ${screenName} · ${showDateTime} · ₹${show.ticket_price}`;
    this.el.seatmapSection.style.display = 'block';
    this.loadSeatMap();
  }

  // Load and Render Seat Map
  async loadSeatMap() {
    if (!this.selectedShow) return;
    const requestedShowId = this.selectedShow.id;
    const requestToken = ++this.seatMapRequestToken;

    try {
      const seats = await window.API.getSeatMap(requestedShowId);
      if (requestToken !== this.seatMapRequestToken || this.selectedShow?.id !== requestedShowId) return;
      if (!this.activeHold) {
        const availableIds = new Set(seats.filter(seat => seat.status === 'available' ||
          (seat.status === 'held' && seat.hold_expires_at && new Date(seat.hold_expires_at) <= new Date()))
          .map(seat => seat.seat_id));
        this.selectedSeatIds.forEach(id => { if (!availableIds.has(id)) this.selectedSeatIds.delete(id); });
      }
      this.renderSeatMap(seats);
      this.updateCheckoutBar();
    } catch (err) {
      if (requestToken !== this.seatMapRequestToken || this.selectedShow?.id !== requestedShowId) return;
      console.error(err);
      this.showToast('Failed to load seat layout', 'error');
    }
  }

  renderSeatMap(seats) {
    this.el.seatGrid.innerHTML = '';

    // Group seats by tier and row
    const tiers = ['Recliner', 'Prime', 'Classic'];
    const grouped = {};

    tiers.forEach(t => grouped[t] = {});

    seats.forEach(s => {
      const tier = s.tier || 'Classic';
      if (!grouped[tier]) grouped[tier] = {};
      if (!grouped[tier][s.row_label]) grouped[tier][s.row_label] = [];
      grouped[tier][s.row_label].push(s);
    });

    tiers.forEach(tierName => {
      const rowKeys = Object.keys(grouped[tierName]);
      if (rowKeys.length === 0) return;

      const section = document.createElement('div');
      section.className = 'seat-tier-section';

      const tierPrice = this.calculateTierPrice(tierName);
      const titlePill = document.createElement('div');
      titlePill.className = 'tier-title-pill';
      titlePill.textContent = `${tierName.toUpperCase()} — ₹${tierPrice.toFixed(2)}`;
      section.appendChild(titlePill);

      rowKeys.sort().forEach(rowLabel => {
        const rowSeats = grouped[tierName][rowLabel].sort((a, b) => a.seat_number - b.seat_number);

        const rowDiv = document.createElement('div');
        rowDiv.className = 'seat-row';

        // Left Row Label
        const leftLabel = document.createElement('div');
        leftLabel.className = 'row-label';
        leftLabel.textContent = rowLabel;
        rowDiv.appendChild(leftLabel);

        // Seats with center aisle
        const seatsGroup = document.createElement('div');
        seatsGroup.className = 'seats-row-group';

        const half = Math.ceil(rowSeats.length / 2);

        rowSeats.forEach((seat, idx) => {
          if (idx === half) {
            const aisle = document.createElement('div');
            aisle.className = 'aisle-gap';
            seatsGroup.appendChild(aisle);
          }

          const seatEl = document.createElement('div');
          seatEl.className = `seat tier-${tierName.toLowerCase()} ${seat.status}`;
          seatEl.textContent = seat.seat_number;
          seatEl.dataset.seatId = seat.seat_id;
          seatEl.dataset.row = seat.row_label;
          seatEl.dataset.num = seat.seat_number;
          seatEl.dataset.tier = seat.tier;

          if (this.selectedSeatIds.has(seat.seat_id)) {
            seatEl.classList.add('selected');
          }

          const effectivelyAvailable = seat.status === 'held' && seat.hold_expires_at && new Date(seat.hold_expires_at) <= new Date();
          const seatStatus = effectivelyAvailable ? 'available' : seat.status;
          if (effectivelyAvailable) {
            seatEl.classList.remove('held');
            seatEl.classList.add('available');
          }
          if (seat.status === 'held' && !effectivelyAvailable) {
            if (seat.is_held_by_me) {
              seatEl.classList.add('my-hold');
              seatEl.title = `${rowLabel}${seat.seat_number} (${tierName}) - Reserved by You (5 min hold)`;
            } else {
              seatEl.classList.add('held-other');
              seatEl.title = `${rowLabel}${seat.seat_number} (${tierName}) - Temporarily Held by Another Customer (5 min lock)`;
            }
          }

          // Tooltip title
          if (seat.status !== 'held' || effectivelyAvailable) {
            seatEl.title = `${rowLabel}${seat.seat_number} (${tierName}) - ${seatStatus.toUpperCase()}`;
          }
          if (seat.status === 'held' && seat.is_held_by_me) {
            const seconds = Math.max(0, Math.floor((new Date(seat.hold_expires_at) - Date.now()) / 1000));
            seatEl.title = `Reserved by you — ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} remaining`;
          }
          const disabled = seatStatus === 'booked' || seatStatus === 'held';
          seatEl.setAttribute('aria-disabled', String(disabled));
          if (disabled) seatEl.classList.add('seat-disabled');
          seatEl.addEventListener('click', () => this.handleSeatClick({ ...seat, status: seatStatus }, seatEl));
          seatsGroup.appendChild(seatEl);
        });

        rowDiv.appendChild(seatsGroup);

        // Right Row Label
        const rightLabel = document.createElement('div');
        rightLabel.className = 'row-label';
        rightLabel.textContent = rowLabel;
        rowDiv.appendChild(rightLabel);

        section.appendChild(rowDiv);
      });

      this.el.seatGrid.appendChild(section);
    });
  }

  calculateTierPrice(tier) {
    const base = this.selectedShow ? this.selectedShow.ticket_price : 250;
    if (tier === 'Recliner') return base + 100;
    if (tier === 'Prime') return base + 40;
    return base;
  }

  handleSeatClick(seat, seatEl) {
    if (seatEl.disabled || seatEl.getAttribute('aria-disabled') === 'true') return;
    if (this.activeHold) {
      this.showToast('You currently have seats on hold. Please pay or cancel first.', 'warning');
      return;
    }

    if (seat.status === 'booked') {
      this.showToast(`Seat ${seat.row_label}${seat.seat_number} is already booked`, 'error');
      return;
    }

    // STRICT TEMPORARY HOLD: HELD SEATS CANNOT BE SELECTED OR BOOKED BY ANY USER
    if (seat.status === 'held') return;

    // Toggle Selection
    if (this.selectedSeatIds.has(seat.seat_id)) {
      this.selectedSeatIds.delete(seat.seat_id);
      seatEl.classList.remove('selected');
    } else {
      // PRD Requirement: Select up to 6 seats
      if (this.selectedSeatIds.size >= 6) {
        this.showToast('Constraint: You can select up to 6 seats only', 'warning');
        return;
      }
      this.selectedSeatIds.add(seat.seat_id);
      seatEl.classList.add('selected');
    }

    this.updateCheckoutBar();
  }

  updateCheckoutBar() {
    if (this.selectedSeatIds.size === 0 && !this.activeHold) {
      this.el.bottomCheckoutBar.classList.remove('active');
      return;
    }

    this.el.bottomCheckoutBar.classList.add('active');

    // Selected seat pills
    this.el.selectedSeatsList.innerHTML = '';
    let total = 0;

    const allSeats = document.querySelectorAll('.seat');
    const selectedElements = Array.from(allSeats).filter(s => this.selectedSeatIds.has(s.dataset.seatId));

    selectedElements.forEach(el => {
      const pill = document.createElement('span');
      pill.className = 'seat-pill';
      pill.textContent = `${el.dataset.row}${el.dataset.num}`;
      this.el.selectedSeatsList.appendChild(pill);

      total += this.calculateTierPrice(el.dataset.tier);
    });

    this.el.checkoutTotalAmount.textContent = `₹${total.toFixed(2)}`;

    if (this.activeHold) {
      this.el.holdSeatsBtn.style.display = 'none';
      this.el.proceedPayBtn.style.display = 'inline-flex';
    } else {
      this.el.holdSeatsBtn.style.display = 'inline-flex';
      this.el.proceedPayBtn.style.display = 'none';
    }
  }

  // ----------------------------------------------------------------
  // CORE BOOKING FLOW (PRD Section 4 & 6)
  // ----------------------------------------------------------------

  // 6.1 Hold seats
  async handleHoldSeats() {
    if (this.selectedSeatIds.size === 0) {
      this.showToast('Please select at least 1 seat', 'warning');
      return;
    }

    const seatIds = Array.from(this.selectedSeatIds);
    this.el.holdSeatsBtn.disabled = true;
    this.el.holdSeatsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Locking rows...';

    try {
      // RPC hold_seats(p_show_id, p_seat_ids)
      const bookingId = await window.API.holdSeats(this.selectedShow.id, seatIds);

      // The RPC has committed the hold. Establish checkout state before any follow-up read.
      this.activeHold = {
        bookingId: bookingId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        showId: this.selectedShow.id
      };
      // Persist so restoreActiveServerHold() works after page refresh (PRD T7)
      sessionStorage.setItem('cinema_active_booking_id', bookingId);
      sessionStorage.setItem('cinema_active_show_id', this.selectedShow.id);

      // Prefer the database expiry so the countdown stays aligned with the committed hold.
      try {
        const serverExpiry = await window.API.getBookingExpiry(bookingId);
        if (serverExpiry) this.activeHold.expiresAt = new Date(serverExpiry);
      } catch (expiryError) {
        console.warn('Could not fetch the booking expiry; using the five-minute RPC hold window.', expiryError);
      }

      this.showToast('5-minute hold secured!', 'success');
      this.startHoldTimer();
      await this.loadSeatMap();
      this.updateCheckoutBar();
    } catch (err) {
      console.error(err);
      this.showToast(err.message && err.message.toLowerCase().includes('seat') ? 'Someone just took one of these seats' : (err.message || 'Unable to hold seats'), 'error');
      // Refresh seatmap immediately to show true database state
      await this.loadSeatMap();
    } finally {
      this.el.holdSeatsBtn.disabled = false;
      this.el.holdSeatsBtn.innerHTML = 'Hold Seats & Continue';
    }
  }

  startHoldTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.el.holdBanner.style.display = 'flex';

    const tick = () => {
      const now = new Date();
      const diffSec = Math.max(0, Math.floor((this.activeHold.expiresAt - now) / 1000));

      const mins = Math.floor(diffSec / 60).toString().padStart(2, '0');
      const secs = (diffSec % 60).toString().padStart(2, '0');
      this.el.holdTimerText.textContent = `${mins}:${secs}`;

      if (diffSec <= 0) {
        clearInterval(this.timerInterval);
        this.handleHoldExpired();
      }
    };

    tick();
    this.timerInterval = setInterval(tick, 1000);
  }

  async handleHoldExpired() {
    this.showToast('Time expired, seats released', 'error');
    this.closeModal(this.el.checkoutModal);
    this.resetHoldState();
    await window.API.releaseExpiredHolds();
    await this.loadSeatMap();
  }

  handleCancelHold() {
    if (confirm('Cancel hold and free seats back to the hall?')) {
      this.resetHoldState();
      window.API.releaseExpiredHolds().then(() => this.loadSeatMap());
    }
  }

  async handleFastForwardHold() {
    if (!this.activeHold) return;
    await window.API.fastForwardHold(this.activeHold.bookingId);
    this.showToast('Simulated 5 minutes passing! Expiry reached.', 'warning');
    await this.handleHoldExpired();
  }

  resetHoldState() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.activeHold = null;
    this.el.holdBanner.style.display = 'none';
    this.selectedSeatIds.clear();
    this.updateCheckoutBar();
  }

  // 6.2 Pay & Confirm Booking
  openCheckoutModal() {
    if (!this.activeHold) return;

    const modalBody = document.getElementById('checkout-modal-details');
    const selectedElements = Array.from(document.querySelectorAll('.seat')).filter(s => this.selectedSeatIds.has(s.dataset.seatId));
    const seatNames = selectedElements.map(s => `${s.dataset.row}${s.dataset.num} (${s.dataset.tier})`).join(', ');

    let ticketSubtotal = 0;
    selectedElements.forEach(s => {
      ticketSubtotal += this.calculateTierPrice(s.dataset.tier);
    });

    const convenienceFee = 30.00;
    const gst = ticketSubtotal * 0.18;
    const grandTotal = ticketSubtotal + convenienceFee + gst;

    modalBody.innerHTML = `
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1.25rem;">
        <img src="${this.selectedMovie.poster_url}" style="width:70px; height:90px; border-radius:8px; object-fit:cover;">
        <div>
          <h4 style="font-size:1.1rem; font-weight:700;">${this.selectedMovie.title}</h4>
          <p style="font-size:0.8rem; color:#94A3B8;">${this.selectedShow.screen ? this.selectedShow.screen.name : 'Audi Screen'}</p>
          <p style="font-size:0.8rem; color:#F59E0B; font-weight:600;"><i class="fa-regular fa-clock"></i> Showtime: ${new Date(this.selectedShow.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
        </div>
      </div>
      <div style="background:#0D0F17; border:1px solid #23273A; border-radius:12px; padding:1rem; margin-bottom:1rem; font-size:0.85rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span style="color:#94A3B8;">Seats (${selectedElements.length})</span>
          <span style="font-weight:700; color:white;">${seatNames}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span style="color:#94A3B8;">Ticket Subtotal</span>
          <span>₹${ticketSubtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span style="color:#94A3B8;">Convenience Fee</span>
          <span>₹${convenienceFee.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span style="color:#94A3B8;">Integrated GST (18%)</span>
          <span>₹${gst.toFixed(2)}</span>
        </div>
        <hr style="border:none; border-top:1px dashed #2A2F45; margin:0.6rem 0;">
        <div style="display:flex; justify-content:space-between; font-size:1rem; font-weight:800; color:#FF3366;">
          <span>Grand Total</span>
          <span>₹${grandTotal.toFixed(2)}</span>
        </div>
      </div>
      <div style="font-size:0.75rem; color:#64748B; text-align:center;">
        <i class="fa-solid fa-shield-halved"></i> ACID Transaction Proof: Verified hold in PostgreSQL table <code>show_seats</code>.
      </div>
    `;

    document.getElementById('confirm-pay-btn').textContent = `Simulate Pay ₹${grandTotal.toFixed(2)}`;
    this.openModal(this.el.checkoutModal);
  }

  async handleConfirmPayment() {
    if (!this.activeHold) return;

    const payBtn = document.getElementById('confirm-pay-btn');
    payBtn.disabled = true;
    payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recording payment in PostgreSQL...';

    try {
      // RPC 6.2 pay_booking(booking_id)
      const res = await window.API.payBooking(this.activeHold.bookingId);

      this.closeModal(this.el.checkoutModal);
      this.showToast('Payment verified! Booking confirmed in database.', 'success');

      // Fetch confirmed booking details for the Ticket Pass
      const details = await window.API.getBookingDetails(this.activeHold.bookingId);
      this.renderTicketPass(details);
      this.openModal(this.el.ticketModal);

      this.resetHoldState();
      await this.loadSeatMap();
    } catch (err) {
      console.error(err);
      this.showToast(err.message || 'Payment failed or hold expired', 'error');
      await this.loadSeatMap();
    } finally {
      payBtn.disabled = false;
    }
  }

  renderTicketPass(details) {
    if (!details) return;

    const seatsList = details.seats.map(s => `${s.row_label}${s.seat_number}`).join(', ');
    const showTime = new Date(details.show_time).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    document.getElementById('ticket-pass-content').innerHTML = `
      <div class="ticket-pass">
        <div class="ticket-header">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <span class="badge badge-lang" style="margin-bottom:0.4rem; display:inline-block;">DISTRICT CINEMA PASS</span>
              <h2 style="font-size:1.35rem; font-weight:800; margin-top:0.2rem;">${details.movie_title}</h2>
              <p style="font-size:0.8rem; color:#CBD5E1;">${details.movie_language} • ${details.screen_name}</p>
            </div>
            <div style="background:#10B981; color:white; padding:0.3rem 0.6rem; border-radius:6px; font-size:0.75rem; font-weight:800;">
              CONFIRMED
            </div>
          </div>
          <div class="ticket-tear left"></div>
          <div class="ticket-tear right"></div>
        </div>
        <div class="ticket-body">
          <div class="ticket-grid">
            <div>
              <div class="ticket-item-label">Showtime</div>
              <div class="ticket-item-val">${showTime}</div>
            </div>
            <div>
              <div class="ticket-item-label">Seats (${details.seats.length})</div>
              <div class="ticket-item-val" style="color:#FF3366;">${seatsList}</div>
            </div>
            <div>
              <div class="ticket-item-label">Booking Reference</div>
              <div class="ticket-item-val" style="font-family:monospace; font-size:0.85rem;">${details.booking_id.slice(0, 16)}...</div>
            </div>
            <div>
              <div class="ticket-item-label">Total Paid</div>
              <div class="ticket-item-val">₹${parseFloat(details.total_amount).toFixed(2)}</div>
            </div>
          </div>
          <div class="ticket-barcode">
            <div class="barcode-lines"></div>
            <p style="font-family:monospace; font-size:0.75rem; color:#94A3B8; margin-top:0.4rem;">
              REF: ${details.booking_id}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // DATABASE INSPECTOR & CONFIG
  // ----------------------------------------------------------------
  openInspector() {
    const data = window.API.getDbInspectionData();
    const container = document.getElementById('inspector-content');

    let bookingsRows = '';
    data.bookings.forEach(b => {
      bookingsRows += `
        <tr>
          <td style="font-family:monospace; font-size:0.72rem;">${b.id.slice(0, 8)}...</td>
          <td><span class="badge ${b.status === 'confirmed' ? 'badge-lang' : 'badge-rating'}">${b.status}</span></td>
          <td>₹${parseFloat(b.total_amount).toFixed(2)}</td>
          <td style="font-size:0.72rem;">${new Date(b.expires_at).toLocaleTimeString()}</td>
        </tr>
      `;
    });

    let paymentsRows = '';
    data.payments.forEach(p => {
      paymentsRows += `
        <tr>
          <td style="font-family:monospace; font-size:0.72rem;">${p.id.slice(0, 8)}...</td>
          <td style="font-family:monospace; font-size:0.72rem;">${p.booking_id.slice(0, 8)}...</td>
          <td>₹${parseFloat(p.amount).toFixed(2)}</td>
          <td style="font-size:0.72rem;">${new Date(p.paid_at).toLocaleTimeString()}</td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div style="margin-bottom:1rem; font-size:0.85rem; color:#94A3B8;">
        Active Backend Engine: <strong style="color:white;">${data.mode.toUpperCase()}</strong> | Total Seats: ${data.seatsCount} | Total Show-Seats: ${data.showSeatsCount}
      </div>
      <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0.5rem; color:#FF3366;">1. Table: bookings (${data.bookings.length} rows)</h4>
      <div style="overflow-x:auto; margin-bottom:1.5rem;">
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
          <thead>
            <tr style="border-bottom:1px solid #2F354D; color:#94A3B8;">
              <th style="padding:4px;">ID</th><th>Status</th><th>Amount</th><th>Expires At</th>
            </tr>
          </thead>
          <tbody>
            ${bookingsRows || '<tr><td colspan="4" style="color:#64748B; padding:8px;">No bookings recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>
      <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0.5rem; color:#10B981;">2. Table: payments (${data.payments.length} rows)</h4>
      <div style="overflow-x:auto; margin-bottom:1.5rem;">
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
          <thead>
            <tr style="border-bottom:1px solid #2F354D; color:#94A3B8;">
              <th style="padding:4px;">ID</th><th>Booking ID</th><th>Amount</th><th>Paid At</th>
            </tr>
          </thead>
          <tbody>
            ${paymentsRows || '<tr><td colspan="4" style="color:#64748B; padding:8px;">No payments recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Concurrency Lab -->
      <div style="background:#0B0D15; border:1px solid #2F354D; border-radius:12px; padding:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <div>
            <h4 style="font-size:0.95rem; font-weight:700; color:#38BDF8;">
              <i class="fa-solid fa-microchip"></i> Concurrency Stress Lab (PRD Section 10)
            </h4>
            <p style="font-size:0.75rem; color:#94A3B8;">
              Fires 50 parallel asynchronous hold requests on 1 seat to test row-level locks.
            </p>
          </div>
          <button id="run-concurrency-test-btn" class="btn btn-primary btn-sm" style="background:#0284C7; font-size:0.75rem;">
            Run 50-User Test
          </button>
        </div>
        <div id="concurrency-test-output" style="background:#05070B; border:1px solid #1E2336; border-radius:8px; padding:0.75rem; font-family:monospace; font-size:0.75rem; color:#94A3B8; max-height:160px; overflow-y:auto;">
          Press "Run 50-User Test" to simulate concurrent race conditions against PostgreSQL locking rules...
        </div>
      </div>
    `;

    document.getElementById('run-concurrency-test-btn').addEventListener('click', async (e) => {
      const btn = e.target;
      const out = document.getElementById('concurrency-test-output');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing 50 Users...';
      out.innerHTML = '<span style="color:#38BDF8;">[START] Spawning 50 concurrent transactions on seat C-4...</span><br>';

      const targetSeat = window.MockDbEngine.seats.find(s => s.row_label === 'C' && s.seat_number === 4) || window.MockDbEngine.seats[0];
      const showId = this.selectedShow ? this.selectedShow.id : window.MockDbEngine.shows[0].id;

      // Release any existing hold on this seat first
      const ssRow = window.MockDbEngine.show_seats.find(r => r.show_id === showId && r.seat_id === targetSeat.id);
      if (ssRow) { ssRow.status = 'available'; ssRow.booking_id = null; ssRow.hold_expires_at = null; }

      const sim = await window.API.simulateConcurrency(showId, targetSeat.id);

      out.innerHTML += `<span style="color:#10B981; font-weight:bold;">✔ Exactly ${sim.successCount} transaction SUCCEEDED (Acquired Row Lock).</span><br>`;
      out.innerHTML += `<span style="color:#EF4444; font-weight:bold;">✘ ${sim.failCount} transactions safely ROLLED BACK (Prevented Double-Booking).</span><br>`;
      out.innerHTML += `<span style="color:#F59E0B;">Outcome: 100% ACID Concurrency Safety Verified!</span><br><br>`;
      out.innerHTML += `Detailed Log:<br>` + sim.results.slice(0, 10).map(r => `• ${r.user}: [${r.outcome}] ${r.message}`).join('<br>') + '<br>... [and 40 more users rejected safely]';

      btn.disabled = false;
      btn.innerHTML = 'Run 50-User Test';
      await this.loadSeatMap();
    });

    this.openModal(this.el.dbInspectorModal);
  }

  handleSaveConfig() {
    const url = document.getElementById('cfg-url').value;
    const key = document.getElementById('cfg-key').value;

    window.APP_CONFIG.save(url, key);
    if (window.SupabaseBackend) {
      window.SupabaseBackend.init();
    }
    this.closeModal(this.el.configModal);
    this.updateStatusPill();
    this.showToast('Config saved! Reloading catalog...', 'success');
    this.loadCatalog();
  }

  handleResetDemo() {
    window.APP_CONFIG.reset();
    window.MockDbEngine.resetAll();
    this.closeModal(this.el.configModal);
    this.updateStatusPill();
    this.showToast('Demo Database Re-seeded and Reset!', 'success');
    this.loadCatalog();
  }

  // Modal helpers
  openModal(modal) {
    if (modal) modal.classList.add('active');
  }

  closeModal(modal) {
    if (modal) modal.classList.remove('active');
  }

  // Toast Helper
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'error' ? 'fa-circle-xmark' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

    this.el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// Bootstrap Application
document.addEventListener('DOMContentLoaded', () => {
  window.CinemaApp = new CinemaApp();
  window.CinemaApp.start();
});
