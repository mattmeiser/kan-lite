import { tintStyle } from '../utils';

interface ChipProps {
  label: string;
  color?: string;
  pressed?: boolean;
  size?: 'md' | 'sm';
  onClick?: () => void;
}

export function Chip({ label, color, pressed, size = 'md', onClick }: ChipProps) {
  const classes = ['chip', size === 'sm' ? 'chip-sm' : ''].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      style={color ? tintStyle(`var(--lbl-${color})`) : undefined}
      aria-pressed={pressed ?? false}
      onClick={(e) => {
        // Chips sit inside a card face that's itself clickable (opens the drawer) -- stop the
        // click here so toggling a filter chip doesn't also open the card underneath it.
        e.stopPropagation();
        onClick?.();
      }}
    >
      {label}
    </button>
  );
}
