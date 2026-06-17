# LinkedIn Profile Enhancer

Background AI agent that autonomously enhances your LinkedIn presence — research, engage, connect, and post — with human-like rate limiting to protect your account.

Built for **Rajaram Joshi** as a builder of AI-powered Recruiting and Workforce Intelligence Systems.

## Features

- **Background daemon** — runs continuously, one action at a time with random delays
- **AI-powered** — OpenAI researches targets, drafts comments, posts, and invite notes
- **Unipile integration** — LinkedIn actions via official API (likes, comments, invites, posts)
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
| Connection requests | 10/day | 25/day |
| Original posts | — | 3/week (Tue/Thu/Sat) |

Working hours: Mon–Fri, 8am–7pm (configurable via `TIMEZONE`).

## Safety

- `PAUSED=true` — kill switch, agent sleeps but stays alive
- `DRY_RUN=true` — no Unipile calls
- Halts automatically on `account_restricted` errors
- All content passes spam filter + OpenAI moderation

## Environment Variables

See [`.env.example`](.env.example).
