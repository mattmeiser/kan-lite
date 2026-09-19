# Review of NEW-PROJECT-DESIGN.md

Reviewed by the Design agent across two review passes plus one new-feature
pass, 2026-09-17. Read the doc in its own stated order (Non-goals, Quick
reference, Scope, Architecture, Migration, UI mockups, Responsiveness,
Non-obvious issues, Decision log), then cross-checked its UI claims
against `kanlite-mockups.html` directly (the neutral grey palette, the
"View only" badge, the theme control, the dashboard's All/Mine stat
groups, the swimlane tabs, the fixed label-color swatches on the
category-chips settings row, and the board settings fields all matched
what the doc describes).

**Status: closed.** Every gap found across the two review passes is now
either folded into `NEW-PROJECT-DESIGN.md` or was a genuine open design
choice put to the project owner and resolved. The subsequent new
requirements (done-card visibility window, purge-done-cards utility, chip
color visibility, priority visibility, and a full dark-mode contrast
overhaul) are also fully specified. Nothing identified across any of this
remains outstanding. See the doc's own Decision log entries 9-14 for
one-paragraph pointers back to this file.

## Pass 1 — clear-cut clarifications, applied directly

These had only one reasonable reading given decisions already made
elsewhere in the doc, so they were edited straight in rather than flagged:

1. **`notified_at` reset on due-date change.** The doc specifies marking
   `notified_at` after a successful digest send, and separately specifies
   that recurrence recycling recalculates a card's due date — but never
   connected the two. Without clearing `notified_at` when the due date
   changes, a recycled card could silently skip its first reminder under
   its new date. Added a clause to Due-date notifications.
