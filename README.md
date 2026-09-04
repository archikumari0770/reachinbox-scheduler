# ReachInbox Mini — Email Scheduler + Dashboard

A production-shaped slice of an email-scheduling system: schedule emails via API, persist
them in Postgres, hand them to **BullMQ delayed jobs** (backed by Redis) for exact-time
delivery, send via **Ethereal SMTP**, enforce per-sender hourly rate limits with Redis
counters, notify **Slack** the moment a limit is hit, index sent/scheduled mail into
**Elasticsearch** for search, and expose a live **Bull-Board** queue dashboard — all wrapped
in a Next.js dashboard with real Google OAuth login.

> This is a take-home-grade reference implementation: the code is real and wired end-to-end,
> but running it live requires you to supply your own Google OAuth credentials, a Slack app,
> and infra (Redis/Postgres/Elasticsearch — provided via `docker-compose.yml`). Nothing is
> mocked in the logic; the *credentials* are the only thing you must bring.

---

## 1. Architecture

```
                       ┌─────────────┐
   Browser (Next.js)   │   Frontend  │
   Google OAuth login ─┤  Dashboard  │
                       └──────┬──────┘
                              │ REST (JWT cookie)
                              ▼
                     ┌────────────────┐        ┌───────────────┐
                     │  Express API   │──────▶ │   Postgres     │  (source of truth)
                     │  (backend)     │        │  email_jobs,   │
                     └───────┬────────┘        │  senders, etc  │
                              │  enqueue(delay)  └───────────────┘
                              ▼
                     ┌────────────────┐
                     │  BullMQ Queue  │  (Redis-backed, persists across restarts)
                     └───────┬────────┘
                              │  worker (configurable concurrency)
                              ▼
                     ┌────────────────┐     hourly limit hit     ┌────────────┐
                     │  Email Worker  │ ───────────────────────▶ │   Slack    │
                     │  - rate check  │                          │  webhook   │
                     │  - send (SMTP) │                          └────────────┘
                     │  - index (ES)  │
                     └───────┬────────┘
                              ▼
                     ┌────────────────┐        ┌───────────────┐
                     │ Ethereal SMTP  │        │ Elasticsearch │ (search index)
                     └────────────────┘        └───────────────┘
```

**Why Postgres *and* Redis?** Redis/BullMQ is the *scheduler* (accurate delayed execution,
retries, concurrency, rate limiting). Postgres is the *source of truth* (what should exist,
what its status is). BullMQ jobs are transient execution vehicles; Postgres rows are durable
records. On every worker run we re-check the Postgres row before sending — this is what makes
sends idempotent even if a job were ever processed twice.

## 2. No cron, ever

Scheduling is 100% BullMQ delayed jobs: `queue.add(name, data, { delay: ms, jobId })`.
There is no `node-cron`, no OS crontab, no polling loop. Redis's own timer wheel (managed by
BullMQ) wakes the job at the right time. The one background routine in this project
(`reconcile.ts`) is **not** a scheduler — it runs once at boot to re-attach any Postgres rows
that are `scheduled` but (for some reason, e.g. Redis was wiped) missing from the queue. It's
a self-healing safety net, not the mechanism that fires sends.

## 3. Persistence across restarts (no lost / no duplicate sends)

- **Redis persistence**: `docker-compose.yml` runs Redis with AOF enabled
  (`--appendonly yes`), so delayed jobs survive a Redis restart, not just an app restart.
- **Idempotent job IDs**: every BullMQ job is created with `jobId = email_jobs.id` (a UUID).
  BullMQ refuses to create a second job with the same ID, so a duplicate "schedule" call (or a
  reconciler re-run) can never enqueue the same email twice.
- **DB-checked send**: the worker's very first step is
  `UPDATE email_jobs SET status='processing' WHERE id=$1 AND status='scheduled' RETURNING *`.
  If zero rows come back (already sent/processing by another worker, or cancelled), the worker
  no-ops and acks the job. This is the idempotency guard that survives even a worst-case
  double-delivery from Redis.
