-- Actions audit log
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  content TEXT,
  result TEXT NOT NULL,
  error_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(action_type, target_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_actions_type_date ON actions(action_type, created_at);
CREATE INDEX IF NOT EXISTS idx_actions_target ON actions(target_id);

-- Discovered targets (posts, people)
CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL, -- 'post' | 'person'
  target_id TEXT NOT NULL UNIQUE,
  provider_id TEXT,
  social_id TEXT,
  author_name TEXT,
  author_headline TEXT,
  content_preview TEXT,
  relevance_score INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | engaged | skipped | invited | withdrawn | filtered | connected
  metadata TEXT, -- JSON
  sequence_stage TEXT DEFAULT 'discovered',
  author_provider_id TEXT,
  author_public_id TEXT,
  source_post_id TEXT,
  person_source TEXT, -- post | search | comment
  posted_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_engaged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_targets_status ON targets(status, relevance_score DESC);

-- Published posts
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT,
  content TEXT NOT NULL,
  pillar TEXT,
  format TEXT NOT NULL DEFAULT 'text', -- text | repost
  source_post_id TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profile snapshots
CREATE TABLE IF NOT EXISTS profile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headline TEXT,
  about TEXT,
  follower_count INTEGER,
  suggestions TEXT, -- JSON with headline variants + about rewrite
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily quota counters
CREATE TABLE IF NOT EXISTS quota_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(action_type, date)
);

-- Agent state / heartbeat
CREATE TABLE IF NOT EXISTS agent_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Follower tracking
CREATE TABLE IF NOT EXISTS follower_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Content dedup for safety filter
CREATE TABLE IF NOT EXISTS content_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backoff state
CREATE TABLE IF NOT EXISTS backoff_state (
  action_type TEXT PRIMARY KEY,
  blocked_until TEXT,
  reason TEXT,
  retry_count INTEGER DEFAULT 0
);

-- Account metadata
CREATE TABLE IF NOT EXISTS account_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- First-degree LinkedIn connections (synced via Unipile relations)
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  public_identifier TEXT,
  full_name TEXT,
  headline TEXT,
  profile_url TEXT,
  connected_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  from_invite INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  last_engaged_at TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_connections_accepted
  ON connections(accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_connections_engaged
  ON connections(last_engaged_at);

-- Remote job / freelance opportunities discovered via LinkedIn jobs search
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  company TEXT,
  company_url TEXT,
  url TEXT,
  location TEXT,
  presence TEXT,        -- remote | hybrid | on_site
  job_type TEXT,        -- full_time | contract | part_time
  role_family TEXT,     -- see src/config/jobs.ts
  posted_at TEXT,
  description TEXT,
  match_score INTEGER DEFAULT 0,
  match_reasons TEXT,   -- JSON array
  match_gaps TEXT,      -- JSON array
  pitch TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new | filtered | shortlisted | applied | dismissed
  notified INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,        -- JSON
  discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opportunities_score
  ON opportunities(status, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_discovered
  ON opportunities(discovered_at DESC);

-- Approval-gated outbound DMs to accepted connections
CREATE TABLE IF NOT EXISTS dm_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  full_name TEXT,
  headline TEXT,
  opportunity_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'first_touch', -- first_touch | followup
  draft_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval',
    -- pending_approval | approved | rejected | sent | failed
  chat_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dm_queue_status
  ON dm_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_queue_provider
  ON dm_queue(provider_id);
-- Elasticsearch invite pipeline candidates (kept apart from warm-outreach targets)
CREATE TABLE IF NOT EXISTS es_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  es_id TEXT NOT NULL UNIQUE,
  linkedin_username TEXT NOT NULL UNIQUE,
  linkedin_url TEXT,
  full_name TEXT,
  job_title TEXT,
  company TEXT,
  headline TEXT,
  country TEXT NOT NULL,
  segment TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | resolved | invited | skipped | failed | withdrawn | connected
  skip_reason TEXT,
  invite_attempts INTEGER NOT NULL DEFAULT 0,
  invite_note TEXT,
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  invited_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_es_candidates_status
  ON es_candidates(status, country);
CREATE INDEX IF NOT EXISTS idx_es_candidates_provider
  ON es_candidates(provider_id);
