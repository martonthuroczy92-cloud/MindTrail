import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import ItemEditor from '../components/ItemEditor.jsx';
import { Badges, Quote } from '../components/ItemMeta.jsx';

// Proposed items, one at a time. Nothing reaches the Today list without your decision here.
export default function Review() {
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('action_items')
      .select('*, recordings(title, created_at)')
      .eq('status', 'proposed')
      .order('created_at')
      .then(({ data, error: e }) => (e ? setError(e.message) : setItems(data)));
  }, []);

  async function decide(fields) {
    const item = items[0];
    setError('');
    const now = new Date().toISOString();
    const { error: e } = await supabase
      .from('action_items')
      .update({ ...fields, updated_at: now, ...(fields.status === 'accepted' ? { accepted_at: now } : {}) })
      .eq('id', item.id);
    if (e) return setError(e.message);
    setEditing(false);
    setItems(items.slice(1));
  }

  if (error && !items) return <p className="error">{error}</p>;
  if (!items) return <p>Loading…</p>;
  if (!items.length) {
    return (
      <>
        <h1>Review</h1>
        <p>Nothing to review. New items appear here after a recording is processed.</p>
        <Link to="/">Go to Today</Link>
      </>
    );
  }

  const item = items[0];
  return (
    <>
      <h1>Review</h1>
      <p className="muted">{items.length} left · from “{item.recordings?.title}”</p>
      <div className="card">
        {editing ? (
          <ItemEditor
            item={item}
            saveLabel="Save and accept"
            onSave={(fields) => decide({ ...fields, status: 'accepted' })}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="item-text">{item.text}</p>
            <Badges item={item} />
            <Quote item={item} />
            <div className="row actions">
              <button type="button" className="primary" onClick={() => decide({ status: 'accepted' })}>Accept</button>
              <button type="button" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" onClick={() => decide({ status: 'dismissed' })}>Dismiss</button>
            </div>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
