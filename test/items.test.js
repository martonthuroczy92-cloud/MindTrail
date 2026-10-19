import { describe, expect, it } from 'vitest';
import { addDays, groupForToday, snoozeDate } from '../src/lib/items.js';

const base = { created_at: '2026-10-01T10:00:00Z', owner: 'me', status: 'accepted', due_date: null };

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('snoozes to tomorrow and to next Monday', () => {
    expect(snoozeDate('tomorrow', '2026-10-19')).toBe('2026-10-20');
    expect(snoozeDate('next_week', '2026-10-19')).toBe('2026-10-26'); // Monday → next Monday
    expect(snoozeDate('next_week', '2026-10-24')).toBe('2026-10-26'); // Saturday → Monday
  });
});

describe('groupForToday', () => {
  const today = '2026-10-19';
  const items = [
    { ...base, id: 'a', due_date: '2026-10-18' },
    { ...base, id: 'b', due_date: '2026-10-19' },
    { ...base, id: 'c', due_date: '2026-10-25' },
    { ...base, id: 'd' },
    { ...base, id: 'e', owner: 'other' },
    { ...base, id: 'f', status: 'snoozed', snoozed_until: '2026-10-21' },
    { ...base, id: 'g', status: 'snoozed', snoozed_until: '2026-10-19', due_date: '2026-10-10' },
    { ...base, id: 'h', status: 'done' },
    { ...base, id: 'i', status: 'proposed' },
  ];
  it('puts each item in one group', () => {
    const g = groupForToday(items, today);
    const ids = (k) => g[k].map((i) => i.id);
    expect(ids('overdue')).toEqual(['g', 'a']);
    expect(ids('today')).toEqual(['b']);
    expect(ids('upcoming')).toEqual(['c']);
    expect(ids('undated')).toEqual(['d']);
    expect(ids('waiting')).toEqual(['e']);
    expect(ids('snoozed')).toEqual(['f']);
  });
});
