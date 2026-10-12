// POST { recording_id } → creates the processing job (after the upload finished) and starts it.
// POST { job_id }       → continues a job that ran out of time.
// POST { job_id, retry: true } → re-queues a failed job; chunks already transcribed are kept.
// Work continues in the background after the response (waitUntil), up to maxDuration.
import { waitUntil } from '@vercel/functions';
import { adminClient } from '../_lib/supabase.js';
import { requireOwner } from '../_lib/auth.js';
import { handler, json, readJson, HttpError } from '../_lib/http.js';
import { resetFailedJob, runJob } from '../_lib/jobs.js';
import { logError } from '../_lib/log.js';

async function findOrCreateJob(db, userId, recordingId) {
  const { data: recording } = await db
    .from('recordings')
    .select('id')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!recording) throw new HttpError(404, 'Recording not found.');

  const { data: existing } = await db
    .from('jobs')
    .select('id')
    .eq('recording_id', recordingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await db
    .from('jobs')
    .insert({ recording_id: recordingId, user_id: userId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export const POST = handler(async (request) => {
  const user = await requireOwner(request);
  const body = await readJson(request);
  const db = adminClient();

  let jobId = typeof body.job_id === 'string' ? body.job_id : null;
  if (!jobId && typeof body.recording_id === 'string') {
    jobId = await findOrCreateJob(db, user.id, body.recording_id);
  }
  if (!jobId) throw new HttpError(400, 'job_id or recording_id is required.');
  if (body.retry === true) await resetFailedJob(jobId, user.id);

  waitUntil(
    runJob(jobId, user.id).catch((err) => logError('jobs.run.background', err, { job_id: jobId })),
  );
  return json({ job_id: jobId, started: true }, 202);
}, 'jobs.run');
