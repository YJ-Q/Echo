import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = s => s.replaceAll('\r\n', '\n').trimEnd();
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

export function observeFile(workspace, requested) {
  const absolute = path.resolve(workspace, requested);
  if (!inside(workspace, absolute)) return { path: absolute, status: 'out-of-scope', confidence: 'Uncertain' };
  try {
    const real = fs.realpathSync(absolute);
    if (!inside(fs.realpathSync(workspace), real)) return { path: absolute, status: 'external-symlink', confidence: 'Uncertain' };
    const stat = fs.statSync(real);
    if (!stat.isFile()) return { path: absolute, status: 'not-file', confidence: 'Uncertain' };
    if (stat.size > 4 * 1024 * 1024) return { path: absolute, status: 'too-large', bytes: stat.size, confidence: 'Uncertain' };
    const bytes = fs.readFileSync(real);
    return { path: absolute, status: 'exists', confidence: 'Confirmed', bytes: bytes.length,
      sha256: sha256(bytes), modifiedAt: stat.mtime.toISOString(), text: bytes.toString('utf8') };
  } catch (error) { return { path: absolute, status: error.code === 'ENOENT' ? 'missing' : 'unreadable',
    confidence: error.code === 'ENOENT' ? 'Confirmed' : 'Uncertain', errorCode: error.code }; }
}

function gitState(workspace) {
  const git = args => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
    cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  });
  try {
    const head = git(['rev-parse', 'HEAD']).trim();
    let branch = null; try { branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim(); } catch { /* detached */ }
    const fields = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
    const changes = [];
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i]) continue;
      const entry = { status: fields[i].slice(0, 2), path: fields[i].slice(3) };
      if (/[RC]/.test(entry.status)) entry.from = fields[++i];
      changes.push(entry);
    }
    return { status: 'available', branch, head, changes };
  } catch (error) { return { status: 'unavailable', errorCode: error.code ?? error.status, confidence: 'Uncertain' }; }
}

export function refreshRepoTruth(workspace, evidence, artifactPaths = []) {
  workspace = path.resolve(workspace);
  const startedAt = new Date().toISOString(), gitBefore = gitState(workspace);
  // A structured edit is the only source that can make a file an historical
  // reconciliation target. Git changes and assistant prose remain general repo
  // state, never target provenance.
  const structuredTargets = evidence.operations.flatMap(operation => (operation.edits || [])
    .map((edit, editIndex) => {
      const requestedPath = edit.moveTo || edit.path;
      if (!requestedPath) return null;
      return { operationId: operation.id, editIndex, path: path.resolve(workspace, requestedPath),
        historicalPath: edit.path, currentPath: requestedPath, evidence: operation.evidence ?? [] };
    }).filter(Boolean));
  const requested = [...new Set([...evidence.operations.flatMap(o => (o.edits || []).flatMap(e => [e.path, e.moveTo].filter(Boolean))), ...artifactPaths])];
  const inspected = requested.map(p => observeFile(workspace, p));
  const files = inspected.map(({ text, ...f }) => {
    const id = `file:${path.relative(workspace, f.path).replaceAll('\\', '/')}`;
    const targetProvenance = structuredTargets.filter(target => target.path === f.path)
      .map(({ path: _path, ...target }) => ({ ...target, fileEvidenceId: id }));
    return { ...f, id, ...(targetProvenance.length ? { targetProvenance } : {}) };
  });
  const patchChecks = [];
  for (const op of evidence.operations) for (const edit of op.edits || []) {
    const f = inspected.find(f => f.path === path.resolve(workspace, edit.moveTo || edit.path));
    const n = normalized(f?.text || '');
    const exactAdd = edit.action === 'add' && f?.status === 'exists' && n === normalized(edit.added.join('\n'));
    const addedLines = edit.added.filter(x => x.trim());
    const additionsPresent = addedLines.length > 0 && f?.status === 'exists'
      && addedLines.every(l => n.split('\n').includes(l));
    patchChecks.push({ operationId: op.id, path: f?.path, fileEvidenceId: files.find(x => x.path === f?.path)?.id,
      currentStatus: f?.status, exactAdd: Boolean(exactAdd), additionsPresent: Boolean(additionsPresent),
      confidence: f?.confidence ?? 'Uncertain',
      meaning: exactAdd ? 'Current file equals proposed add content' : additionsPresent
        ? 'Added lines are present now; order, ownership and full historical patch success are not proven'
        : 'Current file does not establish the historical proposed content; may have changed since' });
  }
  const artifactReports = inspected.filter(f => artifactPaths.some(p => path.resolve(workspace, p) === f.path)).map(f => {
    let report; try { report = JSON.parse(f.text); } catch { /* non-JSON artifact */ }
    return { fileEvidenceId: files.find(x => x.path === f.path)?.id, path: f.path,
      ...(Number.isInteger(report?.passed) ? { reportedPasses: report.passed, reportedAt: report.checkedAt,
        sourceHashMatches: report.sourceSnapshotSha256 === evidence.source.sha256,
        assertionScope: 'Stored report claim only; not a fresh test of current code' } : {}) };
  });
  const gitAfter = gitState(workspace);
  const stableFiles = files.every(f => {
    const current = observeFile(workspace, f.path);
    return f.status === current.status && f.sha256 === current.sha256;
  });
  const stableDuringObservation = JSON.stringify(gitBefore) === JSON.stringify(gitAfter) && stableFiles;
  if (!stableDuringObservation) files.forEach(f => { f.confidence = 'Uncertain'; });
  return { schemaVersion: 'margin.repo-truth.v1', workspace, startedAt, capturedAt: new Date().toISOString(),
    git: gitAfter, stableDuringObservation,
    scope: 'Current independent observation. Not an attribution of all dirty files to the source Session.',
    targetLinkage: structuredTargets.length
      ? { status: 'available', scope: 'Structured historical edit targets linked to their current file observations', count: structuredTargets.length }
      : { status: 'unknown', scope: 'No structured repo targets available for reconciliation', count: 0 },
    files, patchChecks, artifactReports };
}
