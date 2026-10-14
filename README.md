# Outbox Email Scheduler

A production-style email job scheduler with a dashboard. You upload a list of leads, write one email, pick a start time, a delay between emails and an hourly limit. The backend persists everything in PostgreSQL and schedules one BullMQ delayed job per email (no cron). It enforces per-sender spacing and three hourly limits atomically in Redis, then sends through Ethereal SMTP. It survives restarts, Redis data loss and crashed workers without losing or duplicating an email.

| Layer | Stack |
| --- | --- |
| Backend | TypeScript, Express, BullMQ + Redis, PostgreSQL (Drizzle ORM), Nodemailer + Ethereal, Elasticsearch, Bull Board |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| Auth / integrations | Google OAuth 2.0 (real, no mock), Slack OAuth v2 + incoming webhook |
| Infra | Docker Compose for Postgres, Redis (AOF on) and Elasticsearch |

```
outbox-email-scheduler/
├── docker-compose.yml        Postgres, Redis (AOF), Elasticsearch
├── samples/leads.csv         sample lead list for the demo
├── backend/
│   ├── drizzle/              SQL migrations
│   └── src/
│       ├── config/env.ts     every tunable, validated with zod
│       ├── db/               schema, client, migrate
│       ├── queue/            BullMQ queue, worker, startup reconciler
│       ├── services/         scheduler, rate limiter (Lua), mailer, search, slack
│       ├── routes/           auth, campaigns, emails, senders, slack
│       ├── scripts/          create senders, reindex, load test
│       ├── server.ts         API (+ worker in-process by default)
│       └── worker.ts         standalone worker entrypoint
└── frontend/
    └── src/
        ├── app/              login, dashboard/{scheduled,sent,compose,emails/[id]}
        ├── components/       ui/ (Button, Field, Modal…), emails/, compose/, layout/, slack/
        ├── hooks/            usePolledQuery (live refresh)
        └── lib/              typed API client, types, CSV parsing, formatting
```

---

## 1. Running it locally

### Prerequisites
Node.js 20+, Docker, and a Google Cloud OAuth client (5 minutes, see below). Slack is optional until you want limit alerts.

### Infrastructure
```bash
docker compose up -d          # postgres :5432, redis :6379, elasticsearch :9200
```

### Backend (Express API + BullMQ worker)
```bash
cd backend
cp .env.example .env          # fill in GOOGLE_* (and SLACK_* later), set JWT_SECRET
npm install
npm run db:migrate            # create tables
npm run senders:create        # create 3 Ethereal sender accounts (see §2)
npm run dev                   # API on http://localhost:4000, worker runs in the same process
```

The worker runs inside the API process by default (`RUN_WORKER_IN_API=true`), so one command is enough. To run workers separately, as in production, set `RUN_WORKER_IN_API=false` and start any number of them:

```bash
npm run dev:worker            # in another terminal, as many times as you like
```

Useful URLs:
- `http://localhost:4000/admin/queues`: live Bull Board dashboard (optionally protected with `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`)
- `http://localhost:4000/health`: DB and Redis status

### Frontend
```bash
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                   # http://localhost:3000
```

### Production build
```bash
cd backend && npm run build && npm run db:migrate:prod && npm start      # + npm run start:worker
cd frontend && npm run build && npm start
```

---

## 2. Ethereal Email and environment variables

