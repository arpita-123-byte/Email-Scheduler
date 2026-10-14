# Demo video script (≈ 5 minutes)

**Before recording**
- `docker compose up -d`, then start the backend and the frontend, and log in once.
- Connect Slack (ngrok running) so the alert can be shown live.
- To make limits visible in a short video, set these in `backend/.env` and restart:
  ```
  RATE_LIMIT_WINDOW_MS=60000           # 1-minute windows for the demo
  MAX_EMAILS_PER_HOUR_PER_SENDER=5
  MIN_DELAY_BETWEEN_EMAILS_MS=2000
  ```
  Say on camera that production uses 1-hour windows and that this is the same code path.
- Keep three tabs open: dashboard, Bull Board (`localhost:4000/admin/queues`), terminal running the backend.

**0:00–0:30 · Login**
Log out, then click "Continue with Google". Point at the header: name, email, avatar.

**0:30–1:30 · Schedule emails**
Compose → From: pick an Ethereal sender → upload `samples/leads.csv`. Point out "10 email addresses detected (1 duplicate removed)" and that the invalid row is ignored. Enter a subject and body, delay 2 s, hourly limit 50, start "In 5 min". Click Schedule. The toast confirms, and the Scheduled tab shows each email with its exact send time.

**1:30–2:15 · Sent emails**
Schedule a second small batch with start "Now". Watch rows move from Scheduled to Sent (live refresh). Open one: show the sender, body and "Open in Ethereal" preview. Show a search, for example a recipient name.

**2:15–3:30 · Restart scenario**
With emails still scheduled a few minutes out:
1. In the backend terminal press Ctrl+C. Point at the graceful shutdown log line.
2. Show Bull Board/Redis still holding the delayed jobs (or just wait).
3. Start again with `npm run dev`. Point at the `[reconcile] …` log line.
4. When the time arrives, the emails are sent once each: Sent tab, Ethereal previews.

**3:30–4:30 · Rate limiting under load (bonus)**
`npm run load:test -- <your-login-email> 60`
- Scheduled tab: 5 emails per window, the rest at the start of later windows with the "delayed" tag, in order.
- Slack: the "Sender hourly limit reached" message arrives right away.
- Bull Board: delayed count, and jobs completing 2 s apart.

**4:30–5:00 · Wrap-up**
One sentence each: Postgres is the source of truth, there is one BullMQ delayed job per email (no cron), and Redis Lua reserves slots for the limits. Emails are never duplicated (jobId + atomic claim + at-most-once). The README lists the trade-offs.
