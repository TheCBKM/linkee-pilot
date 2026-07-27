# LinkedIn Profile Enhancer

Background AI agent that autonomously enhances your LinkedIn presence — research, engage, connect, and post — with human-like rate limiting to protect your account.

Built for **Rajaram Joshi**, CTO of [Scrummer.ai](https://scrummer.ai/) — AI standup bot and Jira automation for engineering teams.

## Features

- **Background daemon** — runs continuously, one action at a time with random delays
- **AI-powered** — OpenAI researches targets, drafts comments, posts, and invite notes
- **Warm outreach sequences** — like → comment → profile view → invite (no cold invites)
- **Network nurture** — occasional likes/comments on first-degree connections (especially recent accepts)
- **Own-post replies** — answers comments on your posts within 48 hours; upserts commenters as warm leads
- **Stale invite withdrawal** — auto-cancels pending invites older than 21 days
- **ICP hard filters** — deterministic title/headline gates before AI scoring
- **Preferred geography** — US, Europe, UK, Canada, Australia, Russia; India filtered out
- **High-engagement focus** — likes/comments prioritize posts with traction and higher relevance
- **Smarter research** — fresh post search, keyword rotation, pagination, classic LinkedIn API, plus ~9% first-degree nurture search
- **Research-backed posts** — feed themes from high-score discoveries drive original drafts
- **Repost with commentary** — ~15% of post days share high-scoring feed content with your take
- **Post boost window** — ~45 min of ICP likes/comments/replies after each publish to warm the feed
- **Discord alerts** — optional webhook for start/stop, research, posts, accepts, halt, and rate-limit events
- **Unipile integration** — LinkedIn actions via official API (likes, comments, invites, posts, profile views, relations)
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
| `npm run dashboard` | Read-only web dashboard (localhost) |

## Dashboard

View agent activity in the browser while the daemon keeps running:

```bash
# Terminal 1 — agent (already running)
npm run agent:start

# Terminal 2 — dashboard
npm run dashboard
# open http://127.0.0.1:3847
```

The dashboard is **read-only** — it opens SQLite in readonly mode and does not affect the agent.

| Setting | Default |
|---------|---------|
| `DASHBOARD_PORT` | `3847` |
| `DASHBOARD_HOST` | `127.0.0.1` |

Architecture docs (pipelines, schedule windows, rate limits, data model, notifications) are at **http://127.0.0.1:3847/docs**.

Dashboard sections include agent health, outreach funnel, **network nurture** (connections synced, accepts, nurture likes/comments), post health, ICP quality, quotas, and the activity log.

## Outreach sequence

People discovered from posts follow a warm path before any connection request:

```
discovered → liked → commented → viewed → invite_ready → invited
                                                      ↘ withdrawn (21+ days pending)
                                                      ↘ connected (accept detected)
```

| Source | Invite readiness |
|--------|------------------|
| **Post-sourced** | Must have commented **and** viewed |
| **Search-sourced** | Profile view only |
| **Comment-sourced** (own-post commenters) | Profile view only |

Invites are **never** sent to cold targets. Pending invites older than **21 days** are auto-withdrawn (`withdraw_invite`). Accepts are inferred when connection sync finds a relation that matches a prior successful invite → person marked `connected`.

## Network nurture

The agent also maintains existing relationships so activity looks more human on LinkedIn:

1. **Connection sync** — one-time paginated backfill of first-degree relations, then first-page refreshes a few times per workday at **randomized 3–8 hour intervals** (max 3/day after backfill). Does **not** consume engagement quotas.
2. **Accept detection** — newly seen relations that match prior successful invites are marked accepted/connected.
3. **Nurture research** — ~9% of research picks search posts with `network_distance=[1]` (fixed relevance 88, bypasses ICP/AI scoring).
4. **Nurture engagement** — ~28% chance to prefer nurture posts when available; boosts recent accepts (14d); 7-day per-connection cooldown; **does not** advance the cold-outreach invite sequence.
5. Nurture likes/comments share the same daily `like_post` / `comment_post` caps as outbound engagement.

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
- ICP exclude patterns filter recruiters, coaches, and spam profiles before AI scoring
- Geography: people search scoped to US / Europe / UK / AU / RU; India and South Asia hard-filtered
- Engagement gate: likes/comments only on high-relevance posts with existing traction
- Connection sync is spaced randomly (few times/day) to avoid automation-like polling patterns
- Nurture engagement never re-invites connected people or advances invite stages
- Invite errors of type `already_connected` mark the person `connected` without retry storms

## Discord notifications

Optional. Set `DISCORD_WEBHOOK_URL` to enable; leave empty to disable. Fire-and-forget (shutdown alert is awaited).

| Event | Severity |
|-------|----------|
| Agent started / stopped | info |
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
