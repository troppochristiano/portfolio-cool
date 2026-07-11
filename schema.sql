-- Metadata for community-uploaded ASCII figures. The frame data itself lives
-- in R2 at figures/<id>.json; this table holds everything the gallery grid and
-- hero need without touching R2 (including a downsampled text thumbnail).
--
-- Apply:  npx wrangler d1 execute ascii-figures --local  --file=schema.sql
--         npx wrangler d1 execute ascii-figures --remote --file=schema.sql
--
-- Migrating an EXISTING database (the CREATE above is IF NOT EXISTS, so it won't
-- add new columns). Run once per environment — it errors "duplicate column" if
-- already applied, which is safe to ignore:
--   npx wrangler d1 execute ascii-figures --local  --command="ALTER TABLE figures ADD COLUMN edge_thumb TEXT"
--   npx wrangler d1 execute ascii-figures --remote --command="ALTER TABLE figures ADD COLUMN edge_thumb TEXT"
CREATE TABLE IF NOT EXISTS figures (
  id TEXT PRIMARY KEY,                 -- crypto.randomUUID(), doubles as the R2 key
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  cell_px REAL,
  frames_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  thumb_frame INTEGER NOT NULL DEFAULT 0,
  thumb TEXT NOT NULL,                 -- stride-downsampled frames[thumb_frame], <=80 cols
  thumb_cols INTEGER NOT NULL,
  thumb_rows INTEGER NOT NULL,
  edge_thumb TEXT,                     -- same-stride downsample of the edge layer (NULL unless edge-colored)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  hero INTEGER NOT NULL DEFAULT 0,     -- 1 = also appears on the hero wall (approved only)
  style TEXT,                          -- validated style block as JSON, NULL = default look
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip_hash TEXT NOT NULL                -- SHA-256(IP_SALT + ip); raw IPs are never stored
);

CREATE INDEX IF NOT EXISTS idx_figures_status_created
  ON figures (status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_figures_ip
  ON figures (ip_hash, created_at);

-- Site-wide switches, one row per key. Currently only 'uploads_enabled'
-- ('1'/'0', missing row = enabled) — flipped from the hero's admin pill and
-- enforced in /api/upload for public (non-admin) submissions.
-- IF NOT EXISTS, so re-running this file on an existing DB adds it safely:
--   npx wrangler d1 execute ascii-figures --local  --file=schema.sql
--   npx wrangler d1 execute ascii-figures --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
