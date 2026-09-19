import { useEffect, useRef, useState } from 'react';
import type { ChipDTO } from '@kanlite/shared';

interface LabelAdderProps {
  options: ChipDTO[];
  onAdd: (chipId: string) => void;
  disabled?: boolean;
}

/** "Add a chip to this card" dropdown. */
export function LabelAdder({ options, onAdd, disabled }: LabelAdderProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="pill add lockable" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        + tag
      </button>
      {open && !disabled && (
        <ul className="dropdown-menu" role="listbox">
          {options.map((chip) => (
            <li key={chip.id}>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onAdd(chip.id);
                  setOpen(false);
                }}
              >
                <span className="dot" style={{ background: `var(--lbl-${chip.color})` }} />
                {chip.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
