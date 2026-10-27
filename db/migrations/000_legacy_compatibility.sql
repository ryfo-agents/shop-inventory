-- New compatibility prerequisite, applied even where 001-003 are recorded.
-- Historical migrations are unchanged. Create missing foundations in dependency
-- order before 001 ALTERs or 003 indexes. No ownership is guessed here; 004
-- explicitly quarantines/backfills unowned rows and validates tenant integrity.
-- 002_cloud_first_repair.sql
-- Idempotent repair for environments where migration 001 recorded before
-- all ownership tables were created.

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

CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events(workspace_id, created_at DESC);

-- Shop Inventory sync schema (Vercel Postgres / Neon).
-- Run once against the Postgres connection string before the first
-- `node scripts/seed-db.js`. Safe to re-run (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  num int NOT NULL,
  title text NOT NULL,
  sort_order int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subsections (
  id text PRIMARY KEY,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  num text NOT NULL,
  title text NOT NULL,
  sort_order int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Content: what the item is. Rarely changes; edited via the in-app editor.
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  subsection_id text NOT NULL REFERENCES subsections(id) ON DELETE CASCADE,
  label text NOT NULL,
  qty boolean NOT NULL DEFAULT false,
  target int,
  spec boolean NOT NULL DEFAULT false,
  phase int,
  tags text[] NOT NULL DEFAULT '{}',
  store text NOT NULL DEFAULT 'General',
  sort_order int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_subsection_idx ON items(subsection_id);
CREATE INDEX IF NOT EXISTS items_updated_idx ON items(updated_at);
CREATE INDEX IF NOT EXISTS subsections_updated_idx ON subsections(updated_at);
CREATE INDEX IF NOT EXISTS sections_updated_idx ON sections(updated_at);

-- Audit state: the same shape as the `user[id]` record in app.js.
CREATE TABLE IF NOT EXISTS marks (
  item_id text PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  status text,
  q int,
  sp text,
  n text,
  c numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marks_updated_idx ON marks(updated_at);

ALTER TABLE sections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE subsections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
