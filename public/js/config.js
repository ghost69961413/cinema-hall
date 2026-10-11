// ==============================================================
// CINEMA HALL TICKET BOOKING SYSTEM - CONFIGURATION
// ==============================================================

const CONFIG = {
  // Production builds inject these from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
  // Local development can still use the existing configuration dialog.
  SUPABASE_URL: window.CINEMA_BUILD_ENV?.VITE_SUPABASE_URL || localStorage.getItem('cinema_supabase_url') || '',
  SUPABASE_ANON_KEY: window.CINEMA_BUILD_ENV?.VITE_SUPABASE_ANON_KEY || localStorage.getItem('cinema_supabase_key') || '',

  // Fallback to demo mode if no valid Supabase URL is supplied
  isConfigured() {
    return Boolean(this.SUPABASE_URL && this.SUPABASE_ANON_KEY && this.SUPABASE_URL.startsWith('https://'));
  },

  save(url, key) {
    this.SUPABASE_URL = url.trim();
    this.SUPABASE_ANON_KEY = key.trim();
    localStorage.setItem('cinema_supabase_url', this.SUPABASE_URL);
    localStorage.setItem('cinema_supabase_key', this.SUPABASE_ANON_KEY);
  },

  reset() {
    this.SUPABASE_URL = '';
    this.SUPABASE_ANON_KEY = '';
    localStorage.removeItem('cinema_supabase_url');
    localStorage.removeItem('cinema_supabase_key');
  }
};

window.APP_CONFIG = CONFIG;
