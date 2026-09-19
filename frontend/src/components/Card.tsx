import type { DragEvent } from 'react';
import { Chip } from './Chip';
import type { CardDTO, ChipDTO } from '@kanlite/shared';
import { dueDateInfo, initialsFor } from '../utils';

export type DropEdge = 'above' | 'below';

interface CardProps {
  card: CardDTO;
  chips: ChipDTO[];
  activeFilters: Set<string>;
  isSelected: boolean;
  assigneeName?: string;
  today: string;
  hidePriority?: boolean;
  /** Board Reader can look but not touch: no drag, no filter toggling from the card face. */
  locked?: boolean;
  dropEdge?: DropEdge | null;
  onOpen: () => void;
  onToggleFilter: (chipId: string) => void;
  onCardDragOver: (cardId: string, edge: DropEdge) => void;
  onCardDragLeave: () => void;
  onCardDrop: (draggedCardId: string, targetCardId: string, edge: DropEdge) => void;
}

/** Exported for direct unit testing -- avoids needing to mock DOM geometry. */
export function computeEdge(clientY: number, rect: { top: number; height: number }): DropEdge {
  return clientY - rect.top < rect.height / 2 ? 'above' : 'below';
}

function edgeFor(e: DragEvent<HTMLDivElement>): DropEdge {
  return computeEdge(e.clientY, e.currentTarget.getBoundingClientRect());
}

export function Card({
  card,
  chips,
  activeFilters,
  isSelected,
  assigneeName,
  today,
  hidePriority = false,
  locked = false,
  dropEdge,
  onOpen,
  onToggleFilter,
  onCardDragOver,
  onCardDragLeave,
  onCardDrop,
}: CardProps) {
  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (locked) return;
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onCardDragOver(card.id, edgeFor(e));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== card.id) onCardDrop(draggedId, card.id, edgeFor(e));
  }

  const cardChips = card.chipIds.map((id) => chips.find((c) => c.id === id)).filter((c): c is ChipDTO => !!c);
  const due = card.dueDate ? dueDateInfo(card.dueDate, today) : null;
  const isRecurring = card.recurrenceIntervalDays !== null;

  return (
    <div
      className={`card${isSelected ? ' active' : ''}${dropEdge ? ` drop-${dropEdge}` : ''}${assigneeName ? ' has-avatar' : ''}${isRecurring ? ' has-recur' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      draggable={!locked}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={onCardDragLeave}
      onDrop={handleDrop}
    >
      {(assigneeName || isRecurring) && (
        <div className="card-badges">
          {isRecurring && (
            <span className="card-recur-icon" title="Repeats">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M4 4h6a3 3 0 0 1 3 3v1M12 12H6a3 3 0 0 1-3-3V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M6 1.5 4 4l2 2.5M10 14.5l2-2.5-2-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          {assigneeName && <div className="card-avatar">{initialsFor(assigneeName)}</div>}
        </div>
      )}
      <div className="card-top-row">
        {!hidePriority && <span className={`badge-prio ${card.priority.toLowerCase()}`}>{card.priority}</span>}
        {cardChips.map((chip) => (
          <Chip
            key={chip.id}
            label={chip.name}
            color={chip.color}
            size="sm"
            pressed={activeFilters.has(chip.id)}
            onClick={() => onToggleFilter(chip.id)}
          />
        ))}
      </div>
      <div className="card-title">{card.title}</div>
      {due && (
        <div className="card-meta-row">
          <span className={`pill due-${due.state}`}>{due.label}</span>
        </div>
      )}
    </div>
  );
}
