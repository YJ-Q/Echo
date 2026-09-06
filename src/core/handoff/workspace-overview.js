import { readSessionMetaSource, sessionLabel } from './session-source.js';
import { buildEvidence } from './evidence.js';
import { refreshRepoTruth } from './repo-truth.js';
import { distill } from './distiller.js';
import { projectResumeSummary } from './resume-summary.js';

const unknown = (text) => ({ status: 'unknown', text });

function timestamp(value) {
  const result = new Date(value ?? 0).getTime();
  return Number.isNaN(result) ? 0 : result;
}

// This ordering is intentionally independent from the globally truncated
// Recent Sessions list. Id is the explicit deterministic tie-breaker.
export function selectLatestSession(sessions) {
  return [...sessions].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)
    || String(b.id).localeCompare(String(a.id)))[0] ?? null;
}

function repoDto(truth) {
  const git = truth?.git;
  return {
    observedAt: truth?.capturedAt ?? new Date().toISOString(),
    stableDuringObservation: Boolean(truth?.stableDuringObservation),
    branch: git?.status === 'available' ? git.branch : null,
    shortHead: git?.status === 'available' ? git.head?.slice(0, 12) ?? null : null,
    dirtyCount: git?.status === 'available' ? git.changes.length : null,
  };
}

// One-session, read-only projection. It intentionally does not construct a
// workspace task state or combine goals/progress/validation across sessions.
export function createWorkspaceOverview({ workspaceKey, workspaceName, sessions, readSource = readSessionMetaSource, refreshRepo = refreshRepoTruth }) {
  const latest = selectLatestSession(sessions);
  if (!latest) return null;
  const source = readSource(latest);
  const evidence = buildEvidence(source);
  const truth = refreshRepo(latest.cwd, evidence);
  const state = distill(evidence, truth);
  const summary = projectResumeSummary(state, truth);
  const progress = summary.progress?.[0] ?? { text: 'No source-backed progress available.', confidence: 'Unknown', temporalScope: 'unknown', kind: 'unknown' };
  return {
    workspaceKey,
    workspaceName,
    otherResumableSessionCount: Math.max(0, sessions.length - 1),
    latestSession: {
      id: latest.id,
      // Re-evaluate here so an old discovery cache's structural placeholder
      // label cannot survive into this new surface.
      label: sessionLabel(latest),
      updatedAt: latest.updatedAt ?? null,
      historicalBranch: latest.branch ?? null,
      goal: summary.goal,
      progress,
      currentApplicability: summary.currentApplicability ?? unknown('Current applicability is unknown.'),
    },
    repo: repoDto(truth),
  };
}
