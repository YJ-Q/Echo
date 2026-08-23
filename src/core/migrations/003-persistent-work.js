import { createHash } from 'node:crypto';

const sql = `
ALTER TABLE margin_projects ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE margin_projects ADD COLUMN workstream_status TEXT NOT NULL DEFAULT 'running'
  CHECK (workstream_status IN ('running','ready','waiting','watching','blocked','needs_owner','paused','completed'));
ALTER TABLE margin_projects ADD COLUMN current_plan TEXT NOT NULL DEFAULT '[]';
ALTER TABLE margin_projects ADD COLUMN next_action TEXT;
ALTER TABLE margin_projects ADD COLUMN blockers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE margin_projects ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]';
ALTER TABLE margin_projects ADD COLUMN workspace_path TEXT;
ALTER TABLE margin_projects ADD COLUMN autonomy_level INTEGER NOT NULL DEFAULT 0 CHECK (autonomy_level >= 0);
ALTER TABLE margin_projects ADD COLUMN artifact_refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE margin_projects ADD COLUMN last_checkpoint_id TEXT;

CREATE TABLE margin_runs (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES margin_projects(id),
  runtime_kind TEXT NOT NULL,
  runtime_session_id TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','failed','needs_owner','cancelled')),
  stop_condition TEXT,
  allowed_actions TEXT NOT NULL DEFAULT '[]',
  forbidden_actions TEXT NOT NULL DEFAULT '[]',
  files_changed TEXT NOT NULL DEFAULT '[]',
  validation TEXT,
  result TEXT,
  error TEXT,
  checkpoint_id TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  source_session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE UNIQUE INDEX margin_one_open_run_per_workstream
  ON margin_runs(workstream_id) WHERE status IN ('queued','running','paused','needs_owner');

CREATE TABLE margin_artifacts (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES margin_projects(id),
  run_id TEXT REFERENCES margin_runs(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user','agent','system')),
  version INTEGER NOT NULL CHECK (version > 0),
  source_session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE margin_checkpoints (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES margin_projects(id),
  run_id TEXT REFERENCES margin_runs(id),
  run_version INTEGER,
  state_version INTEGER NOT NULL,
  state_digest TEXT NOT NULL,
  git_ref TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('user','agent','system')),
  source_session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const PERSISTENT_WORK_MIGRATION = Object.freeze({
  version: 3,
  name: 'margin-persistent-work',
  sql,
  checksum: createHash('sha256').update(sql).digest('hex')
});
