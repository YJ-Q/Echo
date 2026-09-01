export function createResumeBriefService({ repository, memories, clock }) {
  function workstreamEvidence(reason) {
    return [{ aggregateType: 'workstream', reason }];
  }
  function needsOwnerEvidence(no) {
    return [{ aggregateType: 'needsOwner', aggregateId: no.id, aggregateVersion: no.version, reason: 'ownerDecisionRequired' }];
  }
  function recommendation(action, evidence, kind = 'primary') {
    return { id: `rec-${Date.now()}`, kind, action, hypothesis: null, evidence };
  }
  function primaryRecommendation({ needsOwner, blockers, nextAction, currentPlan, title }) {
    if (needsOwner[0]) return recommendation(`Resolve: ${needsOwner[0].reason}`, needsOwnerEvidence(needsOwner[0]));
    if (blockers[0]) return recommendation(`Address blocker: ${blockers[0]}`, workstreamEvidence('blocker'));
    if (nextAction) return recommendation(nextAction, workstreamEvidence('nextAction'));
    if (currentPlan[0]) return recommendation(currentPlan[0], workstreamEvidence('currentPlan'));
    return recommendation(`Define the next action for ${title}`, workstreamEvidence('missingNextAction'));
  }

  return Object.freeze({
    async get({ workstreamId }) {
      const ws = await repository.getWorkstream(workstreamId);
      if (!ws) { const err = new Error('Workstream not found'); err.code = 'not_found'; throw err; }

      const currentPlan = (() => { try { return Array.isArray(ws.currentPlan) ? ws.currentPlan : JSON.parse(ws.currentPlan ?? '[]'); } catch { return []; } })();
      const blockers = (() => { try { return Array.isArray(ws.blockers) ? ws.blockers : JSON.parse(ws.blockers ?? '[]'); } catch { return []; } })();

      const openRun = await repository.findOpenRun(workstreamId);
      const checkpoint = openRun
        ? await repository.latestCheckpoint(openRun.id)
        : await repository.latestCheckpointFor({ workstreamId });

      const needsOwnerItems = await repository.listNeedsOwner ? await repository.listNeedsOwner({ workstreamId, statuses: ['open'], limit: 5 }) : { items: [] };
      const needsOwner = needsOwnerItems.items ?? [];

      const decisionsResult = await repository.listDecisions({ workstreamId, statuses: ['confirmed'], limit: 10 });
      const decisions = decisionsResult.items ?? [];

      const memoriesResult = memories
        ? await memories.search({ workstreamId, query: ws.goal ?? '', includeArchive: false, limit: 10 })
        : await repository.listMemories({ workstreamId, lifecycleStatuses: ['active'], limit: 10 });
      const memoryItems = (memoriesResult.items ?? []).filter((m) => m.confirmation_status === 'confirmed' || m.lifecycleStatus === 'active');

      const recentEvents = await repository.listRecentEventRows(workstreamId, 20);

      const primary = primaryRecommendation({
        needsOwner,
        blockers,
        nextAction: ws.next_action ?? ws.nextAction ?? null,
        currentPlan,
        title: ws.title
      });

      return {
        workstreamId,
        generatedAt: clock(),
        facts: {
          goal: ws.goal,
          currentState: ws.current_state ?? ws.currentState ?? null,
          currentPlan,
          nextAction: ws.next_action ?? ws.nextAction ?? null,
          blockers
        },
        run: openRun ?? null,
        checkpoint: checkpoint ?? null,
        needsOwner,
        decisions,
        memories: memoryItems,
        recentActivity: recentEvents.slice(0, 20).map((e) => ({ id: e.id, entityType: e.entity_type, eventType: e.event_type, createdAt: e.created_at })),
        recommendations: [primary],
        sourceVersions: [{ aggregateType: 'workstream', aggregateId: workstreamId, aggregateVersion: ws.version }]
      };
    }
  });
}
