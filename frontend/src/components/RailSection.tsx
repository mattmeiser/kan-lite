import { useState } from 'react';
import type { ReactNode } from 'react';

interface RailSectionProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function RailSection({ title, count, defaultExpanded = true, children }: RailSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rail-section" aria-expanded={expanded}>
      <button type="button" className="rail-header" onClick={() => setExpanded((v) => !v)}>
        <h4>
          <svg className="chev" width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h4>
      </button>
      {expanded && <div className="rail-content">{children}</div>}
    </div>
  );
}
