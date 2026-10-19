import { useState } from 'react';

// Edit form for an action item. Calls onSave with only the editable fields.
export default function ItemEditor({ item, onSave, onCancel, saveLabel = 'Save' }) {
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner);
  const [label, setLabel] = useState(item.owner_label ?? '');
  const [due, setDue] = useState(item.due_date ?? '');
  const [priority, setPriority] = useState(item.priority);

  function submit(e) {
    e.preventDefault();
    const dueChanged = due !== (item.due_date ?? '');
    onSave({
      text: text.trim(),
      owner,
      owner_label: owner === 'other' ? label.trim() || null : null,
      due_date: due || null,
      // A date you set or confirm yourself counts as stated.
      due_date_source: due ? (dueChanged ? 'stated' : item.due_date_source) : null,
      priority,
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Task
        <input type="text" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} required />
      </label>
      <label>
        Who does it
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="me">Me</option>
          <option value="other">Someone else (I am waiting on them)</option>
        </select>
      </label>
      {owner === 'other' && (
        <label>
          Name or relationship
          <input type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. the plumber" />
        </label>
      )}
      <label>
        Due date
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <div className="row">
        <button type="submit" className="primary">{saveLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
