import { CoreContractError, digestInput } from './contracts.js';

const json = (value) => JSON.stringify(value ?? []);

export function createPersistentWorkRepository(store) {
  const evidence = async (tx, { operation, requestId, actor, workstreamId, entityType, entityId, version, eventType, input }) => {
    const auditId = store.idFactory('audit');
    const now = store.clock();
    await tx.run(
      `INSERT INTO margin_events
       (id,entity_type,entity_id,project_id,event_type,entity_version,payload,source_session_id,source_event_id,created_at)
       VALUES (?,?,?,?,?,?,?, ?,?,?)`,
      store.idFactory('event'), entityType, entityId, workstreamId, eventType, version, '{}', actor.sourceSessionId, actor.sourceEventId, now
    );
    await tx.run(
      `INSERT INTO margin_audit_log
       (id,operation,request_id,actor_type,project_id,entity_type,entity_id,permission_decision,result_code,input_digest,metadata,created_at)
       VALUES (?,?,?,?,?,?,?,'allowed','allowed',?,'{}',?)`,
      auditId, operation, requestId, actor.actorType, workstreamId, entityType, entityId, digestInput(input), now
    );
    return auditId;
  };

  const replay = async (tx, operation, requestId, table) => {
    const audit = await tx.get("SELECT id, entity_id FROM margin_audit_log WHERE operation=? AND request_id=? AND result_code='allowed' ORDER BY created_at LIMIT 1", operation, requestId);
    if (!audit) return null;
    return { auditId: audit.id, data: await tx.get(`SELECT * FROM ${table} WHERE id=?`, audit.entity_id) };
  };

  return {
    getWorkstream: async (id) => mapWorkstream(await store.db.get('SELECT * FROM margin_projects WHERE id=? AND deleted_at IS NULL', id)),
    listWorkstreams: async () => Promise.all((await store.db.all('SELECT * FROM margin_projects WHERE deleted_at IS NULL ORDER BY updated_at DESC,id')).map(mapWorkstream)),
    createWorkstream: (input, actor) => store.transaction(async (tx) => {
      const prior = await replay(tx, 'workstream_create', input.requestId, 'margin_projects');
      if (prior) return { ...prior, data: mapWorkstream(prior.data) };
      const id = store.idFactory('workstream');
      const now = store.clock();
      await tx.run(
        `INSERT INTO margin_projects
         (id,scenario,goal,phase,status,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,
          title,workstream_status,current_plan,next_action,blockers,dependencies,workspace_path,autonomy_level,artifact_refs,last_checkpoint_id)
         VALUES (?,?,?,'v1','active',1,?,?,?, ?,NULL,?,'running','[]',NULL,'[]','[]',?,?,'[]',NULL)`,
        id, input.scenario, input.goal, actor.sourceSessionId, actor.sourceEventId, now, now,
        input.title, input.workspacePath ?? null, input.autonomyLevel ?? 0
      );
      const auditId = await evidence(tx, { operation: 'workstream_create', requestId: input.requestId, actor, workstreamId: id, entityType: 'workstream', entityId: id, version: 1, eventType: 'created', input });
      return { data: mapWorkstream(await tx.get('SELECT * FROM margin_projects WHERE id=?', id)), auditId };
    }),
    createRun: (input, actor) => store.transaction(async (tx) => {
      const prior = await replay(tx, 'run_create', input.requestId, 'margin_runs');
      if (prior) return prior;
      const workstream = await tx.get('SELECT id FROM margin_projects WHERE id=? AND deleted_at IS NULL', input.workstreamId);
      if (!workstream) throw new CoreContractError('workstream_not_found', 'Workstream not found');
      if (await tx.get("SELECT id FROM margin_runs WHERE workstream_id=? AND status IN ('queued','running','paused','needs_owner')", input.workstreamId)) {
        throw new CoreContractError('open_run_exists', 'An open Run already exists');
      }
      const id = store.idFactory('run');
      const now = store.clock();
      await tx.run(
        `INSERT INTO margin_runs
         (id,workstream_id,runtime_kind,runtime_session_id,scope,status,stop_condition,allowed_actions,forbidden_actions,files_changed,
          validation,result,error,checkpoint_id,version,source_session_id,source_event_id,created_at,updated_at,started_at,ended_at)
         VALUES (?,?,?,?,?,'queued',?,?,?,'[]',NULL,NULL,NULL,NULL,1,?,?,?, ?,NULL,NULL)`,
        id, input.workstreamId, input.runtimeKind, input.runtimeSessionId ?? null, input.scope, input.stopCondition ?? null,
        json(input.allowedActions), json(input.forbiddenActions), actor.sourceSessionId, actor.sourceEventId, now, now
      );
      const auditId = await evidence(tx, { operation: 'run_create', requestId: input.requestId, actor, workstreamId: input.workstreamId, entityType: 'run', entityId: id, version: 1, eventType: 'created', input });
      return { data: await tx.get('SELECT * FROM margin_runs WHERE id=?', id), auditId };
    }),
    getRun: (id) => store.db.get('SELECT * FROM margin_runs WHERE id=?', id),
    createArtifact: (input, actor) => store.transaction(async (tx) => {
      const prior = await replay(tx, 'artifact_create', input.requestId, 'margin_artifacts');
      if (prior) return prior;
      const run = input.runId ? await tx.get('SELECT workstream_id FROM margin_runs WHERE id=?', input.runId) : null;
      if (input.runId && (!run || run.workstream_id !== input.workstreamId)) throw new CoreContractError('cross_workstream_reference', 'Run belongs to another Workstream');
      const id = store.idFactory('artifact'); const now = store.clock();
      await tx.run(`INSERT INTO margin_artifacts VALUES (?,?,?,?,?,?,?,?,1,?,?,?, ?,NULL)`,
        id,input.workstreamId,input.runId ?? null,input.type,input.title,input.uri,input.contentHash,actor.actorType,actor.sourceSessionId,actor.sourceEventId,now,now);
      const auditId = await evidence(tx,{operation:'artifact_create',requestId:input.requestId,actor,workstreamId:input.workstreamId,entityType:'artifact',entityId:id,version:1,eventType:'created',input});
      return {data:await tx.get('SELECT * FROM margin_artifacts WHERE id=?',id),auditId};
    }),
    createCheckpoint: (input, actor) => store.transaction(async (tx) => {
      const prior = await replay(tx, 'checkpoint_create', input.requestId, 'margin_checkpoints');
      if (prior) return prior;
      const run = input.runId ? await tx.get('SELECT workstream_id FROM margin_runs WHERE id=?',input.runId) : null;
      if (input.runId && (!run || run.workstream_id !== input.workstreamId)) throw new CoreContractError('cross_workstream_reference','Run belongs to another Workstream');
      const id=store.idFactory('checkpoint'); const now=store.clock();
      await tx.run(`INSERT INTO margin_checkpoints VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,id,input.workstreamId,input.runId ?? null,input.runVersion ?? null,input.stateVersion,input.stateDigest,input.gitRef ?? null,input.note ?? '',actor.actorType,actor.sourceSessionId,actor.sourceEventId,now);
      await tx.run('UPDATE margin_projects SET last_checkpoint_id=?,updated_at=? WHERE id=?',id,now,input.workstreamId);
      const auditId=await evidence(tx,{operation:'checkpoint_create',requestId:input.requestId,actor,workstreamId:input.workstreamId,entityType:'checkpoint',entityId:id,version:1,eventType:'created',input});
      return {data:await tx.get('SELECT * FROM margin_checkpoints WHERE id=?',id),auditId};
    }),
    latestCheckpoint: (runId) => store.db.get('SELECT * FROM margin_checkpoints WHERE run_id=? ORDER BY created_at DESC,id DESC LIMIT 1',runId)
  };
}

function mapWorkstream(row) {
  if (!row) return null;
  return { ...row, status: row.workstream_status, currentPlan: JSON.parse(row.current_plan), blockers: JSON.parse(row.blockers), dependencies: JSON.parse(row.dependencies), artifactRefs: JSON.parse(row.artifact_refs) };
}
