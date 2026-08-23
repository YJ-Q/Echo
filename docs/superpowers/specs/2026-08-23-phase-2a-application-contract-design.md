# Margin Phase 2A Application Contract Design

状态：设计已确认，正式规格待用户审阅。日期：2026-08-23。

## 1. Scope and success criteria

Phase 2A 在现有 Persistent Core 上增加最小可执行 Contract，用来证明 Web、CLI、飞书、Scheduler 和未来 Worker 可以共享同一应用语义。

交付范围：

- Transport-neutral Application Gateway；
- DTO mapper 与运行时 validator；
- Command / Query definitions；
- Event Envelope、稳定 cursor 和 Activity projection；
- 最小 NeedsOwner 持久对象；
- CLI 对 Gateway 的最小迁移；
- contract tests、重启测试与架构文档。

明确不实现 HTTP Server、REST/GraphQL 部署层、React/Web UI、飞书 Adapter、Scheduler、Codex Worker、DeepSeek Harness 或完整审批平台。

成功标准：Surface 只持有 Gateway；Gateway 返回的数据在进程重启前后都来自同一个 Persistent Core；没有 Surface、Event 或 Activity shadow state；Contract 不导入 Pi 类型。

## 2. Component boundary

```text
Web / CLI / Feishu / Scheduler / Worker
                    |
             Surface Adapter
                    |
        MarginApplicationContract
          execute / query / events
          |        |        |
       Commands  Queries  Event cursor
                    |
          Application Services
                    |
        PersistentWorkRepository
                    |
     data/terminal-pilot/margin-core.sqlite

Pi / future Runtime Adapter
  <-> runtimeReference on Run only
```

文件职责：

- `src/contracts/contractTypes.js`：闭合 Command、Query、Event、状态与版本常量；
- `src/contracts/validation.js`：无第三方重框架的运行时输入/输出校验；
- `src/contracts/dtoMappers.js`：SQLite/domain objects 到冻结 DTO 的唯一映射；
- `src/contracts/eventEnvelope.js`：持久事件到安全 Event Envelope / Activity DTO 的映射；
- `src/application/marginApplicationContract.js`：唯一 `execute/query/events` Gateway；
- 现有 `src/application/*Service.js`：业务用例与授权，不感知 Surface；
- `src/core/persistentWorkRepository.js`：唯一 SQL 实现；
- `src/pilot/terminalPilotController.js`：CLI Adapter，只调用 Gateway 和治理工具。

Contract 层不保存状态，不缓存 aggregate，不打开数据库。

## 3. Contract context and response

### 3.1 InvocationContext

```js
{
  actor: {
    type: 'user' | 'agent' | 'system',
    subjectId: 'stable-subject-id'
  },
  surface: {
    kind: 'cli' | 'web' | 'feishu' | 'scheduler' | 'worker',
    instanceId: 'optional-stable-instance-id'
  },
  requestId: 'request-id',
  correlationId: 'cross-command-or-event-correlation-id',
  capabilities: ['run:control', 'workstream:write'],
  hostAuthority: OPAQUE_HOST_AUTHORITY
}
```

`hostAuthority` 是不可序列化、不导出的进程内引用，只能由可信宿主 Adapter 绑定，不能从 JSON/HTTP body 构造。Gateway 把 Context 转换为 Phase 1 Actor，并继续使用 `bindHostActor()`；仅声明 `actor.type='user'`、伪造同名字段或提供 `capabilities` 字符串不能获得 Run 控制权。Validator 校验可传输字段；authorization boundary 单独验证该引用身份。

Query 同样需要 Context，以便未来做主体隔离和审计，但 Phase 2A 只验证结构与已存在的单用户边界，不实现完整 RBAC。

### 3.2 Success

```js
{
  ok: true,
  data: {},
  meta: {
    contractVersion: '1.0',
    requestId: 'request-id',
    correlationId: 'correlation-id',
    auditId: 'optional-audit-id',
    stateVersion: 3
  }
}
```

### 3.3 Failure

```js
{
  ok: false,
  error: {
    code: 'version_conflict',
    retryable: false,
    details: { currentVersion: 4 }
  },
  meta: {
    contractVersion: '1.0',
    requestId: 'request-id',
    correlationId: 'correlation-id'
  }
}
```

稳定错误码至少包括：`invalid_request`、`permission_denied`、`capability_required`、`not_found`、`version_conflict`、`idempotency_conflict`、`invalid_transition`、`open_run_conflict`、`runtime_unavailable`、`storage_failure`。

