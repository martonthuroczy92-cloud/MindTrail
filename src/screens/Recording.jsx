import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { clock, shortDate, STATUS_LABEL } from '../lib/format.js';

const POLL_MS = 4000;
const KICK_EVERY_MS = 20000;
const OPEN = ['queued', 'transcribing', 'extracting'];

function highlight(text, q) {
  if (!q) return text;
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

export default function Recording() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [recording, setRecording] = useState(null);
  const [job, setJob] = useState(undefined);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState('');
  const lastKick = useRef(0);

  const load = useCallback(async () => {
    const [rec, jobs, tr] = await Promise.all([
      supabase.from('recordings').select('*').eq('id', id).maybeSingle(),
      supabase.from('jobs').select('*').eq('recording_id', id).order('created_at', { ascending: false }).limit(1),
      supabase.from('transcripts').select('*').eq('recording_id', id).maybeSingle(),
    ]);
    const err = rec.error || jobs.error || tr.error;
    if (err) return setError(err.message);
    setRecording(rec.data);
    setJob(jobs.data?.[0] ?? null);
    setTranscript(tr.data);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll while processing. If no run currently holds the job, nudge it to continue.
  useEffect(() => {
    if (!job || !OPEN.includes(job.status)) return undefined;
    const t = setInterval(async () => {
      const unlocked = !job.locked_until || new Date(job.locked_until) < new Date();
      if (unlocked && Date.now() - lastKick.current > KICK_EVERY_MS) {
        lastKick.current = Date.now();
        api('jobs/run', { job_id: job.id }).catch((e) => setError(e.message));
      }
      load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [job, load]);

  async function retry() {
    setError('');
    try {
      lastKick.current = Date.now();
      await api('jobs/run', job ? { job_id: job.id, retry: true } : { recording_id: id });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !recording) return <p className="error">{error}</p>;
  if (!recording) return <p>Loading…</p>;

  const progress = job?.progress ?? {};
  return (
    <>
      <h1>{recording.title}</h1>
      <p className="muted">
        {shortDate(recording.created_at)} · {recording.context_tag}
        {recording.duration_sec ? ` · ${clock(recording.duration_sec)}` : ''}
        {recording.audio_deleted_at ? ' · audio deleted' : ''}
      </p>

      {job === null && (
        <div className="card">
          <p>Processing has not started. If the upload was interrupted, add the file again.</p>
          <button type="button" onClick={retry}>Start processing</button>
        </div>
      )}
      {job && job.status !== 'ready' && (
        <div className="card">
          <p><strong>{STATUS_LABEL[job.status]}</strong>
            {progress.chunks_total ? ` · part ${Math.min(progress.chunks_done + 1, progress.chunks_total)} of ${progress.chunks_total}` : ''}
          </p>
          {OPEN.includes(job.status) && <p className="muted">You can leave this screen; processing continues while the app is open somewhere.</p>}
          {job.status === 'failed' && (
            <>
              <p className="error">{job.error}</p>
              <button type="button" onClick={retry}>Retry</button>
            </>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {transcript && (
        <section>
          <h2>Transcript</h2>
          {transcript.timestamp_precision === 'chunk' && (
            <p className="muted">This model returned no timestamps; times show the 10-minute part only.</p>
          )}
          <ol className="transcript">
            {transcript.segments.map((s, i) => (
              <li key={i}>
                <span className="time">{clock(s.start)}</span>
                <span>{highlight(s.text, q)}</span>
              </li>
            ))}
          </ol>
          <p className="muted">Model: {transcript.model}{transcript.detected_language ? ` · detected: ${transcript.detected_language}` : ''}</p>
        </section>
      )}
    </>
  );
}