- **On boot** (`reconcile.ts`): query Postgres for `status='scheduled'` rows, and for each one
  call `queue.add(..., { jobId })`. Because job IDs are deterministic, jobs already in Redis are
  silently skipped (BullMQ dedupes by jobId), and only genuinely missing jobs get re-attached —
  at their **original** `scheduled_at`, not "now", so nothing fires early.

## 4. Concurrency, throttling, and hourly rate limits

- **Worker concurrency**: `new Worker(queueName, handler, { concurrency: env.WORKER_CONCURRENCY })`.
  Default `5`, fully configurable via `.env`.
- **Minimum delay between sends**: enforced with BullMQ's built-in limiter:
  `{ limiter: { max: 1, duration: MIN_DELAY_BETWEEN_SENDS_MS } }` on the Worker, giving a hard
  floor of **2000 ms between any two sends per worker process** by default. This throttles at
  the queue level, not with `setTimeout` in the handler, so it doesn't block the event loop or
  hold a worker slot open.
- **Hourly cap, per sender** (`MAX_EMAILS_PER_HOUR_PER_SENDER`, default `200`): implemented
  with a **Redis atomic counter**, not an in-memory variable, so it is correct across multiple
  worker processes/instances:
  ```
  key = ratelimit:{senderId}:{YYYY-MM-DDTHH}     (hour-bucketed key)
  count = INCR key
  if count == 1: EXPIRE key 3600
  if count > limit: DECR key; reschedule job into next hour bucket
  ```
  `INCR`/`EXPIRE` are atomic Redis ops, so two workers racing on the same sender can't both
  believe they're under the limit. This lives in `queue/rateLimiter.ts`.
- **Reschedule, never drop**: when a sender is over its hourly cap, the worker does **not**
  fail the job. It computes the start of the *next* hour window, and re-adds a fresh BullMQ job
  with `delay = nextWindowStart - now` (same `jobId`, so no duplication), then acks the current
  attempt. The Postgres row's `scheduled_at` is updated to reflect the new time so the
  dashboard shows accurate state. Because jobs are re-added in the order they were rejected,
  relative order among rate-limited emails for the same sender is preserved.
- **1000+ emails at the same instant**: they all land in the queue as delayed jobs with (near)
  identical `delay`. BullMQ fires them as fast as Redis can pop them, but the worker's limiter
  throttles actual SMTP sends to one per `MIN_DELAY_BETWEEN_SENDS_MS`, and the per-sender Redis
  counter pushes anything beyond the hourly cap into the next hour(s) automatically — so a
  large burst self-flattens into a safe, gradually-draining backlog instead of hammering SMTP
  or violating the cap.

## 5. Slack notification on rate-limit hit

- Dashboard has a **"Connect Slack"** button → `GET /api/slack/authorize` redirects to Slack's
  real OAuth v2 `authorize` URL (`chat:write`, `incoming-webhook` scopes).
- `GET /api/slack/callback` exchanges the `code` for a token via `oauth.v2.access`, and stores
  the returned `incoming_webhook.url` (plus team info) in the `slack_integrations` table, keyed
  by the logged-in user's tenant id.
- The moment `rateLimiter.ts` detects a sender crossing its hourly cap, it calls
  `slackNotifier.notifyRateLimitHit(tenantId, ...)`, which looks up that tenant's webhook URL
  and does a live `POST` to it with the sender, the limit, and how many emails were pushed to
  the next window.
- **Graceful when not connected**: `notifyRateLimitHit` first checks whether a row exists in
  `slack_integrations` for the tenant. If not, it returns immediately — no throw, no crash, no
  retry storm. As soon as the user completes the OAuth flow, the very next rate-limit hit finds
  the row and starts posting — no redeploy needed, since the lookup happens per-event, not at
  boot.

## 6. Search (Elasticsearch)

