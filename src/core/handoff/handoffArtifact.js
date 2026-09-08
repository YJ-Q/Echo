import path from 'node:path';
import { createHash } from 'node:crypto';

// A canonical session id is an application identity, not a path component. In
// particular, Codex identities contain `:` which Windows rejects in filenames.
// Keep the original id in the capture provenance and use this opaque stable key
// only for the regenerable on-disk snapshot.
export function snapshotPathForCanonicalSession(rootDir, canonicalId) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('invalid_handoff_root');
  if (typeof canonicalId !== 'string' || !canonicalId.trim()) throw new TypeError('invalid_canonical_session_id');
  const key = createHash('sha256').update(canonicalId, 'utf8').digest('hex');
  return path.join(rootDir, 'handoff-output', 'web-sessions', `session-${key}.jsonl`);
}

// A generation has exactly one immutable result. Consumers may copy its
// markdown or save that same string, but must never regenerate while saving.
// Freshness is explicit here (rather than inferred from a sidecar or mtime): a
// user-triggered generation always freezes the complete native JSONL prefix at
// the moment this function runs.
export function createHandoffArtifact({ session, canonicalId, rootDir, workspace, captureSession, generateHandoff }) {
  if (!session?.originalPath) throw new TypeError('invalid_handoff_session_source');
  if (typeof captureSession !== 'function' || typeof generateHandoff !== 'function') throw new TypeError('invalid_handoff_artifact_dependencies');
  const id = canonicalId ?? session.canonicalId;
  const snapshotPath = snapshotPathForCanonicalSession(rootDir, id);
  const capture = captureSession(session, snapshotPath, { refreshSnapshot: true });
  const generated = generateHandoff(capture, workspace);
  return Object.freeze({
    canonicalId: id,
    capture: Object.freeze({ ...capture }),
    markdown: generated.markdown,
    resumeSummary: generated.resumeSummary,
  });
}
