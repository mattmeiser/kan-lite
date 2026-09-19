import type {
  ActivityLogEntryDTO,
  BoardDetailDTO,
  BoardRole,
  BoardSummary,
  CardDTO,
  ChipDTO,
  ColumnDTO,
  CommentDTO,
  CurrentUser,
  GlobalRole,
  Priority,
  PublicUser,
  SubtaskDTO,
  SwimlaneDTO,
  ThemePreference,
} from '@kanlite/shared';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string) {
  csrfToken = token;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');

  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, {
    method,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // No body (e.g. a bare 204/401).
  }

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

function withCsrf<T extends CurrentUser>(user: T): T {
  setCsrfToken(user.csrfToken);
  return user;
}

// -- Auth --

export function bootstrapStatus() {
  return request<{ needsSetup: boolean }>('/auth/bootstrap-status');
}

export function bootstrap(username: string, email: string, password: string) {
  return request<CurrentUser>('/auth/bootstrap', { body: { username, email, password } }).then(withCsrf);
}

export function login(username: string, password: string) {
  return request<CurrentUser>('/auth/login', { body: { username, password } }).then(withCsrf);
}

export function logout() {
  return request<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export function fetchCurrentUser() {
  return request<CurrentUser>('/auth/me').then(withCsrf);
}

export function requestPasswordReset(username: string) {
  return request<{ message: string }>('/auth/request-reset', { body: { username } });
}

export function confirmPasswordReset(token: string, password: string) {
  return request<CurrentUser>('/auth/confirm-reset', { body: { token, password } }).then(withCsrf);
}

export function setTheme(theme: ThemePreference) {
  return request<{ success: boolean }>('/me/theme', { method: 'PATCH', body: { theme } });
}

// -- Users (App Admin) --

export function fetchUsers() {
  return request<{ users: PublicUser[] }>('/users');
}

export function createUserInvite(input: { username: string; email: string; globalRole?: GlobalRole; boardId?: string; boardRole?: BoardRole }) {
  return request<PublicUser>('/users', { body: input });
}

export function setUserActive(userId: string, active: boolean) {
  return request<PublicUser>(`/users/${userId}/active`, { body: { active } });
}

export function setUserRole(userId: string, globalRole: GlobalRole) {
  return request<PublicUser>(`/users/${userId}/role`, { body: { globalRole } });
}

export function adminResetPassword(userId: string) {
  return request<{ success: boolean }>(`/users/${userId}/reset-password`, { method: 'POST' });
}

// -- Boards --

export function fetchBoards(includeArchived = false) {
  return request<{ boards: BoardSummary[] }>('/boards', { query: { archived: includeArchived ? 'true' : undefined } });
}

export function createBoard(name: string) {
  return request<BoardDetailDTO>('/boards', { body: { name } });
}

export function fetchBoard(boardId: string) {
  return request<BoardDetailDTO>(`/boards/${boardId}`);
}

export function updateBoardSettings(
  boardId: string,
  patch: Partial<{
    name: string;
    backlogColumnId: string;
    doneColumnId: string;
    reNotifyIntervalDays: number;
    dailyNotifyTime: string;
    recycleDelayHours: number;
  }>,
) {
  return request<BoardDetailDTO>(`/boards/${boardId}`, { method: 'PATCH', body: patch });
}

export function archiveBoard(boardId: string, archived: boolean) {
  return request<{ success: boolean }>(`/boards/${boardId}/archive`, { body: { archived } });
}

export function deleteBoard(boardId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}`, { method: 'DELETE' });
}

export function previewPurgeDoneCards(boardId: string, days: number) {
  return request<{ count: number }>(`/boards/${boardId}/purge-done-cards/preview`, { query: { days } });
}

export function purgeDoneCards(boardId: string, days: number) {
  return request<{ deleted: number }>(`/boards/${boardId}/purge-done-cards`, { body: { days } });
}

export function fetchUserDirectory(boardId: string) {
  return request<{ id: string; username: string }[]>(`/boards/${boardId}/user-directory`);
}

export function setBoardMember(boardId: string, username: string, role: BoardRole) {
  return request<{ success: boolean }>(`/boards/${boardId}/members`, { method: 'PUT', body: { username, role } });
}

export function removeBoardMember(boardId: string, userId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' });
}

// -- Columns / swimlanes / chips --

export function createColumn(boardId: string, name: string) {
  return request<ColumnDTO>(`/boards/${boardId}/columns`, { body: { name } });
}

export function updateColumn(boardId: string, columnId: string, patch: { name?: string; doNotNotify?: boolean }) {
  return request<{ success: boolean }>(`/boards/${boardId}/columns/${columnId}`, { method: 'PATCH', body: patch });
}

export function reorderColumns(boardId: string, orderedIds: string[]) {
  return request<{ success: boolean }>(`/boards/${boardId}/columns/reorder`, { body: { orderedIds } });
}

export function deleteColumn(boardId: string, columnId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/columns/${columnId}`, { method: 'DELETE' });
}