错误 details 采用闭合、安全字段；不得返回 SQL、绝对隐私路径、凭据、prompt、模型正文或 stack。

## 4. Idempotency and optimistic concurrency

所有 mutation Command 包含：

```js
{
  type: 'run.pause',
  requestId: 'surface-request-id',
  idempotencyKey: 'stable-retry-key',
  expectedVersion: 4,
  payload: { runId: 'run-id' }
}
```

规则：

1. `requestId` 标识一次 Gateway 调用并进入 Audit；
   Command/Query 内的 `requestId` 必须与 Context 的 `requestId` 相同，否则返回 `invalid_request`；
2. `idempotencyKey` 标识一个可重试业务意图；
3. 同 `idempotencyKey + actor.subjectId + command.type + canonical payload` 返回首次成功结果，不重复 Runtime 或持久副作用；
4. 相同 key 携带不同 payload、command、Workstream scope 或主体返回 `idempotency_conflict`；
5. 修改已有 aggregate 必须提交 `expectedVersion`，不匹配返回 `version_conflict`；
6. SQLite 事务与 Phase 1 optimistic version 仍是唯一并发机制，不增加分布式锁。

Phase 2A 将 `idempotencyKey` 映射到现有 repository request-id replay 机制。Gateway `requestId` 保留为调用证据；若底层暂时只能接受一个键，则用 idempotencyKey 作为 Service request ID，并把 Gateway requestId/correlationId 写入 Audit metadata。Contract tests 必须证明重复 start/pause/resume/stop/checkpoint/artifact/resolve 不产生重复副作用。

## 5. DTO definitions

所有 DTO：

- 只使用 camelCase；
- 返回深冻结 plain object；
- 不包含 SQLite row、repository 方法或 Runtime 对象；
- nullable/optional 字段在 Contract 中固定，不由各 Surface 自行猜测；
- bounded arrays 在 mapper/validator 同时限制。

### 5.1 WorkstreamDTO

```js
{
  id, title, goal,
  status: 'running' | 'ready' | 'waiting' | 'watching' | 'blocked' | 'needs_owner' | 'paused' | 'completed',
  priority: 0,
  currentState: null,
  currentPlan: [],
  nextAction: null,
  blockers: [],
  autonomyLevel: 0,
  workspaceReference: { kind: 'local_path', path: 'scoped-reference' } | null,
  latestCheckpoint: CheckpointSummaryDTO | null,
  activeRun: RunSummaryDTO | null,
  version,
  updatedAt
}
```

`workspaceReference.path` 在 Phase 2A 只是已授权的引用，不授予文件能力。`priority` 和 `currentState` 通过 additive migration 成为 Persistent Core 字段，不由 UI 本地保存。

### 5.2 RunDTO

```js
{
  id,
  workstreamId,
  workerKind: 'pi' | 'codex' | 'other',
  runtimeReference: { kind: 'pi' | 'codex' | 'other', id: 'external-id' } | null,
  scope,
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'needs_owner' | 'cancelled',
  currentStep: null,
  progress: null,
  limits: {
    stopCondition: null,
    allowedActions: [],
    forbiddenActions: [],
    budget: null
  },
  result: null,
  validationSummary: null,
  error: null,
  checkpoint: CheckpointSummaryDTO | null,
  version,
  createdAt,
  updatedAt,
  startedAt,
  endedAt
}
```

Phase 2A 不增加 Worker-specific 配置表。现有 `runtime_kind` 映射为 `workerKind` 与 `runtimeReference.kind`；`runtime_session_id` 只能映射到 `runtimeReference.id`，绝不替代 Run ID。尚无持久字段的 `currentStep/progress/budget` 固定为 `null`，留给后续经独立 ADR 添加。

### 5.3 ArtifactDTO

```js
{
  id, workstreamId, runId,
  type, title,
  source: { createdBy, runtimeReference: null },
  resourceReference: { uri, contentHash },
  metadata: {},
  previewMetadata: {},
  version,
  createdAt,
  updatedAt
}
```

Contract 不读取 `uri` 指向的正文。若 Artifact 来自 Runtime，只暴露 `{ kind, id }` 形式的 `runtimeReference`；Surface 不用它读取 Pi Session，且数据库中的 `source_session_id` 不直接进入 DTO。

### 5.4 NeedsOwnerDTO

