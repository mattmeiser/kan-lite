import { describe, expect, it } from 'vitest';
import { dueDateInfo, formatDate, formatDateShort, initialsFor, isEnterKey, isOverdue, tintStyle, todayIso } from './utils';

describe('isEnterKey', () => {
  it('is true for a normal Enter keypress', () => {
    expect(isEnterKey({ key: 'Enter' })).toBe(true);
  });

  it('falls back to the legacy numeric keyCode when key is unset', () => {
    expect(isEnterKey({ key: '', keyCode: 13 })).toBe(true);
  });

  it('is false for any other key', () => {
    expect(isEnterKey({ key: 'a', keyCode: 65 })).toBe(false);
  });
});

describe('tintStyle', () => {
  it('mixes the given hue into the surface for background and into text for the foreground', () => {
    expect(tintStyle('var(--lbl-blue)')).toEqual({
      background: 'color-mix(in srgb, var(--lbl-blue) 18%, var(--surface))',
      color: 'color-mix(in srgb, var(--lbl-blue) 70%, var(--text))',
    });
  });

  it('works with any CSS color, not just --lbl-* tokens', () => {
    expect(tintStyle('var(--accent)').background).toContain('var(--accent)');
  });
});

describe('initialsFor', () => {
  it('uses first letter of first and last word for multi-word names', () => {
    expect(initialsFor('Matt Meiser')).toBe('MM');
    expect(initialsFor('Sarah Jane Connor')).toBe('SC');
  });

  it('falls back to the first two characters for a single word', () => {
    expect(initialsFor('kiddo')).toBe('KI');
  });

  it('trims surrounding whitespace and collapses internal runs', () => {
    expect(initialsFor('  Matt   Meiser  ')).toBe('MM');
  });

  it('treats ., _, and - as name-part separators too, since usernames rarely have spaces', () => {
    expect(initialsFor('matt.meiser')).toBe('MM');
    expect(initialsFor('matt_meiser')).toBe('MM');
    expect(initialsFor('matt-meiser')).toBe('MM');
  });

  it('still falls back to first two characters for a single-token username with no separator', () => {
    expect(initialsFor('admin')).toBe('AD');
  });
});

describe('isOverdue', () => {
  it('is false when there is no due date', () => {
    expect(isOverdue(null, '2026-06-15')).toBe(false);
  });

  it('is false when due today (only strictly past dates count as overdue)', () => {
    expect(isOverdue('2026-06-15', '2026-06-15')).toBe(false);
  });

  it('is true when the due date is before today', () => {
    expect(isOverdue('2026-06-14', '2026-06-15')).toBe(true);
  });

  it('is false when the due date is in the future', () => {
    expect(isOverdue('2026-06-20', '2026-06-15')).toBe(false);
  });
});

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDate', () => {
  it('formats an ISO date for display', () => {
    expect(formatDate('2026-09-20')).toBe('Sep 20, 2026');
  });
});

describe('formatDateShort', () => {
  it('omits the year when includeYear is false', () => {
    expect(formatDateShort('2026-11-01', false)).toBe('Nov 1');
  });

  it('includes the year when includeYear is true', () => {
    expect(formatDateShort('2026-11-01', true)).toBe('Nov 1, 2026');
  });
});

describe('dueDateInfo year handling', () => {
  it('omits the year for a due date within the next 12 months', () => {
    expect(dueDateInfo('2026-12-25', '2026-06-15').label).toBe('Dec 25');
  });

  it('includes the year for a due date more than 12 months out', () => {
    expect(dueDateInfo('2028-01-01', '2026-06-15').label).toBe('Jan 1, 2028');
  });
});
