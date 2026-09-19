import { useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { Card } from './Card';
import type { DropEdge } from './Card';
import { isEnterKey } from '../utils';
import type { CardDTO, ChipDTO, ColumnDTO } from '@kanlite/shared';

interface ColumnProps {
  column: ColumnDTO;
  cards: CardDTO[];
  chips: ChipDTO[];
  activeFilters: Set<string>;
  selectedCardId: string | null;
  assigneeName: (userId: string | null) => string | undefined;
  today: string;
  hidePriority?: boolean;
  hideAvatar?: boolean;
  swimlaneId?: string | null;
  showHeader?: boolean;
  locked?: boolean;
  onOpenCard: (id: string) => void;
  onToggleFilter: (chipId: string) => void;
  onDropCard: (cardId: string, columnId: string, swimlaneId?: string | null) => void;
  onAddCard: (columnId: string, title: string, swimlaneId?: string | null) => void;
  onReorder: (draggedCardId: string, columnId: string, targetCardId: string, edge: DropEdge, swimlaneId?: string | null) => void;
}

export function Column({
  column,
  cards,
  chips,
  activeFilters,
  selectedCardId,
  assigneeName,
  today,
  hidePriority = false,
  hideAvatar = false,
  swimlaneId,
  showHeader = true,
  locked = false,
  onOpenCard,
  onToggleFilter,
  onDropCard,
  onAddCard,
  onReorder,
}: ColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<{ cardId: string; edge: DropEdge } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (locked) return;
    e.preventDefault();
    setDragOver(false);
    setDropIndicator(null);
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) onDropCard(cardId, column.id, swimlaneId);
  }

  function commitAdd() {
    const title = draft.trim();
    if (title) onAddCard(column.id, title, swimlaneId);
    setDraft('');
    setAdding(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (isEnterKey(e)) commitAdd();
    if (e.key === 'Escape') {
      setDraft('');
      setAdding(false);
    }
  }

  return (
    <div
      className={`column${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {showHeader && (
        <h3>
          {column.name}
          <span className="count">{cards.length}</span>
        </h3>
      )}
      <div className="column-cards">
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            chips={chips}
            activeFilters={activeFilters}
            isSelected={card.id === selectedCardId}
            assigneeName={hideAvatar ? undefined : assigneeName(card.assigneeId)}
            today={today}
            hidePriority={hidePriority}
            locked={locked}
            dropEdge={dropIndicator?.cardId === card.id ? dropIndicator.edge : null}
            onOpen={() => onOpenCard(card.id)}
            onToggleFilter={onToggleFilter}
            onCardDragOver={(cardId, edge) => setDropIndicator({ cardId, edge })}
            onCardDragLeave={() => setDropIndicator(null)}
            onCardDrop={(draggedId, targetId, edge) => {
              setDropIndicator(null);
              onReorder(draggedId, column.id, targetId, edge, swimlaneId);
            }}
          />
        ))}
      </div>
      {!locked &&
        (adding ? (
          <input
            className="add-task-input"
            autoFocus
            placeholder="Card title"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => (e.nativeEvent as InputEvent).inputType === 'insertLineBreak' && commitAdd()}
            onBlur={commitAdd}
          />
        ) : (
          <button type="button" className="add-task-btn" onClick={() => setAdding(true)}>
            + Add card
          </button>
        ))}
    </div>
  );
}
