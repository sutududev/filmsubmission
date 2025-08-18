-- Migration 0002: add size and content_type fields; keep single-current copy per slot
-- We DO NOT implement versioning. Each slot (artwork kind, document type, caption language-kind)
-- always has a single current record. Re-uploads replace the DB row; old object is moved to
-- an R2 trash/ prefix and purged by lifecycle after 30 days (handled in R2 settings, not DB).

BEGIN TRANSACTION;

-- Artworks: add size and content type if they do not exist
ALTER TABLE artworks ADD COLUMN size_bytes INTEGER;
ALTER TABLE artworks ADD COLUMN content_type TEXT;

-- Documents: add size and content type
ALTER TABLE documents ADD COLUMN size_bytes INTEGER;
ALTER TABLE documents ADD COLUMN content_type TEXT;

-- Captions: add size and content type
ALTER TABLE captions ADD COLUMN size_bytes INTEGER;
ALTER TABLE captions ADD COLUMN content_type TEXT;

-- Optional helper view to compute per-title usage (sum of current records only)
DROP VIEW IF EXISTS title_usage_bytes;
CREATE VIEW title_usage_bytes AS
SELECT
  t.id AS title_id,
  COALESCE((SELECT SUM(size_bytes) FROM artworks  a WHERE a.title_id = t.id), 0) +
  COALESCE((SELECT SUM(size_bytes) FROM documents d WHERE d.title_id = t.id), 0) +
  COALESCE((SELECT SUM(size_bytes) FROM captions  c WHERE c.title_id = t.id), 0) AS used_bytes
FROM titles t;

COMMIT;