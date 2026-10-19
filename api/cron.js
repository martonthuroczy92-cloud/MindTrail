// Called every few minutes by Supabase pg_cron (see supabase/migrations/0003_scheduler.sql).
// Continues any unfinished job, so processing completes even when the app is closed.
// Protected by CRON_SECRET; it never processes failed jobs (those wait for your Retry).
import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { adminClient } from './_lib/supabase.js';
import { handler, json, HttpError } from './_lib/http.js';
import { runJob } from './_lib/jobs.js';
import { logError } from './_lib/log.js';

const MAX_JOBS_PER_TICK = 3;
const MAX_ATTEMPTS = 6; // stop auto-continuing a job that keeps getting stuck

function authorised(request) {
  const secret = process.env.CRON_SECRET ?? '';
  const header = request.headers.get('authorization') ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return secret.length >= 32 && given.length === expected.length && timingSafeEqual(given, expected);
}

async function tick(request) {
  if (!authorised(request)) throw new HttpError(401, 'Unauthorised.');
  const now = new Date().toISOString();
  const { data: jobs, error } = await adminClient()
    .from('jobs')
    .select('id, user_id')
    .in('status', ['queued', 'transcribing', 'extracting'])
    .lt('attempts', MAX_ATTEMPTS)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .order('created_at')
    .limit(MAX_JOBS_PER_TICK);
  if (error) throw error;

  for (const job of jobs) {
    waitUntil(runJob(job.id, job.user_id).catch((err) => logError('cron.run', err, { job_id: job.id })));
  }
  return json({ started: jobs.length });
}

export const POST = handler(tick, 'cron');
export const GET = handler(tick, 'cron');
