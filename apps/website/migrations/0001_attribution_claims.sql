CREATE TABLE attribution_claims (
  claim_id TEXT PRIMARY KEY
    CHECK (length(claim_id) = 43 AND claim_id NOT GLOB '*[^A-Za-z0-9_-]*'
      AND substr(claim_id, 43, 1) IN ('A','E','I','M','Q','U','Y','c','g','k','o','s','w','0','4','8')),
  challenge TEXT NOT NULL
    CHECK (length(challenge) = 43 AND challenge NOT GLOB '*[^A-Za-z0-9_-]*'
      AND substr(challenge, 43, 1) IN ('A','E','I','M','Q','U','Y','c','g','k','o','s','w','0','4','8')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at = created_at + 600000),
  bridge_id TEXT
    CHECK (bridge_id IS NULL OR (length(bridge_id) = 43 AND bridge_id NOT GLOB '*[^A-Za-z0-9_-]*'
      AND substr(bridge_id, 43, 1) IN ('A','E','I','M','Q','U','Y','c','g','k','o','s','w','0','4','8'))),
  journey_id TEXT
    CHECK (journey_id IS NULL OR (length(journey_id) = 36
      AND lower(journey_id) NOT GLOB '*[^0-9a-f-]*'
      AND length(replace(journey_id, '-', '')) = 32
      AND substr(journey_id, 9, 1) = '-' AND substr(journey_id, 14, 1) = '-'
      AND substr(journey_id, 19, 1) = '-' AND substr(journey_id, 24, 1) = '-'
      AND substr(journey_id, 15, 1) = '4' AND lower(substr(journey_id, 20, 1)) IN ('8','9','a','b'))),
  bound_at INTEGER CHECK (bound_at IS NULL OR (bound_at >= created_at AND bound_at < expires_at)),

  first_source TEXT CHECK (first_source IS NULL OR (length(first_source) BETWEEN 1 AND 64 AND first_source = trim(first_source))),
  first_medium TEXT CHECK (first_medium IS NULL OR (length(first_medium) BETWEEN 1 AND 64 AND first_medium = trim(first_medium))),
  first_campaign TEXT CHECK (first_campaign IS NULL OR (length(first_campaign) BETWEEN 1 AND 128 AND first_campaign = trim(first_campaign))),
  first_content TEXT CHECK (first_content IS NULL OR (length(first_content) BETWEEN 1 AND 128 AND first_content = trim(first_content))),
  first_referrer_class TEXT CHECK (first_referrer_class IN ('direct','internal','search','social','referral')),
  first_landing_content_key TEXT CHECK (first_landing_content_key IN (
    'landing','blog/index','blog/introducing-thinkrail','blog/thinkrail-workspaces','blog/thinkrail-sdd','vibecoding','agentic-development'
  )),
  first_touched_at INTEGER CHECK (first_touched_at >= 0),
  first_policy_version INTEGER CHECK (first_policy_version = 1),

  last_source TEXT CHECK (last_source IS NULL OR (length(last_source) BETWEEN 1 AND 64 AND last_source = trim(last_source))),
  last_medium TEXT CHECK (last_medium IS NULL OR (length(last_medium) BETWEEN 1 AND 64 AND last_medium = trim(last_medium))),
  last_campaign TEXT CHECK (last_campaign IS NULL OR (length(last_campaign) BETWEEN 1 AND 128 AND last_campaign = trim(last_campaign))),
  last_content TEXT CHECK (last_content IS NULL OR (length(last_content) BETWEEN 1 AND 128 AND last_content = trim(last_content))),
  last_referrer_class TEXT CHECK (last_referrer_class IN ('direct','internal','search','social','referral')),
  last_landing_content_key TEXT CHECK (last_landing_content_key IN (
    'landing','blog/index','blog/introducing-thinkrail','blog/thinkrail-workspaces','blog/thinkrail-sdd','vibecoding','agentic-development'
  )),
  last_touched_at INTEGER CHECK (last_touched_at >= 0),
  last_policy_version INTEGER CHECK (last_policy_version = 1),

  CHECK (
    (bridge_id IS NULL AND journey_id IS NULL AND bound_at IS NULL
      AND first_source IS NULL AND first_medium IS NULL AND first_campaign IS NULL AND first_content IS NULL
      AND first_referrer_class IS NULL AND first_landing_content_key IS NULL AND first_touched_at IS NULL AND first_policy_version IS NULL
      AND last_source IS NULL AND last_medium IS NULL AND last_campaign IS NULL AND last_content IS NULL
      AND last_referrer_class IS NULL AND last_landing_content_key IS NULL AND last_touched_at IS NULL AND last_policy_version IS NULL)
    OR
    (bridge_id IS NOT NULL AND journey_id IS NOT NULL AND bound_at IS NOT NULL
      AND first_referrer_class IS NOT NULL AND first_landing_content_key IS NOT NULL AND first_touched_at IS NOT NULL AND first_policy_version = 1
      AND last_referrer_class IS NOT NULL AND last_landing_content_key IS NOT NULL AND last_touched_at IS NOT NULL AND last_policy_version = 1
      AND first_touched_at <= last_touched_at)
  )
);

CREATE INDEX attribution_claims_expires_at_idx ON attribution_claims (expires_at);

CREATE TABLE attribution_create_quota (
  minute_bucket INTEGER PRIMARY KEY CHECK (minute_bucket >= 0),
  create_count INTEGER NOT NULL CHECK (create_count BETWEEN 1 AND 1000)
) WITHOUT ROWID;
