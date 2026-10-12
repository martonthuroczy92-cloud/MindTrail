import { describe, expect, it } from 'vitest';
import { normaliseChunkSegments, stitchChunks } from '../api/_lib/segments.js';

describe('normaliseChunkSegments', () => {
  it('shifts segment times by the chunk start', () => {
    const chunk = { start_sec: 600, duration_sec: 600 };
    const out = normaliseChunkSegments(chunk, {
      text: 'a b',
      segments: [
        { startSecond: 1.234, endSecond: 4, text: ' Szia, ' },
        { startSecond: 4, endSecond: 9.5, text: 'call the plumber' },
      ],
    });
    expect(out.precision).toBe('segment');
    expect(out.segments).toEqual([
      { start: 601.23, end: 604, text: 'Szia,' },
      { start: 604, end: 609.5, text: 'call the plumber' },
    ]);
  });

  it('falls back to one chunk-level segment when the model returns none', () => {
    const out = normaliseChunkSegments({ start_sec: 1200, duration_sec: 300 }, { text: ' hello ', segments: [] });
    expect(out).toEqual({ precision: 'chunk', segments: [{ start: 1200, end: 1500, text: 'hello' }] });
  });

  it('returns no segments for silence', () => {
    expect(normaliseChunkSegments({ start_sec: 0, duration_sec: 10 }, { text: '' }).segments).toEqual([]);
  });
});

describe('stitchChunks', () => {
  it('orders chunks and joins text', () => {
    const out = stitchChunks([
      { idx: 1, timestamp_precision: 'segment', segments: [{ start: 600, end: 601, text: 'második' }] },
      { idx: 0, timestamp_precision: 'segment', segments: [{ start: 0, end: 1, text: 'first' }] },
    ]);
    expect(out.text).toBe('first második');
    expect(out.segments.map((s) => s.start)).toEqual([0, 600]);
    expect(out.precision).toBe('segment');
  });

  it('reports chunk precision if any chunk lacked timestamps', () => {
    const out = stitchChunks([
      { idx: 0, timestamp_precision: 'segment', segments: [] },
      { idx: 1, timestamp_precision: 'chunk', segments: [] },
    ]);
    expect(out.precision).toBe('chunk');
  });
});
