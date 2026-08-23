# Pi 与 Margin 贡献边界

本表是简历、演示和面试表述的事实边界。状态必须由代码、测试或运行 Trace 支撑。

Margin 当前治理工具为 `memory_search`、`memory_propose`、`state_update`、`action_update`；这些不是 Pi 原生工具。

| Pi 原生能力 | Margin 新增能力 | 尚未实现 |
| --- | --- | --- |
| Agent loop 与模型调用生命周期 | 固定 Pi/Node 基线与可复现审计 | Pi 接入生产 `chatService.js` |
| 工具注册、调用事件和执行结果 | 默认关闭 Pi 内置高风险工具的 allowlist | `memory_search` 正式工具 |
| Session 持久化与恢复 | Workstream/Run/Checkpoint 持久状态及重启恢复 | Scheduler 与跨进程 Run lease |
| Session 分支、树导航 | Session 来源关联与跨 Session 连续性上下文 | 完整分支产品界面 |
| 上下文压缩及压缩事件 | 独立于 Session 的结构化状态、记忆与召回门控 | 压缩后大规模冻结评测 |
| AgentSessionRuntime 的新建、切换、分支运行时替换 | 四个治理工具、宿主 Run 控制与审计证据 | 50+ 冻结任务、A/B/C 报告与真实用户研究 |

## 表述约束

- 可以说：选型并固定 Pi SDK；设计 Margin 的结构化连续性层；实现隔离、安全的 SDK 验证入口。
- 不可以说：从零实现 Agent loop、Session、分支或压缩。
- 不可以把普通会话摘要称为长期记忆，也不可以把自动化测试数量称为用户价值。
- 四个 Margin 工具与跨 Session Persistent Core 已实现；不得把尚未完成的基线评测、Scheduler、Workspace Worker 或真实用户研究表述为成果。
