import { useEffect, useRef, useState } from 'react';
import { Dropdown } from './Dropdown';
import { LabelAdder } from './LabelAdder';
import { SearchableSelect } from './SearchableSelect';
import * as api from '../api/client';
import { dueDateInfo, formatDate, initialsFor, isEnterKey, tintStyle } from '../utils';
import { renderMarkdown } from '../markdown';
import type { ActivityLogEntryDTO, BoardDetailDTO, CardDTO, CommentDTO, Priority } from '@kanlite/shared';

interface TaskDrawerProps {
  board: BoardDetailDTO;
  card: CardDTO;
  currentUserId: string;
  onClose: () => void;
  onCardChange: (card: CardDTO) => void;
  onDeleteCard: () => Promise<unknown>;
}

const PAGE_SIZE = 15;

export function TaskDrawer({ board, card, currentUserId, onClose, onCardChange, onDeleteCard }: TaskDrawerProps) {
  const locked = board.myRole === 'board_reader';
  const canModerateComments = board.myRole === 'board_admin';

  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const [editingRecurrence, setEditingRecurrence] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const [justAddedSubtaskId, setJustAddedSubtaskId] = useState<string | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  const [activity, setActivity] = useState<ActivityLogEntryDTO[]>([]);
  const [activityHasMore, setActivityHasMore] = useState(false);

  const [relatedPickerOpen, setRelatedPickerOpen] = useState(false);
  const [relatedTargetId, setRelatedTargetId] = useState('');
  const [relatedKind, setRelatedKind] = useState<'related' | 'this_precedes_that' | 'this_follows_that'>('related');

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description);
    setEditingDescription(false);
    setEditingDueDate(false);
    setEditingRecurrence(false);
    setConfirmingDelete(false);
    setDeleteError(null);
    setRelatedPickerOpen(false);

    api.fetchComments(board.id, card.id).then(({ comments }) => {
      setComments(comments);
      setCommentsHasMore(comments.length >= PAGE_SIZE);
    });

    api.fetchActivity(board.id, card.id).then(({ entries }) => {
      setActivity(entries);
      setActivityHasMore(entries.length >= PAGE_SIZE);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    if (editingDueDate) dueDateInputRef.current?.showPicker?.();
  }, [editingDueDate]);

  /** Adding a subtask has no other visible confirmation -- scroll it into view and flash it so it's unmistakable. */
  useEffect(() => {
    if (!justAddedSubtaskId) return;
    if (!card.subtasks.some((s) => s.id === justAddedSubtaskId)) return;
    const el = document.querySelector(`[data-subtask-id="${justAddedSubtaskId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = setTimeout(() => setJustAddedSubtaskId(null), 1200);
    return () => clearTimeout(timer);
  }, [justAddedSubtaskId, card.subtasks]);

  function refreshActivity() {
    api.fetchActivity(board.id, card.id).then(({ entries }) => {
      setActivity((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const fresh = entries.filter((e) => !seen.has(e.id));
        return [...fresh, ...prev];
      });
    });
  }

  /** Every mutation logs an activity entry server-side; refresh it here so the log doesn't go stale for the rest of this drawer session. */
  function applyCardChange(updated: CardDTO) {
    onCardChange(updated);
    refreshActivity();
  }

  async function refreshCard() {
    const fresh = await api.fetchCard(board.id, card.id);
    applyCardChange(fresh);
  }

  function confirmDelete() {
    setDeleteError(null);
    onDeleteCard().catch((err) => {
      setConfirmingDelete(false);
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this card.');
    });
  }

  function commitTitle() {
    const value = title.trim();
    if (!value || value === card.title) {
      setTitle(card.title);
      return;
    }
    api.updateCard(board.id, card.id, { title: value }).then(applyCardChange).catch((err) => console.error('Failed to save title', err));
  }

  function commitDescription() {
    if (description === card.description) return;
    api
      .updateCard(board.id, card.id, { description })
      .then(applyCardChange)
      .catch((err) => console.error('Failed to save description', err));
  }

  function changeColumn(columnId: string) {
    api.moveCard(board.id, card.id, columnId, 0, card.swimlaneId).then(applyCardChange).catch((err) => console.error('Failed to move card', err));
  }

  function changeAssignee(assigneeId: string) {
    api
      .updateCard(board.id, card.id, { assigneeId: assigneeId || null })
      .then(applyCardChange)
      .catch((err) => console.error('Failed to change assignee', err));
  }

  function changePriority(priority: string) {
    api.updateCard(board.id, card.id, { priority: priority as Priority }).then(applyCardChange).catch((err) => console.error('Failed to change priority', err));
  }

  function changeDueDate(dueDate: string) {
    setEditingDueDate(false);
    api.updateCard(board.id, card.id, { dueDate: dueDate || null }).then(applyCardChange).catch((err) => console.error('Failed to change due date', err));
  }

  function changeSwimlane(swimlaneId: string) {
    api.moveCard(board.id, card.id, card.columnId, card.position, swimlaneId || null).then(applyCardChange).catch((err) => console.error('Failed to change swimlane', err));
  }

  function changeRecurrence(value: string) {
    setEditingRecurrence(false);
    const days = value.trim() === '' ? null : Math.max(1, Math.round(Number(value)));
    api
      .updateCard(board.id, card.id, { recurrenceIntervalDays: Number.isFinite(days) ? days : null })
      .then(applyCardChange)
      .catch((err) => console.error('Failed to change recurrence', err));
  }

  function addChip(chipId: string) {
    api.addCardChip(board.id, card.id, chipId).then(applyCardChange).catch((err) => console.error('Failed to add chip', err));
  }

  function removeChip(chipId: string) {
    api.removeCardChip(board.id, card.id, chipId).then(applyCardChange).catch((err) => console.error('Failed to remove chip', err));
  }

  function commitSubtask() {
    const value = newSubtask.trim();
    setNewSubtask('');
    setAddingSubtask(false);
    if (!value) return;
    api
      .addSubtask(board.id, card.id, value)
      .then((created) => {
        setSubtaskError(null);
        setJustAddedSubtaskId(created.id);
        return refreshCard();
      })
      .catch((err) => setSubtaskError(err instanceof Error ? err.message : 'Failed to add subtask.'));
  }

  function toggleSubtask(subtaskId: string) {
    api
      .toggleSubtask(board.id, card.id, subtaskId)
      .then(() => refreshCard())
      .catch((err) => console.error('Failed to toggle subtask', err));
  }

  function startEditSubtask(subtaskId: string, text: string) {
    setEditingSubtaskId(subtaskId);
    setEditingSubtaskText(text);
  }

  function commitEditSubtask() {
    if (!editingSubtaskId) return;
    const text = editingSubtaskText.trim();
    const subtaskId = editingSubtaskId;
    setEditingSubtaskId(null);
    if (!text) return;
    api
      .updateSubtask(board.id, card.id, subtaskId, text)
      .then(() => refreshCard())
      .catch((err) => console.error('Failed to edit subtask', err));
  }

  function removeSubtask(subtaskId: string) {
    api
      .removeSubtask(board.id, card.id, subtaskId)
      .then(() => refreshCard())
      .catch((err) => console.error('Failed to remove subtask', err));
  }

  function addRelatedLink() {
    if (!relatedTargetId) return;
    api
      .addCardLink(board.id, card.id, relatedTargetId, relatedKind)
      .then(() => {
        setRelatedPickerOpen(false);
        setRelatedTargetId('');
        return refreshCard();
      })
      .catch((err) => console.error('Failed to add related card', err));
  }

  function removeRelatedLink(linkId: string) {
    api
      .removeCardLink(board.id, card.id, linkId)
      .then(() => refreshCard())
      .catch((err) => console.error('Failed to remove related card', err));
  }

  function submitComment() {
    const value = newComment.trim();
    if (!value) return;
    api
      .addComment(board.id, card.id, value)
      .then((comment) => {
        setComments((prev) => [...prev, comment]);
        refreshActivity();
      })
      .catch((err) => console.error('Failed to add comment', err));
    setNewComment('');
  }

  function startEditComment(comment: CommentDTO) {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.text);
  }

  function commitEditComment() {
    if (!editingCommentId) return;
    const text = editingCommentText.trim();
    if (!text) return;
    api
      .updateComment(board.id, card.id, editingCommentId, text)
      .then((updated) => {
        setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setEditingCommentId(null);
        refreshActivity();
      })
      .catch((err) => console.error('Failed to edit comment', err));
  }

  function removeComment(commentId: string) {
    api
      .deleteComment(board.id, card.id, commentId)
      .then(() => {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        refreshActivity();
      })
      .catch((err) => console.error('Failed to delete comment', err));
  }

  function loadMoreComments() {
    const oldest = comments[0]?.createdAt;
    api.fetchComments(board.id, card.id, oldest).then(({ comments: older }) => {
      setComments((prev) => [...older, ...prev]);
      setCommentsHasMore(older.length >= PAGE_SIZE);
    });
  }

  function loadMoreActivity() {
    const oldest = activity[activity.length - 1]?.timestamp;
    api.fetchActivity(board.id, card.id, oldest).then(({ entries: older }) => {
      setActivity((prev) => [...prev, ...older]);
      setActivityHasMore(older.length >= PAGE_SIZE);
    });
  }

  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...board.members.map((m) => ({
      value: m.userId,
      label: (
        <>
          <span className="avatar" style={{ width: 18, height: 18, fontSize: 8.5 }}>
            {initialsFor(m.username)}
          </span>
          {m.username}
        </>
      ),
    })),
  ];
  const assignedMember = board.members.find((m) => m.userId === card.assigneeId);
  const availableChips = board.chips.filter((c) => !card.chipIds.includes(c.id));
  const doneCount = card.subtasks.filter((s) => s.done).length;
  const otherCards = board.cards.filter((c) => c.id !== card.id);
  const due = card.dueDate ? dueDateInfo(card.dueDate, new Date().toISOString().slice(0, 10)) : null;

  return (
    <aside className={`drawer${locked ? ' locked' : ''}`}>
      <div className="drawer-header">
        <div className="drawer-topline">
          <div className="drawer-crumb">
            <span>Card</span>
            {locked && (
              <span className="lock-badge">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                View only
              </span>
            )}
          </div>
          <div className="drawer-actions">
            {!locked &&
              (confirmingDelete ? (
                <>
                  <button className="btn-danger-sm" type="button" onClick={confirmDelete}>
                    Delete
                  </button>
                  <button className="icon-btn" aria-label="Cancel delete" type="button" onClick={() => setConfirmingDelete(false)}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              ) : (
                <button className="btn-danger" type="button" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              ))}
            <button className="icon-btn" aria-label="Close" type="button" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {deleteError && <div className="delete-error">{deleteError}</div>}

        <input
          className="title-field lockable"
          value={title}
          disabled={locked}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
        />

        <div className="meta-row">
          <Dropdown
            value={card.columnId}
            disabled={locked}
            onChange={changeColumn}
            options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
          />

          {!board.hidePriority && (
            <Dropdown
              variant="value"
              value={card.priority}
              disabled={locked}
              triggerClassName={`badge-prio ${card.priority.toLowerCase()}`}
              onChange={changePriority}
              options={[
                { value: 'Low', label: 'Low' },
                { value: 'Medium', label: 'Medium' },
                { value: 'High', label: 'High' },
              ]}
            />
          )}

          {card.chipIds.map((id) => {
            const chip = board.chips.find((c) => c.id === id);
            if (!chip) return null;
            return (
              <button
                className="chip lockable"
                type="button"
                key={id}
                disabled={locked}
                style={tintStyle(`var(--lbl-${chip.color})`)}
                onClick={() => removeChip(id)}
                title="Remove tag"
              >
                {chip.name}
                <span className="pill-remove">×</span>
              </button>
            );
          })}
          {!locked && <LabelAdder options={availableChips} onAdd={addChip} />}
        </div>
      </div>

      <div className="drawer-body">
        <div>
          <div className="field-row">
            <span className="k">Assignee</span>
            {locked ? (
              <span className="chip" style={tintStyle('var(--accent)')}>
                {assignedMember?.username ?? 'Unassigned'}
              </span>
            ) : (
              <Dropdown
                variant="chip"
                value={card.assigneeId ?? ''}
                onChange={changeAssignee}
                options={assigneeOptions}
                triggerStyle={tintStyle('var(--accent)')}
                triggerContent={assignedMember?.username ?? 'Unassigned'}
              />
            )}
          </div>

          <div className="field-row">
            <span className="k">Due date</span>
            {editingDueDate ? (
              <input
                ref={dueDateInputRef}
                type="date"
                className="field-input"
                style={{ width: 'auto' }}
                autoFocus
                defaultValue={card.dueDate ?? ''}
                onBlur={(e) => changeDueDate(e.target.value)}
              />
            ) : (
              <span
                className={`pill${due ? ` due-${due.state}` : ''}${locked ? '' : ' lockable'}`}
                style={{ cursor: locked ? 'default' : 'pointer' }}
                onClick={() => !locked && setEditingDueDate(true)}
              >
                {due ? formatDate(card.dueDate!) : 'No due date'}
                {!locked && card.dueDate && (
                  <span
                    className="pill-remove"
                    title="Clear due date"
                    onClick={(e) => {
                      e.stopPropagation();
                      changeDueDate('');
                    }}
                  >
                    ×
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="field-row">
            <span className="k">Repeats</span>
            {editingRecurrence ? (
              <>
                <input
                  type="number"
                  className="field-input small"
                  style={{ width: 60 }}
                  min={1}
                  autoFocus
                  defaultValue={card.recurrenceIntervalDays ?? ''}
                  placeholder="off"
                  onBlur={(e) => changeRecurrence(e.target.value)}
                  onKeyDown={(e) => isEnterKey(e) && changeRecurrence((e.target as HTMLInputElement).value)}
                />
                <span className="k">days after done</span>
              </>
            ) : (
              <span
                className={`chip${locked ? '' : ' lockable'}`}
                style={{ cursor: locked ? 'default' : 'pointer', ...tintStyle(card.recurrenceIntervalDays ? 'var(--sem-good)' : 'var(--text-faint)') }}
                onClick={() => !locked && setEditingRecurrence(true)}
              >
                {card.recurrenceIntervalDays ? `Every ${card.recurrenceIntervalDays} days after done` : 'Off'}
                {!locked && card.recurrenceIntervalDays && (
                  <span
                    className="pill-remove"
                    title="Turn off repeat"
                    onClick={(e) => {
                      e.stopPropagation();
                      changeRecurrence('');
                    }}
                  >
                    ×
                  </span>
                )}
              </span>
            )}
          </div>

          {board.swimlanes.filter((s) => s.active).length > 1 && (
            <div className="field-row">
              <span className="k">Swimlane</span>
              <Dropdown
                variant="field"
                value={card.swimlaneId ?? ''}
                disabled={locked}
                onChange={changeSwimlane}
                options={board.swimlanes.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
          )}
        </div>

        <section>
          <div className="field-label">Description</div>
            {editingDescription ? (
              <textarea
                className="desc"
                rows={4}
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  commitDescription();
                  setEditingDescription(false);
                }}
              />
            ) : (
              <div
                className={`desc-rendered${locked ? '' : ' lockable'}`}
                onClick={() => !locked && setEditingDescription(true)}
                dangerouslySetInnerHTML={{
                  __html: description ? renderMarkdown(description) : '<p class="desc-empty">No description yet.</p>',
                }}
              />
            )}
          </section>

          <section>
            <div className="field-label">
              Subtasks · {doneCount} of {card.subtasks.length}
            </div>
            <div className="subtasks">
              {card.subtasks.map((subtask) =>
                editingSubtaskId === subtask.id ? (
                  <div className="subtask" key={subtask.id}>
                    <input
                      className="field-input"
                      autoFocus
                      value={editingSubtaskText}
                      onChange={(e) => setEditingSubtaskText(e.target.value)}
                      onBlur={commitEditSubtask}
                      onKeyDown={(e) => {
                        if (isEnterKey(e)) commitEditSubtask();
                        if (e.key === 'Escape') setEditingSubtaskId(null);
                      }}
                    />
                  </div>
                ) : (
                  <label
                    className={`subtask${subtask.done ? ' done' : ''}${subtask.id === justAddedSubtaskId ? ' just-added' : ''}`}
                    key={subtask.id}
                    data-subtask-id={subtask.id}
                  >
                    <input type="checkbox" className="lockable" checked={subtask.done} disabled={locked} onChange={() => toggleSubtask(subtask.id)} />
                    <span onClick={(e) => { if (!locked) { e.preventDefault(); startEditSubtask(subtask.id, subtask.text); } }}>
                      {subtask.text}
                    </span>
                    {!locked && (
                      <button type="button" className="icon-btn" aria-label="Remove subtask" onClick={() => removeSubtask(subtask.id)}>
                        ×
                      </button>
                    )}
                  </label>
                ),
              )}
              {!locked &&
                (addingSubtask ? (
                  <div className="subtask-add">
                    <input
                      type="text"
                      placeholder="Subtask text"
                      autoFocus
                      value={newSubtask}
                      onChange={(e) => setNewSubtask(e.target.value)}
                      onKeyDown={(e) => {
                        if (isEnterKey(e)) commitSubtask();
                        if (e.key === 'Escape') {
                          setNewSubtask('');
                          setAddingSubtask(false);
                        }
                      }}
                      onInput={(e) => (e.nativeEvent as InputEvent).inputType === 'insertLineBreak' && commitSubtask()}
                      onBlur={commitSubtask}
                    />
                  </div>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setAddingSubtask(true)}>
                    + Add subtask
                  </button>
                ))}
              {subtaskError && <div className="delete-error">{subtaskError}</div>}
            </div>
          </section>

          <section>
            <div className="field-label">Related cards</div>
            {card.relatedCards.map((rel) => (
              <div className="related-row" key={rel.linkId}>
                <div className="related-row-left">
                  <span className="related-kind">{rel.direction}</span>
                  {rel.title}
                </div>
                {!locked && (
                  <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => removeRelatedLink(rel.linkId)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!locked &&
              (relatedPickerOpen ? (
                <div className="field-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <SearchableSelect
                    options={otherCards.map((c) => ({ value: c.id, label: c.title }))}
                    value={relatedTargetId}
                    onChange={setRelatedTargetId}
                    placeholder="Pick a card…"
                  />
                  <select className="field-select" style={{ width: 'auto' }} value={relatedKind} onChange={(e) => setRelatedKind(e.target.value as typeof relatedKind)}>
                    <option value="related">Related</option>
                    <option value="this_precedes_that">This precedes that</option>
                    <option value="this_follows_that">This follows that</option>
                  </select>
                  <button type="button" className="btn-secondary" onClick={addRelatedLink}>
                    Add
                  </button>
                  <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setRelatedPickerOpen(false)}>
                    ×
                  </button>
                </div>
              ) : (
                <button type="button" className="add-task-btn" onClick={() => setRelatedPickerOpen(true)}>
                  + Link a card
                </button>
              ))}
          </section>

          <section>
            <div className="field-label">Comments</div>
            {commentsHasMore && (
              <button type="button" className="load-more" onClick={loadMoreComments}>
                Show more
              </button>
            )}
            {comments.map((comment) => (
              <div className="comment" key={comment.id}>
                <div className="comment-avatar">{initialsFor(comment.authorUsername)}</div>
                <div className="comment-body">
                  <div className="comment-meta">
                    <span>
                      {comment.authorUsername} · {new Date(comment.createdAt).toLocaleString()}
                      {comment.editedAt && ' (edited)'}
                    </span>
                    {!locked && (comment.authorId === currentUserId || canModerateComments) && (
                      <span className="comment-actions">
                        {comment.authorId === currentUserId && (
                          <button type="button" onClick={() => startEditComment(comment)}>
                            Edit
                          </button>
                        )}
                        <button type="button" onClick={() => removeComment(comment.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="composer">
                      <textarea value={editingCommentText} onChange={(e) => setEditingCommentText(e.target.value)} />
                      <div className="composer-foot">
                        <button type="button" className="btn-secondary" onClick={() => setEditingCommentId(null)}>
                          Cancel
                        </button>
                        <button type="button" className="btn-primary" onClick={commitEditComment}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="comment-text">{comment.text}</div>
                  )}
                </div>
              </div>
            ))}
            {!locked && (
              <div className="composer">
                <textarea placeholder="Write a comment…" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                <div className="composer-foot">
                  <span className="composer-hint">Visible to everyone on this board</span>
                  <button className="btn-primary" type="button" onClick={submitComment}>
                    Comment
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="field-label">Activity log</div>
            {activity.map((item) => (
              <div className={`log-item${item.kind === 'completion' ? ' completion' : ''}`} key={item.id}>
                {item.kind === 'completion' && <span className="log-check">✓</span>}
                <span className="log-time">{new Date(item.timestamp).toLocaleString()}</span>
                <span className="log-text">
                  {item.actorUsername && <b>{item.actorUsername} </b>}
                  {item.detail}
                </span>
              </div>
            ))}
            {activityHasMore && (
              <button type="button" className="load-more" onClick={loadMoreActivity}>
                Show more
              </button>
            )}
          </section>
      </div>
    </aside>
  );
}
