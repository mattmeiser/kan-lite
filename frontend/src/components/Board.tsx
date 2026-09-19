import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Chip } from './Chip';
import { Column } from './Column';
import { NavTrigger } from './AppShell';
import { TaskDrawer } from './TaskDrawer';
import * as api from '../api/client';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MOBILE_BREAKPOINT } from '../constants';
import { todayIso } from '../utils';
import type { BoardDetailDTO, CardDTO } from '@kanlite/shared';
import type { DropEdge } from './Card';

interface BoardProps {
  currentUserId: string;
}

export function Board({ currentUserId }: BoardProps) {
  const { boardId } = useParams<{ boardId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [board, setBoard] = useState<BoardDetailDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activeSwimlaneId, setActiveSwimlaneId] = useState<string | null>(null);
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  const today = todayIso();
  const boardColumnsRef = useRef<HTMLDivElement | null>(null);
  const restoredColumnRef = useRef(false);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    setSelectedCardId(null);
    setActiveFilters(new Set());
    restoredColumnRef.current = false;
    api
      .fetchBoard(boardId)
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        // Deep link from a notification email (?card=<id>): open that card's drawer directly.
        const linkedCardId = searchParams.get('card');
        if (linkedCardId && data.cards.some((c) => c.id === linkedCardId)) {
          setSelectedCardId(linkedCardId);
        }
        const swimlanes = data.swimlanes.filter((s) => s.active);
        let savedSwimlaneId: string | null = null;
        try {
          savedSwimlaneId = localStorage.getItem(`kanlite:lastSwimlane:${boardId}`);
        } catch {
          /* ignore unavailable storage */
        }
        const restored = savedSwimlaneId && swimlanes.some((s) => s.id === savedSwimlaneId) ? savedSwimlaneId : (swimlanes[0]?.id ?? null);
        setActiveSwimlaneId(restored);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the board.');
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  /** Live updates: pick up column/order changes made by other users/devices without a manual refresh. */
  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .fetchBoard(boardId)
        .then((data) => {
          if (!cancelled) setBoard(data);
        })
        .catch(() => {
          /* transient network error -- next tick will retry */
        });
    };
    const interval = setInterval(poll, 6000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [boardId]);

  /** Mobile: restore the column the user was last looking at for this board (scroll-snap columns). */
  useEffect(() => {
    if (!isMobile || !board || !boardId || restoredColumnRef.current) return;
    const el = boardColumnsRef.current;
    if (!el || el.clientWidth === 0) return;
    restoredColumnRef.current = true;
    let savedColumnId: string | null = null;
    try {
      savedColumnId = localStorage.getItem(`kanlite:lastColumn:${boardId}`);
    } catch {
      /* ignore unavailable storage */
    }
    if (!savedColumnId) return;
    const index = board.columns.findIndex((c) => c.id === savedColumnId);
    if (index > 0) el.scrollLeft = index * el.clientWidth;
  }, [isMobile, board, boardId]);

  function handleColumnsScroll() {
    if (!boardId || !isMobile || !board) return;
    const el = boardColumnsRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const column = board.columns[index];
    if (column) {
      try {
        localStorage.setItem(`kanlite:lastColumn:${boardId}`, column.id);
      } catch {
        /* ignore unavailable storage */
      }
    }
  }

  function closeCard() {
    setSelectedCardId(null);
    if (searchParams.has('card')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('card');
          return next;
        },
        { replace: true },
      );
    }
  }

  function selectSwimlane(swimlaneId: string) {
    setActiveSwimlaneId(swimlaneId);
    try {
      if (boardId) localStorage.setItem(`kanlite:lastSwimlane:${boardId}`, swimlaneId);
    } catch {
      /* ignore unavailable storage */
    }
  }

  const selectedCard = useMemo(() => board?.cards.find((c) => c.id === selectedCardId) ?? null, [board, selectedCardId]);

  function toggleFilter(chipId: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(chipId)) next.delete(chipId);
      else next.add(chipId);
      return next;
    });
  }

  function assigneeName(userId: string | null) {
    if (!userId || !board) return undefined;
    return board.members.find((m) => m.userId === userId)?.username;
  }

  function applyCardChange(updated: CardDTO) {
    setBoard((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === updated.id ? updated : c)) } : prev));
  }

  /** A move/reorder can renumber other cards' positions server-side too; a single-card patch leaves those stale. */
  function refreshBoard() {
    if (!boardId) return;
    api.fetchBoard(boardId).then(setBoard).catch((err) => console.error('Failed to refresh board', err));
  }

  function addCard(columnId: string, title: string, swimlaneId?: string | null) {
    if (!board) return;
    api
      .createCard(board.id, columnId, title, swimlaneId)
      .then((card) => setBoard((prev) => (prev ? { ...prev, cards: [...prev.cards, card] } : prev)))
      .catch((err) => console.error('Failed to create card', err));
  }

  function moveCardToColumn(cardId: string, columnId: string, swimlaneId?: string | null) {
    if (!board) return;
    const columnCards = board.cards.filter((c) => c.columnId === columnId && c.id !== cardId);
    const position = columnCards.length;
    setBoard((prev) =>
      prev
        ? { ...prev, cards: prev.cards.map((c) => (c.id === cardId ? { ...c, columnId, swimlaneId: swimlaneId ?? null, position } : c)) }
        : prev,
    );
    api.moveCard(board.id, cardId, columnId, position, swimlaneId).then(refreshBoard).catch((err) => console.error('Failed to move card', err));
  }

  function reorderCard(draggedCardId: string, columnId: string, targetCardId: string, edge: DropEdge, swimlaneId?: string | null) {
    if (!board) return;
    const columnCards = board.cards
      .filter((c) => c.columnId === columnId && c.id !== draggedCardId)
      .sort((a, b) => a.position - b.position);
    const targetIndex = columnCards.findIndex((c) => c.id === targetCardId);
    const insertAt = targetIndex === -1 ? columnCards.length : edge === 'above' ? targetIndex : targetIndex + 1;
    const reordered = [...columnCards.slice(0, insertAt), { id: draggedCardId } as CardDTO, ...columnCards.slice(insertAt)];
    const position = reordered.findIndex((c) => c.id === draggedCardId);

    setBoard((prev) =>
      prev
        ? { ...prev, cards: prev.cards.map((c) => (c.id === draggedCardId ? { ...c, columnId, swimlaneId: swimlaneId ?? null, position } : c)) }
        : prev,
    );
    api
      .moveCard(board.id, draggedCardId, columnId, position, swimlaneId)
      .then(refreshBoard)
      .catch((err) => console.error('Failed to reorder card', err));
  }

  function deleteCard(cardId: string) {
    if (!board) return Promise.resolve();
    return api.deleteCard(board.id, cardId).then(() => {
      setBoard((prev) => (prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : prev));
      setSelectedCardId(null);
    });
  }

  function cardVisible(card: CardDTO): boolean {
    if (activeFilters.size === 0) return true;
    return card.chipIds.some((id) => activeFilters.has(id));
  }

  if (loadError) {
    return (
      <div className="app-status is-error">
        <span>{loadError}</span>
      </div>
    );
  }

  if (!board) {
    return <div className="app-status">Loading board…</div>;
  }

  const drawerOpen = selectedCard !== null;
  const swimlanes = board.swimlanes.filter((s) => s.active);
  const grouped = swimlanes.length > 1;
  const locked = board.myRole === 'board_reader';
  const canManage = board.myRole === 'board_admin';

  function cardsFor(columnId: string, swimlaneId?: string | null) {
    return board!.cards
      .filter((c) => c.columnId === columnId && (swimlaneId !== undefined ? c.swimlaneId === swimlaneId : true))
      .filter(cardVisible)
      .sort((a, b) => a.position - b.position);
  }

  function renderColumns(swimlaneId: string | null | undefined, showHeader: boolean) {
    return (
      <div className="board-columns" ref={boardColumnsRef} onScroll={handleColumnsScroll}>
        {board!.columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            cards={cardsFor(column.id, grouped ? swimlaneId : undefined)}
            chips={board!.chips}
            activeFilters={activeFilters}
            selectedCardId={selectedCardId}
            assigneeName={assigneeName}
            today={today}
            hidePriority={board!.hidePriority}
            hideAvatar={board!.hideAvatar}
            swimlaneId={swimlaneId}
            showHeader={showHeader}
            locked={locked}
            onOpenCard={setSelectedCardId}
            onToggleFilter={toggleFilter}
            onDropCard={moveCardToColumn}
            onAddCard={addCard}
            onReorder={reorderCard}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`board-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="board">
        <div className="topbar">
          <div className="topbar-left">
            <NavTrigger />
            <div className="crumb">
              <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
                Boards
              </Link>{' '}
              / <b>{board.name}</b>
            </div>
          </div>
          <div className="topbar-right">
            {activeFilters.size > 0 && (
              <button className="filter-clear" type="button" onClick={() => setActiveFilters(new Set())}>
                Clear filter <span className="count">{activeFilters.size}</span>
              </button>
            )}
            {canManage && (
              <Link className="icon-btn" aria-label="Board settings" title="Board settings" to={`/boards/${board.id}/settings`}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </Link>
            )}
          </div>
        </div>

        {(!board.backlogColumnId || !board.doneColumnId) && (
          <div className="error-banner" style={{ margin: '8px 16px 0', background: 'var(--sem-warning-soft)', color: 'var(--sem-warning)' }}>
            {canManage ? (
              <>
                This board needs a Backlog and Done column assigned in{' '}
                <Link to={`/boards/${board.id}/settings`} style={{ color: 'inherit', fontWeight: 700 }}>
                  Board Settings
                </Link>{' '}
                before recurrence and notifications can work.
              </>
            ) : (
              'This board is still being set up by a Board Admin.'
            )}
          </div>
        )}

        {board.chips.length > 0 && (
          <div className="filter-bar">
            {board.chips.map((chip) => (
              <Chip
                key={chip.id}
                label={chip.name}
                color={chip.color}
                pressed={activeFilters.has(chip.id)}
                onClick={() => toggleFilter(chip.id)}
              />
            ))}
          </div>
        )}

        {grouped && isMobile && (
          <div className="swimlane-tabs">
            {swimlanes.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`swimlane-tab${s.id === activeSwimlaneId ? ' active' : ''}`}
                onClick={() => selectSwimlane(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {grouped && !isMobile ? (
          <div className="board-grouped">
            <div className="column-headers">
              {board.columns.map((column) => (
                <div className="column-header-cell" key={column.id}>
                  {column.name}
                </div>
              ))}
            </div>
            {swimlanes.map((s) => (
              <div className="swimlane-band" key={s.id}>
                <div className="swimlane-label">{s.name}</div>
                {renderColumns(s.id, false)}
              </div>
            ))}
          </div>
        ) : (
          renderColumns(grouped ? activeSwimlaneId : undefined, true)
        )}
      </div>

      <div className="scrim" onClick={closeCard} />

      {selectedCard && (
        <TaskDrawer
          board={board}
          card={selectedCard}
          currentUserId={currentUserId}
          onClose={closeCard}
          onCardChange={applyCardChange}
          onDeleteCard={() => deleteCard(selectedCard.id)}
        />
      )}
    </div>
  );
}
