// Server-side configuration. Never import this file from src/ (browser code).
// The Vercel ↔ Supabase integration has used different variable names over time, so each
// value accepts the known aliases. Run `vercel env ls` to see which ones your project has.

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
    return required('SUPABASE_URL', first('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'));
  },
  get supabaseServiceKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY', first('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'));
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
