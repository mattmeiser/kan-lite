# Deploying KanLite

KanLite ships as a single Docker image: nginx serves the built React app and
proxies `/api` to a co-located backend process, both supervised by s6 inside
the same container (the same pattern this household's other self-hosted
apps use). One image, one port (80), one volume (`/data`) for the SQLite
database and migration reports.

There are two ways to bring up an instance:

- **Fresh install** — a brand-new, empty KanLite with no boards or users. The
  app detects the empty database on first boot and shows a "create your
  admin account" setup wizard instead of a login page.
- **Import from Kanboard** — migrates an existing Kanboard installation's
  boards, tasks, users, comments, subtasks, and tags into a new KanLite
  instance in one pass. Read-only against the Kanboard source; nothing about
  running the migration touches or modifies the original Kanboard data.

Both use the same image and the same `docker-compose.yml`; the import is one
extra command run after the container is up.

Deployment here follows the same layout and conventions as every other app
in this host's `~/docker/` tree (see `~/docker/stirling-pdf`, `~/docker/kanboard`,
etc.): one directory per app, `docker-compose.yml` at its root, relative
bind mounts for data, `restart: unless-stopped`, and routing through the
shared `nginx_default` network rather than publishing ports directly —
nginx-proxy-manager owns TLS and the public hostname, the same way it does
for every other service on this host.

## 1. Directory layout

```
~/docker/kanlite/
├── docker-compose.yml
├── .env                  # not committed — real secrets live only here
└── data/                 # bind-mounted to /data: the SQLite db + migration reports
```

Create it:

```bash
mkdir -p ~/docker/kanlite/data
cd ~/docker/kanlite
```

## 2. docker-compose.yml

```yaml
services:
  kanlite:
    build:
      context: /path/to/kan-lite   # wherever this repo is checked out
      dockerfile: docker/production/Dockerfile
    container_name: kanlite
    restart: unless-stopped
    env_file: .env
    environment:
      - APP_URL=https://kanlite.example.com
      - CORS_ORIGIN=https://kanlite.example.com
    volumes:
      - ./data:/data
    networks:
      - nginx_default

networks:
  nginx_default:
    external: true
```

`.env` (same convention as this host's other apps — real secrets kept out of
the compose file itself):

```
APP_TIMEZONE=America/New_York
MAIL_SMTP_HOST=smtp.example.com
MAIL_SMTP_PORT=587
MAIL_SMTP_USER=you@example.com
MAIL_SMTP_PASS=your-smtp-password
MAIL_SMTP_SECURE=false
MAIL_FROM=KanLite <you@example.com>
```

Build and start it:

```bash
docker compose build
docker compose up -d
```

No `ports:` entry — like every other app on this host, KanLite is only
reachable via the shared `nginx_default` network. Add a Proxy Host in
nginx-proxy-manager pointing your chosen hostname at `kanlite:80`
(container name, internal port — the same pattern as `pdf.meiserfamily.com`
→ `stirling-pdf:8080` or `kanboard.meiserfamily.com` → `kanboard:80`), with
NPM issuing the real cert.

