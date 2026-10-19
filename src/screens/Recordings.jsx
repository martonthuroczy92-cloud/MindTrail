import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { clock, shortDate, STATUS_LABEL } from '../lib/format.js';

export default function Recordings() {
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('recordings')
      .select('id, title, created_at, context_tag, duration_sec, jobs(status, created_at)')
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => (e ? setError(e.message) : setRows(data)));
  }, []);

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return setHits(null);
    const { data, error: e2 } = await supabase
      .from('transcripts')
      .select('recording_id, recordings(title, created_at)')
      .textSearch('fts', q, { type: 'websearch', config: 'simple' })
      .limit(50);
    if (e2) setError(e2.message);
    else setHits(data);
  }

  const latestStatus = (r) =>
    [...(r.jobs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.status;

  return (
    <>
      <h1>Recordings</h1>
      <form onSubmit={search} className="row">
        <input type="search" placeholder="Search all transcripts" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      {error && <p className="error">{error}</p>}

      {hits && (
        <section>
          <h2>{hits.length} match{hits.length === 1 ? '' : 'es'}</h2>
          <ul className="list">
            {hits.map((h) => (
              <li key={h.recording_id}>
                <Link to={`/recordings/${h.recording_id}?q=${encodeURIComponent(query.trim())}`}>
                  <strong>{h.recordings?.title}</strong>
                  <span className="muted">{h.recordings && shortDate(h.recordings.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => { setHits(null); setQuery(''); }}>Clear search</button>
        </section>
      )}

      {!hits && rows === null && <p>Loading…</p>}
      {!hits && rows?.length === 0 && <p className="muted">Nothing yet. Add a conversation first.</p>}
      {!hits && rows?.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/recordings/${r.id}`}>
                <strong>{r.title}</strong>
                <span className="muted">
                  {shortDate(r.created_at)} · {r.context_tag}
                  {r.duration_sec ? ` · ${clock(r.duration_sec)}` : ''}
                  {' · '}{STATUS_LABEL[latestStatus(r)] ?? 'Not started'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p><button type="button" className="link" onClick={() => supabase.auth.signOut()}>Sign out</button></p>
    </>
  );
}
