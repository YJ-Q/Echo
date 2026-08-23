import { createHash } from 'node:crypto';

const sql = `
ALTER TABLE margin_projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE margin_projects ADD COLUMN current_state TEXT;
ALTER TABLE margin_artifacts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE margin_artifacts ADD COLUMN preview_metadata TEXT NOT NULL DEFAULT '{}';
CREATE TABLE margin_needs_owner (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES margin_projects(id),
  run_id TEXT REFERENCES margin_runs(id),
  type TEXT NOT NULL CHECK (type IN ('decision','approval','input','conflict')),
  reason TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  consequence_summary TEXT,
  context_summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','cancelled')),
  resolution TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  source_session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE margin_event_cursors (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES margin_events(id)
);
INSERT INTO margin_event_cursors(event_id)
  SELECT id FROM margin_events ORDER BY rowid;
CREATE TRIGGER margin_assign_event_cursor
AFTER INSERT ON margin_events
BEGIN
  INSERT INTO margin_event_cursors(event_id) VALUES (NEW.id);
END;
`;

export const APPLICATION_CONTRACT_MIGRATION = Object.freeze({
  version: 4,
  name: 'margin-application-contract',
  sql,
  checksum: createHash('sha256').update(sql).digest('hex')
});
