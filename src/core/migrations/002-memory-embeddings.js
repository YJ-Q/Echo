import { createHash } from 'node:crypto';

const sql = `
CREATE TABLE IF NOT EXISTS margin_memory_embeddings (
  memory_id TEXT NOT NULL REFERENCES margin_memories(id),
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(memory_id, model)
);
`;

export const MEMORY_EMBEDDINGS_MIGRATION = Object.freeze({
  version: 2,
  name: 'margin-memory-embeddings',
  sql,
  checksum: createHash('sha256').update(sql).digest('hex')
});
