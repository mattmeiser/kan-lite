# KanLite -- design doc

Status: the original design input for this **new, standalone project**.
Nothing here depends on Kanboard's code; it exists to hand off enough
context to start a fresh repo from scratch.

**Reading order for a build agent**: Non-goals, then Quick reference, then
Scope for full detail on any one thing. Architecture, Migration, UI mockups,
Responsiveness follow. Non-obvious issues and the Decision log at the end
are background -- worth reading once, not something to re-derive answers
from during implementation.

## Why this exists, instead of stripping Kanboard down

An earlier attempt spent real effort building a React UI on top
of vendored Kanboard, then hit a wall: Kanboard's feature set is built for
multi-team enterprise use, and almost none of it applies here (LDAP, OAuth
SSO, custom role matrices, analytics, plugins, calendar/Gantt views, CSV
import/export, public share links, time tracking, 2FA, recurring tasks --
all scoped for removal and listed in full under Non-goals below).

Stripping a large inherited codebase down to a small target shape is real
surgical work with real risk of collateral breakage -- especially deleting
vendored backend/schema code nobody on this project originally designed.
The actual desired feature set below is small enough that building it
directly is very plausibly *less* total effort, and avoids an indefinite
maintenance tax of babysitting a heavily modified fork of someone else's
large application forever.

What *does* carry over cleanly: the React UI (board, cards, drawer,
drag-and-drop, label chips, the collapsed-hamburger shell) was already built
behind a clean JSON API boundary, decoupled from Kanboard's PHP internals.
That UI, its design tokens, and its component structure are the main asset
worth carrying forward into this project -- see "Reusable UI assets" below.

## Non-goals (explicitly not building)

