import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { createFakeSupabase } from './fake-supabase.js';

let fake;
let transcribeCalls;
let failOnCall;

vi.mock('../api/_lib/supabase.js', () => ({ adminClient: () => fake.client, AUDIO_BUCKET: 'audio' }));
vi.mock('../api/_lib/transcribe.js', () => ({
  getTranscriber: () => ({
    model: 'openai/whisper-1',
    async transcribe() {
      transcribeCalls += 1;
      if (transcribeCalls === failOnCall) throw new Error('gateway 503');
      return { text: `part ${transcribeCalls}`, segments: [{ startSecond: 1, endSecond: 2, text: `part ${transcribeCalls}` }], language: 'hu' };
    },
  }),
}));

let extractCalls;
let extractFails;
vi.mock('../api/_lib/extract.js', async (orig) => ({
  ...(await orig()),
  extract: async ({ segments, outputLanguage }) => {
    extractCalls += 1;
    if (extractFails) {
      const { ExtractionError } = await orig();
      const err = new ExtractionError('Extraction failed twice: output was not JSON.');
      err.usages = [{ model: 'claude-sonnet-5-5', usage: { input_tokens: 500, output_tokens: 50 } }];
      throw err;
    }
    return {
      output: {
        summary: `${segments.length} parts, ${outputLanguage}`,
        decisions: [],
        open_questions: [],
        action_items: [{ text: 'Call', owner: 'me', owner_label: null, due_date: null, due_date_source: null,
          priority: 'normal', source_quote: 'part 1', source_timestamp: 1, confidence: 0.83 }],
      },
      usages: [{ model: 'claude-sonnet-5-5', usage: { input_tokens: 10_000, output_tokens: 1_000 } }],
      dropped: 0,
    };
  },
}));

const { runJob } = await import('../api/_lib/jobs.js');
const { resetFailedJob } = await import('../api/_lib/jobs.js');

const USER = 'u1';
let audio;

