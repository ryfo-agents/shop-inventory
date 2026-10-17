-- 003_inventory_tables.sql
-- Cloud-first inventory tables for a fresh production database.

CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  num int NOT NULL,
  title text NOT NULL,
  sort_order int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subsections (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  num text NOT NULL,
  title text NOT NULL,
  sort_order int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS marks (
  item_id text PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  status text CHECK (status IS NULL OR status IN ('unknown', 'have', 'missing', 'upgrade', 'blocking', 'na')),
  q int CHECK (q IS NULL OR q >= 0),
  sp text,
  n text,
  c numeric CHECK (c IS NULL OR c >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sections_workspace_idx ON sections(workspace_id);
CREATE INDEX IF NOT EXISTS subsections_workspace_idx ON subsections(workspace_id);
CREATE INDEX IF NOT EXISTS items_workspace_idx ON items(workspace_id);
CREATE INDEX IF NOT EXISTS marks_workspace_idx ON marks(workspace_id);
CREATE INDEX IF NOT EXISTS items_updated_idx ON items(updated_at);
CREATE INDEX IF NOT EXISTS marks_updated_idx ON marks(updated_at);