```js
{
  id,
  workstreamId,
  runId: null,
  type: 'decision' | 'approval' | 'input' | 'conflict',
  reason,
  options: [{ id, label, consequenceSummary: null }],
  consequenceSummary: null,
  contextSummary: null,
  status: 'open' | 'resolved' | 'cancelled',
  resolution: null,
  version,
  createdAt,
  resolvedAt: null
}
```

NeedsOwner 不包含聊天正文或隐藏推理。`reason/contextSummary` 是面向用户的安全摘要；options 最大 10 项。

### 5.5 DecisionDTO

```js
{
  id,
  workstreamId,
  decisionKey,
  content,
  rationale: null,
  status: 'active' | 'superseded' | 'revoked',
  supersededBy: null,
  source: { runtimeReference: null, sourceEventId: null },
  version,
  createdAt,
  updatedAt
}
```

Phase 2A 只为现有 Decision 提供安全 DTO、Query 与 Event 映射，不新增 Decision mutation Command。写入仍沿用已治理的 Core tool path，后续是否迁移为独立 Application Command 需另行收口。

### 5.6 CheckpointSummaryDTO

```js
{
  id, workstreamId, runId,
  runVersion, stateVersion, stateDigest,
  gitRef, note, createdBy, createdAt
}
```

## 6. Commands

所有命令形状为：

```js
{
  type,
  requestId,
  idempotencyKey,
  expectedVersion,
  payload
}
```

`expectedVersion` 仅在创建新 aggregate 时省略。

| Command | Payload | Required capability | Result |
| --- | --- | --- | --- |
| `workstream.create` | title, goal, scenario, priority?, currentPlan?, nextAction?, autonomyLevel?, workspaceReference? | `workstream:write` | WorkstreamDTO |
| `workstream.update` | workstreamId, changes | `workstream:write` | WorkstreamDTO |
| `run.create` | workstreamId, workerKind, scope, stopCondition?, allowedActions?, forbiddenActions? | `run:control` + host capability | RunDTO |
| `run.start` | runId | `run:control` + host capability | RunDTO |
| `run.pause` | runId | `run:control` + host capability | RunDTO |
| `run.resume` | runId | `run:control` + host capability | RunDTO |
| `run.stop` | runId | `run:control` + host capability | RunDTO |
| `checkpoint.create` | workstreamId, runId?, runVersion?, stateVersion, stateDigest, gitRef?, note? | `checkpoint:write` | CheckpointSummaryDTO |
| `artifact.create` | workstreamId, runId?, type, title, resourceReference, metadata?, previewMetadata? | `artifact:write` | ArtifactDTO |
| `needs_owner.create` | workstreamId, runId?, type, reason, options, consequenceSummary?, contextSummary? | `needs_owner:write` | NeedsOwnerDTO |
| `needs_owner.resolve` | needsOwnerId, optionId?, resolutionSummary? | `needs_owner:resolve` | NeedsOwnerDTO |

Phase 2A 不提供通用 CRUD、任意 patch、SQL filter 或 Runtime-specific command。

## 7. Queries

Query 形状：

```js
{ type, requestId, payload }
```

| Query | Payload | Required capability | Result |
| --- | --- | --- | --- |
| `workstream.list` | statuses?, limit?, cursor? | `workstream:read` | `{ items: WorkstreamDTO[], nextCursor }` |
| `workstream.get` | workstreamId | `workstream:read` | WorkstreamDTO |
| `run.get` | runId | `run:read` | RunDTO |
| `run.list` | workstreamId, statuses?, limit?, cursor? | `run:read` | `{ items: RunDTO[], nextCursor }` |
| `artifact.list` | workstreamId, runId?, limit?, cursor? | `artifact:read` | `{ items: ArtifactDTO[], nextCursor }` |
| `decision.list` | workstreamId, statuses?, limit?, cursor? | `decision:read` | `{ items: DecisionDTO[], nextCursor }` |
| `needs_owner.list` | workstreamId?, runId?, statuses?, limit?, cursor? | `needs_owner:read` | `{ items: NeedsOwnerDTO[], nextCursor }` |
| `activity.list` | workstreamId, afterCursor?, limit? | `activity:read` | `{ items: ActivityDTO[], nextCursor }` |
| `checkpoint.latest` | workstreamId, runId? | `checkpoint:read` | CheckpointSummaryDTO \| null |

列表默认 limit 50，最大 100。Phase 2A 的 aggregate 列表 cursor 可使用稳定 `(updatedAt,id)` 编码；只有 Event/Activity cursor 必须使用全局单调 sequence。

