/**
 * Tinted-fill pill styling (design doc, Reusable UI assets / REVIEW.md #12): background and text
 * mixed from a hue against the theme's surface/text, so it adapts to light/dark automatically.
 * `hue` is any valid CSS color (a `--lbl-*` token, or another variable like `--accent`/`--sem-good`).
 */
export function tintStyle(hue: string): { background: string; color: string } {
  return {
    background: `color-mix(in srgb, ${hue} 18%, var(--surface))`,
    color: `color-mix(in srgb, ${hue} 70%, var(--text))`,
  };
}

/** Enter-key check with a legacy numeric `keyCode` fallback, for the rare keyboard/browser combination that still only sets that. */
export function isEnterKey(e: { key: string; keyCode?: number }): boolean {
  return e.key === 'Enter' || e.keyCode === 13;
}

/** Splits on whitespace or common username separators (., _, -) so "matt.meiser" reads as two
    parts ("MM") the same way "Matt Meiser" would, instead of an arbitrary first-two-characters
    slice. Falls back to the first two characters only for a genuinely single-token name. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Card-face date display omits the year when the date falls within the next 12 months (matches
    the mockup's "Nov 1"); further out (or, in practice, overdue dates are never routed through
    this -- see dueDateInfo) it includes the year so it isn't ambiguous which year is meant. */
export function formatDateShort(iso: string, includeYear: boolean): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(
    undefined,
    includeYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' },
  );
}

export function isOverdue(dueDate: string | null, today: string): boolean {
  return !!dueDate && dueDate < today;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

export type DueState = 'over' | 'soon' | 'ok';

/** Matches the mockup's three due-date pill states/text: "{n}d overdue", "Due today"/"Due in {n}d", or a plain formatted date. */
export function dueDateInfo(dueDate: string, today: string, dueSoonWindowDays = 3): { state: DueState; label: string } {
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return { state: 'over', label: `${-diff}d overdue` };
  if (diff === 0) return { state: 'soon', label: 'Due today' };
  if (diff <= dueSoonWindowDays) return { state: 'soon', label: `Due in ${diff}d` };
  return { state: 'ok', label: formatDateShort(dueDate, diff > 365) };
}
