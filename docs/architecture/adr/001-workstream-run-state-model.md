# ADR 001：Workstream / Run 状态模型

状态：Phase 1 已采纳。日期：2026-08-23。

Workstream 是长期工作目标与当前状态；Run 是一次受控执行；Pi Session 或未来 Codex Thread 只是 Run 的运行时引用。Chat 不作为状态数据库。

现有 `margin_projects` 在 Phase 1 作为 Workstream 的持久身份表演进，保留已有 ID、来源和事件。`margin_tasks` 暂作 Workstream 内的近期任务投影；新执行生命周期只写入 `margin_runs`，不以 task/action/session 代替 Run。

Workstream 状态：running、ready、waiting、watching、blocked、needs_owner、paused、completed。Run 状态：queued、running、paused、completed、failed、needs_owner、cancelled。所有转换通过封闭状态机、乐观版本、Event 和 Audit 执行；完成、失败或取消的 Run 不允许 resume。

兼容工具中的 `projectId` 在 Phase 1 仍表示 Workstream ID。新 Application API 使用 `workstreamId`；Runtime Adapter 负责参数映射，领域层不导入 Pi 类型。