## 8. Event Envelope and cursor

### 8.1 Envelope

```js
{
  cursor: 101,
  eventId,
  eventType,
  aggregateType: 'workstream' | 'run' | 'artifact' | 'checkpoint' | 'needs_owner' | 'decision',
  aggregateId,
  aggregateVersion,
  workstreamId,
  runId: null,
  occurredAt,
  actor: { type, subjectId: null },
  source: {
    kind: 'application' | 'runtime' | 'surface' | 'system',
    surfaceKind: null,
    runtimeReference: null,
    correlationId: null
  },
  summary,
  data: {},
  contractVersion: '1.0'
}
```

### 8.2 Event types

- `workstream.created`
- `workstream.updated`
- `run.created`
- `run.started`
- `run.progressed`
- `run.paused`
- `run.resumed`
- `run.stopped`
- `run.completed`
- `run.failed`
- `checkpoint.created`
- `artifact.created`
- `decision.created`
- `decision.superseded`
- `decision.revoked`
- `needs_owner.created`
- `needs_owner.resolved`
- `needs_owner.cancelled`

未知内部事件不会原样透传，也不动态生成 Event Type。Mapper 只按明确白名单把已知 legacy Workstream/Run 事件映射到上述类型；无法安全、确定映射的记录不进入 Surface stream，并写入结构化诊断。Phase 2A 新写入的 Run transition event payload 必须记录 command/status，使 pause/resume/stop 可以确定映射。

### 8.3 Stable cursor

现有 `margin_events.id` 是文本 ID，`created_at` 可能重复，均不能作为 cursor。Migration 004 增加：

```sql
CREATE TABLE margin_event_cursors (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES margin_events(id)
);
```

迁移按现有 `margin_events.rowid` 顺序一次性回填；之后通过数据库 trigger 在插入 event 的同一事务内分配 sequence。读取使用 `sequence > afterCursor ORDER BY sequence ASC LIMIT ?`。

`margin_event_cursors` 只保存 event ID 与 sequence，不复制 event payload，不是第二 Event Log。`margin_events` 仍是事实记录；Persistent aggregate tables 仍是当前状态 Source of Truth。

### 8.4 events query

```js
events({
  type: 'event.list',
  requestId,
  payload: { afterCursor: 100, workstreamId: null, eventTypes: [], limit: 50 }
}, context)
```

`event.list` 要求 `event:read` capability；Contract validator 同样要求其 `requestId` 与 Context 一致。

返回：

```js
{
  ok: true,
  data: { items: [EventEnvelope], nextCursor: 101, hasMore: false },
  meta: { contractVersion: '1.0', requestId, correlationId }
}
```

空结果保留调用方传入 cursor。重复读取相同 cursor 得到同一有序前缀；重启不改变 sequence。

## 9. Activity projection

ActivityDTO 直接由 EventEnvelope 派生：

```js
{
  cursor,
  type,
  workstreamId,
  runId,
  title,
  summary,
  status: null,
  occurredAt,
  artifactReference: null,
  needsOwnerId: null
}
```

禁止新增 `margin_activity` 表。Activity mapper 使用闭合模板生成用户可理解摘要；不使用模型自由生成文字，不包含 prompt、工具原始参数、Chain-of-Thought 或 Runtime 私有消息。

## 10. Minimal persistence model

Migration 004 仅做 additive 变更：

```text
margin_projects
  + priority INTEGER NOT NULL DEFAULT 0
  + current_state TEXT

margin_artifacts
  + metadata TEXT NOT NULL DEFAULT '{}'
  + preview_metadata TEXT NOT NULL DEFAULT '{}'

margin_needs_owner
  id, workstream_id, run_id, type, reason, options,
  consequence_summary, context_summary, status, resolution,
  version, source_session_id, source_event_id,
  created_at, updated_at, resolved_at

margin_event_cursors
  sequence, event_id
```

JSON 字段采用 bounded object/list validator。NeedsOwner 的 create/resolve 使用 request-ID idempotency、optimistic version、Event 和 Audit，并与 Workstream/Run 做跨引用校验。

这些字段是产品已冻结 DTO 所必需的最小增量，不增加 DayPlan、Scheduler、Workspace 或 Worker 配置表。

## 11. Gateway routing

`createMarginApplicationContract({ services, eventReader, runtimeControl, authorization })` 返回：

