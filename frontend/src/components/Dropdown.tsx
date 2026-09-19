import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';

export interface DropdownOption {
  value: string;
  label: ReactNode;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  variant?: 'pill' | 'field' | 'value' | 'plain' | 'chip';
  triggerStyle?: CSSProperties;
  /** Fully replaces the variant's default trigger class (e.g. "badge-prio high") instead of styling on top of it. */
  triggerClassName?: string;
  triggerContent?: ReactNode;
  className?: string;
}

export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  variant = 'pill',
  triggerStyle,
  triggerClassName,
  triggerContent,
  className = '',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;

    function position() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    }
    position();

    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    /** Reposition rather than close -- see the identical fix/comment in SearchableSelect.tsx. */
    function handleScroll() {
      position();
    }

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
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

  const triggerClass =
    triggerClassName ??
    (variant === 'field'
      ? 'field-select-trigger'
      : variant === 'value'
        ? 'value-pill value-select-trigger'
        : variant === 'plain'
          ? 'plain-select-trigger'
          : variant === 'chip'
            ? 'chip'
            : 'pill');

  return (
    <div className={`dropdown ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerClass} lockable`}
        style={triggerStyle}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {triggerContent ?? selected?.label ?? value}
        <svg className="dropdown-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        !disabled &&
        createPortal(
          <ul className="dropdown-menu" role="listbox" ref={menuRef} style={menuStyle}>
            {options.map((opt) => (
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
