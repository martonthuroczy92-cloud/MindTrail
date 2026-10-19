import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { groupForToday, isoDate, snoozeDate } from '../lib/items.js';
import { Badges } from '../components/ItemMeta.jsx';

const SECTIONS = [
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['upcoming', 'Upcoming'],
  ['waiting', 'Waiting on others'],
  ['undated', 'No date'],
];

function ItemRow({ item, today, onChange }) {
  const [snoozing, setSnoozing] = useState(false);

  async function update(fields) {
    const { error } = await supabase
      .from('action_items')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    onChange(error?.message);
  }
  const snooze = (until) =>
    update({ status: 'snoozed', snoozed_until: until, snooze_count: (item.snooze_count ?? 0) + 1 });

  return (
    <li className="item">
      <div className="item-main">
        <button type="button" className="done" aria-label="Mark done" onClick={() => update({ status: 'done', done_at: new Date().toISOString() })}>✓</button>
        <div>
          <p className="item-text">{item.text}</p>
          <Badges item={item} />
          <p className="muted">
            <Link to={`/recordings/${item.recording_id}`}>{item.recordings?.title}</Link>
          </p>
        </div>
      </div>
      {snoozing ? (
        <div className="row wrap">
          <button type="button" onClick={() => snooze(snoozeDate('tomorrow', today))}>Tomorrow</button>
          <button type="button" onClick={() => snooze(snoozeDate('next_week', today))}>Next week</button>
          <input type="date" min={today} aria-label="Snooze until" onChange={(e) => e.target.value && snooze(e.target.value)} />
          <button type="button" className="link" onClick={() => setSnoozing(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="link" onClick={() => setSnoozing(true)}>Snooze</button>
      )}
    </li>
  );
}

export default function Today() {
  const [items, setItems] = useState(null);
  const [toReview, setToReview] = useState(0);
  const [error, setError] = useState('');
  const today = isoDate(new Date());

  const load = useCallback(async () => {
    const [active, proposed] = await Promise.all([
      supabase
        .from('action_items')
        .select('*, recordings(title)')
        .in('status', ['accepted', 'snoozed']),
      supabase.from('action_items').select('id', { count: 'exact', head: true }).eq('status', 'proposed'),
    ]);
    if (active.error) return setError(active.error.message);
    setItems(active.data);
    setToReview(proposed.count ?? 0);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onChange = (message) => {
    if (message) setError(message);
    load();
  };

  if (!items) return error ? <p className="error">{error}</p> : <p>Loading…</p>;
  const groups = groupForToday(items, today);
  const empty = SECTIONS.every(([key]) => !groups[key].length);

  return (
    <>
      <h1>Today</h1>
      {toReview > 0 && (
        <Link to="/review" className="card banner">{toReview} new item{toReview === 1 ? '' : 's'} to review →</Link>
      )}
      {error && <p className="error">{error}</p>}
      {empty && <p className="muted">Nothing open. Accepted items from your recordings show up here.</p>}
      {SECTIONS.map(([key, title]) =>
        groups[key].length ? (
          <section key={key}>
            <h2>{title} <span className="muted">({groups[key].length})</span></h2>
            <ul className="items">
              {groups[key].map((item) => <ItemRow key={item.id} item={item} today={today} onChange={onChange} />)}
            </ul>
          </section>
        ) : null,
      )}
      {groups.snoozed.length > 0 && (
        <p className="muted">{groups.snoozed.length} snoozed item{groups.snoozed.length === 1 ? '' : 's'} will come back on their date.</p>
      )}
    </>
  );
}
