import { createHash } from 'node:crypto';

const sql = `
UPDATE margin_projects
SET title = CASE
  WHEN trim(goal) <> '' THEN substr(trim(goal), 1, 2000)
  ELSE 'Legacy Workstream ' || substr(id, 1, 200)
END
WHERE trim(title) = '';
`;

export const LEGACY_WORKSTREAM_TITLE_MIGRATION = Object.freeze({
  version: 5,
  name: 'legacy-workstream-title-backfill',
  sql,
  checksum: createHash('sha256').update(sql).digest('hex')
});
