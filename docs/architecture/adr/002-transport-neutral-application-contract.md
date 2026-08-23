# ADR 002：Transport-neutral Application Contract

状态：Phase 2A 设计已确认，待规格审阅后实施。日期：2026-08-23。

## Context

Phase 1 已固定 Persistent Margin Core、Workstream / Run 状态语义与 Pi Runtime Adapter。下一阶段的 Web Workbench、飞书、CLI、Scheduler 和 Worker 都必须复用同一 Application Core，不能各自读取 SQLite、依赖 Pi 类型或建立 shadow state。

Phase 2A 不实现 HTTP Server、Web UI、飞书、Scheduler 或新 Worker，只冻结并验证这些调用方共同依赖的应用契约。

## Decision

采用 Transport-neutral Application Gateway：

```text
Surface / Worker Adapter
  -> MarginApplicationContract
       -> execute(command, context)
       -> query(query, context)
       -> events(query, context)
  -> Application Services
  -> Persistent Repository
  -> canonical Margin SQLite
```

Gateway 接受闭合的 Command / Query，返回经过显式映射和校验的 DTO。任何 Surface 不得获取 repository、SQLite row、Pi Session 对象或 Runtime 私有事件。

当前仓库采用 JavaScript ESM。Phase 2A 使用显式运行时 validator 和 JSDoc 契约，不为 Contract 单独迁移 TypeScript，也不引入大型 schema framework。

当前状态继续以 Persistent Core Domain State 为唯一 Source of Truth。Event Log 是 append-only factual history 与 integration stream；Activity 是 Event DTO 的派生视图，不新增 Activity 表，也不采用完整 Event Sourcing。

## Contract rules

- Mutation Command 必须携带 `requestId`；可重试副作用还必须携带稳定 `idempotencyKey`。同键同输入重放原结果，同键不同输入或主体返回 `idempotency_conflict`。
- 修改既有 aggregate 的 Command 必须携带 `expectedVersion`；陈旧版本返回 `version_conflict`。
- 调用 Context 必须包含 Actor、Surface、Correlation 和 Capability 信息。Phase 1 的宿主 Authority 由可信 Adapter 在进程内绑定，不能从传输数据反序列化；Gateway 不能绕过该边界或工具治理。
- Event cursor 使用 SQLite 持久、单调递增 sequence，不从 timestamp、eventId 或发生时间推导。
- Margin aggregate ID 是主标识；Pi / Codex 等 ID 只出现在 `runtimeReference`。
- DTO 只保存 Artifact 引用、metadata 和 preview metadata，不传输大文件正文。
- Activity、Event 和错误响应禁止包含 Chain-of-Thought、隐藏推理、Pi 原始 Session 或内部异常堆栈。

## Minimal persistence increment

Phase 2A 允许一个 additive migration：

- 为 Workstream 增加 `priority` 与 `current_state`；
- 为 Artifact 增加 bounded `metadata` 与 `preview_metadata`；
- 增加最小 `margin_needs_owner` 表；
- 增加只负责给现有 `margin_events` 分配稳定 sequence 的 cursor index/table 与事务内触发器。

cursor index 不是第二份 Event Log；它只把 sequence 映射到现有 event ID。NeedsOwner 是一等应用对象，不从聊天消息推导。

## Alternatives

- HTTP/OpenAPI-first：拒绝。Phase 2A 不实现网络传输，而且传输协议不应塑造 Core。
- 直接向 Surface 暴露现有 Services：拒绝。会泄漏 SQLite snake_case row、Runtime Control 和内部组合方式，并迫使每个 Surface 重复映射。
- 完整 Event Sourcing：拒绝。当前状态模型已经是权威投影，迁移成本和一致性风险超出 V1 需要。

## Consequences

优点：所有 Surface 共用同一语义；DTO 与 Runtime 可替换；未来 REST/SSE/飞书只需 Adapter；重启后查询仍来自 Persistent Core。

成本：需要维护 Contract version、DTO mapper、validator、cursor 映射和兼容测试；Phase 1 部分 Service 需要补 list/query 方法，但不改变其核心状态语义。

## Deferred

HTTP 认证、REST/GraphQL、SSE/WebSocket、飞书签名验证、Scheduler lease、Codex Worker、Workspace 文件能力、DayPlan/NightPlan 的正式模型均不在 Phase 2A。
