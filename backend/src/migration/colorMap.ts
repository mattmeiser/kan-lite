// Kanboard's full built-in palette (ColorModel::$default_colors) maps 1:1
// onto KanLite's tag palette, which mirrors the same 16 names with modern
// hex values (see frontend/src/constants.ts CHIP_COLORS and index.css's
// --lbl-* vars) -- so migrated tags land on the same-named color instead
// of being bucketed into a smaller set.
const KANBOARD_TO_KANLITE_COLOR: Record<string, string> = {
  yellow: 'yellow',
  blue: 'blue',
  green: 'green',
  purple: 'purple',
  red: 'red',
  orange: 'orange',
  grey: 'grey',
  brown: 'brown',
  deep_orange: 'deep_orange',
  dark_grey: 'dark_grey',
  pink: 'pink',
  teal: 'teal',
  cyan: 'cyan',
  lime: 'lime',
  light_green: 'light_green',
  amber: 'amber',
};

export function mapKanboardColor(colorId: string | null | undefined): string {
  if (!colorId) return 'grey';
  return KANBOARD_TO_KANLITE_COLOR[colorId] ?? 'grey';
}
