-- 001_cloud_first.sql
-- Cloud-first ownership and session foundation.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  password_hash text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE subsections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sections_workspace_idx ON sections(workspace_id);
CREATE INDEX IF NOT EXISTS subsections_workspace_idx ON subsections(workspace_id);
CREATE INDEX IF NOT EXISTS items_workspace_idx ON items(workspace_id);
CREATE INDEX IF NOT EXISTS marks_workspace_idx ON marks(workspace_id);
