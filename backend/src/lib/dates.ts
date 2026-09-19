import { config } from '../config.js';

/** Dashboard-only heuristic window for the "due soon" stat -- the notification
 * system itself has no advance warning (see design doc, Due-date notifications). */
export const DUE_SOON_WINDOW_DAYS = 3;

export function todayInAppTimezone(): string {
  return dateInAppTimezone(new Date());
}

/** YYYY-MM-DD for an arbitrary instant, in the app's configured timezone. */
export function dateInAppTimezone(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.appTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days elapsed since an ISO timestamp, floored (so "just now" is 0, not fractional). */
export function daysSince(isoTimestamp: string): number {
  return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 86400000);
}

/** "HH:MM" in the app's configured timezone -- compared against a board's daily_notify_time setting. */
export function timeOfDayInAppTimezone(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.appTimezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return fmt.format(date);
}