Restated as "never build" rather than "remove": LDAP auth, OAuth2/SSO login, custom/configurable
roles beyond the five fixed roles above, external issue-tracker integration
(GitHub/GitLab/Jira), cross-board bulk operations, analytics/reports/
burndown charts, a plugin system, multi-language UI, two-factor auth,
calendar/Gantt views, CSV import/export, public/anonymous share links, iCal
feed export, time tracking, cross-board search, a cross-board activity
feed (at "a couple/few boards" scale, looking
at a board directly covers what search would do, and the per-card
activity log already covers history at the card level), and a separate
assignment notification (being assigned a card doesn't send anything --
due-date reminders are the only *card-related* thing that notifies
anyone; account lockout is a deliberate, narrow exception -- see Auth
below). Also cut: **file attachments** (real added complexity --
storage, size limits, serving -- for something a description link or a
comment already covers reasonably well at this scale), **card
duplication** (recurrence already covers the real underlying need --
a task that repeats -- far better than copy-paste convenience would),
and **bulk select/move within a board** (not just cross-board bulk
operations above -- selecting several cards at once and moving/deleting
them together, one at a time via drag stays the only way, consistent
with not adding machinery for a workflow this app's actual scale
doesn't need).

(Recurring tasks were originally on this cut list but were added back to
scope -- see Cards below. They're deliberately *not* Kanboard's version:
no fixed calendar schedule, just an interval anchored off actual
completion time.)

Also not carried over from Kanboard's data model: no separate "Category"
entity distinct from labels (category chips *are* the label concept here),
no per-project priority-range configuration, no multi-org/workspace
hierarchy above "a flat list of boards."

## Quick reference

A fast cheat-sheet. Every entry here is explained in full, with rationale,
in Scope below -- this section exists so a build agent doesn't have to
read 700 lines of prose just to scaffold a schema.

### Roles

| Role | Scope | Can |
|---|---|---|
| App Admin | Global | Create/deactivate/reset-password/promote-demote users (never the last admin); create boards; Board Admin rights on every board (computed at request time, never stored as a membership row) |
| App User | Global | Baseline account; sees only boards they're an explicit member of |
| Board Admin | Per board | Everything Board User can, plus: rename the board, manage columns/swimlanes/category chips, manage membership, assign which columns are Backlog and Done |
| Board User | Per board | Create/edit/delete cards and every field on them, move cards, post/edit/delete their own comments |
| Board Reader | Per board | View board, cards, comments, and activity log only -- no mutations at all |

### Entities

All entities also carry a `created_at` timestamp, and (where mutable after
creation) an `updated_at` timestamp, omitted from the per-entity lists below
for brevity -- these are ordinary audit columns, not called out per entity.

- **User** -- username (unique, case-insensitive for both the uniqueness
  check and login lookup -- stored with the casing the person typed, so
  "Matt" and "matt" can't become two accounts or two different login
  behaviors), email (required, *not* unique -- multiple
  accounts can share one inbox), password hash, global role, active flag,
  theme preference, failed-login count, lockout-until timestamp.
- **Board** -- name, archived flag, `backlog_column` (FK, always set),
  `done_column` (FK, always set, never equal to backlog_column),
  re-notify interval in days (default 7), daily notify check-time,
  recycle delay in hours (default 24), done-card visibility window in
  days (default 0, meaning forever), show-priority flag (default true).
- **Board membership** -- board, user, role (admin/user/reader).
- **Column** -- name, position, board, do-not-notify flag (an independent
  bool, unlike Backlog/Done which are board-level assignments, not
  per-column flags).
- **Swimlane** -- name, position, active flag, board.
- **Category chip** -- name, color, board.
- **Card** -- title, description (markdown), column, swimlane (nullable),
  position, chips (many-to-many), assignee (nullable, must be a member of
  the card's board), priority (Low/Medium/High), due date (calendar date,
  nullable), recurrence interval in days (nullable), cycle count (starts at
  0), "entered Done" timestamp (nullable -- set whenever the card moves into
  the board's current Done column, cleared whenever it leaves, whether by
  drag or by recycling -- this is what the recycle job compares against the
  recycle delay, and it's tracked regardless of whether the card has a
  recurrence interval, since a non-recurring card can still pass through
  Done), `notified_at` (nullable -- see Due-date notifications below for
  when it's set and cleared).
- **Subtask** -- card, text, done/not-done flag, position (ordered within
  the card).
- **Related-card link** -- card A, card B, type (`related` -- symmetric,
  or `predecessor` -- A precedes B, "successor" is just the inverse read,
  never a second stored row).
- **Comment** -- card, author, text, created-at, edited-at (nullable --
  drives an "(edited)" indicator; this field was missing until this
  reorganization pass surfaced it while tabulating every entity's fields,
  a real gap this table-building exercise caught).
- **Activity log entry** -- card, actor, timestamp, kind (create / move /
  field-edit [includes subtask add/toggle/edit/remove, chip changes, due-
  date changes -- anything that's "a field changed"] / completion /
  recycle / comment-posted / comment-edited / comment-deleted).

### Key numbers

| Setting | Value |
|---|---|
| Session length | 30 days, sliding (refreshed each request) |
| Password minimum | 8 characters, no complexity rules |
| Reset/invite token | >= 32 random bytes, 30-minute expiry |
| Lockout | 10 failed attempts -> 15-minute lock, counter resets on any successful login |
| Recycle delay | 24 hours default, per-board, Board Admin-editable |
| Re-notify interval | weekly default, per-board, Board Admin-editable |
| Done card visibility window | 0 (forever) default, per-board, Board Admin-editable, in days |
| Activity log / comments page size | 15 entries, "Show more" loads 15 more |
| Board column max-width | 300px |
| Responsive breakpoint | 640px (the only one -- see Responsiveness) |
| Username | 3-32 characters, letters/digits/`.`/`_`/`-` only |
| Board / column / swimlane / category chip name | 1-60 characters |
| Card title | 1-200 characters |
| Subtask text | 1-200 characters |
| Description / comment (markdown) | 20,000 characters |
| IP-based rate limit (`/login`, `/reset-request`) | 20 requests/minute per IP, on top of per-account lockout |

The name/text/description length limits above are ordinary server-side
validation bounds, not product decisions with real tradeoffs -- picked so
every free-text field has *some* cap (an unbounded field is one abuse
vector and one accidental-paste-of-a-whole-file away from a bad time),
generous enough that no real family use bumps into them. Adjust freely if
implementation turns up a better number; the point is that each field has
a stated limit going in, not the specific values.

### Scheduled job -- one process, three responsibilities

1. **Due-date digests** -- one email per person per board per run, not one
   per card.
2. **Recurrence recycling** -- moves a recurring card from Done to Backlog
   once its board's recycle delay has elapsed.
3. **Housekeeping** -- purges expired/used reset-and-invite tokens and
   sessions past their sliding window.

Notably **not** a fourth responsibility here: the Done card visibility
window (see Boards below) is a live read-time filter evaluated whenever a
board is fetched, not a batch job that hides or touches rows -- there's
nothing for the scheduler to do periodically for it, unlike the three
above.

## Scope

### Users and roles

Two independent role dimensions:

**Global role** (one per user, app-wide):
- **App Admin** -- manage user accounts (create, deactivate, reset
  password, **promote an App User to App Admin or demote an App Admin
  back to App User**), create new boards, and has Board Admin rights on
  every board regardless of per-board membership. Promotion is the only
  way a second App Admin ever exists beyond the one the first-run wizard
  creates -- worth stating explicitly rather than leaving it implied,
  since without it there'd be no path to a second admin at all. An App
  Admin can demote themselves too, as long as at least one other App
  Admin still exists (never demote *or deactivate* the last one -- same
  one-admin-minimum principle as Boards never losing their last
  Backlog/Done column). **Deliberately no hard-delete for users** -- only
  deactivate. A deleted user would leave dangling references everywhere
  their name/ID is used as history (activity log entries, comment
  authorship), which has to stay attributable forever by design (see
  Activity log below); deactivation keeps that history intact while
  fully blocking login. **Deactivation also ends any session the user
  already has open, immediately, not just future login attempts** --
  since sessions are server-side (see Auth below), every request already
  looks the session row up, so checking the user's active flag at that
  same lookup is enough; a deactivated user with a valid 30-day cookie
  still sitting in their browser must be logged out on their very next
  request, not able to keep working until that cookie happens to expire.
- **App User** -- baseline authenticated account. Sees and acts only on
  boards they're an explicit member of, per that board's role below.

**Board role** (one per user per board they're a member of):
- **Board Admin** -- everything Board User can do, plus: rename the
  board itself, manage the board's columns and swimlanes
  (create/rename/reorder/delete), manage the board's category chips
  (create/rename/recolor/delete), and manage board membership
  (add/remove members, set their board role).
- **Board User** -- create/edit/delete cards and every field on them
  (chips, assignee, priority, subtasks, due date, recurrence, related
  cards), move cards between columns/swimlanes, post/edit/delete their
  own comments.
- **Board Reader** -- view the board and its cards only. No mutations.

A user with no membership on a board cannot see that board at all (not even
its existence) unless they're an App Admin.

A board can never end up with no one able to administer it, even if its
last explicit Board Admin is removed or demoted: App Admin's Board-Admin-
everywhere right is a standing safety net, not just a shortcut.

For schema/implementation purposes: an App Admin's board-level rights are
**computed at request time** from their global role (`if user.appRole ===
'admin', treat as board-admin on every board`), never materialized as an
actual membership row on boards they haven't explicitly joined. A board's
member list/count should reflect only explicit members -- an App Admin
silently appearing in every board's member list because a row got created
for them would be a bug, not a feature.

### Boards

- A board has a name and belongs to the whole app (no nested
  workspaces/organizations -- just a flat list of boards).
- An App Admin can **archive** a board (hides it from the dashboard and
  from every non-admin's access entirely, keeps all its data --
  reversible) or **permanently delete** one (destroys it and everything on
  it -- not reversible). Two distinct actions, not one: archive is the
  everyday "don't need this active anymore" move, delete is a deliberate,
  rarer cleanup/privacy action. An archived board disappears from its
  members' dashboards and can't be opened by them even via a direct/old
  URL; App Admins reach it through a separate **"Archived boards" view**
  (e.g. a filter/tab alongside the normal dashboard) to review and
  unarchive it later -- without that view an archived board would have no
  way back short of direct database access. Delete cascades to genuinely
  everything scoped to that board -- columns, swimlanes, category chips,
  cards, comments, activity logs, related-card links, board membership
  rows -- not a partial cleanup that leaves orphaned rows behind for
  something else to eventually notice. Because that cascade is total and
  irreversible (unlike archive), **deleting a board requires typing the
  board's name to confirm** -- more friction than the plain confirm click
  used for deleting a single card (see Cards below), matching the bigger
  blast radius. An archived board is also excluded from the scheduled job
  entirely -- no due-date reminders, no recurrence recycling -- otherwise
  "archived" wouldn't actually mean inactive.
- Creating a board **auto-adds the creating App Admin as an explicit
  Board Admin member** of it. Functionally redundant with their computed
  App Admin rights (see Users and roles above), but without it the
  creator wouldn't appear in their own board's Members list, which would
  read as a bug ("I made this, why aren't I on it?") rather than the
  intended computed-rights behavior.
- A new board starts **pre-seeded**, not empty: three columns (Backlog,
  In Progress, Done), with Backlog and Done already assigned to those two
  and Done also flagged Do-not-notify. A Board Admin can rename or add
  more columns exactly like any other column -- they're a sane starting
  point instead of a blank board, and they close a real trap by
  construction: a Done column that isn't also flagged do-not-notify would
  otherwise keep emailing reminders for cards that are already finished.
- **Columns**: ordered, named (e.g. Backlog / In Progress / Done). Board
  Admin can add, rename, reorder, delete (deleting a column that still has
  cards in it is blocked, same as deleting the board's current Backlog or
  Done column -- see below; a board must always keep at least the two
  columns those two roles need).
  - **Backlog and Done are always assigned to some column -- never
    unset.** Not a per-column on/off flag; a board-level setting
    ("Backlog column: ___", "Done column: ___") that always points
    somewhere, pre-filled by the seeding above. A Board Admin can **move**
    either one to a different column at any time (which un-assigns the
    old column as a side effect of assigning the new one -- radio-button
    behavior), but there's no action that unsets one to "none." This
    also means deleting the column currently holding either assignment is
    blocked until the Board Admin moves that assignment elsewhere first.
    Backlog and Done must also always be two different columns from each
    other -- a card can't simultaneously mean both things. Moving Done to
    a different column needs no migration/cleanup step for cards left
    behind in the old one: the recycle job (see Recurrence below) always
    checks a card's *current* column against the board's *current* Done
    assignment, live, every run -- never a cached/snapshotted flag -- so
    a card sitting in what used to be Done simply stops being watched the
    moment the assignment moves, automatically and correctly, with
    nothing to maintain by hand.
  - **Do-not-notify** -- a true independent per-column flag, any number
    of columns, freely toggled on/off (unlike Backlog/Done above). A card
    sitting in a do-not-notify column doesn't send due-date reminders.
    Deliberately its own flag rather than folded into Done: a board might
    also want e.g. a Blocked or Icebox column to stay quiet without those
    cards counting as finished. (The seeded Done column carries this flag
    from the start, but it's independently toggleable afterward -- moving
    Done to a different column doesn't automatically bring do-not-notify
    with it.)
- **Swimlanes**: ordered, named, optional -- a board with exactly one
  swimlane behaves like it has none (matches the existing React Board.tsx's
  "grouped only if length > 1" behavior, worth keeping). Board Admin can
  add, rename, reorder, activate/deactivate, delete (same non-empty-delete
  block as columns above). Cards created while a board has 0/1 swimlanes
  carry a null swimlane; when a board crosses from <=1 to 2+ swimlanes,
  those existing null-swimlane cards are treated as belonging to the
  first (lowest-position) swimlane rather than needing manual reassignment
  -- no separate migration step, and consistent with the "grouped only if
  length > 1" rule above.
- **Category chips** (this app's only label concept -- no separate
  "categories" vs "tags" split like Kanboard has): named, colored -- color
  is picked from the fixed set of label hues defined as design tokens (see
  Reusable UI assets below), not a free-form color picker, so a chip's
  stored color value is one of those token keys, not an arbitrary hex
  string. Board Admin can create/rename/recolor/delete a board's set of
  chips. A card can
  carry zero or more chips. **The board view filters by chip** -- clicking
  a chip in the board's filter bar (or on a card) shows only cards
  carrying it, same behavior already in the mockup.
- **Done card visibility window**: a board-level setting, in days, that
  caps how long a completed card stays visible on the board -- **`0` means
  forever** (the default, so a fresh board's behavior doesn't change until
  a Board Admin opts in). Once a card has been sitting in the board's
  current Done column longer than this window (measured from the same
  "entered Done" timestamp the recycle job already uses -- see Cards
  below -- so no new field is needed, and the clock naturally restarts
  each time a recurring card cycles back through Done), it's excluded
  from the Done column's card list *and* from every count that would
  otherwise include it -- the column's own header count, and the
  dashboard's "All"/"Mine" stats (see the Decision log's multi-board
  landing page entry). Purely a **live display filter**, not a state
  change or a deletion: the card row, its comments, and its activity log
  are untouched and still fully intact, still reachable by its own direct
  URL or via a related-card link from another card that still references
  it -- nothing about the card itself is different, it's just not listed.
  Days, not hours, deliberately: this is a long-term decluttering setting
  (weeks/months of accumulated finished work), a different scale and a
  different purpose than the recycle delay's short undo-window role (see
  Recurrence below) -- the two settings are independent and don't share a
  field, the same way Do-not-notify stayed independent of Done above.
  There's no separate "show hidden/older completed cards" view or toggle
  in v1 -- consistent with this doc's general stance against extra
  machinery at this scale (no cross-board search, no bulk operations): if
  old completed work needs revisiting, a Board Admin raises the window (or
  sets it back to `0`) and the cards reappear immediately, since the
  filter is computed live against the setting's current value, never
  snapshotted.
- **Purge done cards utility**: a **manual, on-demand action** in board
  settings -- distinct from the visibility window above, which is a
  passive, non-destructive, always-on setting. A Board Admin types in
  *N* days and runs it; the app **permanently deletes** every card
  currently sitting in the board's current Done column whose "entered
  Done" timestamp (the same field the visibility window and recycle job
  already use) is older than *N* days. Deliberately **not** a stored
  per-board setting and **not** run by the scheduled job -- an
  irreversible bulk-delete action stays under direct, one-time human
  control each time it's used, rather than quietly running unattended on
  a schedule. Mechanically it's the existing per-card delete (see Cards
  below) applied to a batch: each purged card's comments, activity log,
  and any related-card links pointing at it are gone along with it, same
  as deleting that card individually. **Recurring cards (a set recurrence
  interval) are always excluded from the purge target set, regardless of
  N** -- a recurring card reuses the same row specifically to keep
  accumulating history and to recycle again later, and purging one would
  destroy both; a recurring card that's been in Done a long time is
  presumably just waiting on its recycle delay (or genuinely stuck, which
  is a "go look at it" situation, not a "delete it" one), not a candidate
  for cleanup. Runs against the live current Done column the same way the
  visibility window and recycle job do, and is entirely independent of
  the visibility window's own threshold -- a card can be purge-eligible
  whether or not it's currently hidden by that window; the two settings
  just both happen to key off the same timestamp. Before deleting
  anything, the Board Admin sees a **preview count** ("This will
  permanently delete 14 cards") and confirms with a plain click -- the
  same friction tier as deleting a single card, since the action is
  visible and deliberate either way, just applied to more than one card
  at a time. *N* = `0` is allowed (unlike the visibility window, where
  `0` is a special "forever" sentinel) and simply means "every
  non-recurring card currently in Done, regardless of how long it's been
  there" -- a legitimate full-cleanup use case, not an error case; the
  preview count is what protects against running it by accident.
- **Priority visibility**: a board-level boolean, default **on** (matches
  today's behavior, so nothing changes until a Board Admin opts out).
  Turning it **off** removes the priority badge from every card on the
  board -- both the board's card list and the drawer -- and removes the
  drawer's control for setting or changing it, since there's nothing left
  to click. Purely a **display toggle**, same "hide, don't destroy"
  pattern as the done-card visibility window above: any priority values
  cards already had are left untouched in storage, simply not shown or
  editable while the setting is off, and turning it back on reveals
  everything exactly as it was -- nothing to migrate or recompute either
  way. A card created while it's off just never gets a priority (there's
  no control to set one with) unless the board turns it back on later.
  **Past activity-log entries recording a priority change stay visible
  regardless of the current setting** -- the log is never scrubbed for a
  display toggle, the same principle already applied to the done-card
  visibility window's hidden cards. No finer-grained version of this (e.g.
  choosing which of Low/Medium/High to allow) -- a plain on/off matches
  Priority's existing simplicity elsewhere in this doc (no numeric range,
  no per-board custom scale).