2. **Subtask promoted to its own Entity bullet**, with a `position` field.
   It was described only in prose under Cards ("ordered list of text +
   done/not-done") without ever appearing in the Entities schema list the
   way Comment and Activity log entry do, and "ordered" needs an explicit
   ordering column like the other ordered entities (Column, Swimlane) get.
3. **`created_at`/`updated_at` called out as implicit on every entity.**
   The Card bullet referenced "last-modified-at" in passing (to explain
   that "entered Done" is tracked separately from it) without that field
   ever being listed. Added one blanket sentence at the top of Entities
   instead of repeating it per entity.
4. **"Entered Done" timestamp lifecycle spelled out**: set on entering the
   board's current Done column, cleared on leaving it (drag or recycle),
   tracked for every card regardless of recurrence. This was implied by
   the recycle-delay/undo-window description but never stated as the
   field's actual set/clear rule.
5. **Category chip color is a fixed token, not a hex picker.** The doc's
   Reusable UI assets section says to keep "the accent/semantic/label
   hues," and the mockup's settings page shows chips picking from a fixed
   `--lbl-*` swatch set — but the Category chips bullet itself just said
   "colored," which read as a free color picker. Clarified.
6. **Password hashing: picked `argon2id`** instead of leaving
   `argon2`/`bcrypt` as an open either/or. Low-stakes but should be one
   answer, not two, in a doc whose whole point is resolving open questions.
7. **Session cookie flags made explicit**: `httpOnly`, `Secure`,
   `SameSite=Lax`. The doc already establishes internet-facing exposure
   and a CSRF token, but never stated the cookie attributes those facts
   imply. `Lax` specifically (not `Strict`) so a due-date reminder email's
   link still carries the session on click-through.
8. **CSRF token delivery mechanism specified**: returned in the login
   response body, held in memory client-side (not in a readable cookie or
   `localStorage`), re-fetched via an authenticated endpoint after a hard
   reload. The doc said a synchronizer token is "required as a header" but
   never said how the SPA obtains or persists it across reloads — a real
   implementation gap for a "described here in full" section.
9. **Reset/invite tokens stored hashed at rest**, not in plaintext — the
   same principle the doc already applies to passwords, just not stated
   for these tokens.
10. **Username uniqueness/login lookup made case-insensitive**, storing
    the as-typed casing for display. Otherwise "Matt" and "matt" could
    register as two different accounts, which nothing in the doc rules out
    or intends.

## Pass 1 — open design choices, resolved by the project owner

Genuinely open (no single implied answer), so these were asked rather than
decided unilaterally. All four resolved in favor of the recommended,
more-explicit option:

11. **Frontend and backend share one origin** — the Node backend serves
    the built frontend (or nginx routes both paths to one host:port).
    Needed as a precondition for the `SameSite=Lax` cookie reasoning
    (#7) to hold.
12. **Archived-board access**: archiving fully hides a board from
    non-admins (no direct-URL access either); App Admins reach it via a
    dedicated "Archived boards" view to unarchive. Previously the doc
    said archiving "hides it from the dashboard" with no stated path back.
13. **Board delete requires typed confirmation** (the board's name),
    unlike the plain confirm-click specified for card delete — matching
    its much larger, irreversible blast radius (full cascade vs. one
    card).
14. **Swimlane-count transition**: cards with a null swimlane, on a board
    that crosses from <=1 to 2+ swimlanes, land in the first
    (lowest-position) swimlane automatically rather than needing manual
    reassignment.

## Pass 2 — remaining gaps, now closed

A second sweep over what pass 1 had deliberately left as findings rather
than edits. One was a genuine tradeoff (asked); the rest were build-time
judgment calls with no real product impact, so they were decided directly
and folded into the doc:

15. **IP-based rate limiting** — asked directly, since per-account lockout
    alone leaves two real gaps (credential-stuffing many *different*
    usernames from one IP without tripping any single account's
    threshold, and hammering `/reset-request` to spam one person's inbox).
    Resolved in favor of adding it: **20 requests/minute per IP** on
    `/login` and `/reset-request`, as a second layer alongside — not
    instead of — the existing per-account lockout, so the shared-home-IP
    reasoning that ruled out IP-based *lockout* still holds.
16. **Input length/character-set limits** — added a table of concrete
    defaults to Key numbers (username, board/column/swimlane/chip names,
    card title, subtask text, description/comment) with a note that the
    specific values are ordinary validation bounds, not decisions with
    real tradeoffs, and can move freely if implementation turns up better
    numbers.
17. **Ordering/position storage mechanism** — specified as a
    fractional/lexicographic key (not a dense integer sequence) for Card,
    Column, and Swimlane `position` fields, added to Architecture. Pure
    implementation choice with no visible product behavior either way;
    decided once so it isn't left to drift.
18. **Markdown subset** — specified in Non-obvious issues: CommonMark
    text formatting, links, lists/headings; no raw HTML passthrough, no
    embedded images, no task-list checkboxes (Subtasks already cover that
    need as a real toggleable field).
19. **Sessions on password change** — specified in Auth: changing a
    password (self-service or via a completed reset) invalidates every
    other session for that account immediately, the same mechanism
    already described for deactivation.
20. **API contract left intentionally at "reference only"** — confirmed
    this is deliberate, not an oversight, and added one sentence in
    Reusable UI assets directing the Build agent to produce a short API
    contract doc (routes, methods, request/response bodies, status codes,
    validation-error format) as it implements, rather than deciding those
    ad hoc per endpoint or expecting this doc to specify them.

## New requirement — Done card visibility window

Added after both review passes above closed: "a Done card should only be
visible for a certain period of time, as configured at the board level;
`0` means forever." Specified in full and folded into
`NEW-PROJECT-DESIGN.md` (Boards, Entities, Key numbers, Scheduled job,
Non-obvious issues, Decision log entry 10) and into the mockup's board
settings page (new "Done cards" section). Three sub-questions had no
single implied answer, so they were put to the project owner rather than
decided unilaterally; all three resolved toward the least destructive,
lowest-machinery option:

21. **What happens to an aged-out card**: hidden from the Done column's
    card list only — its row, comments, and activity log stay fully
    intact, still reachable by direct URL or via a related-card link.
    Not deletion, and not a new archive concept; a pure display filter,
    consistent with the doc's standing refusal to silently destroy data.
22. **Whether hidden cards still count**: no — excluded from the Done
    column's header count and the dashboard's All/Mine stats too, so a
    displayed number never mismatches what's actually listed.
23. **Whether to add a way to browse hidden cards**: no dedicated
    "show older completed cards" toggle in v1 — a Board Admin raises or
    zeroes the window to bring them back, consistent with the doc's
    existing rejection of extra machinery at this scale (no cross-board
    search, no bulk operations).

Mechanically: reuses the already-tracked "entered Done" timestamp as the
clock (no new per-card field needed), is a live read-time filter rather
than a batch job (explicitly called out as *not* a fourth scheduled-job
responsibility), and is independent of the recycle delay — a board can
set its visibility window shorter than its recycle delay, which can hide
a recurring card briefly before it's recycled; documented as an accepted,
self-correcting edge case rather than something to cross-validate.

## New requirement — Purge done cards utility

Added immediately after the visibility window above: "a board level
utility to purge Done cards older than N days." This one is genuinely
destructive (permanent deletion), unlike the visibility window's pure
hiding, so it got its own three sub-questions before being folded in:

24. **Trigger**: manual, on-demand only — a Board Admin enters *N* and
    runs it whenever they choose. Not a stored per-board setting, and not
    something the scheduled job enforces automatically; an irreversible
    bulk-delete stays under direct human control each time, never running
    unattended on a schedule.
25. **Recurring cards**: always excluded from what the purge can target.
    A recurring card reuses the same row specifically to keep
    accumulating cycle history and to recycle again later — purging one
    destroys both, unlike an ordinary finished card that has nothing more
    to do after Done.
26. **Confirmation friction**: a preview count ("this will permanently
    delete 14 cards") before a plain confirm click — more visibility than
    a single card's delete gets, since one click here can remove many
    cards, but short of the full typed-confirmation tier reserved for
    deleting an entire board.

Two things this surfaced along the way, both fixed directly (no open
question — each had one reasonable answer given decisions already made):

- **Migrated cards need their "entered Done" timestamp backfilled.** Once
  both the visibility window and this purge utility exist, a null value
  on that field (the default for a freshly-imported card) would silently
  exempt every pre-existing completed card from both features forever.
  Checked Kanboard's actual schema rather
  than assuming — confirmed `tasks.date_moved` exists and is updated on
  every column change, so it's the direct migration source. Added to
  Migration from Kanboard.
- **The purge control's placement in the mockup was ambiguous** — sitting
  right under the visibility window's persisted setting, it could read as
  "set up automatic purging" rather than "run once, now." Moved it into
  the settings page's existing **Danger zone** section (with
  archive/delete-board), which are all one-off destructive actions rather
  than saved rules — the grouping itself disambiguates it, on top of the
  explicit "days — runs once, now" label already added to the control.

## Dark-theme contrast fix (found in passing, not part of either new feature)

While reviewing the new Danger-zone copy in dark mode, `--text-faint`
(`#6e747b`) turned out to be genuinely hard to read against the dark
surfaces — roughly 3.8:1 contrast, under the 4.5:1 WCAG AA threshold for
normal text, and it's frequently used at 10-11.5px where that shortfall
is most visible. Corrected to `#8b93a0` (~5.3:1 against `--surface`,
~4.5:1 against the lightest dark surface `--surface-3`) in both of the
mockup's dark-mode CSS blocks. This also corrected a stale claim in
NEW-PROJECT-DESIGN.md's Reusable UI assets section, which had said the
dark-mode token values "weren't the problem" when the light-mode palette
was fixed earlier — true at the time, no longer true, now updated to
describe this specific fix instead.

## Chip color visibility

Raised directly: "the chip color is a little hard to see." The original
category-chip treatment was a neutral pill with a small 7px colored dot —
easy to miss while scanning a board. Mocked up three real concepts
directly in `kanlite-mockups.html` (a temporary "Chip concepts" comparison
page, since removed) rather than describing them in the abstract:

- **Concept A — soft tint fill**: the whole pill's background and text
  mixed from the label hue against the current surface/text colors.
- **Concept B — bigger dot, colored text**: smallest change from today,
  reusing the `--lbl-*` hues exactly as they're already designed (as
  foreground/text colors, not fills).
- **Concept C — accent bar**: a colored flag on the pill's edge instead
  of a dot.

**Concept A chosen**, applied everywhere a small colored pill appears —
not just category chips, but the Assignee and Repeats pills in the card
drawer too, since they're the same visual component and leaving them on
the old dot treatment would have produced two inconsistent "chip" looks
in the same interface. Implemented with `color-mix(in srgb, var(--lbl-X)
18%, var(--surface))` for background and 70% for text, which adapts to
light/dark automatically with no new per-mode tokens — verified in the
browser in both themes before rolling it out. NEW-PROJECT-DESIGN.md's
Reusable UI assets section and Decision log entry 12 now describe this.

## Priority visibility

Requested directly: make the priority badge's visibility configurable
per board. This followed the done-card visibility window's precedent
closely enough that no further questions were needed — decided directly
rather than asking:

- **Display-only toggle**, default on (today's behavior unchanged until a
  Board Admin opts out). Off hides the priority badge *and* its editing
  control everywhere on the board; stored priority values on cards are
  never cleared, so turning it back on restores everything exactly as it
  was.
- **Past activity-log entries** recording a priority change stay visible
  regardless of the current setting — the log is never scrubbed for a
  display toggle, same principle as the done-card visibility window.
- **No finer-grained version** (e.g. allowing only some of Low/Medium/
  High) — a plain on/off matches Priority's existing simplicity elsewhere
  in this doc (no numeric range, no per-board custom scale).

Added to NEW-PROJECT-DESIGN.md (Cards, Boards, Entities, Decision log
entry 13) and to the mockup's board settings page (a checkbox under
General).

## Dark-mode contrast overhaul

Direct instruction: "Usability in Dark Mode needs a major overhaul. Spot
fixes are unacceptable." This lands right after checking memory of the
real app's own history with this exact complaint — four separate rounds
of fixes against a live build, each real and individually verified, none
of them actually resolving the report:

1. Bumped a text-color token's contrast value.
2. Discovered the true cause was a completely unstyled `::placeholder` —
   invisible to any theme-variable inspection, since placeholder text was
   never reading the token at all.
3. Discovered a *third* cause: specific informational copy was using a
   real design token, just the wrong tier (`--text-faint` for text the
   user actually needed to read).
4. Discovered a numerically-correct, independently-verified fix can still
   get reported as "not fixed," because a WCAG ratio passing is a proxy
   for legibility, not legibility itself.

Given that history, patching the one color visible in this session's own
earlier spot-fix (the `--text-faint` bump two turns ago) would almost
certainly have repeated the same failure. Instead:

- Audited the mockup directly for the same three failure classes already
  known from the real app: confirmed no `::placeholder` rule existed
  despite real `placeholder` attributes in use (login fields, comment
  box); confirmed no `color-scheme` declaration existed anywhere, despite
  real native `<select>` elements whose open dropdown ignores page theming
  without it; confirmed `--sem-critical` was doing double duty for both
  overdue/warning semantics and the Danger Zone's destructive actions,
  the same conflation the real app fixed by splitting out a dedicated
  `--danger` token; found roughly a dozen instances of informational or
  functional copy (settings helper text, "Do not notify" labels, login
  secondary-action links, the purge confirmation text) sitting on
  `--text-faint` when it should be `--text-muted` or `--text` — several
  were literally the same sentences already diagnosed as this exact bug
  class in the real app (e.g. "Always assigned to some column...").
- Fixed all of it in one pass: global `::placeholder` rule,
  `color-scheme: light`/`dark` declarations, a new `--danger`/
  `--danger-soft` token pair (true red) repointed from `.btn-danger` and
  the Danger Zone's border/heading, every mistiered text instance moved
  to the correct tier, and dark-mode `--text-faint` itself raised to a
  more generous floor (`#8b93a0` → `#96a0aa`) for the genuinely-decorative
  uses that remain on it.
- **Verified by measurement, not inspection**: wrote an actual contrast
  sweep (walks every rendered text node and every `::placeholder`,
  computes effective background by walking up the DOM, computes real
  WCAG ratios) and ran it via the browser against all six pages, every
  login sub-state (signin/reset/sent/firstrun/locked), the Board Reader
  locked-control state, and mobile width — zero violations everywhere.
  Then visually confirmed several pages directly (Board Settings' Danger
  Zone, the "Account locked" screen) rather than trusting the sweep
  alone, per the lesson that a passing metric and "looks obviously fixed"
  aren't guaranteed to coincide.
- **Wrote the underlying policy into the design doc itself**, not just
  the specific fixes — a new "Dark-mode contrast is a standing
  discipline" bullet in Non-obvious issues (four rules: tier text by
  meaning not habit, mandatory `::placeholder`, mandatory `color-scheme`,
  dedicated `--danger` token) plus a mandated sweep-based verification
  method, so this is a standing requirement for whoever builds or extends
  this rather than something that has to be rediscovered a fifth time.
  Decision log entry 14 has the short version.

## Nitpicks

- The doc has only one Entities list (under Quick reference, not a
  separate one in Scope) — an earlier note in this file implied there
  were two that could diverge; there aren't. Subtask, `notified_at`, and
  the audit-timestamp note added in pass 1 are all in that single list.
- The Non-obvious issues entry on empty states ("a board with zero
  columns can't actually happen") remains true after both passes' edits —
  the pre-seeding rule wasn't touched.

## What I did not touch

No application code was written or modified — this was a documentation
review only, per the Design agent's scope. The Build agent should treat
this file alongside `NEW-PROJECT-DESIGN.md` as its spec; `NEW-PROJECT-
DESIGN.md`'s own claim that "nothing in this document is left unresolved"
now holds at the implementation-detail level too, not just the product
level.
