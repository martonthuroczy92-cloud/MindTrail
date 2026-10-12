// POST { email } → emails a magic sign-in link, but only to OWNER_EMAIL.
// The response is identical for every address, so it does not reveal who the owner is.
import { Resend } from 'resend';
import { adminClient } from './_lib/supabase.js';
import { env } from './_lib/env.js';
import { isOwnerEmail } from './_lib/auth.js';
import { handler, json, readJson, HttpError } from './_lib/http.js';
import { logError } from './_lib/log.js';

const GENERIC = { ok: true, message: 'If this address is allowed, a sign-in link is on its way.' };

async function ensureOwnerUser(email) {
  const db = adminClient();
  // Sign-ups are disabled in Supabase Auth; the admin API is the only way a user is created.
  const { error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error && error.code !== 'email_exists' && !/already/i.test(error.message)) throw error;
}

export const POST = handler(async (request) => {
  const { email } = await readJson(request);
  if (typeof email !== 'string' || !email.includes('@') || email.length > 320) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  const normalised = email.trim().toLowerCase();
  if (!isOwnerEmail(normalised)) return json(GENERIC);

  await ensureOwnerUser(normalised);
  const db = adminClient();
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: normalised,
    options: { redirectTo: env.appUrl },
  });
  if (error) throw error;

  // Create the settings row on first sign-in (no-op afterwards).
  if (data.user?.id) {
    const { error: settingsError } = await db
      .from('settings')
      .upsert({ user_id: data.user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (settingsError) logError('login.settings', settingsError);
  }

  const link = data.properties.action_link;
  const resend = new Resend(env.resendApiKey);
  const { error: mailError } = await resend.emails.send({
    from: env.mailFrom,
    to: normalised,
    subject: 'Your MindTrail sign-in link',
    text: `Tap to sign in to MindTrail:\n\n${link}\n\nThe link works once and expires in 1 hour. If you did not ask for it, ignore this email.`,
  });
  if (mailError) {
    logError('login.resend', mailError);
    throw new HttpError(502, 'The sign-in email could not be sent. Check the Resend setup.');
  }
  return json(GENERIC);
}, 'login');
