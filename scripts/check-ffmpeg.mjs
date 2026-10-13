// Fails the build if the ffmpeg binary that the transcription function needs is missing.
// npm only downloads it when ffmpeg-static's install script is allowed (see "allowScripts").
import { existsSync, statSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

if (!ffmpegPath || !existsSync(ffmpegPath) || statSync(ffmpegPath).size < 1_000_000) {
  console.error(
    'ffmpeg binary missing: ffmpeg-static\'s install script did not run. Check "allowScripts" in package.json ' +
      'matches the installed ffmpeg-static version, then redeploy with "Use existing Build Cache" unticked.',
  );
  process.exit(1);
}
console.log(`ffmpeg check passed (${Math.round(statSync(ffmpegPath).size / 1e6)} MB).`);
