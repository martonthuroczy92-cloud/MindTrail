// POST → creates a recording row and returns a signed upload URL for the audio file.
// The browser uploads straight to Supabase Storage, so the file never passes through a
// Vercel function (whose request body limit is 4.5 MB).
import { randomUUID } from 'node:crypto';
import { adminClient, AUDIO_BUCKET } from './_lib/supabase.js';
import { requireOwner } from './_lib/auth.js';
import { handler, json, readJson } from './_lib/http.js';
import { extensionFor, validateNewRecording } from './_lib/recordings.js';

export const POST = handler(async (request) => {
  const user = await requireOwner(request);
  const v = validateNewRecording(await readJson(request));

  const id = randomUUID();
  const path = `${user.id}/${id}/original.${extensionFor(v.fileName, v.mime)}`;
  const db = adminClient();

  const { error } = await db.from('recordings').insert({
    id,
    user_id: user.id,
    title: v.title,
    context_tag: v.contextTag,
    language: v.language,
    source: v.source,
    audio_path: path,
    audio_mime: v.mime || null,
    audio_bytes: v.size,
    consent_confirmed: true,
  });
  if (error) throw error;

  const { data: signed, error: signError } = await db.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path);
  if (signError) throw signError;

  return json({ recording_id: id, upload: { path: signed.path, token: signed.token } }, 201);
}, 'recordings.create');
