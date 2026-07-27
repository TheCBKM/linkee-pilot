# LinkedIn Profile Enhancer

Background AI agent that autonomously enhances your LinkedIn presence — research, engage, connect, and post — with human-like rate limiting to protect your account.

Built for **Rajaram Joshi**, CTO of [Scrummer.ai](https://scrummer.ai/) — AI standup bot and Jira automation for engineering teams.

## Features

- **Background daemon** — runs continuously, one action at a time with random delays
- **AI-powered** — OpenAI researches targets, drafts comments, posts, and invite notes
- **Warm outreach sequences** — like → comment → profile view → invite (no cold invites)
- **ICP hard filters** — deterministic title/headline gates before AI scoring
- **Preferred geography** — US, Europe, UK, Canada, Australia, Russia; India filtered out
- **High-engagement focus** — likes/comments prioritize posts with traction and higher relevance
- **Smarter research** — fresh post search, keyword rotation, pagination, classic LinkedIn API
- **Research-backed posts** — feed themes from high-score discoveries drive original drafts
- **Repost with commentary** — ~15% of post days share high-scoring feed content with your take
- **Post boost window** — ~45 min of ICP likes/comments after each publish to warm the feed
- **Unipile integration** — LinkedIn actions via official API (likes, comments, invites, posts, profile views)
- **Ban-safe rate limiting** — hard daily caps, working-hours-only, burst pauses, exponential backoff
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

The dashboard is **read-only** — it opens SQLite in readonly mode and does not affect the agent. Port is configurable via `DASHBOARD_PORT` (default `3847`).

Architecture docs (pipelines, schedule windows, rate limits, data model) are at **http://127.0.0.1:3847/docs**.

## Outreach sequence

People discovered from posts follow a warm path before any connection request:

```
discovered → liked → commented → profile view → invite_ready → invited
```

People discovered via people search require a profile view before invite. Invites are **never** sent to cold targets.

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

| Action | Week 1-2 | Steady State |
|--------|----------|--------------|
| Post likes | 30/day | 60/day |
| Comments | 5/day | 15/day |
| Profile views | 8/day | 20/day |
| Connection requests | 10/day | 25/day |
| Searches | 40/day | 80/day |
| Original posts | — | 3/week (Tue/Thu/Fri) |

Working hours: Mon–Fri, 8am–7pm (configurable via `TIMEZONE`).

## Safety

- `PAUSED=true` — kill switch, agent sleeps but stays alive
- `DRY_RUN=true` — no Unipile calls
- Halts automatically on `account_restricted` errors
- All content passes spam filter + OpenAI moderation
- ICP exclude patterns filter recruiters, coaches, and spam profiles before AI scoring
- Geography: people search scoped to US / Europe / UK / AU / RU; India and South Asia hard-filtered
- Engagement gate: likes/comments only on high-relevance posts with existing traction

## Environment Variables

See [`.env.example`](.env.example).