```js
{
  execute(command, context),
  query(query, context),
  events(query, context)
}
```

Gateway 使用闭合 dispatch map；未知 type 返回 `invalid_request`。执行顺序：

1. validate Context；
2. validate Command/Query；
3. authorize capability；
4. map Contract input to Service input；
5. invoke Application Service；
6. map result to DTO；
7. validate and deep-freeze response；
8. return stable envelope。

Gateway 不 catch-and-hide `version_conflict`、`idempotency_conflict` 或 Runtime failure；它将其转换为稳定 Contract error。

## 12. Surface reuse

- CLI：通过 Gateway 查询 Workstream/Run、执行 Run control 和 checkpoint；终端命令解析与展示保持在 CLI Adapter。
- Web：未来 HTTP Adapter 只做身份验证、JSON parse/serialize 和 Gateway 调用，不读取数据库。
- Feishu：未来 Adapter 验签和绑定用户后构造 Context；不需要 Pi，也不保存 Workstream 状态。
- Scheduler：Phase 2A 只验证 scheduler-shaped Context 能表达、查询 Command；`run.start` 等控制仍沿用 Phase 1 宿主授权，未绑定既有可信 Authority 时必须拒绝。是否允许 system actor 无人执行留到 Scheduler 阶段单独授权，不在本阶段扩权。
- Worker：通过 Runtime Adapter 获得 Run scope，写回 Result/Artifact/Event；不能持有 Workstream 真相副本。

## 13. Contract validation

Phase 2A 使用手写、可组合 validator，避免新增大型 schema framework。每个 validator 返回规范化冻结值或抛出带稳定 code 的 `ContractValidationError`。

验证包括：

- closed object keys；
- string 长度与 bounded arrays；
- ID/request/correlation 非空；
- enum；
- integer version/cursor/limit；
- Artifact metadata 最大序列化字节数；
- Event data 按 eventType 使用闭合 mapper；
- DTO 不含 snake_case key、函数、Buffer、Error 或 Runtime object；
- 输出递归扫描敏感字段名：`chainOfThought`、`reasoning`、`prompt`、`apiKey`、`sessionObject`。

不把源码中的普通 `reason` 字段误判为隐藏推理；NeedsOwner `reason` 是用户可见业务说明。

## 14. Verification matrix

| Requirement | Contract test |
| --- | --- |
| CLI 继续工作 | controller 使用 Gateway fake/real contract，不访问 services/repository |
| Web 不访问 DB | web-shaped caller 只持有 `execute/query/events` |
| Feishu 不知道 Pi | feishu-shaped Context 与 DTO 中无 Pi import/object |
| Scheduler 可表达 Run | scheduler-shaped Context 可 create/query；无 host capability 时 start 被拒 |
| Runtime ID 分离 | `run.id !== runtimeReference.id`，DTO 无 `runtime_session_id` |
| 查询治理 | 缺少对应 read capability 的 Query/Event 在读取 repository 前被拒绝 |
| Restart 权威状态 | 关闭/re开 Core 后 Gateway 返回同一 IDs/version/checkpoint/NeedsOwner |
| 无 shadow state | Contract/Gateway 无 DB handle、cache、aggregate map；Activity 无表 |
| 幂等 | 同 key 同 command 只产生一次 Event/Audit/副作用；冲突重用被拒 |
| 乐观并发 | stale expectedVersion 返回 `version_conflict` |
| Event 顺序 | 同时刻多 event、重启、分页后 cursor 连续且无重漏 |
| 隐私 | Event/Activity/DTO 不含隐藏推理、prompt、凭据或 Runtime object |

完整回归继续要求：`npm test`、`npm run validate:stage1`、`npm run audit:pi`、`git diff --check`。

YAPI Live Pi command 仍是 Known Validation Gap；Phase 2A 不伪造或绕过，在依赖 Live Runtime 的 Web E2E 前必须补测。

## 15. Phase 2B minimum plan boundary

Phase 2B 只在本 Contract 通过后开始：

1. 选择并记录 Web stack；
2. 增加很薄的 HTTP Adapter；
3. 实现 Workstream list/detail 与 Run controls；
4. 实现基于 Event cursor 的 Activity 更新；
5. 实现三栏 Workbench 最小界面；
6. 不加入飞书、Scheduler、Workspace 编辑或多 Agent UI。

Phase 2B 不得绕过 Gateway，不得在浏览器保存权威 Workstream/Run 状态。
