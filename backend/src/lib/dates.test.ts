import { describe, expect, it } from 'vitest';
import { addDays, timeOfDayInAppTimezone, todayInAppTimezone } from './dates.js';

describe('addDays', () => {
  it('adds days within a month', () => {
    expect(addDays('2026-01-01', 5)).toBe('2026-01-06');
  });

  it('rolls over a month boundary', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });

  it('rolls over a year boundary', () => {
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('handles negative offsets', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('todayInAppTimezone', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayInAppTimezone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('timeOfDayInAppTimezone', () => {
  it('returns an HH:MM string', () => {
    expect(timeOfDayInAppTimezone(new Date())).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats midnight as 00:00, not 24:00', () => {
    // UTC config default in tests -- see backend/.env.example / config.ts.
    const midnightUtc = new Date('2026-06-01T00:00:00Z');
    expect(timeOfDayInAppTimezone(midnightUtc)).toBe('00:00');
  });
});
