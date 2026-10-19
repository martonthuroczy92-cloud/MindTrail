import { Link } from 'react-router-dom';
import { clock } from '../lib/format.js';
import { isUncertain } from '../lib/items.js';

export function DueLabel({ item }) {
  if (!item.due_date) return null;
  return item.due_date_source === 'suggested'
    ? <span className="tag suggested">Suggested: {item.due_date} (not said)</span>
    : <span className="tag">Due {item.due_date}</span>;
}

export function OwnerLabel({ item }) {
  return item.owner === 'other'
    ? <span className="tag waiting">Waiting on {item.owner_label || 'someone'}</span>
    : <span className="tag">You</span>;
}

export function Quote({ item, showLink = true }) {
  return (
    <blockquote className="quote">
      “{item.source_quote}”
      <span className="muted">
        {' '}— {item.source_timestamp != null ? clock(item.source_timestamp) : ''}
        {showLink && item.recordings?.title && (
          <> · <Link to={`/recordings/${item.recording_id}`}>{item.recordings.title}</Link></>
        )}
      </span>
    </blockquote>
  );
}

export function Badges({ item }) {
  return (
    <div className="tags">
      <OwnerLabel item={item} />
      <DueLabel item={item} />
      {item.priority === 'high' && <span className="tag high">High priority</span>}
      {isUncertain(item) && <span className="tag uncertain">Uncertain</span>}
      {item.snooze_count >= 3 && <span className="tag">Snoozed {item.snooze_count}×</span>}
    </div>
  );
}
