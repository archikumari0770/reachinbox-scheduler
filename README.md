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

`@bull-board/express` is mounted at `GET /admin/queues` (protected by the same session auth as
the rest of the API), showing live job states — waiting, delayed, active, completed, failed —
for the `email-send` queue.

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

### 2. Backend
```bash
cd backend
cp .env.example .env          # fill in GOOGLE_CLIENT_ID/SECRET, SLACK_CLIENT_ID/SECRET, etc.
npm install
npm run migrate               # creates tables
npm run dev                   # http://localhost:4000
```

### 3. Frontend
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

## Trade-offs & what I'd do next with more time

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
