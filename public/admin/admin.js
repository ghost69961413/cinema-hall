(() => {
  const client = window.APP_CONFIG.isConfigured() && window.supabase
    ? window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY)
    : null;
  const state = { screens: [], movies: [], selectedScreenId: null, shows: [], selectedShowId: null, data: null, editingScreenId: null, channel: null, refreshInterval: null, databaseUpdateHandler: null, countdown: null };
  const $ = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  function toast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('toast-container').appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }
  function money(value) {
    return new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:2 }).format(Number(value || 0));
  }
  function dateTime(value) {
    return value ? new Date(value).toLocaleString([], { dateStyle:'medium', timeStyle:'short' }) : '—';
  }
  function showPickerLabel(show) {
    const movieTitle = state.movies.find(movie => movie.id === show.movie_id)?.title || 'Movie';
    return `${movieTitle} · ${dateTime(show.starts_at)} · ${money(show.ticket_price)}`;
  }

  async function guardRoute() {
    if (window.MockDbEngine?.ready) await window.MockDbEngine.ready;
    if (!client) {
      let localUser = null;
      try { localUser = JSON.parse(sessionStorage.getItem('cinema_active_user') || 'null'); } catch (_) {}
      const localAdmin = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
        && localUser?.id === 'local-cinema-admin' && localUser?.role === 'admin';
      if (!localAdmin) return redirectHome();
      $('local-admin-test-notice').hidden = false;
      $('local-admin-test-notice').querySelector('p').textContent = window.MockDbEngine.sharedConnected
        ? 'Using the local shared test database. Holds and bookings update across regular and incognito windows on this server.'
        : 'Using browser-only demo data. Start the app with python3 serve.py to share holds between regular and incognito windows.';
      $('admin-logout').addEventListener('click', () => {
        sessionStorage.removeItem('cinema_active_user');
        redirectHome();
      });
      await loadMovies();
      await loadScreens();
      state.countdown = setInterval(renderHeldSeats, 1000);
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) return redirectHome();
    const { data: admin, error: adminError } = await client.rpc('is_admin');
    if (adminError || !admin) return redirectHome();
    client.auth.onAuthStateChange((_event, session) => { if (!session) redirectHome(); });
    await loadMovies();
    await loadScreens();
  }
  function redirectHome() { window.location.replace('/'); }

  async function loadMovies() {
    if (client) {
      const { data, error } = await client.from('movies').select('id,title').order('title');
      if (error) { toast(error.message, 'error'); return; }
      state.movies = data || [];
    } else {
      window.MockDbEngine.syncFromStorage();
      state.movies = [...window.MockDbEngine.movies].sort((a, b) => a.title.localeCompare(b.title));
    }
    renderMovieOptions();
  }

  function renderMovieOptions() {
    $('show-movie').innerHTML = state.movies.map(movie => `<option value="${escapeHtml(movie.id)}">${escapeHtml(movie.title)}</option>`).join('');
  }

  async function loadScreens() {
    if (!client) {
      window.MockDbEngine.syncFromStorage();
      state.screens = [...window.MockDbEngine.screens].sort((a, b) => a.name.localeCompare(b.name));
      if (!state.screens.some(screen => screen.id === state.selectedScreenId)) state.selectedScreenId = state.screens[0]?.id || null;
      renderScreens();
      if (state.selectedScreenId) await selectScreen(state.selectedScreenId);
      else clearDetails('No cinemas are available. Add one to get started.');
      return;
    }
    const { data, error } = await client.from('screens').select('id,name,screen_type').order('name');
    if (error) return toast(error.message, 'error');
    state.screens = data || [];
    if (!state.screens.some(screen => screen.id === state.selectedScreenId)) state.selectedScreenId = state.screens[0]?.id || null;
    renderScreens();
    if (state.selectedScreenId) await selectScreen(state.selectedScreenId);
    else clearDetails('No cinemas are available. Add one to get started.');
  }
  function renderScreens() {
    $('cinema-list').innerHTML = state.screens.map(screen => `
      <article class="cinema-item ${screen.id === state.selectedScreenId ? 'active' : ''}" data-screen-id="${escapeHtml(screen.id)}" tabindex="0">
        <div class="cinema-item-main"><div><div class="cinema-item-name">${escapeHtml(screen.name)}</div><div class="cinema-item-detail">${escapeHtml(screen.screen_type || '—')}</div></div>
          <div class="cinema-item-actions"><button type="button" data-action="edit" aria-label="Edit ${escapeHtml(screen.name)}"><i class="fa-solid fa-pen"></i><span>Edit</span></button><button type="button" data-action="delete" aria-label="Delete ${escapeHtml(screen.name)}"><i class="fa-solid fa-trash"></i><span>Delete</span></button></div>
        </div>
      </article>`).join('') || '<p class="cinema-item-detail">No cinemas yet.</p>';
    $('cinema-list').querySelectorAll('.cinema-item').forEach(item => {
      item.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'edit') return beginEdit(item.dataset.screenId);
        if (action === 'delete') return deleteScreen(item.dataset.screenId);
        selectScreen(item.dataset.screenId);
      });
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectScreen(item.dataset.screenId); }
      });
    });
  }
  async function selectScreen(screenId, reload = true) {
    state.selectedScreenId = screenId;
    renderScreens();
    const screen = state.screens.find(item => item.id === screenId);
    $('selected-cinema-title').textContent = screen?.name || 'Select a cinema';
    $('selected-cinema-subtitle').textContent = screen?.screen_type || 'Cinema details';
    if (client) {
      const { data, error } = await client.from('shows').select('id,movie_id,screen_id,starts_at,ticket_price').eq('screen_id', screenId).order('starts_at');
      if (error) return toast(error.message, 'error');
      state.shows = data || [];
    } else {
      window.MockDbEngine.syncFromStorage();
      ensureLocalScreenSeats(screenId);
      state.shows = window.MockDbEngine.shows
        .filter(show => show.screen_id === screenId)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    }
    if (!state.shows.some(show => show.id === state.selectedShowId)) state.selectedShowId = state.shows[0]?.id || null;
    renderShowPicker();
    if (state.selectedShowId) await selectShow(state.selectedShowId, reload);
    else {
      clearRealtime();
      state.data = null;
      renderDashboard();
    }
  }
  function ensureLocalScreenSeats(screenId) {
    const db = window.MockDbEngine;
    if (db.seats.some(seat => seat.screen_id === screenId)) return;
    const layout = [['A',8,'Recliner'],['B',8,'Recliner'],['C',10,'Prime'],['D',10,'Prime'],['E',10,'Classic'],['F',10,'Classic']];
    layout.forEach(([row, count, tier]) => {
      for (let seatNumber = 1; seatNumber <= count; seatNumber++) {
        db.seats.push({ id:`seat-${screenId}-${row}-${seatNumber}`, screen_id:screenId, row_label:row, seat_number:seatNumber, tier });
      }
    });
    db.persist();
  }
  function renderShowPicker() {
    const wrap = $('show-picker-wrap');
    const picker = $('show-picker');
    state.shows.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    wrap.hidden = state.shows.length < 2;
    picker.innerHTML = state.shows.map(show => `<option value="${escapeHtml(show.id)}">${escapeHtml(showPickerLabel(show))}</option>`).join('');
    if (state.selectedShowId) picker.value = state.selectedShowId;
    const screen = state.screens.find(item => item.id === state.selectedScreenId);
    if (screen && state.shows.length === 1) $('selected-cinema-subtitle').textContent = `${screen.screen_type || 'Cinema'} · ${showPickerLabel(state.shows[0])}`;
    if (state.shows.length > 1) $('selected-cinema-subtitle').textContent = `${screen?.screen_type || 'Cinema'} · ${state.shows.length} shows`;
    if (state.shows.length === 0) $('selected-cinema-subtitle').textContent = `${screen?.screen_type || 'Cinema'} · No shows scheduled`;
    $('show-screen').innerHTML = state.screens.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    if (state.selectedScreenId) $('show-screen').value = state.selectedScreenId;
    renderMovieOptions();
    const selectedShow = state.shows.find(show => show.id === state.selectedShowId);
    if (selectedShow) {
      $('show-movie').value = selectedShow.movie_id;
      $('show-starts-at').value = toLocalInput(selectedShow.starts_at);
      $('show-ticket-price').value = selectedShow.ticket_price;
      $('save-show-schedule').textContent = 'Update show schedule';
    } else {
      $('show-starts-at').value = toLocalInput(new Date(Date.now() + 3600000).toISOString());
      $('show-ticket-price').value = '280';
      $('save-show-schedule').textContent = 'Add showtime';
    }
  }
  function toLocalInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  async function selectShow(showId, reload = true) {
    state.selectedShowId = showId;
    $('show-picker').value = showId;
    renderShowPicker();
    clearRealtime();
    subscribe(showId);
    if (reload) await refreshDashboard();
  }
  async function refreshDashboard() {
    if (!state.selectedShowId) return renderDashboard();
    if (!client) {
      const db = window.MockDbEngine;
      db.syncFromStorage();
      db.release_expired_holds();
      const showSeats = db.show_seats.filter(row => row.show_id === state.selectedShowId);
      const bookings = db.bookings.filter(booking => booking.show_id === state.selectedShowId);
      const show = db.shows.find(item => item.id === state.selectedShowId);
      const movie = show && db.movies.find(item => item.id === show.movie_id);
      const getProfile = userId => {
        const profile = db.profiles.find(item => item.id === userId);
        const demoUser = db.getDemoUsers().find(item => item.id === userId);
        return {
          name: profile?.full_name || demoUser?.full_name || 'Guest',
          email: demoUser?.email || (userId === 'local-cinema-admin' ? 'cinemaad@districtcinemas.com' : userId ? `${userId}@districtcinemas.com` : '—')
        };
      };
      const booked = [];
      const held = [];
      showSeats.forEach(row => {
        const seat = db.seats.find(item => item.id === row.seat_id);
        const booking = bookings.find(item => item.id === row.booking_id);
        if (!seat) return;
        const profile = getProfile(booking?.user_id);
        if (row.status === 'booked') {
          const bookedCount = showSeats.filter(item => item.booking_id === booking?.id && item.status === 'booked').length || 1;
          const payment = db.payments.find(item => item.booking_id === booking?.id);
          booked.push({
            seat: `${seat.row_label}${seat.seat_number}`,
            user_name: profile.name,
            user_email: profile.email,
            booking_id: booking?.id || row.booking_id || '—',
            booked_at: payment?.paid_at || booking?.created_at || new Date().toISOString(),
            amount: Number(booking?.total_amount || payment?.amount || show?.ticket_price || 0) / bookedCount
          });
        }
        if (row.status === 'held' && booking && row.hold_expires_at && new Date(row.hold_expires_at) > new Date()) {
          held.push({
            seat: `${seat.row_label}${seat.seat_number}`,
            user_name: profile.name,
            user_email: profile.email,
            show_name: movie?.title || 'Show',
            show_time: show?.starts_at,
            hold_expires_at: row.hold_expires_at
          });
        }
      });
      const confirmedBookings = bookings.filter(booking => booking.status === 'confirmed');
      const amountCollected = db.payments
        .filter(payment => confirmedBookings.some(booking => booking.id === payment.booking_id))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const totalSeats = showSeats.length;
      const bookedCount = showSeats.filter(row => row.status === 'booked').length;
      const heldCount = held.length;
      state.data = {
        summary: {
          total_seats: totalSeats,
          booked_seats: bookedCount,
          held_seats: heldCount,
          available_seats: totalSeats - bookedCount - heldCount,
          total_bookings: bookings.length,
          amount_collected: amountCollected
        },
        booked_seats: booked.sort((a, b) => new Date(b.booked_at) - new Date(a.booked_at)),
        held_seats: held.sort((a, b) => new Date(a.hold_expires_at) - new Date(b.hold_expires_at))
      };
      if (show) $('selected-cinema-subtitle').textContent = `${state.screens.find(item => item.id === show.screen_id)?.screen_type || 'Cinema'} · ${showPickerLabel(show)}`;
      renderDashboard();
      return;
    }
    const { data, error } = await client.rpc('admin_show_data', { p_show_id: state.selectedShowId });
    if (error) return toast(error.message, 'error');
    state.data = data;
    renderDashboard();
  }
  function subscribe(showId) {
    if (!client) {
      state.databaseUpdateHandler = () => refreshDashboard();
      window.addEventListener('database-updated', state.databaseUpdateHandler);
      state.channel = setInterval(refreshDashboard, 2500);
      return;
    }
    state.channel = client.channel(`admin-show-${showId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'show_seats', filter:`show_id=eq.${showId}` }, () => refreshDashboard())
      .on('postgres_changes', { event:'*', schema:'public', table:'bookings', filter:`show_id=eq.${showId}` }, () => refreshDashboard())
      .subscribe(status => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') refreshDashboard();
      });
    // Keep the dashboard fresh if Realtime is unavailable or a database change event is missed.
    state.refreshInterval = setInterval(refreshDashboard, 2500);
  }
  function clearRealtime() {
    if (state.channel) {
      if (client) client.removeChannel(state.channel);
      else clearInterval(state.channel);
    }
    if (state.refreshInterval) {
      clearInterval(state.refreshInterval);
      state.refreshInterval = null;
    }
    if (state.databaseUpdateHandler) {
      window.removeEventListener('database-updated', state.databaseUpdateHandler);
      state.databaseUpdateHandler = null;
    }
    state.channel = null;
  }
  function clearDetails(message) {
    state.data = null;
    $('selected-cinema-title').textContent = 'Select a cinema';
    $('selected-cinema-subtitle').textContent = message;
    $('show-picker-wrap').hidden = true;
    renderDashboard();
  }
  function renderDashboard() {
    const summary = state.data?.summary || {};
    const cards = [
      ['Total seats', summary.total_seats], ['Booked seats', summary.booked_seats], ['Seats on hold', summary.held_seats],
      ['Remaining seats', summary.available_seats], ['Total bookings', summary.total_bookings], ['Amount collected', money(summary.amount_collected)]
    ];
    $('summary-cards').innerHTML = cards.map(([label, value]) => `<article class="summary-card"><div class="summary-card-label">${label}</div><div class="summary-card-value">${value ?? '—'}</div></article>`).join('');
    const search = $('booked-search').value.trim().toLowerCase();
    const booked = (state.data?.booked_seats || []).filter(row => `${row.user_name} ${row.user_email}`.toLowerCase().includes(search));
    $('booked-count').textContent = `${state.data?.booked_seats?.length || 0} seats`;
    $('booked-table-body').innerHTML = booked.length ? booked.map(row => `<tr>
      <td>${escapeHtml(row.seat)}</td><td>${escapeHtml(row.user_name)}</td><td>${escapeHtml(row.user_email)}</td>
      <td class="booking-id">${escapeHtml(row.booking_id)}</td><td>${escapeHtml(dateTime(row.booked_at))}</td><td>${escapeHtml(money(row.amount))}</td></tr>`).join('') : '<tr><td class="table-empty" colspan="6">No booked seats</td></tr>';
    renderHeldSeats();
  }
  function renderHeldSeats() {
    const active = (state.data?.held_seats || []).filter(row => new Date(row.hold_expires_at).getTime() > Date.now());
    const selectedShow = state.shows.find(show => show.id === state.selectedShowId);
    const selectedMovie = state.movies.find(movie => movie.id === selectedShow?.movie_id);
    $('held-count').textContent = `${active.length} seats`;
    $('held-table-body').innerHTML = active.length ? active.map(row => {
      const seconds = Math.max(0, Math.ceil((new Date(row.hold_expires_at).getTime() - Date.now()) / 1000));
      const showName = row.show_name || selectedMovie?.title || state.data?.show?.movie_title || 'Show';
      const showTime = row.show_time || selectedShow?.starts_at || state.data?.show?.starts_at;
      return `<tr><td>${escapeHtml(showName)}</td><td>${escapeHtml(dateTime(showTime))}</td><td>${escapeHtml(row.seat)}</td><td>${escapeHtml(row.user_name)}<br><span class="muted">${escapeHtml(row.user_email)}</span></td><td data-expiry="${escapeHtml(row.hold_expires_at)}">${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}</td></tr>`;
    }).join('') : '<tr><td class="table-empty" colspan="5">No seats on hold</td></tr>';
  }
  async function beginEdit(screenId) {
    const screen = state.screens.find(item => item.id === screenId);
    if (!screen) return;
    await selectScreen(screenId);
    state.editingScreenId = screenId;
    $('cinema-name').value = screen.name;
    $('cinema-detail').value = screen.screen_type || '';
    $('cinema-save').textContent = 'Save changes';
    $('cinema-cancel-edit').hidden = false;
    $('cinema-name').focus();
  }
  function cancelEdit() {
    state.editingScreenId = null;
    $('cinema-form').reset();
    $('cinema-save').textContent = 'Add cinema';
    $('cinema-cancel-edit').hidden = true;
  }
  async function saveScreen(event) {
    event.preventDefault();
    const changes = { name:$('cinema-name').value.trim(), screen_type:$('cinema-detail').value.trim() || 'Standard' };
    if (!changes.name) return;
    if (!client) {
      const db = window.MockDbEngine;
      db.syncFromStorage();
      if (state.editingScreenId) {
        Object.assign(db.screens.find(item => item.id === state.editingScreenId), changes);
      } else {
        const screen = { id: `local-screen-${Date.now()}`, ...changes };
        db.screens.push(screen);
        ensureLocalScreenSeats(screen.id);
        state.selectedScreenId = screen.id;
      }
      db.persist();
      const wasEditing = Boolean(state.editingScreenId);
      cancelEdit();
      await loadScreens();
      window.dispatchEvent(new CustomEvent('database-catalog-updated'));
      toast(wasEditing ? 'Cinema updated' : 'Cinema added', 'success');
      return;
    }
    let result;
    if (state.editingScreenId) result = await client.from('screens').update(changes).eq('id', state.editingScreenId);
    else result = await client.from('screens').insert(changes).select('id').single();
    const { data, error } = result;
    if (error) return toast(error.message, 'error');
    const wasEditing = Boolean(state.editingScreenId);
    const editedId = state.editingScreenId;
    cancelEdit();
    if (!wasEditing) state.selectedScreenId = data.id;
    await loadScreens();
    window.dispatchEvent(new CustomEvent('database-catalog-updated'));
    if (wasEditing && editedId) state.selectedScreenId = editedId;
    toast(wasEditing ? 'Cinema updated' : 'Cinema added', 'success');
  }
  async function saveShowSchedule(event) {
    event.preventDefault();
    const movieId = $('show-movie').value;
    const startsAt = new Date($('show-starts-at').value);
    const ticketPrice = Number($('show-ticket-price').value);
    if (!state.selectedScreenId || !movieId || Number.isNaN(startsAt.getTime()) || !Number.isFinite(ticketPrice) || ticketPrice < 0) {
      return toast('Choose a movie, show time, and valid ticket price.', 'error');
    }
    const existing = state.shows.find(show => show.id === state.selectedShowId);
    if (client) {
      const changes = { movie_id:movieId, starts_at:startsAt.toISOString(), ticket_price:ticketPrice };
      const result = existing
        ? await client.from('shows').update(changes).eq('id', existing.id)
        : await client.from('shows').insert({ ...changes, screen_id:state.selectedScreenId });
      if (result.error) return toast(result.error.message, 'error');
      await selectScreen(state.selectedScreenId);
      window.dispatchEvent(new CustomEvent('database-catalog-updated'));
      toast(existing ? 'Show schedule updated' : 'Showtime added', 'success');
      return;
    }
    const db = window.MockDbEngine;
    db.syncFromStorage();
    let show;
    if (existing) {
      show = db.shows.find(item => item.id === existing.id);
      Object.assign(show, { movie_id:movieId, starts_at:startsAt.toISOString(), ticket_price:ticketPrice });
    } else {
      show = { id:`local-show-${Date.now()}`, movie_id:movieId, screen_id:state.selectedScreenId, starts_at:startsAt.toISOString(), ticket_price:ticketPrice };
      db.shows.push(show);
      db.seats.filter(seat => seat.screen_id === state.selectedScreenId).forEach(seat => {
        db.show_seats.push({ show_id:show.id, seat_id:seat.id, status:'available', booking_id:null, hold_expires_at:null });
      });
    }
    db.persist();
    state.selectedShowId = show.id;
    await selectScreen(state.selectedScreenId);
    window.dispatchEvent(new CustomEvent('database-catalog-updated'));
    toast(existing ? 'Show schedule updated' : 'Showtime added', 'success');
  }

  async function addMovie(event) {
    event.preventDefault();
    const posterUrl = $('movie-poster-url').value.trim();
    let parsedPosterUrl;
    try { parsedPosterUrl = new URL(posterUrl); } catch (_) { return toast('Enter a valid poster image link.', 'error'); }
    if (!['http:', 'https:'].includes(parsedPosterUrl.protocol)) return toast('Poster links must start with http:// or https://.', 'error');
    const movie = {
      title: $('movie-title').value.trim(),
      poster_url: posterUrl,
      language: $('movie-language').value.trim(),
      duration_min: Number($('movie-duration').value),
      genre: $('movie-genre').value.trim() || null,
      rating: $('movie-rating').value.trim() || 'UA',
      synopsis: $('movie-synopsis').value.trim() || null
    };
    if (!movie.title || !movie.language || !Number.isInteger(movie.duration_min) || movie.duration_min < 1) {
      return toast('Enter a title, language, and valid duration.', 'error');
    }
    if (client) {
      const { error } = await client.from('movies').insert(movie);
      if (error) return toast(error.message, 'error');
      await loadMovies();
    } else {
      const db = window.MockDbEngine;
      db.syncFromStorage();
      db.movies.push({ id:`local-movie-${Date.now()}`, ...movie });
      db.persist();
      await loadMovies();
    }
    $('movie-form').reset();
    $('movie-rating').value = 'UA';
    renderMovieOptions();
    window.dispatchEvent(new CustomEvent('database-catalog-updated'));
    toast('Movie added and published to the catalog', 'success');
  }
  async function deleteScreen(screenId) {
    const screen = state.screens.find(item => item.id === screenId);
    if (!screen || !window.confirm(`Delete ${screen.name}? Its shows, bookings and payments will also be deleted.`)) return;
    if (!client) {
      const db = window.MockDbEngine;
      db.syncFromStorage();
      const showIds = db.shows.filter(show => show.screen_id === screenId).map(show => show.id);
      const seatIds = db.seats.filter(seat => seat.screen_id === screenId).map(seat => seat.id);
      const bookingIds = db.bookings.filter(booking => showIds.includes(booking.show_id)).map(booking => booking.id);
      db.screens = db.screens.filter(item => item.id !== screenId);
      db.seats = db.seats.filter(item => item.screen_id !== screenId);
      db.shows = db.shows.filter(item => item.screen_id !== screenId);
      db.show_seats = db.show_seats.filter(item => !showIds.includes(item.show_id) && !seatIds.includes(item.seat_id));
      db.bookings = db.bookings.filter(item => !bookingIds.includes(item.id));
      db.payments = db.payments.filter(item => !bookingIds.includes(item.booking_id));
      if (state.selectedScreenId === screenId) state.selectedScreenId = null;
      db.persist();
      await loadScreens();
      window.dispatchEvent(new CustomEvent('database-catalog-updated'));
      toast('Cinema deleted', 'success');
      return;
    }
    const { error } = await client.from('screens').delete().eq('id', screenId);
    if (error) return toast(error.message, 'error');
    if (state.selectedScreenId === screenId) state.selectedScreenId = null;
    await loadScreens();
    window.dispatchEvent(new CustomEvent('database-catalog-updated'));
    toast('Cinema deleted', 'success');
  }

  $('show-picker').addEventListener('change', event => selectShow(event.target.value));
  $('show-screen').addEventListener('change', event => selectScreen(event.target.value));
  $('movie-form').addEventListener('submit', addMovie);
  $('booked-search').addEventListener('input', renderDashboard);
  $('cinema-form').addEventListener('submit', saveScreen);
  $('show-schedule-form').addEventListener('submit', saveShowSchedule);
  $('cinema-cancel-edit').addEventListener('click', cancelEdit);
  $('admin-logout').addEventListener('click', async () => { await client.auth.signOut(); redirectHome(); });
  state.countdown = setInterval(renderHeldSeats, 1000);
  guardRoute();
})();