Open the app at the hostname you configured. Since the database is empty,
you'll land on a **"Create your admin account"** form instead of a login
page — that's the first-run setup wizard, not a bug. Fill it in once; every
account after that is created via invite (App Admin → Users → invite, or
self-service "Forgot password").

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `APP_URL` | yes | `http://localhost:5173` | Public URL of this instance (the hostname you gave it in nginx-proxy-manager). Used to build invite/reset links in emails — get this right or those links will point at the wrong place. |
| `CORS_ORIGIN` | yes | `http://localhost:5173` | Should match `APP_URL`. Same-origin in this single-container setup (nginx serves both the app and `/api`), so this mostly matters if you ever split the API onto a different origin. |
| `APP_TIMEZONE` | yes | `UTC` | An IANA timezone name (e.g. `America/Chicago`). Due-date notifications and the daily digest fire against this timezone, not the container's own clock — get it right, since there's no per-user override. |
| `PORT` | no | `4000` | Internal port the backend listens on. Only relevant if you're customizing the nginx config; leave it alone otherwise. |
| `DATA_DIR` | no | `/data` | Where the SQLite database and migration reports live. Matches the image's `VOLUME /data` — don't change this without also changing the `./data:/data` bind mount. |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS` / `MAIL_SMTP_SECURE` | yes, for email | none | SMTP relay for invite links, password resets, and due-date digests — same values as this host's other apps' `MAIL_SMTP_*` settings, just under KanLite's own variable names (they don't match Kanboard's `MAIL_SMTP_HOSTNAME`/`USERNAME`/`PASSWORD`/`ENCRYPTION` naming — same values, different names, so don't copy Kanboard's `.env` verbatim). If `MAIL_SMTP_HOST` is unset, the app logs a warning and silently skips sending — invites/resets/digests won't reach anyone, but nothing crashes. |
| `MAIL_FROM` | no | `KanLite <no-reply@kanlite.local>` | The `From` address on outgoing mail. |
| `NODE_ENV` | no | `production` (baked into the image) | Controls whether the session cookie is marked `Secure`. **Leave this as `production`** — nginx-proxy-manager terminates real HTTPS in front of this, same as every other app here, so the cookie needs `Secure` set. Only override this if you're doing a throwaway HTTP-only test with no reverse proxy in front, where a `Secure` cookie sent over plain HTTP would otherwise get silently dropped by the browser and break login. |

### Volumes

- `./data:/data` — the SQLite database (`kanlite.sqlite`) plus any migration
  report JSON files. Back this up the same way you'd back up any other
  single-file SQLite app on this host: stop the container (or accept a
  brief inconsistent-snapshot risk) and copy the directory.

## 3. Import from an existing Kanboard instance

Run this **after** `docker compose up -d` (fresh, empty database) and
**before** anyone creates an account through the setup wizard — the
migration creates its own App Admin account(s) from Kanboard's user list,
and a wizard-created account plus a migrated one with the same username
would collide.

### Step 1: get a snapshot of the Kanboard database

Don't point the migration at Kanboard's live database file directly — copy
it first. The migration itself only ever opens its source read-only and
never writes to it, but SQLite (even in read-only mode) needs to create
WAL/shm sidecar files next to the database, which requires a writable
directory — so the source needs to live somewhere writable, and it's
cleaner for that to be a disposable copy rather than Kanboard's real data
directory:

```bash
mkdir -p ~/docker/kanlite/import
cp ~/docker/kanboard/data/db.sqlite ~/docker/kanlite/import/db.sqlite
```

### Step 2: mount the snapshot in

Add the import directory to `docker-compose.yml`'s `volumes:` list:

```yaml
    volumes:
      - ./data:/data
      - ./import:/import
```

Then apply it:

```bash
docker compose up -d
```

(You can remove the `./import` mount again once the migration below has run
— it's not needed for normal operation.)

### Step 3: run the migration

```bash
docker compose exec kanlite \
  sh -c "cd backend && npx tsx src/migration/cli.ts --source /import/db.sqlite --app-url https://kanlite.example.com"
```

This prints a report to the console (also written as JSON to `./data`):

- Every migrated board with its card/column count.
- Every migrated user with a **fresh invite link** — Kanboard passwords are
  never carried over, by design (a clean break from any old/weak/reused
  password, and KanLite never has to trust an imported hash format). Send
  each user their link, or have them use "Forgot password" with their
  username once they know it.
- Any warnings (e.g. a Kanboard user with no email on file gets a
  placeholder address you'll want to fix before inviting them).

### What does and doesn't carry over

- Boards, columns, swimlanes, tasks (as cards), subtasks, comments, and
  tags (as color-coded chips) all migrate.
- **Time tracking does not migrate** — it's an explicit non-goal, and
  Kanboard's subtask time-tracking has no equivalent in KanLite.
- **Task IDs are not preserved** — migrated cards get fresh IDs; there's no
  reason to preserve Kanboard's numeric IDs across a full platform change
  with a different URL scheme.
- **Every migrated board needs its Backlog and Done columns assigned**
  manually, in that board's Settings, before due-date recycling or
  notifications activate for it. This is intentional — the migration
  doesn't guess based on column names.
- **Passwords are never migrated** — see above.

### Keep the old Kanboard instance around

The migration is read-only and one-time, not a live sync. Keep the original
Kanboard container and its data around, stopped but intact, for a real
grace period after cutting over — if something about the migration turns
out to be wrong, you can re-run it from scratch (`docker compose down -v`,
delete `./data`'s contents, start over) without having lost anything, since
the source was never touched.

## Verifying a deployment

Whichever path you used, check:

- `docker compose exec kanlite curl -f http://localhost/api/health` returns
  `{"ok":true}` (this is also what the image's own `HEALTHCHECK` polls, so
  `docker compose ps` should also show it as `healthy`).
- The app loads at your configured hostname and either shows the setup
  wizard (fresh install, zero users) or a login page (post-import).
- You can log in (fresh: the account you just created; import: after
  setting a password via an invite link) and see your boards.
- If you configured SMTP, trigger a password-reset email and confirm it
  arrives — a misconfigured `MAIL_SMTP_*` value fails silently (a console
  warning, not a crash), so this is worth checking explicitly rather than
  assuming it works.
