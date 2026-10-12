import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, AUDIO_BUCKET } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { megabytes } from '../lib/format.js';

const MAX_BYTES = 50 * 1024 * 1024;
const TAGS = ['family', 'friends', 'house', 'health admin', 'admin', 'side project', 'other'];
const CONSENT_TEXT = 'Everyone in this conversation knows it is being recorded and agreed.';

function guessMime(file) {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', amr: 'audio/amr', aac: 'audio/aac' }[ext] ?? 'application/octet-stream';
}

export default function Upload() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('family');
  const [language, setLanguage] = useState('auto');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const tooBig = file && file.size > MAX_BYTES;
  const canSubmit = file && !tooBig && title.trim() && consent && !busy;

  function pickFile(e) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError('');
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    try {
      setBusy('Preparing upload…');
      const mime = guessMime(file);
      const created = await api('recordings', {
        title: title.trim(),
        context_tag: tag,
        language,
        consent_confirmed: consent,
        file_name: file.name,
        mime,
        size: file.size,
        source: 'upload',
      });

      setBusy(`Uploading ${megabytes(file.size)}… keep this screen open.`);
      const { error: upError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .uploadToSignedUrl(created.upload.path, created.upload.token, file, { contentType: mime });
      if (upError) throw new Error(`Upload failed: ${upError.message}`);

      setBusy('Starting transcription…');
      await api('jobs/run', { recording_id: created.recording_id });
      navigate(`/recordings/${created.recording_id}`);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  return (
    <>
      <h1>Add a conversation</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Audio file
          <input type="file" accept="audio/*,.m4a,.mp3,.ogg,.opus,.wav,.webm,.amr,.aac" onChange={pickFile} />
        </label>
        {file && (
          <p className={tooBig ? 'error' : 'muted'}>
            {file.name} · {megabytes(file.size)}
            {tooBig && ' — larger than 50 MB. Use a lower quality setting in your recorder app.'}
          </p>
        )}
        <label>
          Title
          <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Plumber about the boiler" />
        </label>
        <label>
          Context
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Spoken language
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="auto">Detect (mixed Hungarian / English)</option>
            <option value="hu">Hungarian</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        <button type="submit" className="primary" disabled={!canSubmit}>Upload and transcribe</button>
        {!consent && file && <p className="muted">Tick the consent box to continue.</p>}
      </form>
      {busy && <p className="note">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}
