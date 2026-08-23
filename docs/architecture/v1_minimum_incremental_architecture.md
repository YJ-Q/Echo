# Margin V1 最小增量架构

## 核心边界

- `domain/`：Workstream、Run、Artifact、Checkpoint、Decision、Event、DayPlan 的底座无关对象和状态机。
- `application/`：用例服务，负责事务、授权、幂等和跨对象一致性。
- `infrastructure/state/`：SQLite repository；未来 PostgreSQL 实现同一 contract。
- `runtime/`：Pi、DeepSeek Harness 或 Codex 的适配层，不拥有 Personal State。
- `surfaces/`：CLI、Web、Feishu；只调用 Application API。
- `scheduler/`：持久 Run 的 lease、唤醒、重试和停止，不保存模型私有状态。

## 迁移原则

现有 `src/core/` 不被推倒重写。Phase 1 先抽取 Application Service 和 Repository contract，再通过迁移扩展 Schema。现有四工具继续可用，由兼容 adapter 把 `projectId/taskId` 映射到 Workstream/Run 用例。兼容层有明确删除条件，不形成第二套业务实现。

旧 `src/routes/`、`src/services/` 和 `src/storage/memoryStore.js` 进入冻结状态。其数据先导出、分类为迁移/归档/删除候选，经用户确认后处理；在此之前不删除 `data/echo.sqlite`。

## 状态与执行

- Workstream 是长期工作主单位；
- Run 是一次可暂停、恢复和审计的受控执行；
- Runtime Session ID 只是 Run 的外部运行引用；
- Artifact 是结果引用，不是聊天附件副本；
- Checkpoint 同时记录结构化状态版本和可选 Git ref；
- Event 记录事实，当前表是投影，Audit 记录授权与调用；
- DayPlan / DailyReview 是可修订的结构化视图，不是聊天摘要。

## 第一阶段技术默认

- Node.js ESM，保持 `>=22.19.0`；
- SQLite 单节点持久化，开启事务、外键和 WAL；
- Repository contract 禁止上层拼 SQL；
- 写入采用 request ID 幂等、乐观版本和 append-only Event；
- 高风险操作走宿主确认记录；
- Pi `0.84.2` 暂作 runtime baseline，但不写入领域接口。

## 明确延后

- 自动 Domain/Workstream 创建与路由；
- PostgreSQL/pgvector 正式迁移；
- 完整权限管理 UI；
- 多 Agent 组织、Temporal Council UI 和完整移动 App；
- 未经 Night Run 安全验收的无人自动执行。