- **Board settings**: which column is Backlog and which is Done (above),
  the due-date re-notification interval (below, default weekly), the
  daily reminder time-of-day (below), the recurrence recycle delay
  (below, default 24 hours), the done card visibility window (above,
  default `0`/forever), and priority visibility (above, default on) --
  all Board Admin-editable, persisted settings. The purge-done-cards
  utility (above) is a related but separate Board-Admin action, not a
  persisted setting -- it takes its *N* fresh
  each time it's run rather than storing one. Other per-board config may
  land here later.

### Cards

- Title (required), description (optional, simple markdown).
- Belongs to exactly one column and (if the board has swimlanes) one
  swimlane at a time.
- Zero or more category chips.
- **Assignee**: at most one, chosen from the board's explicit members only
  (an App Admin who isn't an explicit member of this board doesn't appear
  in the picker, even though they can still act on the board). This is who
  due-date notifications (below) go to. If an assignee is removed from the
  board, or deactivated app-wide, their assigned cards fall back to
  unassigned rather than left dangling or blocking the removal -- it
  surfaces as something that now needs a new owner instead of silently
  notifying no one.
- **Subtasks**: a simple checklist within the card -- text + done/not-done,
  no further nesting. Add, edit the text, toggle done, and remove
  individually -- each its own action, not bundled into a single
  "edit the whole checklist" operation.
- **Priority**: a plain three-value enum -- Low / Medium / High, nothing
  more -- shown as a colored badge matching Kanboard's badge *styling*
  only. Explicitly **not** Kanboard's underlying numeric priority range
  (`priority_start`/`priority_end`, configurable per project, with Low/
  Medium/High computed as a ratio of where a raw number falls in that
  range) -- that configurability is real complexity with no stated need
  here. Whether the priority badge is shown at all is a **board-level
  setting** (see Boards below) -- a board where prioritizing doesn't add
  anything (a simple chore or hobby board) can turn it off entirely.
