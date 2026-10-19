// Pure helpers for the Today and Review screens. Dates are local calendar dates (YYYY-MM-DD).

export const UNCERTAIN_BELOW = 0.6;

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

// Snooze targets: tomorrow, or next Monday ("next week").
export function snoozeDate(kind, today) {
  if (kind === 'tomorrow') return addDays(today, 1);
  if (kind === 'next_week') {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday
    return addDays(today, ((8 - dow) % 7) || 7);
  }
  throw new Error(`unknown snooze ${kind}`);
}

// An item is active on the Today screen if accepted, or snoozed until today or earlier.
export function isActive(item, today) {
  if (item.status === 'accepted') return true;
  return item.status === 'snoozed' && item.snoozed_until <= today;
}

export function groupForToday(items, today) {
  const groups = { overdue: [], today: [], upcoming: [], waiting: [], undated: [], snoozed: [] };
  for (const item of items) {
    if (item.status === 'snoozed' && item.snoozed_until > today) {
      groups.snoozed.push(item);
      continue;
    }
    if (!isActive(item, today)) continue;
    if (item.owner === 'other') groups.waiting.push(item);
    else if (!item.due_date) groups.undated.push(item);
    else if (item.due_date < today) groups.overdue.push(item);
    else if (item.due_date === today) groups.today.push(item);
    else groups.upcoming.push(item);
  }
  const byDue = (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.created_at.localeCompare(b.created_at);
  for (const key of Object.keys(groups)) groups[key].sort(byDue);
  return groups;
}

export function isUncertain(item) {
  return Number(item.confidence) < UNCERTAIN_BELOW;
}
