// Asynchronous processing of one recording: queued → transcribing → ready / failed.
// (Phase 2 inserts 'extracting' between transcribing and ready.)
//
// A run works until its time budget is spent, saving progress per chunk, then releases the
// lock. Anything that calls runJob again (the app while it polls; a scheduler from phase 2 on)
// continues where the previous run stopped. Retrying a failed job never needs a re-upload.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminClient, AUDIO_BUCKET } from './supabase.js';
import { splitAudio } from './audio.js';
import { getTranscriber } from './transcribe.js';
import { transcriptionCost } from './pricing.js';
import { normaliseChunkSegments, stitchChunks } from './segments.js';
import { logError, safeErrorMessage } from './log.js';

const LOCK_SECONDS = 290; // just under the function's 300 s maxDuration
const BUDGET_MS = 240_000; // stop starting new work after this
const PER_CHUNK_MS = 60_000; // only start a chunk if this much time is left
const CONCURRENCY = 3;

export class UserFacingError extends Error {}

// Atomically takes the job if it is runnable and not locked by another run.
export async function claimJob(jobId, userId) {
  const now = new Date();
  const { data, error } = await adminClient()
    .from('jobs')
    .update({
      locked_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
    .in('status', ['queued', 'transcribing'])
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data; // null when not runnable or already running
}

export async function resetFailedJob(jobId, userId) {
  const { error } = await adminClient()
    .from('jobs')
    .update({ status: 'queued', error: null, locked_until: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'failed');
  if (error) throw error;
}

async function updateJob(jobId, fields) {
  const { error } = await adminClient()
    .from('jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

async function assertUnderSpendingCap(userId) {
  const db = adminClient();
  const [{ data: settings }, { data: usage }] = await Promise.all([
    db.from('settings').select('monthly_cap_usd').eq('user_id', userId).maybeSingle(),
    db.from('usage_this_month').select('cost_usd').eq('user_id', userId).maybeSingle(),
  ]);
  const cap = Number(settings?.monthly_cap_usd ?? 25);
  const spent = Number(usage?.cost_usd ?? 0);
  if (spent >= cap) {
    throw new UserFacingError(
      `Monthly spending cap reached ($${spent.toFixed(2)} of $${cap.toFixed(2)}). ` +
        'Processing is paused until next month or until you raise the cap.',
    );
  }
}

async function download(path) {
  const { data, error } = await adminClient().storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) throw new UserFacingError('The audio file could not be read from storage. Upload it again.');
  return new Uint8Array(await data.arrayBuffer());
}

// Splits the original upload into chunks stored next to it, and records them.
async function prepareChunks(job, recording) {
  if (recording.audio_deleted_at || !recording.audio_path) {
    throw new UserFacingError('The audio for this recording was already deleted. Upload it again.');
  }
  const dir = await mkdtemp(join(tmpdir(), 'mt-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, await download(recording.audio_path));
    const chunks = await splitAudio(input, dir);

    const db = adminClient();
    const base = recording.audio_path.replace(/\/[^/]+$/, '');
    const rows = [];
    for (const c of chunks) {
      const path = `${base}/chunks/${String(c.idx).padStart(3, '0')}.mp3`;
      const { error } = await db.storage
        .from(AUDIO_BUCKET)
        .upload(path, await readFile(c.localPath), { contentType: 'audio/mpeg', upsert: true });
      if (error) throw error;
      rows.push({
        recording_id: recording.id,
        user_id: job.user_id,
        idx: c.idx,
        path,
        start_sec: c.start,
        duration_sec: c.duration,
      });
    }
    const { error } = await db.from('audio_chunks').upsert(rows);
    if (error) throw error;

    const total = chunks.reduce((s, c) => s + c.duration, 0);
    await db.from('recordings').update({ duration_sec: Math.round(total * 100) / 100 }).eq('id', recording.id);
    return rows;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transcribeChunk(job, recording, chunk, transcriber) {
  const audio = await download(chunk.path);
  const result = await transcriber.transcribe({ audio, language: recording.language });
  const { segments, precision } = normaliseChunkSegments(chunk, result);

  const db = adminClient();
  const { error } = await db
    .from('audio_chunks')
    .update({
      text: result.text ?? '',
      segments,
      timestamp_precision: precision,
      transcribed_at: new Date().toISOString(),
    })
    .eq('recording_id', chunk.recording_id)
    .eq('idx', chunk.idx);
  if (error) throw error;

  await db.from('usage_log').insert({
    user_id: job.user_id,
    recording_id: recording.id,
    job_id: job.id,
    operation: 'transcribe',
    model: transcriber.model,
    units: { audio_sec: Number(chunk.duration_sec) },
    cost_usd: transcriptionCost(transcriber.model, Number(chunk.duration_sec)),
  });
  return result.language;
}

async function finish(job, recording, chunks, transcriber, detectedLanguage) {
  const db = adminClient();
  const { text, segments, precision } = stitchChunks(chunks);
  const { error } = await db.from('transcripts').upsert({
    recording_id: recording.id,
    user_id: job.user_id,
    text,
    segments,
    timestamp_precision: precision,
    model: transcriber.model,
    detected_language: detectedLanguage ?? null,
  });
  if (error) throw error;

  // Chunk audio is derived data: always delete it. The original follows the retention setting
  // (0 days = delete now; longer retention is enforced by the scheduled cleanup in phase 3).
  const paths = chunks.map((c) => c.path);
  const { data: settings } = await db
    .from('settings')
    .select('audio_retention_days')
    .eq('user_id', job.user_id)
    .maybeSingle();
  const deleteOriginal = Number(settings?.audio_retention_days ?? 0) === 0;
  if (deleteOriginal && recording.audio_path) paths.push(recording.audio_path);
  if (paths.length) {
    const { error: rmError } = await db.storage.from(AUDIO_BUCKET).remove(paths);
    if (rmError) logError('jobs.cleanup', rmError, { recording_id: recording.id });
    else if (deleteOriginal) {
      await db.from('recordings').update({ audio_deleted_at: new Date().toISOString() }).eq('id', recording.id);
    }
  }

  await updateJob(job.id, {
    status: 'ready',
    locked_until: null,
    error: null,
    progress: { chunks_total: chunks.length, chunks_done: chunks.length },
  });
}

// Returns { status, done } for the caller. Never throws for job-level failures:
// those are written to the job row so the app can show them and offer a retry.
export async function runJob(jobId, userId, { now = Date.now, concurrency = CONCURRENCY } = {}) {
  const job = await claimJob(jobId, userId);
  if (!job) return { status: 'busy_or_not_runnable', done: false };

  const started = now();
  const db = adminClient();
  try {
    await assertUnderSpendingCap(userId);
    if (job.status === 'queued') {
      await updateJob(job.id, { status: 'transcribing', attempts: job.attempts + 1 });
    }

    const { data: recording, error: recError } = await db
      .from('recordings')
      .select('*')
      .eq('id', job.recording_id)
      .eq('user_id', userId)
      .single();
    if (recError) throw recError;

    let { data: chunks, error: chunkError } = await db
      .from('audio_chunks')
      .select('*')
      .eq('recording_id', recording.id)
      .order('idx');
    if (chunkError) throw chunkError;
    if (!chunks.length) chunks = await prepareChunks(job, recording);

    const transcriber = getTranscriber();
    let detectedLanguage;
    const pending = chunks.filter((c) => !c.transcribed_at);
    await updateJob(job.id, {
      progress: { chunks_total: chunks.length, chunks_done: chunks.length - pending.length },
    });

    // Small worker pool; each worker stops picking up chunks when the time budget runs low.
    const queue = [...pending];
    const worker = async () => {
      while (queue.length && now() - started < BUDGET_MS - PER_CHUNK_MS) {
        const chunk = queue.shift();
        detectedLanguage = (await transcribeChunk(job, recording, chunk, transcriber)) ?? detectedLanguage;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const { data: fresh, error: freshError } = await db
      .from('audio_chunks')
      .select('*')
      .eq('recording_id', recording.id)
      .order('idx');
    if (freshError) throw freshError;
    const done = fresh.filter((c) => c.transcribed_at).length;

    if (done < fresh.length) {
      // Out of time: release the lock so the next call continues.
      await updateJob(job.id, {
        locked_until: null,
        progress: { chunks_total: fresh.length, chunks_done: done },
      });
      return { status: 'transcribing', done: false };
    }

    await finish(job, recording, fresh, transcriber, detectedLanguage);
    return { status: 'ready', done: true };
  } catch (err) {
    const message =
      err instanceof UserFacingError
        ? err.message
        : `Processing failed: ${safeErrorMessage(err)}. Tap Retry; the audio is kept until it succeeds.`;
    logError('jobs.run', err, { job_id: job.id, recording_id: job.recording_id });
    await updateJob(job.id, { status: 'failed', error: message, locked_until: null }).catch((e) =>
      logError('jobs.markFailed', e, { job_id: job.id }),
    );
    return { status: 'failed', done: false };
  }
}
