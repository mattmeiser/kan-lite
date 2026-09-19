import type { BoardRole, GlobalRole, Priority, ThemePreference } from '@kanlite/shared';

// Raw row shapes as they come back from node:sqlite (snake_case columns,
// booleans as 0/1). Mapping to API DTOs happens in the route layer.

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  global_role: GlobalRole;
  active: number;
  theme: ThemePreference;
  failed_login_count: number;
  lockout_until: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
}

export interface ResetTokenRow {
  id: string;
  user_id: string;
  kind: 'invite' | 'reset';
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface BoardRow {
  id: string;
  name: string;
  archived: number;
  backlog_column_id: string | null;
  done_column_id: string | null;
  re_notify_interval_days: number;
  daily_notify_time: string;
  recycle_delay_hours: number;
  done_card_visibility_days: number;
  hide_priority: number;
  hide_avatar: number;
  created_at: string;
}

export interface ColumnRow {
  id: string;
  board_id: string;
  name: string;
  position: number;
  do_not_notify: number;
}

export interface SwimlaneRow {
  id: string;
  board_id: string;
  name: string;
  position: number;
  active: number;
}

export interface BoardMemberRow {
  board_id: string;
  user_id: string;
  board_role: BoardRole;
}

export interface ChipRow {
  id: string;
  board_id: string;
  name: string;
  color: string;
}

export interface CardRow {
  id: string;
  board_id: string;
  column_id: string;
  swimlane_id: string | null;
  title: string;
  description: string;
  position: number;
  assignee_id: string | null;
  priority: Priority;
  due_date: string | null;
  recurrence_interval_days: number | null;
  cycle_count: number;
  entered_done_at: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtaskRow {
  id: string;
  card_id: string;
  text: string;
  done: number;
  position: number;
}

export interface CardLinkRow {
  id: string;
  card_a_id: string;
  card_b_id: string;
  kind: 'related' | 'predecessor';
}

export interface CommentRow {
  id: string;
  card_id: string;
  author_id: string;
  text: string;
  created_at: string;
  edited_at: string | null;
}

export interface ActivityLogRow {
  id: string;
  card_id: string;
  actor_id: string | null;
  timestamp: string;
  kind: string;
  detail: string;
  cycle_count: number | null;
}
