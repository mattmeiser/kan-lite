import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** A "type to filter" combobox for pick lists too long for a plain <select> -- e.g. picking a related card on a board with hundreds of cards. */
export function SearchableSelect({ options, value, onChange, placeholder = 'Search…' }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;

    function position() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    }
    position();
    setQuery('');
    inputRef.current?.focus();

    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    /** Reposition rather than close -- opening this menu focuses a text input, which can itself
        trigger a scroll (mobile virtual keyboard, or the drawer scrolling the trigger into view),
        and closing on that scroll made the menu unusable the instant it opened. */
    function handleScroll() {
      position();
    }

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
    // iOS's virtual keyboard resizes the visual viewport without reliably firing window's own
    // resize/scroll events -- visualViewport's are the only way to catch that and reposition.
    window.visualViewport?.addEventListener('resize', handleScroll);
    window.visualViewport?.addEventListener('scroll', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
      window.visualViewport?.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('scroll', handleScroll);
    };
  }, [open]);

  const query_ = query.trim().toLowerCase();
  const filtered = query_ ? options.filter((o) => o.label.toLowerCase().includes(query_)) : options;

  return (
    <div className="dropdown">
      <button type="button" className="field-select-trigger" ref={triggerRef} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {selected?.label ?? placeholder}
        <svg className="dropdown-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="dropdown-menu searchable-select-menu" ref={menuRef} style={menuStyle}>
            <input
              ref={inputRef}
              type="text"
              className="field-input"
              placeholder="Type to search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul role="listbox">
              {filtered.length === 0 && <li className="dropdown-empty">No matches</li>}
              {filtered.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    className={`dropdown-item${opt.value === value ? ' selected' : ''}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