Every status transition (`scheduled → sent` / `scheduled → failed`) triggers
`elasticsearch.indexEmail(job)`, upserting a document into the `emails` index (`_id = job.id`,
so re-indexing is idempotent too). `GET /api/emails/search?q=...` runs a `multi_match` query
across `subject`, `body`, and `recipient_email`. If Elasticsearch is unreachable, indexing
failures are logged and swallowed — search degrading doesn't take down email sending.

## 7. Live BullMQ dashboard

`@bull-board/express` is mounted at `GET /admin/queues` (protected by the same bearer-token auth
as the rest of the API), showing live job states — waiting, delayed, active, completed, failed —
for the `email-send` queue.

Since this is a direct browser navigation rather than an API call made through the frontend's
axios client, it can't attach an `Authorization` header the normal way. `requireAuth` falls back
to accepting the token as a `?token=` query parameter for exactly this case. To view it: open
your browser's DevTools console on the logged-in dashboard and run
`localStorage.getItem('reachinbox_token')`, copy the value, and visit
`https://your-backend-url/admin/queues?token=<paste>`.

---

## Running it

### Prerequisites
- Docker (for Redis, Postgres, Elasticsearch)
- Node 18+
- A Google OAuth Client ID/Secret (console.cloud.google.com → OAuth consent + Web credentials,
  redirect URI `http://localhost:4000/api/auth/google/callback`)
- A Slack App (api.slack.com/apps) with `incoming-webhook` + `chat:write` OAuth scopes,
  redirect URI `http://localhost:4000/api/slack/callback`
- An Ethereal account is auto-created at boot via `nodemailer.createTestAccount()` if you don't
  supply one in `.env` — see `services/mailer.ts`.

### 1. Infra
```bash
docker compose up -d          # redis (AOF), postgres, elasticsearch
```

### 2. Set up Ethereal Email (fake SMTP)
No account creation needed up front. On first boot, if `ETHEREAL_SMTP_USER`/`ETHEREAL_SMTP_PASS`
are left blank in `.env`, the backend calls `nodemailer.createTestAccount()` and prints a fresh
disposable inbox's credentials straight to the console, e.g.:
```
[ethereal] Created a fresh test SMTP account:
  user: abcxyz123@ethereal.email
  pass: somegeneratedpassword
```
Copy those two values into `backend/.env` as `ETHEREAL_SMTP_USER` / `ETHEREAL_SMTP_PASS` so the
same inbox persists across restarts (otherwise a new throwaway account is minted every boot).
Every sent email also gets a `preview_url` (visible as a "preview" link in the Sent tab) that
opens the actual rendered email in Ethereal's web viewer — this is how you confirm a send
really happened, since Ethereal never delivers to a real inbox.

### 3. Backend
```bash
cd backend
cp .env.example .env          # fill in GOOGLE_CLIENT_ID/SECRET, SLACK_CLIENT_ID/SECRET, etc.
npm install
npm run migrate               # creates tables
npm run dev                   # http://localhost:4000
```
This single command starts the Express API **and** the BullMQ worker together (see
`src/index.ts` — `startEmailWorker()` runs in the same process as the HTTP server). There is no
separate worker process to launch.

### 4. Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Open `http://localhost:3000`, sign in with Google, connect Slack (optional), compose an email
(paste/upload a CSV of recipients), and watch it move from **Scheduled** → **Sent** on the
dashboard. Visit `http://localhost:4000/admin/queues` for the live BullMQ view.

---

## Features implemented

