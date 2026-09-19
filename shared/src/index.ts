// Shared between backend and frontend so the API boundary is defined once.
// See docs/design/NEW-PROJECT-DESIGN.md ("Quick reference" / "Scope") for the
// entities and rules these types encode.

export type GlobalRole = 'app_admin' | 'app_user';
export type BoardRole = 'board_admin' | 'board_user' | 'board_reader';
export type Priority = 'Low' | 'Medium' | 'High';
export type RelationKind = 'related' | 'predecessor';
export type RelationDirection = 'related' | 'predecessor' | 'successor';
export type ThemePreference = 'system' | 'light' | 'dark';

export type ActivityKind =
  | 'create'
  | 'move'
  | 'field_edit'
  | 'completion'
  | 'recycle'
  | 'comment_posted'
  | 'comment_edited'
  | 'comment_deleted';

export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  board_admin: 'Board Admin',
  board_user: 'Board User',
  board_reader: 'Board Reader',
};

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  globalRole: GlobalRole;
  active: boolean;
  theme: ThemePreference;
}

/** Returned by /auth/me and /auth/login only -- never embedded elsewhere. */
export interface CurrentUser extends PublicUser {
  csrfToken: string;
}

export interface BoardStats {
  total: number;
  overdue: number;
  dueSoon: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  archived: boolean;
  myRole: BoardRole;
  all: BoardStats;
  mine: BoardStats;
}

export interface ColumnDTO {
  id: string;
  name: string;
  position: number;
  doNotNotify: boolean;
}

export interface SwimlaneDTO {
  id: string;
  name: string;
  position: number;
  active: boolean;
}

export interface ChipDTO {
  id: string;
  name: string;
  color: string;
}

export interface SubtaskDTO {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface RelatedCardDTO {
  linkId: string;
  cardId: string;
  title: string;
  direction: RelationDirection;
}

export interface CommentDTO {
  id: string;
  authorId: string;
  authorUsername: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

export interface ActivityLogEntryDTO {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  timestamp: string;
  kind: ActivityKind;
  detail: string;
  cycleCount?: number;
}

export interface CardDTO {
  id: string;
  title: string;
  description: string;
  columnId: string;
  swimlaneId: string | null;
  position: number;
  chipIds: string[];
  assigneeId: string | null;
  priority: Priority;
  subtasks: SubtaskDTO[];
  dueDate: string | null;
  recurrenceIntervalDays: number | null;
  cycleCount: number;
  enteredDoneAt: string | null;
  relatedCards: RelatedCardDTO[];
}

export interface BoardMemberDTO {
  userId: string;
  username: string;
  boardRole: BoardRole;
}

export interface BoardDetailDTO {
  id: string;
  name: string;
  archived: boolean;
  myRole: BoardRole;
  /** Null until a Board Admin explicitly assigns both -- always true for a
   * freshly created board (pre-seeded), but a migrated board starts unset
   * per the design doc's Migration section (no name-matched guessing). */
  backlogColumnId: string | null;
  doneColumnId: string | null;
  reNotifyIntervalDays: number;
  dailyNotifyTime: string;
  recycleDelayHours: number;
  /** Days a card stays visible after entering Done; 0 = forever. Hides (never deletes) from the card list and every count. */
  doneCardVisibilityDays: number;
  /** Board-level setting: hide the priority badge on card faces for this board. */
  hidePriority: boolean;
  hideAvatar: boolean;
  columns: ColumnDTO[];
  swimlanes: SwimlaneDTO[];
  chips: ChipDTO[];
  members: BoardMemberDTO[];
  cards: CardDTO[];
}

export interface ApiErrorBody {
  error: string;
}
