import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { parseSegmentList, splitAudio } from '../api/_lib/audio.js';

describe('parseSegmentList', () => {
  it('reads ffmpeg csv output', () => {
    expect(parseSegmentList('chunk_000.mp3,0.000000,600.024000\nchunk_001.mp3,600.024000,750.5\n')).toEqual([
      { idx: 0, file: 'chunk_000.mp3', start: 0, duration: 600.024 },
      { idx: 1, file: 'chunk_001.mp3', start: 600.024, duration: 150.476 },
    ]);
  });
});

describe('splitAudio (real ffmpeg)', () => {
  it('splits a 25-minute m4a into three mp3 chunks under the 25 MB limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-test-'));
    try {
      const input = join(dir, 'in.m4a');
      // 25 minutes of a quiet tone, AAC in MP4 — the format Android voice recorders produce.
      execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=220:duration=1500', '-c:a', 'aac', '-b:a', '32k', input]);
      const chunks = await splitAudio(input, dir);
      expect(chunks).toHaveLength(3);
      expect(chunks[0].start).toBe(0);
      expect(chunks[1].start).toBeCloseTo(600, 0);
      expect(chunks[2].start).toBeCloseTo(1200, 0);
      expect(chunks.reduce((s, c) => s + c.duration, 0)).toBeCloseTo(1500, 0);
      for (const c of chunks) expect((await stat(c.localPath)).size).toBeLessThan(25 * 1024 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
