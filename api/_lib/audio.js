import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

export const CHUNK_SECONDS = 600;

function ffmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000); // keep the tail only
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.split('\n').slice(-3).join(' ')}`));
    });
  });
}

// ffmpeg's segment list (CSV): "chunk_000.mp3,0.000000,600.024000"
export function parseSegmentList(csv) {
  return csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const [file, start, end] = line.split(',');
      const s = Number(start);
      const e = Number(end);
      return { idx, file, start: s, duration: Math.max(0, e - s) };
    });
}

// Converts any input (m4a, mp3, webm, ogg, wav, ...) into mono 16 kHz 32 kbps MP3 chunks of
// CHUNK_SECONDS. 10 minutes ≈ 2.4 MB, far below the 25 MB transcription upload limit.
// Speech models resample to 16 kHz anyway, so this loses nothing they would use.
export async function splitAudio(inputPath, outDir, chunkSeconds = CHUNK_SECONDS) {
  const listPath = join(outDir, 'segments.csv');
  await run([
    '-hide_banner', '-nostdin', '-y',
    '-i', inputPath,
    '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '32k',
    '-f', 'segment',
    '-segment_time', String(chunkSeconds),
    '-reset_timestamps', '1',
    '-segment_list', listPath,
    '-segment_list_type', 'csv',
    join(outDir, 'chunk_%03d.mp3'),
  ]);
  const { readFile } = await import('node:fs/promises');
  const chunks = parseSegmentList(await readFile(listPath, 'utf8'));
  const files = new Set(await readdir(outDir));
  for (const c of chunks) {
    if (!files.has(c.file)) throw new Error(`ffmpeg did not produce ${c.file}`);
    c.localPath = join(outDir, c.file);
  }
  if (chunks.length === 0) throw new Error('No audio found in the file.');
  return chunks;
}
