-- UTC day buckets and one lifetime total. No request or visitor data.
CREATE TABLE IF NOT EXISTS visit_counts (
  period TEXT PRIMARY KEY,
  visits INTEGER NOT NULL CHECK (visits >= 0)
) WITHOUT ROWID;
