# KanLite

A lightweight Kanban board for household task tracking — a from-scratch
backend paired with a React UI, built as a simpler, purpose-built
replacement for Kanboard.

- **Boards, columns, swimlanes, cards** — the core Kanban model, with
  subtasks, comments, due dates, priorities, and color-coded tags on cards.
- **Two roles**: App Admin (manages users and every board) and App User
  (works the boards they're a member of, at Reader/User/Admin per board).
- **Recurring cards**: a card can recycle itself back to Backlog with a new
  due date after sitting in Done past a configurable delay.
- **Due-date notifications**: a daily per-board digest email for
  due/overdue cards assigned to you.
- **One-time Kanboard migration**: import an existing Kanboard instance's
  boards, tasks, users, comments, subtasks, and tags in a single pass —
  read-only against the source, never modifies it.

## Stack

- **Backend**: [Fastify](https://fastify.dev/) + TypeScript, running on
  [`node:sqlite`](https://nodejs.org/api/sqlite.html) (no separate database
  server — one file).
- **Frontend**: React + TypeScript, built with [Vite](https://vitejs.dev/).
- **Shared**: a small `@kanlite/shared` workspace for types used by both.

It's an npm workspaces monorepo:

```
backend/    Fastify API server
frontend/   React app
shared/     types shared by both
docker/     production Docker image (single container, nginx + backend)
docs/       design doc and deployment guide
```

## Local development

Requires Node 22.5+ (for the built-in `node:sqlite` module).

```bash
npm install
npm run dev:backend    # Fastify on :4000
npm run dev:frontend   # Vite dev server on :5173, proxies /api to :4000
```

Open `http://localhost:5173`. Since the database starts empty, you'll land
on a first-run "create your admin account" wizard rather than a login page.

```bash
npm test         # backend + frontend test suites
npm run typecheck
```

## Deployment

See **[docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md)** for
the full guide — building the production image, a fresh install via
`docker compose`, and importing an existing Kanboard instance's data.

## Design

[docs/design/NEW-PROJECT-DESIGN.md](docs/design/NEW-PROJECT-DESIGN.md) has
the full design rationale: entities, roles and permissions, the
notification/recurrence scheduler, and the decisions made migrating off
Kanboard.

## License

[MIT](LICENSE) © Matt Meiser
