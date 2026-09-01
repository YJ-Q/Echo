import { createHash } from 'node:crypto';

const sql = `
ALTER TABLE margin_memories ADD COLUMN archived_at TEXT;
CREATE INDEX margin_memory_lifecycle_lookup
  ON margin_memories(project_id, confirmation_status, archived_at, updated_at, id);
`;

export const MEMORY_LIFECYCLE_MIGRATION = Object.freeze({
  version: 6,
  name: 'margin-memory-lifecycle',
  sql,
  checksum: createHash('sha256').update(sql).digest('hex')
});
