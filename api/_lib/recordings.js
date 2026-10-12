// Validation for new recordings, shared by the API and tests.
import { HttpError } from './http.js';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Free plan per-file limit
export const CONTEXT_TAGS = ['family', 'friends', 'house', 'health admin', 'admin', 'side project', 'other'];
const LANGUAGES = ['auto', 'hu', 'en'];

export function extensionFor(fileName = '', mime = '') {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'm4a';
}

export function validateNewRecording(body) {
  if (body.consent_confirmed !== true) {
    throw new HttpError(400, 'Confirm that everyone in the conversation knows it is recorded and agreed.');
  }
  const title = String(body.title ?? '').trim();
  if (!title || title.length > 200) throw new HttpError(400, 'Give the recording a title (max 200 characters).');
  const contextTag = CONTEXT_TAGS.includes(body.context_tag) ? body.context_tag : 'other';
  const language = LANGUAGES.includes(body.language) ? body.language : 'auto';
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'The file is empty.');
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'The file is larger than 50 MB. Record at a lower quality or split it.');
  }
  const mime = String(body.mime ?? '');
  if (mime && !/^(audio\/|video\/(mp4|webm)$|application\/octet-stream$)/.test(mime)) {
    throw new HttpError(415, 'This does not look like an audio file.');
  }
  const source = body.source === 'in_app' ? 'in_app' : 'upload';
  return { title, contextTag, language, size, mime, source, fileName: String(body.file_name ?? '') };
}