### Backend
| Requirement | Implementation |
|---|---|
| Scheduler (no cron) | BullMQ delayed jobs, `queue/emailQueue.ts` — `queue.add(name, data, { delay, jobId })` |
| Persistence across restarts | Redis AOF persistence + boot-time reconciler (`queue/reconcile.ts`) that re-attaches any Postgres row still `status='scheduled'` to the queue at its original time |
| Idempotency / no duplicate sends | Deterministic `jobId = email_jobs.id` (BullMQ dedupes by ID) + a DB-level claim (`UPDATE ... WHERE status='scheduled'`) before any send is attempted |
| Worker concurrency | Configurable via `WORKER_CONCURRENCY` (`queue/worker.ts`, `Worker(..., { concurrency })`) |
| Min delay between sends | BullMQ limiter (`{ limiter: { max: 1, duration: MIN_DELAY_BETWEEN_SENDS_MS } }`) |
| Hourly rate limit, per sender | Redis atomic `INCR`/`EXPIRE` counter, safe across multiple worker processes (`queue/rateLimiter.ts`) |
| Rate-limited jobs rescheduled, not dropped | `job.moveToDelayed()` + `DelayedError` — the job re-delays itself to the next hour window under the same identity |
| Slack notification on rate-limit hit | Real Slack OAuth v2 flow + live `POST` to the stored incoming webhook (`services/slackNotifier.ts`), silently no-ops if not connected |
| Search (Elasticsearch) | Idempotent upsert on every status change + `multi_match` search endpoint (`services/elasticsearch.ts`) |
| Live queue dashboard | `@bull-board/express` mounted at `/admin/queues` |
| Google OAuth login | Manual OAuth2 code exchange against Google's token/userinfo endpoints (`routes/auth.ts`); session handed to the frontend as a bearer token, not a cookie — see "Hosting notes" below for why |
| Multi-sender data model | `senders` table supports several senders per tenant (UI currently wires up one default sender — see trade-offs) |

### Frontend
| Requirement | Implementation |
|---|---|
| Google login | `pages/index.tsx` → redirects to backend `/api/auth/google`; backend hands session back as a bearer token via `pages/auth/callback.tsx`, stored in `localStorage` and attached as `Authorization: Bearer <token>` on every API call (`lib/api.ts`) |
| Dashboard header (name, email, avatar, logout) | `components/Header.tsx` |
| Scheduled / Sent tabs | `pages/dashboard.tsx`, backed by `GET /api/emails/scheduled` and `/sent`, polled every 8s |
| Compose modal (subject, body, CSV upload, recipient count preview, start time, delay, hourly limit) | `components/ComposeModal.tsx` |
| Loading states | Skeleton rows (`components/StatusUi.tsx` → `TableSkeleton`) |
| Empty states | `EmptyState` component, shown when a tab has zero rows |
| Error handling | Inline error banners in the compose modal on failed submissions |
| Slack connect/disconnect UI | Badge + button in `Header.tsx`, wired to backend OAuth routes |



## Key environment variables (backend `.env`)

| Var | Meaning | Default |
|---|---|---|
| `WORKER_CONCURRENCY` | parallel jobs per worker process | `5` |
| `MIN_DELAY_BETWEEN_SENDS_MS` | floor between any two sends | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | hourly cap, per sender email | `200` |
| `DATABASE_URL` | Postgres connection string | — |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | ES endpoint | `http://localhost:9200` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | — |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OAuth | — |
| `SESSION_SECRET` / `JWT_SECRET` | auth signing | — |
| `FRONTEND_URL` | for OAuth redirects & CORS | `http://localhost:3000` |

## Hosting notes (deployed on Railway + Vercel)

Beyond local Docker Compose, this was also deployed live — frontend on Vercel, backend +
Postgres + Redis on Railway. Two real, non-obvious issues came up that are worth documenting
honestly, since they're exactly the kind of thing that only surfaces once code leaves
`localhost`:

**1. Cross-domain session cookies get silently dropped by Chrome's Bounce Tracking Protection.**
With frontend and backend on two separate subdomains (e.g. `*.vercel.app` and `*.up.railway.app`
— both are on the public suffix list, so browsers treat them as fully different sites, not
subdomains of one site), the natural approach is an `httpOnly` cookie with
`SameSite=None; Secure`. That correctly gets *set* by the server — but modern Chrome (especially
Incognito) applies Bounce Tracking Protection, which refuses to *persist* cookies from a domain
that only ever appears as a redirect intermediary in a navigation chain
(`frontend → backend → Google → backend → frontend`). The backend never gets treated as a
genuine first-party site, so its cookie is silently discarded regardless of correct
`SameSite`/`Secure` attributes — no error, no console warning, it just never shows up in
`document.cookie` or DevTools' Application → Cookies panel.

