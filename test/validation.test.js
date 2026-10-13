import { describe, expect, it } from 'vitest';
import { isOwnerEmail } from '../api/_lib/auth.js';
import { extensionFor, validateNewRecording } from '../api/_lib/recordings.js';
import { safeErrorMessage } from '../api/_lib/log.js';
import { transcriptionCost } from '../api/_lib/pricing.js';

describe('owner allowlist', () => {
  it('matches case- and whitespace-insensitively', () => {
    expect(isOwnerEmail(' Me@Example.com ', 'me@example.com')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isOwnerEmail('me@example.com.evil.io', 'me@example.com')).toBe(false);
    expect(isOwnerEmail('', 'me@example.com')).toBe(false);
    expect(isOwnerEmail('me@example.com', '')).toBe(false);
  });
});

describe('validateNewRecording', () => {
  const ok = { title: 'Plumber', consent_confirmed: true, size: 1000, mime: 'audio/mp4', context_tag: 'house', language: 'hu' };

  it('requires consent to be exactly true', () => {
    expect(() => validateNewRecording({ ...ok, consent_confirmed: 'true' })).toThrow(/agreed/);
    expect(() => validateNewRecording({ ...ok, consent_confirmed: false })).toThrow(/agreed/);
  });
  it('rejects files over 50 MB and non-audio types', () => {
    expect(() => validateNewRecording({ ...ok, size: 51 * 1024 * 1024 })).toThrow(/50 MB/);
    expect(() => validateNewRecording({ ...ok, mime: 'image/png' })).toThrow(/audio/);
  });
  it('normalises unknown tags and languages', () => {
    const v = validateNewRecording({ ...ok, context_tag: 'x', language: 'de' });
    expect(v.contextTag).toBe('other');
    expect(v.language).toBe('auto');
  });
  it('derives a safe file extension', () => {
    expect(extensionFor('Hangfelvétel 12.M4A', '')).toBe('m4a');
    expect(extensionFor('../../etc/passwd', 'audio/webm')).toBe('webm');
  });
});

describe('safeErrorMessage', () => {
  it('drops long quoted strings and emails', () => {
    const msg = safeErrorMessage(new Error('bad input "this is a long quoted transcript sentence" from a@b.com'));
    expect(msg).not.toMatch(/transcript sentence/);
    expect(msg).not.toMatch(/a@b\.com/);
  });
});

describe('transcriptionCost', () => {
  it('prices per minute', () => {
    expect(transcriptionCost('openai/whisper-1', 600)).toBeCloseTo(0.06, 5);
    expect(transcriptionCost('openai/gpt-4o-mini-transcribe', 600)).toBeCloseTo(0.03, 5);
  });
});

import { findEnv } from '../api/_lib/env-lookup.js';

describe('findEnv', () => {
  const vercelPrefixed = {
    mindtrail_SUPABASE_URL: 'https://a.supabase.co',
    mindtrail_mindtrailSUPABASE_URL: 'https://b.supabase.co',
    mindtrail_SUPABASE_ANON_KEY: 'anon',
    mindtrail_SUPABASE_SERVICE_ROLE_KEY: 'service',
  };
  it('finds prefixed names, preferring the shortest', () => {
    expect(findEnv(vercelPrefixed, ['SUPABASE_URL'])).toEqual({ name: 'mindtrail_SUPABASE_URL', value: 'https://a.supabase.co' });
    expect(findEnv(vercelPrefixed, ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']).value).toBe('anon');
  });
  it('prefers the exact name', () => {
    expect(findEnv({ ...vercelPrefixed, SUPABASE_URL: 'https://exact.supabase.co' }, ['SUPABASE_URL']).value).toBe('https://exact.supabase.co');
  });
  it('never returns the service key for the browser key lookup', () => {
    expect(findEnv({ mindtrail_SUPABASE_SERVICE_ROLE_KEY: 'x' }, ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'])).toBeUndefined();
  });
});
