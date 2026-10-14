# LinkedIn Profile Enhancer

Background AI agent that runs a **remote job and freelance search** on LinkedIn: it finds remote roles and contract work, builds relationships with the people who can hire you, and keeps your profile and content working for you, all with human-like rate limiting to protect your account.

Built for **Rajaram Joshi** — independent AI/backend engineer and freelance CTO, looking for remote senior engineering roles and contract builds. Portfolio: [rajaram.info](https://rajaram.info).

Everything is **remote only**. Job search hard-codes `presence: ["remote"]`, hiring posts without a remote signal are rejected, and non-remote listings are dropped before they cost an AI call. Geography is broad (including India); what is never relaxed is the remote requirement.

## Features

- **Background daemon** — runs continuously, one action at a time with random delays
- **Remote job discovery** — LinkedIn jobs search across six role families, AI-scored 0-100 against your profile with fit reasons, honest gaps, and a tailored pitch
- **Approval-gated DM outreach** — drafts a soft first message to accepted connections and waits for you to approve it; nothing is ever sent automatically
- **Hiring-signal detection** — "we're hiring" posts bypass the engagement-traction gate, because a fresh job post with two reactions is still an opportunity
- **AI-powered** — OpenAI scores targets and jobs, drafts comments, posts, invite notes, and DMs
- **Warm outreach sequences** — like → comment → profile view → invite → DM (no cold invites, no cold DMs)
- **Network nurture** — occasional likes/comments on first-degree connections (especially recent accepts)
- **Own-post replies** — answers comments on your posts within 48 hours; upserts commenters as warm leads
- **Stale invite withdrawal** — auto-cancels pending invites older than 21 days
- **Hiring-side ICP** — recruiters, talent acquisition, hiring managers, founders, and agency owners are the targets; coaches, resume writers, and fellow job seekers are filtered out
- **Preferred geography** — US, Europe, UK, Canada, Australia, Russia, India; remaining South Asia (Pakistan, Bangladesh, Sri Lanka, Nepal) filtered out
- **High-engagement focus** — likes/comments prioritize posts with traction and higher relevance
- **Smarter research** — fresh post search, keyword rotation, pagination, classic LinkedIn API, plus ~9% first-degree nurture search
- **Research-backed posts** — feed themes from high-score discoveries drive original drafts
- **Repost with commentary** — ~15% of post days share high-scoring feed content with your take
- **Post boost window** — ~45 min of ICP likes/comments/replies after each publish to warm the feed
- **Discord alerts** — optional webhook for strong job matches, DM approval requests, start/stop, research, posts, accepts, halt, and rate-limit events
- **Unipile integration** — LinkedIn actions via official API (likes, comments, invites, posts, profile views, relations, jobs search, messaging)
- **Ban-safe rate limiting** — hard daily caps, working-hours-only, burst pauses, exponential backoff
- **Em-dash hard gate** — content blocked at safety filter, rate limiter, and Unipile client before publish
- **Profile audit** — weekly AI suggestions for headline and about section
- **Full audit trail** — SQLite logs every action

## Setup

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment**

```bash
cp .env.example .env
# Fill in UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID, OPENAI_API_KEY
# Strongly recommended: OWN_PROVIDER_ID (your LinkedIn provider_id)
# Optional: DISCORD_WEBHOOK_URL
```

3. **Start the agent**

```bash
# Foreground (recommended for first run)
npm run agent:start

# Background detached
npx tsx src/cli/index.ts start --daemon

# Dry run (AI runs, no LinkedIn API calls)
npm run dry-run
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run agent:start` | Start agent in foreground |
| `npm run agent:stop` | Graceful shutdown |
| `npm run agent:status` | Running state + quotas |
| `npm run stats` | Follower growth + action history |
| `npm run dry-run` | Test without LinkedIn calls |
| `npm run dashboard` | Web dashboard (localhost) |
| `npx tsx src/cli/index.ts jobs` | List scored remote opportunities |
| `npx tsx src/cli/index.ts dm list` | Show DM drafts awaiting approval |
| `npx tsx src/cli/index.ts dm approve <id>` | Approve a draft (`--text` to rewrite it) |
| `npx tsx src/cli/index.ts dm reject <id>` | Reject a draft so it is never sent |

## Dashboard

View agent activity in the browser while the daemon keeps running:

```bash
# Terminal 1 — agent (already running)
npm run agent:start

# Terminal 2 — dashboard
npm run dashboard
# open http://127.0.0.1:3847
```

Reads open SQLite in readonly mode. The dashboard also exposes two **mutating** endpoints, for approving DMs and setting opportunity status.

> **The dashboard has no authentication.** Anyone who can reach the port can read your pipeline and approve queued DMs. Access control has to happen at the network layer. An in-process source-address check is not an option: Docker NATs inbound traffic, so the container sees the bridge gateway for every request, including ones from the host's own loopback, and that same address is what internet traffic arrives from once the port is published on `0.0.0.0`.
>
> `docker-compose.yml` publishes `"${DASHBOARD_PORT:-3847}:3847"`, which binds **all** interfaces. To keep it private, either publish on loopback only:
>
> ```yaml
> ports:
>   - "127.0.0.1:${DASHBOARD_PORT:-3847}:3847"
> ```
>
> then reach it with `ssh -L 3847:127.0.0.1:3847 user@host`, or leave the binding alone and block the port at the firewall.

| Setting | Default |
|---------|---------|
| `DASHBOARD_PORT` | `3847` |
| `DASHBOARD_HOST` | `127.0.0.1` |

Architecture docs (pipelines, schedule windows, rate limits, data model, notifications) are at **http://127.0.0.1:3847/docs**.

Dashboard sections: agent health, **remote opportunities** (scored listings with fit, gaps, pitch, and shortlist/applied/dismiss controls), **DM approvals** (editable drafts with approve/reject), outreach funnel, network nurture, post health, ICP quality, quotas, and the activity log.

## Outreach sequence

People discovered from posts follow a warm path before any connection request, and now continue past the accept into a conversation:

```
discovered → liked → commented → viewed → invite_ready → invited
                                                      ↘ withdrawn (21+ days pending)
                                                      ↘ connected → messaged → replied
```

| Source | Invite readiness |
|--------|------------------|
| **Post-sourced** | Must have commented **and** viewed |
| **Search-sourced** | Profile view only |
| **Comment-sourced** (own-post commenters) | Profile view only |

Invites are **never** sent to cold targets. Pending invites older than **21 days** are auto-withdrawn (`withdraw_invite`). Accepts are inferred when connection sync finds a relation that matches a prior successful invite → person marked `connected`.

## Remote job discovery

Set `ENABLE_JOB_DISCOVERY=true` (the default). Discovery runs a few times a day, weighted toward the morning window since fresh postings land overnight.

1. **Search** — picks one of six role families (AI/LLM, backend, platform/DevOps, engineering leadership, founding engineer, freelance/contract) and one keyword from it, then queries LinkedIn jobs with `presence: ["remote"]` hard-coded and a rotating preferred `region`. Jobs search ignores the array-style `location` filter (it returns zero results), so geography comes from the single-ID `region` field; results are geo-checked again locally.
2. **Dedupe** — job ids seen in the last 45 days are skipped without spending an AI call.
3. **Score** — up to 8 listings per run are scored 0-100 against your profile. The matcher returns fit reasons, honest gaps, and a one-paragraph pitch. A listing judged non-remote is capped at 35 and filtered.
4. **Persist** — everything lands in the `opportunities` table. Scores below 55 are stored as `filtered` so they never clutter the dashboard but also never get re-scored.
5. **Notify** — matches scoring **78 or above** trigger a Discord embed with the score, reasons, and pitch.

Review them in the dashboard or with `npx tsx src/cli/index.ts jobs`, then mark each one shortlisted, applied, or dismissed.

**Applying is manual.** Unipile exposes no apply-to-job endpoint, so the agent discovers, scores, and writes the pitch; you submit the application. This is a deliberate limit rather than something to work around, since auto-applying would be both the least effective and the riskiest part of the system.

## DM outreach

Off by default (`ENABLE_DM=false`). DMs go out under your name, so the design assumes you want a look at every one.

1. **Select** — an accepted connection whose headline matches the hiring ICP, at least **18 hours** and at most **30 days** after the accept. Nobody is DM'd twice.
2. **Draft** — a soft first message: 2-3 sentences referencing their actual work or hiring focus, one genuine question, and **no ask**. No availability pitch, no CV, no link, no request for a call. The goal is a reply, not a conversion. Capped at 450 characters and run through the same humanize and safety gates as comments.
3. **Queue** — the draft lands in `dm_queue` as `pending_approval` and a Discord alert fires. Drafting stops once 8 drafts are waiting, so an unattended agent cannot pile up a backlog.
4. **Approve** — edit and approve in the dashboard, or run `npx tsx src/cli/index.ts dm approve <id>`. Nothing is sent until you do.
5. **Send** — the agent sends approved drafts on its next DM slot and advances the person to `messaged`.
6. **Follow up** — when they reply, the person advances to `replied` and a follow-up draft is queued for approval. Availability is mentioned only if their reply actually opens the door.

Recommended rollout: run with `ENABLE_DM=false` for a few days so job discovery and the hiring-side ICP settle, then set `ENABLE_DM=true` with `DRY_RUN=true` to inspect drafts without sending, then go live.

## Network nurture

The agent also maintains existing relationships so activity looks more human on LinkedIn:

1. **Connection sync** — one-time paginated backfill of first-degree relations, then first-page refreshes a few times per workday at **randomized 3–8 hour intervals** (max 3/day after backfill). Does **not** consume engagement quotas.
2. **Accept detection** — newly seen relations that match prior successful invites are marked accepted/connected.
3. **Nurture research** — ~9% of research picks search posts with `network_distance=[1]` (fixed relevance 88, bypasses ICP/AI scoring).
4. **Nurture engagement** — ~28% chance to prefer nurture posts when available; boosts recent accepts (14d); 7-day per-connection cooldown; **does not** advance the cold-outreach invite sequence.
5. Nurture likes/comments share the same daily `like_post` / `comment_post` caps as outbound engagement.

## Elasticsearch invite pipeline

A second, independent invite source for personal networking (not Scrummer outreach). It pulls ICP people from the Elasticsearch `person` index and sends a connection request with a short personal note. No likes or comments, just search → lookup → invite.

```
ES query (US / India, random sample) → es_candidates queue
  → es_lookup: Unipile profile lookup (skip if self, 1st-degree, pending invite, or already in warm pipeline)
  → es_invite: AI note (no product mention) → connection request
```

| Item | Detail |
|------|--------|
| Segments (rotated) | Engineering leaders, tech founders/CXOs, senior engineers/architects, product & agile leaders |
| Filters | Tech industries only, title phrase match, excludes interns/students/recruiters/open-to-work |
| Geography | United States + India, balanced ~50/50 by invites sent per day |
| Caps | `es_lookup` 40/day, `es_invite` 15/day **and** `send_invite + es_invite` ≤ the `send_invite` cap (25/day) |
| Backoff | A 429 / limit error on either invite type blocks both |
| Accepts / withdrawals | Same connection sync + 21-day stale withdrawal as warm invites |

Enable it in `.env`:

```bash
ES_PIPELINE_ENABLED=true
ES_URL=https://your-es-host
ES_USERNAME=...
ES_PASSWORD=...
```

Preview who it would target (ES only, no LinkedIn calls, nothing saved):

```bash
npx tsx src/cli/index.ts es-preview -c india -s eng_executives -n 10
```

`npm run agent:status` shows the queue and invites per country. Targeting lives in `src/config/es-icp.ts`.

## Docker Compose

Three services share one image and one SQLite volume:

| Service | `AGENT_MODE` | Does |
|---------|--------------|------|
| `agent` | `main` | Warm outreach, posts, replies, nurture, invite withdrawal, connection sync |
| `es-agent` | `es` | Elasticsearch invite pipeline only (idles unless `ES_PIPELINE_ENABLED=true`) |
| `dashboard` | – | Read-only dashboard on `127.0.0.1:3847` |

Because both agents act on the same LinkedIn account, the shared DB enforces the combined invite cap, backoff, halt state, and a minimum 40s gap between any two LinkedIn calls across containers. ES invites are spaced 20–50 min apart, so ~15/day spread over the workday.

```bash
docker compose up -d --build            # everything
docker compose up -d es-agent           # just the ES pipeline
docker compose logs -f es-agent
docker compose stop es-agent            # pause ES invites, main agent keeps running
docker compose exec agent node dist/cli/index.js status
docker compose exec es-agent node dist/cli/index.js es-preview -c india -s founders --notes
```

**ES pipeline only** (main agent off):

```bash
docker compose stop agent
docker compose up -d es-agent dashboard
```

When the main agent's heartbeat is missing (stopped or stale >60 min), `es-agent` also runs its invite housekeeping: daily withdrawal of invites pending 21+ days and connection sync, so ES accepts are detected. The dashboard's **ES invites** section shows ES agent health, invites/accepts by country and segment, queue, next invite time, and the last 20 invites with the exact note sent.

On an account restriction both agents stay up and idle (no restart loop) until the `halted` flag is cleared.

## Process Management

**pm2:**
```bash
pm2 start ecosystem.config.js
pm2 logs linkedin-agent
pm2 stop linkedin-agent
```

**macOS launchd:**
```bash
cp com.linkedin-auto.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.linkedin-auto.plist
```

## Rate Limits (hardcoded, non-overridable)

Caps below are **effective** daily limits. Week 1–2 = ramp-up base × 0.5; afterward steady caps apply.

| Action | Week 1–2 (effective) | Steady |
|--------|----------------------|--------|
| Post likes | 15/day | 60/day |
| Comment likes | 7/day | 30/day |
| Comments | 2/day | 15/day |
| Replies (own posts) | 2/day | 10/day |
| Profile views | 4/day | 20/day |
| Connection requests | 5/day | 25/day |
| Withdraw invites | 5/day | 20/day |
| Searches | 20/day | 80/day |
| Job discovery searches | 3/day | 12/day |
| DMs sent | 2/day | 10/day |
| DM follow-ups | 1/day | 8/day |
| Original posts | — | 3/week (Tue/Thu/Fri) |
| Profile audit | — | 1/week (Monday) |

Working hours: Mon–Fri, 8am–7pm (configurable via `TIMEZONE`).

`sync_connections` is quota-free (Unipile relations API only).

## Safety

- `PAUSED=true` — kill switch, agent sleeps but stays alive
- `DRY_RUN=true` — no Unipile writes (connection sync still schedules state but skips API)
- `OWN_PROVIDER_ID` — strongly recommended; blocks self-invite/self-targeting; migration filters pending self-profile rows on startup
- Halts automatically on `account_restricted` errors
- All content passes spam filter + OpenAI moderation
- **Em-dash triple gate** — blocked in safety filter, rate limiter (`contains_em_dash`), and Unipile client before any publish
- **DMs require explicit approval** — every draft waits in `dm_queue`; drafting halts at 8 pending. The approval routes are unauthenticated, so restrict the dashboard port at the network layer
- **No public job begging** — comments and invite notes are forbidden from mentioning availability or asking to be considered
- ICP exclude patterns filter coaches, resume writers, personal-brand accounts, and fellow job seekers before AI scoring
- Geography: people search scoped to US / Europe / UK / CA / AU / RU / IN; Pakistan, Bangladesh, Sri Lanka, and Nepal hard-filtered
- Engagement gate: likes/comments only on high-relevance posts with existing traction
- Connection sync is spaced randomly (few times/day) to avoid automation-like polling patterns
- Nurture engagement never re-invites connected people or advances invite stages
- Invite errors of type `already_connected` mark the person `connected` without retry storms

## Discord notifications

Optional. Set `DISCORD_WEBHOOK_URL` to enable; leave empty to disable. Fire-and-forget (shutdown alert is awaited).

| Event | Severity |
|-------|----------|
| Agent started / stopped | info |
| Strong job match (score ≥ 78) | info |
| DM draft awaiting approval | warn |
| DM sent after approval | info |
| Reply received, follow-up drafted | warn |
| Research finished | info |
| Post published / draft failed | info / warn |
| Connection accepts detected | info |
| Profile audit done | info |
| Daily quotas exhausted | info |
| Account halt / 24h block | critical |
| 429 / day-block backoff | warn |
| Generic action failure | warn |

## Environment Variables

See [`.env.example`](.env.example).

| Variable | Required | Purpose |
|----------|----------|---------|
| `UNIPILE_BASE_URL` | yes | Unipile API base |
| `UNIPILE_API_KEY` | yes | Unipile API key |
| `UNIPILE_ACCOUNT_ID` | yes | LinkedIn account in Unipile |
| `OPENAI_API_KEY` | yes | OpenAI key |
| `OPENAI_MODEL` | no | Default `gpt-4.1` |
| `TIMEZONE` | no | Default `America/Los_Angeles` |
| `DRY_RUN` | no | `true` skips LinkedIn writes |
| `PAUSED` | no | Soft kill switch |
| `OWN_PROVIDER_ID` | **recommended** | Your LinkedIn `provider_id` (from Unipile profile / relations). Empty disables self-filter. |
| `DISCORD_WEBHOOK_URL` | no | Discord webhook URL; empty = no alerts |
| `DASHBOARD_PORT` | no | Default `3847` |
| `DASHBOARD_HOST` | no | Default `127.0.0.1` |
| `ENABLE_JOB_DISCOVERY` | no | Remote job search + AI scoring. Default `true` |
| `ENABLE_DM` | no | DM drafting and sending. Default **`false`**; drafts still need approval when on |
| `PORTFOLIO_URL` | no | Default `https://rajaram.info`; used for context, never auto-inserted as a link |
| `RESUME_URL` | no | Optional resume link for your own reference |
