// Row shapes for the source Kanboard SQLite database, reverse-engineered
// from the vendored PHP schema history (app/Schema/Sqlite.php) in the
// a sibling repo -- Kanboard has no schema.sql for SQLite,
// only a sequence of version_N migration functions, so these reflect the
// *final* (post-migration) column set as of that schema's version 128.

export interface KbUser {
  id: number;
  username: string;
  email: string | null;
  name: string | null;
  role: 'app-admin' | 'app-manager' | 'app-user' | string;
  is_active: number;
}

export interface KbProject {
  id: number;
  name: string;
  is_active: number;
  priority_start: number;
  priority_end: number;
}

export interface KbProjectHasUser {
  project_id: number;
  user_id: number;
  role: 'project-manager' | 'project-member' | 'project-viewer' | string;
}

export interface KbColumn {
  id: number;
  title: string;
  position: number;
  project_id: number;
}

export interface KbSwimlane {
  id: number;
  name: string;
  position: number;
  is_active: number;
  project_id: number;
}

export interface KbTag {
  id: number;
  name: string;
  project_id: number;
  color_id: string | null;
}

export interface KbTaskHasTag {
  task_id: number;
  tag_id: number;
}

export interface KbCategory {
  id: number;
  name: string;
  project_id: number;
  color_id: string | null;
}

export interface KbTask {
  id: number;
  title: string;
  description: string | null;
  date_creation: number | null;
  date_modification: number | null;
  date_moved: number | null;
  color_id: string | null;
  project_id: number;
  column_id: number;
  owner_id: number;
  creator_id: number;
  position: number;
  is_active: number;
  date_due: number | null;
  category_id: number;
  swimlane_id: number;
  priority: number;
}

export interface KbComment {
  id: number;
  task_id: number;
  user_id: number;
  date_creation: number;
  comment: string;
}

export interface KbSubtask {
  id: number;
  title: string;
  status: number;
  position: number;
  task_id: number;
}