export function createSwimlane(boardId: string, name: string) {
  return request<SwimlaneDTO>(`/boards/${boardId}/swimlanes`, { body: { name } });
}

export function updateSwimlane(boardId: string, swimlaneId: string, patch: { name?: string; active?: boolean }) {
  return request<{ success: boolean }>(`/boards/${boardId}/swimlanes/${swimlaneId}`, { method: 'PATCH', body: patch });
}

export function reorderSwimlanes(boardId: string, orderedIds: string[]) {
  return request<{ success: boolean }>(`/boards/${boardId}/swimlanes/reorder`, { body: { orderedIds } });
}

export function deleteSwimlane(boardId: string, swimlaneId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/swimlanes/${swimlaneId}`, { method: 'DELETE' });
}

export function createChip(boardId: string, name: string, color: string) {
  return request<ChipDTO>(`/boards/${boardId}/chips`, { body: { name, color } });
}

export function updateChip(boardId: string, chipId: string, patch: { name?: string; color?: string }) {
  return request<{ success: boolean }>(`/boards/${boardId}/chips/${chipId}`, { method: 'PATCH', body: patch });
}

export function deleteChip(boardId: string, chipId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/chips/${chipId}`, { method: 'DELETE' });
}

// -- Cards --

export function createCard(boardId: string, columnId: string, title: string, swimlaneId?: string | null) {
  return request<CardDTO>(`/boards/${boardId}/cards`, { body: { columnId, swimlaneId, title } });
}

export function fetchCard(boardId: string, cardId: string) {
  return request<CardDTO>(`/boards/${boardId}/cards/${cardId}`);
}

export function updateCard(
  boardId: string,
  cardId: string,
  patch: Partial<{
    title: string;
    description: string;
    assigneeId: string | null;
    priority: Priority;
    dueDate: string | null;
    recurrenceIntervalDays: number | null;
  }>,
) {
  return request<CardDTO>(`/boards/${boardId}/cards/${cardId}`, { method: 'PATCH', body: patch });
}

export function moveCard(boardId: string, cardId: string, columnId: string, position: number, swimlaneId?: string | null) {
  return request<CardDTO>(`/boards/${boardId}/cards/${cardId}/move`, { body: { columnId, swimlaneId, position } });
}

export function deleteCard(boardId: string, cardId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/cards/${cardId}`, { method: 'DELETE' });
}

export function addCardChip(boardId: string, cardId: string, chipId: string) {
  return request<CardDTO>(`/boards/${boardId}/cards/${cardId}/chips`, { body: { chipId } });
}

export function removeCardChip(boardId: string, cardId: string, chipId: string) {
  return request<CardDTO>(`/boards/${boardId}/cards/${cardId}/chips/${chipId}`, { method: 'DELETE' });
}

export function addSubtask(boardId: string, cardId: string, text: string) {
  return request<SubtaskDTO>(`/boards/${boardId}/cards/${cardId}/subtasks`, { body: { text } });
}

export function updateSubtask(boardId: string, cardId: string, subtaskId: string, text: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/cards/${cardId}/subtasks/${subtaskId}`, {
    method: 'PATCH',
    body: { text },
  });
}

export function toggleSubtask(boardId: string, cardId: string, subtaskId: string) {
  return request<SubtaskDTO>(`/boards/${boardId}/cards/${cardId}/subtasks/${subtaskId}/toggle`, { method: 'POST' });
}

export function removeSubtask(boardId: string, cardId: string, subtaskId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/cards/${cardId}/subtasks/${subtaskId}`, {
    method: 'DELETE',
  });
}

export function addCardLink(
  boardId: string,
  cardId: string,
  otherCardId: string,
  relation: 'related' | 'this_precedes_that' | 'this_follows_that',
) {
  return request<{ success: boolean; linkId: string }>(`/boards/${boardId}/cards/${cardId}/links`, {
    body: { otherCardId, relation },
  });
}

export function removeCardLink(boardId: string, cardId: string, linkId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/cards/${cardId}/links/${linkId}`, { method: 'DELETE' });
}

export function fetchComments(boardId: string, cardId: string, before?: string) {
  return request<{ comments: CommentDTO[] }>(`/boards/${boardId}/cards/${cardId}/comments`, { query: { before } });
}

export function addComment(boardId: string, cardId: string, text: string) {
  return request<CommentDTO>(`/boards/${boardId}/cards/${cardId}/comments`, { body: { text } });
}

export function updateComment(boardId: string, cardId: string, commentId: string, text: string) {
  return request<CommentDTO>(`/boards/${boardId}/cards/${cardId}/comments/${commentId}`, {
    method: 'PATCH',
    body: { text },
  });
}

export function deleteComment(boardId: string, cardId: string, commentId: string) {
  return request<{ success: boolean }>(`/boards/${boardId}/cards/${cardId}/comments/${commentId}`, {
    method: 'DELETE',
  });
}

export function fetchActivity(boardId: string, cardId: string, before?: string) {
  return request<{ entries: ActivityLogEntryDTO[] }>(`/boards/${boardId}/cards/${cardId}/activity`, {
    query: { before },
  });
}
