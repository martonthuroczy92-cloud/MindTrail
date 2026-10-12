import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let admin;

// Service-role client: bypasses RLS. Only used inside API functions, and every query
// it runs is additionally filtered by the authenticated owner's user_id.
export function adminClient() {
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export const AUDIO_BUCKET = 'audio';
