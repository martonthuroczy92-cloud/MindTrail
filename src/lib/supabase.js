import { createClient } from '@supabase/supabase-js';

/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__ */
// Public values injected at build time (see vite.config.js). The anon key is safe in the
// browser: every table has RLS and the storage bucket has no client policies.
export const supabase = createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const AUDIO_BUCKET = 'audio';