[Ethereal](https://ethereal.email) is a fake SMTP service: it accepts mail like a real server but never delivers it, and gives every message a web preview.

`npm run senders:create` calls `nodemailer.createTestAccount()` three times (pass a number for more: `npm run senders:create -- 5`). It stores each account as a **sender** row (host, port, user, pass) and prints the login for each Ethereal inbox. Compose shows these senders in the From dropdown. Every sent email stores its Ethereal preview URL, shown as "Open in Ethereal" on the email detail page.

### Google OAuth
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

The backend does the full authorization-code flow (with a CSRF `state` cookie), verifies the ID token and upserts the user. It then sets an httpOnly JWT session cookie and redirects to `/dashboard`. The header shows the user's name, email and Google avatar, plus a Log out button.

### Slack OAuth
1. Create an app at https://api.slack.com/apps. Under OAuth & Permissions, add the bot scopes `incoming-webhook` and `chat:write`.
2. Slack only accepts **HTTPS** redirect URLs, so expose the backend: `ngrok http 4000`.
3. Add `https://<your-ngrok-domain>/api/slack/callback` as a redirect URL in Slack, and set `SLACK_REDIRECT_URI` to the same value. Set `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.
4. In the dashboard, click **Connect Slack**, pick a channel, and approve.

### All backend variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | – | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ + rate-limit counters |
| `ELASTICSEARCH_URL` / `_INDEX` / `_ENABLED` | `http://localhost:9200` / `emails` / `true` | Search index |
| `JWT_SECRET` | – | Signs the session cookie and OAuth `state` |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | – | Google login |
| `SLACK_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | – | Slack connect |
| `WORKER_CONCURRENCY` | `5` | Jobs each worker processes in parallel |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Minimum gap between two sends from the same sender |
| `MAX_EMAILS_PER_HOUR` | `200` | Global hourly cap (all senders, all workers) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Hourly cap per sender |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | Window size. Keep 1 hour; lower it only to demo window roll-over |
| `RUN_WORKER_IN_API` | `true` | Also run a worker inside the API process |
| `MAIL_TRANSPORT` | `ethereal` | `json` skips SMTP (offline tests) |
| `BULL_BOARD_USER` / `_PASSWORD` | empty | Basic auth for `/admin/queues` |

Nothing is hardcoded: every limit above is read from the environment and validated at startup.

---

## 3. Architecture

```
 Next.js dashboard ──► Express API ──► PostgreSQL  (source of truth: campaigns, emails, users, senders, slack)
                          │   │
                          │   ├──► Redis: atomic slot reservation (Lua) – rate limits + per-sender gap
                          │   ├──► BullMQ queue (Redis): 1 delayed job per email, jobId = email id
                          │   └──► Elasticsearch: full-text index of emails
                          │
                BullMQ worker(s) ──► claim row in Postgres ──► Nodemailer ──► Ethereal SMTP
                          └──► Slack incoming webhook when a limit pushes emails out
```

### How scheduling works
1. **Compose → `POST /api/campaigns`.** The browser parses the CSV, de-duplicates it and shows the count. The API validates the request again (zod), normalizes and de-duplicates recipients, and rejects invalid addresses.
2. **Persist first.** In one transaction it inserts a `campaigns` row and one `emails` row per recipient, each with its earliest send time `startAt + i × delay`. A unique `(campaign_id, to_email)` index makes duplicates impossible.
3. **Reserve a slot for every email** in recipient order, in one batched Lua script (see rate limiting below). This returns the real send time of each email, and the DB is updated with it, so the dashboard shows when each email will actually go out.
4. **Enqueue.** One BullMQ **delayed job** per email (`delay = slot − now`, `jobId = email.id`), added in bulk in chunks of 500. There is no cron anywhere: BullMQ keeps delayed jobs in a Redis sorted set and moves each one to *waiting* when its time comes.
5. **Index** the emails in Elasticsearch (best effort; it never blocks scheduling).
6. **Worker** picks up the job at its slot → re-reads the row → claims it atomically (`UPDATE … SET status='SENDING' WHERE id=? AND status='SCHEDULED'`) → sends via the sender's SMTP account with a deterministic `Message-ID` → marks it `SENT` (with the Ethereal preview URL) or `FAILED`.

### How persistence on restart is handled
- **PostgreSQL is the source of truth.** Every email exists as a row before it is ever queued.
- **Jobs live in Redis**, not in process memory, and Redis runs with **AOF persistence** in docker-compose. When the API or worker stops (Ctrl+C triggers a graceful `worker.close()` that lets in-flight sends finish) and starts again, BullMQ still holds every delayed job and releases it at the right time. Nothing restarts from scratch.
- **Startup reconciler** (`queue/reconcile.ts`) runs before a worker takes any job:
  - *Backlog after downtime.* Emails whose slot passed while the server was down are re-planned **in their original order**, so the backlog goes out spaced and within the limits instead of in one burst.
  - *Lost jobs.* If Redis lost data, or the API died between the DB insert and the enqueue, every `SCHEDULED` row without a job is re-enqueued with the same jobId. It keeps its reserved slot if Redis still has it, otherwise it gets a fresh one.
  - *Interrupted sends.* A row stuck in `SENDING` with no job means a process died mid-SMTP. See idempotency below.

### Idempotency: an email is never sent twice
| Layer | Guarantee |
| --- | --- |
| Queue | `jobId = email.id`: BullMQ ignores a second `add` with the same id, so re-enqueueing (reconciler, retries) cannot create a duplicate job |
| Worker | Before sending, the row is re-read: `SENT` / `FAILED` → skip. Then an atomic conditional `UPDATE … WHERE status='SCHEDULED'`: only one worker can ever win the claim |
| Crash mid-send | If a worker dies after claiming but before recording the result, nobody knows whether SMTP accepted the message. We choose **at-most-once**: the row is marked `FAILED` with a clear reason instead of being re-sent. Duplicates are worse than a visible failure for cold email. |
| SMTP | Deterministic `Message-ID: <emailId@outbox-scheduler.local>`, so a downstream system can de-duplicate too |
| Recipients | Unique `(campaign_id, to_email)` index |

Retries: a send that fails with an SMTP error (rejected or unreachable) is put back to `SCHEDULED` and retried by BullMQ up to 3 times with exponential backoff, and marked `FAILED` after the last attempt.

### How rate limiting and concurrency are implemented

**Slot reservation (one atomic Redis Lua script, `services/rateLimiter.ts`).** Each email gets the earliest send time that satisfies all four rules at once:

| Rule | Redis structure |
| --- | --- |
| Min **2 s** (`MIN_DELAY_BETWEEN_EMAILS_MS`) between two sends of the same sender | sorted set `rl:slots:sender:{senderId}` of reserved slot times |
| Global hourly cap `MAX_EMAILS_PER_HOUR` | counter `rl:global:{window}` |
| Per-sender hourly cap `MAX_EMAILS_PER_HOUR_PER_SENDER` | counter `rl:sender:{senderId}:{window}` |
| Per-campaign "Hourly limit" from Compose | counter `rl:campaign:{campaignId}:{window}` |

`{window} = floor(time / RATE_LIMIT_WINDOW_MS)` (clock-hour buckets). If the window a slot would fall in is full, the search jumps to the start of the next window, so **jobs are delayed, never dropped or failed**. Because the script runs atomically inside Redis, any number of API servers and workers can reserve at the same time without double-booking, and no counting happens in process memory.

Why reserve at scheduling time instead of checking when each job fires?
- **Order is preserved exactly.** Slots are handed out in recipient order in one call, so a 1,000-email campaign that overflows into later hours keeps its order. Checking at fire time with concurrent workers lets jobs that fire together swap places.
- **No thrashing under load.** With check-at-fire-time, 1,000 jobs due at once would each be fetched, rejected and re-delayed, over and over. With reservations, each job is delayed exactly once, straight to its slot.
- **Honest UI.** The Scheduled table shows the real send time, including emails pushed into later hours, which get a "delayed" tag.

The worker re-reserves only when a job has no valid reservation: a retry, a job re-created by the reconciler, or a job that fired more than 5 s late after downtime. Re-reserving first releases the email's old slot so it isn't counted twice.

**Concurrency.** Each worker runs `WORKER_CONCURRENCY` jobs in parallel (default 5), and you can run as many worker processes as you like. This is safe because limits and spacing are decided in Redis, not by the worker, and each email is claimed with a conditional UPDATE. Concurrency only lets several *senders* send in parallel; it never breaks a single sender's 2 s gap.

**Behaviour under load (1,000+ emails at the same time).** The API inserts the rows (chunked inserts), reserves 1,000 slots in two Lua calls of 500 and bulk-adds the jobs. In local testing this took ~0.75 s for 1,000 emails. With a 100/hour per-sender cap, the first 100 go out 2 s apart, the next 100 at the start of the next hour, and so on. Nothing is dropped and no window ever exceeds its cap. A Slack alert is sent once per limit and window.

**Slack alert on limit hit.** When a reservation has to skip a full window (at scheduling time, or in the worker), the email owner's Slack connection is read from the DB and a message is posted to their channel. It names the limit, the window, and when the delayed emails will start. A Redis `SET NX` key makes it one message per user, limit and window, not one per email. The connection is looked up on every alert, so connecting or disconnecting takes effect immediately without a redeploy. With no connection the alert is skipped silently, and a Slack outage never affects sending.

### Search (Elasticsearch)
Every email is indexed on creation and re-indexed on each status change (recipient, subject, body, status, times). The search box on both tabs runs a `multi_match` with fuzziness, filtered by user and tab. If Elasticsearch is unavailable, search falls back to Postgres `ILIKE`, and `npm run es:reindex` rebuilds the index from Postgres.

---

## 4. Features implemented

### Backend
| Requirement | Where |
| --- | --- |
| Scheduling API, stored in Postgres | `POST /api/campaigns`, `services/scheduler.ts`, `db/schema.ts` |
| BullMQ delayed jobs, no cron | `queue/emailQueue.ts` |
| Multiple senders via Ethereal SMTP | `senders` table, `scripts/createSenders.ts`, `services/mailer.ts` |
| Persistence across restarts | Redis AOF + `queue/reconcile.ts` + graceful shutdown |
| Idempotency / no duplicates | jobId = email id, atomic claim, at-most-once on crash |
| Configurable worker concurrency | `WORKER_CONCURRENCY`, `queue/emailWorker.ts` |
| Minimum delay between sends | per-sender gap in the Lua reservation (`MIN_DELAY_BETWEEN_EMAILS_MS`, default 2 s) |
| Hourly limits: global + per-sender + per-campaign, safe across workers | `services/rateLimiter.ts` (Redis Lua) |
| Over-limit emails delayed to the next window, order preserved | slot reservation |
| Slack OAuth + live notification on limit hit | `routes/slack.ts`, `services/slack.ts` |
| Elasticsearch search | `services/search.ts`, `GET /api/emails?q=` |
| Live BullMQ dashboard | Bull Board at `/admin/queues` |
| Load test | `npm run load:test -- <your-login-email> 1000` |

### Frontend
| Requirement | Where |
| --- | --- |
| Real Google login, redirect to dashboard | `app/page.tsx` → backend OAuth |
| Header with name, email, avatar, logout | `components/layout/Header.tsx` |
| Scheduled / Sent tabs with counts, Compose button | `components/layout/Sidebar.tsx` |
| Compose: subject, body, CSV/TXT upload with detected count, start time, delay, hourly limit, Schedule | `components/compose/*` |
| Scheduled table: email, subject, scheduled time, status | `components/emails/EmailTable.tsx` |
| Sent table: email, subject, sent time, status (sent / failed) | same component, `tab="sent"` |
| Loading skeletons, empty states, error banners, toasts | `EmailListView`, `ui/EmptyState`, `providers/ToastProvider` |
| Live updates (polls every 4–5 s while the tab is visible) | `hooks/usePolledQuery.ts` |
| Search, pagination, email detail with Ethereal preview link | `EmailListView`, `app/dashboard/emails/[id]` |
| Connect / disconnect Slack | `components/slack/SlackCard.tsx` |
| Responsive (stacked rows on mobile) | `EmailTable` mobile list |

---

## 5. Assumptions, shortcuts and trade-offs

- **At-most-once on a crash mid-send.** An email whose worker died between claiming it and recording the result is marked `FAILED`, not retried, because we can't know whether SMTP accepted it. A retry could double-send to a prospect. Normal SMTP errors (rejected or unreachable) are still retried up to 3 times. In the very rare case where SMTP accepted the message but the connection dropped before the reply, a retry could re-send it; the deterministic Message-ID lets downstream systems de-duplicate.
- **Fixed clock-hour windows**, not sliding windows: simple, cheap and predictable. A burst at 10:59 and another at 11:00 is allowed, just like most provider quotas.
- **Limits are reserved at scheduling time.** That makes order and the displayed times exact, but slots for far-future campaigns are reserved early. There is no "cancel campaign" feature (out of scope), so reservations are never released early.
- **The minimum delay is per sender** (that's what a provider throttles). Different senders can send in parallel; the global hourly cap still applies across all of them.
- **One sender per campaign**, chosen in Compose. "Multiple senders" means several Ethereal accounts selectable per campaign, each with its own limits.
- **Redis is a single node / Sentinel.** The Lua script builds counter keys dynamically; Redis Cluster would need a shared hash tag.
- **Elasticsearch is secondary.** Postgres is the source of truth, indexing is best effort, search falls back to Postgres, and `npm run es:reindex` rebuilds the index.
- **Plain-text bodies** (converted to simple HTML line breaks). No rich-text editor or attachments.
- **Session** is a 7-day httpOnly JWT cookie. Frontend and backend share the `localhost` site, so `SameSite=Lax` works without a proxy. A deployment on different domains would need `SameSite=None; Secure` or a reverse proxy.
- **Slack token and webhook are stored unencrypted** in Postgres. Encrypt at rest in production.
- **Drizzle ORM** instead of Prisma: lighter, SQL-first, and no native engine download.

---

## 6. Testing what matters

These scenarios were run against real Postgres and Redis with `MAIL_TRANSPORT=json` and short windows:

| Scenario | Result |
| --- | --- |
| 12 emails, sender cap 5/window | 5 per window, exact recipient order, ≥ min gap between sends |
| Campaign "Hourly limit" 3 | 4th email moved to the next window |
| Stop server → wait past due time → start | All overdue emails sent once, in order, spaced |
| `FLUSHALL` Redis while emails pending → start | Reconciler re-created the jobs; emails sent at their original times |
| Extra job injected for an already-sent email | Skipped (`already SENT`) |
| Row left in `SENDING` (simulated crash) | Marked `FAILED`, not re-sent |
| 1,000 emails due at once | Planned in ~0.75 s, never above cap per window, 0 out of order, 0 duplicates |
| Limit hit with and without a Slack connection | Alert posted once with a connection; silently skipped without one |

`npm run typecheck` passes in both packages, and `npm run build` succeeds for the frontend.