The fix: session is handed off explicitly as a **bearer token** instead. After Google OAuth
completes, the backend redirects to `${FRONTEND_URL}/auth/callback?token=<jwt>` rather than
setting a cookie. The frontend's `/auth/callback` page reads the token from the URL, stores it
in `localStorage`, and an axios interceptor (`lib/api.ts`) attaches it as
`Authorization: Bearer <token>` on every subsequent request. This sidesteps cross-site cookie
restrictions entirely, since it's an explicit, visible handoff rather than implicit browser
cookie state that anti-tracking heuristics can quietly interfere with. (Locally, where frontend
and backend just run on different `localhost` ports, cross-site cookies would actually have
worked fine — this only bites once the two halves are on genuinely different registrable
domains.)

**2. Railway's free tier blocks outbound SMTP entirely.** Ports 25, 465, and 587 are blocked by
default on Railway's Free/Trial/Hobby plans specifically to prevent spam abuse — this is
documented, deliberate platform policy, not a bug. Every send attempt from the live Railway
deployment fails with `Connection timeout`, even though credentials, DNS, and the code path are
all correct (confirmed by the exact same code sending successfully in local Docker dev, where
nothing blocks the connection).

**Decision made here:** rather than switch away from Ethereal (which the assignment explicitly
calls for) or move hosting providers again, the live deployment intentionally accepts that email
*sending* only works in local/Docker dev — everything else (Google login, the dashboard,
scheduling, Slack OAuth and live rate-limit alerts, search) works identically on the live URLs.
Scheduled emails on the live deployment will sit in "Scheduled" and then flip to "Failed" with a
`Connection timeout` error once the worker attempts the send — that failure is expected and
understood, not a defect. The demo video's actual send-and-verify segment is recorded against
the local Docker setup, where this restriction doesn't apply.

If continuing this into a real deployment, the two documented fixes are: move the backend to a
host that doesn't block outbound SMTP on its free tier (e.g. Render), or switch to a
transactional email provider with an HTTPS API (e.g. Resend, Mailgun) instead of raw SMTP —
either sidesteps the port block, at the cost of moving off Ethereal specifically.



- Multi-sender load balancing (round-robin across a pool of Ethereal senders per tenant) is
  modeled in the `senders` table but the compose UI only exposes a single default sender per
  tenant — picking a sender per-recipient would be the next step.
- Rate-limit "next window" placement is greedy (always *next* hour); a fairer scheduler would
  spread a large backlog across N future windows up front instead of cascading one hour at a
  time under load.
- No dead-letter queue UI beyond what Bull-Board already shows; a dedicated "Failed" tab with
  manual-retry would be the next frontend addition.
- CSV parsing happens twice today (client-side for the "N recipients detected" preview, and
  server-side again on submit for validation) — could be unified with a signed upload + a
  single server-side parse.

## A real bug found and fixed during manual testing

Worth documenting honestly: an early version of the rate-limit rescheduling logic tried to
reschedule a rejected job by removing it and re-adding it under the same `jobId` from *within
its own handler*. BullMQ won't let an active job mutate/remove itself that way — the removal
silently no-ops, the handler then returns without error, and BullMQ marks the job "Completed"
even though the email was never actually sent and nothing new was left in the queue to retry
it. The email would then sit in Postgres as `status='scheduled'` forever, since the job that
was supposed to wake it up again didn't actually get created.

This was caught through manual testing (scheduling a batch with a very low hourly limit and
watching some rows never leave "Scheduled"), root-caused via Bull-Board (jobs showed
"Completed" in the queue while the database still said "scheduled" — the mismatch was the
tell), and fixed by switching to BullMQ's intended pattern for this exact case:
`job.moveToDelayed(timestamp, token)` followed by throwing `DelayedError`, which lets an active
job safely re-delay *itself* under its own identity instead of trying to be removed and re-added
externally. See `queue/worker.ts` for the corrected implementation and the comment explaining
why the original approach didn't work.