async function makeAudio(seconds) {
  const dir = await mkdtemp(join(tmpdir(), 'mt-job-'));
  const p = join(dir, 'in.m4a');
  execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=duration=${seconds}:sample_rate=8000`, '-ac', '1', '-c:a', 'aac', '-b:a', '16k', p]);
  const buf = new Uint8Array(await readFile(p));
  await rm(dir, { recursive: true, force: true });
  return buf;
}

function seed({ retention = 0, cap = 25, spent = 0 } = {}) {
  fake = createFakeSupabase({
    tables: {
      settings: [{ user_id: USER, monthly_cap_usd: cap, audio_retention_days: retention, output_language: 'hu', timezone: 'Europe/Budapest' }],
      usage_this_month: spent ? [{ user_id: USER, cost_usd: spent }] : [],
      recordings: [{ id: 'r1', user_id: USER, title: 'Test', created_at: '2026-10-19T08:00:00Z', language: 'auto', audio_path: `${USER}/r1/original.m4a`, audio_deleted_at: null }],
      jobs: [{ id: 'j1', recording_id: 'r1', user_id: USER, status: 'queued', attempts: 0, locked_until: null, progress: {} }],
      audio_chunks: [],
    },
    files: { [`${USER}/r1/original.m4a`]: audio },
  });
}

describe('runJob', () => {
  beforeAll(async () => {
    audio = await makeAudio(1300); // → 3 chunks
  }, 120_000);

  beforeEach(() => {
    extractCalls = 0;
    extractFails = false;
    transcribeCalls = 0;
    failOnCall = 0;
  });

  it('transcribes all chunks, stitches, logs cost and deletes audio', async () => {
    seed();
    const res = await runJob('j1', USER);
    expect(res).toEqual({ status: 'ready', done: true });
    const job = fake.tables.jobs[0];
    expect(job.status).toBe('ready');
    expect(job.locked_until).toBeNull();
    const t = fake.tables.transcripts[0];
    expect(t.segments).toHaveLength(3);
    expect(t.segments.map((s) => Math.round(s.start))).toEqual([1, 601, 1201]);
    const transcribeLog = fake.tables.usage_log.filter((u) => u.operation === 'transcribe');
    expect(transcribeLog).toHaveLength(3);
    expect(transcribeLog.reduce((s, u) => s + u.cost_usd, 0)).toBeCloseTo((1300 / 60) * 0.006, 3);
    const extractLog = fake.tables.usage_log.filter((u) => u.operation === 'extract');
    expect(extractLog).toHaveLength(1);
    expect(extractLog[0].cost_usd).toBeCloseTo(0.03, 5); // 10k in × $2 + 1k out × $10 per MTok
    expect(fake.tables.summaries[0].summary).toBe('3 parts, hu');
    expect(fake.tables.action_items).toHaveLength(1);
    expect(fake.tables.action_items[0]).toMatchObject({ status: 'proposed', confidence: 0.83, recording_id: 'r1' });
    expect(fake.removed).toContain(`${USER}/r1/original.m4a`);
    expect(fake.tables.recordings[0].audio_deleted_at).toBeTruthy();
    expect(Math.round(fake.tables.recordings[0].duration_sec)).toBe(1300);
  }, 60_000);

  it('keeps the original when retention > 0', async () => {
    seed({ retention: 7 });
    await runJob('j1', USER);
    expect(fake.files.has(`${USER}/r1/original.m4a`)).toBe(true);
    expect(fake.tables.recordings[0].audio_deleted_at).toBeNull();
  }, 60_000);

  it('fails cleanly, then retry resumes without redoing finished chunks', async () => {
    seed();
    failOnCall = 2;
    const first = await runJob('j1', USER);
    expect(first.status).toBe('failed');
    expect(fake.tables.jobs[0].error).toMatch(/Retry/);
    const doneAfterFailure = fake.tables.audio_chunks.filter((c) => c.transcribed_at).length;
    expect(doneAfterFailure).toBeGreaterThanOrEqual(1);
    expect(fake.files.has(`${USER}/r1/original.m4a`)).toBe(true); // audio kept for the retry

    await resetFailedJob('j1', USER);
    const callsBefore = transcribeCalls;
    const second = await runJob('j1', USER);
    expect(second.status).toBe('ready');
    expect(transcribeCalls - callsBefore).toBe(3 - doneAfterFailure);
  }, 60_000);

  it('a failed extraction is retried without transcribing again', async () => {
    seed();
    extractFails = true;
    expect((await runJob('j1', USER)).status).toBe('failed');
    expect(fake.tables.transcripts).toHaveLength(1);
    expect(fake.tables.usage_log.filter((u) => u.operation === 'extract')).toHaveLength(1); // failed call still costs
    const transcribed = transcribeCalls;

    extractFails = false;
    await resetFailedJob('j1', USER);
    expect((await runJob('j1', USER)).status).toBe('ready');
    expect(transcribeCalls).toBe(transcribed);
    expect(fake.tables.action_items).toHaveLength(1);
  }, 60_000);

  it('re-running extraction keeps decided items and does not propose them again', async () => {
    seed();
    await runJob('j1', USER);
    fake.tables.action_items[0].status = 'accepted';
    fake.tables.jobs[0].status = 'extracting';
    await runJob('j1', USER);
    expect(fake.tables.action_items.map((i) => i.status)).toEqual(['accepted']);
  }, 60_000);

  it('stops when the monthly cap is reached', async () => {
    seed({ cap: 5, spent: 5.01 });
    const res = await runJob('j1', USER);
    expect(res.status).toBe('failed');
    expect(fake.tables.jobs[0].error).toMatch(/spending cap/);
    expect(transcribeCalls).toBe(0);
  });

  it('does not run a job another run has locked', async () => {
    seed();
    fake.tables.jobs[0].locked_until = new Date(Date.now() + 60_000).toISOString();
    expect((await runJob('j1', USER)).status).toBe('busy_or_not_runnable');
  });

  it('pauses when the time budget runs out and continues on the next call', async () => {
    seed();
    let t = 0;
    const clock = () => t;
    // First run: time jumps past the budget after the first chunk.
    const origCalls = () => transcribeCalls;
    const res1 = await runJob('j1', USER, { concurrency: 1, now: () => (origCalls() >= 1 ? (t = 200_000) : t) });
    expect(res1).toEqual({ status: 'transcribing', done: false });
    expect(extractCalls).toBe(0);
    expect(fake.tables.jobs[0].locked_until).toBeNull();
    const res2 = await runJob('j1', USER, { now: clock });
    expect(res2.status).toBe('ready');
  }, 60_000);
});
