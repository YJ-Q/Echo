import fs from 'node:fs';
import { createHash } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Pi sessions are append-only JSONL: a `session` header, then message / model_change /
// thinking_level_change / compaction / branch_summary / label records. This reader only
// materializes the frozen, hash-verified physical lines so provenance line numbers are
// preserved and the capture is the single source of truth. Canonical Pi entry semantics
// (typing, active branch, compaction) are owned by the Pi SDK inside buildPiEvidence — this
// boundary deliberately does not hand-roll a Pi tree/parser.
export function readPiSessionSource(capture) {
  if (!capture?.snapshotPath || !capture?.sha256) throw new Error('Pi session source required: { records, capture, session }');
  const raw = fs.readFileSync(capture.snapshotPath);
  if (sha256(raw) !== capture.sha256) throw new Error('Snapshot hash mismatch; re-capture with refreshSnapshot=true');
  const text = raw.toString('utf8');
  const records = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    records.push({ line: i + 1, event: JSON.parse(line) });
  }
  return { records, capture, session: { cwd: capture.cwd ?? '' }, content: text };
}