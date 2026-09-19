// The one real breakpoint -- see design doc, Responsiveness.
export const MOBILE_BREAKPOINT = 640;

export const CHIP_COLORS = [
  'red',
  'orange',
  'green',
  'blue',
  'grey',
  'purple',
  'yellow',
  'amber',
  'brown',
  'deep_orange',
  'dark_grey',
  'pink',
  'teal',
  'cyan',
  'lime',
  'light_green',
] as const;
export type ChipColor = (typeof CHIP_COLORS)[number];
