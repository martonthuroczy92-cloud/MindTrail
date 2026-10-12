import { adminClient } from './supabase.js';
import { env } from './env.js';
import { HttpError } from './http.js';

export function isOwnerEmail(email, ownerEmail = env.ownerEmail) {
  if (!email || !ownerEmail) return false;
  return email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

// Verifies the Supabase access token from the Authorization header and enforces the
// single-owner allowlist. Returns the Supabase user.
export async function requireOwner(request) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Not signed in.');

  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session expired. Sign in again.');
  if (!isOwnerEmail(data.user.email)) throw new HttpError(403, 'This account is not allowed.');
  return data.user;
}
