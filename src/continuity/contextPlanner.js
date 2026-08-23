import { digestInput } from '../core/contracts.js';

export class ContinuityPlanError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContinuityPlanError';
    this.code = code;
  }
}

function sourceEntry({ sourceType, entityType, entity, reason, content }) {
  return {
    sourceType,
    entityType,
    entityId: entity.id,
    version: entity.version ?? null,
    sourceSessionId: entity.source_session_id ?? entity.sourceSessionId ?? null,
    reason,
    content
  };
}

function buildOrderedCandidates(snapshot) {
  const candidates = [
    sourceEntry({
      sourceType: 'margin_project', entityType: 'project', entity: snapshot.project,
      reason: 'active_project', content: snapshot.project.goal
    })
  ];
  if (snapshot.activeTask) {
    candidates.push(sourceEntry({
      sourceType: 'margin_task', entityType: 'task', entity: snapshot.activeTask,
      reason: 'active_task', content: snapshot.activeTask.current_step
    }));
  }
  for (const decision of snapshot.decisions) {
    candidates.push(sourceEntry({
      sourceType: 'margin_decision', entityType: 'decision', entity: decision,
      reason: 'confirmed_decision', content: decision.content
    }));
  }
  for (const memory of snapshot.memories) {
    candidates.push(sourceEntry({
      sourceType: 'margin_memory', entityType: 'memory', entity: memory,
      reason: 'confirmed_memory', content: memory.content
    }));
  }
  for (const dialogue of snapshot.recentDialogue) {
    candidates.push(sourceEntry({
      sourceType: 'pi_recent_dialogue', entityType: 'dialogue', entity: dialogue,
      reason: 'recent_dialogue', content: dialogue.content
    }));
  }
  return candidates;
}

export function planContinuityContext(snapshot, { maxItems = 8 } = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    throw new ContinuityPlanError('invalid_context_budget');
  }
  const candidates = buildOrderedCandidates(snapshot);
  const selected = candidates.slice(0, maxItems);
  const excluded = candidates.slice(maxItems).map(({ entityId, sourceType }) => ({
    entityId, sourceType, reason: 'item_budget_exceeded'
  }));
  return {
    projectId: snapshot.project.id,
    selected,
    excluded,
    digest: digestInput({ selected, excluded })
  };
}
