// Pure helpers for turning per-chunk transcription results into one timeline.

const round2 = (n) => Math.round(n * 100) / 100;

// Shift a chunk's segments onto the recording's timeline. If the model returned no segments,
// the whole chunk becomes one segment and precision drops to 'chunk'.
export function normaliseChunkSegments(chunk, result) {
  const segs = Array.isArray(result.segments) ? result.segments : [];
  if (segs.length === 0) {
    const text = (result.text ?? '').trim();
    return {
      precision: 'chunk',
      segments: text
        ? [{ start: round2(chunk.start_sec), end: round2(chunk.start_sec + chunk.duration_sec), text }]
        : [],
    };
  }
  return {
    precision: 'segment',
    segments: segs
      .map((s) => ({
        start: round2(chunk.start_sec + s.startSecond),
        end: round2(chunk.start_sec + s.endSecond),
        text: String(s.text ?? '').trim(),
      }))
      .filter((s) => s.text),
  };
}

// chunks: rows from audio_chunks ordered by idx, each with segments + precision stored.
export function stitchChunks(chunks) {
  const ordered = [...chunks].sort((a, b) => a.idx - b.idx);
  const segments = ordered.flatMap((c) => c.segments ?? []);
  const precision = ordered.every((c) => c.timestamp_precision !== 'chunk') ? 'segment' : 'chunk';
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { text, segments, precision };
}