- **Recurrence**: optional, an interval in days. A card with a recurrence
  interval that's sitting in the Done column gets picked up once it's been
  there at least as long as the board's **recycle delay** (a Board Admin
  setting, in hours, default 24 -- see Board settings above) and recycled:
  its due date is recalculated as *completion time + interval* and it's
  moved into the board's Backlog column, positioned by a concrete rule
  rather than "roughly": **inserted immediately after the last Backlog
  card whose due date is on or before the recycled card's new due date**
  (undated Backlog cards sort after all dated ones for this purpose, so
  a recycled card never jumps ahead of them either). Same rule every
  time, nothing fuzzy left to interpret differently in the UI vs. the
  backend. This reuses the **same card** -- it isn't a fresh copy --
  so its activity log keeps accumulating across every cycle (a real,
  useful history: "changed Jun 2026, changed Sep 2026, changed Dec
  2026..." on one card) and its related-card links persist untouched.
  Subtasks reset to unchecked on each recycle (a fresh checklist per
  cycle). Each recycle increments a **cycle count** on the card (starts at
  0, so "cycle 4" in the activity log means it's been done four times) --
  simplest as a plain counter field rather than derived by counting log
  entries, since the log's exact shape shouldn't be something the UI has
  to parse to answer "how many times has this been done." The recycle
  delay also doubles as an undo window: a card dragged into Done by
  mistake and dragged back out within that window never gets touched.
  Turning recurrence off is just clearing the interval on the card; it's
  a per-card setting, not a per-board one. Recycles into whichever column
  is currently the board's Backlog column (see Columns above) -- since
  every board always has one assigned, recurrence never has a "no
  destination configured" state to handle.
- **Related cards**: an optional link between two cards, unlimited per
  card, many-to-many. A small fixed set of relation types (not Kanboard's
  larger taxonomy of blocks/blocked-by/duplicates/copied-from/etc.):
  - **Related** -- symmetric, no direction.
  - **Predecessor / Successor** -- directional; marking card A as a
    predecessor of card B automatically shows card B as A's successor (one
    relationship, two labeled ends, not two separate links to manage).
  A card can link to any other card on the same board. Deleting a card
  removes any related-card links pointing at it automatically -- the
  other end never shows a link to something that no longer exists.
- **Deleting a card is immediate and permanent** -- a confirm click (are
  you sure, no typed confirmation phrase), then it's gone, no trash/undo
  to recover it afterward. A smaller-stakes, more frequent action than
  deleting a whole board, so it doesn't get that same two-tier
  archive/delete treatment -- the confirm click alone is enough friction
  for something this size.
- Optional due date. When set, the notification system (below) watches it.
- **Comments**: a free-text discussion thread, separate from the activity
  log below -- brought back after initially being cut in favor of the
  log alone, which turned out to be the wrong call (real family
  discussion has nowhere else to live). Editable and deletable by their
  own author (normal comment behavior, not append-only, tracked via an
  `edited_at` timestamp that drives an "(edited)" indicator); a Board
  Admin can also delete any comment (light moderation), but not edit
  someone else's. Board Reader can read comments but not post/edit/delete
  any -- consistent with Reader having no mutation rights anywhere else
  on a card, unlike Kanboard's own drawer, which deliberately left
  commenting open even to locked/viewer roles. Posting/editing/deleting a
  comment is its own activity-log entry (who commented, when -- not the
  comment text itself, which lives in the comment). Same pagination
  treatment as the activity log below (15 most recent, oldest-first
  within that page so a thread still reads top-to-bottom, "Show more"
  loads older ones) -- a long-lived recurring chore's comment thread can
  grow for years same as its log can.
- Created/moved/edited by any Board User or Board Admin; Board Reader is
  view-only.
- Manual ordering within a column (drag-and-drop, matching today's
  React Card/Column behavior), not just a timestamp sort.
- **Activity log**: every create/move/edit/chip-change/due-date-change is
  recorded with actor + timestamp, append-only -- the log itself is never
  edited or deleted by anyone, including Board Admin. Granularity: **one
  entry per field per commit** (on blur, or on drawer close), not one per
  keystroke, and only if the value actually changed -- editing a
  description across forty keystrokes in one sitting produces one "edited
  description" entry, not forty. This log stays the immutable
  system-of-record for *what changed*; it's deliberately not where
  discussion happens -- that's Comments above, a separate feature (an
  earlier version of this doc conflated the two and cut comments
  entirely, which was a real miss, not just a simplification).
  Visible to Board Reader. **Completion/recycle entries (a recurring
  card's move into Done, and its later recycle to Backlog) are visually
  distinct from ordinary edit entries** -- a checkmark/icon and a "cycle N"
  label -- rather than one more plain line indistinguishable from a title
  edit or a chip change, so a recurring card's completion history is
  scannable at a glance. This is the main payoff of reusing the same card
  across cycles instead of spawning a fresh one (see Recurrence above).
  Since it's append-only and a heavily-recycled card can accumulate a
  long history over years, the drawer shows the **15 most recent entries
  by default**, most-recent-first, with a "Show more" control that loads
  15 more at a time.

### Due-date notifications

- A due date is a calendar date only, no time-of-day (matching Kanboard's
  own model) -- a card is either due on a date or it isn't, nothing more
  granular. The reminder job runs once a day, at a time that's a **Board
  Admin setting per board** rather than one fixed app-wide time (so a
  chore board and a work-hours board can check at different times without
  needing a per-card or per-user time field). It checks for cards that
  are due today or already overdue -- there is no advance "due soon"
  warning ahead of the due date itself, only Cadence below -- and, per
  run, groups every card crossing that threshold by (person, board) into
  **one digest email**, not one email per card --
  someone with three cards due on the same board the same morning gets
  one email listing all three, not three separate ones landing back to
  back (still one email per board if they have cards due on more than
  one). Each card in that batch still needs its own
  `notified_at`-style marker so it doesn't get re-included in tomorrow's
  digest. **Ordering matters here**: mark every card's `notified_at` in
  that digest only *after* the one email covering all of them actually
  succeeds -- if the send fails, none of them get marked, and all of
  them are simply included again in tomorrow's digest, not silently
  dropped. Marking first (so a crash between "mark" and "send" can't
  double-send) would instead risk dropping the reminder for that whole
  batch if the send fails, which is worse for a reminder system than an
  occasional duplicate email would be. Same principle for recurrence
  recycling: only commit a card's move to Backlog once its due-date
  recalculation and cycle-count increment are ready to save atomically,
  so a crash mid-run can't leave a card recycled with a stale due date.
- Delivery: email via SMTP -- reuse the same SMTP configuration pattern
  already working elsewhere on this household's infrastructure
  (`MAIL_SMTP_*` env vars), no new delivery mechanism to build. The email
  links straight to
  the card, but through the **normal app URL requiring a normal login**
  -- not a magic unauthenticated bypass link like the password-reset
  token. Reminder emails are informational, not an auth mechanism; no
  reason to give them their own security model.
- **Recipient**: the card's assignee. **An unassigned card with a due
  date sends no email at all** -- there's no one to send it to -- but
  still counts toward the board's overdue number on the Dashboard (see
  the Decision log's multi-board landing page entry), so an unassigned
  overdue card stays visible somewhere even though it never emails
  anyone. **No personal opt-out** -- every notification setting is
  board-level (Board Admin's call), not a per-user mute. If reminders
  feel too noisy, that's a board-level conversation (adjust the
  re-notify interval) rather than an individual toggle someone could
  silently leave on for tasks they're actually supposed to see.
- **Cadence**: one email on the due date itself. If the card is still not
  sitting in a do-not-notify-flagged column after that (see Columns
  above), a reminder repeats until it is, at an interval that's
  **configurable per board** (a Board Admin setting, e.g. "remind every N
  days"), defaulting to weekly.
- **`notified_at` is cleared to null whenever a card's due date changes** --
  whether the change is a manual edit or a recurrence recycle (see Cards
  above) setting a fresh *completion time + interval* date. Without this,
  a card that already had a due date once notified-on would look
  "already handled" under its new date and could silently skip its first
  reminder. Clearing it means the new due date is treated exactly like a
  brand-new one -- one email on/after the new due date, same as any other
  card.

## Architecture (decided)

- **Frontend**: React + TypeScript + Vite, continuing directly from the
  ported components in Reusable UI assets below. No real alternative
  worth considering given how much already exists and works.
- **Backend**: **Node.js + TypeScript** (e.g. Fastify or Express) with
  **SQLite** (e.g. `better-sqlite3`), so the whole stack is one
  language and types can be shared between frontend and backend --
  confirmed early in this doc's development, no longer an open question.
  (A PHP backend was the one real alternative considered -- PHP's
  built-in `password_hash()`/`password_verify()` and native sessions
  would have made auth just as easy to hand-roll there, and it would
  have matched this project's existing Docker/nginx hosting pattern most
  closely -- but Node/TypeScript won out for the one-language,
  shared-types benefit.)
- **Identity**: username and email are separate fields -- username for
  login/display, email for invites/password-reset/notifications. Both
  required, but **only username is unique** -- email is not. Multiple
  accounts can share one email address (a parent's inbox, most likely),
  which is the real answer for a family member without their own email
  (a young kid, say): their invite/reset links just land in the shared
  inbox. Simpler than plus-addressing workarounds or a second
  emailless-account code path to build and explain.
- **Deployment exposure: internet-facing**, same as the current Kanboard
  setup (reachable through the same reverse-proxy pattern, not LAN/VPN-
  only) -- login and password-reset are real targets for automated
  attempts, not just a theoretical concern, which is why the two items
  below aren't skipped.
- **Brute-force protection: per-account lockout.** 10 failed login
  attempts against a given username locks that account for 15 minutes,
  auto-unlocking after that (an App Admin can also reset the person's
  password to unlock it immediately, same action as any other password
  reset). Deliberately not IP-based -- a shared home internet connection
  means real family members can share an IP, and a per-account lock only
  ever affects someone who's actually gotten their own login wrong
  repeatedly. The failed-attempt counter **resets to zero on any
  successful login** -- without that, occasional mistyped passwords over
  time could eventually add up to a lockout even for someone who's
  mostly logging in fine. The login form shows a concrete message during
  a lockout ("This account is temporarily locked. Try again in N
  minutes.") rather than the generic invalid-credentials message used
  for an ordinary wrong password -- a small, deliberate tradeoff: it
  technically confirms the username is real (a nonexistent username can
  never lock), but a family app gains more from telling a locked-out
  person what's actually happening than it loses from that minor
  enumeration exposure. **A lockout also sends one email** to the
  account's address ("your account was locked after repeated failed
  login attempts") -- reusing the same SMTP path as everything else, and
  a deliberate, narrow exception to "only due-date reminders notify
  anyone" (see Non-goals above): lockout is specifically the one
  scenario where knowing "was that me, or someone else" has real value.
- **IP-based rate limiting, as a second layer alongside (not instead of)
  per-account lockout.** Per-account lockout alone leaves two gaps: an
  attacker can credential-stuff many *different* usernames from one IP
  without ever tripping any single account's 10-attempt threshold, and
  the password-reset-request endpoint can be hammered against one
  username to spam that person's inbox with reset links, since it isn't
  covered by login lockout at all. A simple **20 requests/minute per IP**
  limit on `/login` and `/reset-request` (see Key numbers) closes both
  without reintroducing the shared-home-IP problem lockout deliberately
  avoided -- it throttles bulk automated traffic rather than locking out
  an identity, so a houseful of people sharing one IP can still each log
  in normally even while the limit is in effect for someone hammering the
  endpoint.
- **Sessions invalidated on password change**, not just on deactivation.
  Whether the change comes from the user themselves (knows their current
  password) or from a completed reset-token flow, every other session for
  that account ends immediately, the same "checked on every request via
  the session lookup" mechanism already described for deactivation above
  -- a stolen 30-day session cookie shouldn't survive the legitimate
  owner changing their password.
- **Housekeeping for expired tokens and sessions.** Reset/invite tokens
  (expired or already used) and session rows past their sliding 30-day
  window otherwise just accumulate forever with nothing removing them.
  The same scheduled job that already handles due-date reminders and
  recurrence recycling also purges these on each run -- one more small
  responsibility on an already-shared scheduler, not a separate cleanup
  process to build.
- **Cross-board reference validation, server-side, always.** Every card
  mutation that references another entity by ID -- column, swimlane,
  category chip, assignee, a related card -- must be checked server-side
  as belonging to the *same board* as the card being edited, never
  trusted from the client just because a request supplied a plausible-
  looking ID. This isn't hypothetical: a real API endpoint reviewed
  earlier in this session accepted and wrote a task's `column_id`
  without checking it belonged to the task's own project, so a member
  of project A could move a task onto a column belonging to project B.
  Worth stating as an
  explicit implementation principle up front rather than letting a fresh
  backend reintroduce the same class of bug.
- **Ordering fields (`position` on Card, Column, Swimlane) use a
  fractional/lexicographic key, not a dense integer sequence.** Dragging
  one card between two others just needs a value between their two keys,
  not a rewrite of every row after it -- a plain integer sequence would
  need a full renumber on most reorders (or gaps pre-allocated and
  eventually exhausted). Purely an implementation choice with no visible
  product behavior either way, decided here so it's picked once on
  purpose rather than drifting into whichever's easiest to type first.
- **Auth**: password hashed with `argon2id` (the current recommended
  default over `bcrypt`, and this doc picks one concretely rather than
  leaving both on the table for a build agent to choose between),
  server-side session via a cookie flagged `httpOnly`, `Secure`, and
  `SameSite=Lax` -- `Secure` because the deployment is internet-facing
  (see above), `SameSite=Lax` rather than `Strict` so that clicking a
  due-date reminder link from an email (a top-level GET navigation into
  the app) still carries the session, while cross-site POSTs -- the actual
  CSRF risk -- stay blocked. Session length: **30 days, sliding** (refreshed
  on each request) as the concrete default for the "long-lived remember me"
  philosophy stated in Non-obvious issues below -- adjust if that ever
  feels wrong in practice, but ship with a real number rather than a
  library default. CSRF: a synchronizer token issued on login and returned
  in the login response body (not itself in a cookie, so it isn't
  automatically replayable by a third-party site the way a cookie would
  be) -- the frontend holds it in memory for the session and re-sends it
  as a header (`X-CSRF-Token`) on every non-GET request, checked against
  the session server-side; a hard page reload has no in-memory copy left
  and re-fetches one from an authenticated `/session`-style endpoint using
  the still-valid session cookie. Password reset and
  new-account creation both go through the same flow: a **cryptographically
  random token, at least 32 bytes** (not a short numeric code -- long
  enough that guessing it isn't a real attack surface even without rate
  limiting on the reset-confirm endpoint itself), **stored hashed** (the
  same principle as password storage -- a database read alone shouldn't
  hand over a usable token) and emailed as a link, expiring after 30
  minutes, that lets the recipient set a password once; no shared/typed
  temp password ever exists for either case. Self-service
  "forgot password" is requested **by username, not email** -- a direct
  consequence of email not being unique (above): looking a reset up by
  email alone would be ambiguous whenever two accounts share an inbox.
  Enter the username, the system emails whatever address is on file for
  that specific account. The confirmation message is the same either way
  ("if that account exists, a link was sent") rather than confirming or
  denying the username exists -- avoids turning the reset form into a way
  to enumerate valid usernames. Password requirement: a minimum length (8
  characters) and nothing else -- no forced complexity rules (a mix of
  cases/digits/symbols) nagging family members over a low-stakes personal
  app. New-account creation optionally includes picking a board + board
  role right in the same form -- covers "invite my kid to the chores
  board" in one trip, while leaving the board picker empty still works
  for "just create the account, add to boards later."
- **Bootstrapping the first App Admin**: every account-creation path
  above assumes an App Admin already exists to send the invite -- a
  brand-new install has none. Solved with a **first-run setup wizard**:
  the app detects zero users in the database and shows a one-time
  "create your admin account" form instead of a login page, rather than
  reading initial credentials from an env var.
- **Database**: SQLite is almost certainly sufficient at this scale (a
  handful of users, a handful of boards) and keeps hosting/backup trivial
  (one file to snapshot). **Not this doc's concern to schedule**: backing
  up one file is exactly what already happens at the docker-host level
  for the containers running there today, not something KanLite-specific
  to design -- same bind-mount-and-host-backup pattern, no new policy
  needed just because the app is new.
- **Deployment**: same docker host (`docker.meiserfamily.com`), same
  nginx-proxy-manager reverse-proxy pattern already in use, a bind-mounted
  data directory for the SQLite file (and backups), env vars for SMTP
  matching the existing convention. **Frontend and backend share one
  origin**: the Node backend serves the built Vite static assets itself
  (or nginx routes `/` and `/api` to the same host:port) rather than
  splitting them across subdomains -- simplest cookie/CSRF story (see
  Auth above), and matches the single reverse-proxy pattern already in
  use for this household's other self-hosted apps.
- **Scheduled job**: a small scheduled process (cron entry inside the
  container, or a simple `setInterval`/`node-cron` loop in the app) with
  three responsibilities, all sharing one scheduler -- see Quick
  reference above for the summary and Cards / Non-obvious issues below
  for the full reasoning behind each. One job, one run, not three
  separate schedulers to build and keep in sync.

## Migration from Kanboard

A later-phase concern, not part of the initial v1 build above -- run once
the new app exists and works, not before. A one-time export/import from
the real production Kanboard container, not a live sync (see the Decision
log below for the original resolution). Tracing it field-by-field
surfaced real gaps a "just map the obvious fields" pass wouldn't catch:

- **Keep the old Kanboard container and its data around, stopped but
  intact, for a real grace period after migration** (weeks, not days) --
  the export is read-only against it, so nothing about running the
  migration requires touching or removing the original. A real
  production incident earlier in this project (deploy, discover a real
  problem, roll back) is the concrete argument for not deleting the
  fallback the moment migration succeeds.
- **Time-tracking data is intentionally dropped, not migrated** -- it's
  a stated non-goal, and Kanboard's subtask time-tracking tables have no
  equivalent to map into.
- **Migrated cards get fresh IDs** in the new schema -- no reason to
  preserve Kanboard's numeric task IDs across a full platform change with
  a completely different URL scheme.
- **Kanboard's `tags` table maps directly to category chips** -- that's
  the real source, not the raw per-task `color_id` swatch (an earlier,
  less precise pass in this doc said "color_id -> category chips"; the
  actual migration source is the tags table, which is what a "name this
  color" flow reviewed earlier in this project already converts colors
  into).
- **A migrated card landing in its board's Done column needs its
  "entered Done" timestamp backfilled, not left null.** That field is
  what both the done-card visibility window and the purge utility (see
  Boards above) key off of -- a migrated Done card left with a null value
  would never become eligible for either, silently exempting every
  pre-existing completed card forever, which defeats the point of adding
  those two features in the first place. Kanboard's own `tasks.date_moved`
  column (updated whenever a task's `column_id` changes) is the direct
  source -- for any
  imported task whose current column maps to the new board's Done column,
  copy `date_moved` into the new card's "entered Done" field at import
  time. (Kanboard also has a full `transitions` table -- `task_id`,
  `src_column_id`, `dst_column_id`, `date` -- recording every historical
  column move, if a more precise "most recent transition specifically
  into this column" lookup is ever needed instead of trusting
  `date_moved` directly; not expected to matter in practice since
  `date_moved` already reflects exactly that for a task that hasn't
  moved since.) This only applies to cards landing in Done -- combined
  with resolved item 3 below (Backlog/Done require manual assignment
  before use), the backfill runs once a Board Admin has picked which
  imported column is Done, not at raw import time before that's known.

Resolved:

1. **Password hashes**: **fresh reset for everyone**, not carried over.
   Every migrated account goes through the normal invite/reset email flow
   regardless of Kanboard's existing (technically portable) bcrypt hash --
   consistent with "no shared/typed temp password ever exists," doesn't
   carry over old/weak/reused passwords, and the new app never has to
   import and trust a hash format from the old system.
2. **Kanboard's three app-level roles vs. KanLite's two**: **manager
   becomes App Admin**, not App User. Manager was already a step up from
   plain user in Kanboard; erring toward not losing capability anyone
   actually had, rather than the narrower default.
3. **Which imported column becomes Backlog and which becomes Done**:
   **require manual assignment before use**, not a name-matched guess.
   A migrated board imports with all its columns but stays flagged
   unusable until a Board Admin explicitly picks both -- never silently
   guesses wrong on an unusually-named board, at the cost of one
   required manual step per migrated board before anyone can use it.
4. **Comments have no home in the new data model**: comments are back
   in scope as a real feature (see Cards above), specifically because
   losing them on migration would have meant losing real family
   discussion history. Kanboard's `comments` table maps directly to the
   new Comments feature -- author, timestamp, and text carry straight
   across, no lossy workaround needed.
5. **Leftover un-migrated colors and classic Kanboard categories**: a
   task with a `color_id` that was never turned into a named tag, or a
   still-populated legacy `category_id` (categories were retired from the
   UI but not necessarily backfilled on every task) -- **auto-create a
   chip** named after the raw color/category and apply it to the card,
   rather than dropping the signal. Costs a handful of auto-generated
   chips a Board Admin may want to rename or merge after migration, but
   preserves information instead of silently losing it -- consistent
   with the migration section's general stance (fresh password resets
   aside) of not discarding anything that was meaningful in the old
   system.

## Reusable UI assets

An earlier React frontend was the starting point for this project's UI,
adapted to this backend's own API shapes rather than rewritten from a
blank file. What carried forward, and what changed:

- **Design tokens & look**: `styles/index.css` (color/type/radius tokens,
  light+dark theme) and `styles/board.css` (component styles) -- the
  overall system (CSS variables, type scale, radii, the three-tier
  light/dark token structure) is worth keeping, but **not its neutral
  palette verbatim** -- `index.css`'s light-mode surfaces/borders lean
  warm/beige (`--bg: #f1efea` etc.), which isn't wanted. Replace those
  specific neutrals with a true-neutral grey scale (the KanLite mockup's
  `:root` block has the corrected values); keep the accent/semantic/label
  hues, which weren't the problem. **The dark-mode values needed more
  than one fix -- see the "Dark-mode contrast is a standing discipline"
  bullet in Non-obvious issues below for the full policy** (three text
  tiers chosen by meaning, a mandatory `::placeholder` rule, declared
  `color-scheme`, and a dedicated `--danger` token separate from
  `--sem-critical`), not just a single corrected grey value -- an earlier
  version of this note described only the first-found `--text-faint`
  contrast bump (`#6e747b` -> `#8b93a0`) as if that were the whole fix,
  which real-world use of this same color system proved false across
  several more rounds. The mockup's current `:root` blocks already
  reflect the full policy; port that structure, not just its numbers, and
  keep porting the discipline (the tier rules, the placeholder/
  color-scheme requirements) into any new component this doesn't
  explicitly cover, not just the specific values already caught here.
  Theme selection should be a
  real, user-facing **System / Light / Dark** choice (not just inherited
  from the OS) -- see the mockup's Theme control for the intended UX; it
  needs storing somewhere per-user (a simple preference field, not a new
  subsystem). **One more correction on top of the one above**: dark mode
  turned out to need more than a token-tier fix -- the background
  brightness level itself was the real problem (near-black read as
  "gray on black" regardless of how good the internal ratios were), fixed
  by moving to a genuinely lighter charcoal floor, plus base font sizes
  raised throughout (a separate legibility axis from contrast). That in
  turn meant re-verifying every color against the new, brighter surface --
  `--accent` needed a further bump, and of the real app's full
  `CHIP_COLORS` set (16 label hues; the mockup's `:root` only ever
  modeled the original 6), four of the ten not covered by the mockup came
  in under a comfortable margin against the new surface via `tintStyle()`
  and were re-picked: `--lbl-dark_grey: #aaadbb` (was `#7d8190`, 4.18:1 ->
  5.21:1), `--lbl-brown: #d0a377` (was `#b98a5e`, 4.59:1 -> 5.16:1),
  `--lbl-deep_orange: #ff9670` (was `#ff7a45`, 4.85:1 -> 5.29:1), and
  `--lbl-pink: #fa93c8` (was `#f472b6`, 4.81:1 -> 5.33:1) -- all measured
  through the actual `tintStyle()` 18%/70% color-mix formula against
  `--surface`/`--text`, not the raw hue alone. The remaining six
  (`yellow`, `amber`, `teal`, `cyan`, `lime`, `light_green`) already
  cleared 5:1+ unchanged. This is the kind of check that has to be
  re-run any time the surface/text floor moves, not assumed to still
  hold from before.
- **`components/Board.tsx`, `Column.tsx`, `Card.tsx`** -- drag-and-drop,
  swimlane grouping, the `locked` prop pattern for read-only (Board Reader)
  enforcement. Directly applicable; trim any Kanboard-specific fields
  (assignee-by-id, priority, component) that fall outside the new scope
  above.
- **`components/TaskDrawer.tsx`** -- the always-editable card detail panel
  and its `locked` pattern. Final field set per Cards above: title,
  description (markdown, not plain text), column, swimlane, chips,
  assignee, priority, subtasks, due date, recurrence interval, related
  cards, comments, activity log. The existing comment box is directly
  reusable too, with one change: KanLite's Board Reader can't post
  (unlike Kanboard's own drawer, which left commenting open even to
  locked/viewer roles) -- everything else in the existing drawer maps
  onto something still in scope.
- **`components/Dropdown.tsx`, `Chip.tsx`, `LabelAdder.tsx`,
  `RailSection.tsx`** -- generic, low-coupling UI primitives. Portable
  close to as-is, but `Chip.tsx`'s rendering needs one change: a small
  colored dot next to neutral pill text (the original treatment) tested
  as genuinely hard to notice while scanning a board -- the mockup's
  fixed label hues now render as a **tinted-fill pill** instead (pill
  background and text both mixed from the label hue against the
  current theme's `--surface`/`--text`, e.g. `color-mix(in srgb,
  var(--lbl-blue) 18%, var(--surface))` for the background and 70% for
  the text), no separate dot needed. This is the same tinted treatment
  now used for every small colored pill in the mockup, not just category
  chips -- Assignee and Repeats in the card drawer, and the priority
  badge, all read as one consistent "colored pill" component rather than
  three different visual patterns. Mixing against `--surface`/`--text`
  (rather than a hardcoded light/dark pair per hue) means it adapts to
  light/dark automatically with no new per-mode tokens to maintain.
- **`components/AppShell.tsx`** -- the just-built collapsed-by-default
  hamburger overlay nav (see this repo's commit `d38d8ea`). Reuse the
  pattern: `useOpenNav()`/`NavTrigger` context, overlay + scrim.
- **`hooks/useMediaQuery.ts`, `utils.ts`** -- small portable utilities
  (`initialsFor`, mobile breakpoint hook).
- **API shape as a reference, not code**: the existing `BoardData`/`Task`
  TypeScript interfaces in `api/client.ts` and `types.ts` describe a JSON
  shape the ported components already expect. Keeping the new backend's API
  response shapes close to these (project/board id+name, columns array,
  swimlanes array, labels array, tasks array with columnId/swimlane/
  labelIds) minimizes rework in the ported components. Deliberately left
  at this level rather than a full endpoint-by-endpoint contract -- exact
  routes, HTTP methods, request/response bodies, status codes, and a
  validation-error format are implementation, not design, and belong in a
  short **API contract doc the Build agent produces as it implements**
  (so decisions get made once and written down, not re-decided ad hoc per
  endpoint), not in this doc.

Nothing from the PHP backend is reusable -- it's tightly coupled to
Kanboard's own model layer. The vendored `backend/` tree is not a starting
point for the new project.

**Accessibility**: baseline, not audited. Semantic HTML and accessible
component patterns by default (most of the carried-forward UI already
has this, being ordinary React components rather than hand-rolled
custom widgets) -- but no dedicated
keyboard-navigation/screen-reader audit or testing pass planned for v1.
Not actively ignored, just not a formal requirement to sign off on.

## UI mockups

**[KanLite UI Mockups](https://claude.ai/artifact/3rRykugB8mXQCgZvcHAUh1)** --
interactive, all six pages (login, dashboard, board, card detail, board
settings, user management) at three real preview widths (mobile 390px,
laptop 1366px, desktop 1920px), plus a board-role switch (Admin/User/Reader)
on the two pages where permissions change what's on screen. That link is
private to the account that published it -- **`design/kanlite-mockups.html`
in this repo is the same file, guaranteed accessible regardless of
account**; open it directly in a browser (it's fully self-contained, no
build step) rather than relying on the artifact link if a different
account/session picks this doc up.

**The two are not guaranteed to stay in sync on their own, and this has
already caused real confusion once**: this file went through six commits
of real changes (chip-tint pills, priority visibility, purge utility,
done-card visibility window, and a full dark-mode contrast overhaul)
across one session while the published artifact link sat untouched at
its original pre-session content -- the project owner spent that whole
session reviewing the stale link and reasonably concluded nothing had
changed. **Whoever edits `kanlite-mockups.html` is responsible for
republishing the artifact link in the same pass**, not just committing
the repo file -- treat a mockup edit as incomplete until both copies
agree, the same way a code change isn't done until it's actually
deployed somewhere someone can see it.

## Responsiveness

**There is exactly one real breakpoint: mobile (<=640px) vs. desktop.**
Everything from 641px up to 4K is the *same* desktop layout reflowing
fluidly, not a series of designs tuned to specific resolutions --
1366px and 1920px in the mockup above are two examples of that one layout
working, not two different designs. This is a direct lesson from an
earlier board that was originally built with columns fixed at
`flex: 0 0 208px`, tuned to fit "6 columns on a 1366px screen," and simply
never grew to use extra width at other sizes -- the fix was
`flex: 1 0 208px` with a max-width cap, i.e. fluid by default. KanLite
should default to fluid layouts from the start rather than needing that fix
applied after the fact:

- **Dashboard**: a CSS grid with `repeat(auto-fill, minmax(230px, 1fr))` --
  more board cards per row at 1920px, fewer at 1366px, one column on
  mobile, no explicit breakpoint needed at all for this page.
- **Board**: columns grow to fill available width, capped at a **300px
  max-width** (matching the mockup's CSS) so a 1-2 column board doesn't
  stretch to fill a whole wide monitor. Below 640px, columns become
  full-width swipeable panels (one at a time) with a swimlane tab switcher
  replacing the desktop banded-row layout -- this part **does** need the
  one real breakpoint, since touch-swipe-one-column-at-a-time is a
  genuinely different interaction, not just a narrower version of the same
  one.
- **Card detail**: a right-side drawer on desktop, full-screen on mobile
  (same breakpoint).
- **Login and board settings**: narrow, centered forms that don't need to
  "use" extra width at all -- not everything has to expand just because
  the viewport did.

## Non-obvious issues worth designing around up front

- **A Board Reader's card view has zero interactive elements.** The
  concrete acceptance criterion for making that feel intentional rather
  than broken: a visible **"View only" badge in the drawer header**,
  exactly as already built in the mockup -- that badge's presence (or
  absence) is what to check, not a subjective read on the whole panel
  (a real incident earlier in this project -- "the board view doesn't even
  work" -- was partly a symptom of exactly this kind of ambiguity going
  unresolved).
- **Predecessor/Successor is one relationship, not two rows.** Store it as
  a single record with a direction (`card_a_id`, `card_b_id`, `kind`), and
  derive "successor" as the inverse read of "predecessor" -- never let the
  two ends drift into separate rows that could disagree with each other.
- **The do-not-notify flag pauses the reminder check, nothing more.**
  Dragging a card into a do-not-notify column stops reminders immediately;
  dragging it back out just resumes the normal daily check with no
  special re-trigger -- if the card is overdue by then, the next
  scheduled run treats it exactly like any other overdue card. No
  "did this card just leave a do-not-notify column" logic needed; the
  flag only ever gates whether the periodic check acts on a card, it
  doesn't reset any state.
- **Recurrence recycling checks elapsed time on every run, rather than
  reacting to the drag-into-Done event.** Full mechanics are in Cards
  above; the payoff worth restating here is that this makes the recycle
  job idempotent for free -- a card dragged into Done and back out within
  the delay window is simply never touched, no double-processing guard
  needed anywhere.
- **Due-date reminders need a timezone to fire against.** For a
  family-scale app, one app-wide configured timezone (not per-user) is the
  lite answer -- per-user timezones are real complexity for a household
  that's probably all in the same one anyway. Concretely: a single env var
  (e.g. `APP_TIMEZONE`) read by the notification job, not a database-backed
  setting anyone edits through the UI -- it's a deployment-time fact about
  where the server/household is, not something that needs its own settings
  page.
- **Native HTML5 drag-and-drop does not fire on touch devices at all.**
  Solved by moving cards via the drawer's status dropdown on mobile
  instead of expecting touch drag.
- **Markdown needs sanitizing before render, every time.** A fresh
  implementation means no inherited Kanboard machinery already handling
  this -- pick a markdown renderer with built-in sanitization (or pair
  one with a sanitizer) from day one rather than bolting it on later.
  Scope of "simple markdown": CommonMark text formatting, links, and
  lists/headings -- no raw HTML passthrough (sanitized away regardless,
  but not even offered as a feature) and no embedded images (a link to an
  image is fine; an `<img>`-rendering embed is unnecessary complexity for
  a description/comment field and was never asked for). No task-list
  checkboxes either -- Subtasks already cover that need as a real,
  toggleable field rather than inert markdown syntax.
- **Picking a related card needs a different UI on mobile than desktop.**
  A small inline dropdown works at 1366px+; on a 390px screen searching
  across potentially dozens of cards needs a full-screen picker instead.
- **Design the empty states, don't let them happen by accident**: zero
  boards (brand new user, or a Board Reader/User not yet added to
  anything), an empty column, zero category chips on a board. Each should
  say something ("No boards yet -- ask an App Admin to add you to one")
  rather than just render blank. (A board with zero columns can't
  actually happen -- see the pre-seeding rule in Boards above.)
- **A long recycle delay can make a recycled card born already overdue --
  accepted as intentional, not a bug.** Due date is always *completion
  time + interval*, computed the same way regardless of how long the
  recycle delay took to actually move the card to Backlog. If the delay
  eats far enough into the interval that the card arrives already
  overdue, that's read as genuinely informative ("this really was due
  already") rather than something to mask by recomputing from recycle
  time instead. No special-case logic needed -- the straightforward
  calculation is also the intended behavior here.
- **A short done-card visibility window can hide a recurring card before
  it's even recycled -- also accepted, not a bug.** The visibility window
  and the recycle delay are independent settings measured off the same
  "entered Done" timestamp (see Boards above), so if a board's visibility
  window is set shorter than its recycle delay, a recurring card can drop
  out of view first and only reappear (now in Backlog, under its new due
  date) once the recycle job runs. Nothing breaks -- the card isn't lost,
  it's just not listed for that gap -- and a Board Admin who wants the two
  to stay in sync can simply set the visibility window to be at least as
  long as the recycle delay. Not worth cross-validating the two settings
  against each other for what's a self-correcting, low-stakes gap.
- **Two people editing the same card at once is last-write-wins, on
  purpose.** No real-time collaboration, no conflict detection/merge, no
  "someone else is editing this" indicator -- if two people both have a
  card's drawer open and edit the same field, whichever commits (blurs)
  last simply overwrites the other silently. Accepted as fine at family
  scale (rare, low-stakes) rather than something to build real
  collaborative-editing infrastructure to prevent.
- **No account-recovery path if the only App Admin loses access to their
  own email entirely.** Password reset relies on email; there's no second
  factor or security-question fallback. Accepted as a known limitation
  rather than something to build a recovery flow for -- matches how most
  self-hosted apps work, and the fallback (direct database access to
  reset a password hash, or re-running the first-run wizard against a
  wiped users table) is a manual admin/deploy-time operation, not a
  user-facing feature.
- **An expired invite/reset link has no separate "resend" action --** an
  App Admin (or the person themselves, for a reset) just requests a new
  one the same way as the first time, which invalidates the old token.
  No token history/list to manage, nothing to build beyond "generating a
  new one always works."
- **Session length (30 days, sliding -- see Architecture above) was a
  deliberate tradeoff, not an inherited library default.** A lite family
  app on home devices benefits from a long-lived "remember me" session
  rather than bank-grade short timeouts.
- **Dark-mode contrast is a standing discipline, not a one-time fix --
  spot-patching whichever single color got reported has repeatedly failed
  in real use.** The same "text is hard to read in dark mode" complaint
  survived four separate rounds of fixes against a live build of this
  app, each one real and individually verified, because each targeted a
  different actual cause while looking like a complete fix on inspection:
  bumping a token's contrast value (helped, but wasn't the reported
  text's actual color source), then discovering placeholder text was
  never touched by any theme variable at all (pure browser default,
  invisible to CSS-variable inspection), then discovering specific
  informational copy was correctly using a *token* but the *wrong* one
  (technically passing AA, still read as washed out), then finally
  discovering that a numerically-passing fix can still get reported as
  "not fixed" simply because a proxy metric isn't the same thing as
  looking obviously legible next to already-bright text on the same
  screen. Four concrete rules, all non-negotiable for any implementation,
  distilled from that sequence:
  1. **Three text tiers, chosen by meaning, not habit.** `--text` for
     primary content *and* any informational/instructional/confirmation
     copy the user is actually meant to read -- helper paragraphs,
     warnings, functional checkbox labels, delete/purge confirmation
     text. `--text-muted` for real-but-secondary content (field labels,
     metadata, timestamps) that isn't the main content but still needs to
     be read comfortably. `--text-faint` reserved narrowly for genuinely
     decorative or intentionally-inert chrome (a disabled-style control,
     placeholder-adjacent hints) -- never for the first two categories.
     Getting the *tier* right matters more than fine-tuning the exact
     grey value within a tier: the most persistent real-world complaint
     turned out to be informational text correctly using a design token,
     just the wrong one for what it actually was.
  2. **`::placeholder` needs its own explicit rule**
     (`color: var(--text-faint); opacity: 1;`, applied globally to every
     text input/textarea) wherever placeholder text exists at all.
     Without one, placeholder text silently falls back to the browser's
     own hardcoded, light-mode-assuming default grey -- completely
     independent of every other theme variable in the app. A fix that
     looks complete after inspecting the CSS variables can do nothing
     visible at all, because the placeholder was never reading them to
     begin with.
  3. **Declare `color-scheme: light` / `color-scheme: dark`** on the
     matching root blocks, scoped identically to every other theme
     override already in the file. Native browser-rendered chrome -- a
     `<select>`'s open dropdown list, a native date picker, scrollbars --
     ignores the page's own dark styling entirely without this, since
     none of it is controlled by CSS custom properties at all.
  4. **Destructive actions get their own dedicated `--danger`/
     `--danger-soft` token (true red), never reusing `--sem-critical`.**
     `--sem-critical` means overdue/warning -- a different semantic that
     happens to also render as a warm color. Conflating "this is overdue"
     and "this permanently deletes things" under one color reads as
     confusing regardless of how good that color's contrast ratio is.

  **Verification for any dark-mode contrast fix, standing method:** run
  an actual full-page sweep -- walk every rendered text node (and every
  `::placeholder`), compute each one's effective background by walking up
  the DOM for the first non-transparent `background-color`, compute the
  real WCAG contrast ratio, flag anything under 4.5:1 (3:1 for large/bold
  text) -- across every real page and every reachable state (locked-out
  login, Board Reader's locked controls, mobile breakpoint) in dark mode.
  Not just the one element named in the latest report, and not a visual
  eyeball pass on a screenshot. If a numerically-correct, independently
  verified fix still comes back as "still hard to read," stop
  incrementally tuning the grey value -- a proxy metric passing is not
  the same as looking obviously fixed to someone glancing at a real
  screen next to already-bright labels. Move straight to full `--text`
  brightness for that specific copy rather than iterating through another
  intermediate shade.

## Decision log

A record of how the open questions from this doc's early drafts actually
got resolved, kept for context on *why* -- not a list to act on. Every
answer here is already folded into the sections above; nothing in this
document is left unresolved.

1. **Card fields** -- assignee, subtasks, and priority are all in scope
   (see Cards above).
2. **Notification targeting** -- the card's assignee.
3. **Notification cadence** -- one email on the due date, then a
   per-board-configurable interval (default weekly) until resolved.
4. **Card "done" semantics** -- resolved through several rounds: started
   as a per-column "done" flag, split into three independent per-column
   flags (Done, Backlog, Do-not-notify) once recurrence and notification-
   suppression turned out to be separate concerns, then refined once more
   -- Done and Backlog are board-level "always assigned to some column"
   settings, not per-column on/off flags, while Do-not-notify stayed a
   true independent per-column flag. See Columns in Boards above for the
   final model.
5. **Backend language** -- Node/TypeScript + SQLite (see Architecture
   above).
6. **Project name** -- **KanLite** (a nod to Kanboard, and an explicit
   statement that it's intentionally the lite version).
7. **Data migration** -- yes, a one-time export/import, not a live sync
   -- see Migration from Kanboard above for the full field-by-field
   walkthrough (added later once traced in detail; the original
   resolution here undersold how many real decisions it hides).
8. **Multi-board landing page** -- modeled on Portainer's environment-
   picker dashboard: a grid of cards, one per board the user is a member
   of, each showing the board name, that user's role badge on it, and two
   rows of stats -- "All" (every card on the board) and "Mine" (the
   subset assigned to the viewing user). Overdue/due-soon counts are a
   literal count regardless of do-not-notify flags. "All" and "Mine" both
   exclude Done cards currently hidden by the board's done-card visibility
   window (see Boards above and Decision log entry 10 below) -- the same
   "excluded from every count, not just the card list" rule applies here
   too. Confirmed deliberate,
   not a silent regression: an earlier Dashboard design was a
   cross-board "everything assigned to you" list; this board-picker
   design replaces that rather than extending it, checked explicitly
   during a later review pass rather than left as an unnoticed side
   effect of the redesign.
9. **Review pass, closing the remaining implementation-level gaps** --
   a dedicated review (see `REVIEW.md` in this same directory for the
   full findings list) checked the doc for internal contradictions,
   under-specified schema/security details, and genuinely open questions
   a build agent would otherwise have to guess at. Most were clear-cut
   clarifications folded straight into the relevant sections above
   (`notified_at` reset semantics, Subtask as its own entity, session
   cookie flags and CSRF delivery mechanism, hashed-at-rest reset tokens,
   case-insensitive usernames, input length limits, fractional ordering
   keys, the markdown subset, sessions invalidated on password change).
   A handful were genuine open choices with no single implied answer, put
   to the project owner directly rather than decided unilaterally, all
   resolved in favor of the safer/more-explicit option: frontend and
   backend share one origin; archiving fully hides a board behind a
   dedicated "Archived boards" admin view rather than leaving it reachable
   by direct URL; board delete requires typed confirmation (unlike a
   card's plain confirm click), matching its full-cascade blast radius;
   a board crossing from <=1 to 2+ swimlanes buckets existing cards into
   the first swimlane automatically; and IP-based rate limiting was added
   on `/login` and `/reset-request` as a second layer alongside (not
   instead of) the existing per-account lockout.
10. **Done card visibility window** -- a new requirement added after the
    review pass above: a board-level setting, in days, `0` meaning
    forever (see Boards above for the full mechanics). Three sub-questions
    came with it, each resolved in favor of the least destructive, most
    "lite" option: aged-out cards are **hidden only** (data, comments, and
    activity log untouched, still reachable by direct link or a
    related-card reference) rather than deleted; hidden cards are
    **excluded from every count** (Done column header, dashboard All/Mine
    stats), not just the card list, so numbers never look stale against
    what's actually shown; and there's **no "show hidden/older completed
    cards" toggle** in v1 -- a Board Admin who wants them back just raises
    or zeroes the setting, consistent with this doc's standing preference
    for fewer moving parts over more UI at this app's scale.
11. **Purge done cards utility** -- a further new requirement: a
    board-level way to permanently delete Done cards older than *N* days
    (see Boards above for the full mechanics). Three more sub-questions,
    again resolved toward the option keeping an irreversible action under
    direct human control and away from silent data loss: it's a **manual,
    on-demand action**, not a stored setting the scheduled job also
    enforces automatically -- deletion doesn't get to happen unattended;
    **recurring cards are always excluded** from what it targets, since
    purging one would destroy both its accumulated cycle history and any
    future recycling, unlike an ordinary finished card; and it requires a
    **preview count before a plain confirm click** -- more visibility
    than deleting one card gets, since a single click here can remove
    many cards at once, but not the full typed-confirmation tier reserved
    for deleting an entire board. Placed in board settings' **Danger
    zone**, alongside archive/delete-board, rather than grouped with the
    persisted Done-card settings above it -- it's a destructive one-off
    action, not a saved rule, and sitting among the other one-off
    destructive actions makes that reading unambiguous without needing
    extra caption text to explain it. Two follow-on gaps this surfaced,
    both fixed: (1) a **migrated card** needs its "entered Done" timestamp
    backfilled from Kanboard's `tasks.date_moved` at import time (see
    Migration below) -- left null, it would silently exempt every
    pre-existing completed card from both this utility and the visibility
    window above, forever; and (2) the mockup's **dark-theme
    `--text-faint` token** was low-contrast enough (~3.8:1) to be
    genuinely hard to read at the small sizes it's used at, caught while
    reviewing the new Danger-zone copy in dark mode -- corrected to
    `#8b93a0` (~5.3:1+) in Reusable UI assets below, not specific to this
    feature but found alongside it.
12. **Chip color visibility** -- the category chip's original treatment (a
    small 7px dot next to neutral pill text) tested as genuinely hard to
    notice while scanning a board. Three visual concepts were mocked up
    directly in `kanlite-mockups.html` for comparison (soft tint fill,
    bigger dot with colored text, and a colored accent bar); **soft tint
    fill won** -- the whole pill's background and text are now mixed from
    the label hue against the current theme's surface/text colors (e.g.
    `color-mix(in srgb, var(--lbl-blue) 18%, var(--surface))`), which
    adapts to light/dark automatically with no new per-mode tokens.
    Applied everywhere a small colored pill appears, not just category
    chips -- Assignee and Repeats in the card drawer picked up the same
    treatment for visual consistency, since they're the same component.
    See Reusable UI assets below.
13. **Priority visibility** -- a new board-level setting (see Boards
    above), default on. Followed the same "hide, don't destroy" pattern
    already established for the done-card visibility window without
    needing to ask further open questions: turning it off hides the
    priority badge and its editing control everywhere on the board, but
    never touches stored values or past activity-log entries, and
    turning it back on restores the display exactly as it was.
14. **Dark-mode contrast, overhauled rather than spot-fixed** -- direct
    instruction after this same complaint survived four separate rounds
    of real-world fixes against a live build of this app (see the
    "standing discipline" bullet in Non-obvious issues above for the full
    account and the four rules it produced). Rather than patch the one
    color already known to be an issue, ran an actual full-page contrast
    sweep (every text node, every `::placeholder`, across all six pages,
    every login sub-state, the Board Reader locked-control state, and
    mobile width) against the mockup's dark theme, found and fixed every
    violation in one pass: retiered roughly a dozen informational-copy
    instances off `--text-faint` onto `--text-muted`/`--text` (several
    were the exact same category of bug already diagnosed in the real
    app -- a token, just the wrong tier), added the missing
    `::placeholder` rule and `color-scheme` declarations, split a new
    `--danger` token off `--sem-critical` for destructive actions, and
    raised dark-mode `--text-faint` itself to a more generous floor.
    Verified by re-running the sweep after (zero violations everywhere
    checked) and visually confirming several pages, not by trusting the
    numeric pass alone.
15. **Dark mode, round two: "essentially nothing has changed."** The
    overhaul above still read as unchanged, because it re-tuned ratios
    within the same near-black background band rather than changing the
    background's actual brightness -- passing contrast math isn't the
    same as looking obviously different to someone glancing at the
    screen. Fixed by moving `--bg` to a genuinely lighter charcoal floor
    (average brightness roughly doubled) and re-verifying every other
    token against it, plus a separate, previously unstated fix: base
    font sizes raised throughout (small text is its own legibility
    problem, independent of contrast). See the "Dark mode needs decisive
    brightness and type change" memory for the full account. Once Build
    applied this to the real app and re-ran the sweep against the parts
    of the color system the mockup never modeled (ten extra `lbl-*`
    tags beyond the original six), four came back under a comfortable
    margin against the new, brighter surface -- see the Reusable UI
    assets correction above for the four replaced values. The lesson
    generalizes: any time the surface/text brightness floor moves,
    everything painted against it needs re-checking, not just the parts
    that were the subject of the original complaint.
