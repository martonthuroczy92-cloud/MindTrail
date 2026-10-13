// Server-side configuration. Never import this file from src/ (browser code).
// Supabase variables are found with or without a prefix (see env-lookup.js).
import { findEnv, SUPABASE_SERVER_KEY_NAMES, SUPABASE_URL_NAMES } from './env-lookup.js';

function first(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function required(label, value) {
  if (!value) throw new Error(`Missing environment variable: ${label}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL', findEnv(process.env, SUPABASE_URL_NAMES)?.value);
  },
  get supabaseServiceKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY', findEnv(process.env, SUPABASE_SERVER_KEY_NAMES)?.value);
  },
  get ownerEmail() {
    return required('OWNER_EMAIL', first('OWNER_EMAIL'))?.toLowerCase();
  },
  get resendApiKey() {
    return required('RESEND_API_KEY', first('RESEND_API_KEY'));
  },
  get mailFrom() {
    return first('MAIL_FROM') ?? 'MindTrail <onboarding@resend.dev>';
  },
  get appUrl() {
    const explicit = first('APP_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const prod = first('VERCEL_PROJECT_PRODUCTION_URL');
    if (prod) return `https://${prod}`;
    return 'http://localhost:5173';
  },
  get transcribeModel() {
    return first('TRANSCRIBE_MODEL') ?? 'openai/whisper-1';
  },
};
